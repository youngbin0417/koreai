import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { request as httpRequest } from 'node:http';
import { createRuntime } from '../src/http.js';
import { publicOrigin, serverOptions } from '../src/core/platform.js';
import { admin } from '../src/core/engine.js';
import { TestVault, tempDir, providerMock, fakeSecrets } from './helpers.js';
import type { ChatMessage, ToolCall } from '../src/ai/deepseek.js';

type Runtime = Awaited<ReturnType<typeof createRuntime>>;
const key = 'sk-mobile-unit-private-123456789';
const external = 'https://koreai.personal.ts.net';
const answer = (content: string | null, calls?: ToolCall[]) => Response.json({ model: 'deepseek-flash', choices: [{ finish_reason: calls?.length ? 'tool_calls' : 'stop', message: { role: 'assistant', content, reasoning_content: 'internal private reasoning', ...(calls ? { tool_calls: calls } : {}) } }] });
const tool = (name: string, args: unknown): ToolCall => ({ id: randomUUID(), type: 'function', function: { name, arguments: JSON.stringify(args) } });
function api(r: Runtime, path: string, cookie = '', method = 'GET', body?: unknown, origin = r.baseUrl, extra: Record<string, string> = {}) {
  const headers = { Origin: origin, ...(origin === external ? { Host: new URL(external).host } : {}), ...(cookie ? { Cookie: cookie } : {}), ...extra, ...(body === undefined ? {} : { 'Content-Type': 'application/json' }) };
  // Native fetch can discard a custom Host; use an actual proxy-style HTTP request.
  if (origin === external || extra.Host) return new Promise<Response>((resolve, reject) => {
    const pending = httpRequest(`${r.baseUrl}/api${path}`, { method, headers }, response => {
      const chunks: Buffer[] = []; response.on('data', chunk => chunks.push(chunk)); response.on('end', () => {
        const received = new Headers(); for (const [name, value] of Object.entries(response.headers)) if (value) { for (const part of Array.isArray(value) ? value : [value]) received.append(name, part); }
        resolve(new Response(Buffer.concat(chunks), { status: response.statusCode, headers: received }));
      });
    });
    pending.on('error', reject); pending.end(body === undefined ? undefined : JSON.stringify(body));
  });
  return fetch(`${r.baseUrl}/api${path}`, { method, headers, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
}
async function login(r: Runtime, origin = r.baseUrl) {
  const response = await api(r, '/bootstrap', '', 'POST', { code: r.bootstrapCode }, origin);
  assert.equal(response.status, 200); return response.headers.get('set-cookie')!;
}
const cookiePart = (cookie: string) => cookie.split(';')[0]!;
async function configure(r: Runtime, cookie: string) {
  const response = await api(r, '/ai/key', cookie, 'POST', { apiKey: key });
  assert.equal(response.status, 200); assert.deepEqual(await response.json(), { configured: true, model: 'deepseek-flash', keySource: 'encrypted-file' });
}
async function createChat(r: Runtime, cookie: string, allowedActions: string[] = []) {
  const response = await api(r, '/chats', cookie, 'POST', { allowedActions });
  assert.equal(response.status, 201); return response.json();
}
const send = (r: Runtime, cookie: string, id: string, content: string, requestId = randomUUID()) => api(r, `/chats/${id}/messages`, cookie, 'POST', { requestId, content });

test('remote configuration permits a single HTTPS origin and rejects unsafe URLs', () => {
  assert.equal(publicOrigin(`${external}/`), external);
  assert.equal(serverOptions([], { KOREAI_PUBLIC_URL: external }, 'linux').publicUrl, external);
  for (const url of ['http://host', 'https://user:pass@host', `${external}/subpath`, `${external}?secret=1`, `${external}#test`]) assert.throws(() => publicOrigin(url));
});

test('remote secure login survives restart, enforces Host/Origin and keeps agents away from chats and keys', async () => {
  const vault = new TestVault(), dataDir = tempDir('remote-login');
  let r = await createRuntime({ dataDir, port: 0, vault, publicUrl: external, evidenceMode: 'mock' });
  try {
    const setCookie = await login(r, external), cookie = cookiePart(setCookie);
    assert(setCookie.includes('Secure')); assert(setCookie.includes('HttpOnly')); assert(setCookie.includes('SameSite=Strict'));
    const stateResponse = await api(r, '/state', cookie, 'GET', undefined, external); assert.equal(stateResponse.status, 200);
    const state = await stateResponse.json(); assert.equal(state.oauthRedirectUri, `${external}/oauth/callback`); assert.equal(state.mcpConfig.env.KOREAI_URL, r.baseUrl);
    assert.equal((await api(r, '/state', cookie, 'GET', undefined, 'https://evil.example')).status, 403);
    assert.equal((await api(r, '/state', cookie, 'GET', undefined, external, { Host: 'evil.example', 'X-Forwarded-Host': new URL(external).host })).status, 403);
    assert.equal((await fetch(`${r.baseUrl}/api/chats`, { method: 'POST', headers: { Cookie: cookie, 'Content-Type': 'application/json' }, body: '{}' })).status, 403);
    const client = r.engine.createClient({ name: 'scoped client', allowedActions: ['kma.observation'], allowedAccountIds: [] });
    assert.equal((await api(r, '/chats', '', 'GET', undefined, external, { Authorization: `Bearer ${client.token}` })).status, 403);
    assert.equal((await api(r, '/ai/key', '', 'POST', { apiKey: key }, external, { Authorization: `Bearer ${client.token}` })).status, 403);
    assert(!JSON.stringify(r.store.list('web-session')).includes(cookie));
    await r.close(); r = await createRuntime({ dataDir, port: 0, vault, publicUrl: external, evidenceMode: 'mock' });
    assert.equal((await api(r, '/state', cookie, 'GET', undefined, external)).status, 200);
    assert.equal((await api(r, '/logout', cookie, 'POST', {}, external)).status, 200);
    assert.equal((await api(r, '/state', cookie, 'GET', undefined, external)).status, 401);
  } finally { await r.close(); }
});

test('plain chat uses encrypted Flash credentials, hides reasoning and secrets, and persists with idempotency', async () => {
  const requests: Record<string, any>[] = [], vault = new TestVault(), dataDir = tempDir('plain-chat');
  const aiFetcher: typeof fetch = async (_url, init) => { assert.equal(new Headers(init?.headers).get('Authorization'), `Bearer ${key}`); requests.push(JSON.parse(String(init?.body))); return answer(`안녕하세요 ${key}`); };
  let r = await createRuntime({ dataDir, port: 0, vault, aiFetcher, evidenceMode: 'mock' });
  try {
    const cookie = cookiePart(await login(r)); await configure(r, cookie); const chat = await createChat(r, cookie), requestId = randomUUID();
    assert.equal((await send(r, cookie, chat.id, '도와줘', requestId)).status, 202); await r.chats.idle();
    const result = await (await api(r, `/chats/${chat.id}`, cookie)).json();
    assert.equal(result.status, 'ready'); assert.equal(result.messages[1].content, '안녕하세요 [REDACTED]');
    assert.equal(requests[0]!.model, 'deepseek-flash'); assert.equal(requests[0]!.tools, undefined);
    assert(!JSON.stringify(result).includes(key)); assert(!JSON.stringify(result).includes('internal private reasoning'));
    assert.equal(result.protocol, undefined); assert.equal(result.sealed, undefined);
    assert(!readFileSync(join(dataDir, 'deepseek.secret.json'), 'utf8').includes(key));
    await r.close(); r = await createRuntime({ dataDir, port: 0, vault, aiFetcher, evidenceMode: 'mock' });
    assert.equal((await (await api(r, `/chats/${chat.id}`, cookie)).json()).messages.length, 2);
    assert.equal((await send(r, cookie, chat.id, '도와줘', requestId)).status, 202); await r.chats.idle(); assert.equal(requests.length, 1);
    assert.equal((await send(r, cookie, chat.id, 'changed', requestId)).status, 409);
  } finally { await r.close(); }
});

test('chat requests serialize through lost responses and cannot activate unavailable actions', async () => {
  let release: (() => void) | undefined, calls = 0; const gate = new Promise<void>(resolve => { release = resolve; });
  const r = await createRuntime({ dataDir: tempDir('chat-race'), port: 0, vault: new TestVault(), evidenceMode: 'mock', aiFetcher: async () => { calls++; await gate; return answer('완료'); } });
  try {
    const cookie = cookiePart(await login(r)); await configure(r, cookie);
    assert.equal((await api(r, '/chats', cookie, 'POST', { allowedActions: ['kma.observation'] })).status, 409);
    assert.equal((await api(r, '/chats', cookie, 'POST', { allowedActions: ['unknown'] })).status, 409);
    const chat = await createChat(r, cookie), requestId = randomUUID();
    assert.equal((await send(r, cookie, chat.id, '동시 요청', requestId)).status, 202);
    assert.equal((await send(r, cookie, chat.id, '동시 요청', requestId)).status, 202);
    assert.equal((await send(r, cookie, chat.id, '다른 메시지')).status, 409);
    release!(); await r.chats.idle(); assert.equal(calls, 1); assert.equal(r.chats.get(chat.id).messages.length, 2);
  } finally { release!(); await r.close(); }
});

test('chat writes wait for approval, continue existing jobs, reject foreign jobs and deduplicate after restart', async () => {
  const provider = providerMock(), vault = new TestVault(), dataDir = tempDir('chat-approval');
  let knownJob = '', mode = 'execute';
  const aiFetcher: typeof fetch = async (_url, init) => {
    const body = JSON.parse(String(init?.body)); assert.equal(body.model, 'deepseek-flash');
    const last = (body.messages as ChatMessage[]).at(-1)!;
    if (last.role === 'tool') { const result = JSON.parse(last.content!); if (result.id) knownJob = result.id; return answer(result.error ? '조회 권한을 확인하세요.' : '작업 상태를 확인했습니다.'); }
    return answer(null, [mode === 'execute' ? tool('koreai_execute', { actionId: 'band.publish', input: { bandKey: 'band_1', content: '승인할 글' } }) : tool('koreai_get_job', { jobId: knownJob })]);
  };
  let r = await createRuntime({ dataDir, port: 0, vault, fetcher: provider.fetcher, aiFetcher, evidenceMode: 'mock' });
  try {
    const cookie = cookiePart(await login(r)); await configure(r, cookie);
    const account = await r.engine.saveAccount({ label: '밴드 시험', credentialType: 'band-user', allowedActions: ['band.publish'], secrets: { accessToken: fakeSecrets.accessToken } });
    const chat = await createChat(r, cookie, ['band.publish']); await send(r, cookie, chat.id, '글을 작성해줘'); await r.chats.idle(); await r.engine.idle();
    assert.equal(provider.requests.length, 0); assert.equal(r.chats.get(chat.id).jobIds.length, 1);
    const job = r.engine.get(admin, knownJob); assert.equal(job.state, 'pending_approval'); assert.equal(job.accountId, account.id);
    const agent = r.engine.createClient({ name: 'no approval', allowedActions: ['band.publish'], allowedAccountIds: [account.id] });
    assert.equal((await api(r, `/jobs/${job.id}/approve`, '', 'POST', { revision: job.revision, digest: r.engine.digest(job) }, r.baseUrl, { Authorization: `Bearer ${agent.token}` })).status, 403);
    assert.equal((await api(r, `/jobs/${job.id}/approve`, cookie, 'POST', { revision: job.revision, digest: r.engine.digest(job) })).status, 200);
    await r.engine.idle(); assert.equal(provider.requests.length, 1);
    await r.close(); r = await createRuntime({ dataDir, port: 0, vault, fetcher: provider.fetcher, aiFetcher, evidenceMode: 'mock' });
    mode = 'status'; await send(r, cookie, chat.id, '결과 확인'); await r.chats.idle(); assert.equal(r.chats.get(chat.id).status, 'ready');
    mode = 'execute'; await send(r, cookie, chat.id, '같은 글 확인'); await r.chats.idle(); await r.engine.idle(); assert.equal(provider.requests.length, 1); assert.equal(r.chats.get(chat.id).jobIds.length, 1);
    const other = await createChat(r, cookie, ['band.publish']); mode = 'foreign'; await send(r, cookie, other.id, '다른 대화의 결과'); await r.chats.idle(); assert.equal(r.chats.get(other.id).jobIds.length, 0);
    assert(r.store.get<{ protocol: ChatMessage[] }>('chat', other.id)!.protocol.some(message => message.role === 'tool' && message.content?.includes('생성한 작업만')));
    assert.equal(r.engine.metrics().verifiedServices, 0);
  } finally { await r.close(); }
});

test('server stop preserves interrupted chats without revealing keys or silently rerunning them', async () => {
  const vault = new TestVault(), dataDir = tempDir('chat-interrupted'); let started: (() => void) | undefined; const ready = new Promise<void>(resolve => { started = resolve; });
  const aiFetcher: typeof fetch = async (_url, init) => new Promise((_resolve, reject) => { started!(); init?.signal?.addEventListener('abort', () => reject(new Error(key)), { once: true }); });
  let r = await createRuntime({ dataDir, port: 0, vault, aiFetcher, evidenceMode: 'mock' });
  try {
    const cookie = cookiePart(await login(r)); await configure(r, cookie); const chat = await createChat(r, cookie), requestId = randomUUID();
    await send(r, cookie, chat.id, '응답 기다리기', requestId); await ready; await r.close(); r = await createRuntime({ dataDir, port: 0, vault, evidenceMode: 'mock' });
    assert.equal(r.chats.get(chat.id).status, 'interrupted'); assert(!JSON.stringify(r.chats.get(chat.id)).includes(key));
    assert.equal((await send(r, cookie, chat.id, '응답 기다리기', requestId)).status, 202); assert.equal(r.chats.get(chat.id).status, 'interrupted');
  } finally { await r.close(); }
});
