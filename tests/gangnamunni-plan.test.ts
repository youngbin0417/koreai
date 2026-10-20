import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { createRuntime } from '../src/http.js';
import { admin } from '../src/core/engine.js';
import { ActionError } from '../src/types.js';
import { gangnamunni } from '../src/connectors/lifestyle/gangnamunni.js';
import { LifestyleConnections } from '../src/connectors/lifestyle/index.js';
import { gangnamunniHospitalAction, gangnamunniHospitalPlan, gangnamunniHospitalInput, gangnamunniHospitalOutput, gangnamunniReadPlanExecutor } from '../src/connectors/lifestyle/gangnamunni-read.js';
import { TestVault, tempDir } from './helpers.js';

test('Gangnam Unni proposes a bounded public hospital contract without accepting keys, private records or arbitrary URLs', () => {
  assert.deepEqual(gangnamunniHospitalInput.parse({ query: ' 피부과 ', region: '강남역' }), { query: '피부과', region: '강남역', limit: 5 });
  for (const value of [{ query: '' }, { query: 'x'.repeat(101) }, { query: '피부과', region: '' }, { query: '피부과', limit: 0 }, { query: '피부과', limit: 21 }, { query: '피부과', apiKey: 'private-key' }, { query: '피부과', cookie: 'session' }, { query: '피부과', patientId: '1' }, { query: '피부과', url: 'https://evil.example' }]) assert.equal(gangnamunniHospitalInput.safeParse(value).success, false);
  assert.equal(gangnamunniHospitalPlan.access, 'provider-confirmation-required'); assert.equal(gangnamunniHospitalPlan.state, 'defined');
  assert.deepEqual(gangnamunniHospitalAction.requiredSecrets, []); assert.equal(gangnamunniHospitalAction.credentialType, undefined); assert.equal(gangnamunniHospitalAction.implemented, false); assert.equal(gangnamunniHospitalAction.method, 'partnership');
  assert.deepEqual(gangnamunniHospitalAction.inputSchema, gangnamunniHospitalPlan.inputSchema); assert(gangnamunniHospitalInput.safeParse(gangnamunniHospitalPlan.example).success);
});

test('Gangnam Unni proposed results preserve missing fields and require official hospital detail links and consistent status', () => {
  // Synthetic contract examples only; no real hospital or provider response is represented here.
  const hospital = { providerId: null, name: '시험 병원', locationText: null, sourceUrl: 'https://unni.app/hospitals/test-clinic' };
  const sample = { status: 'available', hospitals: [hospital], retrievedAt: '2026-10-15T00:00:00.000Z', providerUpdatedAt: null };
  assert(gangnamunniHospitalOutput.safeParse(sample).success);
  for (const url of ['invalid', 'http://unni.app/hospitals/test', 'https://evil.example/hospitals/test', 'https://unni.app.evil.example/hospitals/test', 'https://user:secret@unni.app/hospitals/test', 'https://unni.app:8443/hospitals/test', 'https://unni.app/search', 'https://unni.app/hospitals/test?cookie=secret']) assert.equal(gangnamunniHospitalOutput.safeParse({ ...sample, hospitals: [{ ...hospital, sourceUrl: url }] }).success, false);
  assert.equal(gangnamunniHospitalOutput.safeParse({ ...sample, status: 'no_data' }).success, false);
  assert(gangnamunniHospitalOutput.safeParse({ ...sample, status: 'no_data', hospitals: [] }).success);
  assert.equal(gangnamunniHospitalOutput.safeParse({ ...sample, hospitals: [{ ...hospital, patientRecords: [] }] }).success, false);
});

