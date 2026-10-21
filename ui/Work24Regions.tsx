import { useState } from 'react';
import { work24RegionApiDocs, work24ReferenceCheckedAt } from '../src/research/work24-reference';
import { work24Time } from './work24-model';

export function work24RegionsInputState(input: string): { value: Record<string, unknown> | null; error: string | null } {
  try {
    const value = JSON.parse(input);
    if (value && typeof value === 'object' && !Array.isArray(value) && Object.keys(value).length === 0) return { value, error: null };
  } catch { /* Invalid JSON is shown below. */ }
  return { value: null, error: '지역 조회는 추가 조건 없이 빈 JSON 객체 {}를 사용합니다.' };
}

export function Work24RegionsForm({ input, busy, submit }: { input: string; changeInput: (value: string) => void; busy: boolean; submit: () => void }) {
  const { error } = work24RegionsInputState(input);
  return <form id="work24-regions" className="work24-form" onSubmit={event => { event.preventDefault(); if (!busy && !error) submit(); }}>
    <p className="work24-notice">공통코드 이용 승인과 이 행동을 허용한 계정이 필요합니다. 별도 검색 조건 없이 지역 코드 응답을 한 번 조회합니다. 채용공고 검색은 자동 실행하지 않습니다.</p>
    <p>채용공고 폼의 XLS 코드표는 {work24ReferenceCheckedAt} 확인 자료입니다. 이번 API 결과와 별도로 유지합니다.</p>
    {error && <p role="status" className="warning">{error}</p>}
  </form>;
}

type Region = { code: string; name: string; parentCode: string | null; depth: 1 | 2 };
type RegionData = { status: 'available' | 'no_data'; codeName: string; regions: Region[]; counts: { providerTotal: number; returnedCount: number; rootCount: number; childCount: number; providerTotalBasis: 'unconfirmed' }; retrievedAt?: string };
const object = (value: unknown): value is Record<string, unknown> => !!value && typeof value === 'object' && !Array.isArray(value);
function resultData(result: unknown): RegionData | null {
  if (!object(result) || result.contentTrust !== 'external_data' || !object(result.data)) return null;
  const data = result.data, counts = data.counts;
  if (!['available', 'no_data'].includes(String(data.status)) || typeof data.codeName !== 'string' || !Array.isArray(data.regions) || data.regions.length > 1000 || !object(counts)) return null;
  if (!['providerTotal', 'returnedCount', 'rootCount', 'childCount'].every(key => Number.isSafeInteger(counts[key]) && Number(counts[key]) >= 0) || counts.providerTotalBasis !== 'unconfirmed' || counts.returnedCount !== data.regions.length) return null;
  const rows = new Map<string, Region>();
  for (const row of data.regions) {
    if (!object(row) || typeof row.code !== 'string' || !/^\d{5}$/.test(row.code) || typeof row.name !== 'string' || !row.name || row.name.length > 200 || rows.has(row.code)) return null;
    if (!(row.depth === 1 && row.parentCode === null || row.depth === 2 && typeof row.parentCode === 'string')) return null;
    rows.set(row.code, row as Region);
  }
  const rootCount = [...rows.values()].filter(row => row.depth === 1).length;
  if (counts.rootCount !== rootCount || counts.childCount !== rows.size - rootCount || (counts.providerTotal === 0) !== (rows.size === 0) || (data.status === 'no_data') !== (rows.size === 0)) return null;
  if ([...rows.values()].some(row => row.depth === 2 && rows.get(row.parentCode!)?.depth !== 1)) return null;
  if (data.retrievedAt !== undefined && typeof data.retrievedAt !== 'string') return null;
  return data as unknown as RegionData;
}

export function Work24RegionsResult({ result }: { result: unknown; busy: boolean; onPage: (page: number) => void }) {
  const [query, setQuery] = useState('');
  const data = resultData(result);
  if (!data) return <><p className="warning">이 결과는 카드로 표시할 수 없습니다. JSON 상세에서 원문을 확인하세요.</p><details><summary>JSON 상세</summary><pre>{JSON.stringify(result, null, 2)}</pre></details></>;
  const names = new Map(data.regions.map(row => [row.code, row.name]));
  const matching = data.regions.filter(row => `${row.code} ${row.name} ${row.parentCode ? names.get(row.parentCode) : ''}`.includes(query.trim()));
  return <section className="work24-result" aria-label="고용24 지역 코드 결과">
    <h4>API 지역 코드 · {data.codeName}</h4>
    <p className="work24-notice">이번 API 수신 자료입니다. 채용공고 폼의 정적 XLS 목록을 자동 갱신하지 않습니다. 공급자 총건수의 계층별 집계 범위와 전체 수신 여부는 미확인입니다.</p>
    <p>공급자 total {data.counts.providerTotal} · 수신 {data.counts.returnedCount}개 · 상위 {data.counts.rootCount}개 / 하위 {data.counts.childCount}개</p>
    {data.status === 'no_data' ? <p role="status">지역 코드가 반환되지 않았습니다. 지역이나 채용공고가 없다는 의미는 아닙니다.</p> : <>
      <label htmlFor="work24-region-results-filter">받은 코드에서 이름·코드 찾기</label><input id="work24-region-results-filter" maxLength={200} value={query} onChange={event => setQuery(event.target.value)} />
      <p role="status">받은 {data.regions.length}개 중 {matching.length}개 표시 · 추가 API 호출 없음</p>
      <ul className="work24-list">{matching.map(row => <li key={row.code}><article className="work24-card" aria-label={`${row.name} · ${row.code}`}>
        <h4>{row.name}</h4><dl><dt>지역 코드</dt><dd>{row.code}</dd><dt>단계</dt><dd>{row.depth === 1 ? '상위' : '하위'}</dd><dt>상위 지역</dt><dd>{row.parentCode ? `${names.get(row.parentCode)} · ${row.parentCode}` : '없음'}</dd></dl>
      </article></li>)}</ul>
    </>}
    <div className="work24-source"><p><strong>출처: 고용24 공통코드 Open API · 지역</strong><br /><a href={work24RegionApiDocs} target="_blank" rel="noreferrer">공식 명세·신청 안내 ↗</a></p><dl><dt>조회 시각</dt><dd>{work24Time(data.retrievedAt)}</dd></dl></div>
    <details><summary>JSON 상세</summary><pre>{JSON.stringify(result, null, 2)}</pre></details>
  </section>;
}
