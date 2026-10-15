import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { createRuntime } from '../src/http.js';
import { admin } from '../src/core/engine.js';
import { hash } from '../src/core/security.js';
import { oauthFetch, oauthUrl, publicOAuthAddress } from '../src/core/mcp-oauth-network.js';
import type { RemoteServer } from '../src/types.js';
import { TestVault, tempDir } from './helpers.js';
import { ownedOAuth, runtimeApi, runtimeLogin, authorizeOwned } from './mcp-oauth-fixture.js';

type Runtime = Awaited<ReturnType<typeof createRuntime>>;
type Provider = Awaited<ReturnType<typeof ownedOAuth>>;
async function setup() {
  const p = await ownedOAuth(), vault = new TestVault(), dataDir = tempDir('mcp-oauth');
  const r = await createRuntime({ dataDir, vault, port: 0, evidenceMode: 'mock' });
  const cookie = await runtimeLogin(r); return { r, p, vault, dataDir, cookie };
}
async function start(r: Runtime, p: Provider, cookie: string, id?: string, oauth: Record<string, string> = {}) {
  const response = await runtimeApi(r, id ? `/api/remotes/${id}/oauth/start` : '/api/remotes/oauth/start', 'POST', id ? {} : { name: '시험 MCP', url: p.url, tools: ['echo'], oauth }, cookie);
  assert.equal(response.status, 200, await response.clone().text());
  const info = await response.json(); return { ...info, binding: response.headers.get('set-cookie')!.split(';')[0]!, cookieHeader: response.headers.get('set-cookie')! } as { remoteId: string; url: string; redirectUri: string; expiresAt: number; binding: string; cookieHeader: string };
}
async function finish(r: Runtime, flow: Awaited<ReturnType<typeof start>>, approved = true, cookie = flow.binding) {
  const target = await authorizeOwned(flow.url, approved);
  return runtimeApi(r, `${target.pathname}${target.search}`, 'GET', undefined, cookie);
}
function remote(r: Runtime, id: string) { return r.store.get<RemoteServer>('remote', id)!; }
function expire(r: Runtime, id: string) { r.store.put('remote', id, { ...remote(r, id), oauthExpiresAt: Date.now() - 1 }); }
function request(r: Runtime, id: string, principal = admin) { return r.engine.create(principal, { actionId: `mcp.${id}.echo`, accountId: remote(r, id).accountId, input: { message: '승인한 작업' }, idempotencyKey: randomUUID() }); }
async function approve(r: Runtime, job: ReturnType<typeof request>) { r.engine.approve(admin, job.id, job.revision, r.engine.digest(job)); await r.engine.idle(); return r.engine.get(admin, job.id); }

test('MCP OAuth binds PKCE to browser/session, imports selected tools, and requires account grants and approval', async () => {
  const { r, p, cookie, vault, dataDir } = await setup();
  try {
    const flow = await start(r, p, cookie), url = new URL(flow.url);
    assert.equal(url.searchParams.get('code_challenge_method'), 'S256'); assert.equal(url.searchParams.get('resource'), p.url);
    assert(flow.cookieHeader.includes('HttpOnly')); assert(flow.cookieHeader.includes('SameSite=Lax')); assert(flow.cookieHeader.includes('Path=/mcp/oauth/callback'));
    assert.equal(p.record.registrations.length, 1); assert.deepEqual(p.record.registrations[0]!.redirect_uris, [flow.redirectUri]);
    const pending = r.store.list<{sealed:string}>('remote-oauth-flow')[0]!, proof = await vault.open(pending.sealed);
    const pendingFiles = Buffer.concat(readdirSync(dataDir).filter(name => name.includes('sqlite')).map(name => readFileSync(join(dataDir, name))));
    assert(!pendingFiles.includes(Buffer.from(proof.verifier!))); assert(!pendingFiles.includes(Buffer.from(url.searchParams.get('state')!)));
    const target = await authorizeOwned(flow.url), path = target.pathname + target.search;
    assert.equal((await runtimeApi(r, path)).status, 400);
    assert.equal((await runtimeApi(r, path, 'GET', undefined, `${flow.binding}; koreai_session=another-session`)).status, 400);
    assert.equal(p.record.tokens.length, 0); assert.equal(r.store.list('remote-oauth-flow').length, 1);
    // A cross-site callback omits the Strict admin cookie; the Lax proof plus live owner session suffices.
    const done = await runtimeApi(r, path, 'GET', undefined, flow.binding); assert.equal(done.status, 200, await done.clone().text());
    assert.equal((await runtimeApi(r, path, 'GET', undefined, flow.binding)).status, 400); assert.equal(p.record.tokens.length, 1);
    const server = remote(r, flow.remoteId), actionId = `mcp.${server.id}.echo`;
    assert.equal(server.authStatus, 'connected'); assert.equal(server.tools.length, 1); assert.equal(server.tools[0]!.name, 'echo'); assert(server.accountId);
    assert.equal(r.remote.list()[0]!.oauthPending, false);
    const allowed = r.engine.createClient({ name: 'Allowed agent', allowedActions: [actionId], allowedAccountIds: [server.accountId] });
    const restricted = r.engine.createClient({ name: 'Without account', allowedActions: [actionId] });
    assert.throws(() => request(r, server.id, r.engine.authenticate(restricted.token)!));
    assert.equal((await runtimeApi(r, '/api/remotes/oauth/start', 'POST', {}, '', { Authorization: `Bearer ${allowed.token}` })).status, 403);
    assert.equal((await runtimeApi(r, '/api/accounts', 'POST', { id: server.accountId, credentialType: `mcp-oauth-${server.id}` }, cookie)).status, 409);
    const job = request(r, server.id, r.engine.authenticate(allowed.token)!); assert.equal(job.state, 'pending_approval'); assert.equal(p.record.calls, 0);
    const result = await approve(r, job); assert.equal(result.state, 'succeeded', JSON.stringify(result.error)); assert.equal(p.record.calls, 1);
    const repeated = r.engine.create(r.engine.authenticate(allowed.token)!, { actionId, accountId: server.accountId, input: job.input, idempotencyKey: job.idempotencyKey }); assert.equal(repeated.id, job.id); assert.equal(p.record.calls, 1);
    const publicData = JSON.stringify({ done: await done.text(), state: await (await runtimeApi(r, '/api/state', 'GET', undefined, cookie)).json(), job: result });
    const files = Buffer.concat(readdirSync(dataDir).filter(name => name.includes('sqlite')).map(name => readFileSync(join(dataDir, name))));
    for (const secret of p.secrets()) { assert(!publicData.includes(secret)); assert(!files.includes(Buffer.from(secret))); }
    assert((await vault.open(server.sealed)).oauth); assert.equal(r.engine.metrics().verifiedServices, 0);
  } finally { await r.close(); await p.close(); }
});

