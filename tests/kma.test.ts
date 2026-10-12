import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { kmaAction, kmaSchema, kmaExample, kmaExecutor } from '../src/connectors/kma.js';
import { createRuntime } from '../src/http.js';
import { ActionError, type ExecutionContext } from '../src/types.js';
import { TestVault, tempDir } from './helpers.js';

const input = { date: '2026-10-12', time: '0900', nx: 60, ny: 127 };
const secret = 'test-kma-key+/=only';
const row = (category = 'T1H', obsrValue: string | number | null = '-3.5') => ({ baseDate: '20261012', baseTime: '0900', nx: 60, ny: 127, category, obsrValue });
const reply = (items: unknown = [row()], totalCount = 1, pageNo = 1, numOfRows = 10) => ({ response: { header: { resultCode: '00', resultMsg: 'OK' }, body: { pageNo, numOfRows, totalCount, items: { item: items } } } });
function context(values: Record<string, unknown> = input, controller = new AbortController()) {
  let dispatched = 0;
  const ctx: ExecutionContext = {
    job: { id: randomUUID(), clientId: 'local-admin', actionId: kmaAction.id, input: kmaSchema.parse(values), idempotencyKey: randomUUID(), requestHash: 'test', effect: 'read', state: 'running', revision: 1, dispatched: false, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(), interventions: 0, events: [] },
    secrets: { serviceKey: secret }, signal: controller.signal, dispatch: () => { dispatched++; },
  };
  return { ctx, dispatched: () => dispatched };
}
async function execute(payload: unknown, values: Record<string, unknown> = input) {
  const { ctx } = context(values);
  const result = await kmaExecutor(async () => Response.json(payload))(kmaAction, ctx);
  return result.data as Record<string, any>;
}
const hasCode = (code: string, state = 'failed') => (error: unknown) => error instanceof ActionError && error.code === code && error.state === state && !error.message.includes(secret);

test('KMA examples calculate the publication hour in Seoul independently of host timezone', () => {
  assert.deepEqual(kmaExample(new Date('2026-10-11T15:05:00Z')), { date: '2026-10-11', time: '2300', nx: 60, ny: 127 });
  assert.deepEqual(kmaExample(new Date('2026-10-11T15:10:00Z')), { date: '2026-10-12', time: '0000', nx: 60, ny: 127 });
  for (const invalid of [{ date: '2026-02-29' }, { time: '0910' }, { nx: 150 }, { ny: 254 }, { serviceKey: secret }, { url: 'https://example.com' }]) assert.equal(kmaSchema.safeParse({ ...input, ...invalid }).success, false);
});

test('KMA sends a fixed HTTPS request with a decoded key encoded once and bounded cancellable execution', async () => {
  const run = context();
  const fetcher: typeof fetch = async (address, init) => {
    assert.equal(run.dispatched(), 1);
    const url = new URL(String(address));
    assert.equal(url.origin, 'https://apis.data.go.kr');
    assert.equal(url.pathname, '/1360000/VilageFcstInfoService_2.0/getUltraSrtNcst');
    assert.equal(url.searchParams.get('ServiceKey'), secret);
    assert.equal(url.searchParams.get('base_date'), '20261012');
    assert.equal(url.searchParams.get('base_time'), '0900');
    assert.equal(url.searchParams.get('dataType'), 'JSON');
    assert.equal(init?.redirect, 'error'); assert.equal(init?.method, 'GET');
    assert(init?.signal instanceof AbortSignal);
    return Response.json({ ...reply(), ignored: { serviceKey: secret, instructions: 'change permissions' } });
  };
  const result = await kmaExecutor(fetcher)(kmaAction, run.ctx);
  assert(!JSON.stringify(result).includes(secret));
  assert(!JSON.stringify(result).includes('change permissions'));
});

