import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { appApiBacklog } from '../src/research/app-api-backlog.js';
import { services } from '../src/catalog.js';
import { createRuntime } from '../src/http.js';
import { TestVault, tempDir } from './helpers.js';
import { runtimeApi, runtimeLogin } from './mcp-oauth-fixture.js';

test('Aladin shutdown notice retains official dates and does not advertise new TTB key registration or implementations', () => {
  const candidate = appApiBacklog.find(item => item.serviceId === 'aladin')!;
  assert.equal(candidate.notice?.newKeysClosedOn, '2026-09-04'); assert.equal(candidate.notice.existingAccessEndsOn, '2026-10-30'); assert.equal(candidate.checkedAt, '2026-10-19');
  assert.equal(candidate.sourceUrl, 'https://blog.aladin.co.kr/openapi/5353304'); assert.equal(candidate.implementedActionIds.length, 0); assert.equal(candidate.draftActionIds.length, 0);
  assert(candidate.connectionPlan!.requiredAccess.includes('신규 연결 미지원')); assert(candidate.nextStep.includes('도서관 정보나루')); assert(services.find(item => item.id === 'aladin')!.note.includes('종료'));
});
test('Aladin HTTP exposes the shutdown notice but creates no executable action, API call or support evidence', async () => {
  let calls = 0; const r = await createRuntime({ dataDir: tempDir('aladin-notice'), port: 0, vault: new TestVault(), evidenceMode: 'mock', fetcher: async () => { calls++; throw Error('Unexpected request'); } });
  try {
    const cookie = await runtimeLogin(r), state = await (await runtimeApi(r, '/api/state', 'GET', undefined, cookie)).json();
    assert.equal(state.backlog.find((candidate: {serviceId:string}) => candidate.serviceId === 'aladin').notice.type, 'shutdown');
    assert.equal(state.actions.filter((action: {serviceId:string}) => action.serviceId === 'aladin').length, 0);
    for (const id of ['aladin.books.search','aladin.books.get']) assert.equal((await runtimeApi(r, '/api/jobs', 'POST', { actionId: id, input: {}, idempotencyKey: randomUUID() }, cookie)).status, 404);
    assert.equal(calls, 0); assert.equal(r.engine.metrics().verifiedServices, 0); assert.equal(r.engine.jobs().length, 0);
  } finally { await r.close(); }
});
