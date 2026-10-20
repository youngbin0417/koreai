import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { tmapAction,tmapSchema,tmapExample,tmapRequestTemplate,tmapExecutor,normalizeTmapResponse,tmapResultTtlMs } from '../src/connectors/tmap.js';
import { ActionError,type ExecutionContext } from '../src/types.js';
import { Engine,admin } from '../src/core/engine.js';
import { createRuntime } from '../src/http.js';
import { TestVault,tempDir } from './helpers.js';
import { runtimeApi,runtimeLogin } from './mcp-oauth-fixture.js';
import { tmapMock,tmapPayload,tmapSecret } from './tmap-fixture.js';

const code=(name:string,state='failed')=>(error:unknown)=>error instanceof ActionError&&error.code===name&&error.state===state&&!error.message.includes(tmapSecret);
function context(controller=new AbortController()){let sends=0;const stamp=new Date().toISOString();const ctx:ExecutionContext={job:{id:randomUUID(),clientId:'local-admin',actionId:tmapAction.id,input:tmapExample(),idempotencyKey:randomUUID(),requestHash:'unit',effect:'read',state:'running',revision:1,dispatched:false,createdAt:stamp,updatedAt:stamp,interventions:0,events:[]},secrets:{appKey:tmapSecret},signal:controller.signal,dispatch(){sends++;}};return{ctx,sends:()=>sends};}

