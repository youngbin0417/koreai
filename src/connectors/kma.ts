import { z } from 'zod';
import { zodToJsonSchema } from 'zod-to-json-schema';
import { ActionError, type Action, type Executor } from '../types.js';

const sourceUrl = 'https://www.data.go.kr/data/15084084/openapi.do';
const endpoint = 'https://apis.data.go.kr/1360000/VilageFcstInfoService_2.0/getUltraSrtNcst';
const date = z.string().regex(/^\d{4}-\d{2}-\d{2}$/).refine(value => {
  const parsed = new Date(`${value}T00:00:00Z`);
  return Number.isFinite(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
}, '실제 달력 날짜 YYYY-MM-DD를 입력하세요.');
export const kmaSchema = z.object({
  date: date.describe('발표일 YYYY-MM-DD, Asia/Seoul'),
  time: z.string().regex(/^(?:[01]\d|2[0-3])00$/).describe('발표 정시 HH00, Asia/Seoul'),
  nx: z.number().int().min(1).max(149).describe('기상청 격자 X, 경도가 아님'),
  ny: z.number().int().min(1).max(253).describe('기상청 격자 Y, 위도가 아님'),
  page: z.number().int().min(1).max(1000).default(1),
  limit: z.number().int().min(1).max(100).default(10),
}).strict();
type KmaInput = z.infer<typeof kmaSchema>;

export const kmaAction: Action = {
  id: 'kma.observation', serviceId: 'kma', connectorId: 'kma-public-data',
  title: '기상청 초단기실황 조회', category: '날씨·환경', effect: 'read', method: 'api',
  description: '발표일·정시·기상청 격자로 관측값을 조회합니다. 한국 표준시 기준이며 기온·강수량·습도·바람의 단위와 결측 여부를 반환합니다. 주소는 격자로 변환한 뒤 입력하세요.',
  schema: kmaSchema, inputSchema: zodToJsonSchema(kmaSchema, { $refStrategy: 'none' }) as Record<string, unknown>,
  credentialType: 'kma-api', requiredSecrets: ['serviceKey'], scopes: [],
  sourceUrl, checkedAt: '2026-10-12', verification: 'documented',
  resultCheck: '정상 resultCode와 요청한 baseDate/baseTime·nx/ny 및 페이지 일치 확인. 자료 없음·결측값을 구분하고 단위·출처 표시.',
  domains: ['apis.data.go.kr'], version: '0.1.0', maintainer: 'KoreAI', origin: 'bundled', implemented: true,
};

// The September 2026 official guide lists hourly observations as available after :10.
// This is a convenient input example, not a guarantee that data has arrived.
export function kmaExample(now = new Date()): Record<string, unknown> {
  const kst = new Date(now.getTime() + 9 * 60 * 60_000 - 10 * 60_000).toISOString();
  return { date: kst.slice(0, 10), time: `${kst.slice(11, 13)}00`, nx: 60, ny: 127 };
}
export function kmaRequestTemplate(raw: unknown) {
  const input = kmaSchema.parse(raw);
  return {
    method: 'GET' as const, endpoint,
    query: { dataType: 'JSON', base_date: input.date.replaceAll('-', ''), base_time: input.time, nx: input.nx, ny: input.ny, pageNo: input.page, numOfRows: input.limit },
    authentication: { secretField: 'serviceKey' as const, queryParameter: 'ServiceKey' }, responseFormat: 'json' as const,
  };
}

const fields: Record<string, { label: string; unit: string }> = {
  T1H: { label: '기온', unit: '℃' }, RN1: { label: '1시간 강수량', unit: 'mm' },
  UUU: { label: '동서바람성분', unit: 'm/s' }, VVV: { label: '남북바람성분', unit: 'm/s' },
  REH: { label: '습도', unit: '%' }, PTY: { label: '강수형태', unit: 'code' },
  VEC: { label: '풍향', unit: 'deg' }, WSD: { label: '풍속', unit: 'm/s' },
};
const precipitation: Record<number, string> = { 0: '없음', 1: '비', 2: '비/눈', 3: '눈', 4: '소나기', 5: '빗방울', 6: '빗방울눈날림', 7: '눈날림' };
const integer = z.union([z.number(), z.string().regex(/^\d+$/)]).transform(Number).refine(n => Number.isSafeInteger(n) && n >= 0);
const itemSchema = z.object({
  baseDate: z.string().regex(/^\d{8}$/), baseTime: z.string().regex(/^\d{4}$/),
  nx: integer, ny: integer, category: z.string().regex(/^[A-Z0-9]{1,10}$/),
  obsrValue: z.union([z.string().max(64), z.number().finite(), z.null()]),
});
const bodySchema = z.object({
  pageNo: integer, numOfRows: integer, totalCount: integer,
  items: z.union([z.object({ item: z.union([z.array(itemSchema), itemSchema]).optional() }), z.literal(''), z.null()]).optional(),
});
const invalidResponse = () => new ActionError('INVALID_RESPONSE', '기상청 응답 형식 또는 요청한 시각·격자·페이지가 일치하지 않습니다.');

function providerCode(code: string): void {
  if (['00', '03'].includes(code)) return;
  if (['20', '21', '30', '31'].includes(code)) throw new ActionError('AUTH_REQUIRED', '기상청 단기예보 활용신청·승인과 일반 인증키(Decoding)를 확인한 뒤 재개하세요.', 'awaiting_auth');
  if (['22', '23'].includes(code)) throw new ActionError('PROVIDER_RATE_LIMIT', '기상청 API 호출 한도를 초과했습니다. 잠시 뒤 또는 한도 초기화 후 다시 요청하세요.');
  if (['10', '11'].includes(code)) throw new ActionError('PROVIDER_INVALID_INPUT', '기상청이 조회 조건을 거절했습니다. 날짜·정시·격자를 확인하세요.');
  throw new ActionError(`PROVIDER_${code}`, '기상청이 정상 결과를 반환하지 않았습니다. 제공 상태를 확인하세요.');
}
function readResponse(raw: string): { code: string; body?: z.infer<typeof bodySchema> } {
  // Public-data authentication failures can be XML even when JSON was requested.
  if (/^\s*(?:<\?xml[^>]*>\s*)?<OpenAPI_ServiceResponse[\s>]/.test(raw)) {
    const code = raw.match(/<returnReasonCode>\s*(\d{1,2})\s*<\/returnReasonCode>/)?.[1]?.padStart(2, '0');
    if (!code) throw invalidResponse();
    providerCode(code);
    if (code !== '03') throw invalidResponse();
    return { code };
  }
  let payload: unknown;
  try { payload = JSON.parse(raw); } catch { throw invalidResponse(); }
  const envelope = z.object({ response: z.object({ header: z.object({ resultCode: z.union([z.string().regex(/^\d{1,2}$/), z.number().int().min(0).max(99)]) }), body: z.unknown().optional() }) }).safeParse(payload);
  if (!envelope.success) throw invalidResponse();
  const code = String(envelope.data.response.header.resultCode).padStart(2, '0');
  providerCode(code);
  if (code === '03') return { code };
  const body = bodySchema.safeParse(envelope.data.response.body);
  if (!body.success) throw invalidResponse();
  return { code, body: body.data };
}

function normalize(input: KmaInput, raw: string) {
  const { code, body } = readResponse(raw);
  if (body && (body.pageNo !== input.page || body.numOfRows !== input.limit)) throw invalidResponse();
  const item = body?.items && typeof body.items === 'object' ? body.items.item : undefined;
  const items = Array.isArray(item) ? item : item ? [item] : [];
  const totalCount = body?.totalCount ?? 0;
  if (items.length > input.limit || totalCount < items.length) throw invalidResponse();
  const seen = new Set<string>();
  const observations = items.map(row => {
    if (row.baseDate !== input.date.replaceAll('-', '') || row.baseTime !== input.time || row.nx !== input.nx || row.ny !== input.ny || seen.has(row.category)) throw invalidResponse();
    seen.add(row.category);
    const rawValue = row.obsrValue === null ? null : String(row.obsrValue).trim();
    const number = rawValue === null || rawValue === '' ? null : Number(rawValue);
    if (number !== null && !Number.isFinite(number)) throw invalidResponse();
    // Official guide: values >= +900 or <= -900 mean missing observations.
    const missing = number === null || number >= 900 || number <= -900;
    const field = fields[row.category];
    const value = missing ? null : number;
    return {
      category: row.category, label: field?.label ?? row.category, unit: field?.unit ?? null,
      value, rawValue, status: missing ? 'missing' : field ? 'observed' : 'unknown_category',
      ...(row.category === 'PTY' && value !== null ? { description: precipitation[value] ?? '알 수 없는 강수형태 코드' } : {}),
    };
  });
  if (items.length === 0 && totalCount > (input.page - 1) * input.limit) throw invalidResponse();
  return {
    status: observations.length ? 'available' : 'no_data',
    ...(observations.length ? {} : { reason: code === '03' ? 'provider_no_data' : 'empty_page', message: code === '03' ? '요청한 시각·격자의 자료가 없습니다. 발표 전이거나 제공되지 않는 자료일 수 있습니다.' : '해당 페이지에 관측 항목이 없습니다.' }),
    observedAt: `${input.date}T${input.time.slice(0, 2)}:00:00+09:00`, timezone: 'Asia/Seoul',
    grid: { nx: input.nx, ny: input.ny }, observations,
    pagination: { page: input.page, limit: input.limit, totalCount, hasMore: input.page * input.limit < totalCount },
    retrievedAt: new Date().toISOString(), source: { name: '기상청', url: sourceUrl, attribution: '기상청 단기예보 조회서비스' },
  };
}

export function kmaExecutor(fetcher: typeof fetch = fetch): Executor {
  return async (action, context) => {
    if (action.id !== kmaAction.id) throw new ActionError('NOT_IMPLEMENTED', '기상청 조회 실행기에 등록되지 않은 행동입니다.');
    const input = kmaSchema.parse(context.job.input);
    const key = context.secrets.serviceKey?.trim();
    if (!key) throw new ActionError('AUTH_REQUIRED', '기상청 일반 인증키(Decoding)를 등록하세요.', 'awaiting_auth');
    if (context.signal.aborted) throw new ActionError('CANCELLED', '작업이 취소됐습니다.', 'cancelled');
    const template = kmaRequestTemplate(input);
    const url = new URL(template.endpoint);
    for (const [name, value] of Object.entries(template.query)) url.searchParams.set(name, String(value));
    url.searchParams.set(template.authentication.queryParameter, key);
    context.dispatch();
    const signal = AbortSignal.any([context.signal, AbortSignal.timeout(30_000)]);
    try {
      const response = await fetcher(url, { method: 'GET', headers: { Accept: 'application/json' }, redirect: 'error', signal });
      if (response.status === 401 || response.status === 403) throw new ActionError('AUTH_REQUIRED', '기상청 인증과 활용신청 권한을 확인하세요.', 'awaiting_auth');
      if (response.status === 429) throw new ActionError('PROVIDER_RATE_LIMIT', '기상청 API 호출 한도를 초과했습니다. 잠시 뒤 다시 요청하세요.');
      if (!response.ok) throw new ActionError(`PROVIDER_HTTP_${response.status}`, `기상청 HTTP ${response.status} 응답입니다.`);
      const raw = await response.text();
      if (raw.length > 2_000_000) throw new ActionError('RESULT_TOO_LARGE', '기상청 응답이 너무 큽니다.');
      return { data: normalize(input, raw), evidence: action.resultCheck };
    } catch (error) {
      if (context.signal.aborted) throw new ActionError('CANCELLED', '작업이 취소됐습니다.', 'cancelled');
      if (error instanceof ActionError) throw error;
      if (signal.aborted || error instanceof Error && error.name === 'TimeoutError') throw new ActionError('PROVIDER_TIMEOUT', '기상청 응답 시간이 초과됐습니다. 다시 요청하세요.');
      // Fetch errors may contain the full URL, including ServiceKey. Never copy them.
      throw new ActionError('PROVIDER_CONNECTION_ERROR', '기상청에 연결하지 못했습니다. 네트워크와 서비스 상태를 확인하세요.');
    }
  };
}
