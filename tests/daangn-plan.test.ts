import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { createRuntime } from '../src/http.js';
import { admin } from '../src/core/engine.js';
import { ActionError } from '../src/types.js';
import { daangn } from '../src/connectors/lifestyle/daangn.js';
import { LifestyleConnections } from '../src/connectors/lifestyle/index.js';
import { daangnItemAction, daangnItemPlan, daangnItemInput, daangnItemOutput, daangnPriceProposal, daangnReadPlanExecutor } from '../src/connectors/lifestyle/daangn-read.js';
import { TestVault, tempDir } from './helpers.js';

test('Daangn requires an explicit neighborhood and bounded query without location credentials or private chat inputs', () => {
  assert.deepEqual(daangnItemInput.parse({ query: ' 자전거 ', region: ' 서울 역삼동 ' }), { query: '자전거', region: '서울 역삼동', limit: 5 });
  for (const value of [{ query: '' }, { region: '' }, { region: undefined }, { query: 'x'.repeat(101) }, { region: 'x'.repeat(81) }, { limit: 0 }, { limit: 21 }, { latitude: 37.5 }, { longitude: 127 }, { regionId: 123 }, { apiKey: 'private-key' }, { cookie: 'session' }, { chatId: '1' }, { url: 'https://evil.example' }]) assert.equal(daangnItemInput.safeParse({ ...daangnItemPlan.example, ...value }).success, false);
  assert.equal(daangnItemPlan.access, 'provider-confirmation-required'); assert.equal(daangnItemPlan.state, 'defined'); assert(daangnItemInput.safeParse(daangnItemPlan.example).success);
  assert.equal(daangnItemAction.implemented, false); assert.equal(daangnItemAction.method, 'partnership'); assert.equal(daangnItemAction.credentialType, undefined); assert.deepEqual(daangnItemAction.requiredSecrets, []); assert.deepEqual(daangnItemAction.inputSchema, daangnItemPlan.inputSchema);
});

test('Daangn proposed results keep unknown price distinct from free, preserve reported sale state and reject unsafe or private fields', () => {
  const unknown = { kind: 'unknown', amountKrw: null, text: null }, free = { kind: 'free', amountKrw: 0, text: '나눔' };
  assert(daangnPriceProposal.safeParse(unknown).success); assert(daangnPriceProposal.safeParse(free).success);
  assert(daangnPriceProposal.safeParse({ kind: 'amount', amountKrw: 30000, text: '30,000원' }).success); assert(daangnPriceProposal.safeParse({ kind: 'negotiable', amountKrw: null, text: '가격 제안' }).success);
  for (const price of [{ ...unknown, amountKrw: 0 }, { ...free, amountKrw: null }, { kind: 'amount', amountKrw: -1, text: '-1원' }, { kind: 'amount', amountKrw: Number.MAX_SAFE_INTEGER + 1, text: '큰 금액' }]) assert.equal(daangnPriceProposal.safeParse(price).success, false);
  // Synthetic contract example; no real listing, seller or provider response is represented.
  const item = { providerId: null, title: '시험 자전거', neighborhoodText: null, price: unknown, transactionStatus: 'unknown', transactionStatusText: null, sourceUrl: 'https://www.daangn.com/kr/buy-sell/test-item/' };
  const sample = { status: 'available', query: '자전거', region: '서울 역삼동', items: [item], retrievedAt: '2026-10-15T00:00:00.000Z', providerUpdatedAt: null };
  assert(daangnItemOutput.safeParse(sample).success);
  assert(daangnItemOutput.safeParse({ ...sample, items: [{ ...item, price: free, transactionStatus: 'sold', transactionStatusText: '판매완료' }] }).success);
  for (const sourceUrl of ['invalid', 'http://www.daangn.com/kr/buy-sell/test', 'https://evil.example/kr/buy-sell/test', 'https://www.daangn.com.evil.example/kr/buy-sell/test', 'https://user:secret@www.daangn.com/kr/buy-sell/test', 'https://www.daangn.com:8443/kr/buy-sell/test', 'https://www.daangn.com/kr/buy-sell/test?cookie=secret', 'https://business.daangn.com/']) assert.equal(daangnItemOutput.safeParse({ ...sample, items: [{ ...item, sourceUrl }] }).success, false);
  assert.equal(daangnItemOutput.safeParse({ ...sample, status: 'no_data' }).success, false); assert(daangnItemOutput.safeParse({ ...sample, status: 'no_data', items: [] }).success);
  assert.equal(daangnItemOutput.safeParse({ ...sample, items: [{ ...item, sellerPhone: '010-0000-0000', chatHistory: [] }] }).success, false);
});

