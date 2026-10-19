import { z } from 'zod';
import { zodToJsonSchema } from 'zod-to-json-schema';
import { XMLParser, XMLValidator } from 'fast-xml-parser';
import { ActionError, type Action, type Executor } from '../types.js';

const docs = 'https://www.data4library.kr/apiUtilization';
export const naruRegions = { '11': '서울', '21': '부산', '22': '대구', '23': '인천', '24': '광주', '25': '대전', '26': '울산', '29': '세종', '31': '경기', '32': '강원', '33': '충북', '34': '충남', '35': '전북', '36': '전남', '37': '경북', '38': '경남', '39': '제주' } as const;
const region = z.enum(Object.keys(naruRegions) as [keyof typeof naruRegions, ...(keyof typeof naruRegions)[]]).describe('정보나루 지역 코드: 서울 11·부산 21·경기 31 등. 행정안전부 지역 코드와 다릅니다.');
const district = z.string().regex(/^\d{5}$/).refine(value => value.slice(0, 2) in naruRegions).describe('정보나루 세부지역 코드. 예: 종로구 11010, 서초구 11220, 강남구 11230.');
const libraryCode = z.string().trim().regex(/^\d{6}$/).describe('도서관 찾기 결과의 6자리 libCode. 앞자리 0을 포함한 문자열.');
const isbn = z.string().trim().max(32).transform(value => value.replace(/[\s-]/g, '')).refine(value => /^97[89]\d{10}$/.test(value) && [...value].reduce((sum, digit, i) => sum + Number(digit) * (i % 2 ? 3 : 1), 0) % 10 === 0, '체크 숫자가 유효한 ISBN-13 문자열을 입력하세요.');
const paging = { page: z.number().int().min(1).max(10_000).default(1), limit: z.number().int().min(1).max(100).default(10) };
const matchingRegion = (input: { region?: string; district?: string }) => !input.region || !input.district || input.district.startsWith(input.region);
export const naruLibrariesSchema = z.object({ region: region.optional(), district: district.optional(), libraryCode: libraryCode.optional(), ...paging }).strict().refine(matchingRegion, '지역과 세부지역 코드가 일치해야 합니다.');
export const naruCollectionsSchema = z.object({ isbn, region, district: district.optional(), ...paging }).strict().refine(matchingRegion, '지역과 세부지역 코드가 일치해야 합니다.');
export const naruBookStatusSchema = z.object({ isbn, libraryCode }).strict();
const common = { serviceId: 'library-naru', connectorId: 'library-naru-api', category: '교육·도서', effect: 'read', method: 'api', credentialType: 'library-naru-api', requiredSecrets: ['apiKey'], scopes: [], sourceUrl: docs, checkedAt: '2026-10-19', verification: 'documented', domains: ['data4library.kr'], version: '0.1.0', maintainer: 'KoreAI', origin: 'bundled', implemented: true } as const;
function define(id: string, title: string, description: string, schema: z.ZodTypeAny): Action {
  return { ...common, requiredSecrets: [...common.requiredSecrets], scopes: [], domains: [...common.domains], id, title, description, schema,
    inputSchema: zodToJsonSchema(schema, { $refStrategy: 'none' }) as Record<string, unknown>, resultCheck: '공식 XML의 페이지·결과 수·도서관 코드·ISBN과 요청 에코를 대조합니다. 소장·대출 제공값과 현재 상태를 구분하고 자료 기준일은 추정하지 않습니다.' };
}
export const naruLibrariesAction = define('library-naru.libraries.search', '정보나루 도서관 찾기', '지역·세부지역·도서관 코드로 참여 도서관 한 페이지를 찾습니다. 이름 검색·현재 개관 여부·개인 대출내역은 포함하지 않습니다.', naruLibrariesSchema);
export const naruCollectionsAction = define('library-naru.collections.search', '정보나루 ISBN 소장 도서관 찾기', 'ISBN-13과 지역으로 해당 판본을 소장한 참여 도서관 한 페이지를 조회합니다. 대출 가능 여부는 별도 조회하며 현재 재고를 보장하지 않습니다.', naruCollectionsSchema);
export const naruBookStatusAction = define('library-naru.book.status', '정보나루 도서 소장·대출 제공값 조회', '도서관 코드·ISBN-13으로 소장 여부와 공급자가 제공하는 대출 상태를 조회합니다. API 매뉴얼의 대출 기준은 전날이며 현재 대출 가능 여부는 미확인입니다.', naruBookStatusSchema);
export const naruActions = [naruLibrariesAction, naruCollectionsAction, naruBookStatusAction];
export function naruExample(id: string) {
  if (id === naruLibrariesAction.id) return { region: '11', district: '11010', page: 1, limit: 10 };
  if (id === naruCollectionsAction.id) return { isbn: '9791191056556', region: '11', page: 1, limit: 10 };
  return { isbn: '9791191056556', libraryCode: '050001' };
}
export function naruRequestTemplate(id: string, raw: unknown) {
  const action = naruActions.find(item => item.id === id); if (!action) throw new ActionError('NOT_IMPLEMENTED', '정보나루 실행기에 등록되지 않은 행동입니다.');
  const input = action.schema.parse(raw), query: Record<string, string | number> = { format: 'xml' };
  if (input.libraryCode) query.libCode = input.libraryCode;
  if (input.region) query.region = input.region;
  if (input.district) query.dtl_region = input.district;
  if (input.isbn) query[id === naruCollectionsAction.id ? 'isbn' : 'isbn13'] = input.isbn;
  if (id !== naruBookStatusAction.id) { query.pageNo = input.page; query.pageSize = input.limit; }
  const operation = id === naruLibrariesAction.id ? 'libSrch' : id === naruCollectionsAction.id ? 'libSrchByBook' : 'bookExist';
  return { method: 'GET' as const, endpoint: `https://data4library.kr/api/${operation}`, query, authentication: { secretField: 'apiKey' as const, queryParameter: 'authKey' }, responseFormat: 'xml' as const };
}
const invalid = () => new ActionError('INVALID_RESPONSE', '정보나루 응답의 구조·페이지·결과 수·식별자 또는 좌표가 유효하지 않습니다.');
const integer = z.string().trim().regex(/^\d+$/).transform(Number).pipe(z.number().int().nonnegative().safe());
const text = z.string().trim().max(20_000);
const optionalText = text.nullish();
const libraryRow = z.object({ libCode: libraryCode, libName: text.min(1), address: optionalText, tel: optionalText, homepage: optionalText, closed: optionalText, operatingTime: optionalText, latitude: optionalText, longitude: optionalText, BookCount: z.union([integer, z.literal('')]).nullish() });
const parser = new XMLParser({ parseTagValue: false, trimValues: false, ignoreAttributes: true, ignoreDeclaration: true,
  processEntities: { enabled: true, maxTotalExpansions: 10_000, maxExpandedLength: 100_000 }, htmlEntities: false });
