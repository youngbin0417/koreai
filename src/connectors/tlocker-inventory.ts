import { createHash } from 'node:crypto';
import iconv from 'iconv-lite';
import { z } from 'zod';
import { zodToJsonSchema } from 'zod-to-json-schema';
import { ActionError, type Action, type Executor } from '../types.js';
import { VerifiedFileCache } from '../core/file-cache.js';
import { tlockerInventorySnapshot as snapshot,tlockerInventorySourceUrl,tlockerInventoryLines } from '../research/tlocker-inventory.js';
import { tlockerGuideUrl,tlockerAndroidUrl,tlockerIosUrl } from '../research/seoul-subway.js';

export const tlockerInventoryMaxBytes = 1_000_000;
const search = z.string().max(80).refine(value=>!/[\p{C}]/u.test(value),'제어문자 없이 검색하세요.').transform(value=>value.trim()).pipe(z.string().min(1));
export const tlockerInventorySchema = z.object({query:search,line:z.enum(tlockerInventoryLines).optional(),size:z.enum(['any','small','medium','large']).default('any'),page:z.number().int().min(1).max(1000).default(1),limit:z.number().int().min(1).max(50).default(10)}).strict();
export const tlockerInventoryAction:Action = {
  id:'tlocker.inventory.search',serviceId:'tlocker',connectorId:'seoul-metro-locker-file',title:'지하철 사물함 설치 목록 조회',
  description:'키 없이 서울교통공사의 2026년 9월 30일 설치수량 CSV에서 보관함 이름·호선·설치 크기로 검색합니다. 설치 수량이며 실시간 빈칸·층/출구·현재 이용 가능은 확인하지 않습니다.',
  category:'지도·교통',effect:'read',method:'public-data',schema:tlockerInventorySchema,inputSchema:zodToJsonSchema(tlockerInventorySchema,{$refStrategy:'none'}) as Record<string,unknown>,requiredSecrets:[],scopes:[],
  sourceUrl:tlockerInventorySourceUrl,checkedAt:snapshot.checkedAt,verification:'documented',resultCheck:'고정 HTTPS 파일의 크기·인코딩·CSV 헤더·고유 연번/호선/보관함 이름·정수 설치 수량을 검증하고 자료 기준일·파일 지문·다운로드/검색 시각을 구분합니다. 빈칸 수와 상세 위치는 null로 유지합니다.',domains:['www.data.go.kr'],version:'0.1.0',maintainer:'KoreAI',origin:'bundled',implemented:true,
};
export const tlockerInventoryExample=()=>({query:'서울',size:'any',page:1,limit:10});
export const tlockerInventoryCacheKey=createHash('sha256').update('tlocker-inventory-v1:'+JSON.stringify(snapshot)).digest('hex');
export function tlockerInventoryRequestTemplate(raw:unknown){const input=tlockerInventorySchema.parse(raw);return{method:'GET' as const,endpoint:snapshot.endpoint,query:snapshot.query,authentication:{type:'none' as const},responseFormat:'csv' as const,snapshot:{asOf:snapshot.asOf,publishedOn:snapshot.publishedOn,checkedAt:snapshot.checkedAt},localFilter:input,maxBytes:tlockerInventoryMaxBytes};}
const invalid=()=>new ActionError('INVALID_RESPONSE','사물함 파일의 CSV·호선·연번·이름·설치 수량이 유효하지 않습니다.');
const tooLarge=()=>new ActionError('RESULT_TOO_LARGE','사물함 파일의 크기·행·필드 상한을 초과했습니다.');
const sha=(bytes:Uint8Array)=>createHash('sha256').update(bytes).digest('hex');
function* csvRows(text:string):Generator<string[]>{
  let row:string[]=[],field='',quoted=false,closed=false,count=0;
  const finishField=()=>{row.push(field.trim());field='';closed=false;if(row.length>7)throw invalid();};
  const finishRow=()=>{finishField();const value=row;row=[];if(++count>10001)throw tooLarge();return value;};
  for(let i=0;i<text.length;i++){const c=text[i]!;
    if(quoted){if(c==='"'){if(text[i+1]==='"'){field+='"';i++;}else{quoted=false;closed=true;}}else field+=c;}
    else if(c===',')finishField();else if(c==='\n'||c==='\r'){const value=finishRow();if(c==='\r'&&text[i+1]==='\n')i++;if(value.some(v=>v!==''))yield value;}
    else if(closed){if(c!==' '&&c!=='\t')throw invalid();}else if(c==='"'){if(field)throw invalid();quoted=true;}else field+=c;
    if(field.length>300)throw tooLarge();
  }
  if(quoted)throw invalid();if(field||row.length||closed){const value=finishRow();if(value.some(v=>v!==''))yield value;}
}
export function normalizeTlockerInventory(bytes:Uint8Array,raw:unknown){
  const input=tlockerInventorySchema.parse(raw);if(bytes.length>tlockerInventoryMaxBytes)throw tooLarge();let text:string,encoding:string;
  try{text=new TextDecoder('utf-8',{fatal:true}).decode(bytes);encoding='utf-8';}catch{text=iconv.decode(Buffer.from(bytes),'cp949');encoding='cp949';if(text.includes('\uFFFD')||!iconv.encode(text,'cp949').equals(Buffer.from(bytes)))throw invalid();}
  const iterator=csvRows(text.replace(/^\uFEFF/,'')),headers=iterator.next().value as string[]|undefined,expected=['연번','호선','보관함명','소형','중형','대형','열'];
  if(!headers||headers.length!==7||new Set(headers).size!==7||expected.some(name=>!headers.includes(name)))throw invalid();const columns=new Map(headers.map((name,index)=>[name,index]));
  const seen=new Set<string>(),names=new Set<string>(),rows:Record<string,unknown>[]=[],offset=(input.page-1)*input.limit,fold=(value:string)=>value.normalize('NFC').toLocaleLowerCase('ko-KR'),query=fold(input.query);
  let sourceRows=0,total=0;
  for(const values of iterator){if(values.length!==7)throw invalid();const get=(key:string)=>values[columns.get(key)!]!,serial=get('연번'),line=get('호선'),lockerName=get('보관함명');
    if(!/^\d{1,9}$/.test(serial)||Number(serial)===0||seen.has(String(Number(serial)))||!tlockerInventoryLines.some(v=>v===line)||!lockerName||/[\p{C}]/u.test(lockerName)||names.has(line+'\0'+lockerName))throw invalid();seen.add(String(Number(serial)));names.add(line+'\0'+lockerName);sourceRows++;
    const number=(key:string)=>{const value=get(key);if(!/^\d{1,6}$/.test(value))throw invalid();return Number(value);};
    const counts={small:number('소형'),medium:number('중형'),large:number('대형')},columnCount=number('열');
    if(input.line&&line!==input.line||!fold(lockerName).includes(query)||input.size!=='any'&&counts[input.size]===0)continue;
    if(total>=offset&&rows.length<input.limit)rows.push({id:snapshot.asOf+':'+serial,sourceSerial:serial,lineRaw:line,lockerNameRaw:lockerName,installed:counts,installedTotal:counts.small+counts.medium+counts.large,columnCount,availableCount:null,providerObservedAt:null,locationDetail:null,operatorLockerId:null});total++;
  }
  if(sourceRows===0)throw invalid();const fingerprint=sha(bytes),matchesReviewedFile=fingerprint===snapshot.reviewedSha256;
  return{status:rows.length?'available':total?'empty_page':'no_data',query:input,rows,pagination:{page:input.page,limit:input.limit,total,returnedCount:rows.length,nextPage:offset+rows.length<total&&input.page<1000?input.page+1:null},
    snapshot:{declaredAsOf:snapshot.asOf,asOf:matchesReviewedFile?snapshot.asOf:null,publishedOn:snapshot.publishedOn,checkedAt:snapshot.checkedAt,matchesReviewedFile},file:{encoding,byteLength:bytes.byteLength,sha256:fingerprint,sourceRows},
    dataNote:'설치 수량 공공파일이며 현재 빈칸·가용 상태·층/출구·예약 가능은 미확인입니다. 보관함 이름의 번호 구간을 설치 수량으로 환산하지 않습니다. 연번은 이 파일의 행 식별자이며 실시간 보관함 ID가 아닙니다. 검색/호선/크기 조건은 전체 파일을 받은 뒤 로컬에서 적용합니다.',
    source:{name:'서울교통공사 · 공공데이터포털',url:tlockerInventorySourceUrl,attribution:'출처: 서울교통공사 물품보관함 설치수량',guideUrl:tlockerGuideUrl,androidUrl:tlockerAndroidUrl,iosUrl:tlockerIosUrl}};
}
async function readBytes(response:Response){const declared=response.headers.get('content-length');if(declared&&/^\d+$/.test(declared)&&Number(declared)>tlockerInventoryMaxBytes){await response.body?.cancel();throw tooLarge();}const reader=response.body?.getReader();if(!reader)throw invalid();const parts:Uint8Array[]=[];let size=0;
  try{for(;;){const part=await reader.read();if(part.done)break;size+=part.value.byteLength;if(size>tlockerInventoryMaxBytes)throw tooLarge();parts.push(part.value);}if(!response.headers.has('content-encoding')&&declared&&/^\d+$/.test(declared)&&Number(declared)!==size)throw invalid();}catch(e){try{await reader.cancel();}catch{}throw e;}finally{reader.releaseLock();}
  const bytes=new Uint8Array(size);let offset=0;for(const part of parts){bytes.set(part,offset);offset+=part.length;}return bytes;
}
export function tlockerInventoryExecutor(fetcher:typeof fetch=fetch,cache?:VerifiedFileCache):Executor{return async(action,context)=>{
  if(action.id!==tlockerInventoryAction.id)throw new ActionError('NOT_IMPLEMENTED','등록되지 않은 사물함 설치 조회입니다.');const input=tlockerInventorySchema.parse(context.job.input),url=new URL(snapshot.endpoint);for(const[key,value]of Object.entries(snapshot.query))url.searchParams.set(key,value);
  const cancelled=()=>{if(context.signal.aborted)throw new ActionError('CANCELLED','취소된 작업입니다.','cancelled');};cancelled();
  const download=async(parent:AbortSignal)=>{const signal=AbortSignal.any([parent,AbortSignal.timeout(30000)]);try{if(parent.aborted)throw new ActionError('CANCELLED','취소된 작업입니다.','cancelled');const response=await fetcher(url,{method:'GET',headers:{Accept:'text/csv, application/octet-stream'},redirect:'error',cache:'no-store',signal});try{if(response.status===429)throw new ActionError('PROVIDER_RATE_LIMIT','사물함 파일 요청 한도를 초과했습니다.');if(!response.ok)throw new ActionError('PROVIDER_HTTP_'+response.status,'공식 사물함 파일을 받지 못했습니다.');if(!/^(?:text\/csv|application\/(?:csv|octet-stream))(?:;|$)/i.test(response.headers.get('content-type')??''))throw invalid();}catch(e){await response.body?.cancel();throw e;}
    const bytes=await readBytes(response);normalizeTlockerInventory(bytes,{query:'KoreAI-file-validation',limit:1});return{bytes,providerLastModifiedRaw:response.headers.get('last-modified')};
  }catch(e){if(parent.aborted)throw new ActionError('CANCELLED','취소된 작업입니다.','cancelled');if(e instanceof ActionError)throw e;if(signal.aborted||e instanceof Error&&e.name==='TimeoutError')throw new ActionError('PROVIDER_TIMEOUT','사물함 파일 요청 시간이 초과됐습니다.');throw new ActionError('PROVIDER_UNAVAILABLE','사물함 공개 파일에 연결하지 못했습니다.');}};
  let file;if(cache)file=await cache.getOrLoad(tlockerInventoryCacheKey,context.signal,download,context.dispatch);else{context.dispatch();file={...await download(context.signal),cache:null};}cancelled();const queriedAt=new Date().toISOString(),data=normalizeTlockerInventory(file.bytes,input);
  return{data:{...data,retrievedAt:file.cache?.downloadedAt??queriedAt,queriedAt,cache:file.cache,providerLastModifiedRaw:file.providerLastModifiedRaw},evidence:action.resultCheck};
};}
