import { XMLParser, XMLValidator } from 'fast-xml-parser';
import { z } from 'zod';
import { zodToJsonSchema } from 'zod-to-json-schema';
import { ActionError, type Action, type Executor } from '../types.js';

const evSource='https://www.data.go.kr/data/15076352/openapi.do';
const oilSource='https://www.opinet.co.kr/user/custapi/openApiInfo.do';
export const evProvinces={'11':'서울특별시','12':'전남광주통합특별시','26':'부산광역시','27':'대구광역시','28':'인천광역시','30':'대전광역시','31':'울산광역시','36':'세종특별자치시','41':'경기도','43':'충청북도','44':'충청남도','47':'경상북도','48':'경상남도','50':'제주특별자치도','51':'강원특별자치도','52':'전북특별자치도'} as const;
export const evChargerTypes={'01':'DC차데모','02':'AC완속','03':'DC차데모+AC3상','04':'DC콤보','05':'DC차데모+DC콤보','06':'DC차데모+AC3상+DC콤보','07':'AC3상','08':'DC콤보(완속)','09':'NACS','10':'DC콤보+NACS','11':'DC콤보2(버스전용)'} as const;
const statuses:Record<string,string>={'0':'알수없음','1':'통신이상','2':'충전대기','3':'충전중','4':'운영중지','5':'점검중','6':'예약중','9':'상태미확인'};
const province=z.enum(Object.keys(evProvinces) as [keyof typeof evProvinces,...(keyof typeof evProvinces)[]]);
const stationId=z.string().regex(/^[A-Za-z0-9]{1,8}$/),chargerId=z.string().regex(/^[A-Za-z0-9]{1,4}$/);
export const evSearchSchema=z.object({provinceCode:province,districtCode:z.string().regex(/^\d{5}$/).optional().describe('가이드 zscode 5자리. 예: 강남구 11680. 시도 코드와 앞 두 자리 일치'),
  stationId:stationId.optional(),name:z.string().trim().min(1).max(100).optional().describe('받은 한 페이지 안에서 충전소명 부분일치. 전체 지역 이름 검색이 아님'),
  chargerType:z.enum(Object.keys(evChargerTypes) as [keyof typeof evChargerTypes,...(keyof typeof evChargerTypes)[]]).optional().describe('받은 한 페이지 안에서 적용하는 충전기 타입 필터'),
  includeDeleted:z.boolean().default(false),page:z.number().int().min(1).max(1000).default(1),limit:z.number().int().min(10).max(1000).default(100),
}).strict().refine(input=>!input.districtCode || input.districtCode.startsWith(input.provinceCode),'시군구 코드와 시도 코드가 일치해야 합니다.');
const oilArea=z.string().regex(/^\d{2}(?:\d{2})?$/).describe('오피넷 지역코드 조회 결과. 시도 2자리/시군구 4자리. 행정구역 코드와 다름');
export const oilProducts={B027:'휘발유',D047:'자동차경유',B034:'고급휘발유'} as const;
const product=z.enum(['B027','D047','B034']);
export const oilRegionsSchema=z.object({provinceCode:z.string().regex(/^\d{2}$/).optional()}).strict();
export const oilCheapestSchema=z.object({areaCode:oilArea,product:product.default('B027'),limit:z.number().int().min(1).max(20).default(10)}).strict();
export const oilDetailSchema=z.object({stationId:z.string().regex(/^[A-Za-z0-9]{1,20}$/)}).strict();
function action(id:string,title:string,description:string,schema:z.ZodTypeAny,ev=false,sourceUrl=oilSource):Action{
  return{id,serviceId:ev?'ev-chargers':'opinet',connectorId:ev?'ev-chargers-api':'opinet-api',title,description,category:'지도·교통',effect:'read',method:'api',schema,inputSchema:zodToJsonSchema(schema,{$refStrategy:'none'}) as Record<string,unknown>,
    credentialType:ev?'ev-chargers-api':'opinet-api',requiredSecrets:[ev?'serviceKey':'apiKey'],scopes:[],sourceUrl,checkedAt:'2026-10-20',verification:'documented',
    resultCheck:ev?'결과 코드·페이지/전체 수·지역/충전소 ID·충전기 복합 키·좌표·상태/제한/삭제 원문을 검증합니다. 상태 변경 시각과 도착 시 이용 가능 여부를 구분합니다.':'고정 HTTPS·RESULT/OIL·ID/지역 코드·가격/기준 시각을 검증합니다. 빈 OIL은 무효 키와 결과 부재를 구분할 수 없어 결과 확인 필요로 중단하고 성공 증거를 생성하지 않습니다.',
    domains:[ev?'apis.data.go.kr':'www.opinet.co.kr'],version:'0.1.0',maintainer:'KoreAI',origin:'bundled',implemented:true};
}
export const evSearchAction=action('ev-chargers.search','전기차 충전소 찾기','지역·시군구·충전소 ID로 충전기 한 페이지를 조회합니다. 주소·WGS84 위치·충전기 타입·보고된 상태/변경 시각·이용제한을 반환합니다. 이름/타입/삭제 필터는 이 페이지 안에서 적용합니다.',evSearchSchema,true,evSource);
export const oilActions=[
  action('opinet.regions.list','오피넷 지역코드 찾기','시도 또는 선택한 시도의 시군구 코드를 조회합니다. 충전소 행정구역 코드와 혼용하지 않습니다.',oilRegionsSchema,false,'https://www.opinet.co.kr/user/custapi/openApiInfoDtl.do?apiId=5'),
  action('opinet.stations.cheapest','지역별 저렴한 주유소 찾기','오피넷 지역코드·휘발유/경유/고급휘발유로 저가순 최대 20개를 조회합니다. 주소·보고 가격·KATEC 원문 좌표를 반환하며 거리순·실시간 결제가와 구분합니다.',oilCheapestSchema,false,'https://www.opinet.co.kr/user/custapi/openApiInfoDtl.do?apiId=2'),
  action('opinet.stations.get','주유소 상세·유종별 가격 조회','조회 결과의 주유소 ID로 주소·전화·시설과 유종별 보고 가격/기준 일시를 조회합니다. 영업·재고·현장 결제 가능을 확정하지 않습니다.',oilDetailSchema,false,'https://www.opinet.co.kr/user/custapi/openApiInfoDtl.do?apiId=1'),
];
export const vehicleEnergyActions=[evSearchAction,...oilActions];
function findAction(id:string){const found=vehicleEnergyActions.find(item=>item.id===id);if(!found)throw new ActionError('NOT_IMPLEMENTED','차량 에너지 실행기에 등록되지 않은 행동입니다.');return found;}
export function vehicleEnergyExample(id:string):Record<string,unknown>{
  findAction(id);if(id===evSearchAction.id)return{provinceCode:'11',districtCode:'11680',page:1,limit:100};
  if(id==='opinet.regions.list')return{provinceCode:'01'};if(id==='opinet.stations.cheapest')return{areaCode:'0113',product:'B027',limit:10};return{stationId:'A0010207'};
}
export function vehicleEnergyRequestTemplate(id:string,raw:unknown){
  const selected=findAction(id),input=selected.schema.parse(raw),query:Record<string,string|number>={};let endpoint:string;
  if(id===evSearchAction.id){endpoint='https://apis.data.go.kr/B552584/EvCharger/getChargerInfo';Object.assign(query,{dataType:'JSON',pageNo:input.page,numOfRows:input.limit,zcode:input.provinceCode});if(input.districtCode)query.zscode=input.districtCode;if(input.stationId)query.statId=input.stationId;}
  else{query.out='json';if(id==='opinet.regions.list'){endpoint='https://www.opinet.co.kr/api/areaCode.do';if(input.provinceCode)query.area=input.provinceCode;}
    else if(id==='opinet.stations.cheapest'){endpoint='https://www.opinet.co.kr/api/lowTop10.do';Object.assign(query,{area:input.areaCode,prodcd:input.product,cnt:input.limit});}
    else{endpoint='https://www.opinet.co.kr/api/detailById.do';query.id=input.stationId;}}
  return{method:'GET' as const,endpoint,query,authentication:{secretField:id===evSearchAction.id?'serviceKey' as const:'apiKey' as const,queryParameter:id===evSearchAction.id?'serviceKey':'certkey'},responseFormat:'json' as const};
}
const invalid=()=>new ActionError('INVALID_RESPONSE','차량 에너지 API 응답 구조·식별자·지역·페이지·숫자 또는 날짜가 유효하지 않습니다.');
const parser=new XMLParser({parseTagValue:false,trimValues:true,ignoreAttributes:true,ignoreDeclaration:true,processEntities:false});
function parse(raw:string):any{
  try{if(raw.trimStart().startsWith('<')){if(/<!\s*(?:DOCTYPE|ENTITY)\b/i.test(raw) || XMLValidator.validate(raw)!==true)throw invalid();return parser.parse(raw);}return JSON.parse(raw);}catch{throw invalid();}
}
const text=z.string().max(3000),optionalText=text.nullish(),id=z.string().min(1).max(40);
const numeric=z.union([z.number().finite(),z.string().regex(/^-?\d+(?:\.\d+)?$/).transform(Number)]).pipe(z.number().finite());
const integer=numeric.pipe(z.number().int().nonnegative().safe());
function timestamp(raw:string|null|undefined){
  if(!raw || /^0+$/.test(raw))return null;
  if(!/^\d{14}$/.test(raw))throw invalid();const date=`${raw.slice(0,4)}-${raw.slice(4,6)}-${raw.slice(6,8)}T${raw.slice(8,10)}:${raw.slice(10,12)}:${raw.slice(12,14)}Z`;
  if(!Number.isFinite(Date.parse(date)) || new Date(date).toISOString().slice(0,19)!==date.slice(0,19))throw invalid();return raw;
}
const flag=(raw?:string|null)=>raw==='Y'?true:raw==='N'?false:null;
function gatewayError(root:any){
  if(!root?.OpenAPI_ServiceResponse)return;
  const code=root.OpenAPI_ServiceResponse.cmmMsgHeader?.returnReasonCode;if(typeof code!=='string' || !/^\d{1,2}$/.test(code))throw invalid();
  if(['20','21','30','31','32','33'].includes(code.padStart(2,'0')))throw new ActionError('AUTH_REQUIRED','전기차 충전소 정보 서비스 활용신청·승인·일반 인증키(Decoding)를 확인한 뒤 재개하세요.','awaiting_auth');
  if(['22','23'].includes(code))throw new ActionError('PROVIDER_RATE_LIMIT','전기차 충전소 API 호출 한도를 초과했습니다.');throw new ActionError(`PROVIDER_${code}`,'전기차 충전소 API가 정상 결과를 반환하지 않았습니다.');
}
const chargerRow=z.object({statId:stationId,chgerId:chargerId,statNm:text.min(1),chgerType:id,addr:text,addrDetail:optionalText,location:optionalText,lat:z.union([z.string(),z.number()]).nullish(),lng:z.union([z.string(),z.number()]).nullish(),
  useTime:optionalText,busiId:optionalText,bnm:optionalText,busiNm:optionalText,busiCall:optionalText,stat:z.string().regex(/^\d{1,2}$/),statUpdDt:optionalText,
  output:optionalText,method:optionalText,zcode:z.string().regex(/^\d{2}$/),zscode:z.string().regex(/^\d{5}$/).or(z.literal('')).nullish(),parkingFree:optionalText,note:optionalText,limitYn:optionalText,limitDetail:optionalText,delYn:optionalText,delDetail:optionalText});
