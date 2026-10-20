import { z } from 'zod';
import { zodToJsonSchema } from 'zod-to-json-schema';
import { ActionError, type Action, type Executor } from '../types.js';

export const tmapEndpoint='https://apis.openapi.sk.com/tmap/routes';
export const tmapDocs='https://tmapapi.tmapmobility.com/main.html#webservice/docs/tmapRouteDoc';
export const tmapResultTtlMs=24*60*60*1000;
const point=z.object({longitude:z.number().finite().min(124).max(132),latitude:z.number().finite().min(33).max(39)}).strict();
export const tmapSchema=z.object({start:point.describe('출발지 WGS84 경도·위도. 카카오 장소 결과의 x=경도, y=위도'),end:point.describe('목적지 WGS84 경도·위도'),preference:z.enum(['recommended','avoid_tolls','fastest']).default('recommended')}).strict().refine(v=>v.start.longitude!==v.end.longitude||v.start.latitude!==v.end.latitude,'출발지와 목적지는 다른 좌표로 입력하세요.');
const options={recommended:0,avoid_tolls:1,fastest:2} as const;
export const tmapAction:Action={id:'tmap.route.car',serviceId:'tmap',connectorId:'tmap-routes-api',title:'TMAP 자동차 경로·소요시간 조회',
  description:'국내 출발·목적지 좌표의 자동차 경로 요약 한 건을 조회합니다. 거리(m)·예상 시간(초)·제공 요금(원)은 조회 시점의 추정치입니다. 실제 주행 안내·미래 출발·보행/대중교통·경로 형상은 포함하지 않으며 결과 사용기한은 24시간입니다.',
  category:'지도·교통',effect:'read',method:'api',schema:tmapSchema,inputSchema:zodToJsonSchema(tmapSchema,{$refStrategy:'none'}) as Record<string,unknown>,credentialType:'tmap-api',requiredSecrets:['appKey'],scopes:[],sourceUrl:tmapDocs,checkedAt:'2026-10-21',verification:'documented',
  resultCheck:'공급자 오류·요약 FeatureCollection 한 건·음수 아닌 정수 단위를 검증합니다. 0과 누락 요금을 구분하며 응답에 좌표가 없어 대상 일치는 미확인입니다.',
  domains:['apis.openapi.sk.com'],version:'0.1.0',maintainer:'KoreAI',origin:'bundled',implemented:true,resultTtlMs:tmapResultTtlMs};
export function tmapExample(){return{start:{longitude:126.978,latitude:37.5665},end:{longitude:127.0276,latitude:37.4979},preference:'recommended'};}
export function tmapRequestTemplate(raw:unknown){const input=tmapSchema.parse(raw);return{method:'POST' as const,endpoint:tmapEndpoint,query:{version:'1'},authentication:{headers:{appKey:{secretField:'appKey'}}},responseFormat:'json' as const,
  body:{startX:input.start.longitude,startY:input.start.latitude,endX:input.end.longitude,endY:input.end.latitude,reqCoordType:'WGS84GEO',resCoordType:'WGS84GEO',searchOption:options[input.preference],carType:0,totalValue:2,trafficInfo:'N',mainRoadInfo:'N',tollgateFareInfo:'N'},contentType:'application/x-www-form-urlencoded',resultUseLimitHours:24};}
