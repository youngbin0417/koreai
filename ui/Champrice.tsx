import { useState } from 'react';
import { champriceDefaultMonth, champriceSnapshots } from '../src/research/champrice-snapshots';
import { champriceInputState, champriceResultData, champriceTime } from './champrice-model';

export function ChampriceForm({ input, changeInput, busy, submit }: { input: string; changeInput: (value: string) => void; busy: boolean; submit: () => void }) {
  const { value, error } = champriceInputState(input);
  const [note, setNote] = useState<{ input: string; text: string }>();
  const snapshot = champriceSnapshots.find(s => s.month === (value?.month ?? champriceDefaultMonth));
  const text = (key: string, fallback = '') => typeof value?.[key] === 'string' || typeof value?.[key] === 'number' ? String(value[key]) : fallback;
  function change(key: string, next: unknown) {
    if (!value) return;
    const updated = { ...value, [key]: next };
    if (next === '' && ['manufacturer', 'storeQuery', 'surveyDate'].includes(key)) delete updated[key];
    if (!['page', 'limit'].includes(key)) updated.page = 1;
    const cleared = key === 'month' && typeof updated.surveyDate === 'string' && !updated.surveyDate.startsWith(String(next) + '-');
    if (cleared) delete updated.surveyDate;
    const changed = JSON.stringify(updated, null, 2);
    changeInput(changed);
    setNote(cleared ? { input: changed, text: '다른 월의 조사일 조건을 지웠습니다. 원하는 조사일을 다시 입력할 수 있습니다.' } : undefined);
  }
  return <form id="champrice-search" className="champrice-form" aria-label="참가격 검색 조건" onSubmit={event => { event.preventDefault(); if (!busy && !error) submit(); }}>
    <p className="champrice-notice">월별 조사 가격입니다. 실시간 판매가·재고와 다릅니다. 상품명과 조사월을 선택해 조회하세요.</p>
    <fieldset disabled={busy || !value}>
      <legend>검색 조건</legend>
      <label htmlFor="champrice-month">참가격 조사월</label>
      <select id="champrice-month" value={snapshot?.month ?? ''} onChange={e => change('month', e.target.value)}>
        {!snapshot && <option value="">조사월을 확인하세요</option>}
        {champriceSnapshots.map(s => <option key={s.month} value={s.month}>{s.label} · {s.publishedOn} 공개</option>)}
      </select>
      {note?.input === input && <p role="status" className="small">{note.text}</p>}
      <label htmlFor="champrice-product">상품명 <span className="muted">필수</span></label>
      <input id="champrice-product" required maxLength={100} value={text('productName')} onChange={e => change('productName', e.target.value)} placeholder="예: 우유" autoComplete="off" />
      <label htmlFor="champrice-match">상품명 일치 방식</label>
      <select id="champrice-match" value={text('match', 'contains')} onChange={e => change('match', e.target.value)}><option value="contains">상품명에 검색어 포함</option><option value="exact">상품명 전체 일치</option></select>
      <div className="champrice-fields">
        <label>제조사 <span className="muted">선택 · 전체 일치</span><input maxLength={100} value={text('manufacturer')} onChange={e => change('manufacturer', e.target.value)} placeholder="파일에 기록된 제조사명" /></label>
        <label>판매업소 <span className="muted">선택 · 검색어 포함</span><input maxLength={100} value={text('storeQuery')} onChange={e => change('storeQuery', e.target.value)} placeholder="예: 서울점" /></label>
      </div>
      <label htmlFor="champrice-date">조사일 <span className="muted">선택 · 비우면 전체 조사일</span></label>
      <input id="champrice-date" type="date" min={snapshot ? snapshot.month + '-01' : undefined} max={snapshot ? new Date(Date.UTC(Number(snapshot.month.slice(0, 4)), Number(snapshot.month.slice(5)), 0)).toISOString().slice(0, 10) : undefined} value={text('surveyDate')} onChange={e => change('surveyDate', e.target.value)} aria-describedby="champrice-dates" />
      <p id="champrice-dates" className="small">이 파일의 조사일: {snapshot?.surveyDates.join(', ') ?? '조사월을 먼저 선택하세요.'} · 판매업소명은 주소 필터가 아닙니다.</p>
      <details><summary>페이지 설정</summary><div className="champrice-fields">
        <label>페이지<input type="number" inputMode="numeric" min={1} max={10000} step={1} value={text('page', '1')} onChange={e => change('page', e.target.value === '' ? '' : Number(e.target.value))} /></label>
        <label>한 번에 볼 건수<input type="number" inputMode="numeric" min={1} max={50} step={1} value={text('limit', '10')} onChange={e => change('limit', e.target.value === '' ? '' : Number(e.target.value))} /></label>
      </div></details>
    </fieldset>
    {error && <p role="status" className="warning">{error}</p>}
  </form>;
}

