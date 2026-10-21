import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { createRuntime } from '../src/http.js';
import { admin } from '../src/core/engine.js';
import { ActionError } from '../src/types.js';
import { toss } from '../src/connectors/lifestyle/toss.js';
import { LifestyleConnections } from '../src/connectors/lifestyle/index.js';
import { tossAccountAction, tossAccountPlan, tossAccountInput, tossAccountOutput, tossReadPlanExecutor } from '../src/connectors/lifestyle/toss-read.js';
import { TestVault, tempDir } from './helpers.js';

test('Toss proposes a bounded account list without accepting identity, credentials or caller-asserted financial consent', () => {
  assert.deepEqual(tossAccountInput.parse({}), { limit: 5 });
  for (const value of [{ limit: 0 }, { limit: 21 }, { limit: 1.5 }, { accountNumber: '123456789012' }, { ci: 'private-ci' }, { userKey: 'user' }, { clientId: 'client' }, { clientSecret: 'secret' }, { accessToken: 'token' }, { authorizationCode: 'code' }, { cookie: 'session' }, { consented: true }, { consentId: 'caller-consent' }, { pin: '1234' }, { url: 'https://evil.example' }]) assert.equal(tossAccountInput.safeParse({ ...tossAccountPlan.example, ...value }).success, false);
  assert.equal(tossAccountPlan.access, 'provider-confirmation-required'); assert.equal(tossAccountPlan.state, 'defined'); assert(tossAccountInput.safeParse(tossAccountPlan.example).success);
  assert.equal(tossAccountAction.implemented, false); assert.equal(tossAccountAction.method, 'partnership'); assert.equal(tossAccountAction.credentialType, undefined); assert.deepEqual(tossAccountAction.requiredSecrets, []); assert.deepEqual(tossAccountAction.scopes, []); assert.deepEqual(tossAccountAction.inputSchema, tossAccountPlan.inputSchema);
});

test('Toss proposed results require local references and masked hints, reject financial identifiers and never claim complete coverage', () => {
  // Synthetic contract examples; no real consumer, financial institution response or account mapping is represented.
  const account = { accountRef: '11111111-1111-4111-8111-111111111111', institutionName: '시험기관', accountNumberHint: '****1234' };
  const sample = { status: 'available', accounts: [account], coverage: 'not_verified', retrievedAt: '2026-10-15T00:00:00.000Z', providerUpdatedAt: null };
  assert(tossAccountOutput.safeParse(sample).success); assert(tossAccountOutput.safeParse({ ...sample, accounts: [{ ...account, accountNumberHint: null }] }).success);
  for (const accountNumberHint of ['123456789012', '123-456-789012', '1234', '****12345', '1234****5678', '****abcd', '****１２３４']) assert.equal(tossAccountOutput.safeParse({ ...sample, accounts: [{ ...account, accountNumberHint }] }).success, false);
  for (const value of [{ accountRef: 'provider-account-id' }, { accountRef: '123456789012' }, { institutionName: '' }, { accountNumber: '123456789012' }, { userKey: 'user' }, { ci: 'private-ci' }, { balance: 0 }, { transactions: [] }, { accessToken: 'token' }, { sourceUrl: 'https://evil.example' }]) assert.equal(tossAccountOutput.safeParse({ ...sample, accounts: [{ ...account, ...value }] }).success, false);
  assert.equal(tossAccountOutput.safeParse({ ...sample, coverage: 'complete' }).success, false); assert.equal(tossAccountOutput.safeParse({ ...sample, consented: true }).success, false);
  assert.equal(tossAccountOutput.safeParse({ ...sample, accounts: [account, account] }).success, false);
  assert.equal(tossAccountOutput.safeParse({ ...sample, status: 'no_data' }).success, false); assert(tossAccountOutput.safeParse({ ...sample, status: 'no_data', accounts: [] }).success);
});

