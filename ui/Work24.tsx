import { useState } from 'react';
import { work24Docs, work24Regions, work24RegionSource, work24RegionApiDocs, work24ReferenceCheckedAt, work24EmploymentTypes, work24SourceLink } from '../src/research/work24-reference';
import { work24InputState, work24ResultData, work24Time } from './work24-model';
import type { Work24RegionSelection } from './work24-model';

export function Work24Form({ input, changeInput, busy, submit, regionSelection }: { input: string; changeInput: (value: string) => void; busy: boolean; submit: () => void; regionSelection?: Work24RegionSelection }) {
  const { value, error } = work24InputState(input);
  const [regionQuery, setRegionQuery] = useState('');
  const selected = work24Regions.find(region => region.code === value?.regionCode);
  const matching = work24Regions.filter(region => `${region.name} ${region.code}`.includes(regionQuery.trim()));
  const options = selected && !matching.includes(selected) ? [selected, ...matching] : matching;
  const text = (key: string, fallback = '') => typeof value?.[key] === 'string' || typeof value?.[key] === 'number' ? String(value[key]) : fallback;
  const unknownCode = !selected && typeof value?.regionCode === 'string' ? value.regionCode : '';
  const apiRegion = regionSelection?.code === value?.regionCode ? regionSelection : undefined;
  function change(key: string, next: unknown) {
    if (!value) return;
    const updated = { ...value, [key]: next };
    if (next === '' && (key === 'regionCode' || key === 'employmentType')) delete updated[key];
    if (key !== 'page' && key !== 'limit') updated.page = 1;
    changeInput(JSON.stringify(updated, null, 2));
  }
  return <form id="work24-search" className="work24-form" aria-label="고용24 검색 조건" onSubmit={event => { event.preventDefault(); if (!busy && !error) submit(); }}>
    <p className="work24-notice">기업회원의 채용정보 신청·심사 후 승인 키가 필요합니다. 실행하면 검색어·지역·고용형태를 고용24에 전송합니다.</p>
    <fieldset disabled={busy || !value}>
      <legend>검색 조건</legend>
      <label htmlFor="work24-keyword">검색어 <span className="muted">필수</span></label><input id="work24-keyword" required maxLength={100} value={text('keyword')} onChange={event => change('keyword', event.target.value)} placeholder="예: 개발자" />
      <label>지역 이름·코드 검색 <span className="muted">목록 필터</span><input value={regionQuery} maxLength={100} onChange={event => setRegionQuery(event.target.value)} placeholder="예: 강남, 11680" aria-describedby="work24-region-help" /></label>
      <label htmlFor="work24-region">근무지역 <span className="muted">선택</span></label>
      <select id="work24-region" value={selected?.code ?? unknownCode} onChange={event => change('regionCode', event.target.value)} aria-describedby="work24-region-help">
        <option value="">지역 조건 없음</option>{apiRegion && <option value={apiRegion.code}>API 선택 · {apiRegion.name} · {apiRegion.code}</option>}{unknownCode && !apiRegion && <option value={unknownCode}>코드표 미확인 · {unknownCode}</option>}{options.filter(region => region.code !== apiRegion?.code).map(region => <option key={region.code} value={region.code}>{region.name} · {region.code}</option>)}
      </select>
      <p id="work24-region-help" className="small">공식 XLS {work24Regions.length}개 코드 · 확인 {work24ReferenceCheckedAt}. 목록 검색은 선택 지역을 바꾸지 않습니다. 지역 조건 없음은 필터를 보내지 않으며 ‘지역무관(00000)’은 공급자의 별도 코드입니다.</p>
      {matching.length === 0 && <p role="status">검색된 지역이 없습니다. 목록 검색어를 바꿔 보세요.</p>}
      {apiRegion && <p role="status" className="work24-notice">공통코드 API에서 선택: {apiRegion.parentName ? `${apiRegion.parentName} / ` : ''}{apiRegion.name} · {apiRegion.code}<br />API 조회 시각: {work24Time(apiRegion.retrievedAt)}<br />정적 XLS 코드표와 별도 자료입니다. 조건만 채웠으며 채용공고 조회는 실행하지 않았습니다.</p>}
      {unknownCode && !apiRegion && <p role="status">JSON에 입력한 지역 코드는 검토한 목록에 없습니다. 공식 코드표와 승인 범위를 확인하세요.</p>}
      <label htmlFor="work24-employment">고용형태 <span className="muted">선택</span></label>
      <select id="work24-employment" value={text('employmentType')} onChange={event => change('employmentType', event.target.value)}><option value="">고용형태 조건 없음</option>{work24EmploymentTypes.map(type => <option key={type.code} value={type.code}>{type.label} · {type.code}</option>)}</select>
      <p className="small">채용구분은 공급자의 기본값인 상용직 검색을 사용합니다. 조회 요약만으로 조건의 전체 일치를 확정하지 않습니다.</p>
      <details><summary>페이지 설정</summary><div className="work24-fields">
        <label>페이지<input type="number" inputMode="numeric" min={1} max={1000} step={1} value={text('page', '1')} onChange={event => change('page', event.target.value === '' ? '' : Number(event.target.value))} /></label>
        <label>한 번에 볼 건수<input type="number" inputMode="numeric" min={1} max={100} step={1} value={text('limit', '10')} onChange={event => change('limit', event.target.value === '' ? '' : Number(event.target.value))} /></label>
      </div></details>
    </fieldset>
    {error && <p role="status" className="warning">{error}</p>}
    <details><summary>공식 지역·고용형태 근거</summary><p><a href={work24Docs} target="_blank" rel="noreferrer">채용정보 명세 ↗</a><br /><a href={work24RegionSource} target="_blank" rel="noreferrer">지역 코드표 내려받기 · XLS ↗</a><br /><a href={work24RegionApiDocs} target="_blank" rel="noreferrer">인증키가 필요한 공통코드 API 안내 ↗</a></p></details>
  </form>;
}

