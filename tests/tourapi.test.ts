import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { tourapiActions, tourapiRegionsAction as regions, tourapiPlacesAction as places, tourapiFestivalsAction as festivals, tourapiRegionsSchema, tourapiPlacesSchema, tourapiFestivalsSchema, tourapiExample, tourapiRequestTemplate, tourapiExecutor } from '../src/connectors/tourapi.js';
import { createRuntime } from '../src/http.js';
import { ActionError, type Action, type ExecutionContext } from '../src/types.js';
import { TestVault, tempDir } from './helpers.js';
import { runtimeApi, runtimeLogin } from './mcp-oauth-fixture.js';

const secret='unit-tourapi-private-key+/=%&';
const input={provinceCode:'11',districtCode:'110',contentTypeId:'12',sort:'modified'};
const row=()=>({contentid:'0001234567',contenttypeid:'12',title:'시험 관광지',addr1:'시험 주소',addr2:'상세 주소',tel:'02-0000-0000',zipcode:'00123',lDongRegnCd:'11',lDongSignguCd:'110',mapx:'126.977123456789123',mapy:'37.579123456789123',createdtime:'20200101123456',modifiedtime:'20261020121212',cpyrhtDivCd:'Type3',firstimage:'https://images.example.org/not-fetched.jpg'});
const festivalRow=()=>({...row(),contenttypeid:'15',eventstartdate:'20260101',eventenddate:'20261231',progresstype:'행사연기',festivaltype:'상시'});
const festivalInput={eventStartDate:'2026-10-01',eventEndDate:'2026-10-31',provinceCode:'11'};
const reply=(rows:unknown[]|unknown=[row()],total=Array.isArray(rows)?rows.length:1,page=1,limit=10)=>JSON.stringify({response:{header:{resultCode:'0000',resultMsg:'OK'},body:{items:{item:rows},totalCount:total,pageNo:page,numOfRows:limit}}});
function context(values:Record<string,unknown>=input,action=places,controller=new AbortController()){
  let count=0;const now=new Date().toISOString();
  const ctx:ExecutionContext={job:{id:randomUUID(),clientId:'local-admin',actionId:action.id,input:values,idempotencyKey:randomUUID(),requestHash:'test',effect:'read',state:'running',revision:1,dispatched:false,createdAt:now,updatedAt:now,interventions:0,events:[]},secrets:{serviceKey:secret},signal:controller.signal,dispatch(){count++;}};
  return{ctx,dispatched:()=>count};
}
const execute=async(body=reply(),values:Record<string,unknown>=input,action=places)=>(await tourapiExecutor(async()=>new Response(body))(action,context(values,action).ctx)).data as Record<string,any>;
const hasCode=(code:string,state='failed')=>(error:unknown)=>error instanceof ActionError && error.code===code && error.state===state && !error.message.includes(secret);
const xml=(rows:string,total=1,page=1,limit=10)=>`<response><header><resultCode>00</resultCode></header><body><items>${rows}</items><totalCount>${total}</totalCount><pageNo>${page}</pageNo><numOfRows>${limit}</numOfRows></body></response>`;

test('TourAPI accepts current legal-dong codes and bounded pages while rejecting deprecated codes, extra URLs and keys',()=>{
  assert(tourapiRegionsSchema.safeParse({}).success);assert(tourapiRegionsSchema.safeParse({provinceCode:'11'}).success);assert(tourapiPlacesSchema.safeParse(input).success);
  assert.equal(tourapiPlacesSchema.parse({}).contentTypeId,'12');assert(tourapiPlacesSchema.safeParse({...input,districtCode:'011'}).success);
  for(const value of [{provinceCode:'1'},{provinceCode:'110000'},{provinceCode:11},{districtCode:'110'},{...input,districtCode:'11110'},{...input,districtCode:'1111'},{contentTypeId:'99'},{sort:'O'},{areaCode:'1'},{sigunguCode:'1'},{MobileApp:'other'},{serviceKey:secret},{url:'http://localhost'},{page:1001},{limit:101}])assert(!tourapiPlacesSchema.safeParse(value).success,JSON.stringify(value));
  assert(!tourapiRegionsSchema.safeParse({lDongListYn:'Y'}).success);
});

