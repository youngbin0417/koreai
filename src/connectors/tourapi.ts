import { XMLParser, XMLValidator } from 'fast-xml-parser';
import { z } from 'zod';
import { zodToJsonSchema } from 'zod-to-json-schema';
import { ActionError, type Action, type Executor } from '../types.js';

const sourceUrl = 'https://www.data.go.kr/data/15101578/openapi.do';
const base = 'https://apis.data.go.kr/B551011/KorService2/';
const provinceCode = z.string().regex(/^[1-9]\d$/).describe('법정동 코드 조회 결과의 시도 코드. 기존 TourAPI areaCode와 다름');
const districtCode = z.string().regex(/^\d{3}$/).describe('법정동 코드 조회 결과의 시군구 3자리 코드. 시도 코드와 함께 입력');
export const tourapiContentTypes = { '12': '관광지', '14': '문화시설', '15': '축제공연행사', '25': '여행코스', '28': '레포츠', '32': '숙박', '38': '쇼핑', '39': '음식점' } as const;
const contentType = z.enum(Object.keys(tourapiContentTypes) as [keyof typeof tourapiContentTypes, ...(keyof typeof tourapiContentTypes)[]]);
const page = z.number().int().min(1).max(1000).default(1), limit = z.number().int().min(1).max(100).default(10);
const date = z.string().regex(/^\d{4}-\d{2}-\d{2}$/).refine(value => Number.isFinite(Date.parse(value)) && new Date(value).toISOString().slice(0,10) === value, '유효한 YYYY-MM-DD 날짜를 입력하세요.');
const regionFields = { provinceCode: provinceCode.optional(), districtCode: districtCode.optional() };
const hasProvince = (input: { provinceCode?: string; districtCode?: string }) => !input.districtCode || !!input.provinceCode;
export const tourapiRegionsSchema = z.object({ provinceCode: provinceCode.optional(), page, limit }).strict();
export const tourapiPlacesSchema = z.object({ ...regionFields, contentTypeId: contentType.default('12'), sort: z.enum(['title','modified','created']).default('title'), page, limit }).strict().refine(hasProvince, '시군구를 지정하려면 시도 코드를 함께 입력하세요.');
export const tourapiFestivalsSchema = z.object({ ...regionFields, eventStartDate: date.describe('공급자 행사시작일 조건. 기간에 겹치는 모든 행사를 보장하지 않음'), eventEndDate: date.optional().describe('공급자 행사종료일 조건'), sort: z.enum(['title','modified','created']).default('title'), page, limit }).strict()
  .refine(hasProvince, '시군구를 지정하려면 시도 코드를 함께 입력하세요.')
  .refine(input => !input.eventEndDate || input.eventEndDate >= input.eventStartDate, '행사종료일 조건은 행사시작일 조건 이후여야 합니다.');
