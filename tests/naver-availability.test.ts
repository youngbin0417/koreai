import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { Engine, admin } from '../src/core/engine.js';
import { Store } from '../src/core/store.js';
import { officialActions, officialExecutor } from '../src/connectors/official.js';
import { naverBooksActions, naverBooksExecutor } from '../src/connectors/naver-books.js';
import { ActionError, type ClientRecord, type ExecutionContext } from '../src/types.js';
import { createRuntime } from '../src/http.js';
import { TestVault, tempDir } from './helpers.js';
import { runtimeApi, runtimeLogin } from './mcp-oauth-fixture.js';

const actions=[...officialActions,...naverBooksActions].filter(a=>a.unavailable);
const secrets={clientId:'legacy-test-id',clientSecret:'legacy-test-secret'};
const code=(expected:string)=>(error:unknown)=>error instanceof ActionError&&error.code===expected;
const expected=(id:string)=>actions.find(a=>a.id===id)!.unavailable!.kind==='retired'?'SERVICE_RETIRED':'PROVIDER_POLICY_RESTRICTED';

test('Naver provider metadata separates three retired actions and four AI-restricted searches from unaffected APIs',()=>{
  assert.equal(actions.length,7);assert.equal(actions.filter(a=>a.unavailable?.kind==='retired').length,3);
  assert(actions.every(a=>a.unavailable!.checkedAt==='2026-10-20'&&a.unavailable!.sourceUrl.startsWith('https://developers.naver.com/')));
  for(const id of ['naver.cafe.join','naver.cafe.publish','naver.calendar.create','kakao.map.places'])assert.equal(officialActions.find(a=>a.id===id)!.unavailable,undefined);
});

test('Naver executor guards refuse provider calls and dispatch even when invoked directly with old credentials',async()=>{
  let calls=0,dispatches=0;const fetcher:typeof fetch=async()=>{calls++;throw Error('must not call');};
  for(const action of actions){
    const ctx:ExecutionContext={job:{id:randomUUID(),clientId:'local-admin',actionId:action.id,input:{},idempotencyKey:randomUUID(),requestHash:'fixture',effect:'read',state:'running',revision:1,dispatched:false,createdAt:new Date().toISOString(),updatedAt:new Date().toISOString(),interventions:0,events:[]},secrets,signal:new AbortController().signal,dispatch(){dispatches++;}};
    await assert.rejects(()=>(naverBooksActions.some(a=>a.id===action.id)?naverBooksExecutor(fetcher):officialExecutor(fetcher))(action,ctx),code(expected(action.id)));
  }
  assert.equal(calls,0);assert.equal(dispatches,0);
});

test('old Naver accounts, clients, queued jobs, success evidence and release records cannot restore provider availability after restart',async()=>{
  const store=new Store(':memory:'),vault=new TestVault(),old=new Engine(store,vault,'mock');
  // Simulate the prior release without making any external request or live evidence claim.
  old.register(actions.map(a=>({...a,unavailable:undefined})),async(_a,ctx)=>{ctx.dispatch();return{data:{marker:'legacy-result-must-not-reach-agent'},evidence:'owned fixture'};});
  const account=await old.saveAccount({label:'legacy',credentialType:'naver-app',allowedActions:actions.map(a=>a.id),secrets});
  const client=old.createClient({name:'old agent',allowedActions:actions.map(a=>a.id),allowedAccountIds:[account.id]}),principal=old.authenticate(client.token)!;
  const request={actionId:actions[0]!.id,accountId:account.id,input:{query:'fixture'},idempotencyKey:randomUUID()};
  const completed=old.create(principal,request);await old.idle();const pending={...completed,id:randomUUID(),state:'queued' as const,idempotencyKey:randomUUID(),dispatched:false};store.insertJob(pending);
  store.put('evidence','old-success',{actionId:request.actionId,kind:'live',outcome:'passed',connectorVersion:actions[0]!.version});store.put('released',request.actionId,{version:actions[0]!.version});
  await old.close();const engine=new Engine(store,vault,'mock');let calls=0;engine.register(actions,async()=>{calls++;throw Error('must not call');});
  try{
    assert.equal(engine.discover(principal).length,0);assert(engine.discover(admin).every(a=>!a.enabled&&a.verification==='suspended'&&a.accountIds.length===0&&a.disabledReason===a.unavailable!.reason));
    assert.equal(engine.metrics().verifiedServices,0);assert.equal(engine.metrics().supportedActions,0);assert.equal(engine.get(admin,pending.id).state,'awaiting_user');
    assert.throws(()=>engine.resume(principal,pending.id),code(expected(request.actionId)));
    assert.equal((engine.get(principal,completed.id).result),undefined);assert(!JSON.stringify(engine.jobs(principal)).includes('legacy-result-must-not-reach-agent'));assert(JSON.stringify(engine.get(admin,completed.id)).includes('legacy-result-must-not-reach-agent'));
    for(const action of actions){
      assert.throws(()=>engine.create(principal,{...request,actionId:action.id,idempotencyKey:randomUUID()}),code(expected(action.id)));
      assert.throws(()=>engine.createClient({name:'new',allowedActions:[action.id]}),code(expected(action.id)));
      await assert.rejects(()=>engine.saveAccount({id:account.id,label:'legacy',credentialType:'naver-app',allowedActions:[action.id]}),code(expected(action.id)));
      await assert.rejects(()=>engine.suspend(action.id,false),code(expected(action.id)));assert.throws(()=>engine.release(action.id),code('LIVE_EVIDENCE_REQUIRED'));
    }
    assert.equal(calls,0);assert.equal(engine.accounts()[0]!.allowedActions.length,7);assert.equal(store.list('evidence').length,2);
  }finally{await engine.close();store.close();}
});