test('TourAPI validates calendar dates without importing KOPIS 31-day limits and computes Seoul year examples',()=>{
  assert(tourapiFestivalsSchema.safeParse({eventStartDate:'2024-02-29',eventEndDate:'2024-12-31'}).success);assert(tourapiFestivalsSchema.safeParse({eventStartDate:'2026-10-20'}).success);
  for(const value of [{},{eventStartDate:'2026-02-29'},{eventStartDate:'20261020'},{eventStartDate:'2026-10-20',eventEndDate:'2026-10-19'},{...festivalInput,districtCode:'110',provinceCode:undefined},{...festivalInput,startDate:'2026-10-20'}])assert(!tourapiFestivalsSchema.safeParse(value).success);
  assert.equal(tourapiExample(festivals.id,new Date('2026-12-31T15:00:00Z')).eventStartDate,'2027-01-01');assert.equal(tourapiExample(festivals.id,new Date('2026-12-31T14:59:59Z')).eventEndDate,'2026-12-31');
});

test('TourAPI templates use only reviewed KorService2 operations, legal-dong filters and key-free single request mappings',async()=>{
  const scenarios:[Action,Record<string,unknown>,string][]=[[regions,{provinceCode:'11'},'ldongCode2'],[places,input,'areaBasedList2'],[festivals,festivalInput,'searchFestival2']];let calls=0;
  for(const[action,values,operation]of scenarios){
    const template=tourapiRequestTemplate(action.id,values);assert.equal(template.endpoint,`https://apis.data.go.kr/B551011/KorService2/${operation}`);assert(!('serviceKey'in template.query));assert(!('areaCode'in template.query));assert(!JSON.stringify(template).includes(secret));
    const run=context(values,action);await tourapiExecutor(async(address,init)=>{calls++;const url=new URL(String(address));assert.equal(url.origin,'https://apis.data.go.kr');assert.equal(init?.redirect,'error');assert.equal(init?.cache,'no-store');assert.equal(url.searchParams.get('MobileOS'),'WEB');assert.equal(url.searchParams.get('MobileApp'),'KoreAI');assert.equal(url.searchParams.get('_type'),'json');assert.equal(url.searchParams.get('serviceKey'),secret);assert.equal(url.searchParams.get('lDongRegnCd'),'11');
      if(action===regions){assert.equal(url.searchParams.get('lDongListYn'),'N');return new Response(reply([{code:'110',name:'종로구'}]));}
      if(action===festivals){assert.equal(url.searchParams.get('eventStartDate'),'20261001');assert.equal(url.searchParams.get('eventEndDate'),'20261031');assert.equal(url.searchParams.has('contentTypeId'),false);return new Response(reply([festivalRow()]));}
      assert.equal(url.searchParams.get('arrange'),'C');assert.equal(url.searchParams.get('lDongSignguCd'),'110');assert.equal(url.searchParams.get('contentTypeId'),'12');return new Response(reply());
    })(action,run.ctx);assert.equal(run.dispatched(),1);
  }
  assert.equal(calls,3);
});

test('TourAPI region discovery returns two-level provider codes and real pagination rather than a fixed city snapshot',async()=>{
  const provinces=await execute(reply([{code:'11',name:'서울특별시'}]),{},regions);assert.deepEqual(provinces.regions,[{code:'11',name:'서울특별시',level:'province',provinceCode:'11'}]);
  const districts=await execute(reply({code:'110',name:'종로구'},25,1,1),{provinceCode:'11',limit:1},regions);assert.deepEqual(districts.regions,[{code:'110',name:'종로구',level:'district',provinceCode:'11'}]);assert.equal(districts.pagination.nextPage,2);
  await assert.rejects(()=>execute(reply([{code:'1',name:'구 지역코드'}]),{},regions),hasCode('INVALID_RESPONSE'));
  await assert.rejects(()=>execute(reply([{code:'11110',name:'전체 5자리'}]),{provinceCode:'11'},regions),hasCode('INVALID_RESPONSE'));
});

