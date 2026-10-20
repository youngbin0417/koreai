import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { createRuntime } from '../src/http.js';
import { admin } from '../src/core/engine.js';
import { ActionError } from '../src/types.js';
import { coupang } from '../src/connectors/lifestyle/coupang.js';
import { LifestyleConnections } from '../src/connectors/lifestyle/index.js';
import { coupangProductAction, coupangProductPlan, coupangProductInput, coupangProductOutput, coupangPriceProposal, coupangReadPlanExecutor } from '../src/connectors/lifestyle/coupang-read.js';
import { TestVault, tempDir } from './helpers.js';

test('Coupang proposes bounded consumer search without accepting seller or affiliate keys, cookies or private order inputs', () => {
  assert.deepEqual(coupangProductInput.parse({ query: ' 생수 ' }), { query: '생수', limit: 5 });
  for (const value of [{ query: '' }, { query: 'x'.repeat(101) }, { limit: 0 }, { limit: 21 }, { limit: 1.5 }, { accessKey: 'private-key' }, { secretKey: 'secret' }, { vendorId: 'seller' }, { sellerProductId: '123' }, { partnerId: 'affiliate' }, { cookie: 'session' }, { orderId: 'private-order' }, { address: '개인 배송지' }, { url: 'https://evil.example' }]) assert.equal(coupangProductInput.safeParse({ ...coupangProductPlan.example, ...value }).success, false);
  assert.equal(coupangProductPlan.access, 'provider-confirmation-required'); assert.equal(coupangProductPlan.state, 'defined'); assert(coupangProductInput.safeParse(coupangProductPlan.example).success);
  assert.equal(coupangProductAction.implemented, false); assert.equal(coupangProductAction.method, 'partnership'); assert.equal(coupangProductAction.credentialType, undefined); assert.deepEqual(coupangProductAction.requiredSecrets, []); assert.deepEqual(coupangProductAction.inputSchema, coupangProductPlan.inputSchema);
});

test('Coupang proposal preserves large option identifiers and conditional prices, refuses mismatched or tracking links and never confirms delivery', () => {
  const unknown = { kind: 'unknown', amountKrw: null, text: null, conditionsText: null };
  // Synthetic contract examples, not real Coupang products, prices or provider responses.
  const starting = { kind: 'from', amountKrw: 5000, text: '5,000원~', conditionsText: '시험 와우회원·쿠폰 조건' };
  assert(coupangPriceProposal.safeParse(unknown).success); assert(coupangPriceProposal.safeParse(starting).success); assert(coupangPriceProposal.safeParse({ ...starting, kind: 'listed' }).success);
  for (const price of [{ ...unknown, amountKrw: 0 }, { ...starting, amountKrw: null }, { ...starting, amountKrw: 0 }, { ...starting, amountKrw: -1 }, { ...starting, amountKrw: Number.MAX_SAFE_INTEGER + 1 }, { ...starting, couponApplied: true }]) assert.equal(coupangPriceProposal.safeParse(price).success, false);
  const product = { productId: '12345', itemId: null, vendorItemId: null, title: '시험 상품', sourceUrl: 'https://www.coupang.com/vp/products/12345', optionText: null, price: unknown, availabilityText: null, deliveryText: null, deliveryEligibility: 'not_verified' };
  const sample = { status: 'available', query: '생수', products: [product], retrievedAt: '2026-10-15T00:00:00.000Z', providerUpdatedAt: null };
  const option = { ...product, itemId: '90071992547409931', vendorItemId: '90071992547409932', sourceUrl: 'https://www.coupang.com/vp/products/12345?itemId=90071992547409931&vendorItemId=90071992547409932', price: starting, optionText: '시험 2종 택1', availabilityText: '품절', deliveryText: '시험 로켓배송 안내' };
  assert(coupangProductOutput.safeParse(sample).success); const parsed = coupangProductOutput.parse({ ...sample, products: [option] }); assert.equal(parsed.products[0].itemId, '90071992547409931'); assert.equal(parsed.products[0].vendorItemId, '90071992547409932');
  for (const sourceUrl of ['invalid', 'http://www.coupang.com/vp/products/12345', 'https://evil.example/vp/products/12345', 'https://www.coupang.com.evil.example/vp/products/12345', 'https://user:secret@www.coupang.com/vp/products/12345', 'https://www.coupang.com:8443/vp/products/12345', 'https://www.coupang.com/vp/products/12345?accessKey=secret', 'https://www.coupang.com/vp/products/12345?itemId=1&itemId=2', 'https://www.coupang.com/vp/products/12345?itemId=abc', 'https://www.coupang.com/vp/products/12345?lptag=affiliate', 'https://www.coupang.com/vp/products/12345#session', 'https://link.coupang.com/a/test', 'https://developers.coupang.com/ko']) assert.equal(coupangProductOutput.safeParse({ ...sample, products: [{ ...product, sourceUrl }] }).success, false);
  for (const value of [{ productId: '54321' }, { itemId: '1' }, { itemId: 90071992547409930 }, { vendorItemId: null }, { sourceUrl: product.sourceUrl }, { deliveryEligibility: 'confirmed' }, { orderHistory: [] }, { sellerProductId: '123' }]) assert.equal(coupangProductOutput.safeParse({ ...sample, products: [{ ...option, ...value }] }).success, false);
  assert.equal(coupangProductOutput.safeParse({ ...sample, status: 'no_data' }).success, false); assert(coupangProductOutput.safeParse({ ...sample, status: 'no_data', products: [] }).success);
});