test('TMAP bounds domestic WGS84 endpoints and reviewed preferences, rejecting reversed axes, equal points and arbitrary provider parameters',()=>{
  assert.equal(tmapAction.effect,'read');assert.equal(tmapAction.resultTtlMs,tmapResultTtlMs);assert(tmapSchema.safeParse(tmapExample()).success);
  for(const patch of [{start:{longitude:37.5,latitude:127}},{end:{longitude:127,latitude:40}},{end:tmapExample().start},{appKey:'private'},{url:'https://elsewhere.test'},{preference:'truck'},{departureTime:'tomorrow'},{passList:'1,2'}])assert(!tmapSchema.safeParse({...tmapExample(),...patch}).success);
  assert(!tmapSchema.safeParse({...tmapExample(),start:{longitude:'126.98',latitude:37.5}}).success);
});
test('TMAP preview fixes v1, appKey header, form encoding, passenger car and summary-only response without a secret or callback',()=>{
  for(const[preference,option]of [['recommended',0],['avoid_tolls',1],['fastest',2]] as const){const preview=tmapRequestTemplate({...tmapExample(),preference});assert.equal(preview.method,'POST');assert.deepEqual(preview.query,{version:'1'});assert.equal(preview.authentication.headers.appKey.secretField,'appKey');assert.equal(preview.body.searchOption,option);assert.equal(preview.body.totalValue,2);assert.equal(preview.body.carType,0);assert(!JSON.stringify(preview).includes(tmapSecret));}
});
test('TMAP summary preserves metres, seconds, zero and absent fares with attribution and unknown provider identity/time',()=>{
  const data=normalizeTmapResponse(JSON.stringify(tmapPayload({taxiFare:null})),tmapExample());assert.equal(data.distanceMetres,12500);assert.equal(data.durationSeconds,1850);assert.equal(data.providerTotalFareKrw,0);assert.equal(data.taxiFareEstimateKrw,null);assert.equal(data.responseIdentityVerified,false);assert.equal(data.arrivalTime,null);assert.equal(data.providerUpdatedAt,null);assert.equal(data.geometryIncluded,false);assert.equal(Date.parse(data.expiresAt)-Date.parse(data.retrievedAt),tmapResultTtlMs);assert(data.source.attribution.includes('TMAP'));
  const missing=tmapPayload();delete (missing.features[0]!.properties as any).totalFare;assert.equal(normalizeTmapResponse(JSON.stringify(missing),tmapExample()).providerTotalFareKrw,null);
});
test('TMAP rejects ambiguous, malformed and unsafe summaries rather than inventing route availability or identity',()=>{
  for(const patch of [{totalTime:-1},{totalDistance:1.5},{totalFare:'0'},{taxiFare:1e30},{totalDistance:null}])assert.throws(()=>normalizeTmapResponse(JSON.stringify(tmapPayload(patch)),tmapExample()),code('INVALID_RESPONSE'));
  for(const value of ['not json',JSON.stringify({type:'FeatureCollection',features:[]}),JSON.stringify({...tmapPayload(),features:[...tmapPayload().features,...tmapPayload().features]})])assert.throws(()=>normalizeTmapResponse(value,tmapExample()),code('INVALID_RESPONSE'));
  assert.throws(()=>normalizeTmapResponse(JSON.stringify(tmapPayload({totalTime:0})),tmapExample()),code('TMAP_ROUTE_UNCONFIRMED','needs_review'));
  assert.throws(()=>normalizeTmapResponse(JSON.stringify({error:{id:'unit',message:tmapSecret}}),tmapExample()),code('TMAP_PROVIDER_ERROR'));
});
test('TMAP sends one fixed POST with coordinates in form data and the key only in its header',async()=>{
  const mock=tmapMock(),run=context(),result=await tmapExecutor(mock.fetcher)(tmapAction,run.ctx);assert.equal(run.sends(),1);assert.equal(mock.calls.length,1);assert.equal(mock.calls[0]!.body.get('startX'),String(tmapExample().start.longitude));assert(!JSON.stringify(result).includes(tmapSecret));assert.equal((result.data as any).durationSeconds,1850);
});
test('TMAP refuses missing/invalid keys, unknown actions and cancellation before dispatch',async()=>{
  const mock=tmapMock();for(const value of ['', 'bad\nkey']){const run=context();run.ctx.secrets.appKey=value;await assert.rejects(()=>tmapExecutor(mock.fetcher)(tmapAction,run.ctx),code('AUTH_REQUIRED','awaiting_auth'));assert.equal(run.sends(),0);}
  const unknown=context();await assert.rejects(()=>tmapExecutor(mock.fetcher)({...tmapAction,id:'other'},unknown.ctx),code('NOT_IMPLEMENTED'));
  const c=new AbortController();c.abort();const cancelled=context(c);await assert.rejects(()=>tmapExecutor(mock.fetcher)(tmapAction,cancelled.ctx),code('CANCELLED','cancelled'));assert.equal(mock.calls.length,0);
});
test('TMAP handles authentication, quota, no-route and provider failures without body leakage or retries',async()=>{
  for(const[status,name,state]of [[401,'AUTH_REQUIRED','awaiting_auth'],[403,'AUTH_REQUIRED','awaiting_auth'],[429,'PROVIDER_RATE_LIMIT','failed'],[204,'TMAP_NO_ROUTE','needs_review'],[400,'PROVIDER_HTTP_400','failed'],[500,'PROVIDER_HTTP_500','failed']] as const){const mock=tmapMock();mock.flags.status=status;await assert.rejects(()=>tmapExecutor(mock.fetcher)(tmapAction,context().ctx),code(name,state));assert.equal(mock.calls.length,1);}
  for(const[flag,name]of [['invalidUtf8','INVALID_RESPONSE'],['oversized','RESULT_TOO_LARGE'],['error','TMAP_PROVIDER_ERROR']] as const){const mock=tmapMock();mock.flags[flag]=true;await assert.rejects(()=>tmapExecutor(mock.fetcher)(tmapAction,context().ctx),code(name));assert.equal(mock.calls.length,1);}
  await assert.rejects(()=>tmapExecutor(async()=>{throw Error(tmapSecret);})(tmapAction,context().ctx),code('PROVIDER_UNAVAILABLE'));
});
test('TMAP timeout and cancellation during a request stop without a second dispatch',async()=>{
  await assert.rejects(()=>tmapExecutor(async()=>{throw new DOMException(tmapSecret,'TimeoutError');})(tmapAction,context().ctx),code('PROVIDER_TIMEOUT'));
  const controller=new AbortController();let calls=0;await assert.rejects(()=>tmapExecutor(async()=>{calls++;controller.abort();throw Error(tmapSecret);})(tmapAction,context(controller).ctx),code('CANCELLED','cancelled'));assert.equal(calls,1);
});

