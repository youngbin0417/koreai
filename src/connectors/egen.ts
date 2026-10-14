import { XMLParser, XMLValidator } from 'fast-xml-parser';
import { z } from 'zod';
import { zodToJsonSchema } from 'zod-to-json-schema';
import { ActionError, type Action, type Executor } from '../types.js';

const sourceUrl = 'https://www.data.go.kr/data/15000736/openapi.do';
const endpoint = 'https://apis.data.go.kr/B552657/HsptlAsembySearchService/getHsptlMdcncListInfoInqire';
const nonempty = (description: string, max: number) => z.string().trim().min(1).max(max).describe(description);
export const egenSchema = z.object({
  region: nonempty('시도명, 예: 서울특별시', 16),
  district: nonempty('시군구명, 예: 강남구', 60).optional(),
  name: nonempty('검색할 병·의원 이름', 100).optional(),
  day: z.number().int().min(1).max(8).optional().describe('진료요일: 월~일 1~7, 공휴일 8; 현재 진료 가능 판정이 아님'),
  page: z.number().int().min(1).max(1000).default(1),
  limit: z.number().int().min(1).max(100).default(10),
}).strict();
type EgenInput = z.infer<typeof egenSchema>;
export const egenAction: Action = {
  id: 'egen.hospitals.search', serviceId: 'egen', connectorId: 'egen-public-data', title: 'E-Gen 병·의원 찾기',
  category: '의료·예약', effect: 'read', method: 'api',
  description: '시도·시군구·기관명·진료요일로 병·의원 정보를 검색합니다. 기관 ID·주소·전화와 제공된 요일별 진료시간·좌표를 반환합니다. 현재 진료 가능 여부와 실시간 병상 상태는 확인하지 않습니다. 방문 전 기관에 확인하세요.',
  schema: egenSchema, inputSchema: zodToJsonSchema(egenSchema, { $refStrategy: 'none' }) as Record<string, unknown>,
  credentialType: 'egen-api', requiredSecrets: ['serviceKey'], scopes: [], sourceUrl, checkedAt: '2026-10-14', verification: 'documented',
  resultCheck: 'XML 정상 resultCode·페이지 일치와 기관 ID·시간·좌표 형식을 확인. 누락된 시간·갱신 시각·현재 진료 가능 여부를 확정하지 않고 출처 표시.',
  domains: ['apis.data.go.kr'], version: '0.1.0', maintainer: 'KoreAI', origin: 'bundled', implemented: true,
};
export function egenRequestTemplate(raw: unknown) {
  const input = egenSchema.parse(raw);
  return { method: 'GET' as const, endpoint,
    query: { Q0: input.region, ...(input.district ? { Q1: input.district } : {}), ...(input.name ? { QN: input.name } : {}), ...(input.day ? { QT: input.day } : {}), pageNo: input.page, numOfRows: input.limit },
    authentication: { secretField: 'serviceKey' as const, queryParameter: 'serviceKey' }, responseFormat: 'xml' as const };
}

const integer = z.string().trim().regex(/^\d+$/).transform(Number).refine(Number.isSafeInteger);
const text = z.string().max(2000).nullable().optional();
const coordinate = (bound: number) => z.union([z.string().trim().regex(/^-?\d+(?:\.\d+)?$/), z.literal(''), z.null()]).transform(value => value === '' || value === null ? null : Number(value)).refine(value => value === null || Number.isFinite(value) && Math.abs(value) <= bound);
const dutyDays = [1, 2, 3, 4, 5, 6, 7, 8] as const;
const optionalTime = z.string().max(20).nullable().optional();
const timeFields = Object.fromEntries(dutyDays.flatMap(day => ['s', 'c'].map(part => [`dutyTime${day}${part}`, optionalTime]))) as Record<`dutyTime${typeof dutyDays[number]}${'s' | 'c'}`, typeof optionalTime>;
const itemSchema = z.object({
  hpid: z.string().trim().min(1).max(32).regex(/^[A-Za-z0-9_-]+$/), dutyName: z.string().trim().min(1).max(200),
  dutyAddr: text, dutyTel1: text, dutyDiv: text, dutyDivNam: text,
  wgs84Lat: coordinate(90).optional(), wgs84Lon: coordinate(180).optional(),
  ...timeFields,
});
const bodySchema = z.object({ pageNo: integer, numOfRows: integer, totalCount: integer,
  items: z.union([z.object({ item: z.unknown().optional() }), z.literal(''), z.null()]).optional(),
});
const parser = new XMLParser({ parseTagValue: false, trimValues: false, ignoreAttributes: false, ignoreDeclaration: true,
  processEntities: { enabled: true, maxTotalExpansions: 10_000, maxExpandedLength: 100_000 }, htmlEntities: false });
