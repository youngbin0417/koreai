import { useEffect, useRef, useState } from 'react';
import type { ApiCandidate } from '../src/research/app-api-backlog';
import type { DraftPreview } from '../src/connectors/drafts';

const accessLabels: Record<ApiCandidate['access'], string> = {
  'public-key': '공개 정보 · 공급자 키 필요', 'public-file': '공공 파일 · 키 없이 조회', merchant: '판매자 API · 소비자 권한 별도', unknown: '접근 경로 조사 필요',
};
export function ExpansionPlan({ candidates, actionTitles, openAction }: { candidates: ApiCandidate[]; actionTitles: Record<string, string>; openAction: (id: string) => void }) {
  const [priority, setPriority] = useState('all');
  const [query, setQuery] = useState('');
  const [requestedOnly, setRequestedOnly] = useState(false);
  const visible = candidates.filter(c => (!requestedOnly || !!c.connectionPlan) && (priority === 'all' || String(c.priority) === priority) && `${c.name} ${c.proposedActions.join(' ')} ${c.connectionPlan?.aliases.join(' ')??''}`.toLowerCase().includes(query.toLowerCase()));
  return <>
    <div className="page-heading"><div><h1>다음에 연결할 서비스</h1><p>{candidates.length}개 후보의 근거·우선순위·다음 작업을 기록합니다.</p></div></div>
    <div className="info-strip">1순위: 조회 초안 구현 · 2순위: 공식 경로 검증 · 3순위: 앱 API·제휴 조사</div>
    <div className="toolbar">
      <input className="search" aria-label="확장 후보 검색" placeholder="앱 이름 또는 기능 검색" value={query} onChange={e => setQuery(e.target.value)} />
      <select aria-label="확장 우선순위" value={priority} onChange={e => setPriority(e.target.value)}><option value="all">모든 우선순위</option><option value="1">1순위 · 조회 초안</option><option value="2">2순위 · 공식 경로</option><option value="3">3순위 · API 조사</option></select>
      <label className="check"><input type="checkbox" checked={requestedOnly} onChange={event=>setRequestedOnly(event.target.checked)}/>추가 요청 앱만 보기</label>
    </div>
    <div className="account-grid">{visible.map(c => <article className="panel expansion-card" key={c.serviceId} aria-label={`${c.name} 확장 계획`}>
      <div className="panel-heading"><h2>{c.name}</h2><span className="badge">{c.priority}순위</span></div>
      <p>{accessLabels[c.access]}</p>
      <p>{c.documentedScope ?? '공식 API 제공 범위를 아직 확인하지 않았습니다.'}</p>
      {c.notice&&<p role="status" className="warning"><strong>{c.notice.title}</strong><br/>{c.notice.message} <a href={c.notice.url} target="_blank" rel="noreferrer">공식 종료 공지 ↗</a></p>}
      <p className="muted small">{c.checkedAt ? `문서 확인: ${c.checkedAt} · ${c.access === 'public-file' ? '키 불필요 · 지역별 검증 범위 확인' : '계정 미검증'}` : '미조사 · 홈페이지를 조사 시작점으로 등록'}</p>
      <h3>먼저 정의할 행동</h3><ul>{c.proposedActions.map(a => <li key={a}>{a}</li>)}</ul>
      <h3>다음 작업</h3><p>{c.nextStep}</p>
      {c.connectionPlan&&<details className="requested-plan"><summary>첫 연결 초안</summary><p className="small">요청 등록: {c.connectionPlan.requestedAt} · {c.implementedActionIds.length ? c.access === 'public-file' ? '조회 실행기 구현 · 지역별 자료 검증 관리' : '조회 실행기 구현 · 연결 조건·계정 검증 필요' : '조사/설계 단계 · 자동 실행 미지원'}</p><dl><dt>첫 조회</dt><dd>{c.connectionPlan.firstRead}</dd><dt>연결 후보</dt><dd>{{'official-api':'공식 API 후보','public-data':'공개 데이터 후보',partnership:'제휴·허용 범위 확인'}[c.connectionPlan.method]}</dd><dt>필요 조건</dt><dd>{c.connectionPlan.requiredAccess}</dd><dt>결과 확인·경계</dt><dd>{c.connectionPlan.resultCheck}</dd></dl><p>{c.implementedActionIds.length ? c.nextStep : c.connectionPlan.nextStep}</p></details>}
      <div className="button-row">{c.implementedActionIds.map(id => <button key={id} onClick={() => openAction(id)}>{c.implementedActionIds.length > 1 ? actionTitles[id] ?? '조회 기능 열기' : '조회 기능 열기'}</button>)}{c.draftActionIds.map(id => <button key={id} onClick={() => openAction(id)}>조회 초안 열기</button>)}<a href={c.sourceUrl} target="_blank" rel="noreferrer">{c.checkedAt ? '공식 근거' : '공식 서비스'} ↗</a></div>
    </article>)}</div>
    {visible.length === 0 && <p role="status">검색 조건에 맞는 확장 후보가 없습니다.</p>}
  </>;
}