test('MCP OAuth refresh coalesces expired requests, rotates tokens and preserves an omitted refresh token', async () => {
  const { r, p, cookie } = await setup();
  try {
    const flow = await start(r, p, cookie); assert.equal((await finish(r, flow)).status, 200);
    const accountId = remote(r, flow.remoteId).accountId; expire(r, flow.remoteId);
    const jobs = [request(r, flow.remoteId), request(r, flow.remoteId)];
    for (const job of jobs) r.engine.approve(admin, job.id, job.revision, r.engine.digest(job)); await r.engine.idle();
    assert(jobs.every(job => r.engine.get(admin, job.id).state === 'succeeded')); assert.equal(p.record.calls, 2);
    assert.equal(p.record.tokens.filter(body => body.grant_type === 'refresh_token').length, 1); assert.equal(remote(r, flow.remoteId).accountId, accountId);
    p.flags.omitRefresh = true;
    for (let i = 0; i < 2; i++) { expire(r, flow.remoteId); assert.equal((await approve(r, request(r, flow.remoteId))).state, 'succeeded'); }
    const refresh = p.record.tokens.filter(body => body.grant_type === 'refresh_token');
    assert.equal(refresh.length, 3); assert.notEqual(refresh[0]!.refresh_token, refresh[1]!.refresh_token); assert.equal(refresh[1]!.refresh_token, refresh[2]!.refresh_token);
  } finally { await r.close(); await p.close(); }
});

test('refresh failure waits before dispatch, manual recovery requires approval, and a tool 401 is never replayed', async () => {
  const { r, p, cookie } = await setup();
  try {
    const flow = await start(r, p, cookie); assert.equal((await finish(r, flow)).status, 200);
    p.flags.rejectRefresh = true; expire(r, flow.remoteId);
    const job = await approve(r, request(r, flow.remoteId)); assert.equal(job.state, 'awaiting_auth'); assert.equal(job.dispatched, false); assert.equal(p.record.calls, 0);
    assert.equal(remote(r, flow.remoteId).authStatus, 'awaiting_auth'); assert.equal(r.engine.accounts()[0]!.enabled, false);
    p.flags.rejectRefresh = false;
    assert.equal((await runtimeApi(r, `/api/remotes/${flow.remoteId}/oauth/refresh`, 'POST', {}, cookie)).status, 200); assert.equal(p.record.calls, 0);
    const resumed = r.engine.resume(admin, job.id); assert.equal(resumed.state, 'pending_approval'); assert.equal(p.record.calls, 0);
    assert.equal((await approve(r, resumed)).state, 'succeeded');
    p.flags.toolUnauthorized = true; const before = p.record.tokens.length;
    const uncertain = await approve(r, request(r, flow.remoteId)); assert.equal(uncertain.state, 'needs_review'); assert.equal(uncertain.dispatched, true); assert.equal(p.record.calls, 2); assert.equal(p.record.tokens.length, before);
    assert.throws(() => r.engine.resume(admin, uncertain.id)); assert(!JSON.stringify(uncertain).includes('owned-access-private-'));
  } finally { await r.close(); await p.close(); }
});

