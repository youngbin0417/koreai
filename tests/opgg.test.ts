import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { opggActions, opggExample, opggRequestTemplate, opggExecutor, normalizeOpggResult, opggEndpoint } from '../src/connectors/opgg.js';
import { decodeOpggData } from '../src/connectors/opgg-format.js';
import { ActionError, type ExecutionContext } from '../src/types.js';
import { createRuntime } from '../src/http.js';
import { admin } from '../src/core/engine.js';
import { TestVault, tempDir } from './helpers.js';
import { runtimeApi, runtimeLogin } from './mcp-oauth-fixture.js';
import {playerInput,profile,matches,meta,tft,agents,content,opggMock} from './opgg-fixture.js';

const code=(expected:string,state='failed')=>(error:unknown)=>error instanceof ActionError&&error.code===expected&&error.state===state&&!error.message.includes('unit-opgg-private-secret');
function context(id:string,input:Record<string,unknown>=id.startsWith('opgg.lol.p')||id==='opgg.lol.matches'?playerInput:opggExample(id),controller=new AbortController()){
  let dispatched=0;const now=new Date().toISOString();const ctx:ExecutionContext={job:{id:randomUUID(),clientId:'local-admin',actionId:id,input,idempotencyKey:randomUUID(),requestHash:'test',effect:'read',state:'running',revision:1,dispatched:false,createdAt:now,updatedAt:now,interventions:0,events:[]},secrets:{unrelated:'unit-opgg-private-secret'},signal:controller.signal,dispatch(){dispatched++;}};return{ctx,dispatched:()=>dispatched};
}


test('OP.GG exposes only five reviewed public read tools and bounds Riot IDs, Korean region, lanes and limits',()=>{
  assert.equal(opggActions.length,5);for(const action of opggActions){assert.equal(action.method,'mcp');assert.equal(action.effect,'read');assert.equal(action.origin,'bundled');assert.equal(action.credentialType,undefined);assert.deepEqual(action.requiredSecrets,[]);assert(action.schema.safeParse(opggExample(action.id)).success);}
  const profile=opggActions[0]!,recent=opggActions[1]!,meta=opggActions[2]!;
  for(const patch of [{gameName:''},{tagLine:'name#KR1'},{gameName:'control\n'},{region:'NA'},{url:'https://evil.example'},{token:'private'},{desired_output_fields:['*']}])assert(!profile.schema.safeParse({...playerInput,...patch}).success,JSON.stringify(patch));
  assert(!recent.schema.safeParse({...playerInput,limit:21}).success);assert(!recent.schema.safeParse({...playerInput,limit:4}).success);assert(!meta.schema.safeParse({position:'all',limit:50}).success);
});

test('OP.GG previews fixed POST tools/call arguments with closed field selections and no credentials or local-only limits',()=>{
  for(const action of opggActions){const template=opggRequestTemplate(action.id,opggExample(action.id));assert.equal(template.endpoint,opggEndpoint);assert.equal(template.method,'POST');assert.equal(template.authentication.type,'none');assert.equal(template.body.method,'tools/call');assert(!JSON.stringify(template).includes('unit-opgg-private-secret'));}
  const profile=opggRequestTemplate('opgg.lol.profile',playerInput);assert.equal(profile.body.params.arguments.game_name,playerInput.gameName);assert(!JSON.stringify(profile.body).includes('puuid'));assert(!JSON.stringify(profile.body).includes('real_name'));
  const meta=opggRequestTemplate('opgg.lol.meta',{position:'top',limit:1});assert.equal(meta.body.params.arguments.limit,undefined);assert(JSON.stringify(meta.body).includes('data.positions.top'));
  assert.deepEqual(opggRequestTemplate('opgg.tft.meta',{limit:1}).body.params.arguments,{});
});

test('OP.GG class data parser handles nested data, arrays, Unicode strings and nulls without executing text',()=>{
  const raw=`class Root: name,rows\nclass Row: n,active,note\n\nRoot(${JSON.stringify('한글 "')},[Row(1,true,null),Row(-2.5e1,false,"text")])`;
  const parsed=decodeOpggData(raw);
  assert.equal(parsed.format,'opgg-class-data');assert.deepEqual(parsed.value,{name:'한글 "',rows:[{n:1,active:true,note:null},{n:-25,active:false,note:'text'}]});assert.equal(decodeOpggData('{"data":[]}').format,'json');
});

