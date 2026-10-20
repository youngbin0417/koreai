import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { evSearchAction, oilActions, vehicleEnergyActions, vehicleEnergyExample, vehicleEnergyRequestTemplate, vehicleEnergyExecutor, normalizeVehicleEnergyResponse, evSearchSchema, evProvinces } from '../src/connectors/vehicle-energy.js';
import { ActionError, type Action, type ExecutionContext } from '../src/types.js';
import { createRuntime } from '../src/http.js';
import { admin } from '../src/core/engine.js';
import { TestVault, tempDir } from './helpers.js';
import { runtimeApi, runtimeLogin } from './mcp-oauth-fixture.js';

const secret='unit-vehicle-energy-private-key+/=%&';
const evInput={provinceCode:'11',districtCode:'11680',page:1,limit:10};
const charger=()=>({statNm:'시험 충전소',statId:'ME000001',chgerId:'01',chgerType:'04',addr:'서울특별시 강남구 시험로',addrDetail:'지하 1층',location:'입구 오른쪽',lat:'37.500123456789',lng:'127.0123456789',useTime:'24시간 이용가능',busiId:'ME',busiNm:'시험 운영사',busiCall:'1661-0000',stat:'2',statUpdDt:'20261020121020',output:'100',method:'동시',zcode:'11',zscode:'11680',parkingFree:'N',note:'회원 확인 필요',limitYn:'Y',limitDetail:'거주자 외 출입 제한',delYn:'N',delDetail:''});
const evReply=(rows:Record<string,unknown>[]=[charger()],patch:Record<string,unknown>={})=>JSON.stringify({resultCode:'00',resultMsg:'NORMAL SERVICE.',pageNo:1,numOfRows:10,totalCount:rows.length,items:{item:rows},...patch});
const station=()=>({UNI_ID:'A0010207',OS_NM:'시험 주유소',POLL_DIV_CO:'SKE',PRICE:'1734.5',NEW_ADR:'서울 강남구 시험로 142',VAN_ADR:'서울 강남구 시험동',SIGUNCD:'0113',GIS_X_COOR:'314871.80000',GIS_Y_COOR:'544012.00000'});
const detail=()=>({...station(),TEL:'02-0000-0000',LPG_YN:'N',MAINT_YN:'Y',CAR_WASH_YN:'Y',CVS_YN:'N',KPETRO_YN:'N',OIL_PRICE:[{PRODCD:'B027',PRICE:'1734.5',TRADE_DT:'20261020',TRADE_TM:'145618'}]});
const oilReply=(rows:unknown[])=>JSON.stringify({RESULT:{OIL:rows}});
const inputFor=(action:Action)=>action.id===evSearchAction.id?evInput:vehicleEnergyExample(action.id);
function context(action:Action,input:Record<string,unknown>=inputFor(action),controller=new AbortController()){
  let dispatched=0;const now=new Date().toISOString();
  const ctx:ExecutionContext={job:{id:randomUUID(),clientId:'local-admin',actionId:action.id,input,idempotencyKey:randomUUID(),requestHash:'test',effect:'read',state:'running',revision:1,dispatched:false,createdAt:now,updatedAt:now,interventions:0,events:[]},secrets:{serviceKey:secret,apiKey:secret},signal:controller.signal,dispatch(){dispatched++;}};
  return{ctx,dispatched:()=>dispatched};
}
const hasCode=(code:string,state='failed')=>(error:unknown)=>error instanceof ActionError && error.code===code && error.state===state && !error.message.includes(secret);
const normalize=(action:Action,body:string,input=inputFor(action))=>normalizeVehicleEnergyResponse(action.id,body,input) as Record<string,any>;
const [regionsAction,cheapestAction,detailAction]=oilActions as [Action,Action,Action];