const amount = new Intl.NumberFormat('ko-KR');
const discount = (value: boolean | null) => value === null ? '미수집' : value ? 'Y · 있음' : 'N · 없음';
const cacheLabels = new Map([['downloaded', '새 파일 다운로드'], ['shared', '동시 다운로드 공유'], ['hit', '저장 파일 재사용']]);
export function ChampriceResult({ result, busy, onPage }: { result: unknown; busy: boolean; onPage: (page: number) => void }) {
  const data = champriceResultData(result);
  if (!data) return <><p className="warning">이 결과는 카드로 표시할 수 없습니다. JSON 상세에서 원문을 확인하세요.</p><details><summary>JSON 상세</summary><pre>{JSON.stringify(result, null, 2)}</pre></details></>;
  const { snapshot, pagination } = data;
  const manifest = champriceSnapshots.find(s => s.month === snapshot.month)!;
  const cacheLabel = data.cache ? cacheLabels.get(data.cache.status) ?? '기록 확인 필요' : '기록 없음';
  return <section className="champrice-result" aria-label="참가격 조회 결과">
    <h4>{snapshot.label} 조사 자료</h4>
    <p className="champrice-notice">현재 결제가·재고가 아닙니다. 파일 순서로 표시하며 상품 동일성·용량·단위 가격·최저가를 판정하지 않습니다.</p>
    <p>전체 {amount.format(data.totalSourceRows)}건 중 조건 일치 <strong>{amount.format(data.totalMatches)}건</strong> · {pagination.page}페이지 · 이번 결과 {data.prices.length}건</p>
    {data.status === 'no_data' && <p role="status">조건에 맞는 조사 기록이 없습니다. 상품명·제조사·판매업소·조사일 조건을 확인하세요. 현재 판매 여부를 뜻하지 않습니다.</p>}
    {data.status === 'empty_page' && <p role="status">일치하는 기록은 있지만 이 페이지에는 없습니다. 첫 페이지로 돌아가 확인하세요.</p>}
    <ul className="champrice-list">{data.prices.map(row => <li key={row.sourceRow}><article className="champrice-card" aria-label={`${row.productNameRaw} · ${row.storeNameRaw} · ${row.surveyedOn}`}>
      <h4>{row.productNameRaw || '상품명 미수집'}</h4>
      <p className="champrice-price"><strong>{amount.format(row.priceKrw)}원</strong><span>조사 당시 가격</span></p>
      <dl><dt>판매업소</dt><dd>{row.storeNameRaw || '미수집'}</dd><dt>제조사</dt><dd>{row.manufacturerRaw || '미수집'}</dd><dt>조사일</dt><dd>{row.surveyedOn}</dd><dt>세일</dt><dd>{discount(row.sale)}</dd><dt>1+1</dt><dd>{discount(row.onePlusOne)}</dd></dl>
      <small>출처: 한국소비자원 · {snapshot.label} 조사 · 파일 행 {row.sourceRow}</small>
    </article></li>)}</ul>
    <nav className="champrice-pages" aria-label="참가격 결과 페이지">
      {pagination.page > 1 && <button disabled={busy} onClick={() => onPage(1)}>첫 페이지</button>}
      {pagination.page > 1 && <button disabled={busy} onClick={() => onPage(pagination.page - 1)}>이전 페이지</button>}
      {pagination.nextPage !== null && <button disabled={busy} onClick={() => onPage(pagination.nextPage!)}>다음 페이지</button>}
    </nav>
    {pagination.pageLimitReached && <p role="status" className="warning">조회 가능한 마지막 페이지입니다. 남은 기록은 검색 조건을 좁혀 확인하세요.</p>}
    <div className="champrice-source">
      <p><strong>출처: 한국소비자원 생필품 가격 정보({snapshot.label} 조사)</strong><br /><a href={manifest.sourceUrl} target="_blank" rel="noreferrer">공식 자료·이용 조건 ↗</a></p>
      <dl><dt>자료 공개일</dt><dd>{snapshot.publishedOn}</dd><dt>다운로드·검증</dt><dd>{champriceTime(data.retrievedAt)}</dd><dt>이번 조회</dt><dd>{champriceTime(data.queriedAt)}</dd><dt>파일 사용</dt><dd>{cacheLabel}</dd></dl>
      <p className="small">할인 Y는 있음, N은 없음, 빈 값은 미수집입니다. 다운로드 시각과 조사일은 다릅니다.</p>
    </div>
    <details><summary>JSON 상세</summary><pre>{JSON.stringify(result, null, 2)}</pre></details>
  </section>;
}
