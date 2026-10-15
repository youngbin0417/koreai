import { useState, type FormEvent } from 'react';
import type { RemoteServer } from '../src/types';

export interface RemoteAuthorization { remoteId: string; url: string; redirectUri: string; expiresAt: number }
export function RemoteForm({ busy, redirectUri, save }: { busy: boolean; redirectUri: string; save: (oauth: boolean, value: unknown) => void }) {
  const [mode, setMode] = useState('oauth'), [name, setName] = useState(''), [url, setUrl] = useState(''), [tools, setTools] = useState('');
  const [bearerToken, setToken] = useState(''), [clientId, setClientId] = useState(''), [clientSecret, setSecret] = useState(''), [issuerUrl, setIssuer] = useState(''), [scope, setScope] = useState('');
  function submit(event: FormEvent) {
    event.preventDefault();
    save(mode === 'oauth', { name, url, tools: tools.split(',').map(value => value.trim()).filter(Boolean), ...(mode === 'oauth' ? { oauth: { ...(clientId.trim() ? { clientId: clientId.trim() } : {}), ...(clientSecret ? { clientSecret } : {}), ...(issuerUrl.trim() ? { issuerUrl: issuerUrl.trim() } : {}), ...(scope.trim() ? { scope: scope.trim() } : {}) } } : bearerToken ? { bearerToken } : {}) });
  }
  return <form onSubmit={submit}>
    <p>Streamable HTTP 서버에서 선택한 도구만 가져옵니다. 가져온 도구는 사용자 승인 후 실행됩니다.</p>
    <label>연결 이름<input required maxLength={80} value={name} onChange={event => setName(event.target.value)}/></label>
    <label>MCP 서버 주소<input type="url" required value={url} onChange={event => setUrl(event.target.value)} placeholder="https://example.com/mcp"/></label>
    <label>가져올 도구 이름 · 쉼표로 구분<input required value={tools} onChange={event => setTools(event.target.value)} placeholder="search, create_event"/></label>
    <label>인증 방식<select value={mode} onChange={event => { setMode(event.target.value); setToken(''); setSecret(''); }}><option value="oauth">서비스 OAuth 로그인</option><option value="bearer">Bearer 토큰 또는 인증 없음</option></select></label>
    {mode === 'oauth' ? <>
      <p className="small">서버의 인증 정보를 확인한 후 로그인 링크를 제공합니다. 로그인 완료 시 전용 계정이 생성되며 에이전트에는 계정과 도구 권한을 함께 부여하세요.</p>
      <details><summary>등록된 OAuth 클라이언트·권한 설정</summary>
        <p className="small">Client ID를 비우면 서버가 지원하는 동적 등록을 사용합니다. 미리 등록한 클라이언트에는 아래 콜백 주소를 사용하세요.</p><code className="remote-auth-link">{redirectUri}</code>
        <label>OAuth Client ID<input value={clientId} maxLength={1000} onChange={event => setClientId(event.target.value)}/></label>
        <label>OAuth Client Secret<input type="password" autoComplete="off" value={clientSecret} onChange={event => setSecret(event.target.value)}/></label>
        <label>예상 인증 서버 주소<input type="url" required={!!clientSecret} value={issuerUrl} onChange={event => setIssuer(event.target.value)} placeholder="https://auth.example.com"/></label>
        <label>요청할 OAuth 권한 · 공백으로 구분<input value={scope} onChange={event => setScope(event.target.value)} placeholder="서버 안내에 따른 scope"/></label>
      </details>
    </> : <label>Bearer 토큰 (필요한 경우)<input type="password" autoComplete="off" value={bearerToken} onChange={event => setToken(event.target.value)}/></label>}
    <button disabled={busy || !!clientSecret && !clientId.trim()} className="primary full">{mode === 'oauth' ? 'OAuth 로그인 준비' : '연결하고 도구 확인'}</button>
  </form>;
}

interface ListProps {
  remotes: Omit<RemoteServer, 'sealed'>[]; authorization?: RemoteAuthorization; busy: boolean;
  login: (id: string) => void; refresh: (id: string) => void; cancel: (id: string) => void; remove: (id: string) => void;
}
export function RemoteList({ remotes, authorization, busy, login, refresh, cancel, remove }: ListProps) {
  return <>{remotes.filter(remote => remote.enabled).map(remote => <article className="panel remote-card" key={remote.id} aria-label={`${remote.name} MCP 연결`}>
    <div className="panel-heading"><h3>{remote.name}</h3><span className="badge">{remote.authType === 'oauth' ? remote.authStatus === 'connected' ? 'OAuth 로그인 완료' : 'OAuth 로그인 필요' : 'Bearer / 직접 연결'}</span></div>
    <p>{remote.url}</p><p className="small">도구 {remote.tools.length}개 · 사용자 설치</p>
    {remote.authType === 'oauth' && <>
      {remote.oauthIssuer && <p className="small">인증 서버: {remote.oauthIssuer}</p>}
      {remote.oauthScope && <p className="small">요청 권한: {remote.oauthScope}</p>}
      {remote.oauthExpiresAt && <p className="small">토큰 만료: {new Intl.DateTimeFormat('ko-KR', { timeZone: 'Asia/Seoul', dateStyle: 'short', timeStyle: 'short' }).format(remote.oauthExpiresAt)}</p>}
      <p className="small">재로그인하면 새 계정이 생성됩니다. 기존 에이전트 권한은 새 계정으로 자동 이전되지 않습니다.</p>
      {remote.oauthError && <p role="status">인증을 완료하지 못했습니다. 로그인 또는 토큰 갱신을 다시 시도하세요.</p>}
      {remote.oauthPending && authorization?.remoteId === remote.id && <div className="info-strip" role="status"><p>서비스에서 로그인과 권한 동의를 완료하세요.</p><a className="remote-auth-link" href={authorization.url} target="_blank" rel="noreferrer">서비스 로그인 열기 ↗</a><p className="small">로그인 후 이 화면으로 돌아오세요. 대기 작업은 자동 실행되지 않습니다.</p></div>}
    </>}
    <div className="button-row">
      {remote.authType === 'oauth' && <><button disabled={busy} onClick={() => login(remote.id)}>다시 로그인</button><button disabled={busy} onClick={() => refresh(remote.id)}>토큰 갱신</button>{remote.authStatus !== 'connected' && <button disabled={busy} onClick={() => cancel(remote.id)}>로그인 취소</button>}</>}
      <button disabled={busy} onClick={() => remove(remote.id)}>연결 해제</button>
    </div>
  </article>)}</>;
}