test('TourAPI retains IDs, postal zeroes, GPS precision, raw timestamps and copyright without images or availability claims',async()=>{
  const result=await execute(),place=result.places[0];assert.equal(place.contentId,'0001234567');assert.equal(place.postalCode,'00123');assert.equal(place.coordinates.raw.x,row().mapx);assert.equal(place.coordinates.longitude,Number(row().mapx));assert.equal(place.coordinates.crs,'EPSG:4326');assert.equal(place.providerUpdatedAtRaw,'20261020121212');assert.equal(place.copyrightTypeRaw,'Type3');
  assert.equal(place.currentlyOpen,null);assert.equal(place.reservationAvailable,null);assert.equal(result.providerUpdatedAt,null);assert(result.source.attribution.includes('한국관광공사'));assert(!('firstimage'in place));assert(!JSON.stringify(result).includes('not-fetched'));
  const sparse=await execute(reply([{contentid:'1',contenttypeid:'12',title:'최소 정보'}]),{});assert.equal(sparse.places[0].coordinates.longitude,null);assert.equal(sparse.places[0].providerUpdatedAtRaw,null);
  const zero=await execute(reply([{...row(),mapx:'0',mapy:'0'}]));assert.equal(zero.places[0].coordinates.longitude,null);assert.equal(zero.places[0].coordinates.raw.x,'0');
});

test('TourAPI festivals preserve cancellation and period outside request dates without inventing overlap filtering or current status',async()=>{
  const result=await execute(reply([festivalRow()]),festivalInput,festivals),festival=result.festivals[0];assert.equal(festival.startDate,'2026-01-01');assert.equal(festival.endDate,'2026-12-31');assert.equal(festival.progressTypeRaw,'행사연기');assert.equal(festival.festivalTypeRaw,'상시');assert.equal(festival.currentlyHappening,null);assert(result.dataNote.includes('겹치는 모든 행사'));
  const noDates=await execute(reply([{...festivalRow(),eventstartdate:'00000000',eventenddate:''}]),festivalInput,festivals);assert.equal(noDates.festivals[0].startDate,null);assert.equal(noDates.festivals[0].endDate,null);
  for(const patch of [{eventstartdate:'20260229'},{eventenddate:'20250101'},{contenttypeid:'12'}])await assert.rejects(()=>execute(reply([{...festivalRow(),...patch}]),festivalInput,festivals),hasCode('INVALID_RESPONSE'));
});

test('TourAPI handles empty pages, no-data headers and XML while checking page echoes, counts, IDs and filters',async()=>{
  const empty=await execute(reply([],0));assert.equal(empty.status,'no_data');assert.equal(empty.pagination.totalCount,0);assert.equal(empty.pagination.nextPage,null);
  const past=await execute(reply([],1,2),{...input,page:2});assert.equal(past.pagination.totalCount,1);assert.equal(past.pagination.page,2);
  const header=await execute(JSON.stringify({response:{header:{resultCode:'03'}}}));assert.equal(header.status,'no_data');assert.equal(header.pagination.totalCount,null);
  const xmlResult=await execute(xml('<item><code>11</code><name>서울특별시</name></item>'),{},regions);assert.equal(xmlResult.regions[0].code,'11');
  for(const body of [reply([row()],2),reply([row()],1,2),reply([row()],1,1,9),reply([row(),row()],2),reply([{...row(),lDongRegnCd:'26'}]),reply([{...row(),lDongSignguCd:'140'}]),reply([{...row(),contenttypeid:'14'}]),reply([{...row(),mapx:'181'}]),reply([{...row(),mapy:'1e2'}]),reply([{...row(),mapx:'NaN',mapy:''}])])await assert.rejects(()=>execute(body),hasCode('INVALID_RESPONSE'));
});