test('vehicle energy inputs bind reviewed scopes, products and bounded pages while rejecting arbitrary URLs, coordinates and secrets',()=>{
  assert.equal(Object.keys(evProvinces).length,16);assert.equal(evProvinces['36'],'세종특별자치시');
  for(const action of vehicleEnergyActions)assert(action.schema.safeParse(vehicleEnergyExample(action.id)).success);
  for(const patch of [{districtCode:'0113'},{districtCode:'41110'},{provinceCode:'01'},{chargerType:'99'},{limit:9},{limit:1001},{page:0},{stationId:'../other'},{name:''},{url:'https://evil.example'},{serviceKey:secret}])assert(!evSearchSchema.safeParse({...evInput,...patch}).success);
  for(const patch of [{areaCode:'11680'},{product:'LPG'},{limit:21},{radius:5000},{apiKey:secret}])assert(!cheapestAction.schema.safeParse({...vehicleEnergyExample(cheapestAction.id),...patch}).success);
  assert(!regionsAction.schema.safeParse({provinceCode:'0113'}).success);assert(!detailAction.schema.safeParse({stationId:'A/other'}).success);
});

test('four keyless templates dispatch fixed HTTPS operations with one encoded key and no automatic followup calls',async()=>{
  for(const action of vehicleEnergyActions){
    const body=action.id===evSearchAction.id?evReply():action===regionsAction?oilReply([{AREA_CD:'0113',AREA_NM:'강남구'}]):action===cheapestAction?oilReply([station()]):oilReply([detail()]);
    const template=vehicleEnergyRequestTemplate(action.id,inputFor(action));assert(template.endpoint.startsWith('https://'));assert(!JSON.stringify(template).includes(secret));assert(!Object.hasOwn(template.query,'serviceKey'));assert(!Object.hasOwn(template.query,'certkey'));
    if(action===evSearchAction){assert.equal(template.query.zscode,'11680');assert(!Object.hasOwn(template.query,'name'));}
    let calls=0;const run=context(action);await vehicleEnergyExecutor(async(address,init)=>{calls++;const url=new URL(String(address));assert.equal(url.searchParams.get(template.authentication.queryParameter),secret);assert.equal(url.searchParams.getAll(template.authentication.queryParameter).length,1);assert.equal(url.origin,action===evSearchAction?'https://apis.data.go.kr':'https://www.opinet.co.kr');assert.equal(init?.redirect,'error');assert.equal(init?.cache,'no-store');return new Response(body);})(action,run.ctx);assert.equal(calls,1);assert.equal(run.dispatched(),1);
  }
});

test('EV preserves reported status, restrictions, deleted markers, coordinates and raw timestamps without arrival availability claims',()=>{
  const result=normalize(evSearchAction,evReply()),row=result.chargers[0];assert.equal(row.reportedStatusCode,'2');assert.equal(row.reportedStatusName,'충전대기');assert.equal(row.availableOnArrival,null);assert.equal(row.restricted,true);assert.equal(row.parkingFree,false);assert.equal(row.deleted,false);assert.equal(row.statusUpdatedAtRaw,'20261020121020');assert.equal(row.coordinates.latitude,37.500123456789);assert.equal(row.coordinates.raw.latitude,'37.500123456789');assert.equal(row.chargerTypeName,'DC콤보');assert.equal(row.outputKwRaw,'100');assert.equal(row.priceWonPerKwh,null);assert.equal(result.pagination.totalChargerCount,1);assert(result.source.attribution.includes('한국환경공단'));
  for(const status of ['0','1','3','4','5','6','9','99']){const data=normalize(evSearchAction,evReply([{...charger(),stat:status}]));assert.equal(data.chargers[0].reportedStatusCode,status);assert.equal(data.chargers[0].availableOnArrival,null);}
});

