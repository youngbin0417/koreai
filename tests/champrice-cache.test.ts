import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { readdir,readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { z } from 'zod';
import { createRuntime } from '../src/http.js';
import { champriceAction,champriceExample,champriceSchema,champriceSnapshots,champriceRequestTemplate,normalizeChampriceCsv } from '../src/connectors/champrice.js';
import { Engine, admin } from '../src/core/engine.js';
import { Store } from '../src/core/store.js';
import { TestVault,tempDir } from './helpers.js';
import { runtimeApi,runtimeLogin } from './mcp-oauth-fixture.js';
import { champriceMock,champriceBytes,champriceCsv,champriceRow } from './champrice-fixture.js';

test('Champrice selects only reviewed months, retains the September default and rejects mismatched input or source months',()=>{
  assert.deepEqual(champriceSnapshots.map(s=>s.month),['2026-08','2026-09']);assert.equal(champriceRequestTemplate({productName:'우유'}).snapshot.month,'2026-09');assert.equal(champriceAction.version,'0.2.0');
  const august=champriceExample('2026-08');assert.equal(august.surveyDate,'2026-08-28');assert(champriceSchema.safeParse(august).success);assert(!champriceSchema.safeParse({...august,surveyDate:'2026-09-25'}).success);assert(!champriceSchema.safeParse({...august,month:'2026-07'}).success);
  const preview=champriceRequestTemplate(august);assert.equal(preview.query.atchFileId,'FILE_000000007654112');assert.equal(preview.availableSnapshots.length,2);assert.equal(preview.snapshot.publishedOn,'2026-09-07');
  const bytes=champriceBytes(champriceCsv([champriceRow('2026-08')]));const data=normalizeChampriceCsv(bytes,august);assert.equal(data.snapshot.month,'2026-08');assert(data.source.attribution.includes('2026년 8월'));assert.throws(()=>normalizeChampriceCsv(bytes,champriceExample()),(e:any)=>e.code==='INVALID_RESPONSE');
});
test('legacy September idempotent requests keep the same job and hash across the monthly connector upgrade',async()=>{
  const store=new Store(join(tempDir('champrice-legacy'),'legacy.sqlite')),vault=new TestVault(),legacy=new Engine(store,vault,'mock');
  const oldSchema=z.object({productName:z.string(),match:z.enum(['contains','exact']).default('contains'),manufacturer:z.string().optional(),storeQuery:z.string().optional(),surveyDate:z.string().optional(),page:z.number().default(1),limit:z.number().default(10)}).strict();
  legacy.register([{...champriceAction,version:'0.1.0',schema:oldSchema}],async()=>({data:{marker:'old result'},evidence:'legacy mock'}));
  const request={actionId:champriceAction.id,input:{productName:'우유',surveyDate:'2026-09-25'},idempotencyKey:randomUUID()},old=legacy.create(admin,request);await legacy.idle();await legacy.close();
  const upgraded=new Engine(store,vault,'mock');let calls=0;upgraded.register([champriceAction],async()=>{calls++;throw Error('must not execute');});
  try{
    for(const input of [request.input,{...request.input,month:'2026-09'}]){const same=upgraded.create(admin,{...request,input});assert.equal(same.id,old.id);assert.equal(same.requestHash,old.requestHash);assert.equal((same.result as any).data.marker,'old result');}
    assert.throws(()=>upgraded.create(admin,{...request,input:{...request.input,month:'2026-08',surveyDate:'2026-08-28'}}),(e:any)=>e.code==='IDEMPOTENCY_CONFLICT');assert.equal(calls,0);
  }finally{await upgraded.close();store.close();}
});
test('Champrice HTTP reuses a verified file for new queries and months stay separate',async()=>{
  const dir=tempDir('champrice-cache-http'),mock=champriceMock(),r=await createRuntime({dataDir:dir,port:0,vault:new TestVault(),evidenceMode:'mock',fetcher:mock.fetcher});
  try{
    const cookie=await runtimeLogin(r),api=(path:string,method='GET',body?:unknown)=>runtimeApi(r,'/api'+path,method,body,cookie);
    const run=async(input:unknown)=>{const response=await api('/jobs','POST',{actionId:champriceAction.id,input,idempotencyKey:randomUUID()});assert.equal(response.status,202);const id=(await response.json()).id;await r.engine.idle();return(await api('/jobs/'+id)).json();};
    const preview=await(await api('/drafts/'+champriceAction.id+'/preview','POST',champriceExample('2026-08'))).json();assert.equal(preview.networkDispatched,false);assert.equal(mock.calls.length,0);
    const first=await run(champriceExample('2026-08'));assert.equal(first.state,'succeeded');assert.equal(first.result.data.cache.status,'downloaded');assert.equal(first.dispatched,true);
    const cached=await run({...champriceExample('2026-08'),productName:'private-query-marker'});assert.equal(cached.result.data.status,'no_data');assert.equal(cached.result.data.cache.status,'hit');assert.equal(cached.dispatched,false);assert.equal(cached.result.data.retrievedAt,first.result.data.retrievedAt);assert(Date.parse(cached.result.data.queriedAt)>=Date.parse(first.result.data.queriedAt));assert.equal(mock.calls.length,1);
    const otherMonth=await run(champriceExample());assert.equal(otherMonth.result.data.snapshot.month,'2026-09');assert.equal(otherMonth.result.data.cache.status,'downloaded');assert.equal(mock.calls.length,2);
    const cacheDir=join(dir,'champrice-cache-mock');for(const name of await readdir(cacheDir))assert(!(await readFile(join(cacheDir,name))).includes(Buffer.from('private-query-marker')));assert.equal(r.engine.metrics().verifiedServices,0);
  }finally{await r.close();}
});
test('Champrice cache survives runtime restart and mock files cannot become live input',async()=>{
  const dir=tempDir('champrice-cache-restart'),vault=new TestVault(),mock=champriceMock();let runtime=await createRuntime({dataDir:dir,port:0,vault,evidenceMode:'mock',fetcher:mock.fetcher});
  const run=async()=>{const job=runtime.engine.create(admin,{actionId:champriceAction.id,input:champriceExample(),idempotencyKey:randomUUID()});await runtime.engine.idle();return runtime.engine.get(admin,job.id);};
  try{
    assert.equal((await run()).state,'succeeded');await runtime.close();runtime=await createRuntime({dataDir:dir,port:0,vault,evidenceMode:'mock',fetcher:mock.fetcher});const cached=await run();assert.equal((cached.result as any).data.cache.status,'hit');assert.equal(mock.calls.length,1);
    await runtime.close();mock.flags.status=403;runtime=await createRuntime({dataDir:dir,port:0,vault,fetcher:mock.fetcher});const live=await run();assert.equal(live.state,'failed');assert.equal(live.error?.code,'PROVIDER_HTTP_403');assert.equal(mock.calls.length,2);assert.equal(runtime.engine.metrics().verifiedServices,0);
  }finally{await runtime.close();}
});
test('Champrice never caches a malformed, empty or wrong-month download',async()=>{
  const dir=tempDir('champrice-invalid-cache'),mock=champriceMock(),r=await createRuntime({dataDir:dir,port:0,vault:new TestVault(),evidenceMode:'mock',fetcher:mock.fetcher});
  try{
    for(const text of [champriceCsv([]),champriceCsv([champriceRow('2026-08')]),'broken']){mock.flags.text=text;const job=r.engine.create(admin,{actionId:champriceAction.id,input:champriceExample(),idempotencyKey:randomUUID()});await r.engine.idle();assert.notEqual(r.engine.get(admin,job.id).state,'succeeded');assert.deepEqual(await readdir(join(dir,'champrice-cache-mock')),[]);}
    mock.flags.text=null;const job=r.engine.create(admin,{actionId:champriceAction.id,input:champriceExample(),idempotencyKey:randomUUID()});await r.engine.idle();assert.equal(r.engine.get(admin,job.id).state,'succeeded');assert.equal(mock.calls.length,4);
  }finally{await r.close();}
});