test('OP.GG class parser rejects code, prototype fields, unknown constructors, mismatched fields, excessive depth and trailing commands',()=>{
  for(const raw of ['class X: a\n\nX(1);globalThis.compromised=true','class X: __proto__\n\nX(null)','class X: a,a\n\nX(1,2)','class X: a\n\nY(1)','class X: a\n\nX(1,2)','class X: a\n\nX(undefined)','class X: a\n\nX(Infinity)','class X: a\n\nX(1e999)','class X: a\n\nX(9007199254740993)','class X: a\n\nX('+ '['.repeat(32)+'0'+']'.repeat(32)+')','not JSON or class data'])assert.throws(()=>decodeOpggData(raw),code('INVALID_RESPONSE'));
  assert.throws(()=>decodeOpggData('x'.repeat(1_000_001)),code('RESULT_TOO_LARGE'));
});

test('OP.GG profile projects public rank fields, checks identity and keeps null rank and region data unknown',()=>{
  const result=normalizeOpggResult('opgg.lol.profile',content(profile()),playerInput) as any;assert.equal(result.profile.gameName,playerInput.gameName);assert.equal(result.profile.rankedQueues[0].lp,50);assert.equal(result.accountOwnershipVerified,false);assert(!JSON.stringify(result).includes('omit-unrequested-private-id'));
  const empty=profile();empty.data.summoner.region=null as any;empty.data.summoner.league_stats[0]!.tier_info=null as any;assert.equal((normalizeOpggResult('opgg.lol.profile',content(empty),playerInput) as any).profile.rankedQueues[0].tier,null);
  for(const patch of [{game_name:'다른 소환사'},{tagline:'OTHER'},{region:'na'},{level:-1}])assert.throws(()=>normalizeOpggResult('opgg.lol.profile',content({data:{summoner:{...profile().data.summoner,...patch}}}),playerInput),code('INVALID_RESPONSE'));
});

test('OP.GG recent matches return only the requested player with distinct match IDs and preserve zero deaths without inventing KDA ratios',()=>{
  const result=normalizeOpggResult('opgg.lol.matches',content(matches()),{...playerInput,limit:5}) as any;assert.equal(result.matches[0].deaths,0);assert.equal(result.matches[0].kills,3);assert.equal(result.matches[0].resultRaw,'WIN');assert(!JSON.stringify(result).includes('다른 사람'));
  const duplicate=matches();duplicate.data.game_history.push(duplicate.data.game_history[0]!);assert.throws(()=>normalizeOpggResult('opgg.lol.matches',content(duplicate),playerInput),code('INVALID_RESPONSE'));
  const wrong=matches();wrong.data.game_history[0]!.participants.shift();assert.throws(()=>normalizeOpggResult('opgg.lol.matches',content(wrong),playerInput),code('INVALID_RESPONSE'));
});

test('OP.GG meta, TFT and Valorant results preserve provider contexts and Korean names with bounded local projections',()=>{
  const metaResult=normalizeOpggResult('opgg.lol.meta',content(meta()),{position:'mid',limit:1}) as any;assert.equal(metaResult.champions.length,1);assert.equal(metaResult.champions[0].winRate,0.51);assert.equal(metaResult.providerCount,2);assert.equal(metaResult.providerContext.patch,null);assert.equal(metaResult.rateUnit,'ratio_0_to_1');
  const bad=meta();bad.data.positions.mid![0]!.win_rate=51;assert.throws(()=>normalizeOpggResult('opgg.lol.meta',content(bad),{position:'mid'}),code('INVALID_RESPONSE'));
  const tftResult=normalizeOpggResult('opgg.tft.meta',content(tft()),{limit:1}) as any;assert.equal(tftResult.decks[0].name,'시험 덱');assert.equal(tftResult.providerStatisticsAtRaw,'2026-10-20T12:00:00Z');assert.equal(tftResult.selection,'provider_list_prefix');assert.equal(tftResult.decks[0].units[0].itemKeys[0],'Item_A');
  const agentResult=normalizeOpggResult('opgg.valorant.agents',content(agents()),{name:'제트',limit:1}) as any;assert.equal(agentResult.matchedCount,1);assert.equal(agentResult.agents[0].skills[0].name,'상승기류');assert.equal(agentResult.currentMetaRank,null);
});

test('OP.GG dedicated MCP adapter handles non-object outputSchema without weakening selected input validation or forwarding secrets',async()=>{
  const mock=opggMock();for(const action of opggActions){const run=context(action.id),result=await opggExecutor(mock.fetcher)(action,run.ctx);assert.equal(run.dispatched(),1);assert(!JSON.stringify(result).includes('unit-opgg-private-secret'));}
  assert.equal(mock.record.calls.length,5);assert(mock.record.methods.includes('initialize'));assert(mock.record.methods.includes('tools/list'));assert(mock.record.headers.every(headers=>!headers.has('authorization')&&!headers.has('cookie')));
});