test('EV filters only received rows, keeps charger rather than station counts and exposes the next provider page after no matches',()=>{
  const rows=[charger(),{...charger(),chgerId:'02',chgerType:'02',delYn:'Y'},{...charger(),chgerId:'03',statNm:'다른 이름',chgerType:'02'}];
  const result=normalize(evSearchAction,evReply(rows,{totalCount:100}),{...evInput,name:'없는 이름'});assert.equal(result.status,'no_matches_in_page');assert.equal(result.providerRows,3);assert.equal(result.filteredOut,3);assert.equal(result.pagination.nextPage,2);assert.equal(result.pagination.totalChargerCount,100);assert.equal(result.coverage,'requested_provider_page');
  const filtered=normalize(evSearchAction,evReply(rows),{...evInput,chargerType:'02'});assert.equal(filtered.chargers.length,1);assert.equal(filtered.chargers[0].chargerId,'03');
  const deleted=normalize(evSearchAction,evReply(rows),{...evInput,includeDeleted:true});assert.equal(deleted.chargers.length,3);assert.equal(deleted.chargers[1].deleted,true);
});

test('EV accepts documented XML pagination under header, flat JSON, empty results and missing location/state metadata conservatively',()=>{
  const row=charger(),xml=`<response><header><resultCode>00</resultCode><pageNo>1</pageNo><numOfRows>10</numOfRows><totalCount>1</totalCount></header><body><items><item>${Object.entries(row).map(([k,v])=>`<${k}>${v}</${k}>`).join('')}</item></items></body></response>`;
  assert.equal(normalize(evSearchAction,xml).chargers[0].chargerKey,'ME000001:01');assert.equal(normalize(evSearchAction,evReply([])).pagination.nextPage,null);
  const missing=normalize(evSearchAction,evReply([{...row,lat:'0',lng:'0',zscode:'',statUpdDt:'00000000000000',parkingFree:'',limitYn:''}]));assert.equal(missing.chargers[0].coordinates.latitude,null);assert.equal(missing.chargers[0].statusUpdatedAtRaw,null);assert.equal(missing.chargers[0].districtFilterCheck,'not_reported');assert.equal(missing.chargers[0].restricted,null);
});

test('EV rejects conflicting regions, station IDs, duplicate charger keys, pagination, malformed timestamps and non-coordinate data',()=>{
  for(const patch of [{zcode:'41'},{zscode:'11650'},{statId:'../bad'},{lat:'not a number'},{lng:'181'},{statUpdDt:'20260229120000'},{statUpdDt:'20261020250000'},{stat:2}])assert.throws(()=>normalize(evSearchAction,evReply([{...charger(),...patch}])),hasCode('INVALID_RESPONSE'));
  for(const patch of [{pageNo:2},{numOfRows:100},{totalCount:0},{totalCount:-1},{items:{}},{items:null},{resultCode:'junk'}])assert.throws(()=>normalize(evSearchAction,evReply([charger()],patch)),hasCode('INVALID_RESPONSE'));
  assert.throws(()=>normalize(evSearchAction,evReply([charger(),charger()])),hasCode('INVALID_RESPONSE'));assert.throws(()=>normalize(evSearchAction,evReply(),{...evInput,stationId:'OTHER'}),hasCode('INVALID_RESPONSE'));
});

test('Opinet region discovery preserves leading zeroes and verifies child prefixes and unique codes',()=>{
  const result=normalize(regionsAction,oilReply([{AREA_CD:'0113',AREA_NM:'강남구'}]));assert.equal(result.regions[0].code,'0113');assert.equal(normalize(regionsAction,oilReply([{AREA_CD:'01',AREA_NM:'서울'}]),{}).regions[0].code,'01');
  for(const rows of [[{AREA_CD:'0213',AREA_NM:'다른 지역'}],[{AREA_CD:'01',AREA_NM:'시도'}],[{AREA_CD:'0113',AREA_NM:'강남구'},{AREA_CD:'0113',AREA_NM:'중복'}]])assert.throws(()=>normalize(regionsAction,oilReply(rows)),hasCode('INVALID_RESPONSE'));
});