function define(id: string, title: string, description: string, schema: z.ZodTypeAny): Action {
  return { id, serviceId:'tourapi', connectorId:'tourapi-api', title, description, schema,
    inputSchema:zodToJsonSchema(schema,{ $refStrategy:'none' }) as Record<string,unknown>, category:'여행·지역생활', effect:'read', method:'api', credentialType:'tourapi-api', requiredSecrets:['serviceKey'], scopes:[], sourceUrl, checkedAt:'2026-10-20', verification:'documented',
    resultCheck:'KorService2 정상 코드·페이지/건수·콘텐츠 ID·법정동/타입·날짜·WGS84 좌표를 확인합니다. 원문 상태·수정 시각·출처를 보존하며 현재 영업·개최·예약 가능을 추정하지 않습니다.', domains:['apis.data.go.kr'], version:'0.1.0', maintainer:'KoreAI', origin:'bundled', implemented:true };
}
export const tourapiRegionsAction = define('tourapi.regions.list','TourAPI 법정동 지역 찾기','시도 목록 또는 선택한 시도의 시군구 코드를 한 페이지 조회합니다. 결과의 시도 2자리·시군구 3자리 코드를 관광지·축제 검색에 사용하세요.',tourapiRegionsSchema);
export const tourapiPlacesAction = define('tourapi.places.search','TourAPI 지역 관광정보 조회','법정동 지역과 관광타입으로 관광지·문화시설·음식점 등의 목록을 조회합니다. 이미지는 반환하지 않으며 현재 영업·가격·예약 가능 여부는 미확인입니다.',tourapiPlacesSchema);
export const tourapiFestivalsAction = define('tourapi.festivals.search','TourAPI 축제·행사 조회','공식 행사시작일·선택 종료일과 법정동 지역으로 축제/공연/행사 목록을 조회합니다. 기간 겹침 검색을 보장하지 않으며 제공된 취소/연기 원문과 출처를 함께 확인하세요.',tourapiFestivalsSchema);
export const tourapiActions = [tourapiRegionsAction,tourapiPlacesAction,tourapiFestivalsAction];
export function tourapiExample(id: string, now = new Date()): Record<string,unknown> {
  if (id === tourapiRegionsAction.id) return { page:1, limit:100 };
  if (id === tourapiPlacesAction.id) return { provinceCode:'11', contentTypeId:'12', page:1, limit:10 };
  if (id !== tourapiFestivalsAction.id) throw new ActionError('NOT_IMPLEMENTED','TourAPI에 등록되지 않은 행동입니다.');
  const year = new Date(now.getTime() + 9 * 3_600_000).getUTCFullYear();
  return { eventStartDate:`${year}-01-01`, eventEndDate:`${year}-12-31`, provinceCode:'11', page:1, limit:10 };
}
export function tourapiRequestTemplate(id: string, raw: unknown) {
  const action = tourapiActions.find(action => action.id === id); if (!action) throw new ActionError('NOT_IMPLEMENTED','TourAPI에 등록되지 않은 행동입니다.');
  const input = action.schema.parse(raw) as Record<string,any>;
  const operation = id === tourapiRegionsAction.id ? 'ldongCode2' : id === tourapiPlacesAction.id ? 'areaBasedList2' : 'searchFestival2';
  const query: Record<string,string|number> = { MobileOS:'WEB', MobileApp:'KoreAI', _type:'json', pageNo:input.page, numOfRows:input.limit };
  if (input.provinceCode) query.lDongRegnCd = input.provinceCode;
  if (id === tourapiRegionsAction.id) query.lDongListYn = 'N';
  else {
    if (input.districtCode) query.lDongSignguCd = input.districtCode;
    query.arrange = { title:'A', modified:'C', created:'D' }[input.sort as 'title'|'modified'|'created'];
    if (id === tourapiPlacesAction.id) query.contentTypeId = input.contentTypeId;
    else { query.eventStartDate = input.eventStartDate.replaceAll('-',''); if (input.eventEndDate) query.eventEndDate = input.eventEndDate.replaceAll('-',''); }
  }
  return { method:'GET' as const, endpoint:base+operation, query, authentication:{ secretField:'serviceKey' as const, queryParameter:'serviceKey' }, responseFormat:'json' as const };
}

const invalid = () => new ActionError('INVALID_RESPONSE','TourAPI 응답의 구조·코드·페이지·식별자·지역·날짜 또는 좌표가 유효하지 않습니다.');
const text = z.string().trim().max(10_000), optionalText = text.nullish();
const optionalProvince = z.union([provinceCode,z.literal('')]).nullish(), optionalDistrict = z.union([districtCode,z.literal('')]).nullish();
const itemSchema = z.object({ contentid:z.string().regex(/^\d{1,20}$/), contenttypeid:contentType, title:text.min(1), addr1:optionalText, addr2:optionalText, tel:optionalText, zipcode:optionalText,
  lDongRegnCd:optionalProvince, lDongSignguCd:optionalDistrict, mapx:optionalText, mapy:optionalText, createdtime:optionalText, modifiedtime:optionalText, cpyrhtDivCd:optionalText,
  eventstartdate:optionalText, eventenddate:optionalText, progresstype:optionalText, festivaltype:optionalText });
