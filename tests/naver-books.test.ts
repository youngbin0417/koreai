import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { naverBooksActions as retiredActions, naverBooksSearchAction as retiredSearch, naverBookIsbnAction as retiredIsbn, naverBooksSearchSchema, naverBookIsbnSchema, naverBooksRequestTemplate, naverBooksExecutor } from '../src/connectors/naver-books.js';
import { createRuntime } from '../src/http.js';
import { ActionError, type Action, type ExecutionContext } from '../src/types.js';
import { TestVault, tempDir } from './helpers.js';
import { runtimeApi, runtimeLogin } from './mcp-oauth-fixture.js';

// Legacy wire/parser fixtures only; production availability is tested separately.
const naverBooksActions = retiredActions.map(action=>({...action,unavailable:undefined}));
const naverBooksSearchAction = {...retiredSearch,unavailable:undefined}, naverBookIsbnAction = {...retiredIsbn,unavailable:undefined};
const secrets = { clientId: 'test-books-private-id', clientSecret: 'test-books-private-secret' };
const row = () => ({ title: '<b>시험</b> 도서', link: 'https://search.shopping.naver.com/book/catalog/123', author: '시험 저자', publisher: '시험 출판', isbn: '0306406152 9780306406157', description: 'API 시험 자료', pubdate: '20240229', discount: '14000' });
const json = (items: Record<string, unknown>[] = [row()], patch = {}) => ({ lastBuildDate: 'Mon, 19 Oct 2026 10:00:00 +0900', total: items.length, start: 1, display: 10, items, ...patch });
const xml = (item = '<item><title>시험 <b>도서</b></title><link>https://book.naver.com/bookdb/book_detail.nhn?bid=123</link><author>저자</author><publisher>출판사</publisher><isbn>0306406152 9780306406157</isbn><description><![CDATA[소개 <b>문장</b>]]></description><pubdate>20240229</pubdate></item>', total = 1) => `<?xml version="1.0" encoding="UTF-8"?><rss version="2.0"><channel><lastBuildDate>Mon, 19 Oct 2026 10:00:00 +0900</lastBuildDate><total>${total}</total><start>1</start><display>100</display>${item}</channel></rss>`;
function context(action: Action = naverBooksSearchAction, input: Record<string, unknown> = { query: '도서' }, controller = new AbortController()) {
  let dispatched = 0;
  const ctx: ExecutionContext = { job: { id: randomUUID(), clientId: 'local-admin', actionId: action.id, input, idempotencyKey: randomUUID(), requestHash: 'test', effect: 'read', state: 'running', revision: 1, dispatched: false, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(), interventions: 0, events: [] }, secrets: { ...secrets }, signal: controller.signal, dispatch: () => { dispatched++; } };
  return { ctx, dispatched: () => dispatched };
}
async function execute(body: unknown = json(), action: Action = naverBooksSearchAction, input: Record<string, unknown> = { query: '도서' }) {
  return (await naverBooksExecutor(async () => typeof body === 'string' ? new Response(body) : Response.json(body))(action, context(action, input).ctx)).data as Record<string, any>;
}
const hasCode = (code: string, state = 'failed') => (error: unknown) => error instanceof ActionError && error.code === code && error.state === state && Object.values(secrets).every(secret => !error.message.includes(secret));

test('book schemas validate search bounds, normalize ISBN-10/13 check digits and reject keys, URLs and unsupported sort', () => {
  assert.deepEqual(naverBooksSearchSchema.parse({ query: ' 도서 ' }), { query: '도서', display: 10, start: 1, sort: 'sim' });
  for (const input of [{ query: '' }, { query: '도서', display: 101 }, { query: '도서', start: 1001 }, { query: '도서', display: '10' }, { query: '도서', sort: 'price' }, { query: '도서', url: 'https://elsewhere.test' }, { query: '도서', clientSecret: 'key' }]) assert(!naverBooksSearchSchema.safeParse(input).success);
  for (const value of ['0306406152', '0-306-40615-2', '080442957x', '9780306406157', '9791190090018']) assert(naverBookIsbnSchema.safeParse({ isbn: value }).success, value);
  assert.equal(naverBookIsbnSchema.parse({ isbn: ' 0-306-40615-2 ' }).isbn, '0306406152');
  for (const value of ['', 9780306406157, '9780306406158', '0306406153', '1234567890128', '9780306406157?key=foo']) assert(!naverBookIsbnSchema.safeParse({ isbn: value }).success);
  assert(!naverBookIsbnSchema.safeParse({ isbn: '0306406152', display: 1 }).success);
});

