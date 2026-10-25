import { tlockerInventoryLines,tlockerInventorySizes,tlockerInventorySnapshot,tlockerInventorySourceUrl } from '../src/research/tlocker-inventory';
import { tlockerGuideUrl,tlockerAndroidUrl,tlockerIosUrl } from '../src/research/seoul-subway';
const object=(value:unknown):value is Record<string,unknown>=>!!value&&typeof value==='object'&&!Array.isArray(value);
const integer=(value:unknown,min:number,max:number):value is number=>Number.isSafeInteger(value)&&Number(value)>=min&&Number(value)<=max;
export function tlockerInventoryInputState(input:string):{value:Record<string,unknown>|null;error:string|null}{
  let value:unknown;try{value=JSON.parse(input);}catch{return{value:null,error:'조건 JSON을 올바르게 수정하세요.'};}if(!object(value))return{value:null,error:'검색 조건 객체를 입력하세요.'};
  const fail=(error:string)=>({value:value as Record<string,unknown>,error});
  if(Object.keys(value).some(key=>!['query','line','size','page','limit'].includes(key)))return fail('지원하지 않는 조건을 삭제하세요.');
  if(typeof value.query!=='string'||!value.query.trim()||value.query.length>80||/\p{C}/u.test(value.query))return fail('역·보관함 이름은 제어문자 없이 1~80자로 입력하세요.');
  if(value.line!==undefined&&!tlockerInventoryLines.some(line=>line===value.line))return fail('공식 자료의 호선을 선택하세요.');
  if(value.size!==undefined&&!tlockerInventorySizes.some(size=>size.value===value.size))return fail('설치 크기 조건을 선택하세요.');
  if(!integer(value.page===undefined?1:value.page,1,1000)||!integer(value.limit===undefined?10:value.limit,1,50))return fail('페이지는 1~1,000, 건수는 1~50입니다.');
  return{value,error:null};
}
export function TlockerInventoryForm({input,changeInput,busy,submit}:{input:string;changeInput:(value:string)=>void;busy:boolean;submit:()=>void}){
  const {value,error}=tlockerInventoryInputState(input),text=(key:string,fallback='')=>value?.[key]===undefined?fallback:String(value[key]);
  const change=(key:string,next:unknown)=>{if(!value)return;const updated={...value,[key]:next};if(key==='line'&&next==='')delete updated.line;if(key!=='page'&&key!=='limit')updated.page=1;changeInput(JSON.stringify(updated,null,2));};
  return <form id="tlocker-inventory-search" className="work24-form" onSubmit={event=>{event.preventDefault();if(!busy&&!error)submit();}} aria-label="사물함 설치 목록 조건">
    <p className="work24-notice">키 없이 설치 목록을 조회합니다. 출처 고지 기준일은 {tlockerInventorySnapshot.asOf}이며 다운로드한 파일의 지문을 결과에서 확인합니다. 현재 빈칸·고장/사용중 상태·예약 가능은 미확인입니다.</p>
    <fieldset disabled={busy||!value}><legend>설치 목록 검색</legend><label htmlFor="locker-query">역·보관함 이름</label><input id="locker-query" required maxLength={80} value={text('query')} onChange={event=>change('query',event.target.value)} placeholder="예: 서울, 시청"/>
      <label htmlFor="locker-line">호선·시설 분류</label><select id="locker-line" value={text('line')} onChange={event=>change('line',event.target.value)}><option value="">전체</option>{tlockerInventoryLines.map(line=><option key={line} value={line}>{line==='식물원'?'식물원 (시설)':line+'호선'}</option>)}</select>
      <label htmlFor="locker-size">설치 크기 조건</label><select id="locker-size" value={text('size','any')} onChange={event=>change('size',event.target.value)}>{tlockerInventorySizes.map(size=><option key={size.value} value={size.value}>{size.label}</option>)}</select>
      <p className="small">보관함 이름에 포함된 문자열로 찾습니다. ‘역’·별칭을 자동 변환하지 않으며 선택 크기의 설치 수량이 있는 묶음만 찾습니다. 검색 조건은 공급자에게 보내지 않습니다.</p>
      <details><summary>페이지 설정</summary><label>페이지<input type="number" min={1} max={1000} value={text('page','1')} onChange={event=>change('page',event.target.value===''?'':Number(event.target.value))}/></label><label>한 번에 볼 건수<input type="number" min={1} max={50} value={text('limit','10')} onChange={event=>change('limit',event.target.value===''?'':Number(event.target.value))}/></label></details>
    </fieldset>{error&&<p className="warning" role="status">{error}</p>}<a href={tlockerInventorySourceUrl} target="_blank" rel="noreferrer">공식 설치수량 자료 ↗</a>
  </form>;
}
interface LockerRow{id:string;sourceSerial:string;lineRaw:string;lockerNameRaw:string;installed:{small:number;medium:number;large:number};installedTotal:number;columnCount:number;availableCount:null;providerObservedAt:null;locationDetail:null;operatorLockerId:null}
interface LockerData{status:'available'|'no_data'|'empty_page';rows:LockerRow[];pagination:{page:number;limit:number;total:number;returnedCount:number;nextPage:number|null};snapshot:{declaredAsOf:string;asOf:string|null;matchesReviewedFile:boolean};file:{sourceRows:number;sha256:string};retrievedAt?:string;queriedAt?:string;cache:{status:string}|null}
function dataFrom(result:unknown):LockerData|null{
  if(!object(result)||result.contentTrust!=='external_data'||!object(result.data))return null;const data=result.data,p=data.pagination,s=data.snapshot,f=data.file;
  if(!['available','no_data','empty_page'].some(v=>v===data.status)||!Array.isArray(data.rows)||data.rows.length>50||!object(p)||!integer(p.page,1,1000)||!integer(p.limit,1,50)||!integer(p.total,0,10000)||p.returnedCount!==data.rows.length||p.nextPage!==null&&p.nextPage!==p.page+1)return null;
  if(!object(s)||s.declaredAsOf!==tlockerInventorySnapshot.asOf||typeof s.matchesReviewedFile!=='boolean'||(s.matchesReviewedFile?s.asOf!==s.declaredAsOf:s.asOf!==null)||!object(f)||!integer(f.sourceRows,1,10000)||typeof f.sha256!=='string'||!/^[a-f0-9]{64}$/.test(f.sha256))return null;
  const seen=new Set<string>();for(const row of data.rows){if(!object(row)||typeof row.id!=='string'||seen.has(row.id)||typeof row.sourceSerial!=='string'||!/^\d+$/.test(row.sourceSerial)||!tlockerInventoryLines.some(v=>v===row.lineRaw)||typeof row.lockerNameRaw!=='string'||!object(row.installed)||!['small','medium','large'].every(key=>integer((row.installed as Record<string,unknown>)[key],0,999999))||!integer(row.columnCount,0,999999)||row.installedTotal!==Number(row.installed.small)+Number(row.installed.medium)+Number(row.installed.large)||row.availableCount!==null||row.providerObservedAt!==null||row.locationDetail!==null||row.operatorLockerId!==null)return null;seen.add(row.id);}
  return data as unknown as LockerData;
}
const time=(value?:string)=>value&&Number.isFinite(Date.parse(value))?new Intl.DateTimeFormat('ko-KR',{timeZone:'Asia/Seoul',dateStyle:'short',timeStyle:'medium'}).format(new Date(value))+' (한국 시간)':'기록 없음';
export function TlockerInventoryResult({result,busy,onPage}:{result:unknown;busy:boolean;onPage:(page:number)=>void}){
  const data=dataFrom(result);if(!data)return <><p className="warning">카드로 표시할 수 없는 결과입니다. JSON 상세를 확인하세요.</p><details><summary>JSON 상세</summary><pre>{JSON.stringify(result,null,2)}</pre></details></>;
  const {pagination:p}=data;
  return <section className="work24-result" aria-label="사물함 설치 조회 결과"><h4>사물함 설치 목록</h4><p className="work24-notice">설치 수량입니다. 실시간 빈칸·현재 가용 상태는 미확인입니다. 층·출구는 자료에 없습니다. 이름의 번호 구간을 수량으로 환산하지 않습니다.</p>
    {data.snapshot.matchesReviewedFile?<p>자료 기준일: {data.snapshot.asOf} · 검토한 원본과 파일 지문 일치</p>:<p className="warning" role="status">검토한 원본과 파일 지문이 다릅니다. 기준일을 확인할 수 없습니다. 출처가 고지한 기준일은 {data.snapshot.declaredAsOf}이며 최신성 확인이 필요합니다.</p>}
    <p>전체 자료 {data.file.sourceRows}묶음 · 검색 일치 {p.total}묶음 · {p.page}페이지</p>
    {data.status==='no_data'&&<p role="status">검색 조건에 맞는 설치 기록이 없습니다. 현재 빈칸이나 시설 부재를 뜻하지 않습니다.</p>}{data.status==='empty_page'&&<p role="status">검색 결과는 있지만 이 페이지에는 없습니다. 첫 페이지를 확인하세요.</p>}
    <ul className="work24-list">{data.rows.map(row=><li key={row.id}><article className="work24-card" aria-label={row.lockerNameRaw}><h4>{row.lockerNameRaw}</h4><dl><dt>호선·시설</dt><dd>{row.lineRaw==='식물원'?'식물원':row.lineRaw+'호선'}</dd><dt>소형 설치</dt><dd>{row.installed.small}칸</dd><dt>중형 설치</dt><dd>{row.installed.medium}칸</dd><dt>대형 설치</dt><dd>{row.installed.large}칸</dd><dt>설치 합계</dt><dd>{row.installedTotal}칸</dd><dt>설치 열</dt><dd>{row.columnCount}열</dd><dt>현재 빈칸</dt><dd>미확인</dd><dt>층·출구</dt><dd>자료 미제공</dd></dl><small>자료 연번 {row.sourceSerial} · 실시간 보관함 ID 아님</small></article></li>)}</ul>
    <nav className="work24-pages" aria-label="사물함 결과 페이지">{p.page>1&&<><button disabled={busy} onClick={()=>onPage(1)}>첫 페이지</button><button disabled={busy} onClick={()=>onPage(p.page-1)}>이전 페이지</button></>}{p.nextPage!==null&&<button disabled={busy} onClick={()=>onPage(p.nextPage!)}>다음 페이지</button>}</nav>
    <div className="work24-source"><p>출처: 서울교통공사 · 공공데이터포털</p><dl><dt>파일 다운로드</dt><dd>{time(data.retrievedAt)}</dd><dt>이번 검색</dt><dd>{time(data.queriedAt)}</dd></dl><p className="small">{data.cache?.status==='hit'?'검증된 로컬 파일을 재사용했습니다.':'공식 고정 파일을 검증해 사용합니다.'}</p><a href={tlockerInventorySourceUrl} target="_blank" rel="noreferrer">공식 설치수량 자료 ↗</a> · <a href={tlockerGuideUrl} target="_blank" rel="noreferrer">또타라커 이용 안내 ↗</a><p><a className="work24-job-link" href={tlockerAndroidUrl} target="_blank" rel="noreferrer">Android 앱에서 빈칸 직접 확인 ↗</a><a className="work24-job-link" href={tlockerIosUrl} target="_blank" rel="noreferrer">iPhone 앱에서 빈칸 직접 확인 ↗</a></p></div>
    <details><summary>JSON 상세</summary><pre>{JSON.stringify(result,null,2)}</pre></details>
  </section>;
}
