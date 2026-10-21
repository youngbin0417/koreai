import { useState } from 'react';
import { animalHospitalRegions, animalHospitalRegionSource } from '../src/research/animal-hospital-regions';
import { animalHospitalInputState, animalHospitalResultData, animalHospitalSourceUrl, animalHospitalTime } from './animal-hospitals-model';

export function AnimalHospitalsForm({ input, changeInput, busy, submit }: { input: string; changeInput: (value: string) => void; busy: boolean; submit: () => void }) {
  const { value, error } = animalHospitalInputState(input);
  const [regionQuery, setRegionQuery] = useState('');
  const selected = animalHospitalRegions.find(region => region.name === value?.region);
  const matching = animalHospitalRegions.filter(region => region.name.includes(regionQuery.trim()));
  const options = selected && !matching.includes(selected) ? [selected, ...matching] : matching;
  const text = (key: string, fallback = '') => typeof value?.[key] === 'string' || typeof value?.[key] === 'number' ? String(value[key]) : fallback;
  function change(key: string, next: unknown) {
    if (!value) return;
    const updated = { ...value, [key]: next };
    if (key === 'query' && next === '') delete updated.query;
    if (key !== 'page' && key !== 'limit') updated.page = 1;
    changeInput(JSON.stringify(updated, null, 2));
  }
  return <form id="animal-hospitals-search" className="animal-hospitals-form" aria-label="동물병원 검색 조건" onSubmit={event => { event.preventDefault(); if (!busy && !error) submit(); }}>
    <p className="animal-hospitals-notice">지역별 인허가 기록을 조회합니다. 현재 진료·야간 응급·예약 가능 여부는 미확인입니다.</p>
    <fieldset disabled={busy || !value}>
      <legend>검색 조건</legend>
      <label>지역 이름 검색 <span className="muted">목록 필터</span><input value={regionQuery} maxLength={100} onChange={event => setRegionQuery(event.target.value)} placeholder="예: 강남, 제주" aria-describedby="animal-region-help" /></label>
      <label htmlFor="animal-region">공식 지역 <span className="muted">필수</span></label>
      <select id="animal-region" value={selected?.name ?? ''} onChange={event => change('region', event.target.value)} required aria-describedby="animal-region-help animal-region-scope">
        <option value="">조회할 지역을 선택하세요</option>{options.map(region => <option key={region.code} value={region.name}>{region.name}</option>)}
      </select>
      <p id="animal-region-help" className="small">공식 목록 {animalHospitalRegions.length}개 중 검색 {matching.length}개. 지역 이름 검색은 목록만 좁히며 선택한 지역은 유지합니다.</p>
      {matching.length === 0 && <p role="status">검색된 지역이 없습니다. 목록 검색어를 바꿔 보세요.</p>}
      <p id="animal-region-scope" className="small">실제 파일 확인 범위: 서울강남구. 다른 지역은 개별 확인이 필요합니다.</p>
      <label>병원명 <span className="muted">선택 · 검색어 포함</span><input value={text('query')} maxLength={100} onChange={event => change('query', event.target.value)} placeholder="비우면 선택한 지역의 전체 병원명" /></label>
      <label htmlFor="animal-status">인허가 상태</label>
      <select id="animal-status" value={text('status', 'normal')} onChange={event => change('status', event.target.value)}><option value="normal">영업/정상 등록만</option><option value="all">전체 인허가 상태 · 폐업/휴업 등 포함</option></select>
      <details><summary>페이지 설정</summary><div className="animal-hospitals-fields">
        <label>페이지<input type="number" inputMode="numeric" min={1} max={1000} step={1} value={text('page', '1')} onChange={event => change('page', event.target.value === '' ? '' : Number(event.target.value))} /></label>
        <label>한 번에 볼 건수<input type="number" inputMode="numeric" min={1} max={50} step={1} value={text('limit', '10')} onChange={event => change('limit', event.target.value === '' ? '' : Number(event.target.value))} /></label>
      </div></details>
    </fieldset>
    {error && <p role="status" className="warning">{error}</p>}
  </form>;
}

