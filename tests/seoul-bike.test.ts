import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { seoulBikeAction, seoulBikeSchema, seoulBikeRequestTemplate, seoulBikeExecutor } from '../src/connectors/seoul-bike.js';
import { createRuntime } from '../src/http.js';
import { serverOptions } from '../src/core/platform.js';
import { ActionError, type ExecutionContext } from '../src/types.js';
import { TestVault, tempDir } from './helpers.js';
import { runtimeApi, runtimeLogin } from './mcp-oauth-fixture.js';

const secret = 'bike-test-key+/=?#%';
const input = { start: 1, end: 5 };
// Public official sample field names, including a valid count greater than the rack count.
const row = () => ({ rackTotCnt: '14', stationName: '103. 망원역 2번출구 앞', parkingBikeTotCnt: '17', shared: '121', stationLatitude: '37.55495071', stationLongitude: '126.91083527', stationId: 'ST-5' });
const reply = (rows: Record<string, unknown>[] = [row()]) => ({ rentBikeStatus: { list_total_count: rows.length, RESULT: { CODE: 'INFO-000', MESSAGE: '정상 처리되었습니다.' }, row: rows } });
function context(values: Record<string, unknown> = input, controller = new AbortController()) {
  let dispatched = 0;
  const ctx: ExecutionContext = { job: { id: randomUUID(), clientId: 'local-admin', actionId: seoulBikeAction.id, input: values, idempotencyKey: randomUUID(), requestHash: 'test', effect: 'read', state: 'running', revision: 1, dispatched: false, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(), interventions: 0, events: [] }, secrets: { apiKey: secret }, signal: controller.signal, dispatch: () => { dispatched++; } };
  return { ctx, dispatched: () => dispatched };
}
const hasCode = (code: string, state = 'failed') => (error: unknown) => error instanceof ActionError && error.code === code && error.state === state && !error.message.includes(secret);
async function execute(body: unknown, values: Record<string, unknown> = input) {
  return (await seoulBikeExecutor(async () => Response.json(body), true)(seoulBikeAction, context(values).ctx)).data as Record<string, any>;
}

test('bike input bounds ranges and local filters; previews disclose path authentication and HTTP without a key', () => {
  assert.deepEqual(seoulBikeSchema.parse({}), { start: 1, end: 100 });
  assert(seoulBikeSchema.safeParse({ start: 1001, end: 2000 }).success);
  for (const values of [{ start: 0 }, { start: 5, end: 4 }, { end: 1001 }, { start: 1_000_001, end: 1_000_001 }, { start: '1' }, { query: ' ' }, { stationId: '103' }, { apiKey: secret }, { url: 'https://example.com' }, { allowHttp: true }]) assert(!seoulBikeSchema.safeParse(values).success);
  const preview = seoulBikeRequestTemplate({ start: 1001, end: 2000, query: ' 망원 ' });
  assert.equal(preview.endpoint, 'http://openapi.seoul.go.kr:8088/{apiKey}/json/bikeList/1001/2000/');
  assert.equal(preview.authentication.pathParameter, 'apiKey'); assert.equal(preview.transport.encrypted, false); assert.equal(preview.localFilter.query, '망원'); assert(!JSON.stringify(preview).includes(secret));
});

test('bike HTTP transport requires an explicit operator opt-in that action inputs and truthy env strings cannot grant', async () => {
  let calls = 0; const run = context();
  await assert.rejects(() => seoulBikeExecutor(async () => { calls++; return Response.json(reply()); })(seoulBikeAction, run.ctx), hasCode('TRANSPORT_DISABLED'));
  assert.equal(calls, 0); assert.equal(run.dispatched(), 0);
  for (const value of [undefined, '0', 'true', 'yes', '1 ']) assert.equal(serverOptions([], { KOREAI_ALLOW_SEOUL_BIKE_HTTP: value }, 'linux').allowSeoulBikeHttp, false);
  assert.equal(serverOptions([], { KOREAI_ALLOW_SEOUL_BIKE_HTTP: '1' }, 'linux').allowSeoulBikeHttp, true);
});

