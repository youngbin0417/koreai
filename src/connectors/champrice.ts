import { createHash } from 'node:crypto';
import iconv from 'iconv-lite';
import { z } from 'zod';
import { zodToJsonSchema } from 'zod-to-json-schema';
import { ActionError, type Action, type Executor } from '../types.js';

export const champriceSourceUrl = 'https://www.data.go.kr/data/15083256/fileData.do';
// Reviewed monthly attachment, never an arbitrary URL or a silently selected newer file.
export const champriceSnapshot = {
  month: '2026-09', publishedOn: '2026-10-02', label: '2026년 9월',
  endpoint: 'https://www.data.go.kr/cmm/cmm/fileDownload.do',
  query: { atchFileId: 'FILE_000000007707356', fileDetailSn: '1', insertDataPrcus: 'N' },
} as const;
export const champriceMaxBytes = 32_000_000;
const maxRows = 300_000, maxPage = 10_000;
const calendarDate = (value: string) => {
  const date = new Date(`${value}T00:00:00Z`);
  return /^\d{4}-\d{2}-\d{2}$/.test(value) && Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value;
};
const searchText = z.string().max(100).refine(v => !/\p{C}/u.test(v), '제어문자 없이 입력하세요.').transform(v => v.trim()).pipe(z.string().min(1));
export const champriceSchema = z.object({
  productName: searchText, match: z.enum(['contains', 'exact']).default('contains'),
  manufacturer: searchText.optional(), storeQuery: searchText.optional(),
  surveyDate: z.string().refine(v => calendarDate(v) && v.startsWith(champriceSnapshot.month + '-'), `${champriceSnapshot.month}의 실제 조사일 형식(YYYY-MM-DD)을 입력하세요.`).optional(),
  page: z.number().int().min(1).max(maxPage).default(1), limit: z.number().int().min(1).max(50).default(10),
}).strict();
export const champriceAction: Action = {
  id: 'champrice.prices.search', serviceId: 'champrice', connectorId: 'kca-champrice-file', title: '참가격 생필품 조사 가격 찾기',
  description: '키 없이 한국소비자원의 2026년 9월 공개 CSV에서 상품명·제조사·판매업소·조사일로 가격을 찾습니다. 파일 전체를 받은 뒤 조건을 적용합니다. 실시간 판매가·재고·동일 상품 판정·단위 가격 비교는 제공하지 않습니다.',
  category: '쇼핑·중고', effect: 'read', method: 'public-data', schema: champriceSchema,
  inputSchema: zodToJsonSchema(champriceSchema, { $refStrategy: 'none' }) as Record<string, unknown>, requiredSecrets: [], scopes: [],
  sourceUrl: champriceSourceUrl, checkedAt: '2026-10-21', verification: 'documented',
  resultCheck: '고정 HTTPS 첨부파일의 크기·인코딩·CSV 헤더/행·조사월/실제 날짜·정수 가격·할인 표기를 검증합니다. 자료 지문·전체/일치 건수·조사일을 남기고 빈 할인 정보와 N, 조사 가격과 현재 가격을 구분합니다.',
  domains: ['www.data.go.kr'], version: '0.1.0', maintainer: 'KoreAI', origin: 'bundled', implemented: true,
};
export const champriceExample = () => ({ productName: '우유', surveyDate: '2026-09-25', page: 1, limit: 10 });
export function champriceRequestTemplate(raw: unknown) {
  const input = champriceSchema.parse(raw);
  return { method: 'GET' as const, endpoint: champriceSnapshot.endpoint, query: champriceSnapshot.query,
    authentication: { type: 'none' as const }, responseFormat: 'csv' as const,
    snapshot: { month: champriceSnapshot.month, publishedOn: champriceSnapshot.publishedOn },
    localFilter: input, maxBytes: champriceMaxBytes };
}
const invalid = () => new ActionError('INVALID_RESPONSE', '참가격 파일의 CSV·조사월·날짜·가격·할인 정보가 유효하지 않습니다.');
const tooLarge = () => new ActionError('RESULT_TOO_LARGE', '참가격 파일의 크기·행 수·필드 상한을 초과했습니다.');

