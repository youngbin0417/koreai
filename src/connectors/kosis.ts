import { z } from 'zod';
import { zodToJsonSchema } from 'zod-to-json-schema';
import { ActionError, type Action, type Executor } from '../types.js';

const sourceUrl='https://kosis.kr/openapi/devGuide/devGuide_0201List.do';
const endpoint='https://kosis.kr/openapi/Param/statisticsParameterData.do';
export const kosisTable={orgId:'101',tableId:'DT_1YL20631',name:'고령인구비율(시도/시/군/구)',classificationId:'SGG',checkedAt:'2026-10-20',
  url:'https://kosis.kr/statHtml/statHtml.do?orgId=101&tblId=DT_1YL20631&conn_path=I2'} as const;
// Reviewed top-level classifications from the official table, not administrative/legal-dong codes.
export const kosisRegions={'00':'전국','11':'서울특별시','12':'전남광주통합특별시','21':'부산광역시','22':'대구광역시','23':'인천광역시','25':'대전광역시','26':'울산광역시','29':'세종특별자치시','31':'경기도','32':'강원특별자치도','33':'충청북도','34':'충청남도','35':'전북특별자치도','37':'경상북도','38':'경상남도','39':'제주특별자치도'} as const;
export const kosisItems={T10:{name:'고령인구비율 (A÷B×100)',unit:'%'},T001:{name:'65세이상인구 (A)',unit:'명'},T002:{name:'전체인구 (B)',unit:'명'}} as const;
const region=z.enum(Object.keys(kosisRegions) as [keyof typeof kosisRegions,...(keyof typeof kosisRegions)[]]);
const item=z.enum(['T10','T001','T002']);
const period=z.string().regex(/^(?:20\d{2}|20\d{2}(?:0[1-9]|1[0-2]))$/);
function periodIndex(value:string){return value.length===4?Number(value):Number(value.slice(0,4))*12+Number(value.slice(4))-1;}
export const kosisSchema=z.object({
  regionCodes:z.array(region).min(1).max(5).refine(values=>new Set(values).size===values.length,'지역 중복을 제거하세요.').describe('이 표의 SGG 시도 코드. 전국 00, 서울 11, 부산 21, 경기 31, 세종 29. 다른 API 코드와 혼용하지 않음'),
  itemIds:z.array(item).min(1).max(3).refine(values=>new Set(values).size===values.length,'항목 중복을 제거하세요.').default(['T10','T001','T002']),
  frequency:z.enum(['M','Y']).describe('월 M / 연 Y. 월·연 자료를 같은 시점으로 비교하지 않음'),
  from:period.describe('월 YYYYMM(200801 이후), 연 YYYY(2000 이후). 명시적 시작 시점'),
  to:period.describe('종료 시점. 시작 포함 최대 12개 월 또는 연. 입력 시점의 자료 존재는 보장하지 않음'),
}).strict().superRefine((input,ctx)=>{
  const length=input.frequency==='M'?6:4,min=input.frequency==='M'?'200801':'2000';
  if(input.from.length!==length || input.to.length!==length || input.from<min || input.to<min)ctx.addIssue({code:z.ZodIssueCode.custom,message:'수록 주기에 맞는 시작·종료 시점을 입력하세요.'});
  if(input.to<input.from || periodIndex(input.to)-periodIndex(input.from)>11)ctx.addIssue({code:z.ZodIssueCode.custom,message:'시작 포함 최대 12개 시점을 순서대로 입력하세요.'});
});
export const kosisAction:Action={id:'kosis.aging.search',serviceId:'kosis',connectorId:'kosis-statistics-api',title:'KOSIS 지역 인구·고령화 지표 조회',
  description:'검토된 고령인구비율 표에서 전국·시도 최대 5곳, 월/연 최대 12개 시점의 비율·65세 이상 인구·전체 인구를 조회합니다. 통계부호·단위·수록시점을 보존하며 현재 인구나 개인 수급 자격을 판정하지 않습니다.',
  category:'공공·세무',effect:'read',method:'api',schema:kosisSchema,inputSchema:zodToJsonSchema(kosisSchema,{$refStrategy:'none'}) as Record<string,unknown>,credentialType:'kosis-api',requiredSecrets:['apiKey'],scopes:[],sourceUrl,checkedAt:kosisTable.checkedAt,verification:'documented',
  resultCheck:'공급자 오류·표/기관·요청 지역/항목/주기/시점·단위·중복 셀을 검증합니다. 수치 문자열·통계부호·자료 수정일을 보존하며 미반환 조합과 0을 구분합니다.',
  domains:['kosis.kr'],version:'0.1.0',maintainer:'KoreAI',origin:'bundled',implemented:true};