test('TMAP HTTP requires its own scoped key, previews without dispatch, deduplicates, resumes auth and records no mock support',async()=>{
  const mock=tmapMock(),r=await createRuntime({dataDir:tempDir('tmap-http'),port:0,vault:new TestVault(),evidenceMode:'mock',fetcher:mock.fetcher});
  try{
    const cookie=await runtimeLogin(r),api=(path:string,method='GET',body?:unknown,token?:string)=>runtimeApi(r,'/api'+path,method,body,cookie,token?{Authorization:`Bearer ${token}`}:{ });
    const preview=await(await api('/drafts/'+tmapAction.id+'/preview','POST',tmapExample())).json();assert.equal(preview.networkDispatched,false);assert.equal(mock.calls.length,0);
    const account=await r.engine.saveAccount({label:'TMAP',credentialType:'tmap-api',allowedActions:[tmapAction.id],secrets:{appKey:tmapSecret}}),client=r.engine.createClient({name:'route reader',allowedActions:[tmapAction.id],allowedAccountIds:[account.id]});
    const request={actionId:tmapAction.id,accountId:account.id,input:tmapExample(),idempotencyKey:randomUUID()},blocked=r.engine.createClient({name:'wrong account',allowedActions:[tmapAction.id]});assert.equal((await api('/jobs','POST',request,blocked.token)).status,403);
    const job=await(await api('/jobs','POST',request,client.token)).json();await r.engine.idle();const result=await(await api('/jobs/'+job.id,'GET',undefined,client.token)).json();assert.equal(result.state,'succeeded');assert.equal(result.result.contentTrust,'external_data');assert(result.resultExpiresAt);assert.equal(result.events.some((e:any)=>e.state==='pending_approval'),false);assert(!JSON.stringify(result).includes(tmapSecret));
    await api('/jobs','POST',request,client.token);await r.engine.idle();assert.equal(mock.calls.length,1);
    mock.flags.status=403;const paused=await(await api('/jobs','POST',{...request,idempotencyKey:randomUUID()},client.token)).json();await r.engine.idle();assert.equal(r.engine.get(admin,paused.id).state,'awaiting_auth');mock.flags.status=200;await api('/jobs/'+paused.id+'/resume','POST',{},client.token);await r.engine.idle();assert.equal(r.engine.get(admin,paused.id).state,'succeeded');
    assert.equal(r.engine.metrics().verifiedServices,0);assert.equal(r.engine.metrics().supportedActions,0);assert.equal((await r.chats.create({allowedActions:[tmapAction.id]})).allowedActions[0],tmapAction.id);
  }finally{await r.close();}
});

test('expired route results disappear from stored jobs, lists and idempotent responses without requery or changed execution history',async()=>{
  const mock=tmapMock(),r=await createRuntime({dataDir:tempDir('tmap-expiry'),port:0,vault:new TestVault(),evidenceMode:'mock',fetcher:mock.fetcher});
  try{
    const account=await r.engine.saveAccount({label:'TMAP',credentialType:'tmap-api',allowedActions:[tmapAction.id],secrets:{appKey:tmapSecret}}),request={actionId:tmapAction.id,accountId:account.id,input:tmapExample(),idempotencyKey:randomUUID()},job=r.engine.create(admin,request);await r.engine.idle();const done=r.store.job(job.id)!;assert(done.result);assert.equal(Date.parse(done.resultExpiresAt!)-Date.parse(done.startedAt!),tmapResultTtlMs);
    done.resultExpiresAt=new Date(Date.now()-1).toISOString();r.store.saveJob(done);const duplicate=r.engine.create(admin,request);assert.equal(duplicate.id,job.id);assert.equal(duplicate.result,undefined);assert.equal(duplicate.error?.code,'RESULT_EXPIRED');assert.equal(duplicate.state,'succeeded');assert.equal(r.store.job(job.id)!.result,undefined);assert(!JSON.stringify(r.engine.jobs()).includes('distanceMetres'));assert.equal(mock.calls.length,1);
    const other=r.engine.create(admin,{...request,idempotencyKey:randomUUID()});await r.engine.idle();const toExpire=r.store.job(other.id)!;toExpire.resultExpiresAt='invalid-expiry';r.store.saveJob(toExpire);
    const restarted=new Engine(r.store,new TestVault(),'mock');assert.equal(r.store.job(other.id)!.result,undefined);await restarted.close();assert.equal(r.store.job(job.id)!.state,'succeeded');
  }finally{await r.close();}
});