// Yield rows individually: a 235k-row file must not become an array of all records.
function* csvRows(text: string): Generator<string[]> {
  let row: string[] = [], field = '', quoted = false, closed = false, count = 0;
  const finishField = () => { row.push(field.trim()); field = ''; closed = false; if (row.length > 24) throw invalid(); };
  const finishRow = () => { finishField(); const current = row; row = []; if (++count > maxRows + 1) throw tooLarge(); return current; };
  for (let i = 0; i < text.length; i++) {
    const char = text[i]!;
    if (quoted) { if (char === '"') { if (text[i + 1] === '"') { field += '"'; i++; } else { quoted = false; closed = true; } } else field += char; }
    else if (char === ',') finishField();
    else if (char === '\n' || char === '\r') { const value = finishRow(); if (char === '\r' && text[i + 1] === '\n') i++; if (value.some(v => v !== '')) yield value; }
    else if (closed) { if (char !== ' ' && char !== '\t') throw invalid(); }
    else if (char === '"') { if (field) throw invalid(); quoted = true; }
    else field += char;
    if (field.length > 2_000) throw tooLarge();
  }
  if (quoted) throw invalid();
  if (field || row.length || closed) { const value = finishRow(); if (value.some(v => v !== '')) yield value; }
}
const price = (raw: string) => { if (!/^\d{1,12}$/.test(raw)) throw invalid(); return Number(raw); };
const flag = (raw: string) => { if (!['', 'Y', 'N'].includes(raw)) throw invalid(); return raw === '' ? null : raw === 'Y'; };
const fold = (value: string) => value.normalize('NFC').toLocaleLowerCase('ko-KR');
type PriceRow = { sourceRow: number; productNameRaw: string; manufacturerRaw: string; storeNameRaw: string; surveyedOn: string;
  priceKrw: number; priceRaw: string; sale: boolean | null; saleRaw: string | null; onePlusOne: boolean | null; onePlusOneRaw: string | null;
  productIdentityVerified: false; quantity: null; unitPriceKrw: null; currentPriceKrw: null; inStock: null };