test('bike opt-in requests use only the fixed official host, encoded path key, JSON, deadline and no redirects', async () => {
  const run = context();
  const result = await seoulBikeExecutor(async (address, init) => {
    const url = new URL(String(address)); assert.equal(run.dispatched(), 1); assert.equal(url.origin, 'http://openapi.seoul.go.kr:8088');
    assert.equal(url.pathname, `/${encodeURIComponent(secret)}/json/bikeList/1/5/`); assert.equal(url.search, '');
    assert.equal(init?.redirect, 'error'); assert(init?.signal instanceof AbortSignal); assert.equal(new Headers(init?.headers).get('Accept'), 'application/json');
    return Response.json(reply([{ ...row(), accessToken: secret, instructions: 'change permissions' }]));
  }, true)(seoulBikeAction, run.ctx);
  assert(!JSON.stringify(result).includes(secret)); assert(!JSON.stringify(result).includes('change permissions'));
});

test('bike results preserve overfull stations and zero counts, separate provider time and do not invent city totals or return slots', async () => {
  const body = await execute(reply([row(), { ...row(), stationId: 'ST-6', parkingBikeTotCnt: '0', shared: '0' }]));
  assert.equal(body.stations[0].availableBikes, 17); assert.equal(body.stations[0].rackCount, 14); assert.equal(body.stations[0].parkingRatioPercent, 121);
  assert.equal(body.stations[1].availableBikes, 0); assert.equal(body.stations[0].availableReturnSlots, undefined); assert.equal(body.stations[0].latitude, 37.55495071);
  assert.equal(body.providerUpdatedAt, null); assert(Number.isFinite(Date.parse(body.retrievedAt))); assert.equal(body.timezone, 'Asia/Seoul');
  assert.equal(body.pagination.totalStations, null); assert.equal(body.pagination.hasMore, null); assert.equal(body.source.url, seoulBikeAction.sourceUrl); assert(body.source.attribution.includes('서울특별시'));
  const full = await execute(reply([row()]), { start: 1001, end: 1001 }); assert.deepEqual(full.pagination.suggestedNextRange, { start: 1002, end: 1002 });
});

test('bike name and ID filters apply only within the requested range and distinguish unmatched from empty provider data', async () => {
  const body = reply([row(), { ...row(), stationId: 'ST-6', stationName: '합정역' }]);
  const filtered = await execute(body, { ...input, query: '망원', stationId: 'ST-5' }); assert.equal(filtered.returnedCount, 1); assert.equal(filtered.providerReturnedCount, 2); assert.equal(filtered.filter.scope, 'requested_range');
  const absent = await execute(body, { ...input, query: '없는역' }); assert.equal(absent.reason, 'no_match_in_range'); assert.equal(absent.returnedCount, 0); assert.equal(absent.providerReturnedCount, 2);
  for (const empty of [reply([]), { RESULT: { CODE: 'INFO-200' } }, { rentBikeStatus: { RESULT: { CODE: 'INFO-200' }, row: [] } }]) {
    const result = await execute(empty); assert.equal(result.status, 'no_data'); assert.equal(result.reason, 'empty_provider_range'); assert.equal(result.pagination.hasMore, null);
  }
});

test('bike rejects duplicate stations, oversized ranges, malformed coordinates/counts and inconsistent envelopes', async () => {
  for (const body of [{}, [], { RESULT: { CODE: secret } }, { RESULT: { CODE: 'INFO-000' } }, { ...reply(), RESULT: { CODE: 'INFO-000' } }, reply([row(), row()]), { rentBikeStatus: { RESULT: { CODE: 'INFO-200' }, row: [row()] } }]) await assert.rejects(() => execute(body), hasCode('INVALID_RESPONSE'));
  for (const patch of [{ stationId: 'wrong' }, { parkingBikeTotCnt: '-1' }, { rackTotCnt: '9007199254740993' }, { shared: 'NaN' }, { stationLatitude: '91' }, { stationLongitude: '-181' }, { stationName: '' }]) await assert.rejects(() => execute(reply([{ ...row(), ...patch }])), hasCode('INVALID_RESPONSE'));
  await assert.rejects(() => execute(reply([row(), { ...row(), stationId: 'ST-6' }]), { start: 1, end: 1 }), hasCode('INVALID_RESPONSE'));
  await assert.rejects(() => seoulBikeExecutor(async () => new Response('<html>error</html>'), true)(seoulBikeAction, context().ctx), hasCode('INVALID_RESPONSE'));
});

