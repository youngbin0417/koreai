import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { subwayRouteAction as action, subwayRouteSchema, subwayRouteRequestTemplate, normalizeSubwayRoute, subwayRouteExecutor } from '../src/connectors/subway-route.js';
import { draftExample, previewDraftRequest } from '../src/connectors/drafts/index.js';
import { ActionError, type ExecutionContext } from '../src/types.js';
import { admin } from '../src/core/engine.js';
import { createRuntime } from '../src/http.js';
import { TestVault, tempDir } from './helpers.js';
import { runtimeApi, runtimeLogin } from './mcp-oauth-fixture.js';
import { SubwayRouteResult, subwayRouteInputState } from '../ui/SubwayRoute.js';
import { applySubwayStation } from '../ui/subway-stations-model.js';
import { routeInput, routePayload, routeSecret, routeMock } from './subway-route-fixture.js';

const now = new Date('2026-10-25T00:01:00Z');
const code = (value: string, state = 'failed') => (error: unknown) => error instanceof ActionError && error.code === value && error.state === state && !error.message.includes(routeSecret);
function context(input: unknown = routeInput, signal = new AbortController().signal) { let sends = 0; return { ctx: { job: { input } as ExecutionContext['job'], secrets: { serviceKey: routeSecret }, signal, dispatch() { sends++; } } satisfies ExecutionContext, sends: () => sends }; }

test('route requests use the current HTTPS path, independent credential and Korean reference time without leaking a key into previews', () => {
  const request = subwayRouteRequestTemplate({ ...routeInput, at: '2026-10-25T00:00:00Z' });
  assert.equal(request.endpoint, 'https://apis.data.go.kr/B553766/path2/getShtrmPath2'); assert.equal(request.query.searchDt, '2026-10-25 09:00:00'); assert.equal(request.query.stationValueType, 'name'); assert.equal(request.query.dptreStn, '신도림'); assert.equal(request.query.schInclYn, 'N');
  assert.equal(action.credentialType, 'seoul-subway-route-api'); assert.equal(action.resultTtlMs, 60000); assert(draftExample(action.id));
  const preview = previewDraftRequest(action.id, routeInput); assert.equal(preview.networkDispatched, false); assert(!JSON.stringify(preview).includes(routeSecret));
  for (const patch of [{ origin: '서울,시청' }, { origin: '../서울' }, { destination: '신도림' }, { includeTimetable: 'Y' }, { preference: 'cheapest' }, { at: '2026-10-25 09:00:00' }, { stationId: '1001000133' }, { endpoint: 'https://example.org' }]) assert(!subwayRouteSchema.safeParse({ ...routeInput, ...patch }).success);
});

test('route normalization preserves explicit branch/transfer segments, units and raw service-day schedules', () => {
  const input = { ...routeInput, includeTimetable: true }, data = normalizeSubwayRoute(JSON.stringify(routePayload(input)), input, now);
  assert.equal(data.status, 'available'); assert.equal(data.segments.length, 3); assert.equal(data.segments[1]!.transferRaw, 'Y'); assert.equal(data.segments[1]!.from.code, 'test-002'); assert.equal(data.segments[1]!.to.code, 'test-003');
  assert.equal(data.segments[0]!.departureRaw, '25:10:00'); assert.equal(data.summary!.durationSeconds, 270); assert.equal(data.summary!.distanceMeters, 2500); assert.equal(data.providerObservedAt, null); assert.equal(data.transfers[0]!.fromLine, '시험 2호선');
  const p = routePayload(); p.body.paths = []; p.body.totalDstc = 0; p.body.totalReqHr = 0; p.body.trsitNmtm = 0; p.body.trfstnNms = [];
  const empty = normalizeSubwayRoute(JSON.stringify(p), routeInput, now); assert.equal(empty.status, 'no_data'); assert.equal(empty.summary, null);
  assert.equal(normalizeSubwayRoute(JSON.stringify({ response: routePayload() }), routeInput, now).status, 'available');
});

