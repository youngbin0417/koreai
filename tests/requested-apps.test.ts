import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { requestedApps } from '../src/research/requested-apps.js';
import { appApiBacklog } from '../src/research/app-api-backlog.js';
import { services } from '../src/catalog.js';
import { createRuntime } from '../src/http.js';
import { admin } from '../src/core/engine.js';
import { TestVault, tempDir } from './helpers.js';
import { runtimeApi, runtimeLogin } from './mcp-oauth-fixture.js';

test('all 36 requested apps merge into unique catalog/backlog entries and retain activation boundaries', () => {
  assert.equal(requestedApps.length, 36); assert.equal(services.length, 99); assert.equal(appApiBacklog.length, 59);
  assert.equal(new Set(services.map(service => service.id)).size, services.length);
  for (const request of requestedApps) {
    const service = services.find(item => item.id === request.serviceId), candidate = appApiBacklog.find(item => item.serviceId === request.serviceId);
    assert(service); assert(candidate); assert.deepEqual(candidate.connectionPlan, request.plan); assert(candidate.proposedActions.includes(request.plan.firstRead));
    assert.equal(candidate.implementedActionIds.length, request.serviceId === 'seoul-bike' ? 1 : request.serviceId === 'chzzk' ? 2 : request.serviceId === 'animal-hospitals' ? 1 : 0); assert.equal(candidate.draftActionIds.length, 0);
    assert(request.sourceUrl.startsWith('https://')); assert(request.plan.resultCheck.length > 20); assert(request.plan.requiredAccess); assert(request.plan.nextStep);
  }
  assert.equal(services.filter(service => service.id === 'nol').length, 1); assert(services.find(service => service.id === 'nol')!.aliases!.includes('야놀자'));
  for (const id of ['aladin', 'chzzk', 'animal-hospitals', 'seoul-bike']) assert.equal(appApiBacklog.find(candidate => candidate.serviceId === id)!.verification, 'documented');
  for (const id of ['kream', 'kyobo', 'wetax', 'gasapp', 'tworld', 'mypetplus', 'animal-clinic-fees']) assert.equal(appApiBacklog.find(candidate => candidate.serviceId === id)!.verification, 'unresearched');
  assert(appApiBacklog.find(candidate => candidate.serviceId === 'seoul-bike')!.documentedScope!.includes('실시간'));
  assert(requestedApps.find(item => item.serviceId === 'animal-hospitals')!.plan.resultCheck.includes('현재 진료'));
  assert(requestedApps.find(item => item.serviceId === 'animal-clinic-fees')!.plan.resultCheck.includes('특정 병원'));
});

test('HTTP exposes requested plans and reviewed actions without provider calls, grants or support evidence', async () => {
  let calls = 0; const fetcher: typeof fetch = async () => { calls++; throw new Error('Unexpected provider request'); };
  const r = await createRuntime({ dataDir: tempDir('requested-apps'), port: 0, vault: new TestVault(), fetcher, aiFetcher: fetcher, evidenceMode: 'mock' });
  try {
    const cookie = await runtimeLogin(r), state = await (await runtimeApi(r, '/api/state', 'GET', undefined, cookie)).json();
    assert.equal(state.services.length, 99); assert.equal(state.backlog.filter((entry: {connectionPlan?:unknown}) => entry.connectionPlan).length, 36);
    assert.equal(r.engine.discover(admin).filter(action => action.method === 'api' && action.implemented).length, 38);
    assert.equal(r.engine.discover(admin).filter(action => action.method === 'handoff').length, 10);
    const ids = new Set(requestedApps.map(item => item.serviceId)); assert.deepEqual(r.engine.discover(admin).filter(action => ids.has(action.serviceId)).map(action => action.id).sort(), ['animal-hospitals.search', 'chzzk.channels.get', 'chzzk.lives.list', 'seoul-bike.stations']);
    for (const id of ['musinsa.products.search', 'gasapp.bills.list']) assert.equal((await runtimeApi(r, '/api/jobs', 'POST', { actionId: id, input: {}, idempotencyKey: randomUUID() }, cookie)).status, 404);
    assert.equal(calls, 0); assert.equal(r.engine.jobs().length, 0); assert.equal(r.engine.metrics().verifiedServices, 0); assert.equal(r.store.list('evidence').length, 0);
  } finally { await r.close(); }
});