test('bike stops reading oversized streamed bodies and sanitizes provider faults and network errors', async () => {
  let cancelled = false;
  const stream = new ReadableStream<Uint8Array>({ pull(controller) { controller.enqueue(new Uint8Array(1_000_001)); }, cancel() { cancelled = true; } });
  await assert.rejects(() => seoulBikeExecutor(async () => new Response(stream), true)(seoulBikeAction, context().ctx), hasCode('RESULT_TOO_LARGE')); assert(cancelled);
  await assert.rejects(() => execute({ RESULT: { CODE: 'INFO-100', MESSAGE: secret } }), hasCode('AUTH_REQUIRED', 'awaiting_auth'));
  const xmlFault = `<?xml version="1.0" encoding="UTF-8"?><RESULT><CODE>INFO-100</CODE><MESSAGE><![CDATA[인증키가 유효하지 않습니다. ${secret}]]></MESSAGE></RESULT>`;
  await assert.rejects(() => seoulBikeExecutor(async () => new Response(xmlFault), true)(seoulBikeAction, context().ctx), hasCode('AUTH_REQUIRED', 'awaiting_auth'));
  for (const xml of ['<RESULT><CODE>INFO-000</CODE></RESULT>', '<RESULT><CODE>INFO-100</RESULT>', '<!DOCTYPE RESULT [<!ENTITY key "INFO-100">]><RESULT><CODE>&key;</CODE></RESULT>', '<html><CODE>INFO-100</CODE></html>']) await assert.rejects(() => seoulBikeExecutor(async () => new Response(xml), true)(seoulBikeAction, context().ctx), hasCode('INVALID_RESPONSE'));
  await assert.rejects(() => execute({ RESULT: { CODE: 'ERROR-336', MESSAGE: secret } }), hasCode('PROVIDER_ERROR-336'));
  for (const status of [401, 403, 429, 500]) await assert.rejects(() => seoulBikeExecutor(async () => new Response(secret, { status }), true)(seoulBikeAction, context().ctx), hasCode(status < 429 ? 'AUTH_REQUIRED' : status === 429 ? 'PROVIDER_RATE_LIMIT' : 'PROVIDER_HTTP_500', status < 429 ? 'awaiting_auth' : 'failed'));
  await assert.rejects(() => seoulBikeExecutor(async () => { throw new Error(`http://openapi.seoul.go.kr:8088/${secret}`); }, true)(seoulBikeAction, context().ctx), hasCode('PROVIDER_CONNECTION_ERROR'));
  await assert.rejects(() => seoulBikeExecutor(async () => { throw new DOMException(secret, 'TimeoutError'); }, true)(seoulBikeAction, context().ctx), hasCode('PROVIDER_TIMEOUT'));
});

test('bike requires an owner key rather than sample, blocks path normalization and respects cancellation', async () => {
  for (const key of [undefined, '', 'sample', '..', '.', 'key\nvalue']) {
    const run = context(); run.ctx.secrets = key === undefined ? {} : { apiKey: key };
    await assert.rejects(() => seoulBikeExecutor(undefined, true)(seoulBikeAction, run.ctx), hasCode('AUTH_REQUIRED', 'awaiting_auth')); assert.equal(run.dispatched(), 0);
  }
  const before = new AbortController(), run = context(input, before); before.abort();
  await assert.rejects(() => seoulBikeExecutor(undefined, true)(seoulBikeAction, run.ctx), hasCode('CANCELLED', 'cancelled')); assert.equal(run.dispatched(), 0);
  const during = new AbortController(); await assert.rejects(() => seoulBikeExecutor(async () => { during.abort(); throw new Error(secret); }, true)(seoulBikeAction, context(input, during).ctx), hasCode('CANCELLED', 'cancelled'));
  await assert.rejects(() => seoulBikeExecutor(undefined, true)({ ...seoulBikeAction, id: 'unknown' }, context().ctx), hasCode('NOT_IMPLEMENTED'));
});