const count = new Intl.NumberFormat('ko-KR');
const recorded = (value: string | null) => value || '미수집';
export function AnimalHospitalsResult({ result, busy, onPage }: { result: unknown; busy: boolean; onPage: (page: number) => void }) {
  const data = animalHospitalResultData(result);
  if (!data) return <><p className="warning">이 결과는 카드로 표시할 수 없습니다. JSON 상세에서 원문을 확인하세요.</p><details><summary>JSON 상세</summary><pre>{JSON.stringify(result, null, 2)}</pre></details></>;
  const { region, pagination } = data;
  return <section className="animal-hospitals-result" aria-label="동물병원 조회 결과">
    <h4>{region.name} 인허가 기록</h4>
    <p className="animal-hospitals-notice">현재 진료·야간 응급·예약 가능 여부는 미확인입니다. 방문 전 병원에 확인하세요.</p>
    <p>지역 파일 {count.format(data.totalSourceRows)}건 중 조건 일치 <strong>{count.format(data.totalMatches)}건</strong> · {pagination.page}페이지 · 이번 결과 {data.hospitals.length}건</p>
    {data.status === 'no_data' && <p role="status">{data.reason === 'empty_page' ? '일치하는 기록은 있지만 이 페이지에는 없습니다. 첫 페이지로 돌아가 확인하세요.' : '선택한 지역·병원명·인허가 상태에 맞는 기록이 없습니다. 진료 가능한 병원이 없다는 의미는 아닙니다.'}</p>}
    <ul className="animal-hospitals-list">{data.hospitals.map(hospital => <li key={hospital.managementId}><article className="animal-hospitals-card" aria-label={hospital.name}>
      <h4>{hospital.name}</h4><p><strong>인허가 상태: {recorded(hospital.registration.name)}</strong> · 코드 {hospital.registration.code}</p>
      <dl><dt>상세 상태</dt><dd>{recorded(hospital.registration.detail)} · 코드 {recorded(hospital.registration.detailCode)}</dd>
        <dt>도로명주소</dt><dd>{recorded(hospital.roadAddress)}</dd><dt>지번주소</dt><dd>{recorded(hospital.lotAddress)}</dd><dt>전화번호</dt><dd>{recorded(hospital.phone)}</dd>
        <dt>인허가일</dt><dd>{recorded(hospital.permissionDate)}</dd>{hospital.closureDate && <><dt>폐업일</dt><dd>{hospital.closureDate}</dd></>}
        <dt>데이터 갱신</dt><dd>{recorded(hospital.dataUpdatedAtRaw)}</dd><dt>최종 수정</dt><dd>{recorded(hospital.lastModifiedAtRaw)}</dd>
      </dl><small>출처: 행정안전부 지방행정인허가 · {region.name} · 관리번호 {hospital.managementId}</small>
    </article></li>)}</ul>
    <nav className="animal-hospitals-pages" aria-label="동물병원 결과 페이지">
      {pagination.page > 1 && <button disabled={busy} onClick={() => onPage(1)}>첫 페이지</button>}
      {pagination.page > 1 && <button disabled={busy} onClick={() => onPage(pagination.page - 1)}>이전 페이지</button>}
      {pagination.hasMore && pagination.page < 1000 && <button disabled={busy} onClick={() => onPage(pagination.page + 1)}>다음 페이지</button>}
    </nav>
    {pagination.hasMore && pagination.page === 1000 && <p role="status" className="warning">조회 가능한 마지막 페이지입니다. 남은 기록은 병원명·상태 조건을 좁혀 확인하세요.</p>}
    <div className="animal-hospitals-source">
      <p><strong>출처: 행정안전부 지방행정인허가 · 공공데이터포털</strong><br /><a href={animalHospitalSourceUrl} target="_blank" rel="noreferrer">공식 자료·이용 조건 ↗</a><br /><a href={animalHospitalRegionSource} target="_blank" rel="noreferrer">공식 지역별 자료 안내 ↗</a></p>
      <dl><dt>지역</dt><dd>{region.name} · {region.code}</dd><dt>조회·검증</dt><dd>{animalHospitalTime(data.retrievedAt)}</dd><dt>파일 기준시각</dt><dd>미제공 · 행별 갱신 원문 확인</dd></dl>
      <p className="small">갱신·수정 시점은 공급자 원문입니다. 페이지를 바꾸면 지역 파일을 새로 받아 결과가 달라질 수 있습니다. EPSG:5174 원좌표는 위경도로 변환하지 않았습니다.</p>
      <p className="small">기존 실제 파일 확인 범위는 서울강남구이며 다른 지역은 별도 검증이 필요합니다.</p>
    </div>
    <details><summary>JSON 상세</summary><pre>{JSON.stringify(result, null, 2)}</pre></details>
  </section>;
}