test('book requests use documented JSON/XML HTTPS endpoints, UTF-8 query and secret headers only', async () => {
  for (const action of naverBooksActions) {
    const input = action.id === naverBooksSearchAction.id ? { query: '한국 문학 & 저자', display: 5, start: 1, sort: 'date' } : { isbn: '0-306-40615-2' }, run = context(action, input);
    const template = naverBooksRequestTemplate(action.id, input); assert.equal(template.authentication.headers['X-Naver-Client-Secret'].secretField, 'clientSecret');
    await naverBooksExecutor(async (address, init) => {
      const url = new URL(String(address)), headers = new Headers(init?.headers);
      assert.equal(url.origin, 'https://openapi.naver.com'); assert.equal(init?.redirect, 'error'); assert(init?.signal instanceof AbortSignal); assert.equal(run.dispatched(), 1);
      assert.equal(headers.get('X-Naver-Client-Id'), secrets.clientId); assert.equal(headers.get('X-Naver-Client-Secret'), secrets.clientSecret); assert.equal(headers.get('Authorization'), null);
      assert(!url.href.includes(secrets.clientId)); assert(!url.href.includes(secrets.clientSecret));
      if (action.id === naverBooksSearchAction.id) { assert.equal(url.pathname, '/v1/search/book.json'); assert.equal(url.searchParams.get('query'), input.query); assert.equal(url.searchParams.get('sort'), 'date'); return Response.json(json([row()], { display: 5 })); }
      assert.equal(url.pathname, '/v1/search/book_adv.xml'); assert.equal(url.searchParams.get('d_isbn'), '0306406152'); assert.equal(url.searchParams.has('query'), false); return new Response(xml());
    })(action, run.ctx);
  }
});

test('book results preserve ISBN zeros and missing/zero prices and separate publication, retrieval and search time', async () => {
  const result = await execute(json([{ ...row(), discount: undefined, ignoredToken: secrets.clientSecret }]));
  assert.equal(result.books[0].title, '시험 도서'); assert.equal(result.books[0].isbn10, '0306406152'); assert.equal(result.books[0].isbn13, '9780306406157'); assert.equal(result.books[0].sellingPriceKrw, null); assert.equal(result.books[0].availability, 'unverified');
  assert.equal(result.books[0].publishedOn, '2024-02-29'); assert.equal(result.providerUpdatedAt, null); assert.equal(result.searchGeneratedAtRaw, 'Mon, 19 Oct 2026 10:00:00 +0900'); assert.equal(result.source.url, naverBooksSearchAction.sourceUrl); assert(!JSON.stringify(result).includes(secrets.clientSecret));
  for (const pubdate of ['', '2024', '202402', '20240200']) { const data = await execute(json([{ ...row(), pubdate, discount: 0, isbn: '' }])); assert.equal(data.books[0].publishedOn, null); assert.equal(data.books[0].sellingPriceKrw, 0); assert.equal(data.books[0].isbn13, null); }
});

test('book pagination distinguishes no results, page boundaries and the provider start limit', async () => {
  const empty = await execute(json([])); assert.equal(empty.status, 'no_data'); assert.equal(empty.pagination.nextStart, null);
  const page = await execute(json([row()], { total: 3, start: 2 }), naverBooksSearchAction, { query: '도서', start: 2 }); assert.equal(page.pagination.nextStart, 3);
  const end = await execute(json([row()], { total: 5000, start: 1000 }), naverBooksSearchAction, { query: '도서', start: 1000 }); assert.equal(end.pagination.nextStart, null); assert.equal(end.pagination.total, 5000);
});

test('ISBN XML parses single/multiple/empty items and compares equivalent ISBNs without treating an empty result as out of print', async () => {
  const data = await execute(xml(), naverBookIsbnAction, { isbn: '0306406152' }); assert.equal(data.requestedIsbn, '0306406152'); assert.equal(data.books[0].title, '시험 도서'); assert.equal(data.books[0].description, '소개 문장'); assert.equal(data.books[0].sellingPriceKrw, null);
  const equivalent = xml().replace('0306406152 9780306406157', '9780306406157'); assert.equal((await execute(equivalent, naverBookIsbnAction, { isbn: '0306406152' })).returnedCount, 1);
  const two = xml().replace('</item>', '</item><item><title>다른 판형</title><link>https://book.naver.com/123</link><author>저자</author><publisher>출판</publisher><isbn>9780306406157</isbn><description/><pubdate/></item>').replace('<total>1</total>', '<total>2</total>'); assert.equal((await execute(two, naverBookIsbnAction, { isbn: '9780306406157' })).returnedCount, 2);
  const empty = await execute(xml('', 0), naverBookIsbnAction, { isbn: '9780306406157' }); assert.equal(empty.status, 'no_data'); assert(empty.dataNote.includes('절판'));
  await assert.rejects(() => execute(xml().replace('0306406152 9780306406157', '080442957X'), naverBookIsbnAction, { isbn: '9780306406157' }), hasCode('INVALID_RESPONSE'));
});

