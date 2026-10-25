import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { tlockerInventoryAction as action,tlockerInventorySchema as schema,tlockerInventoryExample as example,tlockerInventoryRequestTemplate,normalizeTlockerInventory,tlockerInventoryExecutor,tlockerInventoryMaxBytes } from '../src/connectors/tlocker-inventory.js';
import { tlockerInventorySnapshot } from '../src/research/tlocker-inventory.js';
import { TlockerInventoryResult,tlockerInventoryInputState } from '../ui/TlockerInventory.js';
import { createRuntime } from '../src/http.js';
import { admin } from '../src/core/engine.js';
import { ActionError,type ExecutionContext } from '../src/types.js';
import { runtimeApi,runtimeLogin } from './mcp-oauth-fixture.js';
import { TestVault,tempDir } from './helpers.js';
import { lockerBytes,lockerCsv,lockerRows,lockerHeaders,lockerMock } from './tlocker-inventory-fixture.js';

const normalize=(text=lockerCsv(),input:unknown=example())=>normalizeTlockerInventory(lockerBytes(text),input);
const code=(name:string,state='failed')=>(e:unknown)=>e instanceof ActionError&&e.code===name&&e.state===state&&!e.message.includes('private-upstream-error');
function context(controller=new AbortController()){
  let sends=0;const now=new Date().toISOString();const ctx:ExecutionContext={job:{id:randomUUID(),clientId:'local-admin',actionId:action.id,input:example(),idempotencyKey:randomUUID(),requestHash:'unit',effect:'read',state:'running',revision:1,dispatched:false,createdAt:now,updatedAt:now,interventions:0,events:[]},secrets:{},signal:controller.signal,dispatch(){sends++;}};return{ctx,sends:()=>sends};
}

test('locker inventory is keyless and accepts only bounded local filters, never URLs or credentials',()=>{
  assert.equal(action.method,'public-data');assert.deepEqual(action.requiredSecrets,[]);assert.equal(action.credentialType,undefined);assert.equal(action.verification,'documented');
  for(const patch of [{query:''},{query:' '},{query:'a\nb'},{query:'a'.repeat(81)},{line:'10'},{size:'available'},{limit:51},{page:0},{page:1001},{limit:'10'},{url:'https://evil.test'},{apiKey:'private'},{asOf:'2027-01-01'}]){assert(!schema.safeParse({...example(),...patch}).success);assert(tlockerInventoryInputState(JSON.stringify({...example(),...patch})).error);}
  assert.equal(tlockerInventoryInputState(JSON.stringify(example())).error,null);const request=tlockerInventoryRequestTemplate({...example(),line:'1',size:'large'});assert.equal(request.authentication.type,'none');assert.deepEqual(request.query,tlockerInventorySnapshot.query);assert.equal(request.localFilter.line,'1');assert(!JSON.stringify(request.query).includes('서울'));
});

test('locker inventory decodes CP949 despite UTF8 HTTP claims, preserves zero and raw labels, and never invents live availability',()=>{
  const data=normalize(),first=data.rows[0]!;assert.equal(data.file.encoding,'cp949');assert.equal(data.file.sourceRows,4);assert.equal(data.pagination.total,3);assert.equal(first.lockerNameRaw,'서울역1~22');assert.equal(first.installedTotal,22);assert.equal(data.rows[1]!.installedTotal,16);assert.equal((data.rows[1]!.installed as any).large,0);
  for(const row of data.rows)for(const field of ['availableCount','providerObservedAt','locationDetail','operatorLockerId'])assert.equal(row[field],null);
  assert.equal(data.snapshot.matchesReviewedFile,false);assert.equal(data.snapshot.asOf,null);assert.equal(data.snapshot.declaredAsOf,'2026-09-30');assert.match(data.file.sha256,/^[a-f0-9]{64}$/);
  assert.equal(normalizeTlockerInventory(new TextEncoder().encode('\uFEFF'+lockerCsv()),example()).file.encoding,'utf-8');
  const row=[...lockerRows[0]!];row[2]='서울, "보관함"';const quoted=normalize(lockerCsv([row]));assert.equal(quoted.rows[0]!.lockerNameRaw,row[2]);assert.equal(normalize(lockerCsv([[...row].reverse()],[...lockerHeaders].reverse())).rows[0]!.lockerNameRaw,row[2]);
});

