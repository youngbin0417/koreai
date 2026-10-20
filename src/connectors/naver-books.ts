import { z } from 'zod';
import { zodToJsonSchema } from 'zod-to-json-schema';
import { XMLParser, XMLValidator } from 'fast-xml-parser';
import { ActionError, assertActionAvailable, type Action, type Executor } from '../types.js';
import { naverSearchAvailability } from './naver-availability.js';

const docs = 'https://developers.naver.com/docs/serviceapi/search/book/book.md';
function validIsbn(value: string) {
  if (/^\d{9}[\dX]$/.test(value)) return [...value].reduce((sum, digit, i) => sum + (digit === 'X' ? 10 : Number(digit)) * (10 - i), 0) % 11 === 0;
  return /^97[89]\d{10}$/.test(value) && [...value].reduce((sum, digit, i) => sum + Number(digit) * (i % 2 ? 3 : 1), 0) % 10 === 0;
}
function isbn13(value: string) {
  if (value.length === 13) return value;
  const prefix = `978${value.slice(0, 9)}`;
  const check = (10 - [...prefix].reduce((sum, digit, i) => sum + Number(digit) * (i % 2 ? 3 : 1), 0) % 10) % 10;
  return `${prefix}${check}`;
}
export const naverBooksSearchSchema = z.object({ query: z.string().trim().min(1).max(1000), display: z.number().int().min(1).max(100).default(10), start: z.number().int().min(1).max(1000).default(1), sort: z.enum(['sim', 'date']).default('sim') }).strict();
export const naverBookIsbnSchema = z.object({ isbn: z.string().trim().max(32).transform(value => value.replace(/[\s-]/g, '').toUpperCase()).refine(validIsbn, '체크 숫자가 유효한 ISBN-10 또는 ISBN-13 문자열을 입력하세요.') }).strict();
const common = { serviceId: 'naver-search', connectorId: 'naver-search', category: '교육·도서', effect: 'read', method: 'api', credentialType: 'naver-app', requiredSecrets: ['clientId', 'clientSecret'], scopes: [], sourceUrl: docs, checkedAt: '2026-10-19', verification: 'documented', domains: ['openapi.naver.com'], version: '0.1.0', maintainer: 'KoreAI', origin: 'bundled', implemented: true } as const;
function define(id: string, title: string, description: string, schema: z.ZodTypeAny): Action {
  return { ...common, requiredSecrets: [...common.requiredSecrets], scopes: [], domains: [...common.domains], id, title, description, schema, inputSchema: zodToJsonSchema(schema, { $refStrategy: 'none' }) as Record<string, unknown>, unavailable: naverSearchAvailability(id), resultCheck: '종료된 API의 과거 규격 검토용입니다. 응답 파서는 보존하며 실제 실행은 차단합니다.' };
}
export const naverBooksSearchAction = define('naver.search.book', '네이버 도서 검색', '공식 검색 API로 책 제목·저자·출판사·ISBN·제공된 판매 가격을 조회합니다. 기존 네이버 검색 앱 키를 쓰며 서점별 재고·주문·개인 구매내역은 포함하지 않습니다.', naverBooksSearchSchema);
export const naverBookIsbnAction = define('naver.book.isbn', '네이버 ISBN 도서 조회', '공식 XML 상세 검색으로 ISBN에 맞는 도서를 조회합니다. ISBN-10/13 체크 숫자와 반환 ISBN을 확인하며 결과가 없어도 절판으로 단정하지 않습니다.', naverBookIsbnSchema);
export const naverBooksActions = [naverBooksSearchAction, naverBookIsbnAction];
export function naverBooksExample(id: string) { return id === naverBooksSearchAction.id ? { query: '한국 문학', display: 10, start: 1, sort: 'sim' } : { isbn: '9788960515529' }; }
export function naverBooksRequestTemplate(id: string, raw: unknown) {
  let query: Record<string, string | number>;
  if (id === naverBooksSearchAction.id) query = naverBooksSearchSchema.parse(raw);
  else if (id === naverBookIsbnAction.id) query = { d_isbn: naverBookIsbnSchema.parse(raw).isbn, display: 100, start: 1 };
  else throw new ActionError('NOT_IMPLEMENTED', '도서 실행기에 등록되지 않은 행동입니다.');
  return { method: 'GET' as const, endpoint: `https://openapi.naver.com/v1/search/${id === naverBooksSearchAction.id ? 'book.json' : 'book_adv.xml'}`, query,
    authentication: { headers: { 'X-Naver-Client-Id': { secretField: 'clientId' }, 'X-Naver-Client-Secret': { secretField: 'clientSecret' } } }, responseFormat: id === naverBooksSearchAction.id ? 'json' as const : 'xml' as const };
}
const invalid = () => new ActionError('INVALID_RESPONSE', '네이버 도서 응답의 구조·페이지·식별자·날짜 또는 가격이 유효하지 않습니다.');
const count = z.number().int().nonnegative().safe();
const text = z.string().max(100_000);
const bookRow = z.object({ title: text.min(1), link: text, author: text, publisher: text, isbn: text, description: text, pubdate: text, discount: z.union([text, count]).nullish() });
function plain(value: string) { return value.replace(/<[^>]*>/g, '').replace(/&(?:lt|gt|amp|quot|apos|#39);/g, entity => ({ '&lt;': '<', '&gt;': '>', '&amp;': '&', '&quot;': '"', '&apos;': "'", '&#39;': "'" })[entity]!).trim(); }
function publicationDate(value: string) {
  if (!value) return null;
  // Partial year/month dates stay raw; do not manufacture a day.
  if (!/^(?:\d{4}|\d{6}|\d{8})$/.test(value) || Number(value.slice(0, 4)) === 0 || value.length >= 6 && Number(value.slice(4, 6)) > 12) throw invalid();
  if (value.length < 8 || value.endsWith('00')) return null;
  const date = `${value.slice(0, 4)}-${value.slice(4, 6)}-${value.slice(6)}`;
  if (!Number.isFinite(Date.parse(date)) || new Date(date).toISOString().slice(0, 10) !== date) throw invalid();
  return date;
}
function providerError(status: number): never {
  if ([401, 403].includes(status)) throw new ActionError('AUTH_REQUIRED', '네이버 앱 ID·Secret과 검색 API 설정을 확인한 뒤 재개하세요.', 'awaiting_auth');
  if (status === 429) throw new ActionError('PROVIDER_RATE_LIMIT', '네이버 검색 API 호출 한도를 초과했습니다. 검색 API는 앱별 사용량을 공유합니다.');
  throw new ActionError(`PROVIDER_${status}`, '네이버 도서 API가 요청을 거절했습니다. 입력·권한·서비스 상태를 확인하세요.');
}
function normalize(raw: string, action: Action, input: Record<string, any>) {
  let value: unknown;
  try {
    if (action.id === naverBooksSearchAction.id) value = JSON.parse(raw);
    else {
      if (/<!\s*(?:DOCTYPE|ENTITY)/i.test(raw) || XMLValidator.validate(raw) !== true) throw invalid();
      const parsed = new XMLParser({ parseTagValue: false, ignoreAttributes: true, trimValues: false }).parse(raw.replace(/<\/?b>/gi, ''));
      const channel = parsed?.rss?.channel;
      if (!channel || typeof channel !== 'object') throw invalid();
      const number = (v: unknown) => typeof v === 'string' && /^\d+$/.test(v) ? Number(v) : NaN;
      value = { lastBuildDate: channel.lastBuildDate, total: number(channel.total), start: number(channel.start), display: number(channel.display), items: channel.item === undefined ? [] : Array.isArray(channel.item) ? channel.item : [channel.item] };
    }
  } catch { throw invalid(); }
  const parsed = z.object({ lastBuildDate: z.string().min(1).max(100), total: count, start: count.min(1).max(1000), display: count.max(100), items: z.array(bookRow).max(100) }).safeParse(value);
  if (!parsed.success) throw invalid();
  const body = parsed.data, requestedStart = input.start ?? 1, limit = input.display ?? 100;
  if (!Number.isFinite(Date.parse(body.lastBuildDate)) || body.start !== requestedStart || body.display > limit || body.items.length > body.display || body.items.length && body.start + body.items.length - 1 > body.total) throw invalid();
  const books = body.items.map(row => {
    const tokens = row.isbn.trim() ? row.isbn.trim().split(/\s+/) : [];
    if (tokens.some(token => !validIsbn(token)) || new Set(tokens).size !== tokens.length || tokens.length > 2 || tokens.length === 2 && isbn13(tokens[0]!) !== isbn13(tokens[1]!)) throw invalid();
    if (input.isbn && !tokens.some(token => isbn13(token) === isbn13(input.isbn))) throw invalid();
    let link: URL; try { link = new URL(row.link); } catch { throw invalid(); }
    if (!['http:', 'https:'].includes(link.protocol) || link.username || link.password || link.port || !(link.hostname === 'naver.com' || link.hostname.endsWith('.naver.com'))) throw invalid();
    const priceRaw = row.discount, price = priceRaw === undefined || priceRaw === null || priceRaw === '' ? null : typeof priceRaw === 'number' ? priceRaw : /^\d+$/.test(priceRaw) ? Number(priceRaw) : NaN;
    if (price !== null && (!Number.isSafeInteger(price) || price < 0)) throw invalid();
    return { title: plain(row.title), authorRaw: plain(row.author), publisher: plain(row.publisher), isbnRaw: row.isbn, isbn10: tokens.find(token => token.length === 10) ?? null, isbn13: tokens.find(token => token.length === 13) ?? null,
      description: plain(row.description), publicationDateRaw: row.pubdate, publishedOn: publicationDate(row.pubdate), sellingPriceKrw: price, naverUrl: link.href, availability: 'unverified' };
  });
  const next = body.start + books.length;
  return { status: books.length ? 'available' : 'no_data', books, returnedCount: books.length, requestedIsbn: input.isbn ?? null,
    pagination: { total: body.total, start: body.start, display: body.display, nextStart: action.id === naverBooksSearchAction.id && books.length && next <= body.total && next <= 1000 ? next : null, accessibleStartLimit: 1000, truncated: !!input.isbn && body.total > books.length },
    searchGeneratedAtRaw: body.lastBuildDate, retrievedAt: new Date().toISOString(), providerUpdatedAt: null, timezone: 'Asia/Seoul', source: { name: 'NAVER 도서 검색', url: docs },
    dataNote: '판매 가격은 공급자가 제공한 조회 시점 값이며 최저가·배송비·재고를 보장하지 않습니다. 누락 가격은 무료·절판을 뜻하지 않습니다. 검색 생성 시각은 서지 갱신 시각이 아닙니다. 지점 재고·구매내역·대출 가능 여부는 미확인입니다.' };
}
async function readBody(response: Response) {
  const reader = response.body?.getReader(); if (!reader) throw invalid();
  const decoder = new TextDecoder('utf-8', { fatal: true }); let raw = '', bytes = 0;
  try { for (;;) { const part = await reader.read(); if (part.done) break; bytes += part.value.byteLength;
    if (bytes > 2_000_000) { await reader.cancel(); throw new ActionError('RESULT_TOO_LARGE', '네이버 도서 응답이 너무 큽니다. 검색 개수를 줄여 주세요.'); }
    raw += decoder.decode(part.value, { stream: true }); } return raw + decoder.decode();
  } catch (error) { if (error instanceof TypeError && error.message.includes('encoded data')) throw invalid(); throw error; }
  finally { reader.releaseLock(); }
}
export function naverBooksExecutor(fetcher: typeof fetch = fetch): Executor {
  return async (action, context) => {
    assertActionAvailable(action);
    if (!naverBooksActions.some(item => item.id === action.id)) throw new ActionError('NOT_IMPLEMENTED', '도서 실행기에 등록되지 않은 행동입니다.');
    const input = action.schema.parse(context.job.input), template = naverBooksRequestTemplate(action.id, input);
    if (context.signal.aborted) throw new ActionError('CANCELLED', '작업이 취소됐습니다.', 'cancelled');
    const clientId = context.secrets.clientId?.trim(), clientSecret = context.secrets.clientSecret?.trim();
    if (!clientId || !clientSecret || [clientId, clientSecret].some(value => value.length > 4096 || /[^\x21-\x7e]/.test(value))) throw new ActionError('AUTH_REQUIRED', '검색 API를 설정한 네이버 앱 ID·Secret을 등록하세요.', 'awaiting_auth');
    const url = new URL(template.endpoint); for (const [name, value] of Object.entries(template.query)) url.searchParams.set(name, String(value));
    const signal = AbortSignal.any([context.signal, AbortSignal.timeout(30_000)]); context.dispatch();
    try {
      const response = await fetcher(url, { method: 'GET', headers: { Accept: template.responseFormat === 'json' ? 'application/json' : 'application/xml', 'X-Naver-Client-Id': clientId, 'X-Naver-Client-Secret': clientSecret }, redirect: 'error', signal });
      if (!response.ok) providerError(response.status);
      const data = normalize(await readBody(response), action, input);
      if (context.signal.aborted) throw new ActionError('CANCELLED', '작업이 취소됐습니다.', 'cancelled');
      return { data, evidence: action.resultCheck };
    } catch (error) {
      if (context.signal.aborted) throw new ActionError('CANCELLED', '작업이 취소됐습니다.', 'cancelled');
      if (error instanceof ActionError) throw error;
      if (signal.aborted || error instanceof Error && error.name === 'TimeoutError') throw new ActionError('PROVIDER_TIMEOUT', '네이버 도서 응답 시간이 초과됐습니다.');
      throw new ActionError('PROVIDER_CONNECTION_ERROR', '네이버 도서 API에 연결하지 못했습니다. 네트워크와 서비스 상태를 확인하세요.');
    }
  };
}
