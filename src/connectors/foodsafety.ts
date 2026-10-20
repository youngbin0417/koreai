import { XMLParser, XMLValidator } from 'fast-xml-parser';
import { z } from 'zod';
import { zodToJsonSchema } from 'zod-to-json-schema';
import { ActionError, type Action, type Executor } from '../types.js';

const sourceUrl = 'https://www.foodsafetykorea.go.kr/api/openApiInfo.do?menu_grp=MENU_GRP31&menu_no=661&svc_no=I0490&svc_type_cd=API_TYPE06';
const base = 'https://openapi.foodsafetykorea.go.kr/api/';
const date = z.string().regex(/^\d{4}-\d{2}-\d{2}$/).refine(value => Number.isFinite(Date.parse(value)) && new Date(value).toISOString().slice(0,10) === value, '유효한 YYYY-MM-DD 날짜를 입력하세요.');
export const foodsafetySchema = z.object({
  start: z.number().int().min(1).max(1_000_000).default(1), end: z.number().int().min(1).max(1_000_000).default(10),
  createdOn: date.optional().describe('공급자의 등록일자 CRET_DTM 단일 날짜 조건'),
  changedSince: date.optional().describe('공급자 변경일자 CHNG_DT 이후 조건. 호출일 기준 최대 7일 증분 제한·당일 19시 이후 제공 조건은 공급자가 판정'),
  productReportNumber: z.string().trim().regex(/^\d{1,30}$/).optional().describe('공급자 품목제조보고번호 PRDLST_REPORT_NO. 바코드와 다름'),
  name: z.string().trim().min(1).max(100).optional().describe('요청 구간 안의 제품명 부분 일치 필터. 공급자 전체 검색이 아님'),
  barcode: z.string().trim().regex(/^[A-Za-z0-9]{1,40}$/).optional().describe('요청 구간 안의 바코드 원문 완전 일치. 숫자·영문 및 앞자리 0 보존'),
}).strict().refine(input => input.end >= input.start && input.end-input.start < 100, '시작~종료 위치는 오름차순으로 최대 100건이어야 합니다.');
export const foodsafetyAction: Action = {
  id:'foodsafety.recalls.search', serviceId:'foodsafety', connectorId:'foodsafety-api', title:'식품 회수·판매중지 조회',
  description:'식품안전나라 I0490의 회수·판매중지 공고를 요청 구간별로 조회합니다. 등록일·변경일·품목제조보고번호는 공급자 조건이며 이름·바코드는 그 구간 안에서만 필터링합니다. 제품·제조일/기한을 대조해야 하며 빈 결과가 안전성을 뜻하지 않습니다.',
  category:'날씨·환경', effect:'read', method:'api', schema:foodsafetySchema, inputSchema:zodToJsonSchema(foodsafetySchema,{ $refStrategy:'none' }) as Record<string,unknown>,
  credentialType:'foodsafety-api', requiredSecrets:['apiKey'], scopes:[], sourceUrl, checkedAt:'2026-10-20', verification:'documented',
  resultCheck:'I0490 정상 코드·전체 수/구간 건수·중복 회수 ID·품목제조보고번호를 확인합니다. 회수사유·제조일/기한·등급·등록시각을 원문으로 보존하고 현재 회수 완료나 개인 제품의 해당 여부·안전성을 추정하지 않습니다.',
  domains:['openapi.foodsafetykorea.go.kr'], version:'0.1.0', maintainer:'KoreAI', origin:'bundled', implemented:true,
};
export function foodsafetyExample(now = new Date()) {
  return { start:1, end:10, changedSince:new Date(now.getTime()+9*3_600_000-86_400_000).toISOString().slice(0,10) };
}
export function foodsafetyRequestTemplate(raw: unknown) {
  const input=foodsafetySchema.parse(raw),filters:Record<string,string>={};
  if(input.createdOn)filters.CRET_DTM=input.createdOn.replaceAll('-','');
  if(input.productReportNumber)filters.PRDLST_REPORT_NO=input.productReportNumber;
  if(input.changedSince)filters.CHNG_DT=input.changedSince.replaceAll('-','');
  const suffix=Object.entries(filters).map(([name,value])=>`${name}=${value}`).join('&');
  return {method:'GET' as const,endpoint:`${base}{apiKey}/I0490/json/${input.start}/${input.end}${suffix ? '/'+suffix : ''}`,query:{},
    authentication:{secretField:'apiKey' as const,pathParameter:'apiKey'},responseFormat:'json' as const,
    pathFilters:filters,localFilter:{name:input.name??null,barcode:input.barcode??null,scope:'requested_range'},
    providerLimits:{maxRows:1000,gatewayMaxRows:100,changedDataWindowDays:7,sameDayDataAvailableAfter:'19:00 Asia/Seoul'} };
}
const invalid = () => new ActionError('INVALID_RESPONSE','식품안전나라 응답의 구조·코드·전체 수·구간 건수·회수 ID 또는 보고번호가 유효하지 않습니다.');
const text=z.string().trim().max(100_000),optionalText=text.nullish();
const rowSchema=z.object({RTRVLDSUSE_SEQ:z.string().regex(/^\d{1,30}$/),PRDTNM:text.min(1),RTRVLPRVNS:optionalText,BSSHNM:optionalText,ADDR:optionalText,TELNO:optionalText,BRCDNO:optionalText,
  FRMLCUNIT:optionalText,MNFDT:optionalText,RTRVLPLANDOC_RTRVLMTHD:optionalText,DISTBTMLMT:optionalText,PRDLST_TYPE:optionalText,PRDLST_CD:optionalText,CRET_DTM:optionalText,
  PRDLST_REPORT_NO:optionalText,RTRVL_GRDCD_NM:optionalText,PRDLST_CD_NM:optionalText,LCNS_NO:optionalText});
