import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { work24Action,work24Schema,work24Example,work24RequestTemplate,work24Executor,normalizeWork24Response } from '../src/connectors/work24.js';
import { ActionError,type ExecutionContext } from '../src/types.js';
import { admin } from '../src/core/engine.js';
import { createRuntime } from '../src/http.js';
import { TestVault,tempDir } from './helpers.js';
import { runtimeApi,runtimeLogin } from './mcp-oauth-fixture.js';
import { work24Mock,work24Xml,work24Row,work24Secret,work24AccessError } from './work24-fixture.js';

const code=(name:string,state='failed')=>(error:unknown)=>error instanceof ActionError&&error.code===name&&error.state===state&&!error.message.includes(work24Secret);
function context(controller=new AbortController()) {
  let sends=0;const stamp=new Date().toISOString();
  const ctx:ExecutionContext={job:{id:randomUUID(),clientId:'local-admin',actionId:work24Action.id,input:work24Example(),idempotencyKey:randomUUID(),requestHash:'unit',effect:'read',state:'running',revision:1,dispatched:false,createdAt:stamp,updatedAt:stamp,interventions:0,events:[]},secrets:{authKey:work24Secret},signal:controller.signal,dispatch(){sends++;}};
  return{ctx,sends:()=>sends};
}

test('Work24 restricts input to documented list search parameters and a dedicated company-approved credential',()=>{
  assert.equal(work24Action.effect,'read');assert.equal(work24Action.credentialType,'work24-api');assert.deepEqual(work24Action.requiredSecrets,['authKey']);assert.equal(work24Action.verification,'documented');
  assert(work24Schema.safeParse({...work24Example(),regionCode:'11680',employmentType:'10'}).success);
  for(const patch of [{keyword:''},{keyword:'  '},{keyword:'a,b'},{keyword:'a|b'},{keyword:'a\nb'},{keyword:'a'.repeat(101)},{regionCode:'서울'},{regionCode:'1234'},{employmentType:'30'},{page:0},{page:1001},{limit:101},{limit:'10'},{authKey:'private'},{url:'https://elsewhere.test'},{callTp:'D'}])assert(!work24Schema.safeParse({...work24Example(),...patch}).success,JSON.stringify(patch));
});
test('Work24 previews fixed HTTPS XML list requests without putting a key in the template',()=>{
  const preview=work24RequestTemplate({...work24Example(),keyword:' 개발자 ',regionCode:'11680',employmentType:'11'});
  assert.equal(preview.method,'GET');assert.equal(preview.responseFormat,'xml');assert.deepEqual(preview.authentication,{secretField:'authKey',queryParameter:'authKey'});assert.deepEqual(preview.query,{callTp:'L',returnType:'XML',startPage:1,display:10,keyword:'개발자',sortOrderBy:'DESC',region:'11680',empTp:'11'});assert(!JSON.stringify(preview).includes(work24Secret));
});
test('Work24 XML retains salary, date and leading-zero code text and removes unnecessary business/address data',()=>{
  const data=normalizeWork24Response(work24Xml(),work24Example()),row=data.jobs[0]!;
  assert.equal(row.company,'시험 & 회사');assert.equal(row.salary.minimumRaw,'002500000');assert.equal(row.salary.textRaw,'250만원 ~ 300만원');assert.equal(row.salary.normalizedAmount,null);assert.equal(row.salary.normalizedUnit,null);assert.equal(row.deadlineRaw,'채용시까지');assert.equal(row.registeredOnRaw,'26-10-20');assert.equal(row.occupationCodeRaw,'001234');assert.equal(row.currentlyAcceptingApplications,null);assert.equal(data.queryMatchVerified,false);assert.equal(row.sourceLinkVerified,true);assert.equal(data.pagination.total,1);assert.equal(data.pagination.nextPage,null);assert(data.source.attribution.includes('고용24'));
  for(const value of ['private-business-number','private-address','private-detail-address','busino'])assert(!JSON.stringify(data).includes(value));
  const optional=normalizeWork24Response(work24Xml([work24Row({empTpCd:'',jobsCd:'',minSal:'0',maxSal:'',wantedInfoUrl:''})]),work24Example()).jobs[0]!;
  assert.equal(optional.salary.minimumRaw,'0');assert.equal(optional.salary.maximumRaw,null);assert.equal(optional.employmentTypeRaw,null);assert.equal(optional.occupationCodeRaw,null);assert.equal(optional.url,null);
});
test('Work24 validates list identity, employment type and pagination without treating missing rows as no data',()=>{
  const one=work24Row();assert.equal(normalizeWork24Response(work24Xml([]),work24Example()).status,'no_data');
  assert.equal(normalizeWork24Response(work24Xml([],{total:1,startPage:2}),{...work24Example(),page:2}).status,'empty_page');
  const more=normalizeWork24Response(work24Xml([one],{total:12}),work24Example());assert.equal(more.pagination.nextPage,2);assert.equal(more.pagination.partialPage,true);
  const last=normalizeWork24Response(work24Xml([one],{total:10001,startPage:1000}),{...work24Example(),page:1000});assert.equal(last.pagination.nextPage,null);
  for(const xml of [work24Xml([one,one]),work24Xml([one],{total:0}),work24Xml([],{total:1}),work24Xml([one],{startPage:2}),work24Xml([one],{display:11}),work24Xml([one],{total:'bad'}),work24Xml([work24Row({wantedAuthNo:''})]),work24Xml([work24Row({company:''})])])assert.throws(()=>normalizeWork24Response(xml,work24Example()),code('INVALID_RESPONSE'));
  assert.throws(()=>normalizeWork24Response(work24Xml([one]),{...work24Example(),employmentType:'21'}),code('INVALID_RESPONSE'));
  const two=normalizeWork24Response(work24Xml([one,work24Row({wantedAuthNo:'K000000002',wantedInfoUrl:''})]),work24Example());assert.equal(two.jobs.length,2);
});
test('Work24 shows only matching official HTTPS source URLs without following provider links',()=>{
  for(const url of ['http://www.work24.go.kr/a?wantedAuthNo=K000000001','https://evil.test/a?wantedAuthNo=K000000001','https://www.work24.go.kr.evil.test/?wantedAuthNo=K000000001','https://u:p@www.work24.go.kr/?wantedAuthNo=K000000001','https://www.work24.go.kr/?wantedAuthNo=other','https://www.work24.go.kr/?wantedAuthNo=K000000001&wantedAuthNo=K000000001','https://www.work24.go.kr/?wantedAuthNo=K000000001&authKey=private','https://www.work24.go.kr/?wantedAuthNo=K000000001#private','javascript:alert(1)'])assert.equal(normalizeWork24Response(work24Xml([work24Row({wantedInfoUrl:url})]),work24Example()).jobs[0]!.url,null);
});
test('Work24 rejects malformed XML, entities and oversized lists; provider errors are sanitized',()=>{
  for(const xml of ['broken','<wantedRoot>','<!DOCTYPE wantedRoot [<!ENTITY x "data">]>'+work24Xml(),work24Xml().replace('<company>','<company><unexpected/>')])assert.throws(()=>normalizeWork24Response(xml,work24Example()),code('INVALID_RESPONSE'));
  assert.throws(()=>normalizeWork24Response('x'.repeat(2_000_001),work24Example()),code('RESULT_TOO_LARGE'));
  assert.throws(()=>normalizeWork24Response(work24AccessError,work24Example()),code('WORK24_SERVICE_ACCESS_REQUIRED','awaiting_auth'));
  assert.throws(()=>normalizeWork24Response(`<GO24><error>${work24Secret}</error></GO24>`,work24Example()),code('WORK24_PROVIDER_ERROR'));
});
test('Work24 executor sends one fixed request with a once-encoded query key and UTF-8 keyword',async()=>{
  const mock=work24Mock(),run=context(),result=await work24Executor(mock.fetcher)(work24Action,run.ctx);
  assert.equal(run.sends(),1);assert.equal(mock.calls.length,1);assert.equal(mock.calls[0]!.searchParams.get('keyword'),'개발자');assert.equal((result.data as any).jobs.length,1);assert(!JSON.stringify(result).includes(work24Secret));
});
test('Work24 blocks missing keys, unknown actions and pre-dispatch cancellation',async()=>{
  const mock=work24Mock();for(const key of ['', 'bad\nkey']){const run=context();run.ctx.secrets.authKey=key;await assert.rejects(()=>work24Executor(mock.fetcher)(work24Action,run.ctx),code('AUTH_REQUIRED','awaiting_auth'));assert.equal(run.sends(),0);}
  await assert.rejects(()=>work24Executor(mock.fetcher)({...work24Action,id:'other'},context().ctx),code('NOT_IMPLEMENTED'));
  const controller=new AbortController();controller.abort();await assert.rejects(()=>work24Executor(mock.fetcher)(work24Action,context(controller).ctx),code('CANCELLED','cancelled'));assert.equal(mock.calls.length,0);
});
test('Work24 HTTP, XML error, encoding and body limits fail without retries or secret leakage',async()=>{
  for(const[status,name,state]of [[401,'AUTH_REQUIRED','awaiting_auth'],[403,'AUTH_REQUIRED','awaiting_auth'],[429,'PROVIDER_RATE_LIMIT','failed'],[500,'PROVIDER_HTTP_500','failed']] as const){const mock=work24Mock();mock.flags.status=status;await assert.rejects(()=>work24Executor(mock.fetcher)(work24Action,context().ctx),code(name,state));assert.equal(mock.calls.length,1);}
  for(const[flag,name]of [['invalidUtf8','INVALID_RESPONSE'],['oversized','RESULT_TOO_LARGE']] as const){const mock=work24Mock();mock.flags[flag]=true;await assert.rejects(()=>work24Executor(mock.fetcher)(work24Action,context().ctx),code(name));assert.equal(mock.calls.length,1);}
  const mock=work24Mock();mock.flags.body=work24AccessError;await assert.rejects(()=>work24Executor(mock.fetcher)(work24Action,context().ctx),code('WORK24_SERVICE_ACCESS_REQUIRED','awaiting_auth'));assert.equal(mock.calls.length,1);
  await assert.rejects(()=>work24Executor(async()=>{throw Error(work24Secret);})(work24Action,context().ctx),code('PROVIDER_UNAVAILABLE'));
});
test('Work24 timeout and in-flight cancellation do not redispatch',async()=>{
  await assert.rejects(()=>work24Executor(async()=>{throw new DOMException(work24Secret,'TimeoutError');})(work24Action,context().ctx),code('PROVIDER_TIMEOUT'));
  const controller=new AbortController();let calls=0;await assert.rejects(()=>work24Executor(async()=>{calls++;controller.abort();throw Error(work24Secret);})(work24Action,context(controller).ctx),code('CANCELLED','cancelled'));assert.equal(calls,1);
});
test('Work24 HTTP scopes accounts, previews without dispatch, deduplicates, resumes service access and excludes mocks from support',async()=>{
  const mock=work24Mock(),r=await createRuntime({dataDir:tempDir('work24-http'),port:0,vault:new TestVault(),evidenceMode:'mock',fetcher:mock.fetcher});
  try{
    const cookie=await runtimeLogin(r),api=(path:string,method='GET',body?:unknown,token?:string)=>runtimeApi(r,'/api'+path,method,body,cookie,token?{Authorization:`Bearer ${token}`}:{ });
    const preview=await(await api('/drafts/'+work24Action.id+'/preview','POST',work24Example())).json();assert.equal(preview.networkDispatched,false);assert.equal(preview.request.authentication.secretField,'authKey');assert.equal(mock.calls.length,0);
    await assert.rejects(()=>r.engine.saveAccount({label:'wrong key',credentialType:'work24-api',allowedActions:[work24Action.id],secrets:{serviceKey:work24Secret}}),code('MISSING_CREDENTIALS'));
    const account=await r.engine.saveAccount({label:'고용24',credentialType:'work24-api',allowedActions:[work24Action.id],secrets:{authKey:work24Secret}}),client=r.engine.createClient({name:'job reader',allowedActions:[work24Action.id],allowedAccountIds:[account.id]});
    const request={actionId:work24Action.id,accountId:account.id,input:work24Example(),idempotencyKey:randomUUID()},blocked=r.engine.createClient({name:'wrong account',allowedActions:[work24Action.id]});assert.equal((await api('/jobs','POST',request,blocked.token)).status,403);
    const job=await(await api('/jobs','POST',request,client.token)).json();await r.engine.idle();const result=await(await api('/jobs/'+job.id,'GET',undefined,client.token)).json();assert.equal(result.state,'succeeded');assert.equal(result.result.contentTrust,'external_data');assert.equal(result.result.data.jobs[0].deadlineRaw,'채용시까지');assert(!JSON.stringify(result).includes(work24Secret));
    await api('/jobs','POST',request,client.token);await r.engine.idle();assert.equal(mock.calls.length,1);
    mock.flags.body=work24AccessError;const paused=await(await api('/jobs','POST',{...request,idempotencyKey:randomUUID()},client.token)).json();await r.engine.idle();assert.equal(r.engine.get(admin,paused.id).state,'awaiting_auth');assert.equal(r.engine.get(admin,paused.id).error?.code,'WORK24_SERVICE_ACCESS_REQUIRED');mock.flags.body=null;await api('/jobs/'+paused.id+'/resume','POST',{},client.token);await r.engine.idle();assert.equal(r.engine.get(admin,paused.id).state,'succeeded');
    const state=await(await api('/state')).json();assert(!JSON.stringify(state).includes(work24Secret));assert.equal(r.engine.metrics().verifiedServices,0);assert.equal(r.engine.metrics().supportedActions,0);assert.equal((await r.chats.create({allowedActions:[work24Action.id]})).allowedActions[0],work24Action.id);
  }finally{await r.close();}
});