test('locker filters and pages scan the entire file including later invalid rows',()=>{
  const input={query:'서울',line:'1',size:'large',limit:1};const data=normalize(lockerCsv(),input);assert.equal(data.pagination.total,1);assert.equal(data.pagination.nextPage,null);
  const page=normalize(lockerCsv(),{query:'서울',page:2,limit:1});assert.equal(page.rows[0]!.sourceSerial,'2');assert.equal(page.pagination.nextPage,3);assert.equal(page.pagination.total,3);
  assert.equal(normalize(lockerCsv(),{query:'서울',page:4,limit:1}).status,'empty_page');assert.equal(normalize(lockerCsv(),{query:'없는역'}).status,'no_data');assert.equal(normalize(lockerCsv(),{query:'식물원',line:'식물원'}).rows[0]!.lineRaw,'식물원');
  const bad=[...lockerRows[1]!];bad[4]='-1';assert.throws(()=>normalize(lockerCsv([lockerRows[0]!,bad]),input),code('INVALID_RESPONSE'));
});

test('locker CSV rejects schema drift, duplicates, missing or invalid counts, malformed and oversized files',()=>{
  for(const[index,value]of [[0,'0'],[0,'x'],[1,'10'],[2,''],[2,'서울\n역'],[3,''],[3,'-1'],[4,'1.5'],[5,'1000000'],[6,'NaN']] as const){const row=[...lockerRows[0]!];row[index]=value;assert.throws(()=>normalize(lockerCsv([row])),code('INVALID_RESPONSE'));}
  const duplicate=[...lockerRows[1]!];duplicate[0]='01';const duplicateName=[...lockerRows[0]!];duplicateName[0]='5';
  for(const text of [lockerCsv([]),lockerCsv([lockerRows[0]!,duplicate]),lockerCsv([lockerRows[0]!,duplicateName]),lockerCsv().replace('보관함명','역명'),lockerCsv().replace('소형','중형'),'<html>private-upstream-error</html>',lockerCsv().replace('서울역1~22','"unclosed'),lockerCsv().replace('서울역1~22','"x"oops'),lockerCsv([[...lockerRows[0]!,'extra']])])assert.throws(()=>normalize(text),code('INVALID_RESPONSE'));
  assert.throws(()=>normalizeTlockerInventory(new Uint8Array([0xff]),example()),code('INVALID_RESPONSE'));assert.throws(()=>normalizeTlockerInventory(new Uint8Array(tlockerInventoryMaxBytes+1),example()),code('RESULT_TOO_LARGE'));
  const long=[...lockerRows[0]!];long[2]='x'.repeat(301);assert.throws(()=>normalize(lockerCsv([long])),code('RESULT_TOO_LARGE'));
});

test('locker download refuses upstream errors, HTML, oversize and truncation without leaks or retries',async()=>{
  for(const[status,error]of [[401,'PROVIDER_HTTP_401'],[403,'PROVIDER_HTTP_403'],[429,'PROVIDER_RATE_LIMIT'],[500,'PROVIDER_HTTP_500']] as const){const mock=lockerMock();mock.flags.status=status;await assert.rejects(()=>tlockerInventoryExecutor(mock.fetcher)(action,context().ctx),code(error));assert.equal(mock.calls.length,1);}
  const mock=lockerMock();mock.flags.html=true;await assert.rejects(()=>tlockerInventoryExecutor(mock.fetcher)(action,context().ctx),code('INVALID_RESPONSE'));
  for(const[body,headers,error]of [[lockerBytes(),{'Content-Length':String(tlockerInventoryMaxBytes+1)},'RESULT_TOO_LARGE'],[new Uint8Array(tlockerInventoryMaxBytes+1),{},'RESULT_TOO_LARGE'],[lockerBytes(),{'Content-Length':'99999'},'INVALID_RESPONSE']] as const){await assert.rejects(()=>tlockerInventoryExecutor(async()=>new Response(new Uint8Array(body),{headers:{'Content-Type':'text/csv',...headers}}))(action,context().ctx),code(error));}
  await assert.rejects(()=>tlockerInventoryExecutor(async()=>{throw Error('private-upstream-error');})(action,context().ctx),code('PROVIDER_UNAVAILABLE'));
  await assert.rejects(()=>tlockerInventoryExecutor(async()=>{throw new DOMException('private-upstream-error','TimeoutError');})(action,context().ctx),code('PROVIDER_TIMEOUT'));
  const controller=new AbortController();controller.abort();await assert.rejects(()=>tlockerInventoryExecutor(mock.fetcher)(action,context(controller).ctx),code('CANCELLED','cancelled'));
});