test('Opinet cheapest stations preserve KATEC coordinates and addresses with prices per litre and unknown current conditions',()=>{
  const result=normalize(cheapestAction,oilReply([station(),{...station(),UNI_ID:'A0000002',PRICE:'1740'}])),row=result.stations[0];assert.equal(row.priceWonPerLitre,1734.5);assert.equal(row.product,'B027');assert.equal(row.brandCode,'SKE');assert.equal(row.areaCode,'0113');assert.equal(row.address,'서울 강남구 시험로 142');assert.equal(row.coordinates.crs,'KATEC');assert.equal(row.coordinates.xRaw,'314871.80000');assert.equal(row.coordinates.longitude,null);assert.equal(row.priceReportedAtRaw,null);assert.equal(row.currentlyOpen,null);assert.equal(row.fuelInStock,null);assert.equal(result.areaFilterCheck,'matched');assert(result.source.attribution.includes('오피넷'));
  assert.equal(normalize(cheapestAction,oilReply([{...station(),PRICE:'0',SIGUNCD:undefined}])).stations[0].priceWonPerLitre,null);
});

test('Opinet detail checks IDs, facility flags, independent product timestamps and unknown products without inventing values',()=>{
  const row=detail(),result=normalize(detailAction,oilReply([{...row,OIL_PRICE:[...row.OIL_PRICE,{PRODCD:'K015',PRICE:'999',TRADE_DT:'20261019',TRADE_TM:'070001'}]}]));assert.equal(result.station.facilities.carWash,true);assert.equal(result.station.facilities.convenienceStore,false);assert.equal(result.station.prices[0].tradeDateRaw,'20261020');assert.equal(result.station.prices[1].tradeDateRaw,'20261019');assert.equal(result.station.prices[1].productName,null);assert.equal(result.providerUpdatedAt,null);
  for(const patch of [{UNI_ID:'OTHER'},{OIL_PRICE:[{...row.OIL_PRICE[0],TRADE_DT:'20260229'}]},{OIL_PRICE:[row.OIL_PRICE[0],row.OIL_PRICE[0]]}])assert.throws(()=>normalize(detailAction,oilReply([{...row,...patch}])),hasCode('INVALID_RESPONSE'));
  const singleton=normalize(detailAction,'<RESULT><OIL><UNI_ID>A0010207</UNI_ID><OS_NM>시험</OS_NM><OIL_PRICE><PRODCD>B027</PRODCD><PRICE>1700</PRICE><TRADE_DT>20261020</TRADE_DT><TRADE_TM>120000</TRADE_TM></OIL_PRICE></OIL></RESULT>');assert.equal(singleton.station.prices.length,1);
});

test('Opinet refuses malformed results, conflicting brand fields, duplicate stations, wrong regions and invalid price order',()=>{
  for(const rows of [[{...station(),PRICE:'-1'}],[{...station(),POLL_DIV_CD:'SOL'}],[station(),station()],[{...station(),PRICE:'1800'},{...station(),UNI_ID:'A2',PRICE:'1700'}],[{...station(),SIGUNCD:'0213'}]])assert.throws(()=>normalize(cheapestAction,oilReply(rows)),hasCode('INVALID_RESPONSE'));
  for(const raw of ['{}','null','{"RESULT":{}}','<html>login</html>','<!DOCTYPE data [<!ENTITY x "boom">]><data/>'])assert.throws(()=>normalize(cheapestAction,raw),hasCode('INVALID_RESPONSE'));
});

test('ambiguous Opinet empty results become needs_review and never generate live account evidence',async()=>{
  let calls=0;const r=await createRuntime({dataDir:tempDir('opinet-empty-live'),port:0,vault:new TestVault(),fetcher:async()=>{calls++;return new Response(oilReply([]));}});
  try{
    const account=await r.engine.saveAccount({label:'오피넷 무효 키 시험',credentialType:'opinet-api',allowedActions:oilActions.map(a=>a.id),secrets:{apiKey:secret}});
    for(const action of oilActions){const job=r.engine.create(admin,{actionId:action.id,accountId:account.id,input:inputFor(action),idempotencyKey:randomUUID()});await r.engine.idle();const saved=r.engine.get(admin,job.id);assert.equal(saved.state,'needs_review');assert.equal(saved.error?.code,'PROVIDER_EMPTY_UNVERIFIED');assert(!JSON.stringify(saved).includes(secret));}
    assert.equal(calls,3);assert.equal(r.engine.metrics().verifiedServices,0);assert.equal(r.engine.metrics().supportedActions,0);assert.equal(r.store.list('evidence').filter((e:any)=>e.outcome==='passed').length,0);
  }finally{await r.close();}
});

