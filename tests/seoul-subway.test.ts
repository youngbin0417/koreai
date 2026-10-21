import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { subwayActions,subwayArrivalsSchema,subwayTimetableSchema,subwayRequestTemplate,normalizeSubwayResponse,subwayExecutor } from '../src/connectors/seoul-subway.js';
import { previewDraftRequest } from '../src/connectors/drafts/index.js';
import { ActionError,type ExecutionContext } from '../src/types.js';
import { createRuntime } from '../src/http.js';
import { admin } from '../src/core/engine.js';
import { serverOptions } from '../src/core/platform.js';
import { TestVault,tempDir } from './helpers.js';
import { runtimeLogin,runtimeApi } from './mcp-oauth-fixture.js';
import { SubwayResult,subwayArrivalsInputState,subwayTimetableInputState } from '../ui/Subway.js';
import { subwayMock,subwaySecret,arrivalInput,timetableInput,arrivalRow,arrivalPayload,timetableRow,timetablePayload } from './seoul-subway-fixture.js';
const now=new Date('2026-10-22T01:02:00Z'),arrival=subwayActions[0]!,schedule=subwayActions[1]!;
const code=(name:string,state='failed')=>(e:unknown)=>e instanceof ActionError&&e.code===name&&e.state===state&&!e.message.includes(subwaySecret);
function context(input:unknown=arrivalInput,controller=new AbortController()){let sends=0;return{ctx:{job:{input} as ExecutionContext['job'],secrets:{apiKey:subwaySecret},signal:controller.signal,dispatch(){sends++;}}satisfies ExecutionContext,sends:()=>sends};}

test('subway requests fix service paths, distinguish planned/real-time data and require independent HTTP opt-in',()=>{
  assert.equal(serverOptions([],{},'linux').allowSeoulSubwayHttp,false);assert.equal(serverOptions([],{KOREAI_ALLOW_SEOUL_SUBWAY_HTTP:'1'},'linux').allowSeoulSubwayHttp,true);assert.equal(serverOptions([],{KOREAI_ALLOW_SEOUL_BIKE_HTTP:'1'},'linux').allowSeoulSubwayHttp,false);
  assert.equal(arrival.resultTtlMs,60000);assert.equal(schedule.resultTtlMs,undefined);assert.equal(arrival.credentialType,'seoul-subway-api');
  for(const patch of [{stationName:''},{stationName:'../서울'},{stationName:'서울\n역'},{limit:101},{endpoint:'https://wrong'}])assert(!subwayArrivalsSchema.safeParse({...arrivalInput,...patch}).success);
  for(const patch of [{lineName:''},{day:'일요일'},{direction:'북쪽'},{at:'2026-10-22 12:00:00'}])assert(!subwayTimetableSchema.safeParse({...timetableInput,...patch}).success);
  const preview=previewDraftRequest(arrival.id,arrivalInput);assert.equal(preview.networkDispatched,false);assert(preview.request!.endpoint.includes('{apiKey}/json/realtimeStationArrival/0/5/'));assert(!JSON.stringify(preview).includes(subwaySecret));
  const request=subwayRequestTemplate(schedule.id,{...timetableInput,at:now.toISOString()});assert.equal(request.query.stnNm,'서울');assert.equal(request.query.searchDt,'2026-10-22 10:02:00');assert(request.endpoint.includes('/json/getTrainSch/1/5/%20/N/'));
});

test('subway arrivals preserve zero seconds, raw message/identity and source age without inventing a countdown',()=>{
  const data=normalizeSubwayResponse(arrival.id,JSON.stringify(arrivalPayload()),arrivalInput,now),row=(data.rows as any[])[0];assert.equal(row.reportedArrivalSeconds,0);assert.equal(row.adjustedArrivalSeconds,null);assert.equal(row.ageSeconds,120);assert.equal(row.trainNumber,'0010');assert.equal(row.lastTrainReported,true);assert.equal(data.transportIntegrityVerified,false);
  const rows=[arrivalRow({ordkey:'other',barvlDt:'120',recptnDt:'2026-10-22 10:03:00'})];assert.equal((normalizeSubwayResponse(arrival.id,JSON.stringify(arrivalPayload(rows)),arrivalInput,now).rows as any[])[0].ageSeconds,-60);
  for(const row of [arrivalRow({statnNm:'서울역'}),arrivalRow({barvlDt:'-1'}),arrivalRow({recptnDt:'2026-02-30 10:00:00'}),arrivalRow({arvlCd:'80'}),arrivalRow({totalCount:2})])assert.throws(()=>normalizeSubwayResponse(arrival.id,JSON.stringify(arrivalPayload([row])),arrivalInput,now),code('INVALID_RESPONSE'));
  assert.throws(()=>normalizeSubwayResponse(arrival.id,JSON.stringify(arrivalPayload([arrivalRow(),arrivalRow()],2)),arrivalInput,now),code('INVALID_RESPONSE'));
});