export function DraftInspector({ actionId, input, changeInput, implemented = false }: { actionId: string; input: string; changeInput: (value: string) => void; implemented?: boolean }) {
  const [busy, setBusy] = useState(false);
  const [preview, setPreview] = useState<{ input: string; data: DraftPreview }>();
  const [error, setError] = useState<{ input: string; message: string }>();
  const controller = useRef<AbortController | null>(null);
  useEffect(() => () => controller.current?.abort(), []);
  async function inspect(example: boolean) {
    controller.current?.abort();
    const requestController = new AbortController(); controller.current = requestController;
    setBusy(true); setError(undefined);
    const requestedInput = input;
    try {
      const response = await fetch(`/api/drafts/${encodeURIComponent(actionId)}/${example ? 'example' : 'preview'}`, {
        signal: requestController.signal, ...(example ? {} : { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(JSON.parse(input)) }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error?.message ?? '요청 구조를 확인하지 못했습니다.');
      if (!requestController.signal.aborted) {
        if (example) changeInput(JSON.stringify(data, null, 2));
        else setPreview({ input: requestedInput, data: data as DraftPreview });
      }
    } catch (e) {
      if (!requestController.signal.aborted) setError({ input: requestedInput, message: e instanceof Error ? e.message : '요청 구조를 확인하지 못했습니다.' });
    } finally { if (!requestController.signal.aborted) setBusy(false); }
  }
  return <section className="draft-inspector" aria-label={implemented ? '조회 요청 검토' : '연결 초안 검토'}>
    <p>{implemented ? actionId === 'animal-hospitals.search' ? '예시와 미리보기는 외부에 전송하지 않습니다. 공식 지역 이름을 선택하고 키 없이 실행하세요. 병원명·상태·페이지 조건은 지역 CSV를 받은 뒤 적용합니다.' : `예시와 미리보기는 외부에 전송하지 않습니다. 계정을 연결한 뒤 실행 요청으로 조회하세요. ${actionId === 'kma.observation' ? '기상청 예시는 한국 표준시의 최근 발표 정시와 서울 격자를 사용합니다.' : actionId === 'airkorea.forecast' ? '에어코리아 예시는 한국 표준시 오늘의 발표 날짜를 사용합니다. 예보 대상 날짜는 결과에서 별도로 확인하세요.' : ''}` : '초안 단계입니다. 예시 입력과 요청 구조를 검토할 수 있습니다. 외부 호출·계정 검증은 후속 단계입니다.'}</p>
    <div className="button-row"><button disabled={busy} onClick={() => void inspect(true)}>예시 입력 불러오기</button><button disabled={busy} onClick={() => void inspect(false)}>요청 구조 미리보기</button></div>
    {error?.input === input && <p role="alert" className="warning">{error.message}</p>}
    {preview?.input === input && <><h3>요청 구조 · 외부 호출 없음</h3><p>{preview.data.request ? '공식 문서 기준 요청 템플릿입니다. 실제 키 응답 검증은 아직 수행하지 않았습니다.' : '입력 규격 제안입니다. 공급자 요청 필드 매핑은 상세 문서 검토 후 구현합니다.'}</p><pre>{JSON.stringify(preview.data, null, 2)}</pre></>}
  </section>;
}