export function kosisExample(now=new Date()){
  const seoul=new Date(now.getTime()+9*3_600_000),previous=new Date(Date.UTC(seoul.getUTCFullYear(),seoul.getUTCMonth()-1,1)).toISOString().slice(0,7).replace('-','');
  return{regionCodes:['11','31'],itemIds:['T10','T001','T002'],frequency:'M',from:previous,to:previous};
}
export function kosisRequestTemplate(raw:unknown){
  const input=kosisSchema.parse(raw);return{method:'GET' as const,endpoint,query:{method:'getList',format:'json',jsonVD:'Y',orgId:kosisTable.orgId,tblId:kosisTable.tableId,objL1:input.regionCodes.join('+'),itmId:input.itemIds.join('+'),prdSe:input.frequency,startPrdDe:input.from,endPrdDe:input.to,smblChk:'Y'},
    authentication:{secretField:'apiKey' as const,queryParameter:'apiKey'},responseFormat:'json' as const};
}
const invalid=()=>new ActionError('INVALID_RESPONSE','KOSIS 응답의 JSON·통계표·지역·항목·주기·단위·시점 또는 셀 식별자가 유효하지 않습니다.');
const text=z.string().max(3000),code=z.string().min(1).max(40);
const rowSchema=z.object({ORG_ID:code,TBL_ID:code,TBL_NM:text.min(1),C1:code,C1_NM:text.min(1),C1_OBJ_NM:text.optional(),
  ITM_ID:item,ITM_NM:text.min(1),UNIT_NM:text.min(1),PRD_SE:code,PRD_DE:period,DT:z.string().max(100).nullable(),LST_CHN_DE:z.string().max(10).nullish()}).passthrough();
