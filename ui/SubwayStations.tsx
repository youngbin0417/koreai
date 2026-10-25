import { useId, useState } from 'react';
import { findSubwayStation, subwayArrivalQueryName, subwayStationLines, subwayStationReference as source } from '../src/research/subway-stations';
import { searchSubwayStations, stationDraftMatches, stationTargetAvailable, type StationTarget } from './subway-stations-model';

export interface SubwayStationsProps { busy?: boolean; onApplyStation?: (target: StationTarget, stationId: string, endpoint?: 'origin' | 'destination') => void }
export function SubwayStations({ busy = false, onApplyStation }: SubwayStationsProps) {
  const [query, setQuery] = useState(''), [line, setLine] = useState(''), [page, setPage] = useState(1), [selectedId, setSelectedId] = useState('');
  const id = useId(), result = searchSubwayStations(query, line, page), selected = findSubwayStation(selectedId);
  const buttons: [StationTarget, string][] = [['seoul-subway.arrivals', '도착 조회 조건 채우기'], ['seoul-subway.timetable', '시간표 조건 채우기'], ['tlocker.inventory.search', '사물함 설치 조건 채우기']];
  return <section className="panel subway-stations" aria-label="역 찾기와 조회 조건 연결"><h2>역 찾기 · 조회 조건 연결</h2>
    <p className="small">도착정보용 공식 역명 {source.rows}개 항목 · {source.asOf} 기준 보관 목록입니다. 현재 운행·개통·환승 가능을 보증하지 않습니다.</p>
    <label htmlFor={id + '-query'}>역 이름·도착정보 역 ID 검색</label><input id={id + '-query'} type="search" maxLength={80} value={query} onChange={event => { setQuery(event.target.value); setPage(1); }} placeholder="예: 서울, 신촌, 1001000133"/>
    <label htmlFor={id + '-line'}>역 목록 호선</label><select id={id + '-line'} value={line} onChange={event => { setLine(event.target.value); setPage(1); }}><option value="">전체 호선</option>{subwayStationLines.map(value => <option key={value}>{value}</option>)}</select>
    {!query.trim() ? <p className="small">검색어를 입력하면 이름·호선·역 ID가 다른 항목을 각각 표시합니다.</p> : <>
      <p role="status">검색 일치 {result.total}개 · {result.page}/{result.pages}페이지</p>
      <ul className="subway-station-list">{result.rows.map(station => <li key={station.stationId}><button aria-pressed={selectedId === station.stationId} onClick={() => setSelectedId(station.stationId)}>{station.name} · {station.line} 선택</button><small>도착정보 역 ID {station.stationId}</small></li>)}</ul>
      <nav className="subway-station-pages" aria-label="역 검색 결과 페이지"><button disabled={result.page <= 1} onClick={() => setPage(result.page - 1)}>이전 역 목록</button><button disabled={result.page >= result.pages} onClick={() => setPage(result.page + 1)}>다음 역 목록</button></nav>
    </>}
    {selected && <section className="subway-station-selection" aria-label="선택한 역의 조회 연결"><h3>{selected.name} · {selected.line}</h3><p>선택한 역의 검색 조건만 채웁니다. 외부 조회는 실행 요청을 눌렀을 때 수행합니다.</p>
      {subwayArrivalQueryName(selected) !== selected.name && <p className="small">공식 API 안내의 도착 검색 역명: {subwayArrivalQueryName(selected)} (파일 원명: {selected.name})</p>}
      <div className="button-row">{buttons.map(([target, title]) => <button key={target} disabled={busy || !onApplyStation || !stationTargetAvailable(target, selected)} onClick={() => onApplyStation?.(target, selected.stationId)}>{title}</button>)}</div>
      <div className="button-row">{(['origin', 'destination'] as const).map(endpoint => <button key={endpoint} disabled={busy || !onApplyStation || !stationTargetAvailable('seoul-subway.route', selected)} onClick={() => onApplyStation?.('seoul-subway.route', selected.stationId, endpoint)}>{endpoint === 'origin' ? '경로 출발역 조건 채우기' : '경로 도착역 조건 채우기'}</button>)}</div>
      <p className="small">경로 바로가기는 1~8호선의 역 이름 초안만 채웁니다. 호선은 경로 API로 전달하지 않으며 코드 대응·제공 구간은 미검증입니다. 서울 → 서울역 등 공급자별 표기는 경로 화면에서 직접 확인·수정하세요.</p>
      <p className="small">시간표 바로가기는 1~8호선, 사물함 설치 바로가기는 1~9호선만 제공합니다. 시간표·사물함은 문자열 검색 초안이며 실제 공급자 역 코드의 대응을 확인한 것은 아닙니다. 부역명·이름 차이로 결과가 없으면 조건을 수정하세요.</p>
      <details><summary>역 식별자·출처 확인</summary><p className="small">도착 호선 ID {selected.subwayId} · 도착 역 ID {selected.stationId}. 역사 마스터 ID·시간표 역 코드·보관함 ID와 서로 다른 체계이며 조회 입력에는 전달하지 않습니다. 목록 순서는 인접역 순서가 아닙니다.</p></details>
    </section>}
    <p className="small">{source.attribution}<br/><a href={source.sourceUrl} target="_blank" rel="noreferrer">{source.fileName} · {source.license} ↗</a> · 확인일 {source.checkedAt}</p>
  </section>;
}
export function SubwayStationNotice({ target, input, stationId }: { target: StationTarget; input: string; stationId?: string }) {
  const selected = stationId ? findSubwayStation(stationId) : undefined;
  if (!selected || !stationDraftMatches(target, input, stationId)) return null;
  return <p className="info-strip">역 목록에서 적용: {selected.name} · {selected.line} (참조일 {source.asOf}). 검색 조건을 확인하세요. 역 선택은 외부 조회·계정 권한을 자동 승인하지 않습니다.</p>;
}
