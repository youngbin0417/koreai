import { z } from 'zod';
import { discoverOAuthProtectedResourceMetadata, discoverAuthorizationServerMetadata, extractWWWAuthenticateParams, registerClient, startAuthorization, exchangeAuthorization, refreshAuthorization } from '@modelcontextprotocol/sdk/client/auth.js';
import type { OAuthClientInformationMixed, OAuthTokens, AuthorizationServerMetadata } from '@modelcontextprotocol/sdk/shared/auth.js';
import { Engine } from './engine.js';
import { constantEqual, hash, token } from './security.js';
import { oauthFetch, oauthUrl } from './mcp-oauth-network.js';
import { ActionError, type Account, type RemoteServer } from '../types.js';

export const remoteOAuthConfig = z.object({
  clientId: z.string().trim().min(1).max(1000).optional(), clientSecret: z.string().min(1).max(10000).optional(),
  issuerUrl: z.string().url().max(1000).optional(), scope: z.string().trim().min(1).max(2000).optional(),
}).strict().refine(v => !v.clientSecret || v.clientId && v.issuerUrl, 'Client Secret을 사용할 때는 Client ID와 예상 인증 서버 주소가 필요합니다.');
type Config = z.infer<typeof remoteOAuthConfig>;
interface OAuthData {
  config: Config; client?: OAuthClientInformationMixed; issuer?: string; metadata?: AuthorizationServerMetadata;
  resource?: string; scope?: string; redirectUri?: string; tokens?: OAuthTokens; issuedAt?: number;
}
interface Flow { remoteId: string; ownerHash: string; bindingHash: string; expiresAt: number; sealed: string }
export const mcpOAuthCallbackPath = '/mcp/oauth/callback';
export const mcpOAuthCookie = (id: string) => `koreai_mcp_oauth_${id}`;
const authError = () => new ActionError('UPSTREAM_AUTH_REQUIRED', 'MCP 서버에 다시 로그인하거나 토큰을 갱신하세요.', 'awaiting_auth');
const sameUrl = (a: string, b: string) => oauthUrl(a).href === oauthUrl(b).href;