export function normalizeChampriceCsv(bytes: Uint8Array, raw: unknown) {
  const input = champriceSchema.parse(raw);
  if (bytes.byteLength > champriceMaxBytes) throw tooLarge();
  let text: string, encoding: string;
  try { text = new TextDecoder('utf-8', { fatal: true }).decode(bytes); encoding = 'utf-8'; }
  catch {
    text = iconv.decode(Buffer.from(bytes), 'cp949'); encoding = 'cp949';
    if (text.includes('\uFFFD') || !iconv.encode(text, 'cp949').equals(Buffer.from(bytes))) throw invalid();
  }
  const iterator = csvRows(text.replace(/^\uFEFF/, '')), headers = iterator.next().value as string[] | undefined;
  const required = ['상품명', '조사일', '판매가격', '판매업소', '제조사', '세일여부', '원플러스원'];
  if (!headers || headers.length !== required.length || new Set(headers).size !== headers.length || required.some(key => !headers.includes(key))) throw invalid();
  const columns = new Map(headers.map((key, index) => [key, index])), results: PriceRow[] = [];
  const query = fold(input.productName), store = input.storeQuery ? fold(input.storeQuery) : null, manufacturer = input.manufacturer ? fold(input.manufacturer) : null;
  const offset = (input.page - 1) * input.limit, dates = new Set<string>();
  let totalSourceRows = 0, totalMatches = 0;
  for (const row of iterator) {
    if (row.length !== headers.length) throw invalid();
    const get = (key: string) => row[columns.get(key)!]!;
    const name = get('상품명'), maker = get('제조사'), shop = get('판매업소'), date = get('조사일'), amountRaw = get('판매가격');
    if (!name || !maker || !shop || /[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/.test(name + maker + shop) || !calendarDate(date) || !date.startsWith(champriceSnapshot.month + '-')) throw invalid();
    const amount = price(amountRaw), sale = flag(get('세일여부')), onePlusOne = flag(get('원플러스원'));
    totalSourceRows++; dates.add(date);
    const nameMatches = input.match === 'exact' ? fold(name) === query : fold(name).includes(query);
    if (!nameMatches || manufacturer !== null && fold(maker) !== manufacturer || store !== null && !fold(shop).includes(store) || input.surveyDate && date !== input.surveyDate) continue;
    if (totalMatches >= offset && results.length < input.limit) results.push({ sourceRow: totalSourceRows, productNameRaw: name, manufacturerRaw: maker, storeNameRaw: shop, surveyedOn: date,
      priceKrw: amount, priceRaw: amountRaw, sale, saleRaw: get('세일여부') || null, onePlusOne, onePlusOneRaw: get('원플러스원') || null,
      productIdentityVerified: false, quantity: null, unitPriceKrw: null, currentPriceKrw: null, inStock: null });
    totalMatches++;
  }
  if (totalSourceRows === 0) throw new ActionError('SOURCE_EMPTY', '참가격 원본 파일에 조사 자료가 없습니다. 정상적인 검색 0건과 구분해 확인하세요.', 'needs_review');
  const hasMore = offset + results.length < totalMatches;
  return { status: results.length ? 'available' : totalMatches ? 'empty_page' : 'no_data', query: input, prices: results,
    totalSourceRows, totalMatches, returnedCount: results.length, pagination: { page: input.page, limit: input.limit, hasMore, nextPage: hasMore && input.page < maxPage ? input.page + 1 : null, pageLimitReached: hasMore && input.page === maxPage },
    filterScope: 'reviewed_monthly_file', snapshot: { month: champriceSnapshot.month, label: champriceSnapshot.label, publishedOn: champriceSnapshot.publishedOn, surveyDates: [...dates].sort(), sha256: createHash('sha256').update(bytes).digest('hex'), encoding },
    retrievedAt: new Date().toISOString(), timezone: 'Asia/Seoul',
    dataNote: '2026년 9월 조사 가격이며 다운로드 시각의 실시간 판매가·재고가 아닙니다. 상품명·용량·제조사·조사일·판매업소를 확인하세요. 같은 이름만으로 동일 상품을 판정하지 않고 단위 가격·가격 순위·할인 조합을 계산하지 않습니다. 할인/1+1의 빈 값은 미수집(null)이며 N(false)과 다릅니다. 고정 월 파일 전체를 받은 뒤 로컬 필터·파일 순서로 페이지를 만듭니다. sourceRow는 파일 안의 행 참조이며 공급자 상품 ID가 아닙니다.',
    source: { name: '한국소비자원 참가격 · 공공데이터포털', url: champriceSourceUrl, downloadUrl: new URL(champriceSnapshot.endpoint + '?' + new URLSearchParams(champriceSnapshot.query)).href, attribution: '출처: 한국소비자원 생필품 가격 정보(2026년 9월 조사)', checkedAt: '2026-10-21' } };
}
async function readBytes(response: Response) {
  const declared = response.headers.get('content-length');
  if (declared && /^\d+$/.test(declared) && Number(declared) > champriceMaxBytes) { await response.body?.cancel(); throw tooLarge(); }
  const reader = response.body?.getReader(); if (!reader) throw invalid();
  const chunks: Uint8Array[] = []; let size = 0;
  try {
    for (;;) { const part = await reader.read(); if (part.done) break; size += part.value.byteLength; if (size > champriceMaxBytes) throw tooLarge(); chunks.push(part.value); }
    if (!response.headers.has('content-encoding') && declared && /^\d+$/.test(declared) && Number(declared) !== size) throw invalid();
  } catch (error) { try { await reader.cancel(); } catch { /* Keep the original error. */ } throw error; }
  finally { reader.releaseLock(); }
  const bytes = new Uint8Array(size); let offset = 0; for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.length; } return bytes;
}
export function champriceExecutor(fetcher: typeof fetch = fetch): Executor {
  return async (action, context) => {
    if (action.id !== champriceAction.id) throw new ActionError('NOT_IMPLEMENTED', '참가격 실행기에 등록되지 않은 행동입니다.');
    const input = champriceSchema.parse(context.job.input), template = champriceRequestTemplate(input), url = new URL(template.endpoint);
    for (const [key, value] of Object.entries(template.query)) url.searchParams.set(key, value);
    const signal = AbortSignal.any([context.signal, AbortSignal.timeout(60_000)]);
    const cancelled = () => { if (context.signal.aborted) throw new ActionError('CANCELLED', '작업이 취소됐습니다.', 'cancelled'); };
    cancelled();
    try {
      context.dispatch();
      const response = await fetcher(url, { method: 'GET', headers: { Accept: 'text/csv, application/octet-stream' }, redirect: 'error', cache: 'no-store', signal });
      try {
        if (response.status === 429) throw new ActionError('PROVIDER_RATE_LIMIT', '참가격 다운로드 한도를 초과했습니다. 자동 재시도하지 않습니다.');
        if (!response.ok) throw new ActionError(`PROVIDER_HTTP_${response.status}`, '참가격 공개 파일 요청이 거절됐습니다. 공식 서비스 상태를 확인하세요.');
        if (!/^(?:text\/csv|application\/(?:csv|octet-stream))(?:;|$)/i.test(response.headers.get('content-type') ?? '')) throw invalid();
      } catch (error) { await response.body?.cancel(); throw error; }
      const data = normalizeChampriceCsv(await readBytes(response), input); cancelled();
      return { data: { ...data, providerLastModifiedRaw: response.headers.get('last-modified') }, evidence: action.resultCheck };
    } catch (error) {
      cancelled(); if (error instanceof ActionError) throw error;
      if (signal.aborted || error instanceof Error && error.name === 'TimeoutError') throw new ActionError('PROVIDER_TIMEOUT', '참가격 파일 조회 시간이 초과됐습니다.');
      throw new ActionError('PROVIDER_UNAVAILABLE', '참가격 파일 연결·응답을 확인하지 못했습니다.');
    }
  };
}