test('locker HTTP scopes, keyless preview, deduplication, cache pagination and restart preserve evidence boundaries',async()=>{
  const mock=lockerMock(),dataDir=tempDir('locker-inventory');let r=await createRuntime({dataDir,port:0,vault:new TestVault(),evidenceMode:'mock',fetcher:mock.fetcher});
  try{
    const cookie=await runtimeLogin(r),preview=await(await runtimeApi(r,'/api/drafts/'+action.id+'/preview','POST',example(),cookie)).json();assert.equal(preview.networkDispatched,false);assert.equal(mock.calls.length,0);
    const reader=r.engine.createClient({name:'locker reader',allowedActions:[action.id]}),blocked=r.engine.createClient({name:'other reader',allowedActions:['animal-hospitals.search']}),request={actionId:action.id,input:{query:'서울',limit:1},idempotencyKey:randomUUID()};
    assert.equal((await runtimeApi(r,'/api/jobs','POST',request,cookie,{Authorization:'Bearer '+blocked.token})).status,403);
    const response=await runtimeApi(r,'/api/jobs','POST',request,cookie,{Authorization:'Bearer '+reader.token});assert.equal(response.status,202);const created=await response.json();await r.engine.idle();const first=r.engine.get(admin,created.id);assert.equal(first.state,'succeeded');assert.equal(first.accountId,undefined);assert.equal(first.dispatched,true);assert.equal((first.result as any).contentTrust,'external_data');assert.equal(((first.result as any).data as any).cache.status,'downloaded');assert.equal(((first.result as any).data as any).snapshot.asOf,null);
    const repeated=await(await runtimeApi(r,'/api/jobs','POST',request,cookie,{Authorization:'Bearer '+reader.token})).json();assert.equal(repeated.id,created.id);
    const second=r.engine.create(admin,{...request,input:{...request.input,page:2},idempotencyKey:randomUUID()});await r.engine.idle();const cached=r.engine.get(admin,second.id);assert.equal(cached.state,'succeeded');assert.equal(cached.dispatched,false);assert.equal(((cached.result as any).data as any).cache.status,'hit');assert.equal(((cached.result as any).data as any).rows[0].sourceSerial,'2');assert.equal(mock.calls.length,1);assert.equal(r.engine.accounts().length,0);assert.equal(r.engine.metrics().supportedActions,0);assert.equal(r.engine.metrics().verifiedServices,0);
    assert.throws(()=>r.engine.create(admin,{actionId:'tlocker.availability',input:{stationName:'서울'},idempotencyKey:randomUUID()}),code('NOT_IMPLEMENTED'));await r.close();
    r=await createRuntime({dataDir,port:0,vault:new TestVault(),evidenceMode:'mock',fetcher:mock.fetcher});const third=r.engine.create(admin,{...request,input:{query:'식물원'},idempotencyKey:randomUUID()});await r.engine.idle();assert.equal(((r.engine.get(admin,third.id).result as any).data as any).cache.status,'hit');assert.equal(mock.calls.length,1);
  }finally{await r.close();}
});

test('invalid downloads never populate the cache or turn failures into an empty successful inventory',async()=>{
  const mock=lockerMock();mock.flags.body='<html>private-upstream-error</html>';const r=await createRuntime({dataDir:tempDir('locker-invalid'),port:0,vault:new TestVault(),evidenceMode:'mock',fetcher:mock.fetcher});try{
    const make=()=>r.engine.create(admin,{actionId:action.id,input:example(),idempotencyKey:randomUUID()});const first=make();await r.engine.idle();assert.equal(r.engine.get(admin,first.id).state,'failed');assert.equal(r.engine.get(admin,first.id).error?.code,'INVALID_RESPONSE');mock.flags.body=lockerCsv();const second=make();await r.engine.idle();assert.equal(r.engine.get(admin,second.id).state,'succeeded');assert.equal(mock.calls.length,2);
  }finally{await r.close();}
});

test('locker cards escape external text, preserve unknown live status and fixed links, and fall back for invalid old results',()=>{
  const row=[...lockerRows[0]!];row[2]='서울 <script>alert(1)</script>';const data=normalize(lockerCsv([row]));const result={contentTrust:'external_data',data},render=(value:unknown)=>renderToStaticMarkup(createElement(TlockerInventoryResult,{result:value,busy:false,onPage:()=>{}})),html=render(result);
  for(const text of ['&lt;script&gt;','현재 빈칸','미확인','층·출구','자료 미제공','기준일을 확인할 수 없습니다','기록 없음','io.mobinity.locker'])assert(html.includes(text),text);assert(!html.includes('<script>'));
  assert(render({...result,data:{...data,rows:[{...data.rows[0],availableCount:0}]}}).includes('카드로 표시할 수 없는 결과'));assert(render({data:{old:true}}).includes('JSON 상세'));
});