/** One encrypted grant per remote. Interactive login always creates a new engine account. */
export class McpOAuth {
  baseUrl = ''; private closing = false; private locks = new Map<string, Promise<unknown>>();
  constructor(readonly engine: Engine, private readonly ready: (id: string) => Promise<void>) {}
  async seed(config: unknown) { return this.engine.vault.seal({ oauth: JSON.stringify({ config: remoteOAuthConfig.parse(config) } satisfies OAuthData) }); }
  private remote(id: string) {
    const remote = this.engine.store.get<RemoteServer>('remote', id);
    if (this.closing || !remote?.enabled || remote.authType !== 'oauth') throw new ActionError('UPSTREAM_DISABLED', '사용할 수 없는 MCP OAuth 연결입니다.');
    return remote;
  }
  private async data(id: string): Promise<OAuthData> { return JSON.parse((await this.engine.vault.open(this.remote(id).sealed)).oauth!); }
  private async save(id: string, data: OAuthData) {
    const sealed = await this.engine.vault.seal({ oauth: JSON.stringify(data) });
    this.engine.store.put('remote', id, { ...this.remote(id), sealed });
  }
  private async locked<T>(id: string, fn: () => Promise<T>): Promise<T> {
    const previous = this.locks.get(id) ?? Promise.resolve();
    const current = previous.catch(() => {}).then(fn); this.locks.set(id, current);
    try { return await current; } finally { if (this.locks.get(id) === current) this.locks.delete(id); }
  }
  private clearFlows(id: string) {
    for (const row of this.engine.store.list<Flow & { key: string }>('remote-oauth-flow')) if (row.remoteId === id) this.engine.store.delete('remote-oauth-flow', row.key);
  }
  private waiting(id: string, code: string) {
    const remote = this.engine.store.get<RemoteServer>('remote', id); if (!remote?.enabled) return;
    this.engine.store.put('remote', id, { ...remote, authStatus: 'awaiting_auth', oauthError: code });
    // Preserve the active job so its executor can report awaiting_auth or needs_review.
    const account = remote.accountId ? this.engine.store.get<Account>('account', remote.accountId) : undefined;
    if (account) this.engine.store.put('account', account.id, { ...account, enabled: false });
  }
  private async storeTokens(id: string, data: OAuthData, raw: OAuthTokens) {
    if (raw.token_type.toLowerCase() !== 'bearer' || !raw.access_token || raw.access_token.length > 20000 || /[\r\n]/.test(raw.access_token) || raw.refresh_token && (raw.refresh_token.length > 20000 || /[\r\n]/.test(raw.refresh_token)) || raw.expires_in !== undefined && (!Number.isSafeInteger(raw.expires_in) || raw.expires_in <= 0 || raw.expires_in > 315360000)) throw new ActionError('OAUTH_TOKEN', 'OAuth 토큰 형식을 확인하지 못했습니다.');
    data.tokens = { access_token: raw.access_token, token_type: raw.token_type, ...(raw.refresh_token ? { refresh_token: raw.refresh_token } : {}), ...(raw.expires_in !== undefined ? { expires_in: raw.expires_in } : {}), ...(raw.scope ? { scope: raw.scope } : {}) };
    data.issuedAt = Date.now(); await this.save(id, data);
    const remote = this.remote(id);
    this.engine.store.put('remote', id, { ...remote, oauthExpiresAt: raw.expires_in ? data.issuedAt + raw.expires_in * 1000 : undefined });
  }
  async start(id: string, ownerHash: string, binding: string) {
    return this.locked(id, async () => {
      const initial = this.remote(id), data = await this.data(id); this.clearFlows(id);
      if ((this.engine.store.get<{ expiresAt: number }>('web-session', ownerHash)?.expiresAt ?? 0) <= Date.now()) throw new ActionError('FORBIDDEN', '관리 화면에 다시 로그인하세요.');
      // A new interactive login may select a different provider account: old grants must not follow it.
      if (initial.accountId) await this.engine.removeAccount(initial.accountId);
      delete data.tokens; delete data.issuedAt;
      this.engine.store.put('remote', id, { ...this.remote(id), accountId: undefined, authStatus: 'awaiting_auth', oauthExpiresAt: undefined, oauthError: undefined });
      await this.save(id, data);
      try {
        const network = oauthFetch(initial.url), probe = await network(initial.url, { headers: { Accept: 'application/json, text/event-stream' } });
        const challenge = extractWWWAuthenticateParams(probe);
        if (challenge.resourceMetadataUrl && oauthUrl(challenge.resourceMetadataUrl).origin !== new URL(initial.url).origin) throw new ActionError('OAUTH_RESOURCE', '리소스 메타데이터는 MCP 서버와 같은 출처여야 합니다.');
        const resource = await discoverOAuthProtectedResourceMetadata(initial.url, { resourceMetadataUrl: challenge.resourceMetadataUrl }, network);
        const resourceUrl = oauthUrl(resource.resource), serverUrl = oauthUrl(initial.url), path = resourceUrl.pathname.replace(/\/$/, '');
        if (resourceUrl.origin !== serverUrl.origin || !(serverUrl.pathname === path || serverUrl.pathname.startsWith(`${path}/`))) throw new ActionError('OAUTH_RESOURCE', 'OAuth 리소스가 연결할 MCP 서버와 일치하지 않습니다.');
        const issuer = data.config.issuerUrl ?? resource.authorization_servers?.[0];
        if (!issuer || !resource.authorization_servers?.some(value => sameUrl(value, issuer))) throw new ActionError('OAUTH_ISSUER', '허용된 인증 서버를 찾지 못했습니다.');
        oauthUrl(issuer);
        if (data.issuer && !sameUrl(data.issuer, issuer)) throw new ActionError('OAUTH_ISSUER', '인증 서버가 변경됐습니다. 새 연결로 등록하세요.');
        const metadata = await discoverAuthorizationServerMetadata(issuer, { fetchFn: network });
        if (!metadata || !sameUrl(metadata.issuer, issuer) || !metadata.code_challenge_methods_supported?.includes('S256')) throw new ActionError('OAUTH_METADATA', '인증 서버의 issuer와 PKCE S256 지원을 확인하세요.');
        for (const endpoint of [metadata.authorization_endpoint, metadata.token_endpoint, metadata.registration_endpoint].filter((v): v is string => !!v)) if (oauthUrl(endpoint).origin !== oauthUrl(issuer).origin) throw new ActionError('OAUTH_ENDPOINT', 'OAuth 엔드포인트는 인증 서버와 같은 출처여야 합니다.');
        if (!metadata.token_endpoint || !metadata.authorization_endpoint) throw new ActionError('OAUTH_METADATA', '인증·토큰 엔드포인트가 필요합니다.');
        const redirectUri = `${this.baseUrl}${mcpOAuthCallbackPath}`;
        if (!data.config.clientId && data.redirectUri !== redirectUri) delete data.client;
        const scope = data.config.scope ?? challenge.scope;
        if (scope && (scope.length > 2000 || /[\r\n]/.test(scope))) throw new ActionError('OAUTH_SCOPE', 'OAuth 권한 범위를 확인하세요.');
        const client = data.client ?? (data.config.clientId ? { client_id: data.config.clientId, ...(data.config.clientSecret ? { client_secret: data.config.clientSecret } : {}) } : await registerClient(issuer, {
          metadata, clientMetadata: { client_name: 'KoreAI', redirect_uris: [redirectUri], grant_types: ['authorization_code', ...(metadata.grant_types_supported?.includes('refresh_token') ? ['refresh_token'] : [])], response_types: ['code'], token_endpoint_auth_method: 'none' }, scope, fetchFn: network,
        }));
        const state = token(), key = hash(state);
        const authorization = await startAuthorization(issuer, { metadata, clientInformation: client, redirectUrl: redirectUri, scope, state, resource: resource.resource });
        data.client = client; data.issuer = issuer; data.metadata = metadata; data.resource = resource.resource; data.scope = scope; data.redirectUri = redirectUri; await this.save(id, data);
        const expiresAt = Date.now() + 600_000;
        this.engine.store.put('remote-oauth-flow', key, { key, remoteId: id, ownerHash, bindingHash: hash(binding), expiresAt, sealed: await this.engine.vault.seal({ verifier: authorization.codeVerifier, redirectUri }) });
        this.engine.store.put('remote', id, { ...this.remote(id), oauthIssuer: issuer, oauthScope: scope });
        return { remoteId: id, url: authorization.authorizationUrl.href, redirectUri, expiresAt };
      } catch (error) { this.waiting(id, 'OAUTH_START_FAILED'); if (error instanceof ActionError) throw error; throw new ActionError('OAUTH_START_FAILED', 'OAuth 정보를 확인하지 못했습니다. 서버 메타데이터·클라이언트 등록 조건을 확인하세요.'); }
    });
  }
  async callback(state: string, code: string | undefined, cookies: Record<string, string>, issuer?: string) {
    if (!/^[A-Za-z0-9_-]{43}$/.test(state)) throw new ActionError('OAUTH_STATE', '유효하지 않은 로그인 요청입니다.');
    const key = hash(state), candidate = this.engine.store.get<Flow>('remote-oauth-flow', key);
    if (!candidate) throw new ActionError('OAUTH_STATE', '만료됐거나 이미 사용한 로그인 요청입니다.');
    return this.locked(candidate.remoteId, async () => {
      const flow = this.engine.store.get<Flow>('remote-oauth-flow', key);
      if (!flow || !constantEqual(flow.bindingHash, hash(cookies[mcpOAuthCookie(flow.remoteId)] ?? '')) || cookies.koreai_session && !constantEqual(flow.ownerHash, hash(cookies.koreai_session)) || (this.engine.store.get<{ expiresAt: number }>('web-session', flow.ownerHash)?.expiresAt ?? 0) <= Date.now()) throw new ActionError('OAUTH_SESSION', '로그인을 시작한 브라우저와 관리 세션에서 완료하세요.');
      this.engine.store.delete('remote-oauth-flow', key);
      try {
        if (flow.expiresAt <= Date.now()) throw new ActionError('OAUTH_EXPIRED', '서비스 로그인 요청이 만료됐습니다.');
        if (!code || code.length > 4096) throw new ActionError('OAUTH_DENIED', '서비스 로그인이 취소됐습니다.');
        const data = await this.data(flow.remoteId), proof = await this.engine.vault.open(flow.sealed);
        if (proof.redirectUri !== `${this.baseUrl}${mcpOAuthCallbackPath}` || !data.issuer || !data.metadata || !data.client || issuer && !sameUrl(issuer, data.issuer)) throw new ActionError('OAUTH_CONTEXT', '로그인 요청의 서버·콜백 정보가 일치하지 않습니다.');
        const tokens = await exchangeAuthorization(data.issuer, { metadata: data.metadata, clientInformation: data.client, authorizationCode: code, codeVerifier: proof.verifier!, redirectUri: proof.redirectUri!, resource: data.resource, fetchFn: oauthFetch(this.remote(flow.remoteId).url) });
        await this.storeTokens(flow.remoteId, data, tokens); await this.ready(flow.remoteId);
        return { remoteId: flow.remoteId };
      } catch (error) { this.waiting(flow.remoteId, 'OAUTH_LOGIN_FAILED'); if (error instanceof ActionError) throw error; throw new ActionError('OAUTH_LOGIN_FAILED', 'MCP 로그인 또는 도구 확인에 실패했습니다. 관리 화면에서 다시 로그인하세요.'); }
    });
  }
  private async refreshInside(id: string) {
    const remote = this.remote(id), data = await this.data(id);
    try {
      if (!data.tokens?.refresh_token || !data.issuer || !data.metadata || !data.client) throw authError();
      const tokens = await refreshAuthorization(data.issuer, { metadata: data.metadata, clientInformation: data.client, refreshToken: data.tokens.refresh_token, resource: data.resource, fetchFn: oauthFetch(remote.url) });
      await this.storeTokens(id, data, tokens);
      const latest = this.remote(id); if (!latest.accountId) throw authError();
      const account = this.engine.store.get<Account>('account', latest.accountId); if (!account) throw authError();
      this.engine.store.put('account', account.id, { ...account, enabled: true });
      this.engine.store.put('remote', id, { ...latest, authStatus: 'connected', oauthError: undefined });
      return data;
    } catch { this.waiting(id, 'OAUTH_REFRESH_FAILED'); throw authError(); }
  }
  async refresh(id: string) { await this.locked(id, () => this.refreshInside(id)); }
  async access(id: string, forSetup = false) {
    const read = async () => {
      const remote = this.remote(id); if (!forSetup && remote.authStatus !== 'connected') throw authError();
      let data = await this.data(id);
      if (!forSetup && remote.oauthExpiresAt && remote.oauthExpiresAt <= Date.now() + Math.min(30000, (remote.oauthExpiresAt - (data.issuedAt ?? 0)) / 10)) data = await this.refreshInside(id);
      if (!data.tokens?.access_token) throw authError();
      const secret = data.client?.client_secret;
      return { token: data.tokens.access_token, secrets: [data.tokens.access_token, data.tokens.refresh_token, secret, secret ? Buffer.from(`${data.client!.client_id}:${secret}`).toString('base64') : undefined].filter((v): v is string => !!v) };
    };
    return forSetup ? read() : this.locked(id, read);
  }
  async block(id: string) { await this.locked(id, async () => this.waiting(id, 'OAUTH_RELOGIN_REQUIRED')); }
  async cancel(id: string) { await this.locked(id, async () => { this.remote(id); this.clearFlows(id); this.waiting(id, 'OAUTH_CANCELLED'); }); }
  async erase(id: string) { await this.locked(id, async () => { this.clearFlows(id); const remote = this.engine.store.get<RemoteServer>('remote', id); if (remote) this.engine.store.put('remote', id, { ...remote, sealed: await this.engine.vault.seal({}), accountId: undefined, oauthExpiresAt: undefined, oauthError: undefined }); }); }
  async close() { this.closing = true; await Promise.allSettled([...this.locks.values()]); }
}