const integer = z.union([z.number(),z.string().regex(/^\d+$/).transform(Number)]).pipe(z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER));
const parser = new XMLParser({ parseTagValue:false, trimValues:true, ignoreAttributes:true, ignoreDeclaration:true, processEntities:{ enabled:true, maxTotalExpansions:10_000, maxExpandedLength:100_000 }, htmlEntities:false });
function providerCode(code: string) {
  if (['00','0000'].includes(code)) return;
  if (['20','21','30','31','32','33'].includes(code)) throw new ActionError('AUTH_REQUIRED','TourAPI 활용신청·승인·일반 인증키(Decoding)·서버 접근 조건을 확인한 뒤 재개하세요.','awaiting_auth');
  if (['22','23'].includes(code)) throw new ActionError('PROVIDER_RATE_LIMIT','TourAPI 호출 한도를 초과했습니다. 본인 계정의 한도를 확인하세요.');
  if (code === '29') throw new ActionError('PROVIDER_ACCESS_BLOCKED','TourAPI에서 호출 서버 IP의 접근을 차단했습니다.');
  throw new ActionError(`PROVIDER_${code}`,'TourAPI가 정상 결과를 반환하지 않았습니다. 입력·서비스 상태를 확인하세요.');
}
function readResponse(raw: string) {
  let root: unknown;
  try {
    if (raw.trimStart().startsWith('<')) {
      if (/<!\s*(?:DOCTYPE|ENTITY)\b/i.test(raw) || XMLValidator.validate(raw) !== true) throw invalid();
      root = parser.parse(raw);
    } else root = JSON.parse(raw);
  } catch { throw invalid(); }
  const code = z.string().regex(/^\d{2}(?:\d{2})?$/);
  const gateway = z.object({ OpenAPI_ServiceResponse:z.object({ cmmMsgHeader:z.object({ returnReasonCode:code }) }) }).safeParse(root);
  if (gateway.success) { providerCode(gateway.data.OpenAPI_ServiceResponse.cmmMsgHeader.returnReasonCode); throw invalid(); }
  const envelope = z.object({ response:z.object({ header:z.object({ resultCode:code }), body:z.unknown().optional() }) }).safeParse(root);
  if (!envelope.success) throw invalid();
  if (envelope.data.response.header.resultCode === '03') return null;
  providerCode(envelope.data.response.header.resultCode);
  const body = z.object({ pageNo:integer, numOfRows:integer, totalCount:integer, items:z.union([z.object({ item:z.unknown().optional() }),z.literal('')]).optional() }).safeParse(envelope.data.response.body);
  if (!body.success) throw invalid(); return body.data;
}
function dateValue(raw?: string|null) {
  if (!raw || raw === '00000000') return null;
  if (!/^\d{8}$/.test(raw)) throw invalid(); const value = `${raw.slice(0,4)}-${raw.slice(4,6)}-${raw.slice(6)}`;
  if (!date.safeParse(value).success) throw invalid(); return value;
}
function coordinates(x?: string|null, y?: string|null) {
  const raw = { x:x || null, y:y || null };
  for (const [value,max] of [[x,180],[y,90]] as const) if (value && (!/^-?\d+(?:\.\d+)?$/.test(value) || Math.abs(Number(value)) > max)) throw invalid();
  const missing = !x || !y || Number(x) === 0 && Number(y) === 0;
  return { longitude:missing ? null : Number(x), latitude:missing ? null : Number(y), crs:'EPSG:4326', raw };
}
function normalize(raw: string, action: Action, input: Record<string,any>) {
  const body = readResponse(raw), codes = action.id === tourapiRegionsAction.id, festival = action.id === tourapiFestivalsAction.id;
  const item = body && typeof body.items === 'object' ? body.items.item : undefined;
  const rows = item === undefined || item === '' ? [] : Array.isArray(item) ? item : [item];
  const offset = (input.page-1)*input.limit;
  if (body && (body.pageNo !== input.page || body.numOfRows !== input.limit || rows.length !== Math.min(input.limit,Math.max(0,body.totalCount-offset)))) throw invalid();
  let results: unknown[];
  if (codes) {
    const parsed = z.array(z.object({ code:input.provinceCode ? districtCode : provinceCode, name:text.min(1) })).max(input.limit).safeParse(rows);
    if (!parsed.success || new Set(parsed.data.map(row=>row.code)).size !== rows.length) throw invalid();
    results = parsed.data.map(row=>({ code:row.code, name:row.name, level:input.provinceCode ? 'district' : 'province', provinceCode:input.provinceCode ?? row.code }));
  } else {
    const parsed = z.array(itemSchema).max(input.limit).safeParse(rows);
    if (!parsed.success || new Set(parsed.data.map(row=>row.contentid)).size !== rows.length) throw invalid();
    results = parsed.data.map(row=>{
      if (input.provinceCode && row.lDongRegnCd !== input.provinceCode || input.districtCode && row.lDongSignguCd !== input.districtCode || row.contenttypeid !== (festival ? '15' : input.contentTypeId)) throw invalid();
      const startDate=dateValue(row.eventstartdate), endDate=dateValue(row.eventenddate); if (startDate && endDate && endDate < startDate) throw invalid();
      return { contentId:row.contentid, contentTypeId:row.contenttypeid, contentType:tourapiContentTypes[row.contenttypeid], title:row.title, address:row.addr1 || null, addressDetail:row.addr2 || null, phone:row.tel || null, postalCode:row.zipcode || null,
        provinceCode:row.lDongRegnCd || null, districtCode:row.lDongSignguCd || null, coordinates:coordinates(row.mapx,row.mapy), createdAtRaw:row.createdtime || null, providerUpdatedAtRaw:row.modifiedtime || null, copyrightTypeRaw:row.cpyrhtDivCd || null,
        ...(festival ? { startDate, endDate, progressTypeRaw:row.progresstype || null, festivalTypeRaw:row.festivaltype || null, currentlyHappening:null } : {}), currentlyOpen:null, reservationAvailable:null };
    });
  }
  return { status:results.length ? 'available' : 'no_data', ...(codes ? { regions:results } : festival ? { festivals:results } : { places:results }), returnedCount:results.length, query:input,
    pagination:{ page:input.page, limit:input.limit, totalCount:body?.totalCount ?? null, nextPage:body && results.length && offset+results.length < body.totalCount && input.page < 1000 ? input.page+1 : null },
    retrievedAt:new Date().toISOString(), providerUpdatedAt:null, timezone:'Asia/Seoul',
    dataNote:'한국관광공사 제공 목록입니다. 행사시작일·종료일은 공급자 조건으로 전달하며 기간에 겹치는 모든 행사의 포함을 보장하지 않습니다. 취소/연기·축제 형태·수정 시각은 원문으로 보존하고 표기되지 않은 시간대를 추정하지 않습니다. 현재 영업·실제 개최·요금·좌석·예약 가능은 미확인입니다. 이미지는 반환/다운로드하지 않으며 이미지 이용 조건은 별도로 확인해야 합니다. source.attribution을 함께 표시하세요.',
    source:{ name:'한국관광공사 TourAPI', url:sourceUrl, attribution:'출처: 한국관광공사 TourAPI 국문 관광정보' } };
}
async function readBody(response: Response) {
  const reader=response.body?.getReader(); if (!reader) throw invalid();
  const decoder=new TextDecoder('utf-8',{ fatal:true }); let raw='',bytes=0;
  const decode=(value?:Uint8Array,stream=false)=>{try{return decoder.decode(value,{stream});}catch{throw invalid();}};
  try { for (;;) { const part=await reader.read();if(part.done)break;bytes+=part.value.byteLength;if(bytes>2_000_000)throw new ActionError('RESULT_TOO_LARGE','TourAPI 응답이 너무 큽니다. 조회 개수를 줄여 주세요.');raw+=decode(part.value,true); } return raw+decode(); }
  catch(error){try{await reader.cancel();}catch{/* Keep the original bounded/sanitized error. */}throw error;}
  finally{reader.releaseLock();}
}
export function tourapiExecutor(fetcher: typeof fetch = fetch): Executor {
  return async(action,context)=>{
    const registered=tourapiActions.find(item=>item.id===action.id);if(!registered)throw new ActionError('NOT_IMPLEMENTED','TourAPI 실행기에 등록되지 않은 행동입니다.');
    const input=registered.schema.parse(context.job.input) as Record<string,any>,template=tourapiRequestTemplate(registered.id,input);
    if(context.signal.aborted)throw new ActionError('CANCELLED','작업이 취소됐습니다.','cancelled');
    const key=context.secrets.serviceKey?.trim();if(!key || key.length>4096 || /[^\x21-\x7e]/.test(key))throw new ActionError('AUTH_REQUIRED','TourAPI 국문 관광정보를 신청한 일반 인증키(Decoding)를 등록하세요.','awaiting_auth');
    const url=new URL(template.endpoint);for(const[name,value]of Object.entries(template.query))url.searchParams.set(name,String(value));url.searchParams.set('serviceKey',key);
    const signal=AbortSignal.any([context.signal,AbortSignal.timeout(30_000)]);context.dispatch();
    try{
      const response=await fetcher(url,{method:'GET',headers:{Accept:'application/json'},redirect:'error',cache:'no-store',signal});
      if([401,403].includes(response.status))throw new ActionError('AUTH_REQUIRED','TourAPI 키·활용신청·승인·접근 조건을 확인한 뒤 재개하세요.','awaiting_auth');
      if(response.status===429)throw new ActionError('PROVIDER_RATE_LIMIT','TourAPI 호출 한도를 초과했습니다.');
      if(!response.ok)throw new ActionError(`PROVIDER_HTTP_${response.status}`,'TourAPI가 정상 결과를 반환하지 않았습니다.');
      const data=normalize(await readBody(response),registered,input);
      if(context.signal.aborted)throw new ActionError('CANCELLED','작업이 취소됐습니다.','cancelled');return{data,evidence:registered.resultCheck};
    }catch(error){
      if(context.signal.aborted)throw new ActionError('CANCELLED','작업이 취소됐습니다.','cancelled');
      if(error instanceof ActionError)throw error;
      if(signal.aborted || error instanceof Error && error.name==='TimeoutError')throw new ActionError('PROVIDER_TIMEOUT','TourAPI 응답 시간이 초과됐습니다.');
      throw new ActionError('PROVIDER_CONNECTION_ERROR','TourAPI HTTPS API에 연결하지 못했습니다. 네트워크·서비스 상태를 확인하세요.');
    }
  };
}