function coordinates(row:z.infer<typeof chargerRow>){
  const raw={latitude:row.lat??null,longitude:row.lng??null};if(row.lat===null || row.lat===undefined || row.lat==='' || row.lng===null || row.lng===undefined || row.lng==='')return{crs:'WGS84',latitude:null,longitude:null,raw};
  const latitude=numeric.safeParse(row.lat),longitude=numeric.safeParse(row.lng);if(!latitude.success || !longitude.success)throw invalid();
  if(latitude.data===0 || longitude.data===0)return{crs:'WGS84',latitude:null,longitude:null,raw};if(latitude.data< -90 || latitude.data>90 || longitude.data< -180 || longitude.data>180)throw invalid();
  return{crs:'WGS84',latitude:latitude.data,longitude:longitude.data,raw};
}
function normalizeEv(root:any,rawInput:unknown){
  const input=evSearchSchema.parse(rawInput);gatewayError(root);
  // The guide uses flat JSON and XML with pagination under response/header.
  const wrapped=root?.response,header=wrapped?.header??root;
  const meta=z.object({resultCode:z.string(),pageNo:integer.optional(),numOfRows:integer.optional(),totalCount:integer.optional()}).safeParse(header);if(!meta.success)throw invalid();
  if(meta.data.resultCode!=='00'){const code=meta.data.resultCode;if(['20','21','30','31','32','33'].includes(code))throw new ActionError('AUTH_REQUIRED','전기차 충전소 API 키·승인 상태를 확인한 뒤 재개하세요.','awaiting_auth');if(['22','23'].includes(code))throw new ActionError('PROVIDER_RATE_LIMIT','전기차 충전소 API 호출 한도를 초과했습니다.');if(!/^\d{1,2}$/.test(code))throw invalid();throw new ActionError(`PROVIDER_${code}`,'전기차 충전소 API가 정상 결과를 반환하지 않았습니다.');}
  const {pageNo:page,numOfRows:limit,totalCount:total}=meta.data;if(page!==input.page || limit!==input.limit || total===undefined)throw invalid();
  const items=wrapped?.body?.items??root.items;let rows:unknown[];
  if(items===null || items==='' || items===undefined){if(total!==0)throw invalid();rows=[];}
  else if(typeof items==='object' && !Array.isArray(items) && 'item'in items){rows=items.item==='' || items.item===null?[]:Array.isArray(items.item)?items.item:[items.item];}
  else throw invalid();
  const result=z.array(chargerRow).max(input.limit).safeParse(rows);if(!result.success)throw invalid();const offset=(input.page-1)*input.limit;
  if(result.data.length && total<offset+result.data.length || total===0 && result.data.length)throw invalid();
  const seen=new Set<string>();const all=result.data.map(row=>{
    const key=`${row.statId}:${row.chgerId}`;if(seen.has(key) || row.zcode!==input.provinceCode || input.stationId && row.statId!==input.stationId || input.districtCode && row.zscode && row.zscode!==input.districtCode)throw invalid();seen.add(key);
    return{chargerKey:key,stationId:row.statId,chargerId:row.chgerId,stationName:row.statNm,address:row.addr,addressDetail:row.addrDetail||null,location:row.location||null,coordinates:coordinates(row),
      chargerTypeCode:row.chgerType,chargerTypeName:evChargerTypes[row.chgerType as keyof typeof evChargerTypes]??'미등록 타입',outputKwRaw:row.output||null,chargingMethodRaw:row.method||null,
      reportedStatusCode:row.stat,reportedStatusName:statuses[row.stat]??'미등록 상태',statusUpdatedAtRaw:timestamp(row.statUpdDt),useTimeRaw:row.useTime||null,
      operator:{id:row.busiId||null,name:row.busiNm||row.bnm||null,phone:row.busiCall||null},provinceCode:row.zcode,districtCode:row.zscode||null,districtFilterCheck:input.districtCode?row.zscode?'matched':'not_reported':'not_requested',
      parkingFree:flag(row.parkingFree),restricted:flag(row.limitYn),restrictionDetail:row.limitDetail||null,deleted:flag(row.delYn),deletionDetail:row.delDetail||null,note:row.note||null,availableOnArrival:null,priceWonPerKwh:null};
  });
  const chargers=all.filter(row=>(input.includeDeleted || row.deleted!==true) && (!input.name || row.stationName.toLocaleLowerCase().includes(input.name.toLocaleLowerCase())) && (!input.chargerType || row.chargerTypeCode===input.chargerType));
  return{status:chargers.length?'available':'no_matches_in_page',chargers,returnedCount:chargers.length,providerRows:all.length,filteredOut:all.length-chargers.length,query:input,
    coverage:'requested_provider_page',pagination:{page,limit,totalChargerCount:total,nextPage:offset+all.length<total && all.length>0 && page<1000?page+1:null},retrievedAt:new Date().toISOString(),
    dataNote:'전체 건수는 충전기 수이며 충전소 수가 아닙니다. 이름/타입/삭제 필터는 받은 한 페이지에만 적용하고 삭제 기록은 기본 제외합니다. 빈 필터 결과가 지역 내 충전소 부재를 뜻하지 않습니다. 상태는 공급자 보고값이며 변경 시각이 오래됐거나 이용 제한·안내가 있으면 현장 확인이 필요합니다. 도착 시 사용 가능·차량 호환성·현재 요금·예약은 확정하지 않습니다. 상태 시각은 공급자 원문이며 시간대를 추정하지 않습니다.',
    source:{name:'한국환경공단 전기자동차 충전소 정보',url:evSource,attribution:'출처: 한국환경공단, 공공데이터포털 전기자동차 충전소 정보'}};
}
const oilBase=z.object({UNI_ID:id,OS_NM:text.min(1),POLL_DIV_CD:optionalText,POLL_DIV_CO:optionalText,VAN_ADR:optionalText,NEW_ADR:optionalText,TEL:optionalText,SIGUNCD:optionalText,
  GIS_X_COOR:z.union([z.string(),z.number()]).nullish(),GIS_Y_COOR:z.union([z.string(),z.number()]).nullish()});