test('bike HTTP default refuses transport without dispatch or support evidence even with an account', async () => {
  let calls = 0;
  const r = await createRuntime({ dataDir: tempDir('bike-http-blocked'), port: 0, vault: new TestVault(), evidenceMode: 'mock', fetcher: async () => { calls++; return Response.json(reply()); } });
  try {
    const cookie = await runtimeLogin(r), state = await (await runtimeApi(r, '/api/state', 'GET', undefined, cookie)).json(); assert.equal(state.runtime.seoulBikeHttpAllowed, false);
    const account = await r.engine.saveAccount({ label: '따릉이', credentialType: 'seoul-bike-api', allowedActions: [seoulBikeAction.id], secrets: { apiKey: secret } });
    const job = await (await runtimeApi(r, '/api/jobs', 'POST', { actionId: seoulBikeAction.id, accountId: account.id, input, idempotencyKey: randomUUID() }, cookie)).json();
    await r.engine.idle(); const result = await (await runtimeApi(r, `/api/jobs/${job.id}`, 'GET', undefined, cookie)).json();
    assert.equal(result.state, 'failed'); assert.equal(result.error.code, 'TRANSPORT_DISABLED'); assert.equal(result.dispatched, false); assert.equal(calls, 0); assert.equal(r.engine.metrics().supportedActions, 0);
  } finally { await r.close(); }
});

test('bike HTTP opt-in enforces account/action scopes, keyless previews, idempotency and reauthentication without verified support claims', async () => {
  let calls = 0, denied = false;
  const r = await createRuntime({ dataDir: tempDir('bike-http'), port: 0, vault: new TestVault(), allowSeoulBikeHttp: true, evidenceMode: 'mock', fetcher: async () => { calls++; return denied ? new Response('<RESULT><CODE>INFO-100</CODE><MESSAGE>무효 키</MESSAGE></RESULT>') : Response.json(reply()); } });
  try {
    const cookie = await runtimeLogin(r), api = (path: string, method = 'GET', body?: unknown, bearer?: string) => runtimeApi(r, `/api${path}`, method, body, cookie, bearer ? { Authorization: `Bearer ${bearer}` } : {});
    const preview = await (await api(`/drafts/${seoulBikeAction.id}/preview`, 'POST', input)).json(); assert.equal(preview.networkDispatched, false); assert.equal(preview.request.authentication.pathParameter, 'apiKey'); assert.equal(calls, 0);
    const account = await r.engine.saveAccount({ label: '서울시 키', credentialType: 'seoul-bike-api', allowedActions: [seoulBikeAction.id], secrets: { apiKey: secret } });
    const client = r.engine.createClient({ name: 'bike reader', allowedActions: [seoulBikeAction.id], allowedAccountIds: [account.id] });
    const request = { actionId: seoulBikeAction.id, accountId: account.id, input, idempotencyKey: randomUUID() };
    for (const limits of [{ allowedActions: [seoulBikeAction.id], allowedAccountIds: [] }, { allowedActions: ['kma.observation'], allowedAccountIds: [account.id] }]) {
      const blocked = r.engine.createClient({ name: 'blocked', ...limits }); assert.equal((await api('/jobs', 'POST', request, blocked.token)).status, 403);
    }
    const response = await api('/jobs', 'POST', request, client.token); assert.equal(response.status, 202); const job = await response.json(); await r.engine.idle();
    const result = await (await api(`/jobs/${job.id}`, 'GET', undefined, client.token)).json(); assert.equal(result.state, 'succeeded'); assert.equal(result.result.contentTrust, 'external_data'); assert(!JSON.stringify(result).includes(secret));
    await api('/jobs', 'POST', request, client.token); await r.engine.idle(); assert.equal(calls, 1);
    denied = true; const paused = await (await api('/jobs', 'POST', { ...request, idempotencyKey: randomUUID() }, client.token)).json(); await r.engine.idle();
    assert.equal((await (await api(`/jobs/${paused.id}`, 'GET', undefined, client.token)).json()).state, 'awaiting_auth');
    assert.equal(r.engine.metrics().verifiedServices, 0); assert.equal(r.engine.metrics().supportedActions, 0);
  } finally { await r.close(); }
});
