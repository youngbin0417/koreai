import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { DeepSeekCredentials } from '../src/ai/credentials.js';
import { DeepSeekClient, DeepSeekError } from '../src/ai/deepseek.js';
import { ProjectAgent } from '../src/ai/project-agent.js';
import type { ToolCall, ChatMessage } from '../src/ai/deepseek.js';
import { TestVault, tempDir } from './helpers.js';

test('DeepSeek credentials stay encrypted and load after restarting with the same vault', async () => {
  const root = tempDir('deepseek-key'), vault = new TestVault(), key = 'sk-unit-test-private-key-12345';
  const credentials = new DeepSeekCredentials(root, vault);
  await credentials.save(key);
  assert(!readFileSync(credentials.path, 'utf8').includes(key));
  assert.equal(await new DeepSeekCredentials(root, vault).load(), key);
  const value = JSON.parse(readFileSync(credentials.path, 'utf8'));
  value.model = 'deepseek-v4-pro'; writeFileSync(credentials.path, JSON.stringify(value));
  await assert.rejects(() => credentials.load(), /설정 형식/);
});

test('only Flash is requested; unavailable Flash and provider errors never trigger a fallback or expose keys', async () => {
  const requests: { url: string; init: RequestInit }[] = [], key = 'sk-test-secret-123456789';
  const fetcher: typeof fetch = async (url, init = {}) => {
    requests.push({ url: String(url), init });
    if (String(url).endsWith('/models')) return Response.json({ data: [{ id: 'deepseek-flash', name: 'DeepSeek-V4.1-Flash' }] });
    return Response.json({ status: 'completed', output: [{ type: 'message', content: [{ type: 'output_text', text: `OK ${key}` }] }] });
  };
  const client = new DeepSeekClient(key, fetcher);
  assert.equal((await client.verifyModel()).id, 'deepseek-flash');
  assert.equal((await client.respond('hello')).text, 'OK [REDACTED]');
  const body = JSON.parse(String(requests[1].init.body));
  assert.equal(body.model, 'deepseek-flash'); assert.equal(body.store, false);
  assert.equal(requests[1].url, 'https://api.deepseek.com/responses'); assert.equal(requests[1].init.redirect, 'error');
  const missing = new DeepSeekClient(key, async () => Response.json({ data: [{ id: 'deepseek-v4-pro' }] }));
  await assert.rejects(() => missing.verifyModel(), (e: unknown) => e instanceof DeepSeekError && e.code === 'MODEL_UNAVAILABLE');
  let calls = 0;
  const denied = new DeepSeekClient(key, async () => { calls++; return Response.json({ error: key }, { status: 401 }); });
  await assert.rejects(() => denied.respond('hello'), (e: unknown) => e instanceof DeepSeekError && e.status === 401 && !e.message.includes(key));
  assert.equal(calls, 1);
});

test('Chat tool calling pins Flash and preserves reasoning in subsequent tool turns', async () => {
  const requests: Record<string, unknown>[] = [];
  const call: ToolCall = { id: 'call-1', type: 'function', function: { name: 'koreai_find_actions', arguments: '{}' } };
  const client = new DeepSeekClient('sk-unit-private-12345', async (_url, init) => {
    requests.push(JSON.parse(String(init?.body)));
    return Response.json({ model: 'deepseek-flash', choices: [{ finish_reason: 'tool_calls', message: { role: 'assistant', content: null, reasoning_content: 'private reasoning', tool_calls: [call] } }] });
  });
  const tools = [{ type: 'function' as const, function: { name: 'koreai_find_actions', description: 'find', parameters: { type: 'object' } } }];
  const first = await client.chat([{ role: 'user', content: 'test' }], tools);
  assert.deepEqual(first.message.tool_calls, [call]);
  await client.chat([first.message, { role: 'tool', tool_call_id: call.id, content: '{}' }], tools);
  assert(requests.every(r => r.model === 'deepseek-flash'));
  assert.equal((requests[1].messages as ChatMessage[])[0].reasoning_content, 'private reasoning');
  const truncated = new DeepSeekClient('sk-unit-private-12345', async () => Response.json({ choices: [{ finish_reason: 'length', message: first.message }] }));
  await assert.rejects(() => truncated.chat([{ role: 'user', content: 'test' }], tools), /출력 한도/);
});

test('Project tools cannot approve, read foreign jobs, change accounts, or duplicate identical writes', async () => {
  const id = randomUUID(), accountId = randomUUID(), token = 'private-project-token';
  const requests: { path: string; body: Record<string, unknown> }[] = [];
  const fetcher: typeof fetch = async (url, init = {}) => {
    assert.equal(new Headers(init.headers).get('Authorization'), `Bearer ${token}`);
    const path = new URL(String(url)).pathname;
    const body = init.body ? JSON.parse(String(init.body)) : {};
    requests.push({ path, body });
    if (path === '/api/actions') return Response.json([{ id: 'browser.demo.publish', title: 'write', effect: 'write', description: '', inputSchema: {}, enabled: true }]);
    return Response.json({ id, state: 'pending_approval', effect: 'write', input: body.input ?? {} });
  };
  const agent = new ProjectAgent({ baseUrl: 'http://127.0.0.1:4318', token, fetcher, allowedActions: ['browser.demo.publish'], accountId });
  await agent.connect();
  const tool = (name: string, args: unknown): ToolCall => ({ id: randomUUID(), type: 'function', function: { name, arguments: JSON.stringify(args) } });
  const previous = requests.length;
  assert(JSON.stringify(await agent.executeTool(tool('koreai_approve', {}))).includes('허용되지 않은 도구'));
  await agent.executeTool(tool('koreai_get_job', { jobId: randomUUID() }));
  await agent.executeTool(tool('koreai_execute', { actionId: 'browser.demo.publish', input: {}, accountId: randomUUID() }));
  assert.equal(requests.length, previous, '권한 밖 요청은 API에 전송되지 않아야 합니다.');
  const write = tool('koreai_execute', { actionId: 'browser.demo.publish', input: { title: 'same', content: 'same' } });
  await agent.executeTool(write); await agent.executeTool(write);
  const posts = requests.filter(r => r.path === '/api/jobs');
  assert.equal(posts.length, 2); assert.equal(posts[0].body.idempotencyKey, posts[1].body.idempotencyKey);
  assert.equal(posts[0].body.accountId, accountId);
  assert(!JSON.stringify(agent.trace).includes(token));
  const reader = new ProjectAgent({ baseUrl: 'http://127.0.0.1:4318', token, fetcher, allowedActions: ['browser.demo.publish'], readOnly: true });
  await assert.rejects(() => reader.connect(), /읽기 행동만/);
  assert.throws(() => new ProjectAgent({ baseUrl: 'http://example.com', token, allowedActions: ['x'] }), /127.0.0.1/);
});