test('Gangnam Unni plan stays disabled for admins and scoped agents, creates no jobs/evidence and cannot dispatch through its executor', async () => {
  let calls = 0;
  const r = await createRuntime({ dataDir: tempDir('unni-plan'), port: 0, vault: new TestVault(), evidenceMode: 'live', fetcher: async () => { calls++; throw new Error('No provider calls expected'); } });
  try {
    const client = r.engine.createClient({ name: 'hospital planner', allowedActions: [gangnamunniHospitalAction.id] }), principal = r.engine.authenticate(client.token)!;
    for (const caller of [admin, principal]) {
      const described = r.engine.discover(caller, '', 'gangnamunni').find(action => action.id === gangnamunniHospitalAction.id)!;
      assert.equal(described.enabled, false); assert.equal(described.implemented, false);
      assert.throws(() => r.engine.create(caller, { actionId: described.id, input: gangnamunniHospitalPlan.example, idempotencyKey: randomUUID() }), (error: unknown) => error instanceof ActionError && error.code === 'NOT_IMPLEMENTED');
    }
    await assert.rejects(() => gangnamunniReadPlanExecutor(gangnamunniHospitalAction, { job: {} as never, secrets: {}, signal: new AbortController().signal, dispatch: () => { calls++; } }), (error: unknown) => error instanceof ActionError && error.code === 'NOT_IMPLEMENTED');
    const basic = new LifestyleConnections(r.store); basic.prepare('gangnamunni', { routeId: 'hospitals' });
    await assert.rejects(() => basic.execute(gangnamunniHospitalAction, { job: {} as never, secrets: {}, signal: new AbortController().signal, dispatch: () => { calls++; } }), (error: unknown) => error instanceof ActionError && error.code === 'NOT_IMPLEMENTED');
    assert.throws(() => r.engine.release(gangnamunniHospitalAction.id)); await r.engine.idle();
    assert.equal(calls, 0); assert.equal(r.engine.jobs().length, 0); assert.equal(r.store.list('evidence').length, 0); assert.equal(r.engine.metrics().verifiedServices, 0); assert.equal(r.engine.metrics().supportedActions, 0);
    assert.equal(r.engine.discover(admin).filter(action => action.method === 'api' && action.implemented && !action.unavailable).length, 45);
  } finally { await r.close(); }
});

test('Gangnam Unni HTTP exposes the plan with connection scope and opens the chosen canonical hospital list without provider requests', async () => {
  let calls = 0;
  const r = await createRuntime({ dataDir: tempDir('unni-plan-http'), port: 0, vault: new TestVault(), evidenceMode: 'mock', fetcher: async () => { calls++; throw new Error('No provider calls expected'); } });
  try {
    const login = await fetch(`${r.baseUrl}/api/bootstrap`, { method: 'POST', headers: { Origin: r.baseUrl, 'Content-Type': 'application/json' }, body: JSON.stringify({ code: r.bootstrapCode }) }), cookie = login.headers.get('set-cookie')!.split(';')[0]!;
    const api = (path: string, method = 'GET', body?: unknown, token?: string) => fetch(`${r.baseUrl}/api${path}`, { method, headers: { Origin: r.baseUrl, ...(token ? { Authorization: `Bearer ${token}` } : { Cookie: cookie }), ...(body === undefined ? {} : { 'Content-Type': 'application/json' }) }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
    const client = r.engine.createClient({ name: 'Unni reader', allowedActions: ['gangnamunni.connection.status', 'gangnamunni.connection.open', gangnamunniHospitalAction.id] });
    const connections = await (await api('/connections', 'GET', undefined, client.token)).json(); assert.equal(connections.length, 1);
    const connection = connections[0]; assert.equal(connection.firstRead.actionId, gangnamunniHospitalAction.id); assert.equal(connection.firstRead.state, 'defined'); assert.equal(connection.stages.find((stage: { id: string }) => stage.id === 'read').state, 'defined'); assert.equal(connection.automaticActions, 0); assert.equal(connection.accountVerified, false);
    assert.equal(gangnamunni.routes[0].url, 'https://unni.app/'); assert(gangnamunni.domains.includes('unni.app'));
    assert.equal((await api('/connections/gangnamunni', 'PUT', { routeId: 'hospitals' }, client.token)).status, 403);
    assert.equal((await api('/connections/gangnamunni', 'PUT', { routeId: 'hospitals' })).status, 200);
    const blocked = await api('/jobs', 'POST', { actionId: gangnamunniHospitalAction.id, input: gangnamunniHospitalPlan.example, idempotencyKey: randomUUID() }, client.token); assert.equal(blocked.status, 409); assert.equal((await blocked.json()).error.code, 'NOT_IMPLEMENTED');
    const job = await (await api('/jobs', 'POST', { actionId: 'gangnamunni.connection.open', input: {}, idempotencyKey: randomUUID() }, client.token)).json(); await r.engine.idle();
    const result = await (await api(`/jobs/${job.id}`, 'GET', undefined, client.token)).json(); assert.equal(result.state, 'succeeded'); assert.equal(result.dispatched, false); assert.equal(result.result.data.url, 'https://unni.app/hospitals'); assert.equal(result.result.data.externalActionExecuted, false);
    assert.equal(calls, 0); assert.equal(r.engine.metrics().verifiedServices, 0); assert.equal(r.engine.metrics().supportedActions, 0);
  } finally { await r.close(); }
});
