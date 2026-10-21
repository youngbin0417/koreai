import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { champriceAction,champriceSchema,champriceExample,champriceRequestTemplate,champriceExecutor,normalizeChampriceCsv,champriceMaxBytes } from '../src/connectors/champrice.js';
import { ActionError,type ExecutionContext } from '../src/types.js';
import { admin } from '../src/core/engine.js';
import { createRuntime } from '../src/http.js';
import { TestVault,tempDir } from './helpers.js';
import { runtimeApi,runtimeLogin } from './mcp-oauth-fixture.js';
import { champriceMock,champriceCsv,champriceRow,champriceHeaders,champriceBytes } from './champrice-fixture.js';

const code=(name:string,state='failed')=>(e:unknown)=>e instanceof ActionError&&e.code===name&&e.state===state&&!e.message.includes('private-upstream-error');
const normalize=(text=champriceCsv(),input:unknown=champriceExample())=>normalizeChampriceCsv(champriceBytes(text),input);
function context(controller=new AbortController()){
  let sends=0;const stamp=new Date().toISOString();const ctx:ExecutionContext={job:{id:randomUUID(),clientId:'local-admin',actionId:champriceAction.id,input:champriceExample(),idempotencyKey:randomUUID(),requestHash:'unit',effect:'read',state:'running',revision:1,dispatched:false,createdAt:stamp,updatedAt:stamp,interventions:0,events:[]},secrets:{},signal:controller.signal,dispatch(){sends++;}};return{ctx,sends:()=>sends};
}
test('Champrice exposes a keyless monthly file with bounded local filters and no arbitrary URLs or remote query parameters',()=>{
  assert.equal(champriceAction.method,'public-data');assert.deepEqual(champriceAction.requiredSecrets,[]);assert.equal(champriceAction.credentialType,undefined);assert.equal(champriceAction.verification,'documented');assert(champriceSchema.safeParse(champriceExample()).success);
  for(const patch of [{productName:''},{productName:' '},{productName:'a\nb'},{productName:'a'.repeat(101)},{storeQuery:''},{manufacturer:''},{match:'cheapest'},{surveyDate:'2026-09-31'},{surveyDate:'2026-10-01'},{page:0},{page:10001},{limit:51},{limit:'10'},{serviceKey:'private'},{url:'https://evil.test'},{month:'2026-10'}])assert(!champriceSchema.safeParse({...champriceExample(),...patch}).success);
  const preview=champriceRequestTemplate({...champriceExample(),storeQuery:'서울'});assert.equal(preview.authentication.type,'none');assert.equal(preview.responseFormat,'csv');assert.equal(preview.snapshot.month,'2026-09');assert.equal(preview.localFilter.storeQuery,'서울');assert(!JSON.stringify(preview.query).includes('우유'));
});
test('Champrice detects real CP949 and UTF-8/BOM regardless of the HTTP charset and preserves price zero and unknown discounts',async()=>{
  const row=champriceRow();row[0]='시험 뷁 우유(1L)';row[2]='00000';const text=champriceCsv([row]);const data=normalize(text),item=data.prices[0]!;
  assert.equal(data.snapshot.encoding,'cp949');assert.equal(item.productNameRaw,row[0]);assert.equal(item.priceRaw,'00000');assert.equal(item.priceKrw,0);assert.equal(item.sale,null);assert.equal(item.saleRaw,null);assert.equal(item.onePlusOne,false);assert.equal(item.currentPriceKrw,null);assert.equal(item.inStock,null);assert.equal(item.unitPriceKrw,null);assert.equal(item.productIdentityVerified,false);assert.equal(data.snapshot.month,'2026-09');assert.deepEqual(data.snapshot.surveyDates,['2026-09-25']);assert.match(data.snapshot.sha256,/^[a-f0-9]{64}$/);assert(data.source.attribution.includes('2026년 9월'));
  assert.equal(normalizeChampriceCsv(new TextEncoder().encode('\uFEFF'+text),champriceExample()).snapshot.encoding,'utf-8');
  const mock=champriceMock(),result=await champriceExecutor(mock.fetcher)(champriceAction,context().ctx);assert.equal((result.data as any).snapshot.encoding,'cp949');
});
test('Champrice CSV supports quoted text, reordered reviewed headers and row references without inventing provider IDs',()=>{
  const row=champriceRow();row[0]='시험, "우유"\n(1L)';row[5]='Y';row[6]='';const data=normalize(champriceCsv([row,row]));assert.equal(data.prices[0]!.productNameRaw,row[0]);assert.equal(data.prices[0]!.sale,true);assert.equal(data.prices[0]!.onePlusOne,null);assert.equal(data.prices[0]!.sourceRow,1);assert.equal(data.prices[1]!.sourceRow,2);assert.equal(data.totalMatches,2);
  const reversed=normalize(champriceCsv([[...row].reverse()],[...champriceHeaders].reverse()));assert.equal(reversed.prices[0]!.priceKrw,2590);
});
test('Champrice scans all rows before reporting totals and paginates only product/store/manufacturer/date matches',()=>{
  const first=champriceRow(),second=champriceRow(),third=champriceRow(),fourth=champriceRow();second[0]='시험 우유(500mL)';third[1]='2026-09-11';fourth[3]='시험마트 다른점';
  const text=champriceCsv([first,second,third,fourth]),data=normalize(text,{productName:first[0],match:'exact',storeQuery:'서울',manufacturer:'시험제조사',surveyDate:'2026-09-25',limit:1});assert.equal(data.totalSourceRows,4);assert.equal(data.totalMatches,1);assert.equal(data.prices[0]!.sourceRow,1);assert.equal(data.pagination.hasMore,false);
  const page=normalize(text,{productName:'우유',page:2,limit:1});assert.equal(page.prices[0]!.sourceRow,2);assert.equal(page.totalMatches,4);assert.equal(page.pagination.nextPage,3);assert.deepEqual(page.snapshot.surveyDates,['2026-09-11','2026-09-25']);assert.equal(normalize(text,{productName:'없는상품'}).status,'no_data');assert.equal(normalize(text,{productName:'우유',page:5,limit:1}).status,'empty_page');
  const invalidLater=champriceRow();invalidLater[2]='bad';assert.throws(()=>normalize(champriceCsv([first,invalidLater]),{productName:'우유',limit:1}),code('INVALID_RESPONSE'));
});
test('Champrice rejects changed headers, malformed CSV, invalid dates/prices/flags and empty source rather than claiming no search results',()=>{
  for(const[index,value]of [[1,'2026-09-31'],[1,'2026-10-01'],[2,'-1'],[2,'2,590'],[2,'2.5'],[2,''],[5,'false'],[6,'unknown'],[0,''],[3,''],[4,'']] as const){const row=champriceRow();row[index]=value;assert.throws(()=>normalize(champriceCsv([row])),code('INVALID_RESPONSE'));}
  for(const text of ['<html>private-upstream-error</html>',champriceCsv().replace('판매업소','SORE_NAME'),champriceCsv().replace('제조사','상품명'),champriceCsv([[...champriceRow(),'extra']]),champriceCsv().replace('시험 우유(1L)','"unclosed'),champriceCsv().replace('시험 우유(1L)','x"bad'),champriceCsv().replace('시험 우유(1L)','"x"oops')])assert.throws(()=>normalize(text),code('INVALID_RESPONSE'));
  assert.throws(()=>normalize(champriceCsv([])),code('SOURCE_EMPTY','needs_review'));assert.throws(()=>normalizeChampriceCsv(new Uint8Array([0xff]),champriceExample()),code('INVALID_RESPONSE'));
});
test('Champrice enforces byte, row and field bounds before it can return an apparently complete match',()=>{
  assert.throws(()=>normalizeChampriceCsv(new Uint8Array(champriceMaxBytes+1),champriceExample()),code('RESULT_TOO_LARGE'));
  const row=champriceRow();row[0]='x'.repeat(2001);assert.throws(()=>normalize(champriceCsv([row])),code('RESULT_TOO_LARGE'));
  const record=champriceCsv().split('\r\n')[1]!+'\r\n';assert.throws(()=>normalize(champriceHeaders.join(',')+'\r\n'+record.repeat(300001),{productName:'우유',limit:1}),code('RESULT_TOO_LARGE'));
});
test('Champrice executor performs one fixed GET and keeps local search text and credentials out of the provider request',async()=>{
  const mock=champriceMock(),run=context(),result=await champriceExecutor(mock.fetcher)(champriceAction,run.ctx);assert.equal(run.sends(),1);assert.equal(mock.calls.length,1);assert(!mock.calls[0]!.href.includes(encodeURIComponent('우유')));assert.equal((result.data as any).returnedCount,1);
  const cancelled=new AbortController();cancelled.abort();await assert.rejects(()=>champriceExecutor(mock.fetcher)(champriceAction,context(cancelled).ctx),code('CANCELLED','cancelled'));await assert.rejects(()=>champriceExecutor(mock.fetcher)({...champriceAction,id:'other'},context().ctx),code('NOT_IMPLEMENTED'));assert.equal(mock.calls.length,1);
});
test('Champrice refuses HTML, quota and HTTP errors without body leakage or retries',async()=>{
  for(const[status,name]of [[403,'PROVIDER_HTTP_403'],[429,'PROVIDER_RATE_LIMIT'],[500,'PROVIDER_HTTP_500']] as const){const mock=champriceMock();mock.flags.status=status;await assert.rejects(()=>champriceExecutor(mock.fetcher)(champriceAction,context().ctx),code(name));assert.equal(mock.calls.length,1);}
  const mock=champriceMock();mock.flags.html=true;await assert.rejects(()=>champriceExecutor(mock.fetcher)(champriceAction,context().ctx),code('INVALID_RESPONSE'));assert.equal(mock.calls.length,1);
  await assert.rejects(()=>champriceExecutor(async()=>{throw Error('private-upstream-error');})(champriceAction,context().ctx),code('PROVIDER_UNAVAILABLE'));
});
test('Champrice rejects oversized or truncated streams and observes timeouts and in-flight cancellation',async()=>{
  const init={headers:{'Content-Type':'text/csv'}};
  await assert.rejects(()=>champriceExecutor(async()=>new Response(champriceCsv(),{headers:{...init.headers,'Content-Length':String(champriceMaxBytes+1)}}))(champriceAction,context().ctx),code('RESULT_TOO_LARGE'));
  await assert.rejects(()=>champriceExecutor(async()=>new Response(new Uint8Array(champriceMaxBytes+1),init))(champriceAction,context().ctx),code('RESULT_TOO_LARGE'));
  await assert.rejects(()=>champriceExecutor(async()=>new Response(champriceCsv(),{headers:{...init.headers,'Content-Length':'99999'}}))(champriceAction,context().ctx),code('INVALID_RESPONSE'));
  await assert.rejects(()=>champriceExecutor(async()=>{throw new DOMException('private-upstream-error','TimeoutError');})(champriceAction,context().ctx),code('PROVIDER_TIMEOUT'));
  const controller=new AbortController();let calls=0;await assert.rejects(()=>champriceExecutor(async()=>{calls++;controller.abort();throw Error('private-upstream-error');})(champriceAction,context(controller).ctx),code('CANCELLED','cancelled'));assert.equal(calls,1);
});
test('Champrice HTTP works without an account, enforces action scopes, previews locally and deduplicates without mock support evidence',async()=>{
  const mock=champriceMock(),r=await createRuntime({dataDir:tempDir('champrice-http'),port:0,vault:new TestVault(),evidenceMode:'mock',fetcher:mock.fetcher});
  try{
    const cookie=await runtimeLogin(r),api=(path:string,method='GET',body?:unknown,token?:string)=>runtimeApi(r,'/api'+path,method,body,cookie,token?{Authorization:`Bearer ${token}`}:{ });
    const preview=await(await api('/drafts/'+champriceAction.id+'/preview','POST',champriceExample())).json();assert.equal(preview.networkDispatched,false);assert.equal(preview.request.authentication.type,'none');assert.equal(mock.calls.length,0);
    const client=r.engine.createClient({name:'price reader',allowedActions:[champriceAction.id]}),blocked=r.engine.createClient({name:'unscoped reader',allowedActions:['animal-hospitals.search']}),request={actionId:champriceAction.id,input:champriceExample(),idempotencyKey:randomUUID()};assert.equal((await api('/jobs','POST',request,blocked.token)).status,403);
    const created=await(await api('/jobs','POST',request,client.token)).json();await r.engine.idle();const job=await(await api('/jobs/'+created.id,'GET',undefined,client.token)).json();assert.equal(job.state,'succeeded');assert.equal(job.result.contentTrust,'external_data');assert.equal(job.result.data.prices[0].sale,null);assert.equal(job.result.data.snapshot.month,'2026-09');assert.equal(job.accountId,undefined);assert(!job.events.some((e:any)=>e.state==='pending_approval'));await api('/jobs','POST',request,client.token);await r.engine.idle();assert.equal(mock.calls.length,1);
    assert.equal(r.engine.accounts().length,0);assert.equal(r.engine.metrics().verifiedServices,0);assert.equal(r.engine.metrics().supportedActions,0);assert.equal((await r.chats.create({allowedActions:[champriceAction.id]})).allowedActions[0],champriceAction.id);assert.equal(r.engine.get(admin,created.id).state,'succeeded');
    const state=await(await api('/state')).json();assert.equal(state.actions.filter((a:any)=>a.method==='public-data'&&a.implemented).length,2);assert.equal(state.actions.filter((a:any)=>a.method==='api'&&a.implemented&&!a.unavailable).length,46);
  }finally{await r.close();}
});