const invalid = () => new ActionError('INVALID_RESPONSE', 'E-Gen XML 응답 형식 또는 요청한 페이지가 일치하지 않습니다.');
function providerCode(code: string) {
  if (['00', '03'].includes(code)) return;
  if (['20', '21', '30', '31'].includes(code)) throw new ActionError('AUTH_REQUIRED', '전국 병·의원 찾기 서비스 활용신청·승인과 일반 인증키(Decoding)를 확인한 뒤 재개하세요.', 'awaiting_auth');
  if (['22', '23'].includes(code)) throw new ActionError('PROVIDER_RATE_LIMIT', 'E-Gen 호출 한도를 초과했습니다. 한도 초기화 후 다시 요청하세요.');
  if (code === '10') throw new ActionError('PROVIDER_INVALID_INPUT', 'E-Gen이 조회 조건을 거절했습니다. 지역·기관명·진료요일을 확인하세요.');
  if (code === '29') throw new ActionError('PROVIDER_IP_BLOCKED', 'E-Gen이 서버 IP의 접근을 거절했습니다. 공급자 접근 조건을 확인하세요.');
  throw new ActionError(`PROVIDER_${code}`, 'E-Gen이 정상 결과를 반환하지 않았습니다. 제공 상태를 확인하세요.');
}
function readResponse(raw: string) {
  // This XML data contract needs no DTD or external/custom entities.
  if (/<!\s*(?:DOCTYPE|ENTITY)\b/i.test(raw) || XMLValidator.validate(raw) !== true) throw invalid();
  let payload: unknown; try { payload = parser.parse(raw); } catch { throw invalid(); }
  const gateway = z.object({ OpenAPI_ServiceResponse: z.object({ cmmMsgHeader: z.object({ returnReasonCode: z.string().trim().regex(/^\d{1,2}$/) }) }) }).safeParse(payload);
  if (gateway.success) {
    const code = gateway.data.OpenAPI_ServiceResponse.cmmMsgHeader.returnReasonCode.padStart(2, '0'); providerCode(code);
    if (code !== '03') throw invalid(); return { code, body: undefined };
  }
  const envelope = z.object({ response: z.object({ header: z.object({ resultCode: z.string().trim().regex(/^\d{1,2}$/) }), body: z.unknown().optional() }) }).safeParse(payload);
  if (!envelope.success) throw invalid();
  const code = envelope.data.response.header.resultCode.padStart(2, '0'); providerCode(code);
  if (code === '03') return { code, body: undefined };
  const body = bodySchema.safeParse(envelope.data.response.body); if (!body.success) throw invalid();
  return { code, body: body.data };
}
function formatTime(raw: string | null | undefined) {
  if (raw === undefined || raw === null || raw.trim() === '' || raw.trim() === '-') return { value: null, raw: raw ?? null, status: 'unavailable' };
  const value = raw.trim().padStart(4, '0');
  if (!/^\d{3,4}$/.test(raw.trim()) || !(Number(value.slice(0, 2)) <= 23 && Number(value.slice(2)) <= 59 || value === '2400')) return { value: null, raw, status: 'invalid' };
  return { value: `${value.slice(0, 2)}:${value.slice(2)}`, raw, status: 'provided' };
}
const days = ['월요일', '화요일', '수요일', '목요일', '금요일', '토요일', '일요일', '공휴일'];
function normalize(input: EgenInput, raw: string) {
  const { code, body } = readResponse(raw);
  if (body && (body.pageNo !== input.page || body.numOfRows !== input.limit)) throw invalid();
  const item = body?.items && typeof body.items === 'object' ? body.items.item : undefined;
  const rows = Array.isArray(item) ? item : item === undefined || item === null || item === '' ? [] : [item];
  const totalCount = body?.totalCount ?? 0;
  if (rows.length > input.limit || totalCount < rows.length || !rows.length && totalCount > (input.page - 1) * input.limit) throw invalid();
  const parsed = z.array(itemSchema).safeParse(rows); if (!parsed.success) throw invalid();
  if (new Set(parsed.data.map(row => row.hpid)).size !== rows.length) throw invalid();
  const hospitals = parsed.data.map(row => ({
    id: row.hpid, name: row.dutyName, address: row.dutyAddr || null, phone: row.dutyTel1 || null,
    institutionType: { code: row.dutyDiv || null, name: row.dutyDivNam || null },
    latitude: row.wgs84Lat ?? null, longitude: row.wgs84Lon ?? null, coordinateSystem: 'WGS84',
    hours: dutyDays.map(day => ({ day, label: days[day - 1], start: formatTime(row[`dutyTime${day}s`]), end: formatTime(row[`dutyTime${day}c`]) })),
    currentCareAvailability: 'not_verified',
  }));
  return { status: hospitals.length ? 'available' : 'no_data', query: input, hospitals,
    ...(hospitals.length ? {} : { reason: code === '03' ? 'provider_no_data' : 'empty_page', message: '이 조건·페이지의 병·의원 정보가 없습니다. 지역·기관명·진료요일·페이지를 확인하세요.' }),
    pagination: { page: input.page, limit: input.limit, totalCount, hasMore: input.page * input.limit < totalCount },
    retrievedAt: new Date().toISOString(), providerUpdatedAt: null, timezone: 'Asia/Seoul',
    availabilityNote: '제공된 진료시간은 기관 일정 정보입니다. 현재 진료 가능 여부는 확인되지 않았으므로 방문 전 기관에 전화로 확인하세요.',
    source: { name: '국립중앙의료원 E-Gen', url: sourceUrl, attribution: '국립중앙의료원 전국 병·의원 찾기 서비스' } };
}
export function egenExecutor(fetcher: typeof fetch = fetch): Executor {
  return async (action, context) => {
    if (action.id !== egenAction.id) throw new ActionError('NOT_IMPLEMENTED', 'E-Gen 실행기에 등록되지 않은 행동입니다.');
    const input = egenSchema.parse(context.job.input), key = context.secrets.serviceKey?.trim();
    if (!key) throw new ActionError('AUTH_REQUIRED', 'E-Gen 일반 인증키(Decoding)를 등록하세요.', 'awaiting_auth');
    if (context.signal.aborted) throw new ActionError('CANCELLED', '작업이 취소됐습니다.', 'cancelled');
    const template = egenRequestTemplate(input), url = new URL(template.endpoint);
    for (const [name, value] of Object.entries(template.query)) url.searchParams.set(name, String(value));
    url.searchParams.set(template.authentication.queryParameter, key); context.dispatch();
    const signal = AbortSignal.any([context.signal, AbortSignal.timeout(30_000)]);
    try {
      const response = await fetcher(url, { method: 'GET', headers: { Accept: 'application/xml, text/xml' }, redirect: 'error', signal });
      if ([401, 403].includes(response.status)) throw new ActionError('AUTH_REQUIRED', 'E-Gen 인증과 병·의원 찾기 서비스 활용신청 권한을 확인하세요.', 'awaiting_auth');
      if (response.status === 429) throw new ActionError('PROVIDER_RATE_LIMIT', 'E-Gen 호출 한도를 초과했습니다. 잠시 뒤 다시 요청하세요.');
      if (!response.ok) throw new ActionError(`PROVIDER_HTTP_${response.status}`, `E-Gen HTTP ${response.status} 응답입니다.`);
      const raw = await response.text(); if (raw.length > 2_000_000) throw new ActionError('RESULT_TOO_LARGE', 'E-Gen 응답이 너무 큽니다.');
      return { data: normalize(input, raw), evidence: action.resultCheck };
    } catch (error) {
      if (context.signal.aborted) throw new ActionError('CANCELLED', '작업이 취소됐습니다.', 'cancelled');
      if (error instanceof ActionError) throw error;
      if (signal.aborted || error instanceof Error && error.name === 'TimeoutError') throw new ActionError('PROVIDER_TIMEOUT', 'E-Gen 응답 시간이 초과됐습니다. 다시 요청하세요.');
      throw new ActionError('PROVIDER_CONNECTION_ERROR', 'E-Gen에 연결하지 못했습니다. 네트워크와 서비스 상태를 확인하세요.');
    }
  };
}