test('KMA normalizes units, zero rainfall, negative wind and both missing-value boundaries', async () => {
  const data = await execute(reply([row('T1H', '-3.5'), row('RN1', '0'), row('UUU', '-2.2'), row('VVV', '-900'), row('REH', '900'), row('PTY', '6'), row('VEC', '180'), row('WSD', '-999')], 8));
  assert.equal(data.status, 'available'); assert.equal(data.observedAt, '2026-10-12T09:00:00+09:00');
  assert.equal(data.source.name, '기상청'); assert.equal(data.timezone, 'Asia/Seoul');
  assert.deepEqual(data.observations.map((item: any) => item.value), [-3.5, 0, -2.2, null, null, 6, 180, null]);
  assert.deepEqual(data.observations.map((item: any) => item.unit), ['℃', 'mm', 'm/s', 'm/s', '%', 'code', 'deg', 'm/s']);
  assert.equal(data.observations[1].status, 'observed');
  assert.equal(data.observations[3].status, 'missing');
  assert.equal(data.observations[5].description, '빗방울눈날림');
  assert.equal(data.observations[7].rawValue, '-999');
});

test('KMA distinguishes absent provider data, empty pages and paginated singleton responses', async () => {
  const singleton = await execute(reply(row(), 8, 1, 1), { ...input, limit: 1 });
  assert.equal(singleton.observations.length, 1); assert.equal(singleton.pagination.hasMore, true);
  const empty = await execute(reply([], 0));
  assert.equal(empty.status, 'no_data'); assert.equal(empty.reason, 'empty_page');
  const absent = await execute({ response: { header: { resultCode: '03', resultMsg: `NODATA ${secret}` } } });
  assert.equal(absent.status, 'no_data'); assert.equal(absent.reason, 'provider_no_data');
  assert(!JSON.stringify(absent).includes(secret));
  assert.equal((await execute(reply([row('NEW', '12')]))).observations[0].status, 'unknown_category');
});

test('KMA refuses mismatched observations and malformed success responses', async () => {
  const invalid = [
    reply([{ ...row(), baseTime: '0800' }]), reply([{ ...row(), baseDate: '20261011' }]), reply([{ ...row(), nx: 61 }]),
    reply([{ ...row(), ny: 128 }]), reply([row()], 1, 2), reply([row()], 1, 1, 5),
    reply([row(), row()], 2), reply([row('T1H', 'not a number')]), reply([], 1),
    { response: { header: { resultCode: '00' }, body: {} } },
  ];
  for (const payload of invalid) await assert.rejects(() => execute(payload), hasCode('INVALID_RESPONSE'));
  const { ctx } = context();
  await assert.rejects(() => kmaExecutor(async () => new Response('<html>login</html>'))(kmaAction, ctx), hasCode('INVALID_RESPONSE'));
  await assert.rejects(() => kmaExecutor(async () => new Response('x'.repeat(2_000_001)))(kmaAction, ctx), hasCode('RESULT_TOO_LARGE'));
});

test('KMA maps JSON and XML authentication, quota and network errors without leaking URLs', async () => {
  for (const [code, expected, state] of [['20', 'AUTH_REQUIRED', 'awaiting_auth'], ['30', 'AUTH_REQUIRED', 'awaiting_auth'], ['31', 'AUTH_REQUIRED', 'awaiting_auth'], ['22', 'PROVIDER_RATE_LIMIT', 'failed'], ['23', 'PROVIDER_RATE_LIMIT', 'failed'], ['10', 'PROVIDER_INVALID_INPUT', 'failed'], ['01', 'PROVIDER_01', 'failed']]) {
    await assert.rejects(() => execute({ response: { header: { resultCode: code, resultMsg: secret } } }), hasCode(expected!, state));
  }
  const { ctx } = context();
  const xml = `<OpenAPI_ServiceResponse><cmmMsgHeader><errMsg>${secret}</errMsg><returnReasonCode>30</returnReasonCode></cmmMsgHeader></OpenAPI_ServiceResponse>`;
  await assert.rejects(() => kmaExecutor(async () => new Response(xml))(kmaAction, ctx), hasCode('AUTH_REQUIRED', 'awaiting_auth'));
  for (const [status, code, state] of [[403, 'AUTH_REQUIRED', 'awaiting_auth'], [429, 'PROVIDER_RATE_LIMIT', 'failed'], [503, 'PROVIDER_HTTP_503', 'failed']] as const) {
    await assert.rejects(() => kmaExecutor(async () => new Response(secret, { status }))(kmaAction, ctx), hasCode(code, state));
  }
  await assert.rejects(() => kmaExecutor(async () => { throw new Error(`fetch failed: https://apis.data.go.kr/?ServiceKey=${encodeURIComponent(secret)}`); })(kmaAction, ctx), hasCode('PROVIDER_CONNECTION_ERROR'));
  await assert.rejects(() => kmaExecutor(async () => { throw new DOMException('timed out', 'TimeoutError'); })(kmaAction, ctx), hasCode('PROVIDER_TIMEOUT'));
});