const count = new Intl.NumberFormat('ko-KR');
const recorded = (value: string | null) => value === null || value === '' ? '미제공' : value;
export function Work24Result({ result, busy, onPage }: { result: unknown; busy: boolean; onPage: (page: number) => void }) {
  const data = work24ResultData(result);
  if (!data) return <><p className="warning">이 결과는 카드로 표시할 수 없습니다. JSON 상세에서 원문을 확인하세요.</p><details><summary>JSON 상세</summary><pre>{JSON.stringify(result, null, 2)}</pre></details></>;
  const { pagination } = data;
  return <section className="work24-result" aria-label="고용24 조회 결과">
    <h4>고용24 채용공고 목록</h4><p className="work24-notice">급여·날짜는 공급자 원문입니다. 현재 모집 중인지와 개인 지원 자격·적합성은 미확인입니다.</p>
    <p>공급자 전체 {count.format(pagination.total)}건 · {pagination.page}페이지 · 이번 결과 {data.jobs.length}건</p>
    {data.status === 'no_data' && <p role="status">검색 조건에 맞는 공고가 반환되지 않았습니다. 검색어·지역·고용형태를 확인하세요.</p>}
    {data.status === 'empty_page' && <p role="status">전체 결과는 있지만 이 페이지에는 없습니다. 첫 페이지로 돌아가 확인하세요.</p>}
    {pagination.partialPage && <p role="status" className="warning">요청한 건수보다 적게 반환됐으며 뒤에 결과가 남아 있습니다. 이번 페이지로 전체 공고를 확인한 것은 아닙니다.</p>}
    <ul className="work24-list">{data.jobs.map(job => { const link = job.sourceLinkVerified ? work24SourceLink(job.url, job.jobId) : null; return <li key={job.jobId}><article className="work24-card" aria-label={job.title}>
      <h4>{job.title}</h4><p><strong>{job.company}</strong></p>
      <dl><dt>근무지역</dt><dd>{job.regionRaw}</dd><dt>임금형태</dt><dd>{recorded(job.salary.formRaw)}</dd><dt>급여 원문</dt><dd>{recorded(job.salary.textRaw)}</dd><dt>마감 원문</dt><dd>{recorded(job.deadlineRaw)}</dd><dt>등록일 원문</dt><dd>{recorded(job.registeredOnRaw)}</dd></dl>
      {link ? <a className="work24-job-link" href={link} target="_blank" rel="noreferrer">공식 공고 원문 열기 ↗</a> : <p className="small">확인된 공식 공고 링크가 없습니다.</p>}
      <details><summary>근무조건·공고 원문 더 보기</summary><dl><dt>최소/최대 급여</dt><dd>{recorded(job.salary.minimumRaw)} / {recorded(job.salary.maximumRaw)}</dd><dt>근무형태</dt><dd>{recorded(job.workScheduleRaw)}</dd><dt>경력</dt><dd>{recorded(job.careerRaw)}</dd><dt>최소/최대 학력</dt><dd>{recorded(job.educationMinimumRaw)} / {recorded(job.educationMaximumRaw)}</dd><dt>수정 시점 원문</dt><dd>{recorded(job.providerModifiedAtRaw)}</dd><dt>고용형태</dt><dd>{job.employmentTypeRaw ? `${work24EmploymentTypes.find(type => type.code === job.employmentTypeRaw)?.label ?? '코드 설명 미확인'} · ${job.employmentTypeRaw}` : '미제공'}</dd><dt>정보 제공처</dt><dd>{recorded(job.sourceProviderRaw)}</dd></dl></details>
      <small>출처: 고용24 채용정보 Open API · 구인인증번호 {job.jobId}</small>
    </article></li>; })}</ul>
    <nav className="work24-pages" aria-label="고용24 결과 페이지">{pagination.page > 1 && <button disabled={busy} onClick={() => onPage(1)}>첫 페이지</button>}{pagination.page > 1 && <button disabled={busy} onClick={() => onPage(pagination.page - 1)}>이전 페이지</button>}{pagination.nextPage !== null && <button disabled={busy} onClick={() => onPage(pagination.nextPage!)}>다음 페이지</button>}</nav>
    {pagination.page === 1000 && (pagination.page - 1) * pagination.limit + data.jobs.length < pagination.total && <p role="status" className="warning">조회 가능한 마지막 페이지입니다. 검색 조건을 좁혀 남은 공고를 확인하세요.</p>}
    <div className="work24-source"><p><strong>출처: 고용24 채용정보 Open API</strong><br /><a href={work24Docs} target="_blank" rel="noreferrer">공식 명세·신청 안내 ↗</a></p><dl><dt>조회 시각</dt><dd>{work24Time(data.retrievedAt)}</dd></dl><p className="small">급여를 환산하거나 모집 상태를 추정하지 않습니다. 검색어·지역 조건의 전체 일치는 미확인이며, 페이지마다 공급자를 새로 조회해 결과가 바뀔 수 있습니다.</p></div>
    <details><summary>JSON 상세</summary><pre>{JSON.stringify(result, null, 2)}</pre></details>
  </section>;
}