test('Coupang preparation cannot activate search, dispatch through basic links or create support evidence', async () => {
  let calls = 0;
  const r = await createRuntime({ dataDir: tempDir('coupang-plan'), port: 0, vault: new TestVault(), evidenceMode: 'live', fetcher: async () => { calls++; throw new Error('No provider calls expected'); } });
  try {
    const basic = new LifestyleConnections(r.store); basic.prepare('coupang', { routeId: 'consumer' });
    const client = r.engine.createClient({ name: 'product planner', allowedActions: [coupangProductAction.id] }), principal = r.engine.authenticate(client.token)!;
    for (const caller of [admin, principal]) {
      const described = r.engine.discover(caller, '', 'coupang').find(action => action.id === coupangProductAction.id)!; assert.equal(described.enabled, false); assert.equal(described.implemented, false);
      assert.throws(() => r.engine.create(caller, { actionId: described.id, input: coupangProductPlan.example, idempotencyKey: randomUUID() }), (error: unknown) => error instanceof ActionError && error.code === 'NOT_IMPLEMENTED');
    }
    const ctx = { job: {} as never, secrets: {}, signal: new AbortController().signal, dispatch: () => { calls++; } };
    await assert.rejects(() => coupangReadPlanExecutor(coupangProductAction, ctx), (error: unknown) => error instanceof ActionError && error.code === 'NOT_IMPLEMENTED');
    await assert.rejects(() => basic.execute(coupangProductAction, ctx), (error: unknown) => error instanceof ActionError && error.code === 'NOT_IMPLEMENTED');
    assert.throws(() => r.engine.release(coupangProductAction.id)); await r.engine.idle();
    assert.equal(calls, 0); assert.equal(r.engine.jobs().length, 0); assert.equal(r.store.list('evidence').length, 0); assert.equal(r.engine.metrics().verifiedServices, 0); assert.equal(r.engine.metrics().supportedActions, 0);
    assert.equal(r.engine.discover(admin).filter(action => action.method === 'api' && action.implemented).length, 50);
  } finally { await r.close(); }
});

test('Coupang HTTP scopes the proposal and keeps consumer links, seller authentication and Partners guidance separate without provider calls', async () => {
  let calls = 0;
  const r = await createRuntime({ dataDir: tempDir('coupang-plan-http'), port: 0, vault: new TestVault(), evidenceMode: 'mock', fetcher: async () => { calls++; throw new Error('No provider calls expected'); } });
  try {
    const login = await fetch(`${r.baseUrl}/api/bootstrap`, { method: 'POST', headers: { Origin: r.baseUrl, 'Content-Type': 'application/json' }, body: JSON.stringify({ code: r.bootstrapCode }) }), cookie = login.headers.get('set-cookie')!.split(';')[0]!;
    const api = (path: string, method = 'GET', body?: unknown, token?: string) => fetch(`${r.baseUrl}/api${path}`, { method, headers: { Origin: r.baseUrl, ...(token ? { Authorization: `Bearer ${token}` } : { Cookie: cookie }), ...(body === undefined ? {} : { 'Content-Type': 'application/json' }) }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
    const client = r.engine.createClient({ name: 'Coupang reader', allowedActions: ['coupang.connection.status', 'coupang.connection.open', coupangProductAction.id] });
    const connections = await (await api('/connections', 'GET', undefined, client.token)).json(); assert.equal(connections.length, 1); const connection = connections[0];
    assert.equal(connection.firstRead.actionId, coupangProductAction.id); assert.equal(connection.firstRead.manualLabel, '공식 상품 직접 확인'); assert.equal(connection.stages.find((stage: { id: string }) => stage.id === 'read').state, 'defined'); assert.equal(connection.automaticActions, 0); assert.equal(connection.accountVerified, false);
    assert.equal((await api('/connections/coupang', 'PUT', { routeId: 'partners-guide' }, client.token)).status, 403);
    assert.equal((await api('/connections/coupang', 'PUT', { routeId: 'partners-guide' })).status, 200);
    const blocked = await api('/jobs', 'POST', { actionId: coupangProductAction.id, input: coupangProductPlan.example, idempotencyKey: randomUUID() }, client.token); assert.equal(blocked.status, 409); assert.equal((await blocked.json()).error.code, 'NOT_IMPLEMENTED');
    for (const routeId of ['consumer', 'seller', 'seller-auth', 'partners-guide']) {
      assert.equal((await api('/connections/coupang', 'PUT', { routeId })).status, 200);
      const job = await (await api('/jobs', 'POST', { actionId: 'coupang.connection.open', input: {}, idempotencyKey: randomUUID() }, client.token)).json(); await r.engine.idle();
      const result = await (await api(`/jobs/${job.id}`, 'GET', undefined, client.token)).json(); assert.equal(result.state, 'succeeded'); assert.equal(result.dispatched, false); assert.equal(result.result.data.url, coupang.routes.find(route => route.id === routeId)!.url); assert.equal(result.result.data.externalActionExecuted, false);
    }
    assert.equal(calls, 0); assert.equal(r.engine.metrics().verifiedServices, 0); assert.equal(r.engine.metrics().supportedActions, 0);
  } finally { await r.close(); }
});
