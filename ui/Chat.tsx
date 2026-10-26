import { useCallback, useEffect, useState, type FormEvent } from 'react';
import type { ChatSettings, Conversation } from '../src/ai/conversations';
import type { ProviderId } from '../src/ai/providers';
import type { Job } from '../src/types';

interface Feature { id: string; title: string; enabled: boolean; effect: 'read' | 'write'; method: string }
interface Props { ai: ChatSettings; actions: Feature[]; jobs: Job[]; openJob: (id: string) => void; settingsChanged: () => void; manageAccounts: () => void }
const statuses: Record<string, string> = { pending_approval: '내용 확인·승인 필요', awaiting_auth: '계정 인증 필요', awaiting_user: '사용자 작업 필요', running: '실행 중', queued: '접수됨', needs_review: '실제 결과 확인 필요', succeeded: '완료', failed: '실패', cancelled: '취소됨' };
async function request<T>(path: string, method = 'GET', body?: unknown): Promise<T> {
  const response = await fetch(`/api${path}`, { method, headers: body ? { 'Content-Type': 'application/json' } : {}, ...(body ? { body: JSON.stringify(body) } : {}) });
  const data = await response.json();
  if (!response.ok) throw new Error(data.error?.message ?? '대화를 처리하지 못했습니다.');
  return data as T;
}
export function Chat({ ai, actions, jobs, openJob, settingsChanged, manageAccounts }: Props) {
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [selected, setSelected] = useState('');
  const [content, setContent] = useState('');
  const [apiKey, setApiKey] = useState('');
  const [keyOpen, setKeyOpen] = useState(false);
  const [provider, setProvider] = useState<ProviderId>(() => ai.providers.find(entry => entry.configured)?.id ?? ai.defaultProvider);
  const [grants, setGrants] = useState<string[]>(() => actions.filter(action => action.enabled && action.effect === 'read' && action.method === 'api').map(action => action.id));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  // Keep the request ID through a lost HTTP response, including a changed draft.
  const [pending, setPending] = useState<{ conversationId: string; requestId: string; content: string }>();
  const current = conversations.find(conversation => conversation.id === selected);
  const deepseek = ai.providers.find(entry => entry.id === 'deepseek');
  // An existing conversation keeps the provider it was created with.
  const activeProvider = current?.provider ?? provider;
  const active = ai.providers.find(entry => entry.id === activeProvider) ?? ai.providers.find(entry => entry.id === ai.defaultProvider)!;
  const configured = active.configured;
  const enabled = actions.filter(action => action.enabled);
  const refresh = useCallback(async () => {
    const result = await request<Conversation[]>('/chats');
    setConversations(result);
  }, []);
  useEffect(() => {
    let alive = true;
    const controller = new AbortController();
    const poll = async () => {
      try {
        const response = await fetch('/api/chats', { signal: controller.signal });
        const result = await response.json();
        if (!response.ok) throw new Error('대화에 다시 연결하려면 로그인 상태를 확인하세요.');
        if (alive) setConversations(result as Conversation[]);
      } catch (problem) { if (alive && !controller.signal.aborted) setError(problem instanceof Error ? problem.message : '서버 연결을 확인하세요.'); }
    };
    void poll(); const timer = setInterval(() => void poll(), 2000);
    return () => { alive = false; controller.abort(); clearInterval(timer); };
  }, []);
  async function saveKey(event: FormEvent) {
    event.preventDefault(); setBusy(true); setError('');
    try { await request('/ai/key', 'POST', { apiKey }); setApiKey(''); setKeyOpen(false); settingsChanged(); }
    catch (problem) { setError(problem instanceof Error ? problem.message : '키를 등록하지 못했습니다.'); }
    finally { setBusy(false); }
  }
  async function send(event?: FormEvent, continuation = false) {
    event?.preventDefault(); if (busy) return;
    setBusy(true); setError('');
    try {
      let conversationId = selected;
      if (!conversationId) {
        const created = await request<Conversation>('/chats', 'POST', { allowedActions: grants.filter(id => enabled.some(action => action.id === id)), provider });
        conversationId = created.id; setSelected(created.id);
      }
      const outgoing = pending ?? { conversationId, requestId: crypto.randomUUID(), content: continuation ? '기존 작업의 최신 상태와 결과를 확인하고 대화를 이어주세요. 이미 만든 쓰기를 새로 전송하지 마세요.' : content };
      setPending(outgoing);
      await request(`/chats/${outgoing.conversationId}/messages`, 'POST', { requestId: outgoing.requestId, content: outgoing.content });
      setSelected(outgoing.conversationId); setContent(''); setPending(undefined); await refresh();
    } catch (problem) { setError(problem instanceof Error ? problem.message : '메시지를 보내지 못했습니다.'); }
    finally { setBusy(false); }
  }
  function newChat() { if (pending || busy) return; setSelected(''); setContent(''); setError(''); }
  return <>
    <div className="page-heading"><div><h1>AI와 대화</h1><p>DeepSeek Flash 또는 Motif를 골라 요청하고 작업의 내용과 결과를 확인하세요.</p></div><button disabled={busy || !!pending} onClick={newChat}>＋ 새 대화</button></div>
    {error && <p className="error-banner" role="alert">{error}</p>}
    {!selected && <section className="panel chat-provider" aria-label="새 대화 AI 공급자"><label>AI 공급자<select aria-label="AI 공급자" value={provider} disabled={busy || !!pending} onChange={event => setProvider(event.target.value as ProviderId)}>{ai.providers.map(entry => <option key={entry.id} value={entry.id} disabled={!entry.configured}>{entry.label} · {entry.model}{entry.configured ? '' : ' (키 없음)'}</option>)}</select></label><p className="muted">대화를 시작하면 그 공급자로 고정됩니다. {active.environmentOnly ? `${active.keyEnv ?? '환경변수'}로 키를 관리합니다.` : '키는 .env 또는 관리 화면에서 관리합니다.'} <a href={active.docs} target="_blank" rel="noreferrer">공식 문서</a></p></section>}
    {activeProvider === 'deepseek' && deepseek?.keySource === 'environment' && <p className="info-strip">DeepSeek 키는 .env의 DEEPSEEK_API_KEY로 관리합니다. 변경 후 서버를 재시작하세요.</p>}
    {activeProvider === 'motif' && <p className="info-strip">Motif 키는 .env의 MORPH_API_KEY로 관리합니다. 변경 후 서버를 재시작하세요.</p>}
    {activeProvider === 'deepseek' && deepseek && deepseek.keySource !== 'environment' && (!deepseek.configured || keyOpen) && <form className="panel chat-key" onSubmit={event => void saveKey(event)}><h2>DeepSeek 키 연결</h2><p>키는 이 서버에 암호화해 저장합니다.</p><label>DeepSeek API 키<input type="password" autoComplete="new-password" required value={apiKey} onChange={event => setApiKey(event.target.value)} /></label><button className="primary" disabled={busy}>키 저장</button></form>}
    <div className="toolbar"><select aria-label="대화 기록" value={selected} disabled={busy || !!pending} onChange={event => { setSelected(event.target.value); setError(''); }}><option value="">새 대화</option>{conversations.map(conversation => <option key={conversation.id} value={conversation.id}>{conversation.title}{conversation.provider === 'motif' ? ' · Motif' : ''}</option>)}</select><button onClick={manageAccounts}>서비스 계정 연결</button>{activeProvider === 'deepseek' && deepseek && deepseek.configured && deepseek.keySource !== 'environment' && <button onClick={() => setKeyOpen(value => !value)}>AI 키 변경</button>}</div>
    {!selected && <details className="panel chat-grants"><summary>이 대화에서 허용할 기능 · {grants.filter(id => enabled.some(action => action.id === id)).length}개</summary><p>서비스 계정을 연결하면 사용 가능한 기능이 늘어납니다. 게시·전송은 내용을 확인하고 승인한 후 실행합니다.</p>{enabled.map(action => <label key={action.id} className="check"><input type="checkbox" checked={grants.includes(action.id)} onChange={() => setGrants(previous => previous.includes(action.id) ? previous.filter(id => id !== action.id) : [...previous, action.id])} />{action.title}{action.effect === 'write' && <small>승인 후 실행</small>}</label>)}</details>}
    <section className="chat-thread" aria-label="대화 내용" aria-live="polite">
      <p className="muted chat-provider-current">{current ? '대화 공급자' : '시작할 공급자'}: {active.label} · {active.model}{configured ? '' : ' (키 없음)'}</p>
      {!current?.messages.length && <div className="empty"><h2>무엇을 도와드릴까요?</h2><p>계정을 연결한 기능으로 조회·작업을 요청할 수 있습니다. 서비스 계정 연결 전에도 일반 대화가 가능합니다.</p></div>}
      {current?.messages.map(message => <article key={message.id} className={`chat-message ${message.role}`}><strong>{message.role === 'user' ? '나' : 'KoreAI'}</strong><p>{message.content}</p></article>)}
      {current?.status === 'running' && <p role="status">응답을 준비하고 있습니다. 화면을 닫아도 서버에서 계속 진행합니다.</p>}
    </section>
    {current && current.jobIds.length > 0 && <section className="panel chat-jobs" aria-label="대화에서 만든 작업"><h2>작업과 승인</h2>{current.jobIds.map(id => { const job = jobs.find(value => value.id === id); return <button key={id} onClick={() => openJob(id)}><span>{actions.find(action => action.id === job?.actionId)?.title ?? '작업 상태 확인'}</span><strong>{job ? statuses[job.state] : '상태 갱신 중'}</strong></button>; })}<button disabled={busy || current.status === 'running' || !configured} onClick={() => void send(undefined, true)}>결과 이어서 확인</button></section>}
    <form className="chat-composer" onSubmit={event => void send(event)}><label>보낼 메시지<textarea rows={3} maxLength={8000} value={content} disabled={!!pending} onChange={event => setContent(event.target.value)} placeholder="예: 강남역 근처 도서관을 찾아줘" /></label><button className="primary" disabled={busy || !configured || current?.status === 'running' || !pending && !content.trim()}>{pending ? '같은 메시지 다시 확인' : '보내기'}</button></form>
  </>;
}
