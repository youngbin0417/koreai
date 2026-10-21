import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { createRuntime } from '../src/http.js';
import { admin } from '../src/core/engine.js';
import { ActionError } from '../src/types.js';
import { TestVault,tempDir } from './helpers.js';
import { tlockerAvailabilityAction as action,tlockerAvailabilityInput,tlockerAvailabilityOutput } from '../src/connectors/lifestyle/tlocker-read.js';
import { tlocker } from '../src/connectors/lifestyle/tlocker.js';
import { runtimeLogin,runtimeApi } from './mcp-oauth-fixture.js';

test('T locker availability is a disabled proposal with no credentials and explicit missing/stale observation boundaries',()=>{
  assert.equal(action.implemented,false);assert.equal(action.method,'partnership');assert.deepEqual(action.requiredSecrets,[]);assert.equal(tlocker.firstRead?.actionId,action.id);assert(tlocker.routes.some(route=>route.url.includes('io.mobinity.locker')));assert(tlocker.routes.some(route=>route.id==='inventory'));
  assert(tlockerAvailabilityInput.safeParse({stationName:'서울',size:'large'}).success);for(const input of [{stationName:''},{stationName:'서울',size:'huge'},{stationName:'서울',cookie:'secret'}])assert(!tlockerAvailabilityInput.safeParse(input).success);
  const locker={providerId:'ST001',location:'역 지하1층',size:'large',installedCount:10,availableCount:null,status:'unknown'},value={stationName:'서울',observedAt:null,retrievedAt:new Date().toISOString(),lockers:[locker]};assert(tlockerAvailabilityOutput.safeParse(value).success);assert(!tlockerAvailabilityOutput.safeParse({...value,lockers:[{...locker,availableCount:0}]}).success);assert(tlockerAvailabilityOutput.safeParse({...value,observedAt:value.retrievedAt,lockers:[{...locker,availableCount:0,status:'reported'}]}).success);assert(!tlockerAvailabilityOutput.safeParse({...value,observedAt:value.retrievedAt,lockers:[{...locker,availableCount:11,status:'reported'}]}).success);assert(!tlockerAvailabilityOutput.safeParse({...value,lockers:[locker,locker]}).success);
});

test('T locker foundation opens only fixed official routes and never dispatches availability or claims support',async()=>{
  let calls=0;const r=await createRuntime({dataDir:tempDir('tlocker-foundation'),port:0,vault:new TestVault(),evidenceMode:'mock',fetcher:async()=>{calls++;throw Error('must not dispatch');}});try{
    const cookie=await runtimeLogin(r),state=await(await runtimeApi(r,'/api/state','GET',undefined,cookie)).json(),connection=state.connections.find((entry:any)=>entry.serviceId==='tlocker');assert.equal(connection.automaticActions,0);assert.equal(connection.accountVerified,false);assert.equal(connection.firstRead?.state,'defined');
    assert.throws(()=>r.engine.create(admin,{actionId:action.id,input:{stationName:'서울'},idempotencyKey:randomUUID()}),(e:unknown)=>e instanceof ActionError&&e.code==='NOT_IMPLEMENTED');
    await runtimeApi(r,'/api/connections/tlocker','PUT',{routeId:'consumer'},cookie);const job=r.engine.create(admin,{actionId:'tlocker.connection.open',input:{},idempotencyKey:randomUUID()});await r.engine.idle();const result=r.engine.get(admin,job.id);assert.equal(result.state,'succeeded');assert.equal(result.dispatched,false);assert.equal((result.result as any).data.externalActionExecuted,false);assert.equal(calls,0);assert.equal(r.engine.metrics().supportedActions,0);
  }finally{await r.close();}
});