test('TourAPI sanitizes JSON/XML gateway and normal-header errors including HTTP-200 auth, quota and unknown codes',async()=>{
  for(const code of ['20','21','30','31','32','33']){
    const normal=JSON.stringify({response:{header:{resultCode:code,resultMsg:secret}}});await assert.rejects(()=>execute(normal),hasCode('AUTH_REQUIRED','awaiting_auth'));
    const gateway=JSON.stringify({OpenAPI_ServiceResponse:{cmmMsgHeader:{returnReasonCode:code,returnAuthMsg:secret}}});await assert.rejects(()=>execute(gateway),hasCode('AUTH_REQUIRED','awaiting_auth'));
  }
  await assert.rejects(()=>execute(`<OpenAPI_ServiceResponse><cmmMsgHeader><returnReasonCode>30</returnReasonCode><errMsg>${secret.replaceAll('&','&amp;')}</errMsg></cmmMsgHeader></OpenAPI_ServiceResponse>`),hasCode('AUTH_REQUIRED','awaiting_auth'));
  for(const[code,error]of [['22','PROVIDER_RATE_LIMIT'],['23','PROVIDER_RATE_LIMIT'],['29','PROVIDER_ACCESS_BLOCKED'],['99','PROVIDER_99']])await assert.rejects(()=>execute(JSON.stringify({response:{header:{resultCode:code,resultMsg:secret}}})),hasCode(error));
});

test('TourAPI rejects malformed or unsafe payloads, oversized streams and invalid UTF-8 without returning provider text',async()=>{
  for(const body of ['{','{}','<html>login</html>','<response><header></response>','<!DOCTYPE response [<!ENTITY x "boom">]><response/>',JSON.stringify({response:{header:{resultCode:0}}}),reply([{...row(),contentid:'../private'}])])await assert.rejects(()=>execute(body),hasCode('INVALID_RESPONSE'));
  await assert.rejects(()=>tourapiExecutor(async()=>new Response(new Uint8Array([0xff])))(places,context().ctx),hasCode('INVALID_RESPONSE'));
  let cancelled=false;const stream=new ReadableStream<Uint8Array>({pull(c){c.enqueue(new Uint8Array(1_000_001));},cancel(){cancelled=true;}});await assert.rejects(()=>tourapiExecutor(async()=>new Response(stream))(places,context().ctx),hasCode('RESULT_TOO_LARGE'));assert.equal(cancelled,true);
});

test('TourAPI refuses missing credentials, handles HTTP and timeout failures and cancels before or during dispatch',async()=>{
  for(const[status,code,state]of [[401,'AUTH_REQUIRED','awaiting_auth'],[403,'AUTH_REQUIRED','awaiting_auth'],[429,'PROVIDER_RATE_LIMIT','failed'],[503,'PROVIDER_HTTP_503','failed']]as const)await assert.rejects(()=>tourapiExecutor(async()=>new Response(secret,{status}))(places,context().ctx),hasCode(code,state));
  await assert.rejects(()=>tourapiExecutor(async()=>{throw new Error(`https://other.example/?serviceKey=${secret}`);})(places,context().ctx),hasCode('PROVIDER_CONNECTION_ERROR'));
  await assert.rejects(()=>tourapiExecutor(async()=>{throw new DOMException(secret,'TimeoutError');})(places,context().ctx),hasCode('PROVIDER_TIMEOUT'));
  for(const key of ['', 'bad\nkey']){const run=context();run.ctx.secrets.serviceKey=key;await assert.rejects(()=>tourapiExecutor()(places,run.ctx),hasCode('AUTH_REQUIRED','awaiting_auth'));assert.equal(run.dispatched(),0);}
  const before=new AbortController(),run=context(input,places,before);before.abort();await assert.rejects(()=>tourapiExecutor()(places,run.ctx),hasCode('CANCELLED','cancelled'));assert.equal(run.dispatched(),0);
  const during=new AbortController();await assert.rejects(()=>tourapiExecutor(async()=>{during.abort();throw Error(secret);})(places,context(input,places,during).ctx),hasCode('CANCELLED','cancelled'));
  await assert.rejects(()=>tourapiExecutor()({...places,id:'tourapi.reservations.buy'},context().ctx),hasCode('NOT_IMPLEMENTED'));
});

