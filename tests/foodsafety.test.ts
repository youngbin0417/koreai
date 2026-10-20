import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { foodsafetyAction as action, foodsafetySchema, foodsafetyExample, foodsafetyRequestTemplate, foodsafetyExecutor } from '../src/connectors/foodsafety.js';
import { createRuntime } from '../src/http.js';
import { ActionError, type ExecutionContext } from '../src/types.js';
import { TestVault, tempDir } from './helpers.js';
import { runtimeApi, runtimeLogin } from './mcp-oauth-fixture.js';

const secret='unit-foodsafety-private-key-12345';
const row=()=>({RTRVLDSUSE_SEQ:'003000236053',PRDTNM:'시험 식품',RTRVLPRVNS:'시험 회수사유',BSSHNM:'시험 제조업체',ADDR:'시험 주소',TELNO:null,BRCDNO:'R001234567890',FRMLCUNIT:'330ml',MNFDT:'데이터없음',DISTBTMLMT:'(소비기한) 제조일로부터 12개월',RTRVLPLANDOC_RTRVLMTHD:'택배 회수',PRDLST_TYPE:'가공식품',PRDLST_CD:'C0309030300000',CRET_DTM:'2026-10-20 17:07:36.204883',PRDLST_REPORT_NO:'0012345678901',RTRVL_GRDCD_NM:'자율회수',PRDLST_CD_NM:'시험 유형',LCNS_NO:'00123456789',IMG_FILE_PATH:'http://images.example.org/not-fetched.jpg'});
const reply=(rows:unknown[]|unknown=[row()],total:unknown=Array.isArray(rows)?rows.length:1,code='INFO-000')=>JSON.stringify({I0490:{total_count:total,row:rows,RESULT:{CODE:code,MSG:'시험 응답'}}});
const escape=(value:unknown)=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&apos;'}[c]!));
const xml=(record:Record<string,unknown>)=>`<I0490><total_count>1</total_count><RESULT><CODE>INFO-000</CODE></RESULT><row id="0">${Object.entries(record).map(([key,value])=>`<${key}>${escape(value)}</${key}>`).join('')}</row></I0490>`;
function context(values:Record<string,unknown>={},controller=new AbortController()){
  let dispatched=0;const now=new Date().toISOString();
  const ctx:ExecutionContext={job:{id:randomUUID(),clientId:'local-admin',actionId:action.id,input:values,idempotencyKey:randomUUID(),requestHash:'test',effect:'read',state:'running',revision:1,dispatched:false,createdAt:now,updatedAt:now,interventions:0,events:[]},secrets:{apiKey:secret},signal:controller.signal,dispatch(){dispatched++;}};
  return{ctx,dispatched:()=>dispatched};
}
const execute=async(body=reply(),input:Record<string,unknown>={})=>(await foodsafetyExecutor(async()=>new Response(body))(action,context(input).ctx)).data as Record<string,any>;
const hasCode=(code:string,state='failed')=>(error:unknown)=>error instanceof ActionError && error.code===code && error.state===state && !error.message.includes(secret);

test('FoodSafety bounds inclusive ranges and calendar inputs, keeps report/barcode strings and refuses unsupported server filters',()=>{
  assert(foodsafetySchema.safeParse({}).success);assert(foodsafetySchema.safeParse({start:10,end:109,createdOn:'2024-02-29',changedSince:'2024-03-01',productReportNumber:'001234',barcode:'R00123'}).success);
  for(const value of [{start:0},{start:11,end:10},{end:101},{end:1_000_001},{createdOn:'2026-02-29'},{changedSince:'20261020'},{productReportNumber:123},{productReportNumber:'../other'},{barcode:'a/b'},{name:''},{PRDTNM:'시험'},{apiKey:secret},{url:'http://localhost'},{serviceId:'I0482'},{sort:'latest'}])assert(!foodsafetySchema.safeParse(value).success,JSON.stringify(value));
  assert.equal(foodsafetyExample(new Date('2026-12-31T15:00:00Z')).changedSince,'2026-12-31');assert.equal(foodsafetyExample(new Date('2026-12-31T14:59:59Z')).changedSince,'2026-12-30');
});