function responseBody(raw: string) {
  if (/<!\s*(?:DOCTYPE|ENTITY)\b/i.test(raw) || XMLValidator.validate(raw) !== true) throw invalid();
  let body: any; try { body = parser.parse(raw)?.response; } catch { throw invalid(); }
  if (!body || typeof body !== 'object' || Array.isArray(body)) throw invalid();
  if ('errCode' in body || 'error' in body) {
    if (typeof body.errCode === 'string' && body.errCode.trim() === 'authErr') throw new ActionError('AUTH_REQUIRED', '정보나루의 승인된 본인 인증키와 서버 IP·이용 조건을 확인한 뒤 재개하세요.', 'awaiting_auth');
    throw new ActionError('PROVIDER_ERROR', '정보나루가 요청을 거절했습니다. 입력·키·등록 서버 IP·공유 사용량과 서비스 상태를 확인하세요.');
  }
  return body as Record<string, any>;
}
function checkEcho(body: Record<string, any>, query: Record<string, string | number>, required: boolean) {
  const echo = body.request;
  if (echo === undefined && !required) return;
  if (!echo || typeof echo !== 'object' || Array.isArray(echo)) throw invalid();
  for (const key of ['libCode', 'isbn13', 'isbn', 'region', 'dtl_region', 'pageNo', 'pageSize']) {
    const actual = echo[key];
    if (actual !== undefined && (typeof actual !== 'string' || query[key] === undefined || actual.trim() !== String(query[key]))) throw invalid();
  }
  if (required && (echo.libCode?.trim() !== query.libCode || echo.isbn13?.trim() !== query.isbn13)) throw invalid();
}
function homepage(value?: string | null) {
  if (!value) return null;
  try { const url = new URL(value); return ['http:', 'https:'].includes(url.protocol) && !url.username && !url.password ? url.href : null; } catch { return null; }
}
function coordinates(row: z.infer<typeof libraryRow>) {
  const raw = { latitude: row.latitude || null, longitude: row.longitude || null };
  if (!raw.latitude || !raw.longitude) return { latitude: null, longitude: null, raw };
  if (![raw.latitude, raw.longitude].every(value => /^-?\d+(?:\.\d+)?$/.test(value))) throw invalid();
  const latitude = Number(raw.latitude), longitude = Number(raw.longitude);
  if (Math.abs(latitude) > 90 || Math.abs(longitude) > 180) throw invalid();
  return { latitude: latitude === 0 && longitude === 0 ? null : latitude, longitude: latitude === 0 && longitude === 0 ? null : longitude, raw };
}
function normalize(raw: string, action: Action, input: Record<string, any>, query: Record<string, string | number>) {
  const body = responseBody(raw); checkEcho(body, query, action.id === naruBookStatusAction.id);
  const metadata = { retrievedAt: new Date().toISOString(), providerUpdatedAt: null, timezone: 'Asia/Seoul', source: { name: '도서관 정보나루', url: docs },
    dataNote: '참여 도서관의 제공 자료이며 전체 도서관·모든 판본을 포괄하지 않습니다. 공식 MCP 안내의 소장 자료는 월 단위 갱신이며 API 매뉴얼의 대출 상태는 조회일 기준 전날입니다. 실제 자료 기준일은 미제공입니다. 조회 시각은 자료 갱신 시각이 아니며 현재 개관·재고·대출 가능 여부는 미확인입니다.' };
  if (action.id === naruBookStatusAction.id) {
    const result = z.object({ hasBook: z.enum(['Y', 'N']), loanAvailable: z.union([z.enum(['Y', 'N']), z.literal('')]).nullish() }).safeParse(body.result);
    if (!result.success || result.data.hasBook === 'N' && result.data.loanAvailable === 'Y') throw invalid();
    return { status: 'available', libraryCode: input.libraryCode, requestedIsbn: input.isbn, hasBook: result.data.hasBook === 'Y', loanAvailableReported: result.data.loanAvailable ? result.data.loanAvailable === 'Y' : null,
      currentLoanAvailable: null, loanStatusBasis: 'previous_day_per_api_manual', loanStatusDate: null, ...metadata };
  }
  const envelope = z.object({ pageNo: integer, pageSize: integer, numFound: integer, resultNum: integer }).safeParse(body);
  if (!envelope.success) throw invalid();
  const page = envelope.data, container = body.libs;
  if (container !== undefined && container !== '' && (!container || typeof container !== 'object' || Array.isArray(container) || !('lib' in container))) throw invalid();
  const items = container && typeof container === 'object' ? container.lib : undefined;
  const rows = items === undefined || items === '' ? [] : Array.isArray(items) ? items : [items];
  const parsed = z.array(libraryRow).max(input.limit).safeParse(rows), offset = (input.page - 1) * input.limit;
  if (!parsed.success || page.pageNo !== input.page || page.pageSize !== input.limit || page.resultNum !== rows.length || rows.length !== Math.min(input.limit, Math.max(0, page.numFound - offset))) throw invalid();
  if (new Set(parsed.data.map(row => row.libCode)).size !== rows.length || input.libraryCode && parsed.data.some(row => row.libCode !== input.libraryCode)) throw invalid();
  const libraries = parsed.data.map(row => ({ libraryCode: row.libCode, name: row.libName, address: row.address || null, phone: row.tel || null,
    homepageUrl: homepage(row.homepage), operatingTimeRaw: row.operatingTime || null, closedDaysRaw: row.closed || null, coordinates: coordinates(row), bookCount: typeof row.BookCount === 'number' ? row.BookCount : null, currentlyOpen: null, currentLoanAvailable: null }));
  return { status: libraries.length ? 'available' : 'no_data', libraries, requestedIsbn: input.isbn ?? null, returnedCount: libraries.length,
    pagination: { page: input.page, limit: input.limit, total: page.numFound, nextPage: libraries.length && offset + rows.length < page.numFound && input.page < 10_000 ? input.page + 1 : null }, ...metadata };
}
async function readBody(response: Response) {
  const reader = response.body?.getReader(); if (!reader) throw invalid();
  const decoder = new TextDecoder('utf-8', { fatal: true }); let raw = '', bytes = 0;
  const decode = (bytes?: Uint8Array, stream = false) => { try { return decoder.decode(bytes, { stream }); } catch { throw invalid(); } };
  try { for (;;) { const part = await reader.read(); if (part.done) break; bytes += part.value.byteLength;
    if (bytes > 2_000_000) { await reader.cancel(); throw new ActionError('RESULT_TOO_LARGE', '정보나루 응답이 너무 큽니다. 조회 개수를 줄여 주세요.'); } raw += decode(part.value, true); }
    return raw + decode();
  } finally { reader.releaseLock(); }
}
export function naruExecutor(fetcher: typeof fetch = fetch): Executor {
  return async (action, context) => {
    if (!naruActions.some(item => item.id === action.id)) throw new ActionError('NOT_IMPLEMENTED', '정보나루 실행기에 등록되지 않은 행동입니다.');
    const input = action.schema.parse(context.job.input), template = naruRequestTemplate(action.id, input);
    if (context.signal.aborted) throw new ActionError('CANCELLED', '작업이 취소됐습니다.', 'cancelled');
    const key = context.secrets.apiKey?.trim();
    if (!key || key.length > 4096 || /[^\x21-\x7e]/.test(key)) throw new ActionError('AUTH_REQUIRED', '정보나루에서 승인받은 본인 Open API 인증키를 등록하세요.', 'awaiting_auth');
    const url = new URL(template.endpoint); for (const [name, value] of Object.entries(template.query)) url.searchParams.set(name, String(value)); url.searchParams.set('authKey', key);
    const signal = AbortSignal.any([context.signal, AbortSignal.timeout(30_000)]); context.dispatch();
    try {
      const response = await fetcher(url, { method: 'GET', headers: { Accept: 'application/xml' }, redirect: 'error', cache: 'no-store', signal });
      if ([401, 403].includes(response.status)) throw new ActionError('AUTH_REQUIRED', '정보나루 키·서버 IP·접근 조건을 확인한 뒤 재개하세요.', 'awaiting_auth');
      if (response.status === 429) throw new ActionError('PROVIDER_RATE_LIMIT', '정보나루의 API·MCP 공유 사용량과 등록 IP의 한도를 확인하세요.');
      if (!response.ok) throw new ActionError(`PROVIDER_${response.status}`, '정보나루 API가 정상 결과를 반환하지 않았습니다.');
      const data = normalize(await readBody(response), action, input, template.query);
      if (context.signal.aborted) throw new ActionError('CANCELLED', '작업이 취소됐습니다.', 'cancelled');
      return { data, evidence: action.resultCheck };
    } catch (error) {
      if (context.signal.aborted) throw new ActionError('CANCELLED', '작업이 취소됐습니다.', 'cancelled');
      if (error instanceof ActionError) throw error;
      if (signal.aborted || error instanceof Error && error.name === 'TimeoutError') throw new ActionError('PROVIDER_TIMEOUT', '정보나루 응답 시간이 초과됐습니다.');
      throw new ActionError('PROVIDER_CONNECTION_ERROR', '정보나루 HTTPS API에 연결하지 못했습니다. 네트워크·서비스 상태를 확인하세요.');
    }
  };
}