test('subway timetable handles actual response envelope and expired validity without treating service-day hours as calendar timestamps',()=>{
  const data=normalizeSubwayResponse(schedule.id,JSON.stringify(timetablePayload()),timetableInput,now),row=(data.rows as any[])[0];assert.equal(row.departureRaw,'25:10:00');assert.equal(row.arrivalRaw,null);assert.equal(row.validAtQuery,false);assert.equal(row.stationCode,'0150');
  const current=timetableRow({vldBgngDt:'2026-10-01T05:00:00',vldEndDt:'2026-11-01T04:59:59'});assert.equal((normalizeSubwayResponse(schedule.id,JSON.stringify(timetablePayload([current])),timetableInput,now).rows as any[])[0].validAtQuery,true);
  for(const patch of [{stnNm:'강남'},{lineNm:'2호선'},{upbdnbSe:'하행'},{wkndSe:'주말'},{tmprTmtblYn:'Y'},{trainDptreTm:'30:00:00'},{vldEndDt:'2025-01-01T00:00:00'}])assert.throws(()=>normalizeSubwayResponse(schedule.id,JSON.stringify(timetablePayload([timetableRow(patch)])),timetableInput,now),code('INVALID_RESPONSE'));
  const wrong=timetablePayload();wrong.response.body.pageNo=2;assert.throws(()=>normalizeSubwayResponse(schedule.id,JSON.stringify(wrong),timetableInput,now),code('INVALID_RESPONSE'));
});

test('subway missing data, malformed responses, XML authentication and provider errors never become invented trains',()=>{
  assert.throws(()=>normalizeSubwayResponse(arrival.id,JSON.stringify({status:500,code:'INFO-100',message:subwaySecret}),arrivalInput,now),code('AUTH_REQUIRED','awaiting_auth'));
  assert.equal((normalizeSubwayResponse(arrival.id,JSON.stringify(arrivalPayload([arrivalRow({barvlDt:''})])),arrivalInput,now).rows as any[])[0].reportedArrivalSeconds,null);
  for(const action of subwayActions){const input=action===arrival?arrivalInput:timetableInput;assert.equal(normalizeSubwayResponse(action.id,JSON.stringify({RESULT:{CODE:'INFO-200'}}),input,now).status,'no_data');assert.throws(()=>normalizeSubwayResponse(action.id,'<RESULT><CODE>INFO-100</CODE></RESULT>',input,now),code('AUTH_REQUIRED','awaiting_auth'));assert.throws(()=>normalizeSubwayResponse(action.id,JSON.stringify({RESULT:{CODE:'ERROR-500',MESSAGE:subwaySecret}}),input,now),code('PROVIDER_ERROR'));for(const raw of ['bad','<!DOCTYPE x><RESULT/>','x'.repeat(2_000_001)])assert.throws(()=>normalizeSubwayResponse(action.id,raw,input,now));}
  assert.throws(()=>normalizeSubwayResponse(arrival.id,JSON.stringify(arrivalPayload([],1)),arrivalInput,now),code('INVALID_RESPONSE'));
  assert.equal(normalizeSubwayResponse(arrival.id,JSON.stringify(arrivalPayload([],0)),arrivalInput,now).status,'no_data');assert.equal(normalizeSubwayResponse(schedule.id,JSON.stringify(timetablePayload([],0)),timetableInput,now).status,'no_data');
});

test('subway executor blocks transport and sample keys, encodes private path keys once and does not retry failures',async()=>{
  const mock=subwayMock(),c=context();await assert.rejects(()=>subwayExecutor(mock.fetcher)(arrival,c.ctx),code('TRANSPORT_DISABLED'));assert.equal(c.sends(),0);
  for(const key of ['','sample','..','bad\nkey']){const v=context();v.ctx.secrets.apiKey=key;await assert.rejects(()=>subwayExecutor(mock.fetcher,true)(arrival,v.ctx),code('AUTH_REQUIRED','awaiting_auth'));assert.equal(v.sends(),0);}assert.equal(mock.calls.length,0);
  const run=context();await subwayExecutor(mock.fetcher,true)(arrival,run.ctx);assert.equal(mock.calls.length,1);assert.equal(decodeURIComponent(mock.calls[0]!.pathname.split('/')[3]!),subwaySecret);assert.equal(run.sends(),1);
  for(const [status,error,state]of [[401,'AUTH_REQUIRED','awaiting_auth'],[403,'AUTH_REQUIRED','awaiting_auth'],[429,'PROVIDER_RATE_LIMIT','failed'],[500,'PROVIDER_HTTP_500','failed']]as const){const m=subwayMock();m.flags.status=status;await assert.rejects(()=>subwayExecutor(m.fetcher,true)(arrival,context().ctx),code(error,state));assert.equal(m.calls.length,1);}
  for(const [body,error]of [[new Uint8Array([255]),'INVALID_RESPONSE'],['x'.repeat(2_000_001),'RESULT_TOO_LARGE']]as const)await assert.rejects(()=>subwayExecutor(async()=>new Response(body),true)(arrival,context().ctx),code(error));
  await assert.rejects(()=>subwayExecutor(async()=>{throw Error(subwaySecret);},true)(arrival,context().ctx),code('PROVIDER_UNAVAILABLE'));
  const controller=new AbortController();controller.abort();await assert.rejects(()=>subwayExecutor(mock.fetcher,true)(arrival,context(arrivalInput,controller).ctx),code('CANCELLED','cancelled'));
});