test('FoodSafety maps native filters to the path and applies the personal key in one fixed HTTPS request without local filters',async()=>{
  const input={start:10,end:10,createdOn:'2026-10-20',changedSince:'2026-10-19',productReportNumber:row().PRDLST_REPORT_NO,name:'시험',barcode:row().BRCDNO};
  const template=foodsafetyRequestTemplate(input);assert.equal(template.endpoint,'https://openapi.foodsafetykorea.go.kr/api/{apiKey}/I0490/json/10/10/CRET_DTM=20261020&PRDLST_REPORT_NO=0012345678901&CHNG_DT=20261019');assert.deepEqual(template.query,{});assert.deepEqual(template.authentication,{secretField:'apiKey',pathParameter:'apiKey'});assert(!JSON.stringify(template).includes(secret));assert.equal(template.localFilter.scope,'requested_range');
  const run=context(input);let calls=0;
  await foodsafetyExecutor(async(address,init)=>{calls++;const url=new URL(String(address));assert.equal(url.origin,'https://openapi.foodsafetykorea.go.kr');assert.equal(url.pathname,template.endpoint.replace('https://openapi.foodsafetykorea.go.kr','').replace('{apiKey}',secret));assert.equal(url.search,'');assert.equal(init?.redirect,'error');assert.equal(init?.cache,'no-store');assert(!url.href.includes(encodeURIComponent('시험')));assert(!url.href.includes(row().BRCDNO));return new Response(reply([row()],10));})(action,run.ctx);
  assert.equal(calls,1);assert.equal(run.dispatched(),1);
});

test('FoodSafety preserves recall identifiers, raw manufacturing/expiry/grade/timestamp values and withheld contact fields without safety inferences or images',async()=>{
  const result=await execute(),recall=result.recalls[0];assert.equal(recall.recallId,row().RTRVLDSUSE_SEQ);assert.equal(recall.productReportNumber,'0012345678901');assert.equal(recall.manufacturerLicenseNumber,'00123456789');assert.equal(recall.barcodeRaw,'R001234567890');assert.equal(recall.manufacturedOnRaw,'데이터없음');assert.equal(recall.expiryRaw,row().DISTBTMLMT);assert.equal(recall.recallGradeRaw,'자율회수');assert.equal(recall.registeredAtRaw,row().CRET_DTM);assert.equal(recall.phone,null);
  for(const field of ['recallCompleted','appliesToUserProduct','productSafety'])assert.equal(recall[field],null);assert.equal(result.providerUpdatedAt,null);assert(result.source.attribution.includes('식품의약품안전처'));assert(!JSON.stringify(result).includes('not-fetched'));assert(!('IMG_FILE_PATH'in recall));
  const sparse=await execute(reply([{RTRVLDSUSE_SEQ:'1',PRDTNM:'최소 정보'}]));assert.equal(sparse.recalls[0].reason,null);assert.equal(sparse.recalls[0].expiryRaw,null);
});

test('FoodSafety local name/barcode filtering is limited to the requested range and never changes provider totals or next ranges',async()=>{
  const rows=[row(),{...row(),RTRVLDSUSE_SEQ:'2',PRDTNM:'다른 제품',BRCDNO:'000123'}],input={start:1,end:2,name:'시험'};
  const result=await execute(reply(rows,7),input);assert.equal(result.returnedCount,1);assert.equal(result.providerReturnedCount,2);assert.equal(result.pagination.providerTotalCount,7);assert.equal(result.pagination.matchingTotalCount,null);assert.deepEqual(result.pagination.nextRange,{start:3,end:4});
  const barcode=await execute(reply(rows,7),{start:1,end:2,barcode:'000123'});assert.equal(barcode.recalls[0].recallId,'2');
  const noMatch=await execute(reply(rows,7),{...input,barcode:'other'});assert.equal(noMatch.status,'no_data');assert.equal(noMatch.reason,'no_match_in_range');assert.equal(noMatch.providerReturnedCount,2);assert.equal(noMatch.pagination.providerTotalCount,7);assert(noMatch.message.includes('안전성'));
});

test('FoodSafety normalizes XML, single JSON rows and empty or past-end ranges without inventing recall absence',async()=>{
  const single=await execute(reply(row()));assert.equal(single.returnedCount,1);assert.equal((await execute(xml(row()))).recalls[0].recallId,row().RTRVLDSUSE_SEQ);
  const none=await execute(reply([],0));assert.equal(none.status,'no_data');assert.equal(none.pagination.providerTotalCount,0);assert.equal(none.pagination.nextRange,null);
  const past=await execute(reply([],3),{start:5,end:10});assert.equal(past.pagination.providerTotalCount,3);assert.equal(past.reason,'empty_provider_range');
  const providerEmpty=await execute(JSON.stringify({I0490:{total_count:'',RESULT:{CODE:'INFO-200'}}}));assert.equal(providerEmpty.pagination.providerTotalCount,null);
  const top=await execute('<RESULT><CODE>INFO-200</CODE></RESULT>');assert.equal(top.status,'no_data');
});

