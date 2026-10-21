import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { work24RegionsAction as action, work24RegionsSchema, work24RegionsEndpoint, work24RegionsRequestTemplate, work24RegionsExecutor, normalizeWork24Regions } from '../src/connectors/work24-regions.js';
import { work24Action } from '../src/connectors/work24.js';
import { work24Regions } from '../src/research/work24-reference.js';
import { previewDraftRequest } from '../src/connectors/drafts/index.js';
import { ActionError, type ExecutionContext } from '../src/types.js';
import { admin } from '../src/core/engine.js';
import { createRuntime } from '../src/http.js';
import { TestVault,tempDir } from './helpers.js';
import { runtimeApi,runtimeLogin } from './mcp-oauth-fixture.js';
import { work24RegionsMock,work24RegionsXml,work24RegionTree,work24Secret,work24AccessError } from './work24-fixture.js';
import { Work24RegionsResult,work24RegionsInputState } from '../ui/Work24Regions.js';

const code=(name:string,state='failed')=>(error:unknown)=>error instanceof ActionError&&error.code===name&&error.state===state&&!error.message.includes(work24Secret);
function context(controller=new AbortController()) {
  let sends=0;const stamp=new Date().toISOString();
  const ctx:ExecutionContext={job:{id:randomUUID(),clientId:'local-admin',actionId:action.id,input:{},idempotencyKey:randomUUID(),requestHash:'unit',effect:'read',state:'running',revision:1,dispatched:false,createdAt:stamp,updatedAt:stamp,interventions:0,events:[]},secrets:{authKey:work24Secret},signal:controller.signal,dispatch(){sends++;}};
  return{ctx,sends:()=>sends};
}

test('Work24 region action permits only a fixed region request with a separately granted existing credential',()=>{
  assert.equal(action.connectorId,work24Action.connectorId);assert.equal(action.effect,'read');assert.equal(action.credentialType,'work24-api');assert.deepEqual(action.requiredSecrets,['authKey']);assert.equal(action.verification,'documented');
  assert(work24RegionsSchema.safeParse({}).success);
  for(const input of [{authKey:'bad'},{dtlGb:'2'},{target:'other'},{regionCode:'11000'},{endpoint:'https://other.example'},null,[]])assert(!work24RegionsSchema.safeParse(input).success);
  const request=work24RegionsRequestTemplate({});assert.equal(request.endpoint,work24RegionsEndpoint);assert.deepEqual(request.query,{returnType:'XML',target:'CMCD',dtlGb:'1'});
  const preview=previewDraftRequest(action.id,{});assert.equal(preview.networkDispatched,false);assert(!JSON.stringify(preview).includes(work24Secret));
});

test('Work24 regions preserve source names, leading zero, parents and unconfirmed provider totals independently of static XLS',()=>{
  const before=JSON.stringify(work24Regions),data=normalizeWork24Regions(work24RegionsXml(work24RegionTree('강남 & 시험구')));
  assert.equal(data.regions[1]!.name,'강남 & 시험구');assert.deepEqual(data.regions[1],{code:'11680',name:'강남 & 시험구',parentCode:'11000',depth:2});assert.equal(data.regions[2]!.code,'00000');assert.equal(data.regions[2]!.parentCode,null);
  assert.deepEqual(data.counts,{providerTotal:3,returnedCount:3,rootCount:2,childCount:1,providerTotalBasis:'unconfirmed'});assert.equal(data.completenessVerified,false);assert(Number.isFinite(Date.parse(data.retrievedAt)));assert.equal(JSON.stringify(work24Regions),before);
  // The public specification does not define which hierarchy levels total counts.
  assert.equal(normalizeWork24Regions(work24RegionsXml(work24RegionTree(),2)).counts.providerTotal,2);
  const single=work24RegionsXml('<oneDepth><regionCd>00000</regionCd><regionNm>지역무관</regionNm><twoDepth/></oneDepth>',1);assert.equal(normalizeWork24Regions(single).regions.length,1);
});