test('Daangn item plan cannot execute through engine or base links, create evidence or become supported after preparation', async () => {
  let calls = 0;
  const r = await createRuntime({ dataDir: tempDir('daangn-plan'), port: 0, vault: new TestVault(), evidenceMode: 'live', fetcher: async () => { calls++; throw new Error('No provider calls expected'); } });
  try {
    const basic = new LifestyleConnections(r.store); basic.prepare('daangn', { routeId: 'items' });
    const client = r.engine.createClient({ name: 'item planner', allowedActions: [daangnItemAction.id] }), principal = r.engine.authenticate(client.token)!;
    for (const caller of [admin, principal]) {
      const described = r.engine.discover(caller, '', 'daangn').find(action => action.id === daangnItemAction.id)!; assert.equal(described.enabled, false); assert.equal(described.implemented, false);
      assert.throws(() => r.engine.create(caller, { actionId: described.id, input: daangnItemPlan.example, idempotencyKey: randomUUID() }), (error: unknown) => error instanceof ActionError && error.code === 'NOT_IMPLEMENTED');
    }
    const ctx = { job: {} as never, secrets: {}, signal: new AbortController().signal, dispatch: () => { calls++; } };
    await assert.rejects(() => daangnReadPlanExecutor(daangnItemAction, ctx), (error: unknown) => error instanceof ActionError && error.code === 'NOT_IMPLEMENTED');
    await assert.rejects(() => basic.execute(daangnItemAction, ctx), (error: unknown) => error instanceof ActionError && error.code === 'NOT_IMPLEMENTED');
    assert.throws(() => r.engine.release(daangnItemAction.id)); await r.engine.idle();
    assert.equal(calls, 0); assert.equal(r.engine.jobs().length, 0); assert.equal(r.store.list('evidence').length, 0); assert.equal(r.engine.metrics().verifiedServices, 0); assert.equal(r.engine.metrics().supportedActions, 0);
    assert.equal(r.engine.discover(admin).filter(action => action.method === 'api' && action.implemented && !action.unavailable).length, 46);
  } finally { await r.close(); }
});

test('Daangn HTTP scopes plans and keeps consumer item links separate from advertising MCP guidance without provider calls', async () => {
  let calls = 0;
  const r = await createRuntime({ dataDir: tempDir('daangn-plan-http'), port: 0, vault: new TestVault(), evidenceMode: 'mock', fetcher: async () => { calls++; throw new Error('No provider calls expected'); } });
  try {
    const login = await fetch(`${r.baseUrl}/api/bootstrap`, { method: 'POST', headers: { Origin: r.baseUrl, 'Content-Type': 'application/json' }, body: JSON.stringify({ code: r.bootstrapCode }) }), cookie = login.headers.get('set-cookie')!.split(';')[0]!;
    const api = (path: string, method = 'GET', body?: unknown, token?: string) => fetch(`${r.baseUrl}/api${path}`, { method, headers: { Origin: r.baseUrl, ...(token ? { Authorization: `Bearer ${token}` } : { Cookie: cookie }), ...(body === undefined ? {} : { 'Content-Type': 'application/json' }) }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
    const client = r.engine.createClient({ name: 'Daangn reader', allowedActions: ['daangn.connection.status', 'daangn.connection.open', daangnItemAction.id] });
    const connections = await (await api('/connections', 'GET', undefined, client.token)).json(); assert.equal(connections.length, 1); const connection = connections[0];
    assert.equal(connection.firstRead.actionId, daangnItemAction.id); assert.equal(connection.firstRead.manualLabel, '중고거래 목록 직접 확인'); assert.equal(connection.stages.find((stage: { id: string }) => stage.id === 'read').state, 'defined'); assert.equal(connection.automaticActions, 0); assert.equal(connection.accountVerified, false);
    assert.equal((await api('/connections/daangn', 'PUT', { routeId: 'items' }, client.token)).status, 403);
    assert.equal((await api('/connections/daangn', 'PUT', { routeId: 'items' })).status, 200);
    const blocked = await api('/jobs', 'POST', { actionId: daangnItemAction.id, input: daangnItemPlan.example, idempotencyKey: randomUUID() }, client.token); assert.equal(blocked.status, 409); assert.equal((await blocked.json()).error.code, 'NOT_IMPLEMENTED');
    for (const routeId of ['items', 'ads-mcp-guide']) {
      assert.equal((await api('/connections/daangn', 'PUT', { routeId })).status, 200);
      const job = await (await api('/jobs', 'POST', { actionId: 'daangn.connection.open', input: {}, idempotencyKey: randomUUID() }, client.token)).json(); await r.engine.idle();
      const result = await (await api(`/jobs/${job.id}`, 'GET', undefined, client.token)).json(); assert.equal(result.state, 'succeeded'); assert.equal(result.dispatched, false); assert.equal(result.result.data.url, daangn.routes.find(route => route.id === routeId)!.url); assert.equal(result.result.data.externalActionExecuted, false);
    }
    assert.equal(calls, 0); assert.equal(r.engine.metrics().verifiedServices, 0); assert.equal(r.engine.metrics().supportedActions, 0);
    assert.equal(r.engine.discover(admin).filter(action => action.method === 'mcp' && action.origin === 'user' && action.implemented).length, 0);
  } finally { await r.close(); }
});