test('book normalization rejects wrong page/envelope, unsafe prices/dates, invalid ISBNs and untrusted result URLs', async () => {
  for (const payload of [{}, '<html>login</html>', json([], { total: -1 }), json([], { total: '0' }), json([], { lastBuildDate: 'unknown' }), json([row()], { start: 2 }), json([row()], { display: 101 }), json([row()], { total: 0 }), json([row()], { display: 0 })]) await assert.rejects(() => execute(payload), hasCode('INVALID_RESPONSE'));
  for (const patch of [{ discount: '-1' }, { discount: '1,000' }, { discount: '9007199254740992' }, { pubdate: '20260229' }, { pubdate: 'tomorrow' }, { isbn: '9780306406158' }, { isbn: 9780306406157 }, { isbn: '0306406152 080442957X' }, { link: 'javascript:alert(1)' }, { link: 'https://naver.com.evil.test' }, { link: 'https://secret@book.naver.com' }]) await assert.rejects(() => execute(json([{ ...row(), ...patch }])), hasCode('INVALID_RESPONSE'));
});

test('book XML rejects DTD/entities, malformed structures and oversized streamed bodies', async () => {
  for (const raw of ['<!DOCTYPE rss [<!ENTITY a "secret">]><rss/>', '<rss><channel></rss>', '<response><items/></response>', xml().replace('<total>1</total>', '<total>NaN</total>')]) await assert.rejects(() => execute(raw, naverBookIsbnAction, { isbn: '9780306406157' }), hasCode('INVALID_RESPONSE'));
  let cancelled = false; const stream = new ReadableStream<Uint8Array>({ pull(controller) { controller.enqueue(new Uint8Array(1_000_001)); }, cancel() { cancelled = true; } });
  await assert.rejects(() => naverBooksExecutor(async () => new Response(stream))(naverBooksSearchAction, context().ctx), hasCode('RESULT_TOO_LARGE')); assert(cancelled);
});

test('book failures await valid Naver credentials, handle quotas/timeouts and never echo provider bodies or connection errors', async () => {
  for (const status of [400, 401, 403, 404, 429, 500]) await assert.rejects(() => naverBooksExecutor(async () => new Response(secrets.clientSecret, { status }))(naverBooksSearchAction, context().ctx), hasCode([401,403].includes(status) ? 'AUTH_REQUIRED' : status === 429 ? 'PROVIDER_RATE_LIMIT' : `PROVIDER_${status}`, [401,403].includes(status) ? 'awaiting_auth' : 'failed'));
  const incomplete: Record<string, string>[] = [{}, { clientId: secrets.clientId }, { ...secrets, clientSecret: 'bad\nheader' }];
  for (const values of incomplete) { const run = context(); run.ctx.secrets = values; await assert.rejects(() => naverBooksExecutor()(naverBooksSearchAction, run.ctx), hasCode('AUTH_REQUIRED', 'awaiting_auth')); assert.equal(run.dispatched(), 0); }
  await assert.rejects(() => naverBooksExecutor(async () => { throw new Error(secrets.clientSecret); })(naverBooksSearchAction, context().ctx), hasCode('PROVIDER_CONNECTION_ERROR'));
  await assert.rejects(() => naverBooksExecutor(async () => { throw new DOMException(secrets.clientSecret, 'TimeoutError'); })(naverBooksSearchAction, context().ctx), hasCode('PROVIDER_TIMEOUT'));
  const controller = new AbortController(), run = context(naverBooksSearchAction, { query: '도서' }, controller); controller.abort(); await assert.rejects(() => naverBooksExecutor()(naverBooksSearchAction, run.ctx), hasCode('CANCELLED', 'cancelled')); assert.equal(run.dispatched(), 0);
  const during = new AbortController(); await assert.rejects(() => naverBooksExecutor(async () => { during.abort(); throw Error('cancel'); })(naverBooksSearchAction, context(naverBooksSearchAction, { query: '도서' }, during).ctx), hasCode('CANCELLED', 'cancelled'));
  await assert.rejects(() => naverBooksExecutor()({ ...naverBooksSearchAction, id: 'naver.orders' }, context().ctx), hasCode('NOT_IMPLEMENTED'));
});

test('retired book HTTP keeps historical previews and rejects execution or new account grants without provider calls', async () => {
  let calls=0;const r=await createRuntime({dataDir:tempDir('retired-books-http'),port:0,vault:new TestVault(),evidenceMode:'mock',fetcher:async()=>{calls++;throw Error('must not call');}});
  try{
    const cookie=await runtimeLogin(r),api=(path:string,method='GET',body?:unknown)=>runtimeApi(r,'/api'+path,method,body,cookie);
    for(const action of retiredActions){
      const input=action.id===retiredSearch.id?{query:'book'}:{isbn:'9780306406157'};
      const preview=await(await api('/drafts/'+action.id+'/preview','POST',input)).json();assert.equal(preview.networkDispatched,false);assert.equal(preview.unavailable.kind,'retired');
      const response=await api('/jobs','POST',{actionId:action.id,input,idempotencyKey:randomUUID()});assert.equal(response.status,409);assert.equal((await response.json()).error.code,'SERVICE_RETIRED');
      await assert.rejects(()=>r.engine.saveAccount({label:'retired',credentialType:'naver-app',allowedActions:[action.id],secrets}),hasCode('SERVICE_RETIRED'));
    }
    assert.equal(calls,0);assert.equal(r.engine.accounts().length,0);assert.equal(r.engine.metrics().verifiedServices,0);
  }finally{await r.close();}
});
