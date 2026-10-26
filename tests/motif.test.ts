import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { createRuntime } from '../src/http.js';
import { MotifClient, MotifError } from '../src/ai/motif.js';
import { MOTIF_BASE_URL, MOTIF_MODEL, PROVIDERS, environmentKey } from '../src/ai/providers.js';
import { TestVault, tempDir } from './helpers.js';

const key = 'morph-unit-private-key-1234567890';
const deepseekKey = 'sk-mobile-unit-private-123456789';
type Runtime = Awaited<ReturnType<typeof createRuntime>>;

function harness(response: () => Response | Promise<Response>) {
  const calls: { url: string; body: any; auth: string | null }[] = [];
  const fetcher: typeof fetch = async (url, init) => {
    calls.push({ url: String(url), body: init?.body ? JSON.parse(String(init.body)) : undefined, auth: new Headers(init?.headers).get('authorization') });
    return response();
  };
  return { calls, fetcher };
}
const completion = (message: unknown, finish = 'stop') => Response.json({ model: MOTIF_MODEL, choices: [{ finish_reason: finish, message }], usage: { total_tokens: 3 } });
const motifAnswer = (content: string) => Response.json({ model: MOTIF_MODEL, choices: [{ finish_reason: 'stop', message: { role: 'assistant', content } }] });
const deepseekAnswer = (content: string) => Response.json({ model: 'deepseek-flash', choices: [{ finish_reason: 'stop', message: { role: 'assistant', content, reasoning_content: 'internal private reasoning' } }] });

test('Motif client sends the documented Chat Completions body and keeps tool calling', async () => {
  const { calls, fetcher } = harness(() => completion({ role: 'assistant', content: 'MORPH_OK' }));
  const result = await new MotifClient(key, fetcher).chat([{ role: 'user', content: 'Hello, Morph!' }],
    [{ type: 'function', function: { name: 'ping', description: 'ping', parameters: { type: 'object', properties: {} } } }]);
  assert.equal(calls[0]!.url, `${MOTIF_BASE_URL}/chat/completions`);
  assert.equal(calls[0]!.auth, `Bearer ${key}`);
  assert.equal(calls[0]!.body.model, MOTIF_MODEL);
  assert.equal(calls[0]!.body.tool_choice, 'auto');
  assert.equal(calls[0]!.body.tools[0].function.name, 'ping');
  assert.equal(calls[0]!.body.stream, false);
  // DeepSeek-only reasoning controls must never be sent to Motif.
  assert.equal(Object.hasOwn(calls[0]!.body, 'thinking'), false);
  assert.equal(Object.hasOwn(calls[0]!.body, 'reasoning_effort'), false);
  assert.equal(result.requestedModel, MOTIF_MODEL);
  assert.equal(result.message.content, 'MORPH_OK');
});

test('Motif client preserves tool calls, drops replayed reasoning and redacts the key', async () => {
  const callId = 'chatcmpl-tool-123';
  const tools = harness(() => completion({ role: 'assistant', content: null, tool_calls: [{ id: callId, type: 'function', function: { name: 'koreai_execute', arguments: '{}' } }] }, 'tool_calls'));
  const result = await new MotifClient(key, tools.fetcher).chat([{ role: 'assistant', content: '이전', reasoning_content: 'secret reasoning' }, { role: 'user', content: '다음' }], []);
  assert.equal(tools.calls[0]!.body.messages[0].reasoning_content, undefined);
  assert.equal(tools.calls[0]!.body.messages[0].content, '이전');
  assert.equal(Object.hasOwn(tools.calls[0]!.body, 'tools'), false);
  assert.equal(result.message.tool_calls?.[0]?.id, callId);
  assert.equal(result.message.content, null);
  const echoed = harness(() => completion({ role: 'assistant', content: `키 ${key} 노출` }));
  const redacted = await new MotifClient(key, echoed.fetcher).chat([{ role: 'user', content: 'x' }], []);
  assert.equal(String(redacted.message.content).includes(key), false);
});

test('Motif errors stay controlled and never echo the provider payload', async () => {
  const unauthorized: typeof fetch = async () => new Response(JSON.stringify({ error: { message: `bad key ${key}` } }), { status: 401 });
  await assert.rejects(() => new MotifClient(key, unauthorized).chat([{ role: 'user', content: 'x' }], []),
    (error: unknown) => error instanceof MotifError && error.status === 401 && error.message === 'Motif API 키가 유효하지 않습니다.');
  const server: typeof fetch = async () => new Response('boom', { status: 500 });
  await assert.rejects(() => new MotifClient(key, server).verifyModel(), /HTTP 500/);
  const offline: typeof fetch = async () => { throw new Error(`network ${key}`); };
  await assert.rejects(() => new MotifClient(key, offline).verifyModel(), /Motif에 연결하지 못했습니다/);
});