test('TourAPI HTTP chains regions to places and festivals with scoped grants, keyless previews, deduplication and auth resume',async()=>{
  let calls=0,denied=false;const r=await createRuntime({dataDir:tempDir('tourapi-http'),port:0,vault:new TestVault(),evidenceMode:'mock',fetcher:async address=>{
    calls++;const url=new URL(String(address));return new Response(denied?JSON.stringify({response:{header:{resultCode:'30',resultMsg:secret}}}):url.pathname.endsWith('ldongCode2')?reply([{code:'110',name:'종로구'}]):url.pathname.endsWith('searchFestival2')?reply([festivalRow()]):reply());
  }});
  try{
    const cookie=await runtimeLogin(r),api=(path:string,method='GET',body?:unknown,bearer?:string)=>runtimeApi(r,`/api${path}`,method,body,cookie,bearer?{Authorization:`Bearer ${bearer}`}:{ });
    for(const action of tourapiActions){const preview=await(await api(`/drafts/${action.id}/preview`,'POST',tourapiExample(action.id))).json();assert.equal(preview.networkDispatched,false);assert.equal(preview.request.query.serviceKey,undefined);assert.equal(preview.request.authentication.queryParameter,'serviceKey');}assert.equal(calls,0);
    const request={actionId:regions.id,input:{provinceCode:'11'}as Record<string,unknown>,accountId:'',idempotencyKey:randomUUID()};
    const wrong=await r.engine.saveAccount({label:'HIRA 시험',credentialType:'hira-api',allowedActions:['hira.hospitals.search'],secrets:{serviceKey:secret}});request.accountId=wrong.id;assert.equal((await(await api('/jobs','POST',request)).json()).error.code,'ACCOUNT_REQUIRED');assert.equal(calls,0);
    const account=await r.engine.saveAccount({label:'TourAPI 시험',credentialType:'tourapi-api',allowedActions:tourapiActions.map(a=>a.id),secrets:{serviceKey:secret}});request.accountId=account.id;
    const client=r.engine.createClient({name:'tour reader',allowedActions:tourapiActions.map(a=>a.id),allowedAccountIds:[account.id]});
    for(const limits of [{allowedActions:[regions.id],allowedAccountIds:[]},{allowedActions:[places.id],allowedAccountIds:[account.id]}]){const blocked=r.engine.createClient({name:'blocked',...limits});assert.equal((await api('/jobs','POST',request,blocked.token)).status,403);}
    let lastId='';
    for(const action of tourapiActions){request.actionId=action.id;request.idempotencyKey=randomUUID();request.input=action===regions?{provinceCode:'11'}:action===places?input:festivalInput;
      const response=await api('/jobs','POST',request,client.token);assert.equal(response.status,202);const job=await response.json();lastId=job.id;await r.engine.idle();const result=await(await api(`/jobs/${job.id}`,'GET',undefined,client.token)).json();assert.equal(result.state,'succeeded');assert.equal(result.result.contentTrust,'external_data');assert(!JSON.stringify(result).includes(secret));
      if(action===regions)assert.equal(result.result.data.regions[0].code,'110');
    }
    const duplicate=await(await api('/jobs','POST',request,client.token)).json();await r.engine.idle();assert.equal(duplicate.id,lastId);assert.equal(calls,3);
    denied=true;const pending=await(await api('/jobs','POST',{...request,idempotencyKey:randomUUID()},client.token)).json();await r.engine.idle();assert.equal((await(await api(`/jobs/${pending.id}`,'GET',undefined,client.token)).json()).state,'awaiting_auth');denied=false;await api(`/jobs/${pending.id}/resume`,'POST',{},client.token);await r.engine.idle();assert.equal((await(await api(`/jobs/${pending.id}`,'GET',undefined,client.token)).json()).state,'succeeded');assert.equal(calls,5);assert.equal(r.engine.metrics().verifiedServices,0);assert.equal(r.engine.metrics().supportedActions,0);
  }finally{await r.close();}
});