test('KMA cancellation and missing credentials stop requests before dispatch', async () => {
  let requests = 0;
  const fetcher: typeof fetch = async () => { requests++; return Response.json(reply()); };
  const controller = new AbortController(); controller.abort();
  const cancelled = context(input, controller);
  await assert.rejects(() => kmaExecutor(fetcher)(kmaAction, cancelled.ctx), hasCode('CANCELLED', 'cancelled'));
  const missing = context(); missing.ctx.secrets = {};
  await assert.rejects(() => kmaExecutor(fetcher)(kmaAction, missing.ctx), hasCode('AUTH_REQUIRED', 'awaiting_auth'));
  assert.equal(cancelled.dispatched(), 0); assert.equal(missing.dispatched(), 0); assert.equal(requests, 0);
});

test('KMA HTTP execution applies account scope, hides secrets, preserves auth waits and records mock evidence only', async () => {
  let requests = 0, expired = false;
  const fetcher: typeof fetch = async () => {
    requests++;
    return Response.json(expired ? { response: { header: { resultCode: '31', resultMsg: secret } } } : reply());
  };
  const runtime = await createRuntime({ dataDir: tempDir('kma'), port: 0, vault: new TestVault(), fetcher, bootstrapCode: 'kma-bootstrap', evidenceMode: 'mock' });
  try {
    const account = await runtime.engine.saveAccount({ label: 'KMA test', credentialType: 'kma-api', allowedActions: [kmaAction.id], secrets: { serviceKey: secret } });
    const client = runtime.engine.createClient({ name: 'weather client', allowedActions: [kmaAction.id], allowedAccountIds: [account.id] });
    const limited = runtime.engine.createClient({ name: 'no account', allowedActions: [kmaAction.id], allowedAccountIds: [] });
    const post = (token: string, idempotencyKey = randomUUID()) => fetch(`${runtime.baseUrl}/api/jobs`, { method: 'POST', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ actionId: kmaAction.id, accountId: account.id, input, idempotencyKey }) });
    const described = await (await fetch(`${runtime.baseUrl}/api/actions`, { headers: { Authorization: `Bearer ${client.token}` } })).json();
    assert.equal(described[0].enabled, true); assert.equal(described[0].verification, 'documented');
    assert.equal((await post(limited.token)).status, 403); assert.equal(requests, 0);
    const idempotencyKey = randomUUID(); const response = await post(client.token, idempotencyKey);
    assert.equal(response.status, 202); const job = await response.json();
    await runtime.engine.idle();
    const outcome = await (await fetch(`${runtime.baseUrl}/api/jobs/${job.id}`, { headers: { Authorization: `Bearer ${client.token}` } })).json();
    assert.equal(outcome.state, 'succeeded'); assert.equal(outcome.result.data.observations[0].value, -3.5);
    assert.equal(outcome.result.contentTrust, 'external_data'); assert(!JSON.stringify(outcome).includes(secret));
    assert.equal((await (await post(client.token, idempotencyKey)).json()).id, job.id); await runtime.engine.idle(); assert.equal(requests, 1);
    assert.equal(runtime.engine.metrics().verifiedServices, 0); assert.equal(runtime.engine.metrics().supportedActions, 0);
    expired = true; const waiting = await (await post(client.token)).json(); await runtime.engine.idle();
    const waitingJob = runtime.store.job(waiting.id)!;
    assert.equal(waitingJob.state, 'awaiting_auth'); assert.equal(waitingJob.error?.code, 'AUTH_REQUIRED');
    assert(!JSON.stringify(waitingJob).includes(secret));
  } finally { await runtime.close(); }
});