const invalid=()=>new ActionError('INVALID_RESPONSE','TMAP 요약 응답의 JSON·구조·거리·시간·요금이 유효하지 않습니다.');
const quantity=z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER);
const summary=z.object({type:z.literal('FeatureCollection'),features:z.array(z.object({type:z.literal('Feature'),properties:z.object({totalDistance:quantity,totalTime:quantity,totalFare:quantity.nullish(),taxiFare:quantity.nullish()})})).length(1)});
export function normalizeTmapResponse(raw:string,rawInput:unknown){
  const input=tmapSchema.parse(rawInput);let root:unknown;try{root=JSON.parse(raw);}catch{throw invalid();}
  if(root&&typeof root==='object'&&!Array.isArray(root)&&'error'in root)throw new ActionError('TMAP_PROVIDER_ERROR','TMAP가 경로를 반환하지 않았습니다. 좌표·상품 권한·서비스 상태를 확인하세요.');
  const parsed=summary.safeParse(root);if(!parsed.success)throw invalid();const p=parsed.data.features[0]!.properties;
  if(p.totalDistance===0||p.totalTime===0)throw new ActionError('TMAP_ROUTE_UNCONFIRMED','다른 좌표 사이의 경로 거리·시간이 0입니다. 경로를 확인하지 못했습니다.','needs_review');
  const retrievedAt=new Date().toISOString();return{query:input,mode:'car',coordinateSystem:'WGS84GEO',distanceMetres:p.totalDistance,durationSeconds:p.totalTime,providerTotalFareKrw:p.totalFare??null,taxiFareEstimateKrw:p.taxiFare??null,
    retrievedAt,expiresAt:new Date(Date.parse(retrievedAt)+tmapResultTtlMs).toISOString(),providerUpdatedAt:null,responseIdentityVerified:false,departureTimeSpecified:false,arrivalTime:null,geometryIncluded:false,
    dataNote:'조회 시점의 자동차 경로 추정 요약입니다. 실제 출발/도착·경로 안전·예약·정확한 요금이나 통행을 보증하지 않습니다. 무료우선은 무료 경로 확정이 아니며 유류비·주차비·할인을 합산하지 않습니다. 응답에 대상 좌표가 없어 입력과의 일치 확인은 미완료입니다. 24시간 이후에는 결과와 이를 포함한 대화 응답을 재사용하지 않습니다.',
    source:{name:'TMAP',url:tmapDocs,attribution:'출처: TMAP 경로안내 API',termsUrl:'https://tmapapi.tmapmobility.com/terms.html'}};
}
async function readBody(response:Response){
  const reader=response.body?.getReader();if(!reader)throw invalid();let text='',bytes=0;const decoder=new TextDecoder('utf-8',{fatal:true});
  try{for(;;){const part=await reader.read();if(part.done)break;bytes+=part.value.byteLength;if(bytes>256_000)throw new ActionError('RESULT_TOO_LARGE','TMAP 요약 응답이 너무 큽니다.');text+=decoder.decode(part.value,{stream:true});}return text+decoder.decode();}
  catch(error){try{await reader.cancel();}catch{/* Keep original failure. */}if(error instanceof TypeError)throw invalid();throw error;}finally{reader.releaseLock();}
}
export function tmapExecutor(fetcher:typeof fetch=fetch):Executor{return async(action,context)=>{
  if(action.id!==tmapAction.id)throw new ActionError('NOT_IMPLEMENTED','TMAP 실행기에 등록되지 않은 행동입니다.');
  const input=tmapSchema.parse(context.job.input),template=tmapRequestTemplate(input),key=context.secrets.appKey?.trim();
  if(!key||key.length>4096||/[^\x21-\x7e]/.test(key))throw new ActionError('AUTH_REQUIRED','본인 TMAP 상품 앱 키를 등록하세요.','awaiting_auth');
  if(context.signal.aborted)throw new ActionError('CANCELLED','작업이 취소됐습니다.','cancelled');
  const url=new URL(tmapEndpoint);url.searchParams.set('version','1');const signal=AbortSignal.any([context.signal,AbortSignal.timeout(30_000)]);
  try{
    context.dispatch();const response=await fetcher(url,{method:'POST',redirect:'error',cache:'no-store',signal,headers:{appKey:key,Accept:'application/json','Content-Type':'application/x-www-form-urlencoded','Accept-Language':'ko'},body:new URLSearchParams(Object.entries(template.body).map(([k,v])=>[k,String(v)])).toString()});
    if([401,403].includes(response.status))throw new ActionError('AUTH_REQUIRED','TMAP 앱 키·상품 신청·권한과 호출 IP/도메인 조건을 확인한 뒤 재개하세요.','awaiting_auth');
    if(response.status===429)throw new ActionError('PROVIDER_RATE_LIMIT','TMAP 호출 한도를 초과했습니다. 요금제·사용량을 확인하세요. 자동 재시도하지 않습니다.');
    if(response.status===204)throw new ActionError('TMAP_NO_ROUTE','TMAP가 경로를 반환하지 않았습니다. 좌표와 서비스 제공 범위를 확인하세요.','needs_review');
    if(!response.ok)throw new ActionError(`PROVIDER_HTTP_${response.status}`,`TMAP HTTP ${response.status} 오류입니다. 조회 조건·권한·서비스 상태를 확인하세요.`);
    const data=normalizeTmapResponse(await readBody(response),input);if(context.signal.aborted)throw new ActionError('CANCELLED','작업이 취소됐습니다.','cancelled');return{data,evidence:'공식 TMAP 자동차 경로 요약·구조·단위 검증(반환 대상 좌표 미제공)'};
  }catch(error){if(context.signal.aborted)throw new ActionError('CANCELLED','작업이 취소됐습니다.','cancelled');if(error instanceof ActionError)throw error;if(signal.aborted||error instanceof Error&&error.name==='TimeoutError')throw new ActionError('PROVIDER_TIMEOUT','TMAP 조회 시간이 초과됐습니다.');throw new ActionError('PROVIDER_UNAVAILABLE','TMAP 연결·응답을 확인하지 못했습니다. 서비스 상태를 확인하세요.');}
};}
