import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { kopisActions, kopisSearchAction, kopisDetailAction, kopisSearchSchema, kopisDetailSchema, kopisExample, kopisRequestTemplate, kopisExecutor } from '../src/connectors/kopis.js';
import { createRuntime } from '../src/http.js';
import { ActionError, type ExecutionContext } from '../src/types.js';
import { TestVault, tempDir } from './helpers.js';
import { runtimeApi, runtimeLogin } from './mcp-oauth-fixture.js';

const secret = 'unit-kopis-private-key+/=%&';
const input = { startDate: '2026-10-01', endDate: '2026-10-31', name: '시험 & 공연', venue: '시험 극장', regionCode: '11', districtCode: '1168', genreCode: 'BBBE', state: '01' };
const row = () => ({ mt20id: 'PF132236', prfnm: '시험 & 공연', prfpdfrom: '2026.09.01', prfpdto: '2026.12.31', fcltynm: '시험 극장', area: '서울특별시', genrenm: '대중무용', openrun: 'N', prfstate: '공연예정' });
const escape = (value: unknown) => String(value ?? '').replace(/[&<>"']/g, character => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;' }[character]!));
const fields = (value: Record<string, unknown>) => Object.entries(value).filter(([,value]) => value !== undefined).map(([key,value]) => `<${key}>${escape(value)}</${key}>`).join('');
const reply = (rows: Record<string, unknown>[] = [row()]) => `<dbs>${rows.map(row => `<db>${fields(row)}</db>`).join('')}</dbs>`;
const detailReply = (links = '<relate><relatenm>시험 예매처</relatenm><relateurl>https://tickets.example.org/show?id=001&amp;src=kopis</relateurl></relate>') => `<dbs><db>${fields({ ...row(), mt10id: 'FC001431', mt13id: 'FC001431-01', prfcast: '출연진', prfcrew: '제작진', prfruntime: '90분', prfage: '8세 이상', pcseguidance: '전석 30,000원', dtguidance: '화~금 19:30', sty: '공연 소개', frstregdt: '2026-09-01 10:00:00', updatedate: '2026-10-19 12:34:56', poster: 'https://images.example.org/poster.jpg' })}<relates>${links}</relates></db></dbs>`;
function context(values: Record<string, unknown> = input, action = kopisSearchAction, controller = new AbortController()) {
  let dispatched = 0;
  const now = new Date().toISOString();
  const ctx: ExecutionContext = { job: { id: randomUUID(), clientId: 'local-admin', actionId: action.id, input: values, idempotencyKey: randomUUID(), requestHash: 'test', effect: 'read', state: 'running', revision: 1, dispatched: false, createdAt: now, updatedAt: now, interventions: 0, events: [] }, secrets: { apiKey: secret }, signal: controller.signal, dispatch: () => { dispatched++; } };
  return { ctx, dispatched: () => dispatched };
}
async function execute(body = reply(), values: Record<string, unknown> = input, action = kopisSearchAction) { return (await kopisExecutor(async () => new Response(body))(action,context(values,action).ctx)).data as Record<string,any>; }
const hasCode = (code: string, state = 'failed') => (error: unknown) => error instanceof ActionError && error.code === code && error.state === state && !error.message.includes(secret);

test('KOPIS validates real calendar dates, inclusive 31 days and its own region, district, genre and ID formats', () => {
  assert(kopisSearchSchema.safeParse(input).success);
  assert(kopisSearchSchema.safeParse({ startDate: '2024-02-01', endDate: '2024-03-02' }).success);
  assert.equal(kopisSearchSchema.parse({ ...input, name: ' 공연 ' }).name,'공연');
  for (const patch of [{ startDate: '2026-02-29' }, { startDate: '2026-04-31' }, { endDate: '2026-11-01' }, { startDate: '2026-11-01' }, { startDate: '20261001' }, { regionCode: '42' }, { regionCode: '110000' }, { regionCode: '11', districtCode: '3101' }, { districtCode: '11680' }, { genreCode: 'BBBR' }, { state: '공연중' }, { page: 1000 }, { page: 0 }, { limit: 101 }, { name: '' }, { service: secret }, { url: 'http://localhost' }]) assert(!kopisSearchSchema.safeParse({ ...input, ...patch }).success,JSON.stringify(patch));
  assert(!kopisSearchSchema.safeParse({ startDate: input.startDate, endDate: input.endDate, districtCode: '1168' }).success);
  for (const id of ['PF132236', 'PF000001', 'PF1234567890']) assert(kopisDetailSchema.safeParse({ performanceId: id }).success);
  for (const id of ['PF12345', 'PF12345678901', '../PF132236', 'PF132236?service=x', 'pf132236']) assert(!kopisDetailSchema.safeParse({ performanceId: id }).success);
  assert(!kopisDetailSchema.safeParse({ performanceId: 'PF132236', service: secret }).success);
  const example = kopisExample(kopisSearchAction.id,new Date('2026-12-31T15:00:00Z'));
  assert.equal(example.startDate,'2027-01-01'); assert.equal(example.endDate,'2027-01-07');
  assert.equal(kopisExample(kopisSearchAction.id,new Date('2026-12-31T14:59:59Z')).startDate,'2026-12-31');
});

test('KOPIS uses only canonical HTTPS, maps search parameters once and separates key-free previews from dispatch', async () => {
  const template = kopisRequestTemplate(kopisSearchAction.id,input);
  assert(!('service' in template.query)); assert(!JSON.stringify(template).includes(secret));
  assert.deepEqual(template.query,{ stdate:'20261001', eddate:'20261031', cpage:1, rows:10, shprfnm:input.name, shprfnmfct:input.venue, signgucode:'11', signgucodesub:'1168', shcate:'BBBE', prfstate:'01' });
  assert.deepEqual(template.authentication,{ secretField:'apiKey', queryParameter:'service' });
  let calls = 0;
  const executor = kopisExecutor(async (address,init) => {
    calls++; const url = new URL(String(address)); assert.equal(url.origin,'https://kopis.or.kr'); assert.equal(init?.redirect,'error'); assert.equal(init?.cache,'no-store'); assert.equal(url.searchParams.get('service'),secret);
    if (url.pathname.endsWith('/PF132236')) { assert.deepEqual([...url.searchParams.keys()],['service']); return new Response(detailReply()); }
    assert.equal(url.pathname,'/openApi/restful/pblprfr'); assert.equal(url.searchParams.get('shprfnm'),input.name); assert.equal(url.searchParams.get('signgucodesub'),'1168'); return new Response(reply());
  });
  const run = context(); await executor(kopisSearchAction,run.ctx); assert.equal(run.dispatched(),1);
  await executor(kopisDetailAction,context({ performanceId:'PF132236' },kopisDetailAction).ctx); assert.equal(calls,2);
});

test('KOPIS preserves long-running periods and reports partial, full, last and empty pages without inventing totals', async () => {
  const result = await execute(); const show = result.performances[0];
  assert.equal(show.performanceId,'PF132236'); assert.equal(show.name,input.name); assert.equal(show.startDate,'2026-09-01'); assert.equal(show.endDate,'2026-12-31');
  assert.deepEqual(show.reportedState,{ code:'01', label:'공연예정' }); assert.equal(show.openRun,false); assert.equal(show.currentSeatsAvailable,null);
  assert.equal(result.source.attribution.startsWith('출처:'),true); assert.equal(result.providerUpdatedAt,null); assert.equal(result.timezone,'Asia/Seoul');
  assert.deepEqual(result.pagination,{ page:1, limit:10, totalCount:null, nextPageCandidate:null, hasMore:false });
  const full = await execute(reply(),{ ...input, page:2, limit:1 }); assert.deepEqual(full.pagination,{ page:2, limit:1, totalCount:null, nextPageCandidate:3, hasMore:null });
  const last = await execute(reply(),{ ...input, page:999, limit:1 }); assert.equal(last.pagination.nextPageCandidate,null); assert.equal(last.pagination.hasMore,null);
  const empty = await execute('<dbs/>'); assert.equal(empty.status,'no_data'); assert.deepEqual(empty.performances,[]); assert.equal(empty.pagination.hasMore,false);
  const sparse = await execute(reply([{ mt20id:'PF000001', prfnm:'최소 정보', prfstate:'공급자 새 상태' }])); assert.equal(sparse.performances[0].startDate,null); assert.deepEqual(sparse.performances[0].reportedState,{ code:null, label:'공급자 새 상태' }); assert.equal(sparse.performances[0].openRun,null);
});

test('KOPIS detail retains raw price, schedule and naive timestamps while omitting images and unsafe booking links', async () => {
  const links = '<relate><relatenm>정상</relatenm><relateurl>https://tickets.example.org/?id=001&amp;x=2</relateurl></relate>' + ['javascript:alert(1)', 'file:///etc/passwd', 'https://user:password@example.org/', '//localhost'].map(url => `<relate><relatenm>거절</relatenm><relateurl>${escape(url)}</relateurl></relate>`).join('');
  const result = await execute(detailReply(links),{ performanceId:'PF132236' },kopisDetailAction), show = result.performance;
  assert.equal(show.facilityId,'FC001431'); assert.equal(show.venueId,'FC001431-01'); assert.equal(show.ticketPriceGuidanceRaw,'전석 30,000원'); assert.equal(show.scheduleGuidanceRaw,'화~금 19:30');
  assert.equal(show.providerUpdatedAtRaw,'2026-10-19 12:34:56'); assert.equal(show.registeredAtRaw,'2026-09-01 10:00:00'); assert.equal(show.currentSeatsAvailable,null); assert.equal(show.castRaw,'출연진');
  assert.deepEqual(show.ticketLinks,[{ name:'정상', url:'https://tickets.example.org/?id=001&x=2' }]); assert(!('poster' in show)); assert(!('sellingPrice' in show));
  const single = await execute(detailReply(),{ performanceId:'PF132236' },kopisDetailAction); assert.equal(single.performance.ticketLinks.length,1);
  const empty = await execute('<dbs/>',{ performanceId:'PF132236' },kopisDetailAction); assert.equal(empty.performance,null); assert.equal(empty.status,'no_data'); assert.equal(empty.requestedPerformanceId,'PF132236');
});

test('KOPIS rejects malformed XML, changed structures, duplicate or mismatched IDs, excess rows and impossible dates', async () => {
  for (const body of ['{}','<html>login</html>','<dbs><db></dbs>','<!DOCTYPE dbs [<!ENTITY x "boom">]><dbs/>','<dbs><unexpected/></dbs>',reply([row(),row()]),reply([{ ...row(), prfpdfrom:'2026.02.29' }]),reply([{ ...row(), prfpdto:'2026.01.01' }]),reply([{ ...row(), mt20id:'../../other' }])]) await assert.rejects(()=>execute(body),hasCode('INVALID_RESPONSE'));
  await assert.rejects(()=>execute(reply([row(),{ ...row(), mt20id:'PF000002' }]),{ ...input, limit:1 }),hasCode('INVALID_RESPONSE'));
  for (const body of [reply([{ ...row(), mt20id:'PF000002' }]),reply([row(),{ ...row(), mt20id:'PF000002' }]),detailReply('<relate><relatenm>누락 URL</relatenm></relate>')]) await assert.rejects(()=>execute(body,{ performanceId:'PF132236' },kopisDetailAction),hasCode('INVALID_RESPONSE'));
  await assert.rejects(()=>kopisExecutor(async()=>new Response(new Uint8Array([0xff,0xfe])))(kopisSearchAction,context().ctx),hasCode('INVALID_RESPONSE'));
});

test('KOPIS recognizes HTTP 200 key rejection even among data rows and sanitizes unknown provider codes', async () => {
  const failure = `<db><returncode>02</returncode><errmsg>${escape(secret)}</errmsg></db>`;
  for (const body of [`<dbs>${failure}</dbs>`, `<dbs><db>${fields(row())}</db>${failure}</dbs>`]) await assert.rejects(()=>execute(body),hasCode('AUTH_REQUIRED','awaiting_auth'));
  await assert.rejects(()=>execute(`<dbs><db><returncode>99</returncode><errmsg>${escape(secret)}</errmsg></db></dbs>`),hasCode('PROVIDER_99'));
  await assert.rejects(()=>execute('<dbs><db><returncode>unknown</returncode></db></dbs>'),hasCode('PROVIDER_ERROR'));
});

test('KOPIS handles HTTP failures, timeouts, redirects and cancellation without exposing request keys', async () => {
  for (const [status,code,state] of [[401,'AUTH_REQUIRED','awaiting_auth'],[403,'AUTH_REQUIRED','awaiting_auth'],[429,'PROVIDER_RATE_LIMIT','failed'],[503,'PROVIDER_HTTP_503','failed']] as const) await assert.rejects(()=>kopisExecutor(async()=>new Response(secret,{ status }))(kopisSearchAction,context().ctx),hasCode(code,state));
  for (const error of [new Error(`redirect https://other.example/?service=${secret}`),new TypeError(secret)]) await assert.rejects(()=>kopisExecutor(async()=>{throw error;})(kopisSearchAction,context().ctx),hasCode('PROVIDER_CONNECTION_ERROR'));
  await assert.rejects(()=>kopisExecutor(async()=>{throw new DOMException(secret,'TimeoutError');})(kopisSearchAction,context().ctx),hasCode('PROVIDER_TIMEOUT'));
  for (const key of ['', 'bad\nkey']) { const run=context();run.ctx.secrets.apiKey=key;await assert.rejects(()=>kopisExecutor()(kopisSearchAction,run.ctx),hasCode('AUTH_REQUIRED','awaiting_auth'));assert.equal(run.dispatched(),0); }
  const before=new AbortController(),run=context(input,kopisSearchAction,before);before.abort();await assert.rejects(()=>kopisExecutor()(kopisSearchAction,run.ctx),hasCode('CANCELLED','cancelled'));assert.equal(run.dispatched(),0);
  const during=new AbortController();await assert.rejects(()=>kopisExecutor(async()=>{during.abort();throw Error(secret);})(kopisSearchAction,context(input,kopisSearchAction,during).ctx),hasCode('CANCELLED','cancelled'));
  await assert.rejects(()=>kopisExecutor()({ ...kopisSearchAction, id:'kopis.tickets.buy' },context().ctx),hasCode('NOT_IMPLEMENTED'));
});

test('KOPIS bounds streamed results and cancels an oversized response', async () => {
  let cancelled = false;
  const stream = new ReadableStream<Uint8Array>({ pull(controller) { controller.enqueue(new Uint8Array(1_000_001)); }, cancel() { cancelled=true; } });
  await assert.rejects(()=>kopisExecutor(async()=>new Response(stream))(kopisSearchAction,context().ctx),hasCode('RESULT_TOO_LARGE')); assert.equal(cancelled,true);
});

test('KOPIS HTTP scopes accounts and actions, previews without calls, deduplicates reads and resumes auth waits', async () => {
  let calls=0,denied=false;
  const r=await createRuntime({dataDir:tempDir('kopis-http'),port:0,vault:new TestVault(),evidenceMode:'mock',fetcher:async address=>{calls++;return new Response(denied?'<dbs><db><returncode>02</returncode></db></dbs>':String(address).includes('/PF132236')?detailReply():reply());}});
  try {
    const cookie=await runtimeLogin(r),api=(path:string,method='GET',body?:unknown,bearer?:string)=>runtimeApi(r,`/api${path}`,method,body,cookie,bearer?{Authorization:`Bearer ${bearer}`}:{ });
    for (const action of kopisActions) { const preview=await(await api(`/drafts/${action.id}/preview`,'POST',kopisExample(action.id))).json(); assert.equal(preview.networkDispatched,false); assert.equal(preview.request.authentication.queryParameter,'service'); assert.equal(preview.request.query.service,undefined); }
    assert.equal(calls,0);
    const request={actionId:kopisSearchAction.id,input,idempotencyKey:randomUUID(),accountId:''};
    assert.equal((await(await api('/jobs','POST',{actionId:request.actionId,input,idempotencyKey:randomUUID()})).json()).error.code,'ACCOUNT_REQUIRED');
    const wrong=await r.engine.saveAccount({label:'KOBIS 시험',credentialType:'kobis-api',allowedActions:['kobis.boxoffice.daily'],secrets:{apiKey:secret}});request.accountId=wrong.id;
    assert.equal((await(await api('/jobs','POST',request)).json()).error.code,'ACCOUNT_REQUIRED'); assert.equal(calls,0);
    const account=await r.engine.saveAccount({label:'KOPIS 시험',credentialType:'kopis-api',allowedActions:kopisActions.map(action=>action.id),secrets:{apiKey:secret}});request.accountId=account.id;
    const client=r.engine.createClient({name:'performance reader',allowedActions:kopisActions.map(action=>action.id),allowedAccountIds:[account.id]});
    for (const limits of [{allowedActions:[kopisSearchAction.id],allowedAccountIds:[]},{allowedActions:[kopisDetailAction.id],allowedAccountIds:[account.id]}]) { const blocked=r.engine.createClient({name:'blocked',...limits});assert.equal((await api('/jobs','POST',request,blocked.token)).status,403); }
    const response=await api('/jobs','POST',request,client.token);assert.equal(response.status,202);const job=await response.json();await r.engine.idle();const result=await(await api(`/jobs/${job.id}`,'GET',undefined,client.token)).json();
    assert.equal(result.state,'succeeded');assert.equal(result.result.contentTrust,'external_data');assert(!JSON.stringify(result).includes(secret));
    const duplicate=await(await api('/jobs','POST',request,client.token)).json();await r.engine.idle();assert.equal(duplicate.id,job.id);assert.equal(calls,1);
    denied=true;const detail=await(await api('/jobs','POST',{...request,actionId:kopisDetailAction.id,input:{performanceId:'PF132236'},idempotencyKey:randomUUID()},client.token)).json();await r.engine.idle();assert.equal((await(await api(`/jobs/${detail.id}`,'GET',undefined,client.token)).json()).state,'awaiting_auth');
    denied=false;await api(`/jobs/${detail.id}/resume`,'POST',{},client.token);await r.engine.idle();const resumed=await(await api(`/jobs/${detail.id}`,'GET',undefined,client.token)).json();assert.equal(resumed.state,'succeeded');assert.equal(resumed.result.data.performance.performanceId,'PF132236');assert.equal(calls,3);assert.equal(r.engine.metrics().verifiedServices,0);assert.equal(r.engine.metrics().supportedActions,0);
  } finally { await r.close(); }
});