test('FoodSafety rejects inconsistent counts, duplicate or missing IDs, report mismatches and malformed XML/JSON/UTF-8',async()=>{
  for(const raw of [reply([row()],3),reply([row(),row()],2),reply([{...row(),RTRVLDSUSE_SEQ:'../other'}]),reply([{PRDTNM:'누락 ID'}]),reply([row()],1,'INFO-200'),reply([],7,'INFO-200'),'{}','{','<html>login</html>','<I0490><RESULT></I0490>','<!DOCTYPE I0490 [<!ENTITY x "boom">]><I0490/>',JSON.stringify({I0490:{total_count:0,RESULT:{CODE:'INFO-000'}},RESULT:{CODE:'INFO-100'}})])await assert.rejects(()=>execute(raw),hasCode('INVALID_RESPONSE'));
  await assert.rejects(()=>execute(reply(),{productReportNumber:'999'}),hasCode('INVALID_RESPONSE'));
  await assert.rejects(()=>foodsafetyExecutor(async()=>new Response(new Uint8Array([0xff])))(action,context().ctx),hasCode('INVALID_RESPONSE'));
});

test('FoodSafety maps current auth, quota, key contention, same-day readiness and seven-day window errors without leaking messages',async()=>{
  for(const code of ['INFO-100','INFO-110','INFO-120','INFO-310','INFO-400','INFO-600'])for(const body of [JSON.stringify({I0490:{RESULT:{CODE:code,MSG:secret}}}),`<RESULT><CODE>${code}</CODE><MSG>${secret}</MSG></RESULT>`])await assert.rejects(()=>execute(body),hasCode('AUTH_REQUIRED','awaiting_auth'));
  for(const[code,error]of [['INFO-300','PROVIDER_RATE_LIMIT'],['INFO-320','PROVIDER_RATE_LIMIT'],['INFO-330','PROVIDER_RATE_LIMIT'],['ERROR-503','PROVIDER_RATE_LIMIT'],['INFO-500','PROVIDER_BUSY'],['INFO-700','PROVIDER_DATA_NOT_READY'],['ERROR-303','PROVIDER_DATE_WINDOW'],['ERROR-302','PROVIDER_ERROR-302'],['ERROR-999','PROVIDER_ERROR-999']])await assert.rejects(()=>execute(JSON.stringify({I0490:{RESULT:{CODE:code,MSG:secret}}})),hasCode(error));
});

test('FoodSafety refuses sample or unsafe path credentials, handles HTTP/network failures and cancels before or during dispatch',async()=>{
  for(const key of ['', 'sample','SAMPLE','../secret-key','private%2fkey','key?x=foo','key#fragment','key\\segment','bad\nkey']){const run=context();run.ctx.secrets.apiKey=key;await assert.rejects(()=>foodsafetyExecutor()(action,run.ctx),hasCode('AUTH_REQUIRED','awaiting_auth'));assert.equal(run.dispatched(),0);}
  for(const[status,code,state]of [[401,'AUTH_REQUIRED','awaiting_auth'],[403,'AUTH_REQUIRED','awaiting_auth'],[429,'PROVIDER_RATE_LIMIT','failed'],[503,'PROVIDER_HTTP_503','failed']]as const)await assert.rejects(()=>foodsafetyExecutor(async()=>new Response(secret,{status}))(action,context().ctx),hasCode(code,state));
  await assert.rejects(()=>foodsafetyExecutor(async()=>{throw Error(`https://openapi.foodsafetykorea.go.kr/api/${secret}/I0490/json/1/10`);})(action,context().ctx),hasCode('PROVIDER_CONNECTION_ERROR'));
  await assert.rejects(()=>foodsafetyExecutor(async()=>{throw new DOMException(secret,'TimeoutError');})(action,context().ctx),hasCode('PROVIDER_TIMEOUT'));
  const before=new AbortController(),run=context({},before);before.abort();await assert.rejects(()=>foodsafetyExecutor()(action,run.ctx),hasCode('CANCELLED','cancelled'));assert.equal(run.dispatched(),0);
  const during=new AbortController();await assert.rejects(()=>foodsafetyExecutor(async()=>{during.abort();throw Error(secret);})(action,context({},during).ctx),hasCode('CANCELLED','cancelled'));
  await assert.rejects(()=>foodsafetyExecutor()({...action,id:'foodsafety.products.certify'},context().ctx),hasCode('NOT_IMPLEMENTED'));
});