const oilPrice=z.object({PRODCD:id,PRICE:numeric.pipe(z.number().min(0).max(100_000)),TRADE_DT:z.string().regex(/^\d{8}$/),TRADE_TM:z.string().regex(/^\d{6}$/)});
function oilStation(row:z.infer<typeof oilBase>){
  if(row.POLL_DIV_CD && row.POLL_DIV_CO && row.POLL_DIV_CD!==row.POLL_DIV_CO)throw invalid();
  const x=row.GIS_X_COOR,y=row.GIS_Y_COOR;for(const value of [x,y])if(value!==null && value!==undefined && value!=='' && !numeric.safeParse(value).success)throw invalid();
  return{stationId:row.UNI_ID,name:row.OS_NM,brandCode:row.POLL_DIV_CD||row.POLL_DIV_CO||null,address:row.NEW_ADR||row.VAN_ADR||null,roadAddress:row.NEW_ADR||null,lotAddress:row.VAN_ADR||null,phone:row.TEL||null,areaCode:row.SIGUNCD||null,
    coordinates:{crs:'KATEC',xRaw:x??null,yRaw:y??null,latitude:null,longitude:null},currentlyOpen:null,fuelInStock:null};
}
function normalizeOil(root:any,selected:Action,rawInput:unknown){
  const input=selected.schema.parse(rawInput);if(!root || typeof root!=='object' || !root.RESULT || !Object.hasOwn(root.RESULT,'OIL'))throw invalid();
  const oil=root.RESULT.OIL,rows=oil===null || oil===''?[]:Array.isArray(oil)?oil:[oil];
  if(!rows.length)throw new ActionError('PROVIDER_EMPTY_UNVERIFIED','오피넷이 빈 목록을 반환했습니다. 무효 키도 같은 응답을 반환하므로 자료 부재나 인증 성공으로 판정하지 않습니다. 본인 키·신청·조회 조건을 확인하세요.','needs_review');
  const common={query:input,retrievedAt:new Date().toISOString(),providerUpdatedAt:null,source:{name:'한국석유공사 오피넷',url:selected.sourceUrl,attribution:'출처: 한국석유공사 오피넷'},
    dataNote:'오피넷 보고 가격이며 현장 결제가·영업·재고·회원/카드 할인·도착 시 가격을 보장하지 않습니다. 목록에는 기준 일시가 없어 상세 조회의 유종별 원문 일시를 확인하세요. 좌표는 KATEC 원문으로 WGS84 위경도와 다릅니다. 재표시 시 출처와 제공받은 내용을 보존하고 상업적 이용 조건을 확인하세요.'};
  if(selected.id==='opinet.regions.list'){
    const parsed=z.array(z.object({AREA_CD:oilArea,AREA_NM:text.min(1)})).max(300).safeParse(rows);if(!parsed.success)throw invalid();const seen=new Set<string>();
    const regions=parsed.data.map(row=>{if(seen.has(row.AREA_CD) || (input.provinceCode?(row.AREA_CD.length!==4 || !row.AREA_CD.startsWith(input.provinceCode)):row.AREA_CD.length!==2))throw invalid();seen.add(row.AREA_CD);return{code:row.AREA_CD,name:row.AREA_NM};});
    return{...common,regions,returnedCount:regions.length};
  }
  if(selected.id==='opinet.stations.cheapest'){
    const parsed=z.array(oilBase.extend({PRICE:numeric.pipe(z.number().min(0).max(100_000))})).max(input.limit).safeParse(rows);if(!parsed.success)throw invalid();const seen=new Set<string>();let previous=0;
    const stations=parsed.data.map((row,index)=>{if(seen.has(row.UNI_ID) || row.PRICE>0 && row.PRICE<previous || row.SIGUNCD && !row.SIGUNCD.startsWith(input.areaCode))throw invalid();seen.add(row.UNI_ID);if(row.PRICE>0)previous=row.PRICE;return{...oilStation(row),providerRank:index+1,product:input.product,priceWonPerLitre:row.PRICE>0?row.PRICE:null,priceRaw:row.PRICE,priceReportedAtRaw:null};});
    return{...common,stations,returnedCount:stations.length,ranking:'provider_lowest_price',areaFilterCheck:stations.every(row=>row.areaCode)?'matched':'not_reported'};
  }
  const parsed=z.array(oilBase.extend({LPG_YN:optionalText,MAINT_YN:optionalText,CAR_WASH_YN:optionalText,CVS_YN:optionalText,KPETRO_YN:optionalText,OIL_PRICE:z.union([z.array(oilPrice).max(30),oilPrice])})).length(1).safeParse(rows);
  if(!parsed.success)throw invalid();const row=parsed.data[0]!;if(row.UNI_ID!==input.stationId)throw invalid();const prices=Array.isArray(row.OIL_PRICE)?row.OIL_PRICE:[row.OIL_PRICE],seen=new Set<string>();
  return{...common,station:{...oilStation(row),lpgBusinessTypeRaw:row.LPG_YN||null,facilities:{maintenance:flag(row.MAINT_YN),carWash:flag(row.CAR_WASH_YN),convenienceStore:flag(row.CVS_YN),qualityCertified:flag(row.KPETRO_YN)},prices:prices.map(price=>{
    if(seen.has(price.PRODCD))throw invalid();seen.add(price.PRODCD);timestamp(price.TRADE_DT+price.TRADE_TM);return{productCode:price.PRODCD,productName:oilProducts[price.PRODCD as keyof typeof oilProducts]??null,priceWonPerLitre:price.PRICE>0?price.PRICE:null,tradeDateRaw:price.TRADE_DT,tradeTimeRaw:price.TRADE_TM};})}};
}
export function normalizeVehicleEnergyResponse(id:string,raw:string,input:unknown){const selected=findAction(id),root=parse(raw);return id===evSearchAction.id?normalizeEv(root,input):normalizeOil(root,selected,input);}
async function readBody(response:Response){
  const reader=response.body?.getReader();if(!reader)throw invalid();const decoder=new TextDecoder('utf-8',{fatal:true});let raw='',bytes=0;
  try{for(;;){const part=await reader.read();if(part.done)break;bytes+=part.value.byteLength;if(bytes>2_000_000)throw new ActionError('RESULT_TOO_LARGE','차량 에너지 API 응답이 너무 큽니다. 조회 개수를 줄여 주세요.');raw+=decoder.decode(part.value,{stream:true});}return raw+decoder.decode();}
  catch(error){try{await reader.cancel();}catch{/* Preserve original error. */}if(error instanceof TypeError)throw invalid();throw error;}finally{reader.releaseLock();}
}
export function vehicleEnergyExecutor(fetcher:typeof fetch=fetch):Executor{
  return async(action,context)=>{
    const selected=findAction(action.id),input=selected.schema.parse(context.job.input),template=vehicleEnergyRequestTemplate(action.id,input),ev=selected.serviceId==='ev-chargers';
    if(context.signal.aborted)throw new ActionError('CANCELLED','작업이 취소됐습니다.','cancelled');
    const key=context.secrets[ev?'serviceKey':'apiKey']?.trim();if(!key || key.length>4096 || /[^\x21-\x7e]/.test(key))throw new ActionError('AUTH_REQUIRED',ev?'전기차 충전소 API를 신청한 일반 인증키(Decoding)를 등록하세요.':'오피넷에서 발급한 본인 API 인증키를 등록하세요. 공공데이터포털 키와 다릅니다.','awaiting_auth');
    const url=new URL(template.endpoint);for(const[name,value]of Object.entries(template.query))url.searchParams.set(name,String(value));url.searchParams.set(template.authentication.queryParameter,key);
    const signal=AbortSignal.any([context.signal,AbortSignal.timeout(30_000)]);context.dispatch();
    try{
      const response=await fetcher(url,{method:'GET',headers:{Accept:'application/json'},redirect:'error',cache:'no-store',signal});
      if([401,403].includes(response.status))throw new ActionError('AUTH_REQUIRED','차량 에너지 API 키·신청·접근 조건을 확인한 뒤 재개하세요.','awaiting_auth');
      if(response.status===429)throw new ActionError('PROVIDER_RATE_LIMIT','차량 에너지 API 호출 한도를 초과했습니다.');
      if(!response.ok)throw new ActionError(`PROVIDER_HTTP_${response.status}`,'차량 에너지 API가 정상 결과를 반환하지 않았습니다.');
      const data=normalizeVehicleEnergyResponse(action.id,await readBody(response),input);if(context.signal.aborted)throw new ActionError('CANCELLED','작업이 취소됐습니다.','cancelled');return{data,evidence:selected.resultCheck};
    }catch(error){
      if(context.signal.aborted)throw new ActionError('CANCELLED','작업이 취소됐습니다.','cancelled');if(error instanceof ActionError)throw error;
      if(signal.aborted || error instanceof Error && error.name==='TimeoutError')throw new ActionError('PROVIDER_TIMEOUT','차량 에너지 API 응답 시간이 초과됐습니다.');
      throw new ActionError('PROVIDER_CONNECTION_ERROR','차량 에너지 HTTPS API에 연결하지 못했습니다. 네트워크·서비스 상태를 확인하세요.');
    }
  };
}
