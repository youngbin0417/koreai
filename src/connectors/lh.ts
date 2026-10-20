import { XMLParser, XMLValidator } from 'fast-xml-parser';
import { z } from 'zod';
import { zodToJsonSchema } from 'zod-to-json-schema';
import { ActionError, type Action, type Executor } from '../types.js';

const sourceUrl='https://www.data.go.kr/data/15058530/openapi.do';
const endpoint='https://apis.data.go.kr/B552555/lhLeaseNoticeInfo1/lhLeaseNoticeInfo1';
export const lhNoticeTypes={'01':'토지','05':'분양주택','06':'임대주택','13':'주거복지','22':'상가','39':'신혼희망타운'} as const;
export const lhRegions={'11':'서울특별시','12':'전남광주통합특별시','26':'부산광역시','27':'대구광역시','28':'인천광역시','30':'대전광역시','31':'울산광역시','36110':'세종특별자치시','41':'경기도','43':'충청북도','44':'충청남도','47':'경상북도','48':'경상남도','50':'제주특별자치도','51':'강원특별자치도','52':'전북특별자치도'} as const;
const states=['공고중','접수중','접수마감','상담요청','정정공고중'] as const;
const date=z.string().regex(/^\d{4}-\d{2}-\d{2}$/).refine(value=>Number.isFinite(Date.parse(value)) && new Date(value).toISOString().slice(0,10)===value,'유효한 YYYY-MM-DD 날짜를 입력하세요.');
const noticeType=z.enum(Object.keys(lhNoticeTypes) as [keyof typeof lhNoticeTypes,...(keyof typeof lhNoticeTypes)[]]);
const region=z.enum(Object.keys(lhRegions) as [keyof typeof lhRegions,...(keyof typeof lhRegions)[]]);
export const lhSchema=z.object({
  postedFrom:date.describe('게시일 기간검색 시작일 PAN_ST_DT'),postedTo:date.describe('게시일 기간검색 종료일 PAN_ED_DT'),
  closingFrom:date.optional().describe('공고 마감일 검색 시작일 CLSG_ST_DT. 실제 청약 접수 시작일과 다름'),closingTo:date.optional().describe('공고 마감일 검색 종료일 CLSG_ED_DT'),
  name:z.string().trim().min(1).max(50).optional(),noticeType:noticeType.optional(),regionCode:region.optional().describe('LH 20260708 가이드의 CNP_CD. 세종 36110 등 다른 서비스 지역 코드와 혼용하지 않음'),
  status:z.enum(states).optional().describe('공급자 공고 상태 원문. 접수중도 개인의 신청 가능을 확정하지 않음'),
  page:z.number().int().min(1).max(1000).default(1),limit:z.number().int().min(1).max(100).default(10),
}).strict().refine(input=>input.postedTo>=input.postedFrom,'게시일 검색 종료일은 시작일 이후여야 합니다.')
  .refine(input=>!input.closingFrom || !input.closingTo || input.closingTo>=input.closingFrom,'마감일 검색 종료일은 시작일 이후여야 합니다.');
export const lhAction:Action={id:'lh.notices.search',serviceId:'lh',connectorId:'lh-notices-api',title:'LH 임대·분양 공고 조회',
  description:'게시일 기간·LH 지역/유형·상태·공고명으로 LH 공고 한 페이지를 조회합니다. 마감일 검색도 제공하며 원문 공고와 정정 내용을 확인해야 합니다. 개인 자격 판정·청약 신청은 실행하지 않습니다.',
  category:'일정·문화·주거',effect:'read',method:'api',schema:lhSchema,inputSchema:zodToJsonSchema(lhSchema,{$refStrategy:'none'}) as Record<string,unknown>,credentialType:'lh-api',requiredSecrets:['serviceKey'],scopes:[],sourceUrl,checkedAt:'2026-10-20',verification:'documented',
  resultCheck:'resHeader의 Y·dsSch 요청 대조·행 순번/전체 수·복합 공고 식별자·선택한 유형/상태를 검증합니다. 링크의 공고/시스템 식별자가 일치할 때만 반환하며 게시/모집공고/마감일과 개인 신청 가능 여부를 구분합니다.',
  domains:['apis.data.go.kr'],version:'0.1.0',maintainer:'KoreAI',origin:'bundled',implemented:true};