test('route normalization rejects disconnected platforms, mismatched endpoints/conditions and malformed provider success', () => {
  const mutations = [(p: any) => { p.body.paths[1].dptreStn.stnCd = 'wrong'; }, (p: any) => { p.body.paths[0].dptreStn.stnNm = '다른역'; }, (p: any) => { p.body.paths[2].arvlStn.stnNm = '다른역'; }, (p: any) => { p.body.searchType = 'duration'; }, (p: any) => { p.body.schInclYn = 'Y'; }, (p: any) => { p.body.paths[0].reqHr = -1; }, (p: any) => { p.body.paths = []; }, (p: any) => { delete p.body.paths; }];
  for (const mutate of mutations) { const p = JSON.parse(JSON.stringify(routePayload())); mutate(p); assert.throws(() => normalizeSubwayRoute(JSON.stringify(p), routeInput, now), code('INVALID_RESPONSE')); }
  for (const raw of ['invalid', '{}', '<!DOCTYPE root [<!ENTITY secret "x">]><response/>']) assert.throws(() => normalizeSubwayRoute(raw, routeInput, now), code('INVALID_RESPONSE'));
  for (const codeValue of ['20', '30', '31']) for (const raw of [JSON.stringify({ OpenAPI_ServiceResponse: { cmmMsgHeader: { returnReasonCode: codeValue } } }), `<OpenAPI_ServiceResponse><cmmMsgHeader><returnReasonCode>${codeValue}</returnReasonCode></cmmMsgHeader></OpenAPI_ServiceResponse>`]) assert.throws(() => normalizeSubwayRoute(raw, routeInput, now), code('AUTH_REQUIRED', 'awaiting_auth'));
  assert.throws(() => normalizeSubwayRoute(JSON.stringify({ header: { resultCode: 10, resultMsg: routeSecret } }), routeInput), code('PROVIDER_INVALID_INPUT'));
});

test('route executor controls dispatch, encoded keys, limits, cancellation and sanitized provider errors', async () => {
  const mock = routeMock(), c = context(); await subwayRouteExecutor(mock.fetcher)(action, c.ctx); assert.equal(c.sends(), 1); assert.equal(mock.calls.length, 1); assert.equal(mock.calls[0]!.searchParams.get('serviceKey'), routeSecret);
  for (const key of ['', 'encoded%2Fkey', 'bad\nkey']) { const c = context(); c.ctx.secrets.serviceKey = key; await assert.rejects(() => subwayRouteExecutor(mock.fetcher)(action, c.ctx), code('AUTH_REQUIRED', 'awaiting_auth')); assert.equal(c.sends(), 0); }
  for (const [status, name, state] of [[401, 'AUTH_REQUIRED', 'awaiting_auth'], [403, 'AUTH_REQUIRED', 'awaiting_auth'], [429, 'PROVIDER_RATE_LIMIT', 'failed'], [500, 'PROVIDER_HTTP_500', 'failed']] as const) { const m = routeMock(); m.flags.status = status; await assert.rejects(() => subwayRouteExecutor(m.fetcher)(action, context().ctx), code(name, state)); }
  await assert.rejects(() => subwayRouteExecutor(async () => { throw Error(routeSecret); })(action, context().ctx), code('PROVIDER_UNAVAILABLE'));
  await assert.rejects(() => subwayRouteExecutor(async () => new Response('x'.repeat(2_000_001)))(action, context().ctx), code('RESULT_TOO_LARGE'));
  await assert.rejects(() => subwayRouteExecutor(async () => new Response(new Uint8Array([255])))(action, context().ctx), code('INVALID_RESPONSE'));
  const c2 = new AbortController(); c2.abort(); await assert.rejects(() => subwayRouteExecutor(mock.fetcher)(action, context(routeInput, c2.signal).ctx), code('CANCELLED', 'cancelled')); assert.equal(mock.calls.length, 1);
});