test('vehicle energy sanitizes HTTP-200 gateway auth errors, HTTP faults and cancellation without leaking private URLs or retrying',async()=>{
  for(const action of [evSearchAction,cheapestAction]){
    for(const[status,code,state]of [[401,'AUTH_REQUIRED','awaiting_auth'],[403,'AUTH_REQUIRED','awaiting_auth'],[429,'PROVIDER_RATE_LIMIT','failed'],[500,'PROVIDER_HTTP_500','failed']] as const){let calls=0;await assert.rejects(()=>vehicleEnergyExecutor(async()=>{calls++;return new Response(secret,{status});})(action,context(action).ctx),hasCode(code,state));assert.equal(calls,1);}
    await assert.rejects(()=>vehicleEnergyExecutor(async()=>{throw Error(`https://provider.invalid/?key=${secret}`);})(action,context(action).ctx),hasCode('PROVIDER_CONNECTION_ERROR'));await assert.rejects(()=>vehicleEnergyExecutor(async()=>{throw new DOMException(secret,'TimeoutError');})(action,context(action).ctx),hasCode('PROVIDER_TIMEOUT'));
    const before=new AbortController(),run=context(action,inputFor(action),before);before.abort();await assert.rejects(()=>vehicleEnergyExecutor()(action,run.ctx),hasCode('CANCELLED','cancelled'));assert.equal(run.dispatched(),0);
    const during=new AbortController();await assert.rejects(()=>vehicleEnergyExecutor(async()=>{during.abort();return new Response(evReply());})(action,context(action,inputFor(action),during).ctx),hasCode('CANCELLED','cancelled'));
    const missing=context(action);missing.ctx.secrets={};await assert.rejects(()=>vehicleEnergyExecutor()(action,missing.ctx),hasCode('AUTH_REQUIRED','awaiting_auth'));assert.equal(missing.dispatched(),0);
  }
  for(const code of ['20','21','30','31','32','33'])assert.throws(()=>normalize(evSearchAction,JSON.stringify({OpenAPI_ServiceResponse:{cmmMsgHeader:{returnReasonCode:code,errMsg:secret}}})),hasCode('AUTH_REQUIRED','awaiting_auth'));
  for(const code of ['22','23'])assert.throws(()=>normalize(evSearchAction,JSON.stringify({resultCode:code})),hasCode('PROVIDER_RATE_LIMIT'));
});

test('vehicle energy bounds response streams and refuses invalid UTF-8',async()=>{
  let cancelled=false;const stream=new ReadableStream<Uint8Array>({pull(controller){controller.enqueue(new Uint8Array(1_000_001));},cancel(){cancelled=true;}});await assert.rejects(()=>vehicleEnergyExecutor(async()=>new Response(stream))(evSearchAction,context(evSearchAction).ctx),hasCode('RESULT_TOO_LARGE'));assert(cancelled);
  await assert.rejects(()=>vehicleEnergyExecutor(async()=>new Response(new Uint8Array([0xff])))(cheapestAction,context(cheapestAction).ctx),hasCode('INVALID_RESPONSE'));
});