export function lhExample(now=new Date()){
  const today=new Date(now.getTime()+9*3_600_000);
  return{postedFrom:new Date(today.getTime()-30*86_400_000).toISOString().slice(0,10),postedTo:today.toISOString().slice(0,10),noticeType:'06',page:1,limit:10};
}
export function lhRequestTemplate(raw:unknown){
  const input=lhSchema.parse(raw),query:Record<string,string|number>={PG_SZ:input.limit,PAGE:input.page,PAN_ST_DT:input.postedFrom.replaceAll('-',''),PAN_ED_DT:input.postedTo.replaceAll('-','')};
  if(input.closingFrom)query.CLSG_ST_DT=input.closingFrom.replaceAll('-','');if(input.closingTo)query.CLSG_ED_DT=input.closingTo.replaceAll('-','');
  for(const[key,name]of Object.entries({name:'PAN_NM',noticeType:'UPP_AIS_TP_CD',regionCode:'CNP_CD',status:'PAN_SS'})){const value=input[key as keyof typeof input];if(value!==undefined)query[name]=value;}
  return{method:'GET' as const,endpoint,query,authentication:{secretField:'serviceKey' as const,queryParameter:'serviceKey'},responseFormat:'json' as const};
}
const invalid=()=>new ActionError('INVALID_RESPONSE','LH 응답의 JSON·결과 코드·요청 정보·순번·전체 수 또는 공고 식별자가 유효하지 않습니다.');
const text=z.string().trim().max(100_000),optionalText=text.nullish(),digits=z.string().regex(/^\d{1,30}$/),typeCode=z.string().regex(/^\d{2}$/);
const integer=z.union([z.number(),z.string().regex(/^\d{1,16}$/).transform(Number)]).pipe(z.number().int().nonnegative().safe());
const rowSchema=z.object({PAN_ID:digits,UPP_AIS_TP_CD:typeCode,AIS_TP_CD:typeCode,SPL_INF_TP_CD:z.string().regex(/^\d{1,6}$/),CCR_CNNT_SYS_DS_CD:typeCode,
  RNUM:integer.pipe(z.number().min(1)),ALL_CNT:integer,PAN_NM:text.min(1),UPP_AIS_TP_NM:optionalText,AIS_TP_CD_NM:optionalText,CNP_CD_NM:optionalText,PAN_SS:optionalText,
  PAN_NT_ST_DT:optionalText,CLSG_DT:optionalText,PAN_DT:optionalText,DTL_URL:optionalText,DTL_URL_MOB:optionalText});
