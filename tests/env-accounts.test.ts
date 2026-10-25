import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { createRuntime } from '../src/http.js';
import { admin } from '../src/core/engine.js';
import { syncEnvironmentAccounts } from '../src/core/env-accounts.js';
import { OAuth } from '../src/core/oauth.js';
import { TestVault, tempDir } from './helpers.js';
import { runtimeLogin, runtimeApi } from './mcp-oauth-fixture.js';
import { routeSecret, routeInput, routeMock } from './subway-route-fixture.js';

const env = { KOREAI_SEOUL_SUBWAY_ROUTE_SERVICE_KEY: routeSecret, KOREAI_SEOUL_SUBWAY_ROUTE_ACTIONS: 'seoul-subway.route' };
test('environment accounts use explicit grants, stay encrypted and read-only through HTTP, and do not expose provider keys', async () => {
  const mock = routeMock(), r = await createRuntime({ dataDir: tempDir('env-account-http'), port: 0, vault: new TestVault(), evidenceMode: 'mock', environment: env, fetcher: mock.fetcher });
  try {
    const account = r.engine.accounts()[0]!; assert.equal(account.managedBy, 'environment'); assert.deepEqual(account.allowedActions, ['seoul-subway.route']); assert(!JSON.stringify(r.store.list('account')).includes(routeSecret));
    const cookie = await runtimeLogin(r), api = (path: string, method = 'GET', body?: unknown) => runtimeApi(r, '/api' + path, method, body, cookie);
    for (const response of [await api('/accounts', 'POST', { id: account.id, label: 'changed', credentialType: account.credentialType, allowedActions: [], secrets: { serviceKey: 'new-test-key' } }), await api('/accounts/' + account.id, 'DELETE'), await api('/accounts/' + account.id + '/refresh', 'POST', {})]) { assert.equal(response.status, 409); assert.equal((await response.json()).error.code, 'MANAGED_ACCOUNT'); }
    assert.equal(mock.calls.length, 0);
    const job = r.engine.create(admin, { actionId: 'seoul-subway.route', accountId: account.id, input: routeInput, idempotencyKey: randomUUID() }); await r.engine.idle(); assert.equal(r.engine.get(admin, job.id).state, 'succeeded'); assert.equal(mock.calls.length, 1);
    const state = await (await api('/state')).json(); assert(!JSON.stringify(state).includes(routeSecret)); assert.equal(state.metrics.supportedActions, 0);
  } finally { await r.close(); }
});

test('environment key rotation preserves account/client identity, removing a key removes only that managed account', async () => {
  const dataDir = tempDir('env-account-rotation'), vault = new TestVault(); let r = await createRuntime({ dataDir, port: 0, vault, environment: env, evidenceMode: 'mock' });
  const id = r.engine.accounts()[0]!.id;
  const manual = await r.engine.saveAccount({ label: 'manual', credentialType: 'seoul-subway-route-api', allowedActions: ['seoul-subway.route'], secrets: { serviceKey: 'manual-secret' } });
  const client = r.engine.createClient({ name: 'reader', allowedActions: ['seoul-subway.route'], allowedAccountIds: [id] }); await r.close();
  r = await createRuntime({ dataDir, port: 0, vault, environment: { ...env, KOREAI_SEOUL_SUBWAY_ROUTE_SERVICE_KEY: 'rotated-unit-key', KOREAI_SEOUL_SUBWAY_ROUTE_ACTIONS: '' }, evidenceMode: 'mock' });
  try { const account = r.engine.accounts().find(a => a.managedBy)!; assert.equal(account.id, id); assert.deepEqual(account.allowedActions, []); assert.equal((await vault.open(r.store.get<any>('account', id)!.sealed)).serviceKey, 'rotated-unit-key'); assert.deepEqual(r.engine.authenticate(client.token)!.allowedAccountIds, [id]); } finally { await r.close(); }
  r = await createRuntime({ dataDir, port: 0, vault, environment: {}, evidenceMode: 'mock' });
  try { assert.deepEqual(r.engine.accounts().map(account => account.id), [manual.id]); assert.equal(r.engine.discover(r.engine.authenticate(client.token)!)[0]!.enabled, false); } finally { await r.close(); }
});

test('invalid environment grants never partly update accounts and OAuth cannot change environment-managed tokens', async () => {
  let calls = 0; const r = await createRuntime({ dataDir: tempDir('env-invalid'), port: 0, vault: new TestVault(), environment: env, fetcher: async () => { calls++; throw Error('no network'); }, evidenceMode: 'mock' });
  try {
    const initial = r.engine.accounts();
    await assert.rejects(() => syncEnvironmentAccounts(r.engine, { ...env, KOREAI_KAKAO_APP_REST_API_KEY: 'fake-test-key', KOREAI_KAKAO_APP_ACTIONS: 'seoul-subway.route' }), /ACTIONS/); assert.deepEqual(r.engine.accounts(), initial);
    await assert.rejects(() => syncEnvironmentAccounts(r.engine, { KOREAI_CHZZK_CLIENT_ID: 'incomplete-test-id' }), /CHZZK/); assert.deepEqual(r.engine.accounts(), initial);
    await syncEnvironmentAccounts(r.engine, { ...env, KOREAI_NAVER_USER_ACCESS_TOKEN: 'naver-test-token', KOREAI_NAVER_USER_ACTIONS: 'naver.calendar.create' });
    const account = r.engine.accounts().find(a => a.credentialType === 'naver-user')!, oauth = new OAuth(r.engine, async () => { calls++; throw Error('no network'); });
    await assert.rejects(() => oauth.start({ credentialType: 'naver-user', clientId: 'test-client', clientSecret: 'test-secret', label: 'test', allowedActions: ['naver.calendar.create'], accountId: account.id }), /\.env/); await assert.rejects(() => oauth.refresh(account.id), /\.env/); assert.equal(calls, 0);
    const job = r.engine.create(admin, { actionId: 'naver.calendar.create', accountId: account.id, input: { title: 'test', start: '2026-10-25T09:00:00+09:00', end: '2026-10-25T10:00:00+09:00' }, idempotencyKey: randomUUID() }); assert.equal(job.state, 'pending_approval'); assert.equal(calls, 0);
    await syncEnvironmentAccounts(r.engine, env); assert.equal(r.engine.get(admin, job.id).state, 'cancelled'); assert.equal(calls, 0);
  } finally { await r.close(); }
});
