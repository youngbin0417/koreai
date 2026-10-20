import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import type { AuthorizationServerMetadata } from '@modelcontextprotocol/sdk/shared/auth.js';
import { validateMcpOAuthEndpoints } from '../src/core/mcp-oauth-policy.js';
import { mcpProviders, tossConsolePreset as preset } from '../src/research/mcp-providers.js';
import { createRuntime } from '../src/http.js';
import { admin } from '../src/core/engine.js';
import { TestVault, tempDir } from './helpers.js';
import { ownedOAuth, runtimeApi, runtimeLogin, authorizeOwned } from './mcp-oauth-fixture.js';

test('reviewed Toss endpoints allow only the pinned server, issuer and exact authorization/token pair', () => {
  const server = { url: preset.url, presetId: 'toss-console' as const };
  const metadata: AuthorizationServerMetadata = { issuer: preset.oauth.issuerUrl, authorization_endpoint: preset.endpoints.authorization, token_endpoint: preset.endpoints.token, response_types_supported: ['code'] };
  assert.doesNotThrow(() => validateMcpOAuthEndpoints(server, metadata.issuer, metadata));
  assert.throws(() => validateMcpOAuthEndpoints({ url: preset.url }, metadata.issuer, metadata));
  for (const url of ['https://evil.example/mcp', 'https://mcp.toss.im/another/mcp', `${preset.url}?key=hidden`]) assert.throws(() => validateMcpOAuthEndpoints({ ...server, url }, metadata.issuer, metadata));
  assert.throws(() => validateMcpOAuthEndpoints(server, 'https://evil.example', metadata));
  assert.throws(() => validateMcpOAuthEndpoints(server, metadata.issuer, { ...metadata, issuer: 'https://evil.example' }));
  for (const endpoint of ['https://evil.example/token', `${preset.endpoints.token}/extra`, `${preset.endpoints.token}?target=other`, 'https://169.254.169.254/token', 'http://127.0.0.1/token', 'https://business-accounts.toss.im.evil.example/oauth2/token', 'https://mcp.toss.im/token']) assert.throws(() => validateMcpOAuthEndpoints(server, metadata.issuer, { ...metadata, token_endpoint: endpoint }));
  assert.throws(() => validateMcpOAuthEndpoints(server, metadata.issuer, { ...metadata, authorization_endpoint: metadata.token_endpoint }));
  assert.throws(() => validateMcpOAuthEndpoints(server, metadata.issuer, { ...metadata, registration_endpoint: 'https://business-accounts.toss.im/register' }));
  assert.doesNotThrow(() => validateMcpOAuthEndpoints({ url: 'https://owned.example/mcp' }, 'https://owned.example', { issuer: 'https://owned.example', authorization_endpoint: 'https://owned.example/authorize', token_endpoint: 'https://owned.example/token', response_types_supported: ['code'] }));
});