test('EV HTTP scopes accounts, previews without calls, deduplicates and resumes expired authentication',async()=>{
  let calls=0,denied=false;const r=await createRuntime({dataDir:tempDir('energy-http'),port:0,vault:new TestVault(),evidenceMode:'mock',fetcher:async()=>{calls++;return new Response(denied?JSON.stringify({OpenAPI_ServiceResponse:{cmmMsgHeader:{returnReasonCode:'30'}}}):evReply());}});
  try{
    const cookie=await runtimeLogin(r),api=(path:string,method='GET',body?:unknown,bearer?:string)=>runtimeApi(r,`/api${path}`,method,body,cookie,bearer?{Authorization:`Bearer ${bearer}`}:{ });
    const preview=await(await api(`/drafts/${evSearchAction.id}/preview`,'POST',evInput)).json();assert.equal(preview.networkDispatched,false);assert.equal(preview.request.query.serviceKey,undefined);assert.equal(calls,0);
    const wrong=await r.engine.saveAccount({label:'오피넷 시험',credentialType:'opinet-api',allowedActions:oilActions.map(a=>a.id),secrets:{apiKey:secret}}),request={actionId:evSearchAction.id,input:evInput,accountId:wrong.id,idempotencyKey:randomUUID()};assert.equal((await(await api('/jobs','POST',request)).json()).error.code,'ACCOUNT_REQUIRED');
    const account=await r.engine.saveAccount({label:'충전소 시험',credentialType:'ev-chargers-api',allowedActions:[evSearchAction.id],secrets:{serviceKey:secret}});request.accountId=account.id;const client=r.engine.createClient({name:'EV reader',allowedActions:[evSearchAction.id],allowedAccountIds:[account.id]});
    const blocked=r.engine.createClient({name:'blocked',allowedActions:[evSearchAction.id],allowedAccountIds:[]});assert.equal((await api('/jobs','POST',request,blocked.token)).status,403);
    const job=await(await api('/jobs','POST',request,client.token)).json();await r.engine.idle();const result=await(await api(`/jobs/${job.id}`,'GET',undefined,client.token)).json();assert.equal(result.state,'succeeded');assert.equal(result.result.contentTrust,'external_data');assert(!JSON.stringify(result).includes(secret));assert.equal((await(await api('/jobs','POST',request,client.token)).json()).id,job.id);await r.engine.idle();assert.equal(calls,1);
    denied=true;const pending=await(await api('/jobs','POST',{...request,idempotencyKey:randomUUID()},client.token)).json();await r.engine.idle();assert.equal(r.engine.get(admin,pending.id).state,'awaiting_auth');denied=false;await api(`/jobs/${pending.id}/resume`,'POST',{},client.token);await r.engine.idle();assert.equal(r.engine.get(admin,pending.id).state,'succeeded');assert.equal(calls,3);assert.equal(r.engine.metrics().verifiedServices,0);
  }finally{await r.close();}
});

test('Opinet chains discovery to cheapest stations to detail with explicit account grants and no automatic provider calls',async()=>{
  let calls=0;const r=await createRuntime({dataDir:tempDir('opinet-chain'),port:0,vault:new TestVault(),evidenceMode:'mock',fetcher:async address=>{calls++;const path=new URL(String(address)).pathname;return new Response(path.endsWith('areaCode.do')?oilReply([{AREA_CD:'0113',AREA_NM:'강남구'}]):path.endsWith('lowTop10.do')?oilReply([station()]):oilReply([detail()]));}});
  try{
    const account=await r.engine.saveAccount({label:'오피넷 시험',credentialType:'opinet-api',allowedActions:oilActions.map(a=>a.id),secrets:{apiKey:secret}}),client=r.engine.createClient({name:'oil reader',allowedActions:oilActions.map(a=>a.id),allowedAccountIds:[account.id]});
    const principal=r.engine.authenticate(client.token)!;
    async function request(action:Action,input:Record<string,unknown>){const job=r.engine.create(principal,{actionId:action.id,accountId:account.id,input,idempotencyKey:randomUUID()});await r.engine.idle();const saved=r.engine.get(principal,job.id);assert.equal(saved.state,'succeeded');return (saved.result as any).data;}
    const regions=await request(regionsAction,{provinceCode:'01'}),stations=await request(cheapestAction,{areaCode:regions.regions[0].code,product:'B027',limit:10}),result=await request(detailAction,{stationId:stations.stations[0].stationId});assert.equal(result.station.stationId,'A0010207');
    await r.engine.idle();assert.equal(calls,3);assert(r.engine.jobs().every(job=>job.state==='succeeded'));assert.equal(r.engine.metrics().verifiedServices,0);assert.equal(r.engine.metrics().supportedActions,0);
  }finally{await r.close();}
});