test('MCP initialization auth failure does not dispatch, and re-login drops the previous account grants', async () => {
  const { r, p, cookie } = await setup();
  try {
    const flow = await start(r, p, cookie); assert.equal((await finish(r, flow)).status, 200);
    const oldId = remote(r, flow.remoteId).accountId!, actionId = `mcp.${flow.remoteId}.echo`;
    const c = r.engine.createClient({ name: 'Old account agent', allowedActions: [actionId], allowedAccountIds: [oldId] });
    p.flags.rejectInitialize = true;
    const blocked = await approve(r, request(r, flow.remoteId)); assert.equal(blocked.state, 'awaiting_auth'); assert.equal(blocked.dispatched, false); assert.equal(p.record.calls, 0);
    p.flags.rejectInitialize = false;
    const again = await start(r, p, cookie, flow.remoteId); assert.equal((await finish(r, again)).status, 200);
    assert.notEqual(remote(r, flow.remoteId).accountId, oldId); assert(!r.engine.accounts().some(account => account.id === oldId));
    assert.throws(() => request(r, flow.remoteId, r.engine.authenticate(c.token)!)); assert.equal(p.record.registrations.length, 1);
    const pending = request(r, flow.remoteId);
    assert.equal((await runtimeApi(r, `/api/accounts/${remote(r, flow.remoteId).accountId}`, 'DELETE', undefined, cookie)).status, 200);
    assert.equal(r.engine.get(admin, pending.id).state, 'cancelled'); assert.equal(remote(r, flow.remoteId).enabled, false); assert.equal(r.engine.accounts().length, 0);
    assert.deepEqual(await r.engine.vault.open(remote(r, flow.remoteId).sealed), {});
    assert.equal((await runtimeApi(r, `/api/remotes/${flow.remoteId}/oauth/refresh`, 'POST', {}, cookie)).status, 409);
  } finally { await r.close(); await p.close(); }
});

test('denied, cancelled, expired, foreign-issuer and logged-out callbacks never exchange a code', async () => {
  const { r, p, cookie } = await setup();
  try {
    const first = await start(r, p, cookie); assert.equal((await finish(r, first, false)).status, 400); assert.equal(r.store.list('remote-oauth-flow').length, 0);
    const cancelled = await start(r, p, cookie, first.remoteId); assert.equal((await runtimeApi(r, `/api/remotes/${first.remoteId}/oauth/cancel`, 'POST', {}, cookie)).status, 200); assert.equal((await finish(r, cancelled)).status, 400);
    const expired = await start(r, p, cookie, first.remoteId), key = hash(new URL(expired.url).searchParams.get('state')!);
    r.store.put('remote-oauth-flow', key, { ...r.store.get<object>('remote-oauth-flow', key), expiresAt: Date.now() - 1 }); assert.equal((await finish(r, expired)).status, 400);
    const mixed = await start(r, p, cookie, first.remoteId), target = await authorizeOwned(mixed.url); target.searchParams.set('iss', 'https://evil.example');
    assert.equal((await runtimeApi(r, target.pathname + target.search, 'GET', undefined, mixed.binding)).status, 400);
    const loggedOut = await start(r, p, cookie, first.remoteId); assert.equal((await runtimeApi(r, '/api/logout', 'POST', {}, cookie)).status, 200); assert.equal((await finish(r, loggedOut)).status, 400);
    assert.equal(p.record.tokens.length, 0); assert.equal(p.record.calls, 0); assert.equal(r.engine.accounts().length, 0);
  } finally { await r.close(); await p.close(); }
});

test('pending login, encrypted refresh grants and disconnected history survive runtime restarts', async () => {
  const initial = await setup(); const { p, cookie, vault, dataDir } = initial; let r = initial.r;
  try {
    const flow = await start(r, p, cookie), port = Number(new URL(r.baseUrl).port);
    await r.close(); r = await createRuntime({ dataDir, vault, port, evidenceMode: 'mock' });
    assert.equal((await finish(r, flow)).status, 200); const accountId = remote(r, flow.remoteId).accountId;
    await r.close(); r = await createRuntime({ dataDir, vault, port, evidenceMode: 'mock' });
    expire(r, flow.remoteId); const result = await approve(r, request(r, flow.remoteId)); assert.equal(result.state, 'succeeded'); assert.equal(remote(r, flow.remoteId).accountId, accountId);
    assert.equal(p.record.tokens.filter(body => body.grant_type === 'refresh_token').length, 1);
    await r.remote.remove(flow.remoteId); await r.close(); r = await createRuntime({ dataDir, vault, port, evidenceMode: 'mock' });
    const history = await runtimeApi(r, `/api/jobs/${result.id}`, 'GET', undefined, cookie); assert.equal(history.status, 200);
    const saved = await history.json(); assert.equal(saved.state, 'succeeded'); assert.equal(saved.approvalDigest, null); assert.equal(p.record.calls, 1);
  } finally { await r.close(); await p.close(); }
});