function providerError(root:unknown){
  if(!root || Array.isArray(root) || typeof root!=='object')return false;
  const error=z.object({err:z.union([z.string().regex(/^\d{1,2}$/),z.number().int().min(0).max(99)]).transform(String)}).safeParse(root);
  if(!error.success)throw invalid();
  const code=error.data.err;
  if(['10','11'].includes(code))throw new ActionError('AUTH_REQUIRED','KOSIS 공유서비스에서 발급한 본인 인증키·이용기간·신청 상태를 확인한 뒤 재개하세요.','awaiting_auth');
  if(code==='30')return true;
  if(code==='40')throw new ActionError('PROVIDER_RATE_LIMIT','KOSIS 호출 한도를 초과했습니다. 분당 200건 공지와 본인 키 조건을 확인하세요.');
  if(['31','41'].includes(code))throw new ActionError('RESULT_TOO_LARGE','KOSIS 조회 행 한도를 초과했습니다. 지역·항목·기간을 줄여 주세요.');
  if(code==='42')throw new ActionError('PROVIDER_ACCESS_BLOCKED','KOSIS에서 사용자 이용을 제한했습니다. 공급자에게 이용 조건을 확인하세요.');
  throw new ActionError(`PROVIDER_${code}`,'KOSIS가 정상 통계자료를 반환하지 않았습니다. 조회 조건·서비스 상태를 확인하세요.');
}
function periods(input:z.infer<typeof kosisSchema>){
  return Array.from({length:periodIndex(input.to)-periodIndex(input.from)+1},(_,i)=>{
    const index=periodIndex(input.from)+i;return input.frequency==='Y'?String(index):`${Math.floor(index/12)}${String(index%12+1).padStart(2,'0')}`;
  });
}
function modifiedDate(value:string|null|undefined){
  if(!value)return null;
  if(!/^\d{4}-\d{2}-\d{2}$/.test(value) || !Number.isFinite(Date.parse(value)) || new Date(value).toISOString().slice(0,10)!==value)throw invalid();return value;
}
export function normalizeKosisResponse(raw:string,rawInput:unknown){
  const input=kosisSchema.parse(rawInput);let root:unknown;try{root=JSON.parse(raw);}catch{throw invalid();}
  const noData=providerError(root),expectedPeriods=periods(input),expectedCount=input.regionCodes.length*input.itemIds.length*expectedPeriods.length;
  const parsed=z.array(rowSchema).max(expectedCount).safeParse(noData?[]:root);if(!parsed.success)throw invalid();
  const seen=new Set<string>();
  const observations=parsed.data.map(row=>{
    if(row.ORG_ID!==kosisTable.orgId || row.TBL_ID!==kosisTable.tableId || !input.regionCodes.includes(row.C1 as keyof typeof kosisRegions) || !input.itemIds.includes(row.ITM_ID) || !expectedPeriods.includes(row.PRD_DE) || !(input.frequency==='Y'?['Y','A']:['M']).includes(row.PRD_SE) || row.UNIT_NM!==kosisItems[row.ITM_ID].unit)throw invalid();
    for(let i=2;i<=8;i++)if(row[`C${i}`]!==undefined && row[`C${i}`]!==null && row[`C${i}`]!=='')throw invalid();
    const cellKey=`${row.C1}:${row.ITM_ID}:${row.PRD_DE}`;if(seen.has(cellKey))throw invalid();seen.add(cellKey);
    const rawValue=row.DT,trimmed=rawValue?.trim()??'',numeric=/^-?\d+(?:\.\d+)?$/.test(trimmed);
    return{cellKey,regionCode:row.C1,regionNameRaw:row.C1_NM,classificationNameRaw:row.C1_OBJ_NM??null,itemId:row.ITM_ID,itemNameRaw:row.ITM_NM,unit:row.UNIT_NM,
      frequency:input.frequency,frequencyRaw:row.PRD_SE,period:row.PRD_DE,valueRaw:rawValue,numericValue:numeric?trimmed:null,valueKind:numeric?'numeric':trimmed?'symbol_or_text':'missing',
      providerModifiedOn:modifiedDate(row.LST_CHN_DE),provisional:null};
  });
  const notReturned=[];for(const regionCode of input.regionCodes)for(const itemId of input.itemIds)for(const period of expectedPeriods)if(!seen.has(`${regionCode}:${itemId}:${period}`))notReturned.push({regionCode,itemId,period});
  return{status:observations.length?'available':'no_data',table:kosisTable,observations,returnedCount:observations.length,query:input,coverage:{expectedCells:expectedCount,returnedCells:observations.length,notReturned},
    retrievedAt:new Date().toISOString(),timezone:'Asia/Seoul',currentPopulation:null,
    dataNote:'주민등록인구에 기반한 수록시점의 지역 지표입니다. 인구총조사·실시간 인구·개인 자격과 다릅니다. 숫자는 정밀도를 보존한 문자열이고 통계부호·공백·누락은 0으로 바꾸지 않습니다. smblChk=Y로 받은 부호의 의미와 잠정/확정 여부는 원문 주석을 확인하세요. 미반환 조합은 부재·0·폐지 지역을 확정하지 않습니다. 월/연 기준과 행정구역 개편으로 시계열 비교가 달라질 수 있습니다. 수정일·조회 시각은 기준 시점과 다릅니다. source.attribution과 통계표·단위·시점을 함께 표시하세요.',
    source:{name:'KOSIS 국가통계포털 · 행정안전부(주민과)',url:kosisTable.url,documentationUrl:sourceUrl,attribution:'출처: KOSIS 국가통계포털, 행정안전부(주민과), 고령인구비율(시도/시/군/구)'}};
}
async function readBody(response:Response){
  const reader=response.body?.getReader();if(!reader)throw invalid();const decoder=new TextDecoder('utf-8',{fatal:true});let raw='',bytes=0;
  const decode=(value?:Uint8Array,stream=false)=>{try{return decoder.decode(value,{stream});}catch{throw invalid();}};
  try{for(;;){const part=await reader.read();if(part.done)break;bytes+=part.value.byteLength;if(bytes>2_000_000)throw new ActionError('RESULT_TOO_LARGE','KOSIS 응답이 너무 큽니다. 조회 범위를 줄여 주세요.');raw+=decode(part.value,true);}return raw+decode();}
  catch(error){try{await reader.cancel();}catch{/* Preserve the original error. */}throw error;}finally{reader.releaseLock();}
}
export function kosisExecutor(fetcher:typeof fetch=fetch):Executor{
  return async(action,context)=>{
    if(action.id!==kosisAction.id)throw new ActionError('NOT_IMPLEMENTED','KOSIS 실행기에 등록되지 않은 행동입니다.');
    const input=kosisSchema.parse(context.job.input),template=kosisRequestTemplate(input);
    if(context.signal.aborted)throw new ActionError('CANCELLED','작업이 취소됐습니다.','cancelled');
    const key=context.secrets.apiKey?.trim();if(!key || key.length>4096 || /[^\x21-\x7e]/.test(key))throw new ActionError('AUTH_REQUIRED','KOSIS 공유서비스의 본인 인증키를 등록하세요. 공공데이터포털 키와 다릅니다.','awaiting_auth');
    const url=new URL(template.endpoint);for(const[name,value]of Object.entries(template.query))url.searchParams.set(name,String(value));url.searchParams.set('apiKey',key);
    const signal=AbortSignal.any([context.signal,AbortSignal.timeout(30_000)]);context.dispatch();
    try{
      const response=await fetcher(url,{method:'GET',headers:{Accept:'application/json'},redirect:'error',cache:'no-store',signal});
      if([401,403].includes(response.status))throw new ActionError('AUTH_REQUIRED','KOSIS 키·신청·접근 조건을 확인한 뒤 재개하세요.','awaiting_auth');
      if(response.status===429)throw new ActionError('PROVIDER_RATE_LIMIT','KOSIS 호출 한도를 초과했습니다. 자동 재시도하지 않습니다.');
      if(!response.ok)throw new ActionError(`PROVIDER_HTTP_${response.status}`,'KOSIS 통계 API가 정상 결과를 반환하지 않았습니다.');
      const data=normalizeKosisResponse(await readBody(response),input);
      if(context.signal.aborted)throw new ActionError('CANCELLED','작업이 취소됐습니다.','cancelled');return{data,evidence:kosisAction.resultCheck};
    }catch(error){
      if(context.signal.aborted)throw new ActionError('CANCELLED','작업이 취소됐습니다.','cancelled');if(error instanceof ActionError)throw error;
      if(signal.aborted || error instanceof Error && error.name==='TimeoutError')throw new ActionError('PROVIDER_TIMEOUT','KOSIS API 응답 시간이 초과됐습니다.');
      throw new ActionError('PROVIDER_CONNECTION_ERROR','KOSIS HTTPS API에 연결하지 못했습니다. 네트워크·서비스 상태를 확인하세요.');
    }
  };
}