test('FoodSafety cancels oversized streamed responses',async()=>{
  let cancelled=false;const stream=new ReadableStream<Uint8Array>({pull(c){c.enqueue(new Uint8Array(1_000_001));},cancel(){cancelled=true;}});
  await assert.rejects(()=>foodsafetyExecutor(async()=>new Response(stream))(action,context().ctx),hasCode('RESULT_TOO_LARGE'));assert.equal(cancelled,true);
});

test('FoodSafety HTTP scopes its account and actions, previews without key reads, deduplicates and resumes provider auth waits without support evidence',async()=>{
  let calls=0,denied=false;const r=await createRuntime({dataDir:tempDir('foodsafety-http'),port:0,vault:new TestVault(),evidenceMode:'mock',fetcher:async()=>{calls++;return new Response(denied?JSON.stringify({I0490:{RESULT:{CODE:'INFO-110',MSG:secret}}}):reply());}});
  try{
    const cookie=await runtimeLogin(r),api=(path:string,method='GET',body?:unknown,bearer?:string)=>runtimeApi(r,`/api${path}`,method,body,cookie,bearer?{Authorization:`Bearer ${bearer}`}:{ });
    const preview=await(await api(`/drafts/${action.id}/preview`,'POST',foodsafetyExample())).json();assert.equal(preview.networkDispatched,false);assert.equal(preview.request.authentication.pathParameter,'apiKey');assert(preview.request.endpoint.includes('{apiKey}'));assert.equal(calls,0);
    const request={actionId:action.id,input:{},accountId:'',idempotencyKey:randomUUID()};const wrong=await r.engine.saveAccount({label:'TourAPI 시험',credentialType:'tourapi-api',allowedActions:['tourapi.regions.list'],secrets:{serviceKey:secret}});request.accountId=wrong.id;assert.equal((await(await api('/jobs','POST',request)).json()).error.code,'ACCOUNT_REQUIRED');
    const account=await r.engine.saveAccount({label:'식품안전나라 시험',credentialType:'foodsafety-api',allowedActions:[action.id],secrets:{apiKey:secret}});request.accountId=account.id;const client=r.engine.createClient({name:'recall reader',allowedActions:[action.id],allowedAccountIds:[account.id]});
    for(const limits of [{allowedActions:[action.id],allowedAccountIds:[]},{allowedActions:['tourapi.regions.list'],allowedAccountIds:[account.id]}]){const blocked=r.engine.createClient({name:'blocked',...limits});assert.equal((await api('/jobs','POST',request,blocked.token)).status,403);}
    const response=await api('/jobs','POST',request,client.token);assert.equal(response.status,202);const job=await response.json();await r.engine.idle();const result=await(await api(`/jobs/${job.id}`,'GET',undefined,client.token)).json();assert.equal(result.state,'succeeded');assert.equal(result.result.contentTrust,'external_data');assert.equal(result.result.data.recalls[0].productSafety,null);assert(!JSON.stringify(result).includes(secret));
    const duplicate=await(await api('/jobs','POST',request,client.token)).json();await r.engine.idle();assert.equal(duplicate.id,job.id);assert.equal(calls,1);
    denied=true;const pending=await(await api('/jobs','POST',{...request,idempotencyKey:randomUUID()},client.token)).json();await r.engine.idle();assert.equal((await(await api(`/jobs/${pending.id}`,'GET',undefined,client.token)).json()).state,'awaiting_auth');denied=false;await api(`/jobs/${pending.id}/resume`,'POST',{},client.token);await r.engine.idle();assert.equal((await(await api(`/jobs/${pending.id}`,'GET',undefined,client.token)).json()).state,'succeeded');assert.equal(calls,3);assert.equal(r.engine.metrics().verifiedServices,0);assert.equal(r.engine.metrics().supportedActions,0);
  }finally{await r.close();}
});