test('OP.GG missing tools, changed input schema and duplicate discovery names stop before dispatch',async()=>{
  for(const[flag,expected]of [['missing','OPGG_TOOL_UNAVAILABLE'],['changed','OPGG_SCHEMA_CHANGED'],['duplicate','INVALID_RESPONSE']] as const){const mock=opggMock();mock.flags[flag]=true;const run=context('opgg.lol.meta');await assert.rejects(()=>opggExecutor(mock.fetcher)(opggActions[2]!,run.ctx),code(expected));assert.equal(mock.record.calls.length,0);assert.equal(run.dispatched(),0);}
});

test('OP.GG tool errors, quota, authentication, invalid UTF-8 and oversized responses never retry the tool or echo upstream messages',async()=>{
  const action=opggActions[2]!;
  const error=opggMock();error.flags.toolError=true;await assert.rejects(()=>opggExecutor(error.fetcher)(action,context(action.id).ctx),code('OPGG_TOOL_ERROR'));assert.equal(error.record.calls.length,1);
  for(const[status,expected,state]of [[429,'PROVIDER_RATE_LIMIT','failed'],[401,'OPGG_ACCESS_REQUIRED','awaiting_user'],[403,'OPGG_ACCESS_REQUIRED','awaiting_user']] as const){const mock=opggMock();mock.flags.status=status;mock.flags.statusAt='tools/call';await assert.rejects(()=>opggExecutor(mock.fetcher)(action,context(action.id).ctx),code(expected,state));assert.equal(mock.record.methods.filter(method=>method==='tools/call').length,1);}
  for(const[flag,expected]of [['invalidUtf8','INVALID_RESPONSE'],['oversized','RESULT_TOO_LARGE']] as const){const mock=opggMock();mock.flags[flag]=true;await assert.rejects(()=>opggExecutor(mock.fetcher)(action,context(action.id).ctx),code(expected));assert.equal(mock.record.calls.length,1);}
});

test('OP.GG cancellation before connection and during discovery prevents the actual data call',async()=>{
  const action=opggActions[2]!,controller=new AbortController(),before=opggMock(),run=context(action.id,opggExample(action.id),controller);controller.abort();await assert.rejects(()=>opggExecutor(before.fetcher)(action,run.ctx),code('CANCELLED','cancelled'));assert.equal(before.record.methods.length,0);
  const during=new AbortController(),mock=opggMock();mock.flags.onList=()=>during.abort();await assert.rejects(()=>opggExecutor(mock.fetcher)(action,context(action.id,opggExample(action.id),during).ctx),code('CANCELLED','cancelled'));assert.equal(mock.record.calls.length,0);
});

test('OP.GG HTTP executes without account setup, enforces action scopes, previews locally and deduplicates without support evidence',async()=>{
  const mock=opggMock(),runtime=await createRuntime({dataDir:tempDir('opgg-http'),port:0,vault:new TestVault(),evidenceMode:'mock',fetcher:mock.fetcher});
  try{
    const cookie=await runtimeLogin(runtime),action=opggActions[2]!,api=(path:string,method='GET',body?:unknown,bearer?:string)=>runtimeApi(runtime,`/api${path}`,method,body,cookie,bearer?{Authorization:`Bearer ${bearer}`}:{ });
    const preview=await(await api(`/drafts/${action.id}/preview`,'POST',{position:'mid'})).json();assert.equal(preview.networkDispatched,false);assert.equal(preview.request.authentication.type,'none');assert.equal(mock.record.methods.length,0);
    const chat=await runtime.chats.create({title:'OP.GG 공개 조회',allowedActions:[action.id]});assert.deepEqual(chat.allowedActions,[action.id]);assert.equal(mock.record.methods.length,0);
    const request={actionId:action.id,input:{position:'mid'},idempotencyKey:randomUUID()},blocked=runtime.engine.createClient({name:'blocked',allowedActions:['opgg.tft.meta']});assert.equal((await api('/jobs','POST',request,blocked.token)).status,403);
    const client=runtime.engine.createClient({name:'OP.GG reader',allowedActions:[action.id]}),job=await(await api('/jobs','POST',request,client.token)).json();await runtime.engine.idle();const result=await(await api(`/jobs/${job.id}`,'GET',undefined,client.token)).json();assert.equal(result.state,'succeeded');assert.equal(result.result.contentTrust,'external_data');assert.equal(result.result.data.champions[0].name,'아리');assert.equal(result.effect,'read');assert.equal(result.events.some((event:any)=>event.state==='pending_approval'),false);
    assert.equal((await(await api('/jobs','POST',request,client.token)).json()).id,job.id);await runtime.engine.idle();assert.equal(mock.record.calls.length,1);assert.equal(runtime.engine.accounts().length,0);assert.equal(runtime.engine.metrics().verifiedServices,0);assert.equal(runtime.engine.metrics().supportedActions,0);assert.equal(runtime.engine.discover(admin).filter(action=>action.serviceId==='opgg').length,5);
  }finally{await runtime.close();}
});
