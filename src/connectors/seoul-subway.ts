import { z } from 'zod';
import { zodToJsonSchema } from 'zod-to-json-schema';
import { XMLParser, XMLValidator } from 'fast-xml-parser';
import { ActionError, type Action, type Executor } from '../types.js';
import { subwayArrivalDocs, subwayTimetableDocs, subwayMapUrl } from '../research/seoul-subway.js';

const station = z.string().trim().min(1).max(50).refine(value => !/[\p{C}/\\?#%]/u.test(value), '공식 역 이름을 경로 구분자·제어문자 없이 입력하세요.');
const limit = z.number().int().min(1).max(100).default(20);
export const subwayArrivalsSchema = z.object({ stationName: station, limit }).strict();
export const subwayTimetableSchema = z.object({ stationName: station, lineName: station,
  direction: z.enum(['상행','하행','내선','외선']).default('상행'), day: z.enum(['평일','주말','상시']).default('평일'),
  temporary: z.enum(['N','Y']).default('N'), at: z.string().datetime({ offset: true }).optional(), limit }).strict();
const common = { serviceId: 'seoul-subway', connectorId: 'seoul-subway-api', category: '지도·교통', effect: 'read', method: 'api', credentialType: 'seoul-subway-api', requiredSecrets: ['apiKey'], scopes: [], checkedAt: '2026-10-22', verification: 'documented', domains: ['swopenapi.seoul.go.kr','openapi.seoul.go.kr'], version: '0.1.0', maintainer: 'KoreAI', origin: 'bundled', implemented: true } as const;
export const subwayActions: Action[] = [
  { ...common, requiredSecrets:[...common.requiredSecrets],scopes:[],domains:[...common.domains], id:'seoul-subway.arrivals',title:'서울 지하철 실시간 도착 조회',
    description:'공식 역 이름의 첫 도착정보 구간을 조회합니다. 도착 메시지·공급자 생성 시각·예보 초를 보존하며 지연·운행 종료를 추정하지 않습니다. HTTP 키 전송은 운영자 허용이 필요합니다.',
    schema:subwayArrivalsSchema,inputSchema:zodToJsonSchema(subwayArrivalsSchema,{$refStrategy:'none'}) as Record<string,unknown>,sourceUrl:subwayArrivalDocs,resultTtlMs:60_000,
    resultCheck:'응답 코드·요청 역명·목록 수·열차 식별자 중복·초/생성 시각을 검사합니다. 예보 0초를 즉시 도착으로 단정하지 않고 생성 시각 지연을 표시합니다.' },
  { ...common, requiredSecrets:[...common.requiredSecrets],scopes:[],domains:[...common.domains],id:'seoul-subway.timetable',title:'서울 지하철 열차 시간표 조회',
    description:'현행 getTrainSch의 역·호선 포함 검색, 요일·방향·임시 여부·기준 시각으로 첫 구간을 조회합니다. 예정 시각과 실제 도착, 유효기간을 구분합니다. HTTP 키 전송은 운영자 허용이 필요합니다.',
    schema:subwayTimetableSchema,inputSchema:zodToJsonSchema(subwayTimetableSchema,{$refStrategy:'none'}) as Record<string,unknown>,sourceUrl:subwayTimetableDocs,
    resultCheck:'실제 response/header/body JSON·첫 페이지/출력 수·역/호선 포함 검색·방향/요일/임시 조건·중복·시간표 유효기간을 검사합니다. 24시 이후 표기를 원문으로 보존하고 현재 운행을 판정하지 않습니다.' },
];
export const subwayExample = (id:string) => id === 'seoul-subway.arrivals' ? {stationName:'서울',limit:5} : {stationName:'서울',lineName:'1호선',direction:'상행',day:'평일',temporary:'N',limit:5};
const seoulParts = new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Seoul',year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',second:'2-digit',hourCycle:'h23'});
function seoulDate(date:Date) {const p=Object.fromEntries(seoulParts.formatToParts(date).map(part=>[part.type,part.value]));return `${p.year}-${p.month}-${p.day} ${p.hour}:${p.minute}:${p.second}`;}
export function subwayRequestTemplate(id:string,raw:unknown,now=new Date()) {
  const query:Record<string,string>={};let endpoint:string;
  if(id==='seoul-subway.arrivals'){const input=subwayArrivalsSchema.parse(raw);endpoint=`http://swopenapi.seoul.go.kr/api/subway/{apiKey}/json/realtimeStationArrival/0/${input.limit}/${encodeURIComponent(input.stationName)}`;}
  else if(id==='seoul-subway.timetable'){const input=subwayTimetableSchema.parse(raw);endpoint=`http://openapi.seoul.go.kr:8088/{apiKey}/json/getTrainSch/1/${input.limit}/%20/${input.temporary}/${encodeURIComponent(input.direction)}/${encodeURIComponent(input.day)}/${encodeURIComponent(input.lineName)}`;query.stnNm=input.stationName;query.searchDt=seoulDate(input.at?new Date(input.at):now);}
  else throw new ActionError('NOT_IMPLEMENTED','등록되지 않은 지하철 조회입니다.');
  return {method:'GET' as const,endpoint,query,authentication:{secretField:'apiKey' as const,pathParameter:'apiKey'},responseFormat:'json' as const,transport:{encrypted:false,operatorOptIn:'KOREAI_ALLOW_SEOUL_SUBWAY_HTTP=1'}};
}
const invalid=()=>new ActionError('INVALID_RESPONSE','지하철 응답의 구조·필터·식별자·건수·시각이 유효하지 않습니다.');
const text=z.string().min(1).max(1000),optional=z.string().max(1000).nullish().transform(value=>value||null);
const integer=z.union([z.number().int().nonnegative().safe(),z.string().regex(/^\d{1,9}$/).transform(Number)]);
const localTime=z.string().regex(/^\d{4}-\d{2}-\d{2}[ T]\d{2}:\d{2}:\d{2}$/);
function localEpoch(value:string|null) {if(!value)return null;const n=Date.parse(value.replace(' ','T')+'+09:00');return Number.isFinite(n)&&seoulDate(new Date(n))===value.replace('T',' ')?n:null;}
function decode(raw:string):any {
  if(raw.length>2_000_000)throw new ActionError('RESULT_TOO_LARGE','지하철 응답이 너무 큽니다.');
  let p:any;
  try{p=JSON.parse(raw);}catch{
    if(/<!DOCTYPE|<!ENTITY/i.test(raw)||XMLValidator.validate(raw)!==true)throw invalid();
    try{p=new XMLParser({parseTagValue:false,ignoreAttributes:true,ignoreDeclaration:true,processEntities:false}).parse(raw);}catch{throw invalid();}
  }
  const c=p?.errorMessage?.code??p?.RESULT?.CODE??p?.response?.header?.resultCode??p?.code;
  if(['INFO-100','ERROR-100','30','31','32'].includes(c))throw new ActionError('AUTH_REQUIRED','서울 데이터의 해당 지하철 서비스 키·승인 상태를 확인하세요.','awaiting_auth');
  if(c==='INFO-200')return {empty:true};
  if(!['INFO-000','00'].includes(c))throw new ActionError('PROVIDER_ERROR','서울 지하철 서비스가 정상 데이터를 반환하지 않았습니다.');
  return p;
}
const arrivalRow=z.object({subwayId:z.string().regex(/^\d{4}$/),statnId:z.string().regex(/^\d{1,15}$/),statnNm:text,updnLine:text,btrainNo:text,ordkey:text,trainLineNm:text,btrainSttus:optional,
  barvlDt:z.union([z.string().regex(/^\d{1,8}$/),z.literal('')]).nullish().transform(value=>value||null),recptnDt:localTime,arvlMsg2:optional,arvlMsg3:optional,arvlCd:z.string().regex(/^(?:[0-5]|99)$/),lstcarAt:z.enum(['0','1']).nullish(),totalCount:integer.optional()});
