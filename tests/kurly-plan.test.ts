import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { createRuntime } from '../src/http.js';
import { admin } from '../src/core/engine.js';
import { ActionError } from '../src/types.js';
import { kurly } from '../src/connectors/lifestyle/kurly.js';
import { LifestyleConnections } from '../src/connectors/lifestyle/index.js';
import { kurlyProductAction, kurlyProductPlan, kurlyProductInput, kurlyProductOutput, kurlyPriceProposal, kurlyReadPlanExecutor } from '../src/connectors/lifestyle/kurly-read.js';
import { TestVault, tempDir } from './helpers.js';

test('Kurly proposes bounded consumer search without accepting logistics credentials or delivery addresses', () => {
  assert.deepEqual(kurlyProductInput.parse({ query: ' 우유 ' }), { query: '우유', limit: 5 });
  for (const value of [{ query: '' }, { query: 'x'.repeat(101) }, { limit: 0 }, { limit: 21 }, { limit: 1.5 }, { secretKey: 'private-key' }, { clientId: 'shipper' }, { accessToken: 'token' }, { cookie: 'session' }, { address: '개인 배송지' }, { membership: true }, { url: 'https://evil.example' }]) assert.equal(kurlyProductInput.safeParse({ ...kurlyProductPlan.example, ...value }).success, false);
  assert.equal(kurlyProductPlan.access, 'provider-confirmation-required'); assert.equal(kurlyProductPlan.state, 'defined'); assert(kurlyProductInput.safeParse(kurlyProductPlan.example).success);
  assert.equal(kurlyProductAction.implemented, false); assert.equal(kurlyProductAction.method, 'partnership'); assert.equal(kurlyProductAction.credentialType, undefined); assert.deepEqual(kurlyProductAction.requiredSecrets, []); assert.deepEqual(kurlyProductAction.inputSchema, kurlyProductPlan.inputSchema);
});

test('Kurly proposed results distinguish option starting prices, unknown price and unverified delivery without leaking private fields', () => {
  const unknown = { kind: 'unknown', amountKrw: null, text: null, conditionsText: null };
  // Synthetic contract examples, not live Kurly prices, goods or provider responses.
  const starting = { kind: 'from', amountKrw: 5000, text: '5,000원~', conditionsText: '시험 회원·쿠폰 조건' };
  assert(kurlyPriceProposal.safeParse(unknown).success); assert(kurlyPriceProposal.safeParse(starting).success); assert(kurlyPriceProposal.safeParse({ ...starting, kind: 'listed' }).success);
  for (const price of [{ ...unknown, amountKrw: 0 }, { ...starting, amountKrw: null }, { ...starting, amountKrw: 0, text: '총 상품금액 0원' }, { ...starting, amountKrw: -1 }, { ...starting, amountKrw: Number.MAX_SAFE_INTEGER + 1 }, { ...starting, kind: 'checkout' }, { ...starting, couponApplied: true }]) assert.equal(kurlyPriceProposal.safeParse(price).success, false);
  const product = { providerId: null, title: '시험 상품', sourceUrl: 'https://www.kurly.com/goods/12345', optionText: '시험 용량 2종 택1', price: unknown, availabilityText: null, deliveryText: null, deliveryEligibility: 'not_verified' };
  const sample = { status: 'available', query: '우유', products: [product], retrievedAt: '2026-10-15T00:00:00.000Z', providerUpdatedAt: null };
  assert(kurlyProductOutput.safeParse(sample).success); assert(kurlyProductOutput.safeParse({ ...sample, products: [{ ...product, price: starting, availabilityText: '품절', deliveryText: '화면에 표시된 배송 안내' }] }).success);
  for (const sourceUrl of ['invalid', 'http://www.kurly.com/goods/12345', 'https://evil.example/goods/12345', 'https://www.kurly.com.evil.example/goods/12345', 'https://user:secret@www.kurly.com/goods/12345', 'https://www.kurly.com:8443/goods/12345', 'https://www.kurly.com/goods/12345?token=secret', 'https://www.kurly.com/goods/12345#session', 'https://developers.kurly.com/docs/auth/', 'https://www.kurly.com/main']) assert.equal(kurlyProductOutput.safeParse({ ...sample, products: [{ ...product, sourceUrl }] }).success, false);
  assert.equal(kurlyProductOutput.safeParse({ ...sample, status: 'no_data' }).success, false); assert(kurlyProductOutput.safeParse({ ...sample, status: 'no_data', products: [] }).success);
  assert.equal(kurlyProductOutput.safeParse({ ...sample, products: [{ ...product, deliveryEligibility: 'confirmed' }] }).success, false);
  assert.equal(kurlyProductOutput.safeParse({ ...sample, products: [{ ...product, address: '배송지', orderHistory: [] }] }).success, false);
});