const resultSchema=z.object({CODE:z.string().regex(/^(?:INFO|ERROR)-\d{3}$/)});
const integer=z.union([z.number().int().nonnegative().safe(),z.string().regex(/^\d{1,16}$/).transform(Number).refine(Number.isSafeInteger)]);
const parser=new XMLParser({parseTagValue:false,trimValues:true,ignoreAttributes:true,ignoreDeclaration:true,processEntities:{enabled:true,maxTotalExpansions:10_000,maxExpandedLength:100_000},htmlEntities:false});
function providerCode(code: string) {
  if(['INFO-000','INFO-200'].includes(code))return;
  if(['INFO-100','INFO-110','INFO-120','INFO-310','INFO-400','INFO-600'].includes(code))throw new ActionError('AUTH_REQUIRED','식품안전나라 본인 인증키·I0490 이용신청·승인·만료 조건을 확인한 뒤 재개하세요.','awaiting_auth');
  if(['INFO-300','INFO-320','INFO-330','ERROR-503'].includes(code))throw new ActionError('PROVIDER_RATE_LIMIT','식품안전나라 호출 한도에 도달했습니다. 시간대·증분 조회·본인 키의 제한을 확인한 뒤 다시 요청하세요.');
  if(code==='INFO-500')throw new ActionError('PROVIDER_BUSY','식품안전나라에서 같은 인증키를 사용 중입니다. 잠시 뒤 다시 요청하세요.');
  if(code==='INFO-700')throw new ActionError('PROVIDER_DATA_NOT_READY','식품안전나라의 당일 생성·변경 자료는 19시 이후 제공됩니다. 제공 시각 이후에 다시 요청하세요.');
  if(code==='ERROR-303')throw new ActionError('PROVIDER_DATE_WINDOW','식품안전나라 변경일자 증분 조회는 호출일 기준 최대 7일입니다. 날짜 조건을 확인하세요.');
  throw new ActionError(`PROVIDER_${code}`,'식품안전나라가 정상 결과를 반환하지 않았습니다. 공식 요청 조건·서비스 상태를 확인하세요.');
}
export function normalizeFoodsafetyResponse(raw: string, rawInput: unknown) {
  const input=foodsafetySchema.parse(rawInput);let root:unknown;
  try{
    if(raw.trimStart().startsWith('<')){
      if(/<!\s*(?:DOCTYPE|ENTITY)\b/i.test(raw) || XMLValidator.validate(raw)!==true)throw invalid();root=parser.parse(raw);
    }else root=JSON.parse(raw);
  }catch{throw invalid();}
  const envelope=z.object({I0490:z.object({RESULT:resultSchema,total_count:z.unknown().optional(),row:z.unknown().optional()}).optional(),RESULT:resultSchema.optional()}).safeParse(root);
  if(!envelope.success || envelope.data.I0490 && envelope.data.RESULT)throw invalid();
  const body=envelope.data.I0490,result=body?.RESULT??envelope.data.RESULT;if(!result)throw invalid();providerCode(result.CODE);
  const rawRows=body?.row,rows=rawRows===undefined || rawRows==='' ? [] : Array.isArray(rawRows) ? rawRows : [rawRows];
  const parsed=z.array(rowSchema).max(input.end-input.start+1).safeParse(rows);if(!parsed.success || new Set(parsed.data.map(row=>row.RTRVLDSUSE_SEQ)).size!==rows.length)throw invalid();
  const parsedTotal=integer.safeParse(body?.total_count);let total:number|null=null;
  if(result.CODE==='INFO-000'){
    if(!body || !parsedTotal.success)throw invalid();total=parsedTotal.data;
    if(rows.length!==Math.min(input.end-input.start+1,Math.max(0,total-input.start+1)))throw invalid();
  }else{
    if(rows.length)throw invalid();if(parsedTotal.success)total=parsedTotal.data;
    if(total!==null && total>=input.start)throw invalid();
  }
  if(input.productReportNumber && parsed.data.some(row=>row.PRDLST_REPORT_NO!==input.productReportNumber))throw invalid();
  const matches=parsed.data.filter(row=>(!input.name || row.PRDTNM.toLocaleLowerCase('ko-KR').includes(input.name.toLocaleLowerCase('ko-KR'))) && (!input.barcode || row.BRCDNO===input.barcode));
  return {status:matches.length?'available':'no_data',recalls:matches.map(row=>({recallId:row.RTRVLDSUSE_SEQ,productName:row.PRDTNM,reason:row.RTRVLPRVNS||null,manufacturer:row.BSSHNM||null,manufacturerAddress:row.ADDR||null,phone:row.TELNO||null,
    barcodeRaw:row.BRCDNO||null,packageRaw:row.FRMLCUNIT||null,manufacturedOnRaw:row.MNFDT||null,expiryRaw:row.DISTBTMLMT||null,recallMethodRaw:row.RTRVLPLANDOC_RTRVLMTHD||null,foodCategoryRaw:row.PRDLST_TYPE||null,
    productCode:row.PRDLST_CD||null,productReportNumber:row.PRDLST_REPORT_NO||null,recallGradeRaw:row.RTRVL_GRDCD_NM||null,productTypeRaw:row.PRDLST_CD_NM||null,manufacturerLicenseNumber:row.LCNS_NO||null,registeredAtRaw:row.CRET_DTM||null,
    recallCompleted:null,appliesToUserProduct:null,productSafety:null})),returnedCount:matches.length,providerReturnedCount:rows.length,
    pagination:{start:input.start,end:input.end,requestedCount:input.end-input.start+1,providerTotalCount:total,matchingTotalCount:null,
      nextRange:total!==null && rows.length && input.end<total && input.end<1_000_000 ? {start:input.end+1,end:Math.min(input.end+input.end-input.start+1,total,1_000_000)} : null},
    filter:{createdOn:input.createdOn??null,changedSince:input.changedSince??null,productReportNumber:input.productReportNumber??null,name:input.name??null,barcode:input.barcode??null,localScope:'requested_range'},
    ...(!matches.length?{reason:rows.length?'no_match_in_range':'empty_provider_range',message:'요청 조건·구간에 해당 공고가 없습니다. 전체 공고의 부재나 제품의 안전성을 의미하지 않습니다.'}:{}),
    retrievedAt:new Date().toISOString(),providerUpdatedAt:null,timezone:'Asia/Seoul',
    dataNote:'식품의약품안전처 회수·판매중지 공고입니다. 제품명·제조업체·제조일·유통/소비기한·포장·바코드를 실물 표시와 대조해야 하며 공고 존재나 검색 부재만으로 개인 제품 해당 여부·현재 회수 완료·안전성을 판정하지 않습니다. 제조일/기한·등급·등록시각은 원문으로 보존하고 갱신 시각·시간대를 추정하지 않습니다. 이름/바코드는 요청 구간 안의 필터이며 이미지는 반환/다운로드하지 않습니다. source.attribution을 함께 표시하세요.',
    source:{name:'식품의약품안전처 식품안전나라',url:sourceUrl,attribution:'출처: 식품의약품안전처 식품안전나라 회수·판매중지 정보(I0490)'}};
}
async function readBody(response: Response){
  const reader=response.body?.getReader();if(!reader)throw invalid();const decoder=new TextDecoder('utf-8',{fatal:true});let raw='',bytes=0;
  const decode=(value?:Uint8Array,stream=false)=>{try{return decoder.decode(value,{stream});}catch{throw invalid();}};
  try{for(;;){const part=await reader.read();if(part.done)break;bytes+=part.value.byteLength;if(bytes>2_000_000)throw new ActionError('RESULT_TOO_LARGE','식품안전나라 응답이 너무 큽니다. 조회 구간을 줄여 주세요.');raw+=decode(part.value,true);}return raw+decode();}
  catch(error){try{await reader.cancel();}catch{/* Preserve the original error. */}throw error;}finally{reader.releaseLock();}
}
export function foodsafetyExecutor(fetcher: typeof fetch = fetch): Executor {
  return async(action,context)=>{
    if(action.id!==foodsafetyAction.id)throw new ActionError('NOT_IMPLEMENTED','식품안전나라 실행기에 등록되지 않은 행동입니다.');
    const input=foodsafetySchema.parse(context.job.input),template=foodsafetyRequestTemplate(input);
    if(context.signal.aborted)throw new ActionError('CANCELLED','작업이 취소됐습니다.','cancelled');
    const key=context.secrets.apiKey?.trim();
    if(!key || !/^[A-Za-z0-9_-]{8,256}$/.test(key) || key.toLowerCase()==='sample')throw new ActionError('AUTH_REQUIRED','식품안전나라에서 발급받고 I0490을 신청한 본인 인증키를 등록하세요. 공개 sample 키는 계정 실행에 사용하지 않습니다.','awaiting_auth');
    const url=template.endpoint.replace('{apiKey}',encodeURIComponent(key));
    const signal=AbortSignal.any([context.signal,AbortSignal.timeout(30_000)]);context.dispatch();
    try{
      const response=await fetcher(url,{method:'GET',headers:{Accept:'application/json'},redirect:'error',cache:'no-store',signal});
      if([401,403].includes(response.status))throw new ActionError('AUTH_REQUIRED','식품안전나라 키·I0490 이용신청·접근 조건을 확인한 뒤 재개하세요.','awaiting_auth');
      if(response.status===429)throw new ActionError('PROVIDER_RATE_LIMIT','식품안전나라 호출 한도를 초과했습니다.');
      if(!response.ok)throw new ActionError(`PROVIDER_HTTP_${response.status}`,'식품안전나라가 정상 결과를 반환하지 않았습니다.');
      const data=normalizeFoodsafetyResponse(await readBody(response),input);
      if(context.signal.aborted)throw new ActionError('CANCELLED','작업이 취소됐습니다.','cancelled');return{data,evidence:foodsafetyAction.resultCheck};
    }catch(error){
      if(context.signal.aborted)throw new ActionError('CANCELLED','작업이 취소됐습니다.','cancelled');if(error instanceof ActionError)throw error;
      if(signal.aborted || error instanceof Error && error.name==='TimeoutError')throw new ActionError('PROVIDER_TIMEOUT','식품안전나라 응답 시간이 초과됐습니다.');
      throw new ActionError('PROVIDER_CONNECTION_ERROR','식품안전나라 HTTPS API에 연결하지 못했습니다. 네트워크·서비스 상태를 확인하세요.');
    }
  };
}