test('route HTTP keeps independent action/account grants, idempotency, auth resume and zero-dispatch previews when old HTTP APIs are blocked', async () => {
  const mock = routeMock(), r = await createRuntime({ dataDir: tempDir('subway-route-http'), port: 0, vault: new TestVault(), evidenceMode: 'mock', fetcher: mock.fetcher });
  try {
    const cookie = await runtimeLogin(r), api = (p: string, method = 'GET', body?: unknown, token?: string) => runtimeApi(r, '/api' + p, method, body, cookie, token ? { Authorization: 'Bearer ' + token } : {});
    const old = await r.engine.saveAccount({ label: '기존 도착', credentialType: 'seoul-subway-api', allowedActions: ['seoul-subway.arrivals'], secrets: { apiKey: 'old-subway-key' } });
    const account = await r.engine.saveAccount({ label: '경로 전용', credentialType: action.credentialType!, allowedActions: [action.id], secrets: { serviceKey: routeSecret } });
    const client = r.engine.createClient({ name: 'route reader', allowedActions: [action.id], allowedAccountIds: [account.id] });
    const request = { actionId: action.id, accountId: account.id, input: routeInput, idempotencyKey: randomUUID() };
    const preview = await (await api('/drafts/' + action.id + '/preview', 'POST', routeInput)).json(); assert.equal(preview.networkDispatched, false); assert.equal(mock.calls.length, 0);
    const mismatched = await api('/jobs', 'POST', { ...request, accountId: old.id }, client.token); assert.equal(mismatched.status, 409); assert.equal((await mismatched.json()).error.code, 'ACCOUNT_REQUIRED'); assert.equal(mock.calls.length, 0);
    const other = await r.engine.saveAccount({ label: '미허용 경로', credentialType: action.credentialType!, allowedActions: [action.id], secrets: { serviceKey: routeSecret } });
    assert.equal((await api('/jobs', 'POST', { ...request, accountId: other.id }, client.token)).status, 403); assert.equal(mock.calls.length, 0);
    const response = await api('/jobs', 'POST', request, client.token); assert.equal(response.status, 202); const job = await response.json(); await r.engine.idle(); assert.equal(r.engine.get(admin, job.id).state, 'succeeded'); assert(r.engine.get(admin, job.id).resultExpiresAt);
    await api('/jobs', 'POST', request, client.token); await r.engine.idle(); assert.equal(mock.calls.length, 1);
    mock.flags.status = 401; const waiting = await (await api('/jobs', 'POST', { ...request, idempotencyKey: randomUUID() }, client.token)).json(); await r.engine.idle(); assert.equal(r.engine.get(admin, waiting.id).state, 'awaiting_auth');
    mock.flags.status = 200; await api('/jobs/' + waiting.id + '/resume', 'POST', {}, client.token); await r.engine.idle(); assert.equal(r.engine.get(admin, waiting.id).state, 'succeeded');
    const state = await (await api('/state')).json(); assert.equal(state.runtime.seoulSubwayHttpAllowed, false); assert(!JSON.stringify(state).includes(routeSecret)); assert.equal(r.engine.metrics().supportedActions, 0); assert.equal(r.engine.metrics().verifiedServices, 0);
    assert.deepEqual(r.engine.accounts().find(a => a.id === old.id)!.allowedActions, ['seoul-subway.arrivals']);
  } finally { await r.close(); }
});

test('route form and cards preserve safe external text and endpoint drafts without discarding the other endpoint or filters', () => {
  const input = { ...routeInput, includeTimetable: true }, p = routePayload(input); (p.body.paths[0] as any).tmnlStnNm = '<script>unsafe</script>';
  const data = normalizeSubwayRoute(JSON.stringify(p), input, now), html = renderToStaticMarkup(createElement(SubwayRouteResult, { result: { contentTrust: 'external_data', data } }));
  assert(html.includes('&lt;script&gt;')); assert(!html.includes('<script>')); assert(html.includes('25:10:00')); assert(html.includes('관측 시각: 미제공')); assert(html.includes('환승 표시 원문'));
  assert.equal(subwayRouteInputState(JSON.stringify(routeInput)).error, null); assert(subwayRouteInputState('{bad').error); assert(subwayRouteInputState(JSON.stringify({ ...routeInput, destination: routeInput.origin })).error);
  const draft = JSON.parse(applySubwayStation(action.id as 'seoul-subway.route', JSON.stringify(routeInput), '1001000133', 'destination'));
  assert.deepEqual(draft, { ...routeInput, destination: '서울' }); assert(!('stationId' in draft)); assert(!('lineName' in draft));
});
