import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { createRuntime } from '../src/http.js';
import { admin } from '../src/core/engine.js';
import { TestVault,tempDir,providerMock,fakeSecrets } from './helpers.js';

test('second engine cannot recover or mutate the same active data directory',async()=>{
  const dataDir=tempDir('lock');const r=await createRuntime({dataDir,port:0,vault:new TestVault(),evidenceMode:'mock'});
  try{
    const job=r.engine.create(admin,{actionId:'browser.demo.publish',input:{title:'pending',content:'unchanged'},idempotencyKey:randomUUID()});
    await assert.rejects(()=>createRuntime({dataDir,port:0,vault:new TestVault()}),/이미 실행/);
    assert.equal(r.engine.get(admin,job.id).state,'pending_approval');
  }finally{await r.close();}
  const restarted=await createRuntime({dataDir,port:0,vault:new TestVault()});await restarted.close();
});

test('real-mode successful evidence can promote coverage, while suspension disables execution',async()=>{
  // A controlled transport stands in for the provider. This tests the evidence state machine,
  // not a claim that an external account was exercised in this test run.
  const mock=providerMock();const r=await createRuntime({dataDir:tempDir('evidence'),port:0,vault:new TestVault(),fetcher:mock.fetcher,evidenceMode:'live'});
  try{
    const a=await r.engine.saveAccount({label:'test',credentialType:'kakao-app',allowedActions:['kakao.map.places'],secrets:{restApiKey:fakeSecrets.restApiKey}});
    const request={actionId:'kakao.map.places',accountId:a.id,input:{query:'서울'},idempotencyKey:randomUUID()};const j=r.engine.create(admin,request);await r.engine.idle();
    assert.equal(r.engine.get(admin,j.id).state,'succeeded');assert.equal(r.engine.verification(r.engine.action(request.actionId)),'account_verified');r.engine.release(request.actionId);assert.equal(r.engine.metrics().supportedActions,1);
    await r.engine.suspend(request.actionId,true);assert.throws(()=>r.engine.create(admin,{...request,idempotencyKey:randomUUID()}),/중단/);
    await r.engine.suspend(request.actionId,false);assert.equal(r.engine.verification(r.engine.action(request.actionId)),'supported');
  }finally{await r.close();}
});