test('Toss preparation cannot grant financial access, dispatch via basic links or create support evidence', async () => {
  let calls = 0;
  const r = await createRuntime({ dataDir: tempDir('toss-plan'), port: 0, vault: new TestVault(), evidenceMode: 'live', fetcher: async () => { calls++; throw new Error('No provider calls expected'); } });
  try {
    const basic = new LifestyleConnections(r.store); basic.prepare('toss', { routeId: 'mydata-auth' });
    const client = r.engine.createClient({ name: 'account planner', allowedActions: [tossAccountAction.id] }), principal = r.engine.authenticate(client.token)!;
    for (const caller of [admin, principal]) {
      const described = r.engine.discover(caller, '', 'toss').find(action => action.id === tossAccountAction.id)!; assert.equal(described.enabled, false); assert.equal(described.implemented, false);
      assert.throws(() => r.engine.create(caller, { actionId: described.id, input: tossAccountPlan.example, idempotencyKey: randomUUID() }), (error: unknown) => error instanceof ActionError && error.code === 'NOT_IMPLEMENTED');
    }
    const ctx = { job: {} as never, secrets: {}, signal: new AbortController().signal, dispatch: () => { calls++; } };
    await assert.rejects(() => tossReadPlanExecutor(tossAccountAction, ctx), (error: unknown) => error instanceof ActionError && error.code === 'NOT_IMPLEMENTED');
    await assert.rejects(() => basic.execute(tossAccountAction, ctx), (error: unknown) => error instanceof ActionError && error.code === 'NOT_IMPLEMENTED');
    assert.throws(() => r.engine.release(tossAccountAction.id)); await r.engine.idle();
    assert.equal(calls, 0); assert.equal(r.engine.jobs().length, 0); assert.equal(r.store.list('evidence').length, 0); assert.equal(r.engine.metrics().verifiedServices, 0); assert.equal(r.engine.metrics().supportedActions, 0);
    assert.equal(r.engine.discover(admin).filter(action => action.method === 'api' && action.implemented && !action.unavailable).length, 48);
  } finally { await r.close(); }
});

test('Toss HTTP scopes the plan, refuses AI grants and separates login, MyData authentication and console MCP guidance without calls', async () => {
  let calls = 0;
  const noCalls: typeof fetch = async () => { calls++; throw new Error('No provider or AI calls expected'); };
  const r = await createRuntime({ dataDir: tempDir('toss-plan-http'), port: 0, vault: new TestVault(), evidenceMode: 'mock', fetcher: noCalls, aiFetcher: noCalls });
  try {
    const login = await fetch(`${r.baseUrl}/api/bootstrap`, { method: 'POST', headers: { Origin: r.baseUrl, 'Content-Type': 'application/json' }, body: JSON.stringify({ code: r.bootstrapCode }) }), cookie = login.headers.get('set-cookie')!.split(';')[0]!;
    const api = (path: string, method = 'GET', body?: unknown, token?: string) => fetch(`${r.baseUrl}/api${path}`, { method, headers: { Origin: r.baseUrl, ...(token ? { Authorization: `Bearer ${token}` } : { Cookie: cookie }), ...(body === undefined ? {} : { 'Content-Type': 'application/json' }) }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
    const client = r.engine.createClient({ name: 'Toss reader', allowedActions: ['toss.connection.status', 'toss.connection.open', tossAccountAction.id] });
    const connections = await (await api('/connections', 'GET', undefined, client.token)).json(); assert.equal(connections.length, 1); const connection = connections[0];
    assert.equal(connection.firstRead.actionId, tossAccountAction.id); assert.equal(connection.firstRead.manualLabel, '토스 안내·앱 직접 확인'); assert.equal(connection.stages.find((stage: { id: string }) => stage.id === 'read').state, 'defined'); assert.equal(connection.automaticActions, 0); assert.equal(connection.accountVerified, false);
    assert.equal((await api('/connections/toss', 'PUT', { routeId: 'mydata-auth' }, client.token)).status, 403);
    assert.equal((await api('/connections/toss', 'PUT', { routeId: 'mydata-auth' })).status, 200);
    assert.equal((await api('/connections/toss', 'PUT', { routeId: 'mydata-auth', consented: true })).status, 400);
    const blocked = await api('/jobs', 'POST', { actionId: tossAccountAction.id, input: tossAccountPlan.example, idempotencyKey: randomUUID() }, client.token); assert.equal(blocked.status, 409); assert.equal((await blocked.json()).error.code, 'NOT_IMPLEMENTED');
    const chat = await api('/chats', 'POST', { allowedActions: [tossAccountAction.id] }); assert.equal(chat.status, 409); assert.equal((await chat.json()).error.code, 'INVALID_GRANT'); assert.equal(r.chats.list().length, 0);
    for (const routeId of ['consumer', 'apps-in-toss', 'login-guide', 'mydata-auth', 'console-mcp-guide']) {
      assert.equal((await api('/connections/toss', 'PUT', { routeId })).status, 200);
      const job = await (await api('/jobs', 'POST', { actionId: 'toss.connection.open', input: {}, idempotencyKey: randomUUID() }, client.token)).json(); await r.engine.idle();
      const result = await (await api(`/jobs/${job.id}`, 'GET', undefined, client.token)).json(); assert.equal(result.state, 'succeeded'); assert.equal(result.dispatched, false); assert.equal(result.result.data.url, toss.routes.find(route => route.id === routeId)!.url); assert.equal(result.result.data.externalActionExecuted, false);
    }
    assert.equal(calls, 0); assert.equal(r.engine.metrics().verifiedServices, 0); assert.equal(r.engine.metrics().supportedActions, 0); assert.equal(r.engine.discover(admin).filter(action => action.method === 'mcp' && action.origin === 'user' && action.implemented).length, 0);
  } finally { await r.close(); }
});