test('HTTP hides restricted actions from legacy agent discovery and rejects grant, chat and execution requests without external traffic',async()=>{
  let calls=0;const r=await createRuntime({dataDir:tempDir('naver-availability-http'),port:0,vault:new TestVault(),fetcher:async()=>{calls++;throw Error('must not call');},aiFetcher:async()=>{calls++;throw Error('must not call');}});
  try{
    const cookie=await runtimeLogin(r),client=r.engine.createClient({name:'legacy',allowedActions:['browser.demo.read']});
    const stored=r.store.get<ClientRecord>('client',client.id)!;r.store.put('client',client.id,{...stored,allowedActions:actions.map(a=>a.id)});
    const api=(path:string,method='GET',body?:unknown,agent=false)=>runtimeApi(r,'/api'+path,method,body,cookie,agent?{Authorization:`Bearer ${client.token}`}:{ });
    assert.equal((await(await api('/actions','GET',undefined,true)).json()).length,0);
    const state=await(await api('/state')).json(),active=state.actions.filter((a:any)=>a.method==='api'&&a.implemented&&!a.unavailable);assert.equal(active.length,48);assert.equal(new Set(active.map((a:any)=>a.connectorId)).size,27);
    for(const action of actions){
      const response=await api('/jobs','POST',{actionId:action.id,input:{},idempotencyKey:randomUUID()},true);assert.equal(response.status,409);assert.equal((await response.json()).error.code,expected(action.id));
      const grant=await api('/clients','POST',{name:'blocked',allowedActions:[action.id]});assert.equal(grant.status,409);
      await assert.rejects(()=>r.chats.create({allowedActions:[action.id]}),code('INVALID_GRANT'));
    }
    const account=await api('/accounts','POST',{label:'blocked',credentialType:'naver-app',allowedActions:['naver.search.news'],secrets});assert.equal(account.status,409);assert.equal(r.engine.jobs().length,0);assert.equal(calls,0);
  }finally{await r.close();}
});

test('old conversations with Naver results cannot replay their protocol to DeepSeek and retain local history',async()=>{
  let modelCalls=0;const r=await createRuntime({dataDir:tempDir('naver-old-chat'),port:0,vault:new TestVault(),aiFetcher:async()=>{modelCalls++;throw Error('must not call');}});
  try{
    const chat=await r.chats.create({title:'legacy'}),record=r.store.get<any>('chat',chat.id)!;
    r.store.put('chat',chat.id,{...record,allowedActions:['naver.search.news'],protocol:[...record.protocol,{role:'assistant',content:'legacy-search-result'}]});
    assert.throws(()=>r.chats.submit(chat.id,{requestId:randomUUID(),content:'이어서 정리해줘'}),code('CHAT_ACTION_UNAVAILABLE'));
    assert.equal(modelCalls,0);assert.equal(r.store.get<any>('chat',chat.id).protocol.at(-1).content,'legacy-search-result');
  }finally{await r.close();}
});
