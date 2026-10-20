import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { kosisAction as action, kosisSchema, kosisExample, kosisTable, kosisRegions, kosisRequestTemplate, kosisExecutor } from '../src/connectors/kosis.js';
import { createRuntime } from '../src/http.js';
import { ActionError, type ExecutionContext } from '../src/types.js';
import { TestVault, tempDir } from './helpers.js';
import { runtimeApi, runtimeLogin } from './mcp-oauth-fixture.js';

const secret='unit-kosis-private-key+/=%&';
const input={regionCodes:['11','31'],itemIds:['T10','T001','T002'],frequency:'M',from:'202608',to:'202609'};
const row=()=>({ORG_ID:'101',TBL_ID:'DT_1YL20631',TBL_NM:'고령인구비율(시도/시/군/구)',C1:'11',C1_NM:'서울특별시',C1_OBJ_NM:'행정구역별',ITM_ID:'T10',ITM_NM:'고령인구비율<br>(A÷B×100)',UNIT_NM:'%',PRD_SE:'M',PRD_DE:'202609',DT:'21.2',LST_CHN_DE:'2026-10-12'});
const reply=(rows:Record<string,unknown>[]=[row()])=>JSON.stringify(rows);
function context(values:Record<string,unknown>=input,controller=new AbortController()){
  let dispatched=0;const now=new Date().toISOString();
  const ctx:ExecutionContext={job:{id:randomUUID(),clientId:'local-admin',actionId:action.id,input:values,idempotencyKey:randomUUID(),requestHash:'test',effect:'read',state:'running',revision:1,dispatched:false,createdAt:now,updatedAt:now,interventions:0,events:[]},secrets:{apiKey:secret},signal:controller.signal,dispatch(){dispatched++;}};
  return{ctx,dispatched:()=>dispatched};
}
const execute=async(body=reply(),values:Record<string,unknown>=input)=>(await kosisExecutor(async()=>new Response(body))(action,context(values).ctx)).data as Record<string,any>;
const hasCode=(code:string,state='failed')=>(error:unknown)=>error instanceof ActionError && error.code===code && error.state===state && !error.message.includes(secret);

test('KOSIS bounds reviewed table dimensions and frequency-specific dates without allowing wildcard, arbitrary table or URL inputs',()=>{
  assert.equal(Object.keys(kosisRegions).length,17);assert.equal(kosisRegions['29'],'세종특별자치시');assert.equal(kosisRegions['21'],'부산광역시');assert(kosisSchema.safeParse(input).success);
  assert(kosisSchema.safeParse({...input,frequency:'Y',from:'2000',to:'2011'}).success);assert(kosisSchema.safeParse({...input,from:'202512',to:'202611'}).success);
  for(const patch of [{regionCodes:[]},{regionCodes:['ALL']},{regionCodes:['11','11']},{regionCodes:['26','28','30']},{regionCodes:['00','11','12','21','22','23']},{itemIds:['T003']},{itemIds:['T10','T10']},{from:'202600'},{to:'202613'},{frequency:'Y'},{from:'202609',to:'202608'},{to:'202708'},{from:'200712'},{frequency:'Y',from:'1999',to:'2000'},{url:'https://evil.example'},{tblId:'other'},{apiKey:secret}])assert(!kosisSchema.safeParse({...input,...patch}).success,JSON.stringify(patch));
  assert.equal(kosisExample(new Date('2026-01-01T00:00:00+09:00')).from,'202512');assert.equal(kosisExample(new Date('2026-10-31T16:00:00Z')).to,'202610');assert(kosisSchema.safeParse(kosisExample()).success);
});

test('KOSIS dispatches one fixed HTTPS request with literal dimension separators, symbol mode and exactly one encoded private key',async()=>{
  const template=kosisRequestTemplate(input);assert.equal(template.endpoint,'https://kosis.kr/openapi/Param/statisticsParameterData.do');assert.equal(template.query.objL1,'11+31');assert.equal(template.query.itmId,'T10+T001+T002');assert.equal(template.query.smblChk,'Y');assert.equal(template.query.startPrdDe,'202608');assert(!JSON.stringify(template).includes(secret));assert(!('apiKey'in template.query));
  let calls=0;const run=context();await kosisExecutor(async(address,init)=>{calls++;const url=new URL(String(address));assert.equal(url.searchParams.get('apiKey'),secret);assert.equal(url.searchParams.getAll('apiKey').length,1);assert.equal(url.searchParams.get('objL1'),'11+31');assert.equal(url.searchParams.get('tblId'),kosisTable.tableId);assert.equal(init?.redirect,'error');assert.equal(init?.cache,'no-store');return new Response(reply());})(action,run.ctx);assert.equal(calls,1);assert.equal(run.dispatched(),1);
});