test('Kurly preparation cannot activate consumer search, execute a handoff fallback or create support evidence', async () => {
  let calls = 0;
  const r = await createRuntime({ dataDir: tempDir('kurly-plan'), port: 0, vault: new TestVault(), evidenceMode: 'live', fetcher: async () => { calls++; throw new Error('No provider calls expected'); } });
  try {
    const basic = new LifestyleConnections(r.store); basic.prepare('kurly', { routeId: 'products' });
    const client = r.engine.createClient({ name: 'product planner', allowedActions: [kurlyProductAction.id] }), principal = r.engine.authenticate(client.token)!;
    for (const caller of [admin, principal]) {
      const described = r.engine.discover(caller, '', 'kurly').find(action => action.id === kurlyProductAction.id)!; assert.equal(described.enabled, false); assert.equal(described.implemented, false);
      assert.throws(() => r.engine.create(caller, { actionId: described.id, input: kurlyProductPlan.example, idempotencyKey: randomUUID() }), (error: unknown) => error instanceof ActionError && error.code === 'NOT_IMPLEMENTED');
    }
    const ctx = { job: {} as never, secrets: {}, signal: new AbortController().signal, dispatch: () => { calls++; } };
    await assert.rejects(() => kurlyReadPlanExecutor(kurlyProductAction, ctx), (error: unknown) => error instanceof ActionError && error.code === 'NOT_IMPLEMENTED');
    await assert.rejects(() => basic.execute(kurlyProductAction, ctx), (error: unknown) => error instanceof ActionError && error.code === 'NOT_IMPLEMENTED');
    assert.throws(() => r.engine.release(kurlyProductAction.id)); await r.engine.idle();
    assert.equal(calls, 0); assert.equal(r.engine.jobs().length, 0); assert.equal(r.store.list('evidence').length, 0); assert.equal(r.engine.metrics().verifiedServices, 0); assert.equal(r.engine.metrics().supportedActions, 0);
    assert.equal(r.engine.discover(admin).filter(action => action.method === 'api' && action.implemented && !action.unavailable).length, 48);
  } finally { await r.close(); }
});

test('Kurly HTTP exposes the scoped proposal and distinct consumer and KLS guidance links without calling providers', async () => {
  let calls = 0;
  const r = await createRuntime({ dataDir: tempDir('kurly-plan-http'), port: 0, vault: new TestVault(), evidenceMode: 'mock', fetcher: async () => { calls++; throw new Error('No provider calls expected'); } });
  try {
    const login = await fetch(`${r.baseUrl}/api/bootstrap`, { method: 'POST', headers: { Origin: r.baseUrl, 'Content-Type': 'application/json' }, body: JSON.stringify({ code: r.bootstrapCode }) }), cookie = login.headers.get('set-cookie')!.split(';')[0]!;
    const api = (path: string, method = 'GET', body?: unknown, token?: string) => fetch(`${r.baseUrl}/api${path}`, { method, headers: { Origin: r.baseUrl, ...(token ? { Authorization: `Bearer ${token}` } : { Cookie: cookie }), ...(body === undefined ? {} : { 'Content-Type': 'application/json' }) }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
    const client = r.engine.createClient({ name: 'Kurly reader', allowedActions: ['kurly.connection.status', 'kurly.connection.open', kurlyProductAction.id] });
    const connections = await (await api('/connections', 'GET', undefined, client.token)).json(); assert.equal(connections.length, 1); const connection = connections[0];
    assert.equal(connection.firstRead.actionId, kurlyProductAction.id); assert.equal(connection.firstRead.manualLabel, '공식 상품 직접 확인'); assert.equal(connection.stages.find((stage: { id: string }) => stage.id === 'read').state, 'defined'); assert.equal(connection.automaticActions, 0); assert.equal(connection.accountVerified, false);
    assert.equal((await api('/connections/kurly', 'PUT', { routeId: 'products' }, client.token)).status, 403);
    assert.equal((await api('/connections/kurly', 'PUT', { routeId: 'products' })).status, 200);
    const blocked = await api('/jobs', 'POST', { actionId: kurlyProductAction.id, input: kurlyProductPlan.example, idempotencyKey: randomUUID() }, client.token); assert.equal(blocked.status, 409); assert.equal((await blocked.json()).error.code, 'NOT_IMPLEMENTED');
    for (const routeId of ['consumer', 'products', 'logistics', 'logistics-auth']) {
      assert.equal((await api('/connections/kurly', 'PUT', { routeId })).status, 200);
      const job = await (await api('/jobs', 'POST', { actionId: 'kurly.connection.open', input: {}, idempotencyKey: randomUUID() }, client.token)).json(); await r.engine.idle();
      const result = await (await api(`/jobs/${job.id}`, 'GET', undefined, client.token)).json(); assert.equal(result.state, 'succeeded'); assert.equal(result.dispatched, false); assert.equal(result.result.data.url, kurly.routes.find(route => route.id === routeId)!.url); assert.equal(result.result.data.externalActionExecuted, false);
    }
    assert.equal(calls, 0); assert.equal(r.engine.metrics().verifiedServices, 0); assert.equal(r.engine.metrics().supportedActions, 0);
  } finally { await r.close(); }
});