test('pre-registered confidential clients use pinned issuer, canonical HTTPS callback and encrypted secrets', async () => {
  const p = await ownedOAuth(), origin = 'https://personal-vm.example.ts.net';
  const r = await createRuntime({ dataDir: tempDir('mcp-public'), port: 0, vault: new TestVault(), publicUrl: origin, evidenceMode: 'mock' });
  try {
    p.flags.noChallengeScope = true;
    const cookie = await runtimeLogin(r, origin), value = { name: '사전 등록', url: p.url, tools: ['echo'], oauth: { clientId: 'fixed-client', clientSecret: p.clientSecret, issuerUrl: p.baseUrl } };
    assert.equal((await runtimeApi(r, '/api/remotes/oauth/start', 'POST', value, cookie)).status, 409);
    const result = await runtimeApi(r, '/api/remotes/oauth/start', 'POST', value, cookie, {}, origin); assert.equal(result.status, 200, await result.clone().text());
    const info = await result.json(); assert.equal(info.redirectUri, `${origin}/mcp/oauth/callback`); assert(result.headers.get('set-cookie')!.includes('Secure'));
    assert.equal(new URL(info.url).searchParams.get('scope'), null); // Never request every advertised scope by default.
    const target = await authorizeOwned(info.url); assert.equal((await runtimeApi(r, target.pathname + target.search, 'GET', undefined, result.headers.get('set-cookie')!.split(';')[0], {}, origin)).status, 200);
    assert.equal(p.record.registrations.length, 0); assert.equal(p.record.tokens.length, 1);
    assert(!JSON.stringify(r.remote.list()).includes(p.clientSecret)); assert(!JSON.stringify(r.store.list('remote')).includes(p.clientSecret));
    const malformed = { ...value, oauth: { clientId: 'fixed-client', clientSecret: p.clientSecret } };
    assert.equal((await runtimeApi(r, '/api/remotes/oauth/start', 'POST', malformed, cookie, {}, origin)).status, 400);
  } finally { await r.close(); await p.close(); }
});

test('unsafe metadata, endpoint redirects and oversized OAuth responses fail without tool execution', async () => {
  const { r, p, cookie } = await setup();
  try {
    for (const flag of ['foreignResource', 'foreignIssuer', 'foreignEndpoint', 'noPkce', 'redirectRegistration', 'oversized'] as const) {
      p.flags[flag] = true;
      const result = await runtimeApi(r, '/api/remotes/oauth/start', 'POST', { name: '거절할 서버', url: p.url, tools: ['echo'] }, cookie);
      assert.equal(result.status, 409, `${flag}: ${await result.clone().text()}`); p.flags[flag] = false; assert.equal(r.remote.list().length, 0);
    }
    const flow = await start(r, p, cookie); p.flags.redirectToken = true;
    const done = await finish(r, flow); assert.equal(done.status, 400); assert(!(await done.text()).includes(p.clientSecret));
    assert.equal(r.engine.accounts().length, 0); assert.equal(p.record.calls, 0);
    await r.remote.remove(flow.remoteId); assert.deepEqual(await r.engine.vault.open(remote(r, flow.remoteId).sealed), {});
  } finally { await r.close(); await p.close(); }
});

test('OAuth network blocks private and special addresses, non-HTTPS URLs and other loopback origins', async () => {
  for (const ip of ['127.0.0.1', '10.0.0.1', '169.254.169.254', '100.64.0.1', '192.168.1.1', '224.0.0.1', '0.0.0.0', '::1', '::ffff:127.0.0.1', 'fc00::1', 'fe80::1', '2001:db8::1', '2002:7f00:1::']) assert.equal(publicOAuthAddress(ip), false, ip);
  for (const ip of ['8.8.8.8', '1.1.1.1', '2606:4700:4700::1111']) assert.equal(publicOAuthAddress(ip), true, ip);
  for (const value of ['http://example.com', 'file:///etc/passwd', 'https://key@example.com', 'https://example.com?secret=x', 'https://example.com/#x']) assert.throws(() => oauthUrl(value));
  const network = oauthFetch('http://127.0.0.1:1234/mcp');
  await assert.rejects(() => network('https://169.254.169.254/latest/meta-data')); await assert.rejects(() => network('http://127.0.0.1:1235/token'));
});