test('subway HTTP applies action/account scopes, previews with zero dispatch and resumes authentication without support inflation',async()=>{
  const mock=subwayMock(),r=await createRuntime({dataDir:tempDir('subway-http'),port:0,vault:new TestVault(),evidenceMode:'mock',allowSeoulSubwayHttp:true,fetcher:mock.fetcher});try{
    const cookie=await runtimeLogin(r),api=(p:string,m='GET',body?:unknown,token?:string)=>runtimeApi(r,'/api'+p,m,body,cookie,token?{Authorization:'Bearer '+token}:{});
    const account=await r.engine.saveAccount({label:'서울 지하철',credentialType:'seoul-subway-api',allowedActions:[arrival.id,schedule.id],secrets:{apiKey:subwaySecret}}),client=r.engine.createClient({name:'arrival reader',allowedActions:[arrival.id],allowedAccountIds:[account.id]});
    const preview=await(await api('/drafts/'+arrival.id+'/preview','POST',arrivalInput)).json();assert.equal(preview.networkDispatched,false);assert.equal(mock.calls.length,0);
    const request={actionId:arrival.id,accountId:account.id,input:arrivalInput,idempotencyKey:randomUUID()},job=await(await api('/jobs','POST',request,client.token)).json();await r.engine.idle();assert.equal(r.engine.get(admin,job.id).state,'succeeded');assert(r.engine.get(admin,job.id).resultExpiresAt);await api('/jobs','POST',request,client.token);await r.engine.idle();assert.equal(mock.calls.length,1);assert.equal((await api('/jobs','POST',{...request,actionId:schedule.id,input:timetableInput,idempotencyKey:randomUUID()},client.token)).status,403);
    mock.flags.body={status:500,code:'INFO-100',message:subwaySecret};const paused=await(await api('/jobs','POST',{...request,idempotencyKey:randomUUID()},client.token)).json();await r.engine.idle();assert.equal(r.engine.get(admin,paused.id).state,'awaiting_auth');mock.flags.body=null;await api('/jobs/'+paused.id+'/resume','POST',{},client.token);await r.engine.idle();assert.equal(r.engine.get(admin,paused.id).state,'succeeded');
    const table=await(await api('/jobs','POST',{...request,actionId:schedule.id,input:timetableInput,idempotencyKey:randomUUID()})).json();await r.engine.idle();assert.equal(r.engine.get(admin,table.id).state,'succeeded');assert(!JSON.stringify(await(await api('/state')).json()).includes(subwaySecret));assert.equal(r.engine.metrics().supportedActions,0);assert.equal(r.engine.metrics().verifiedServices,0);
  }finally{await r.close();}
});

test('subway cards escape external text and distinguish stale arrivals, expired timetables and their official map link',()=>{
  const render=(data:unknown)=>renderToStaticMarkup(createElement(SubwayResult,{result:{contentTrust:'external_data',data},busy:false,onPage:()=>{throw Error('unexpected');}}));
  const a=normalizeSubwayResponse(arrival.id,JSON.stringify(arrivalPayload([arrivalRow({arvlMsg2:'<script>bad</script>'})])),arrivalInput,now),html=render(a);assert(html.includes('&lt;script&gt;'));assert(!html.includes('<script>'));assert(html.includes('0초'));assert(html.includes('오래됐거나'));assert(html.includes('공식 노선도'));
  const table=render(normalizeSubwayResponse(schedule.id,JSON.stringify(timetablePayload()),timetableInput,now));assert(table.includes('25:10:00'));assert(table.includes('유효기간 밖'));assert(render({bad:true}).includes('카드로 표시할 수 없는'));
  assert.equal(subwayArrivalsInputState(JSON.stringify(arrivalInput)).error,null);assert.equal(subwayTimetableInputState(JSON.stringify(timetableInput)).error,null);assert(subwayArrivalsInputState('{bad').error);assert(subwayTimetableInputState(JSON.stringify({...timetableInput,day:'잘못'})).error);
});