test('KOSIS preserves precision, statistical symbols, units, source and dates while reporting unreturned combinations separately',async()=>{
  const rows=[row(),{...row(),ITM_ID:'T001',ITM_NM:'65세이상인구',UNIT_NM:'명',DT:'9007199254740993'},{...row(),C1:'31',C1_NM:'경기도',DT:'p21.0'},{...row(),ITM_ID:'T002',ITM_NM:'전체인구',UNIT_NM:'명',PRD_DE:'202608',DT:'0'}];
  const result=await execute(reply(rows));assert.equal(result.observations[1].numericValue,'9007199254740993');assert.equal(result.observations[0].valueRaw,'21.2');assert.equal(result.observations[0].providerModifiedOn,'2026-10-12');assert.equal(result.observations[0].period,'202609');assert.equal(result.observations[0].unit,'%');assert.equal(result.observations[0].provisional,null);assert.equal(result.observations[2].numericValue,null);assert.equal(result.observations[2].valueRaw,'p21.0');assert.equal(result.observations[2].valueKind,'symbol_or_text');assert.equal(result.observations[3].numericValue,'0');assert.equal(result.currentPopulation,null);assert.equal(result.coverage.expectedCells,12);assert.equal(result.coverage.notReturned.length,8);assert.equal(result.returnedCount,4);assert(result.source.attribution.includes('KOSIS'));assert.equal(result.source.url,kosisTable.url);
});

test('KOSIS keeps empty, symbolic and omitted values distinct and accepts documented annual request Y with provider A or Y',async()=>{
  for(const value of [null,'','  ','-','...','X','21.2 p','1,234']){const result=await execute(reply([{...row(),DT:value,LST_CHN_DE:''}]));assert.equal(result.observations[0].valueRaw,value);assert.equal(result.observations[0].numericValue,null);assert.equal(result.observations[0].providerModifiedOn,null);}
  for(const frequency of ['A','Y']){const result=await execute(reply([{...row(),PRD_SE:frequency,PRD_DE:'2025'}]),{...input,frequency:'Y',from:'2024',to:'2025'});assert.equal(result.observations[0].frequency,'Y');assert.equal(result.observations[0].frequencyRaw,frequency);assert.equal(result.coverage.expectedCells,12);}
  for(const body of ['[]',JSON.stringify({err:'30',errMsg:secret})]){const result=await execute(body);assert.equal(result.status,'no_data');assert.equal(result.coverage.notReturned.length,12);assert.equal(result.currentPopulation,null);assert(!JSON.stringify(result).includes(secret));}
  const boundary=await execute(reply([{...row(),PRD_DE:'202601'}]),{...input,from:'202512',to:'202601'});assert.equal(boundary.coverage.expectedCells,12);
});

test('KOSIS fails closed on changed table, filter mismatches, duplicate cells, missing units, extra classifications and corrupt response fields',async()=>{
  for(const patch of [{ORG_ID:'110'},{TBL_ID:'DT_OTHER'},{C1:'21'},{ITM_ID:'T003'},{PRD_SE:'Y'},{PRD_DE:'202610'},{PRD_DE:'202600'},{UNIT_NM:'명'},{UNIT_NM:''},{DT:21.2},{DT:undefined},{LST_CHN_DE:'2026-02-29'},{C2:'other'}])await assert.rejects(()=>execute(reply([{...row(),...patch}])),hasCode('INVALID_RESPONSE'));
  await assert.rejects(()=>execute(reply([row(),row()])),hasCode('INVALID_RESPONSE'));await assert.rejects(()=>execute(reply(),{...input,itemIds:['T001']}),hasCode('INVALID_RESPONSE'));
  for(const body of ['{','{}','null','{"errMsg":"no data"}','<html>login</html>','<!DOCTYPE data [<!ENTITY x "boom">]><data/>'])await assert.rejects(()=>execute(body),hasCode('INVALID_RESPONSE'));
});

test('KOSIS maps HTTP-200 authentication, quota and row errors without exposing provider messages or retrying',async()=>{
  for(const code of ['10','11'])await assert.rejects(()=>execute(JSON.stringify({err:code,errMsg:secret})),hasCode('AUTH_REQUIRED','awaiting_auth'));
  for(const[code,expected]of [['40','PROVIDER_RATE_LIMIT'],['31','RESULT_TOO_LARGE'],['41','RESULT_TOO_LARGE'],['42','PROVIDER_ACCESS_BLOCKED'],['20','PROVIDER_20'],['21','PROVIDER_21'],['50','PROVIDER_50']])await assert.rejects(()=>execute(JSON.stringify({err:Number(code),errMsg:secret})),hasCode(expected));
  for(const[status,code,state]of [[401,'AUTH_REQUIRED','awaiting_auth'],[403,'AUTH_REQUIRED','awaiting_auth'],[429,'PROVIDER_RATE_LIMIT','failed'],[500,'PROVIDER_HTTP_500','failed']] as const){let calls=0;await assert.rejects(()=>kosisExecutor(async()=>{calls++;return new Response(secret,{status});})(action,context().ctx),hasCode(code,state));assert.equal(calls,1);}
});