test('Work24 regions reject duplicates, missing fields, orphaned parents and undocumented hierarchy rather than dropping rows',()=>{
  const raw=work24RegionsXml();
  for(const value of [
    raw.replace('11680','11000'),raw.replace('00000','11680'),raw.replace('<regionNm>강남구</regionNm>',''),raw.replace('<superCd>11000</superCd>',''),raw.replace('<superCd>11000</superCd>','<superCd>12000</superCd>'),
    raw.replace('11680','1168'),raw.replace('강남구',' '),raw.replace('</twoDepth>','<threeDepth><regionCd>11681</regionCd></threeDepth></twoDepth>'),raw.replace('</oneDepth>','<superCd>99999</superCd></oneDepth>'),
    raw.replace('<total>3</total>','<total>-1</total>'),raw.replace('<total>3</total>','<total>3</total><total>3</total>'),raw.replace('<total>3</total>',''),raw.replace('<codeName>지역코드</codeName>',''),raw.replace('<total>3</total>','<total>0</total>'),
    '<!DOCTYPE x [<!ENTITY a "bad">]>'+raw,raw.replace('</cmcdRegion>',''),raw+'<cmcdRegion/>',raw.replace('cmcdRegion','wantedRoot'),
  ])assert.throws(()=>normalizeWork24Regions(value),code('INVALID_RESPONSE'));
  const duplicated=work24RegionsXml(work24RegionTree()+work24RegionTree(),6);assert.throws(()=>normalizeWork24Regions(duplicated),code('INVALID_RESPONSE'));
});

test('Work24 regions distinguish explicit zero results from missing or contradictory bodies and sanitize service errors',()=>{
  const empty=normalizeWork24Regions(work24RegionsXml('',0));assert.equal(empty.status,'no_data');assert.deepEqual(empty.regions,[]);
  for(const raw of [work24RegionsXml('',1),'', '<cmcdRegion/>','<html>error</html>'])assert.throws(()=>normalizeWork24Regions(raw),code('INVALID_RESPONSE'));
  assert.throws(()=>normalizeWork24Regions(work24AccessError),code('WORK24_SERVICE_ACCESS_REQUIRED','awaiting_auth'));
  assert.throws(()=>normalizeWork24Regions(`<GO24><error>${work24Secret}</error></GO24>`),code('WORK24_PROVIDER_ERROR'));
  assert.throws(()=>normalizeWork24Regions('x'.repeat(2_000_001)),code('RESULT_TOO_LARGE'));
});

test('Work24 region executor dispatches once to its exact endpoint and reuses bounded, non-retrying XML transport',async()=>{
  const mock=work24RegionsMock(),run=context(),result=await work24RegionsExecutor(mock.fetcher)(action,run.ctx);
  assert.equal(run.sends(),1);assert.equal(mock.calls.length,1);assert.equal((result.data as any).regions.length,3);assert(!JSON.stringify(result).includes(work24Secret));
  for(const [status,name,state]of [[401,'AUTH_REQUIRED','awaiting_auth'],[403,'AUTH_REQUIRED','awaiting_auth'],[429,'PROVIDER_RATE_LIMIT','failed'],[500,'PROVIDER_HTTP_500','failed']]as const){const m=work24RegionsMock();m.flags.status=status;await assert.rejects(()=>work24RegionsExecutor(m.fetcher)(action,context().ctx),code(name,state));assert.equal(m.calls.length,1);}
  for(const [raw,name]of [[new Uint8Array([0xff]),'INVALID_RESPONSE'],['x'.repeat(2_000_001),'RESULT_TOO_LARGE']]as const)await assert.rejects(()=>work24RegionsExecutor(async()=>new Response(raw))(action,context().ctx),code(name));
  await assert.rejects(()=>work24RegionsExecutor(async()=>{throw Error(work24Secret);})(action,context().ctx),code('PROVIDER_UNAVAILABLE'));
  await assert.rejects(()=>work24RegionsExecutor(async()=>{throw new DOMException(work24Secret,'TimeoutError');})(action,context().ctx),code('PROVIDER_TIMEOUT'));
});

test('Work24 region executor stops invalid credentials, other actions and cancellation before and after dispatch',async()=>{
  const mock=work24RegionsMock();
  for(const authKey of ['', 'bad\nkey']){const run=context();run.ctx.secrets.authKey=authKey;await assert.rejects(()=>work24RegionsExecutor(mock.fetcher)(action,run.ctx),code('AUTH_REQUIRED','awaiting_auth'));assert.equal(run.sends(),0);}
  await assert.rejects(()=>work24RegionsExecutor(mock.fetcher)(work24Action,context().ctx),code('NOT_IMPLEMENTED'));
  const controller=new AbortController();controller.abort();await assert.rejects(()=>work24RegionsExecutor(mock.fetcher)(action,context(controller).ctx),code('CANCELLED','cancelled'));assert.equal(mock.calls.length,0);
  const mid=new AbortController();await assert.rejects(()=>work24RegionsExecutor(async()=>{mid.abort();return new Response(work24RegionsXml());})(action,context(mid).ctx),code('CANCELLED','cancelled'));
});

