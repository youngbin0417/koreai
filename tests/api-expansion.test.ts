import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { appApiBacklog } from '../src/research/app-api-backlog.js';
import { draftActions, planningActions, draftExample, draftExecutor, previewDraftRequest } from '../src/connectors/drafts/index.js';
import { services } from '../src/catalog.js';
import { Engine, admin } from '../src/core/engine.js';
import { Store } from '../src/core/store.js';
import { ActionError } from '../src/types.js';
import { createRuntime } from '../src/http.js';
import { TestVault } from './helpers.js';
import { kobisAction } from '../src/connectors/kobis.js';

test('expansion candidates and draft actions reference unique catalog services and reviewed evidence', () => {
  assert.equal(appApiBacklog.length, 26);
  assert.equal(new Set(appApiBacklog.map(c => c.serviceId)).size, appApiBacklog.length);
  assert.equal(services.length, 71);
  assert.equal(draftActions.length, 0);
  assert.equal(planningActions.length, 9);
  for (const candidate of appApiBacklog) {
    assert(services.some(s => s.id === candidate.serviceId));
    assert(candidate.sourceUrl.startsWith('https://'));
    assert.equal(candidate.checkedAt === null, candidate.verification === 'unresearched');
    for (const id of candidate.draftActionIds) assert(draftActions.some(a => a.id === id && a.serviceId === candidate.serviceId));
    for (const id of candidate.implementedActionIds) assert(planningActions.some(a => a.id === id && a.serviceId === candidate.serviceId && a.implemented));
  }
  for (const action of draftActions) {
    assert.equal(action.implemented, false);
    assert.equal(action.verification, 'documented');
    assert.equal(action.effect, 'read');
    assert.equal(action.method, 'api');
    assert(action.requiredSecrets.length > 0);
    assert(action.schema.safeParse(draftExample(action.id)).success);
  }
});

test('draft previews map documented query fields, exclude secrets, and distinguish proposed schemas', () => {
  const weather = previewDraftRequest('kma.observation', { date: '2026-10-10', time: '0900', nx: 60, ny: 127 });
  assert.equal(weather.request?.endpoint, 'https://apis.data.go.kr/1360000/VilageFcstInfoService_2.0/getUltraSrtNcst');
  assert.deepEqual(weather.request?.query, { dataType: 'JSON', base_date: '20261010', base_time: '0900', nx: 60, ny: 127, pageNo: 1, numOfRows: 10 });
  const air = previewDraftRequest('airkorea.forecast', draftExample('airkorea.forecast'));
  assert.equal(air.request?.query.InformCode, 'PM25');
  assert.equal(air.request?.query.returnType, 'json');
  const bus = previewDraftRequest('tago.bus.arrivals', draftExample('tago.bus.arrivals'));
  assert.equal(bus.request?.query._type, 'json');
  assert.equal(bus.request?.query.nodeId, 'DJB8001793');
  const hospital = previewDraftRequest('egen.hospitals.search', { region: '서울특별시', district: '강남구', day: 8 });
  assert.deepEqual(hospital.request?.query, { Q0: '서울특별시', Q1: '강남구', QT: 8, pageNo: 1, numOfRows: 10 });
  assert.equal(hospital.request?.responseFormat, 'xml');
  for (const action of planningActions) {
    const preview = previewDraftRequest(action.id, draftExample(action.id));
    assert.equal(preview.networkDispatched, false);
    assert.equal(preview.request?.query.serviceKey, undefined);
    assert.equal(preview.request?.query.ServiceKey, undefined);
    assert.equal(preview.request?.query.KEY, undefined);
    assert.equal(preview.request?.query.key, undefined);
    assert.equal(preview.mappingStatus, 'documented-template');
    assert(action.domains.includes(new URL(preview.request!.endpoint).hostname));
    assert.throws(() => previewDraftRequest(action.id, { ...draftExample(action.id), serviceKey: 'must-not-echo' }));
    assert.throws(() => previewDraftRequest(action.id, { ...draftExample(action.id), url: 'https://evil.example' }));
  }
  assert.throws(() => previewDraftRequest('kma.observation', { ...draftExample('kma.observation'), date: '2026-02-29' }));
  assert.throws(() => previewDraftRequest('kma.observation', { ...draftExample('kma.observation'), time: '2460' }));
  assert.throws(() => previewDraftRequest('tago.bus.arrivals', { ...draftExample('tago.bus.arrivals'), page: 0 }));
  assert.throws(() => previewDraftRequest('tago.bus.arrivals', { ...draftExample('tago.bus.arrivals'), nodeId: '../other?serviceKey=secret' }));
  assert.throws(() => previewDraftRequest('kobis.boxoffice.daily', { date: '2026-10-10', limit: 11 }));
  assert.equal(previewDraftRequest('kobis.boxoffice.daily', { date: '2024-02-29' }).validatedInput.date, '2024-02-29');
  assert.throws(() => previewDraftRequest('band.publish', {}), (e: unknown) => e instanceof ActionError && e.code === 'NOT_FOUND');
});