test('expired route conversations remove dependent assistant responses/protocol and block model replay while keeping user messages and older replies',async()=>{
  const mock=tmapMock();let modelCalls=0;const r=await createRuntime({dataDir:tempDir('tmap-chat-expiry'),port:0,vault:new TestVault(),evidenceMode:'mock',fetcher:mock.fetcher,aiFetcher:async()=>{modelCalls++;throw Error('must not call');}});
  try{
    const account=await r.engine.saveAccount({label:'TMAP',credentialType:'tmap-api',allowedActions:[tmapAction.id],secrets:{appKey:tmapSecret}}),chat=await r.chats.create({allowedActions:[tmapAction.id]}),job=r.engine.create(admin,{actionId:tmapAction.id,accountId:account.id,input:tmapExample(),idempotencyKey:randomUUID()});await r.engine.idle();const done=r.store.job(job.id)!;done.resultExpiresAt=new Date(Date.now()-1).toISOString();r.store.saveJob(done);
    const record=r.store.get<any>('chat',chat.id)!;r.store.put('chat',chat.id,{...record,jobIds:[job.id],messages:[{id:'older',role:'assistant',content:'older reply',at:'2020-01-01T00:00:00Z'},{id:'user',role:'user',content:'사용자 질문',at:done.createdAt},{id:'route',role:'assistant',content:'route-marker-1850',at:new Date().toISOString()}],protocol:[...record.protocol,{role:'assistant',content:'route-marker-1850'}]});
    const visible=r.chats.list();assert(!JSON.stringify(visible).includes('route-marker-1850'));assert(JSON.stringify(visible).includes('사용자 질문'));assert(JSON.stringify(visible).includes('older reply'));assert(!JSON.stringify(r.store.get('chat',chat.id)).includes('route-marker-1850'));
    assert.throws(()=>r.chats.submit(chat.id,{requestId:randomUUID(),content:'계속'}),code('CHAT_RESULT_EXPIRED'));assert.equal(modelCalls,0);assert.equal(r.store.job(job.id)!.result,undefined);
  }finally{await r.close();}
});

test('a model response crossing the route deadline cannot restore expired protocol or derived response text',async()=>{
  const mock=tmapMock();let modelCalls=0,expiryJobId='';
  const r=await createRuntime({dataDir:tempDir('tmap-inflight-expiry'),port:0,vault:new TestVault(),evidenceMode:'mock',fetcher:mock.fetcher,aiFetcher:async()=>{
    modelCalls++;const job=r.store.job(expiryJobId)!;job.resultExpiresAt=new Date(Date.now()-1).toISOString();r.store.saveJob(job);
    return Response.json({model:'deepseek-flash',choices:[{finish_reason:'stop',message:{role:'assistant',content:'expired-derived-marker'}}]});
  }});
  try{
    await r.chats.saveKey({apiKey:'sk-tmap-unit-model-key-123456789'});
    const account=await r.engine.saveAccount({label:'TMAP',credentialType:'tmap-api',allowedActions:[tmapAction.id],secrets:{appKey:tmapSecret}}),job=r.engine.create(admin,{actionId:tmapAction.id,accountId:account.id,input:tmapExample(),idempotencyKey:randomUUID()});await r.engine.idle();expiryJobId=job.id;
    const chat=await r.chats.create({title:'deadline crossing'}),record=r.store.get<any>('chat',chat.id)!;
    r.store.put('chat',chat.id,{...record,jobIds:[job.id],protocol:[...record.protocol,{role:'assistant',content:'previous-route-marker'}],messages:[{id:'previous',role:'assistant',content:'previous-route-marker',at:new Date().toISOString()}]});
    r.chats.submit(chat.id,{requestId:randomUUID(),content:'이어서 확인해줘'});await r.chats.idle();const stored=r.store.get<any>('chat',chat.id)!;
    assert.equal(modelCalls,1);assert(stored.expiredResultsAt);assert(!JSON.stringify(stored).includes('expired-derived-marker'));assert(!JSON.stringify(stored).includes('previous-route-marker'));assert(JSON.stringify(stored).includes('이어서 확인해줘'));assert.equal(r.store.job(job.id)!.result,undefined);
  }finally{await r.close();}
});
