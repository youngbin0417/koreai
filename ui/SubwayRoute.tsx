import { useState } from 'react';
import { subwayRouteDocs } from '../src/research/seoul-subway';
import { routeStationSelection, type RouteFollowupTarget, type RouteStationSide } from './subway-route-connections-model';
import { stationTargetAvailable } from './subway-stations-model';

export function subwayRouteInputState(input: string) {
  let value: Record<string, unknown> | null = null;
  try { const parsed = JSON.parse(input); if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) value = parsed; } catch {}
  if (!value) return { value, error: '조건 JSON을 올바르게 수정하세요.' };
  if (Object.keys(value).some(key => !['origin', 'destination', 'preference', 'at', 'includeTimetable'].includes(key))) return { value, error: '지원하지 않는 조회 조건을 삭제하세요.' };
  for (const field of ['origin', 'destination']) if (typeof value[field] !== 'string' || !String(value[field]).trim() || String(value[field]).trim().length > 50 || /[\p{C},/\\?#%]/u.test(String(value[field]))) return { value, error: '출발·도착역 이름 한 개씩을 1~50자로 입력하세요.' };
  if (String(value.origin).trim() === String(value.destination).trim()) return { value, error: '출발역과 도착역을 다르게 입력하세요.' };
  if (value.preference !== undefined && !['duration', 'distance', 'transfer'].includes(String(value.preference))) return { value, error: '경로 기준을 확인하세요.' };
  if (value.includeTimetable !== undefined && typeof value.includeTimetable !== 'boolean') return { value, error: '시간표 포함 조건을 확인하세요.' };
  if (value.at !== undefined && (typeof value.at !== 'string' || !/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d+)?(?:Z|[+-]\d\d:\d\d)$/.test(value.at) || !Number.isFinite(Date.parse(value.at)))) return { value, error: '기준 시각은 시간대가 있는 ISO 날짜/시각으로 입력하세요.' };
  return { value, error: null };
}
export function SubwayRouteForm({ input, changeInput, busy, submit }: { input: string; changeInput: (value: string) => void; busy: boolean; submit: () => void }) {
  const { value, error } = subwayRouteInputState(input);
  const change = (key: string, next: string | boolean) => { if (value) { const updated = { ...value, [key]: next }; if (key === 'at' && next === '') delete updated.at; changeInput(JSON.stringify(updated, null, 2)); } };
  return <form id="subway-route" className="work24-form" onSubmit={event => { event.preventDefault(); if (!busy && !error) submit(); }}>
    <p className="work24-notice">서울교통공사 공식 경로를 HTTPS로 조회합니다. 도착·시간표용 서울시 키와 별도로 공공데이터포털 경로 API 키를 등록하세요.</p>
    <p className="small">역 이름으로 검색합니다. 호선·도착정보 역 ID는 전달하지 않습니다. 동명역·제공 구간·다른 역명 표기는 공급자 결과로 확인하세요. 예: 도착정보의 서울과 경로 명세 예시의 서울역은 다릅니다.</p>
    <fieldset disabled={busy || !value}><legend>경로 조회 조건</legend>
      <label htmlFor="route-origin">출발역 이름</label><input id="route-origin" required maxLength={50} value={String(value?.origin ?? '')} onChange={event => change('origin', event.target.value)} placeholder="예: 신도림"/>
      <label htmlFor="route-destination">도착역 이름</label><input id="route-destination" required maxLength={50} value={String(value?.destination ?? '')} onChange={event => change('destination', event.target.value)} placeholder="예: 서울역"/>
      <label htmlFor="route-preference">경로 기준</label><select id="route-preference" value={String(value?.preference ?? 'duration')} onChange={event => change('preference', event.target.value)}><option value="duration">최소 시간</option><option value="distance">최단 거리</option><option value="transfer">최소 환승</option></select>
      <label htmlFor="route-at">경로 기준 시각 · 시간대 포함, 생략하면 실행 시각</label><input id="route-at" value={String(value?.at ?? '')} onChange={event => change('at', event.target.value)} placeholder="2026-10-25T09:00:00+09:00"/>
      <label><input type="checkbox" checked={value?.includeTimetable === true} onChange={event => change('includeTimetable', event.target.checked)}/> 공급자 열차 시간표 포함</label>
    </fieldset>{error && <p role="alert" className="warning">{error}</p>}
    <p><a href="/#subway-map" target="_blank" rel="noreferrer">노선도·역 찾기 열기 ↗</a> · <a href={subwayRouteDocs} target="_blank" rel="noreferrer">공식 경로 API·활용신청 ↗</a></p>
  </form>;
}
const display = (value: unknown) => value === null || value === undefined || value === '' ? '미제공' : String(value);
export function SubwayRouteResult({ result, busy = false, onUseStation }: { result: unknown; busy?: boolean; onPage?: (page: number) => void; onUseStation?: (target: RouteFollowupTarget, index: number, side: RouteStationSide) => void }) {
  const [page, setPage] = useState(1), data = (result as any)?.data;
  if (data?.kind !== 'seoul-subway.route' || !Array.isArray(data.segments) || !Array.isArray(data.transfers)) return <p>카드로 표시할 수 없는 경로 결과입니다.</p>;
  const pages = Math.max(1, Math.ceil(data.segments.length / 10)), current = Math.min(page, pages), summary = data.summary;
  return <section className="work24-results" aria-label="지하철 경로 결과"><h3>공급자 경로·환승 결과</h3>
    <p>{display(data.query?.origin)} → {display(data.query?.destination)} · {display(data.query?.preference)}</p>
    {summary ? <dl><dt>총 거리</dt><dd>{display(summary.distanceMeters)} m</dd><dt>총 소요</dt><dd>{display(summary.durationSeconds)}초</dd><dt>환승 횟수</dt><dd>{display(summary.transferCount)}회</dd><dt>공급자 카드 요금</dt><dd>{display(summary.cardFareWon)}원 · 실제 결제액 미확인</dd></dl> : <p>공급자가 빈 경로를 반환했습니다. 운행 종료·역 미존재를 뜻하지 않습니다.</p>}
    <p>경로 기준 시각: {display(data.searchAt)}<br/>응답 조회 시각: {display(data.retrievedAt)}<br/>공급자 관측 시각: 미제공</p>
    <p className="warning">{display(data.dataNote)}</p>
    {!!data.transfers.length && <section aria-label="공급자 환승 목록"><h4>공급자 환승 목록</h4><ul>{data.transfers.map((row: any, index: number) => <li key={index}>{display(row.stationName)} · {display(row.fromLine)} → {display(row.toLine)}</li>)}</ul></section>}
    <ol className="work24-job-list" start={(current - 1) * 10 + 1}>{data.segments.slice((current - 1) * 10, current * 10).map((row: any, offset: number) => <li key={row.index}><article className="work24-job"><h4>{display(row.from?.name)} → {display(row.to?.name)}</h4><p>{display(row.from?.line)} · 지선 {display(row.from?.branch)} → {display(row.to?.line)} · 지선 {display(row.to?.branch)}</p>
      <dl><dt>구간 거리·시간</dt><dd>{display(row.distanceMeters)} m · {display(row.durationSeconds)}초</dd><dt>환승 표시 원문</dt><dd>{display(row.transferRaw)}</dd><dt>방향·종착역</dt><dd>{display(row.directionRaw)} · {display(row.terminalName)}</dd></dl>
      {data.query?.includeTimetable && <dl><dt>예정 출발·도착 원문</dt><dd>{display(row.departureRaw)} · {display(row.arrivalRaw)}</dd><dt>대기시간</dt><dd>{display(row.waitingSeconds)}초</dd><dt>열차·급행·무정차 원문</dt><dd>{display(row.trainNumber)} · {display(row.expressRaw)} · {display(row.nonstopRaw)}</dd></dl>}
      <details><summary>공급자 역 식별자</summary><p>{display(row.from?.code)} ({display(row.from?.number)}) → {display(row.to?.code)} ({display(row.to?.number)}). 도착·시간표·보관함 코드와 자동 연결하지 않습니다.</p></details>
      {(['from', 'to'] as const).map(side => {
        const index = (current - 1) * 10 + offset, selection = routeStationSelection(data, index, side);
        const targets: [RouteFollowupTarget, string][] = [['seoul-subway.arrivals', '도착 조회 조건 채우기'], ['seoul-subway.timetable', '시간표 조건 채우기'], ['tlocker.inventory.search', '사물함 설치 조건 채우기']];
        return <section key={side} aria-label={`${row.index}구간 ${side === 'from' ? '출발역' : '도착역'} 조회 연결`}><h5>{side === 'from' ? '출발역' : '도착역'} 다음 조회 · {display(row[side]?.name)}</h5>
          {selection ? <><p className="small">역명·호선이 참조 목록과 일치합니다. 코드 대응은 미검증입니다. 조건만 채우며 외부 조회는 실행 요청 후 수행합니다.</p><div className="button-row">{targets.map(([target, label]) => <button key={target} disabled={busy || !onUseStation || !stationTargetAvailable(target, selection.station)} onClick={() => onUseStation?.(target, index, side)}>{label}</button>)}</div></> : <p className="small">역명·호선의 정확한 대응을 확인할 수 없습니다. 별칭이나 코드를 자동 변환하지 않습니다. <a href="/#subway-map" target="_blank" rel="noreferrer">역 찾기에서 직접 확인 ↗</a></p>}
        </section>;
      })}
    </article></li>)}</ol>
    {pages > 1 && <nav aria-label="경로 구간 페이지"><p>{current}/{pages}페이지 · 총 {data.segments.length}개 공급자 구간</p><button disabled={current <= 1} onClick={() => setPage(current - 1)}>이전 구간</button><button disabled={current >= pages} onClick={() => setPage(current + 1)}>다음 구간</button></nav>}
    <p className="work24-source">출처: 서울교통공사 · 최단경로이동정보 · 이용허락범위 제한 없음<br/><a href={subwayRouteDocs} target="_blank" rel="noreferrer">공식 명세 ↗</a> · 결과는 60초 뒤 만료되며 자동 갱신하지 않습니다.</p>
    <details><summary>JSON 상세</summary><pre>{JSON.stringify(result, null, 2)}</pre></details>
  </section>;
}