const clock=z.union([z.string().regex(/^(?:[01]\d|2\d):[0-5]\d:[0-5]\d$/),z.literal('')]).nullish().transform(value=>value||null);
const timetableRow=z.object({tmprTmtblYn:z.enum(['N','Y']),upbdnbSe:text,wkndSe:text,lineNm:text,trainno:text,stnNm:text,stnCd:z.string().regex(/^\d{1,10}$/),brlnNm:optional,dptreStnNm:optional,arvlStnNm:optional,trainDptreTm:clock,trainArvlTm:clock,vldBgngDt:localTime.nullish(),vldEndDt:localTime.nullish(),crtrYmd:optional,etrnYn:optional});
export function normalizeSubwayResponse(id:string,raw:string,input:unknown,now=new Date()) {
  const registered=subwayActions.find(action=>action.id===id);if(!registered)throw new ActionError('NOT_IMPLEMENTED','등록되지 않은 지하철 조회입니다.');
  const query=registered.schema.parse(input),p=decode(raw),retrievedAt=now.toISOString();
  const source={name:'서울특별시 · 서울 열린데이터광장',url:registered.sourceUrl,mapUrl:subwayMapUrl};
  if(p.empty)return {kind:id,status:'no_data',query,rows:[],pagination:{returnedCount:0,total:null,truncated:false},retrievedAt,source,dataNote:'공급자가 결과 없음으로 응답했습니다. 운행 종료·역 미존재를 뜻하지 않습니다.'};
  const seen=new Set<string>();let total:number,rows:unknown[];
  if(id==='seoul-subway.arrivals'){
    const e=z.object({errorMessage:z.object({status:z.literal(200),code:z.literal('INFO-000'),total:integer}),realtimeArrivalList:z.array(arrivalRow).max(query.limit)}).safeParse(p);if(!e.success)throw invalid();total=e.data.errorMessage.total;
    rows=e.data.realtimeArrivalList.map(row=>{
      const key=[row.subwayId,row.statnId,row.btrainNo,row.updnLine,row.ordkey].join(':');const created=localEpoch(row.recptnDt);if(seen.has(key)||row.statnNm!==query.stationName||created===null||row.totalCount!==undefined&&row.totalCount!==total)throw invalid();seen.add(key);
      return {id:key,lineCode:row.subwayId,stationName:row.statnNm,direction:row.updnLine,destination:row.trainLineNm,trainNumber:row.btrainNo,trainType:row.btrainSttus,reportedArrivalSeconds:row.barvlDt==null?null:Number(row.barvlDt),providerCreatedAtRaw:row.recptnDt,ageSeconds:Math.floor((now.getTime()-created)/1000),message:row.arvlMsg2,detail:row.arvlMsg3,arrivalCode:row.arvlCd,lastTrainReported:row.lstcarAt==null?null:row.lstcarAt==='1',adjustedArrivalSeconds:null};
    });
  }else{
    const e=z.object({response:z.object({header:z.object({resultCode:z.literal('00')}),body:z.object({items:z.object({item:z.union([timetableRow,z.array(timetableRow)]).optional()}).nullish(),pageNo:integer,numOfRows:integer,totalCount:integer})})}).safeParse(p);if(!e.success)throw invalid();const b=e.data.response.body;if(b.pageNo!==1||b.numOfRows!==query.limit)throw invalid();total=b.totalCount;
    const rawRows=b.items?.item===undefined?[]:Array.isArray(b.items.item)?b.items.item:[b.items.item];if(rawRows.length>query.limit)throw invalid();const asOf=query.at?Date.parse(query.at):now.getTime();
    rows=rawRows.map(row=>{
      const key=[row.stnCd,row.lineNm,row.trainno,row.upbdnbSe,row.wkndSe,row.tmprTmtblYn,row.trainDptreTm,row.trainArvlTm].join(':');
      const from=localEpoch(row.vldBgngDt??null),until=localEpoch(row.vldEndDt??null);
      if(seen.has(key)||!row.stnNm.includes(query.stationName)||!row.lineNm.includes(query.lineName)||row.upbdnbSe!==query.direction||row.wkndSe!==query.day||row.tmprTmtblYn!==query.temporary||row.vldBgngDt!=null&&from===null||row.vldEndDt!=null&&until===null||from!==null&&until!==null&&from>until)throw invalid();seen.add(key);
      return {id:key,stationCode:row.stnCd,stationName:row.stnNm,lineName:row.lineNm,trainNumber:row.trainno,direction:row.upbdnbSe,day:row.wkndSe,temporary:row.tmprTmtblYn,branch:row.brlnNm,origin:row.dptreStnNm,destination:row.arvlStnNm,departureRaw:row.trainDptreTm,arrivalRaw:row.trainArvlTm,validFromRaw:row.vldBgngDt??null,validUntilRaw:row.vldEndDt??null,validAtQuery:from!==null&&until!==null?from<=asOf&&asOf<=until:null,referenceDateRaw:row.crtrYmd,expressRaw:row.etrnYn};
    });
  }
  if(rows.length>total||total>0&&rows.length===0)throw invalid();
  return {kind:id,status:rows.length?'available':'no_data',query,rows,pagination:{returnedCount:rows.length,total,truncated:rows.length<total},retrievedAt,source,
    dataNote:id==='seoul-subway.arrivals'?'공급자 생성 시각과 예보 원문입니다. 0초·빈 목록을 현재 도착이나 운행 종료로 해석하지 않습니다. 수집 지연이 있어 실제 승차 가능은 미확인입니다. 서울시 외 일부 구간은 미제공입니다.':'첫 조회 구간의 예정 시간표입니다. 24시 이후 표기는 운행일 기준 원문이며 실제 도착·오늘의 운행 여부·다음 열차를 확정하지 않습니다. 유효기간 밖/미제공을 별도 표시합니다.',
    transportIntegrityVerified:false};
}
async function read(response:Response){const reader=response.body?.getReader();if(!reader)throw invalid();const decoder=new TextDecoder('utf-8',{fatal:true});let raw='',size=0;try{for(;;){const part=await reader.read();if(part.done)break;size+=part.value.byteLength;if(size>2_000_000)throw new ActionError('RESULT_TOO_LARGE','지하철 응답이 너무 큽니다.');raw+=decoder.decode(part.value,{stream:true});}return raw+decoder.decode();}catch(e){try{await reader.cancel();}catch{}if(e instanceof TypeError)throw invalid();throw e;}finally{reader.releaseLock();}}
export function subwayExecutor(fetcher:typeof fetch=fetch,allowHttp=false):Executor{return async(action,context)=>{
  const registered=subwayActions.find(item=>item.id===action.id);if(!registered)throw new ActionError('NOT_IMPLEMENTED','등록되지 않은 지하철 조회입니다.');const input=registered.schema.parse(context.job.input);
  if(context.signal.aborted)throw new ActionError('CANCELLED','취소된 작업입니다.','cancelled');
  if(!allowHttp)throw new ActionError('TRANSPORT_DISABLED','지하철 API는 HTTP로 키를 전송합니다. 운영자가 KOREAI_ALLOW_SEOUL_SUBWAY_HTTP=1로 명시적으로 허용해야 합니다.');
  const key=context.secrets.apiKey?.trim();if(!key||key==='sample'||key.length>256||/[^\x21-\x7e]/.test(key)||['.','..'].includes(key))throw new ActionError('AUTH_REQUIRED','해당 서울 지하철 API의 본인 인증키를 등록하세요. sample 키는 계정 실행에 사용할 수 없습니다.','awaiting_auth');
  const now=new Date(),template=subwayRequestTemplate(action.id,input,now),url=new URL(template.endpoint.replace('{apiKey}',encodeURIComponent(key)));for(const[k,v]of Object.entries(template.query))url.searchParams.set(k,v);
  const signal=AbortSignal.any([context.signal,AbortSignal.timeout(30000)]);
  try{context.dispatch();const response=await fetcher(url,{method:'GET',headers:{Accept:'application/json'},redirect:'error',cache:'no-store',signal});if([401,403].includes(response.status))throw new ActionError('AUTH_REQUIRED','서울 지하철 API 키·서비스 승인을 확인하세요.','awaiting_auth');if(response.status===429)throw new ActionError('PROVIDER_RATE_LIMIT','서울 지하철 호출 한도를 초과했습니다.');if(!response.ok)throw new ActionError('PROVIDER_HTTP_'+response.status,'서울 지하철 응답을 확인하지 못했습니다.');const raw=await read(response),completed=new Date(),resultInput=action.id==='seoul-subway.timetable'&&!input.at?{...input,at:now.toISOString()}:input;const data=normalizeSubwayResponse(action.id,raw,resultInput,completed);if(context.signal.aborted)throw new ActionError('CANCELLED','취소된 작업입니다.','cancelled');return{data,evidence:registered.resultCheck};}
  catch(e){if(context.signal.aborted)throw new ActionError('CANCELLED','취소된 작업입니다.','cancelled');if(e instanceof ActionError)throw e;if(signal.aborted||e instanceof Error&&e.name==='TimeoutError')throw new ActionError('PROVIDER_TIMEOUT','서울 지하철 응답 시간이 초과됐습니다.');throw new ActionError('PROVIDER_UNAVAILABLE','서울 지하철 연결·응답을 확인하지 못했습니다.');}
};}