test('Work24 HTTP retains old account/client/chat grants, requires explicit region permission and deduplicates resumable reads',async()=>{
  const mock=work24RegionsMock(),r=await createRuntime({dataDir:tempDir('work24-regions-http'),port:0,vault:new TestVault(),evidenceMode:'mock',fetcher:mock.fetcher});
  try{
    const cookie=await runtimeLogin(r),api=(path:string,method='GET',body?:unknown,token?:string)=>runtimeApi(r,'/api'+path,method,body,cookie,token?{Authorization:`Bearer ${token}`}:{ });
    const account=await r.engine.saveAccount({label:'기존 고용24',credentialType:'work24-api',allowedActions:[work24Action.id],secrets:{authKey:work24Secret}});
    const oldClient=r.engine.createClient({name:'old listing client',allowedActions:[work24Action.id],allowedAccountIds:[account.id]}),chat=await r.chats.create({allowedActions:[work24Action.id]});assert.deepEqual(chat.allowedActions,[work24Action.id]);
    const regionClient=r.engine.createClient({name:'region client',allowedActions:[action.id],allowedAccountIds:[account.id]}),request={actionId:action.id,accountId:account.id,input:{},idempotencyKey:randomUUID()};
    assert.equal((await api('/jobs','POST',request,oldClient.token)).status,403);
    const denied=await api('/jobs','POST',request,regionClient.token);assert.notEqual(denied.status,200);assert.equal((await denied.json()).error.code,'ACCOUNT_REQUIRED');assert.equal(mock.calls.length,0);
    const preview=await(await api('/drafts/'+action.id+'/preview','POST',{})).json();assert.equal(preview.networkDispatched,false);assert.equal(mock.calls.length,0);
    await r.engine.saveAccount({id:account.id,label:account.label,credentialType:'work24-api',allowedActions:[work24Action.id,action.id]});
    assert.equal((await api('/jobs','POST',request,oldClient.token)).status,403);
    const created=await(await api('/jobs','POST',request,regionClient.token)).json();await r.engine.idle();const job=await(await api('/jobs/'+created.id,'GET',undefined,regionClient.token)).json();assert.equal(job.state,'succeeded');assert.equal(job.result.contentTrust,'external_data');assert.equal(job.result.data.regions[1].code,'11680');
    await api('/jobs','POST',request,regionClient.token);await r.engine.idle();assert.equal(mock.calls.length,1);
    mock.flags.body=work24AccessError;const paused=await(await api('/jobs','POST',{...request,idempotencyKey:randomUUID()},regionClient.token)).json();await r.engine.idle();assert.equal(r.engine.get(admin,paused.id).state,'awaiting_auth');mock.flags.body=work24RegionsXml();await api('/jobs/'+paused.id+'/resume','POST',{},regionClient.token);await r.engine.idle();assert.equal(r.engine.get(admin,paused.id).state,'succeeded');
    const state=await(await api('/state')).json();assert(!JSON.stringify(state).includes(work24Secret));assert.equal(r.engine.metrics().supportedActions,0);assert.equal(r.engine.metrics().verifiedServices,0);
  }finally{await r.close();}
});

test('Work24 region cards escape provider text, preserve code hierarchy and distinguish API counts/time from static references',()=>{
  const render=(result:unknown)=>renderToStaticMarkup(createElement(Work24RegionsResult,{result,busy:false,onPage:()=>{throw Error('unexpected page');}}));
  const data=normalizeWork24Regions(work24RegionsXml(work24RegionTree('<script>unsafe</script>'))),value={contentTrust:'external_data',data},html=render(value);
  for(const expected of ['&lt;script&gt;','11680','00000','서울 · 11000','집계 범위','정적 XLS','한국 시간','JSON 상세'])assert(html.includes(expected),expected);assert(!html.includes('<script>'));
  for(const bad of [null,{...data,regions:[{code:'11680'}]},{...data,counts:null},{...data,regions:[data.regions[0],data.regions[0]]},{...data,regions:[{...data.regions[0],parentCode:'other'}]}])assert(render({contentTrust:'external_data',data:bad}).includes('카드로 표시할 수 없습니다.'));
  assert(render({...value,data:{...data,retrievedAt:undefined}}).includes('기록 없음'));assert(render({contentTrust:'external_data',data:normalizeWork24Regions(work24RegionsXml('',0))}).includes('지역 코드가 반환되지 않았습니다.'));
  assert.equal(work24RegionsInputState('{}').error,null);for(const input of ['null','[]','broken','{"dtlGb":"2"}'])assert(work24RegionsInputState(input).error);
});