test('configured accounts and agent grants cannot activate drafts or create execution evidence', async () => {
  const store = new Store(':memory:');
  const engine = new Engine(store, new TestVault(), 'live');
  let executorCalls = 0;
  // Keep testing the engine's draft barrier even after every bundled draft is implemented.
  const fixtures = [...draftActions, { ...kobisAction, id: 'test.draft.read', implemented: false }];
  engine.register(fixtures, async (a, ctx) => { executorCalls++; return draftExecutor(a, ctx); });
  try {
    for (const action of fixtures) {
      const account = await engine.saveAccount({ label: action.title, credentialType: action.credentialType, allowedActions: [action.id], secrets: Object.fromEntries(action.requiredSecrets.map(field => [field, 'draft-test-secret'])) });
      const client = engine.createClient({ name: 'draft reader', allowedActions: [action.id], allowedAccountIds: [account.id] });
      const principal = engine.authenticate(client.token)!;
      const described = engine.discover(principal)[0]!;
      assert.equal(described.enabled, false);
      assert.deepEqual(described.accountIds, [account.id]);
      for (const caller of [admin, principal]) {
        assert.throws(() => engine.create(caller, { actionId: action.id, accountId: account.id, input: draftExample(action.id) ?? { date: '2026-10-14' }, idempotencyKey: randomUUID() }), (e: unknown) => e instanceof ActionError && e.code === 'NOT_IMPLEMENTED');
      }
      assert.throws(() => engine.release(action.id));
    }
    await engine.idle();
    assert.equal(executorCalls, 0);
    assert.equal(engine.jobs().length, 0);
    assert.equal(store.list('evidence').length, 0);
    assert.equal(engine.metrics().verifiedServices, 0);
    assert.equal(engine.metrics().supportedActions, 0);
  } finally { await engine.close(); store.close(); }
});

test('HTTP restricts planning to admins and prevents unconfigured scoped actions from contacting providers', async () => {
  let providerCalls = 0;
  const fetcher = (async () => { providerCalls++; throw new Error('Draft must not call a provider'); }) as typeof fetch;
  const r = await createRuntime({ dataDir: mkdtempSync(join(tmpdir(), 'koreai-api-expansion-')), port: 0, vault: new TestVault(), fetcher, bootstrapCode: 'draft-bootstrap', evidenceMode: 'mock' });
  try {
    assert.equal((await fetch(`${r.baseUrl}/api/backlog`)).status, 401);
    const bootstrap = await fetch(`${r.baseUrl}/api/bootstrap`, { method: 'POST', headers: { Origin: r.baseUrl, 'Content-Type': 'application/json' }, body: JSON.stringify({ code: r.bootstrapCode }) });
    assert.equal(bootstrap.status, 200);
    const cookie = bootstrap.headers.get('set-cookie')!.split(';')[0]!;
    const call = (path: string, method = 'GET', body?: unknown, token?: string) => fetch(`${r.baseUrl}/api${path}`, { method, headers: { Origin: r.baseUrl, ...(token ? { Authorization: `Bearer ${token}` } : { Cookie: cookie }), ...(body === undefined ? {} : { 'Content-Type': 'application/json' }) }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
    const backlog = await (await call('/backlog')).json(); assert.equal(backlog.length, 26);
    const state = await (await call('/state')).json();
    assert.equal(state.actions.filter((a: { method: string; implemented: boolean }) => a.method === 'api' && a.implemented).length, 29);
    assert.equal(state.backlog.length, 26);
    const example = await (await call('/drafts/kma.observation/example')).json();
    const preview = await call('/drafts/kma.observation/preview', 'POST', example);
    assert.equal(preview.status, 200); assert.equal((await preview.json()).networkDispatched, false);
    assert.equal((await call('/drafts/kma.observation/preview', 'POST', { ...example, serviceKey: 'never-accepted-in-input' })).status, 400);
    assert.equal((await call('/drafts/band.publish/example')).status, 404);
    assert.equal((await call('/drafts/band.publish/preview', 'POST', {})).status, 404);
    const client = r.engine.createClient({ name: 'limited draft client', allowedActions: ['kobis.boxoffice.daily'], allowedAccountIds: [] });
    const actions = await (await call('/actions', 'GET', undefined, client.token)).json();
    assert.deepEqual(actions.map((a: { id: string }) => a.id), ['kobis.boxoffice.daily']); assert.equal(actions[0].enabled, false);
    assert.equal((await call('/backlog', 'GET', undefined, client.token)).status, 403);
    assert.equal((await call('/drafts/kma.observation/example', 'GET', undefined, client.token)).status, 403);
    assert.equal((await call('/drafts/kma.observation/preview', 'POST', example, client.token)).status, 403);
    const blocked = await call('/jobs', 'POST', { actionId: 'kobis.boxoffice.daily', input: draftExample('kobis.boxoffice.daily'), idempotencyKey: randomUUID() }, client.token);
    assert.equal(blocked.status, 409); assert.equal((await blocked.json()).error.code, 'ACCOUNT_REQUIRED');
    assert.equal(providerCalls, 0); assert.equal(r.engine.jobs().length, 0); assert.equal(r.store.list('evidence').length, 0);
  } finally { await r.close(); }
});