type NoticeRow=z.infer<typeof rowSchema>;
const parser=new XMLParser({parseTagValue:false,trimValues:true,ignoreAttributes:true,ignoreDeclaration:true,processEntities:false});
function gatewayError(root:unknown){
  const gateway=z.object({OpenAPI_ServiceResponse:z.object({cmmMsgHeader:z.object({returnReasonCode:z.string().regex(/^\d{1,2}$/)})})}).safeParse(root);
  if(!gateway.success)return;
  const code=gateway.data.OpenAPI_ServiceResponse.cmmMsgHeader.returnReasonCode.padStart(2,'0');
  if(['20','21','30','31','32','33'].includes(code))throw new ActionError('AUTH_REQUIRED','LH 분양임대공고문 조회 서비스 활용신청·승인·일반 인증키(Decoding)·접근 조건을 확인한 뒤 재개하세요.','awaiting_auth');
  if(['22','23'].includes(code))throw new ActionError('PROVIDER_RATE_LIMIT','LH 공고 API 호출 한도를 초과했습니다. 본인 키의 한도를 확인하세요.');
  if(code==='29')throw new ActionError('PROVIDER_ACCESS_BLOCKED','LH 공고 API에서 호출 서버 IP의 접근을 차단했습니다.');
  throw new ActionError(`PROVIDER_${code}`,'LH 공고 API가 정상 결과를 반환하지 않았습니다.');
}
function readResponse(raw:string,input:z.infer<typeof lhSchema>){
  let root:unknown;
  try{if(raw.trimStart().startsWith('<')){if(/<!\s*(?:DOCTYPE|ENTITY)\b/i.test(raw) || XMLValidator.validate(raw)!==true)throw invalid();root=parser.parse(raw);}else root=JSON.parse(raw);}catch{throw invalid();}
  gatewayError(root);
  const parts=z.array(z.object({dsSch:z.array(z.object({PAGE:integer.optional(),PG_SZ:integer.optional(),PAN_ST_DT:optionalText,PAN_ED_DT:optionalText,CLSG_ST_DT:optionalText,CLSG_ED_DT:optionalText})).length(1).optional(),
    resHeader:z.array(z.object({SS_CODE:z.string(),RS_DTTM:optionalText})).length(1).optional(),dsList:z.array(z.unknown()).optional()})).min(1).max(2).safeParse(root);
  if(!parts.success)throw invalid();
  const headers=parts.data.filter(part=>part.resHeader),echoes=parts.data.filter(part=>part.dsSch),lists=parts.data.filter(part=>part.dsList!==undefined);
  if(headers.length!==1 || echoes.length>1)throw invalid();
  const header=headers[0]!.resHeader![0]!;
  if(header.SS_CODE!=='Y')throw new ActionError('PROVIDER_REJECTED','LH가 성공 결과를 반환하지 않았습니다. 요청 조건과 서비스 상태를 확인하세요.');
  if(lists.length!==1 || !headers[0]!.dsList)throw invalid();
  const echo=echoes[0]?.dsSch?.[0];
  if(echo){if(echo.PAGE!==undefined && echo.PAGE!==input.page || echo.PG_SZ!==undefined && echo.PG_SZ!==input.limit)throw invalid();
    for(const[key,value]of Object.entries({PAN_ST_DT:input.postedFrom,PAN_ED_DT:input.postedTo,CLSG_ST_DT:input.closingFrom,CLSG_ED_DT:input.closingTo})){
      const reported=echo[key as keyof typeof echo];if(reported!==undefined && reported!==null && reported!=='' && reported!==value?.replaceAll('-',''))throw invalid();
    }
  }
  return{header,rows:headers[0]!.dsList!};
}
function dateValue(raw?:string|null){
  if(!raw)return null;
  const value=/^\d{8}$/.test(raw)?`${raw.slice(0,4)}-${raw.slice(4,6)}-${raw.slice(6)}`:raw.replaceAll('.','-');
  if(!/^\d{4}-\d{2}-\d{2}$/.test(value))return null;
  if(!date.safeParse(value).success)throw invalid();return value;
}
function detailLink(raw:string|null|undefined,row:NoticeRow){
  if(!raw)return{url:null,check:'missing'};
  try{
    const url=new URL(raw);
    if(url.origin!=='https://apply.lh.or.kr' || url.username || url.password)return{url:null,check:'rejected_url'};
    let refs:Record<string,string>={};
    if(url.pathname==='/lhapply/apply/wt/wrtanc/selectWrtancInfo.do'){
      for(const[key,value]of url.searchParams){if(['panId','ccrCnntSysDsCd','uppAisTpCd','aisTpCd'].includes(key)){if(key in refs)return{url:null,check:'rejected_url'};refs[key]=value;}}
      refs={PAN_ID:refs.panId??'',CCR_CNNT_SYS_DS_CD:refs.ccrCnntSysDsCd??'',UPP_AIS_TP_CD:refs.uppAisTpCd??'',AIS_TP_CD:refs.aisTpCd??''};
    }else if(url.pathname==='/LH/index.html'){
      if(url.searchParams.getAll('gv_param').length!==1)return{url:null,check:'rejected_url'};
      for(const pair of (url.searchParams.get('gv_param')??'').split(',')){const index=pair.indexOf(':');if(index<0)continue;const key=pair.slice(0,index);if(key in refs)return{url:null,check:'rejected_url'};refs[key]=pair.slice(index+1);}
    }else return{url:null,check:'rejected_url'};
    if(!refs.PAN_ID || !refs.CCR_CNNT_SYS_DS_CD)return{url:null,check:'unverified_reference'};
    for(const key of ['PAN_ID','CCR_CNNT_SYS_DS_CD','UPP_AIS_TP_CD','AIS_TP_CD'] as const)if(refs[key] && refs[key]!==row[key])return{url:null,check:'mismatched_reference'};
    return{url:url.href,check:'matched_reference'};
  }catch{return{url:null,check:'rejected_url'};}
}
export function normalizeLhResponse(raw:string,rawInput:unknown){
  const input=lhSchema.parse(rawInput),response=readResponse(raw,input),parsed=z.array(rowSchema).max(input.limit).safeParse(response.rows);
  if(!parsed.success)throw invalid();const rows=parsed.data,total=rows[0]?.ALL_CNT??null,offset=(input.page-1)*input.limit;
  const key=(row:NoticeRow)=>[row.CCR_CNNT_SYS_DS_CD,row.PAN_ID,row.UPP_AIS_TP_CD,row.AIS_TP_CD,row.SPL_INF_TP_CD].join(':');
  if(new Set(rows.map(key)).size!==rows.length || total!==null && rows.length!==Math.min(input.limit,Math.max(0,total-offset)))throw invalid();
  const notices=rows.map((row,index)=>{
    if(row.ALL_CNT!==total || row.RNUM!==offset+index+1 || input.noticeType && row.UPP_AIS_TP_CD!==input.noticeType || input.status && row.PAN_SS!==input.status)throw invalid();
    return{noticeKey:key(row),noticeId:row.PAN_ID,reference:{noticeId:row.PAN_ID,noticeTypeCode:row.UPP_AIS_TP_CD,subTypeCode:row.AIS_TP_CD,supplyInfoTypeCode:row.SPL_INF_TP_CD,customerSystemCode:row.CCR_CNNT_SYS_DS_CD},
      title:row.PAN_NM,noticeTypeName:row.UPP_AIS_TP_NM||null,subTypeName:row.AIS_TP_CD_NM||null,regionNameRaw:row.CNP_CD_NM||null,statusRaw:row.PAN_SS||null,
      publishedOn:dateValue(row.PAN_NT_ST_DT),publishedOnRaw:row.PAN_NT_ST_DT||null,closingOn:dateValue(row.CLSG_DT),closingOnRaw:row.CLSG_DT||null,announcementOn:dateValue(row.PAN_DT),announcementOnRaw:row.PAN_DT||null,
      detailLinks:{desktop:detailLink(row.DTL_URL,row),mobile:detailLink(row.DTL_URL_MOB,row)},currentlyAcceptingApplications:null,userEligible:null,applicationSubmitted:null};
  });
  return{status:notices.length?'available':'no_data',notices,returnedCount:notices.length,query:input,
    pagination:{page:input.page,limit:input.limit,totalCount:total,nextPage:total!==null && offset+notices.length<total && input.page<1000?input.page+1:null},
    providerOutputAtRaw:response.header.RS_DTTM||null,providerUpdatedAt:null,retrievedAt:new Date().toISOString(),timezone:'Asia/Seoul',
    dataNote:'LH 공개 공고 목록입니다. 지역명은 원문으로 보존하며 입력 지역 코드의 응답 대조값이 아닙니다. 게시일·모집공고일·공고마감일은 서로 다르며 개인 청약 접수 일정·자격·현재 신청 가능을 확정하지 않습니다. 정정공고와 원문 조건을 확인하세요. 빈 페이지에는 전체 건수가 없을 수 있으며 공고 부재를 확정하지 않습니다. 공급자 출력 시각은 자료 갱신 시각이 아니고 시간대를 추정하지 않습니다. 링크는 확인된 공고 식별자와 대조하며 첨부파일·페이지를 추가 호출하지 않습니다. source.attribution을 함께 표시하세요.',
    source:{name:'한국토지주택공사 LH',url:sourceUrl,attribution:'출처: 한국토지주택공사 분양임대공고문 조회 서비스'}};
}
async function readBody(response:Response){
  const reader=response.body?.getReader();if(!reader)throw invalid();const decoder=new TextDecoder('utf-8',{fatal:true});let raw='',bytes=0;
  const decode=(value?:Uint8Array,stream=false)=>{try{return decoder.decode(value,{stream});}catch{throw invalid();}};
  try{for(;;){const part=await reader.read();if(part.done)break;bytes+=part.value.byteLength;if(bytes>2_000_000)throw new ActionError('RESULT_TOO_LARGE','LH 응답이 너무 큽니다. 조회 개수를 줄여 주세요.');raw+=decode(part.value,true);}return raw+decode();}
  catch(error){try{await reader.cancel();}catch{/* Preserve the original error. */}throw error;}finally{reader.releaseLock();}
}
export function lhExecutor(fetcher:typeof fetch=fetch):Executor{
  return async(action,context)=>{
    if(action.id!==lhAction.id)throw new ActionError('NOT_IMPLEMENTED','LH 실행기에 등록되지 않은 행동입니다.');
    const input=lhSchema.parse(context.job.input),template=lhRequestTemplate(input);
    if(context.signal.aborted)throw new ActionError('CANCELLED','작업이 취소됐습니다.','cancelled');
    const key=context.secrets.serviceKey?.trim();if(!key || key.length>4096 || /[^\x21-\x7e]/.test(key))throw new ActionError('AUTH_REQUIRED','LH 분양임대공고문 조회 서비스를 신청한 일반 인증키(Decoding)를 등록하세요.','awaiting_auth');
    const url=new URL(template.endpoint);for(const[name,value]of Object.entries(template.query))url.searchParams.set(name,String(value));url.searchParams.set('serviceKey',key);
    const signal=AbortSignal.any([context.signal,AbortSignal.timeout(30_000)]);context.dispatch();
    try{
      const response=await fetcher(url,{method:'GET',headers:{Accept:'application/json'},redirect:'error',cache:'no-store',signal});
      if([401,403].includes(response.status))throw new ActionError('AUTH_REQUIRED','LH 키·활용신청·승인·접근 조건을 확인한 뒤 재개하세요.','awaiting_auth');
      if(response.status===429)throw new ActionError('PROVIDER_RATE_LIMIT','LH 공고 API 호출 한도를 초과했습니다.');
      if(!response.ok)throw new ActionError(`PROVIDER_HTTP_${response.status}`,'LH 공고 API가 정상 결과를 반환하지 않았습니다.');
      const data=normalizeLhResponse(await readBody(response),input);
      if(context.signal.aborted)throw new ActionError('CANCELLED','작업이 취소됐습니다.','cancelled');return{data,evidence:lhAction.resultCheck};
    }catch(error){
      if(context.signal.aborted)throw new ActionError('CANCELLED','작업이 취소됐습니다.','cancelled');if(error instanceof ActionError)throw error;
      if(signal.aborted || error instanceof Error && error.name==='TimeoutError')throw new ActionError('PROVIDER_TIMEOUT','LH 공고 API 응답 시간이 초과됐습니다.');
      throw new ActionError('PROVIDER_CONNECTION_ERROR','LH 공고 HTTPS API에 연결하지 못했습니다. 네트워크·서비스 상태를 확인하세요.');
    }
  };
}