test('KOSIS handles cancellation, bounded UTF-8 streams and sanitized connection errors',async()=>{
  for(const key of ['', 'key\nvalue']){const run=context();run.ctx.secrets.apiKey=key;await assert.rejects(()=>kosisExecutor()(action,run.ctx),hasCode('AUTH_REQUIRED','awaiting_auth'));assert.equal(run.dispatched(),0);}
  await assert.rejects(()=>kosisExecutor(async()=>{throw Error(`https://kosis.kr/?apiKey=${secret}`);})(action,context().ctx),hasCode('PROVIDER_CONNECTION_ERROR'));
  await assert.rejects(()=>kosisExecutor(async()=>{throw new DOMException(secret,'TimeoutError');})(action,context().ctx),hasCode('PROVIDER_TIMEOUT'));
  const before=new AbortController(),run=context(input,before);before.abort();await assert.rejects(()=>kosisExecutor()(action,run.ctx),hasCode('CANCELLED','cancelled'));assert.equal(run.dispatched(),0);
  const during=new AbortController();await assert.rejects(()=>kosisExecutor(async()=>{during.abort();return new Response(reply());})(action,context(input,during).ctx),hasCode('CANCELLED','cancelled'));
  let cancelled=false;const stream=new ReadableStream<Uint8Array>({pull(c){c.enqueue(new Uint8Array(1_000_001));},cancel(){cancelled=true;}});await assert.rejects(()=>kosisExecutor(async()=>new Response(stream))(action,context().ctx),hasCode('RESULT_TOO_LARGE'));assert(cancelled);
  await assert.rejects(()=>kosisExecutor(async()=>new Response(new Uint8Array([0xff])))(action,context().ctx),hasCode('INVALID_RESPONSE'));await assert.rejects(()=>kosisExecutor()({...action,id:'kosis.other'},context().ctx),hasCode('NOT_IMPLEMENTED'));
});

test('KOSIS HTTP scopes the key, previews without calls, deduplicates and resumes authentication without producing support evidence',async()=>{
  let calls=0,denied=false;const r=await createRuntime({dataDir:tempDir('kosis-http'),port:0,vault:new TestVault(),evidenceMode:'mock',fetcher:async()=>{calls++;return new Response(denied?JSON.stringify({err:'11',errMsg:secret}):reply());}});
  try{
    const cookie=await runtimeLogin(r),api=(path:string,method='GET',body?:unknown,bearer?:string)=>runtimeApi(r,`/api${path}`,method,body,cookie,bearer?{Authorization:`Bearer ${bearer}`}:{ });
    const preview=await(await api(`/drafts/${action.id}/preview`,'POST',input)).json();assert.equal(preview.networkDispatched,false);assert.equal(preview.request.authentication.queryParameter,'apiKey');assert.equal(preview.request.query.apiKey,undefined);assert.equal(calls,0);
    const request={actionId:action.id,input,accountId:'',idempotencyKey:randomUUID()},wrong=await r.engine.saveAccount({label:'LH 시험',credentialType:'lh-api',allowedActions:['lh.notices.search'],secrets:{serviceKey:secret}});request.accountId=wrong.id;assert.equal((await(await api('/jobs','POST',request)).json()).error.code,'ACCOUNT_REQUIRED');
    const account=await r.engine.saveAccount({label:'KOSIS 시험',credentialType:'kosis-api',allowedActions:[action.id],secrets:{apiKey:secret}});request.accountId=account.id;const client=r.engine.createClient({name:'KOSIS reader',allowedActions:[action.id],allowedAccountIds:[account.id]});
    for(const limits of [{allowedActions:[action.id],allowedAccountIds:[]},{allowedActions:['lh.notices.search'],allowedAccountIds:[account.id]}]){const blocked=r.engine.createClient({name:'blocked',...limits});assert.equal((await api('/jobs','POST',request,blocked.token)).status,403);}
    const response=await api('/jobs','POST',request,client.token);assert.equal(response.status,202);const job=await response.json();await r.engine.idle();const result=await(await api(`/jobs/${job.id}`,'GET',undefined,client.token)).json();assert.equal(result.state,'succeeded');assert.equal(result.result.contentTrust,'external_data');assert.equal(result.result.data.observations[0].valueRaw,'21.2');assert(!JSON.stringify(result).includes(secret));
    const duplicate=await(await api('/jobs','POST',request,client.token)).json();await r.engine.idle();assert.equal(duplicate.id,job.id);assert.equal(calls,1);
    denied=true;const pending=await(await api('/jobs','POST',{...request,idempotencyKey:randomUUID()},client.token)).json();await r.engine.idle();assert.equal((await(await api(`/jobs/${pending.id}`,'GET',undefined,client.token)).json()).state,'awaiting_auth');denied=false;await api(`/jobs/${pending.id}/resume`,'POST',{},client.token);await r.engine.idle();assert.equal((await(await api(`/jobs/${pending.id}`,'GET',undefined,client.token)).json()).state,'succeeded');assert.equal(calls,3);assert.equal(r.engine.metrics().verifiedServices,0);assert.equal(r.engine.metrics().supportedActions,0);
  }finally{await r.close();}
});