test('preset API applies official defaults, rejects caller endpoint exceptions, and keeps research separate from support', async t => {
  const r = await createRuntime({ dataDir: tempDir('mcp-preset'), port: 0, vault: new TestVault(), evidenceMode: 'mock' });
  try {
    const cookie = await runtimeLogin(r), body = { name: preset.name, url: preset.url, tools: [...preset.defaultTools], presetId: preset.id };
    const catalog = await runtimeApi(r, '/api/mcp/providers', 'GET', undefined, cookie); assert.equal(catalog.status, 200); assert.deepEqual(await catalog.json(), mcpProviders);
    const agent = r.engine.createClient({ name: 'Agent', allowedActions: ['kakao.map.places'] });
    assert.equal((await runtimeApi(r, '/api/mcp/providers', 'GET', undefined, '', { Authorization: `Bearer ${agent.token}` })).status, 403);
    for (const changed of [{ url: 'https://evil.example/mcp' }, { url: `${preset.url}/extra` }, { oauth: { issuerUrl: 'https://evil.example' } }]) {
      const result = await runtimeApi(r, '/api/remotes/oauth/start', 'POST', { ...body, ...changed }, cookie); assert.equal(result.status, 409); assert.equal((await result.json()).error.code, 'OAUTH_PRESET');
    }
    for (const changed of [{ presetId: 'daangn-ads' }, { allowedEndpoints: ['https://evil.example/token'] }, { oauth: { tokenEndpoint: 'https://evil.example/token' } }]) assert.equal((await runtimeApi(r, '/api/remotes/oauth/start', 'POST', { ...body, ...changed }, cookie)).status, 400);
    assert.equal(r.remote.list().length, 0);
    // Isolate registration/configuration tests from the live provider. This does not test a real Toss login.
    const started = t.mock.method(r.remote.oauth, 'start', async (id: string) => {
      const server = r.store.get<{ sealed: string; url: string; presetId: string }>('remote', id)!;
      const config = JSON.parse((await r.engine.vault.open(server.sealed)).oauth!).config;
      assert.equal(server.presetId, preset.id); assert.equal(server.url, preset.url); assert.deepEqual(config, preset.oauth);
      return { remoteId: id, url: `${preset.endpoints.authorization}?client_id=${config.clientId}`, redirectUri: `${r.baseUrl}/mcp/oauth/callback`, expiresAt: Date.now() + 600000 };
    });
    const prepared = await runtimeApi(r, '/api/remotes/oauth/start', 'POST', body, cookie); assert.equal(prepared.status, 200); assert.equal(started.mock.callCount(), 1);
    assert.equal(r.remote.list()[0]!.presetId, preset.id); assert.equal(r.remote.list()[0]!.authStatus, 'awaiting_auth');
    assert.equal(r.engine.accounts().length, 0); assert.equal(r.engine.discover(admin).filter(action => action.method === 'mcp' && action.origin === 'user').length, 0); assert.equal(r.engine.metrics().verifiedServices, 0);
    await r.remote.remove((await prepared.json()).remoteId);
  } finally { await r.close(); }
});

test('root OAuth resource identifiers are preserved through owned login, refresh and approved execution', async () => {
  const p = await ownedOAuth(), r = await createRuntime({ dataDir: tempDir('mcp-root-resource'), port: 0, vault: new TestVault(), evidenceMode: 'mock' });
  try {
    p.flags.rootResource = true; const cookie = await runtimeLogin(r);
    const response = await runtimeApi(r, '/api/remotes/oauth/start', 'POST', { name: '루트 리소스', url: p.url, tools: ['echo'] }, cookie); assert.equal(response.status, 200);
    const flow = await response.json(), authorization = new URL(flow.url); assert.equal(authorization.searchParams.get('resource'), p.baseUrl);
    const target = await authorizeOwned(flow.url); assert.equal((await runtimeApi(r, target.pathname + target.search, 'GET', undefined, response.headers.get('set-cookie')!.split(';')[0])).status, 200);
    assert.equal((await runtimeApi(r, `/api/remotes/${flow.remoteId}/oauth/refresh`, 'POST', {}, cookie)).status, 200);
    assert.equal(p.record.tokens.length, 2); assert(p.record.tokens.every(record => record.resource === p.baseUrl));
    const account = r.engine.accounts()[0]!, job = r.engine.create(admin, { actionId: `mcp.${flow.remoteId}.echo`, accountId: account.id, input: { message: '루트 리소스 승인' }, idempotencyKey: randomUUID() });
    assert.equal(job.state, 'pending_approval'); assert.equal(p.record.calls, 0); r.engine.approve(admin, job.id, job.revision, r.engine.digest(job)); await r.engine.idle();
    assert.equal(r.engine.get(admin, job.id).state, 'succeeded'); assert.equal(p.record.calls, 1); assert.equal(r.engine.metrics().verifiedServices, 0);
  } finally { await r.close(); await p.close(); }
});