test('Motif model verification requires the fixed model and environment keys are trimmed', async () => {
  const listed: typeof fetch = async () => Response.json({ object: 'list', data: [{ id: MOTIF_MODEL }] });
  assert.deepEqual(await new MotifClient(key, listed).verifyModel(), { id: MOTIF_MODEL, name: MOTIF_MODEL });
  const other: typeof fetch = async () => Response.json({ object: 'list', data: [{ id: 'motif/other' }] });
  await assert.rejects(() => new MotifClient(key, other).verifyModel(), /사용할 수 없습니다/);
  assert.equal(environmentKey('motif', { MORPH_API_KEY: '  trimmed  ' }), 'trimmed');
  assert.equal(environmentKey('motif', { MORPH_API_KEY: '   ' }), null);
  assert.equal(environmentKey('motif', {}), null);
  assert.equal(PROVIDERS.motif.model, MOTIF_MODEL);
  assert.equal(PROVIDERS.motif.keyEnv, 'MORPH_API_KEY');
  assert.equal(PROVIDERS.motif.environmentOnly, true);
});

test('each conversation pins its provider and legacy conversations stay on DeepSeek', async () => {
  const requests: { host: string; body: any }[] = [];
  const aiFetcher: typeof fetch = async (url, init) => {
    const body = JSON.parse(String(init?.body));
    requests.push({ host: new URL(String(url)).host, body });
    return new URL(String(url)).host === 'api-cbt.morphfactory.io' ? motifAnswer('모티프 응답') : deepseekAnswer('딥시크 응답');
  };
  const r = await createRuntime({ dataDir: tempDir('motif-chat'), port: 0, vault: new TestVault(), aiFetcher, evidenceMode: 'mock',
    environment: { MORPH_API_KEY: key, DEEPSEEK_API_KEY: deepseekKey } });
  const reply = async (chat: { id: string }, text: string) => {
    assert.equal(r.chats.submit(chat.id, { requestId: randomUUID(), content: text }).status, 'running');
    await r.chats.idle(); return r.chats.get(chat.id);
  };
  try {
    assert.deepEqual(r.chats.settings().providers.map(entry => [entry.id, entry.configured, entry.keySource]),
      [['deepseek', true, 'environment'], ['motif', true, 'environment']]);
    assert.equal(r.chats.settings().defaultProvider, 'deepseek');
    const motif = await r.chats.create({ provider: 'motif' });
    assert.equal(motif.provider, 'motif');
    assert.equal((await reply(motif, '안녕')).messages.at(-1)!.content, '모티프 응답');
    assert.equal(requests[0]!.host, 'api-cbt.morphfactory.io');
    assert.equal(requests[0]!.body.model, MOTIF_MODEL);
    const deepseek = await r.chats.create({});
    assert.equal(deepseek.provider, 'deepseek');
    await reply(deepseek, '안녕');
    assert.equal(requests[1]!.host, 'api.deepseek.com');
    assert.equal(requests[1]!.body.model, 'deepseek-flash');
    // The second Motif turn must not drift to the default provider.
    await reply(motif, '계속');
    assert.equal(requests[2]!.host, 'api-cbt.morphfactory.io');
    assert.deepEqual(requests[2]!.body.messages.map((message: { role: string }) => message.role), ['system', 'user', 'assistant', 'user']);
    assert.equal(JSON.stringify(r.store.list('chat')).includes(key), false);
    const legacy = 'legacy-providerless-chat';
    r.store.put('chat', legacy, { id: legacy, title: '이전 대화', allowedActions: [], status: 'ready', messages: [], jobIds: [],
      protocol: [{ role: 'system', content: 'system' }], requests: [], createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() });
    assert.equal(r.chats.get(legacy).provider, 'deepseek');
  } finally { await r.close(); }
});

test('a provider without its key fails closed instead of falling back to another model', async () => {
  const r = await createRuntime({ dataDir: tempDir('motif-nokey'), port: 0, vault: new TestVault(), evidenceMode: 'mock',
    environment: { DEEPSEEK_API_KEY: deepseekKey }, aiFetcher: async () => deepseekAnswer('ok') });
  try {
    assert.equal(r.chats.settings().providers.find(entry => entry.id === 'motif')!.configured, false);
    const chat = await r.chats.create({});
    assert.equal(chat.provider, 'deepseek');
    // A conversation may be prepared before its key exists, but it can never send.
    const motif = await r.chats.create({ provider: 'motif' });
    assert.equal(motif.provider, 'motif');
    assert.throws(() => r.chats.submit(motif.id, { requestId: randomUUID(), content: '안녕' }), /MORPH_API_KEY/);
    assert.equal(r.chats.get(motif.id).status, 'ready');
    await assert.rejects(() => r.chats.create({ provider: 'openai' }));
  } finally { await r.close(); }
});
