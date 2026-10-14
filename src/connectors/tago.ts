import { z } from 'zod';
import { zodToJsonSchema } from 'zod-to-json-schema';
import { ActionError, type Action, type Executor } from '../types.js';

const arrivalSource = 'https://www.data.go.kr/data/15098530/openapi.do';
const stopSource = 'https://www.data.go.kr/data/15098534/openapi.do';
const arrivalBase = 'https://apis.data.go.kr/1613000/ArvlInfoInqireService/';
const stopBase = 'https://apis.data.go.kr/1613000/BusSttnInfoInqireService/';
const cityCode = z.number().int().min(1).max(999999999).describe('TAGO 도시 목록에서 확인한 코드');
const id = z.string().min(1).max(30).regex(/^[A-Za-z0-9_-]+$/);
const page = z.number().int().min(1).max(1000).default(1);
const limit = z.number().int().min(1).max(100).default(10);
export const tagoCitiesSchema = z.object({}).strict();
export const tagoStopsSchema = z.object({
  cityCode,
  name: z.string().trim().min(1).max(30).optional().describe('검색할 정류소 이름'),
  number: z.string().regex(/^\d{1,10}$/).optional().describe('정류소에 표시된 고유번호; nodeId와 다름'),
  page, limit,
}).strict().refine(input => input.name !== undefined || input.number !== undefined, '정류소 이름 또는 번호를 입력하세요.');
export const tagoArrivalsSchema = z.object({ cityCode, nodeId: id.describe('정류소 검색 결과의 nodeId'), page, limit }).strict();

function action(actionId: string, title: string, description: string, schema: z.ZodTypeAny, sourceUrl: string, resultCheck: string): Action {
  return { id: actionId, serviceId: 'tago', connectorId: 'tago-public-data', title, description, schema,
    category: '지도·교통', effect: 'read', method: 'api', inputSchema: zodToJsonSchema(schema, { $refStrategy: 'none' }) as Record<string, unknown>,
    credentialType: 'tago-api', requiredSecrets: ['serviceKey'], scopes: [], sourceUrl, checkedAt: '2026-10-14', verification: 'documented',
    resultCheck, domains: ['apis.data.go.kr'], version: '0.1.0', maintainer: 'KoreAI', origin: 'bundled', implemented: true };
}
export const tagoCitiesAction = action('tago.cities', 'TAGO 지원 도시 목록',
  '버스도착정보 서비스가 제공하는 도시코드·도시명을 조회합니다. 반환 목록에서 도시를 선택한 뒤 정류소와 도착정보를 조회하세요.',
  tagoCitiesSchema, arrivalSource, '정상 resultCode와 도시코드·도시명 형식을 확인. 미지원 지역을 추정하거나 고정 도시 목록을 사용하지 않음.');
export const tagoStopsAction = action('tago.bus.stops', 'TAGO 버스 정류소 찾기',
  '도시코드와 정류소 이름 또는 표시 번호로 정류소를 찾습니다. 정류소 ID·이름·번호와 제공된 WGS84 위치를 반환합니다. 버스정류소정보의 별도 활용 신청이 필요합니다.',
  tagoStopsSchema, stopSource, '정상 resultCode·페이지 일치와 정류소 ID·좌표 형식 확인. 표시 번호와 조회용 nodeId를 구분.');
export const tagoArrivalsAction = action('tago.bus.arrivals', 'TAGO 버스 도착예정 조회',
  '도시코드·정류소 ID로 노선별 도착예정 초·표시용 올림 분·남은 정류소·차량 유형을 조회합니다. 조회 시각을 표시하며 공급자가 갱신 시각을 제공하지 않으면 확정하지 않습니다.',
  tagoArrivalsSchema, arrivalSource, '정상 resultCode·nodeId·페이지 일치, 도착예정 초·분 변환 확인. 빈 결과와 불명인 예정값을 구분하고 출처·조회 시각 표시.');
export const tagoActions = [tagoArrivalsAction, tagoCitiesAction, tagoStopsAction];

export function tagoExample(actionId: string): Record<string, unknown> | undefined {
  if (actionId === tagoCitiesAction.id) return {};
  if (actionId === tagoStopsAction.id) return { cityCode: 25, name: '송강전통시장' };
  if (actionId === tagoArrivalsAction.id) return { cityCode: 25, nodeId: 'DJB8001793' };
}
export function tagoRequestTemplate(actionId: string, raw: unknown) {
  let endpoint: string, query: Record<string, string | number> = { _type: 'json' };
  if (actionId === tagoCitiesAction.id) { tagoCitiesSchema.parse(raw); endpoint = `${arrivalBase}getCtyCodeList`; }
  else if (actionId === tagoStopsAction.id) {
    const input = tagoStopsSchema.parse(raw); endpoint = `${stopBase}getSttnNoList`;
    query = { ...query, cityCode: input.cityCode, ...(input.name ? { nodeNm: input.name } : {}), ...(input.number ? { nodeNo: input.number } : {}), pageNo: input.page, numOfRows: input.limit };
  } else if (actionId === tagoArrivalsAction.id) {
    const input = tagoArrivalsSchema.parse(raw); endpoint = `${arrivalBase}getSttnAcctoArvlPrearngeInfoList`;
    query = { ...query, cityCode: input.cityCode, nodeId: input.nodeId, pageNo: input.page, numOfRows: input.limit };
  } else throw new ActionError('NOT_IMPLEMENTED', 'TAGO 실행기에 등록되지 않은 행동입니다.');
  return { method: 'GET' as const, endpoint, query, authentication: { secretField: 'serviceKey' as const, queryParameter: 'serviceKey' }, responseFormat: 'json' as const };
}

const integer = z.union([z.number().int().nonnegative(), z.string().regex(/^\d+$/)]).transform(Number).refine(Number.isSafeInteger);
const count = z.union([z.number().int(), z.string().regex(/^-?\d+$/), z.literal(''), z.literal('-'), z.null()]).transform(value => value === '' || value === '-' || value === null || Number(value) < 0 ? null : Number(value)).refine(value => value === null || Number.isSafeInteger(value));
const label = z.string().min(1).max(200);
const cityItem = z.object({ citycode: integer.refine(n => n > 0 && n <= 999999999), cityname: label });
const coordinate = (bound: number) => z.union([z.number().finite(), z.string().regex(/^-?\d+(?:\.\d+)?$/), z.literal(''), z.null()]).transform(value => value === '' || value === null ? null : Number(value)).refine(value => value === null || Number.isFinite(value) && Math.abs(value) <= bound);
const stopItem = z.object({ nodeid: id, nodenm: label, nodeno: z.union([z.string().max(10), integer, z.null()]).optional(), gpslati: coordinate(90).optional(), gpslong: coordinate(180).optional() });
const arrivalItem = z.object({ nodeid: id, nodenm: label, routeid: id, routeno: z.union([label, integer]).transform(String), routetp: z.string().max(100).nullable().optional(), vehicletp: z.string().max(100).nullable().optional(), arrprevstationcnt: count, arrtime: count });
const invalid = () => new ActionError('INVALID_RESPONSE', 'TAGO 응답 형식 또는 요청한 정류소·페이지가 일치하지 않습니다.');
function providerCode(code: string) {
  if (['00', '03'].includes(code)) return;
  if (['20', '21', '30', '31'].includes(code)) throw new ActionError('AUTH_REQUIRED', 'TAGO 버스도착정보·버스정류소정보의 활용신청과 일반 인증키(Decoding)를 확인한 뒤 재개하세요.', 'awaiting_auth');
  if (['22', '23'].includes(code)) throw new ActionError('PROVIDER_RATE_LIMIT', 'TAGO 호출 한도를 초과했습니다. 한도 초기화 후 다시 요청하세요.');
  if (code === '10') throw new ActionError('PROVIDER_INVALID_INPUT', 'TAGO가 조회 조건을 거절했습니다. 지원 도시·정류소 ID와 입력을 확인하세요.');
  if (code === '29') throw new ActionError('PROVIDER_IP_BLOCKED', 'TAGO가 서버 IP의 접근을 거절했습니다. 공급자 접근 조건을 확인하세요.');
  throw new ActionError(`PROVIDER_${code}`, 'TAGO가 정상 결과를 반환하지 않았습니다. 제공 상태를 확인하세요.');
}
function readResponse(raw: string) {
  if (/^\s*(?:<\?xml[^>]*>\s*)?<OpenAPI_ServiceResponse[\s>]/.test(raw)) {
    const code = raw.match(/<returnReasonCode>\s*(\d{1,2})\s*<\/returnReasonCode>/)?.[1]?.padStart(2, '0');
    if (!code) throw invalid(); providerCode(code); if (code !== '03') throw invalid(); return { code, body: undefined };
  }
  let payload: unknown; try { payload = JSON.parse(raw); } catch { throw invalid(); }
  const envelope = z.object({ response: z.object({ header: z.object({ resultCode: z.union([z.string().regex(/^\d{1,2}$/), z.number().int().min(0).max(99)]) }), body: z.unknown().optional() }) }).safeParse(payload);
  if (!envelope.success) throw invalid();
  const code = String(envelope.data.response.header.resultCode).padStart(2, '0'); providerCode(code);
  if (code === '03') return { code, body: undefined };
  const body = z.object({ items: z.union([z.object({ item: z.unknown().optional() }), z.literal(''), z.null()]).optional(), pageNo: integer.optional(), numOfRows: integer.optional(), totalCount: integer.optional() }).safeParse(envelope.data.response.body);
  if (!body.success || body.data.items === undefined && body.data.totalCount !== 0) throw invalid();
  return { code, body: body.data };
}
function normalize(action: Action, input: Record<string, any>, raw: string) {
  const { code, body } = readResponse(raw);
  const item = body?.items && typeof body.items === 'object' ? body.items.item : undefined;
  const rows = Array.isArray(item) ? item : item === undefined || item === null || item === '' ? [] : [item];
  if (rows.length > 1000 || body?.totalCount !== undefined && body.totalCount < rows.length) throw invalid();
  const city = action.id === tagoCitiesAction.id;
  if (!city && body && (body.pageNo !== input.page || body.numOfRows !== input.limit || body.totalCount === undefined || rows.length > input.limit || !rows.length && body.totalCount > (input.page - 1) * input.limit)) throw invalid();
  if (city && !rows.length && (body?.totalCount ?? 0) > 0) throw invalid();
  let data: Record<string, unknown>;
  if (city) {
    const parsed = z.array(cityItem).safeParse(rows); if (!parsed.success) throw invalid();
    const cities = parsed.data.map(row => ({ cityCode: row.citycode, name: row.cityname }));
    if (new Set(cities.map(row => row.cityCode)).size !== cities.length) throw invalid();
    data = { cities };
  } else if (action.id === tagoStopsAction.id) {
    const parsed = z.array(stopItem).safeParse(rows); if (!parsed.success) throw invalid();
    data = { cityCode: input.cityCode, stops: parsed.data.map(row => ({ nodeId: row.nodeid, name: row.nodenm, number: row.nodeno === null || row.nodeno === undefined || row.nodeno === '' ? null : String(row.nodeno), latitude: row.gpslati ?? null, longitude: row.gpslong ?? null, coordinateSystem: 'WGS84' })) };
  } else {
    const parsed = z.array(arrivalItem).safeParse(rows); if (!parsed.success || parsed.data.some(row => row.nodeid !== input.nodeId)) throw invalid();
    data = { cityCode: input.cityCode, nodeId: input.nodeId, arrivals: parsed.data.map(row => ({ nodeId: row.nodeid, stopName: row.nodenm, routeId: row.routeid, routeNumber: row.routeno, routeType: row.routetp ?? null, vehicleType: row.vehicletp ?? null, remainingStops: row.arrprevstationcnt, arrivalSeconds: row.arrtime, arrivalMinutes: row.arrtime === null ? null : Math.ceil(row.arrtime / 60), minuteRounding: 'up', estimateStatus: row.arrtime === null ? 'unavailable' : 'available' })) };
  }
  return { status: rows.length ? 'available' : 'no_data', ...data,
    ...(!city ? { pagination: { page: input.page, limit: input.limit, totalCount: body?.totalCount ?? 0, hasMore: input.page * input.limit < (body?.totalCount ?? 0) } } : {}),
    ...(rows.length ? {} : { reason: code === '03' ? 'provider_no_data' : 'empty_result', message: city ? '지원 도시 목록이 없습니다. 서비스 상태를 확인하세요.' : action.id === tagoStopsAction.id ? '이 조건의 정류소가 없습니다. 도시·검색어·페이지를 확인하세요.' : '이 페이지에 도착예정 정보가 없습니다. 운행 종료나 미지원 지역으로 단정할 수 없습니다.' }),
    retrievedAt: new Date().toISOString(), providerUpdatedAt: null, timezone: 'Asia/Seoul',
    source: { name: '국토교통부 TAGO', url: action.sourceUrl, attribution: '국토교통부 TAGO 버스정보' } };
}
export function tagoExecutor(fetcher: typeof fetch = fetch): Executor {
  return async (action, context) => {
    const registered = tagoActions.find(item => item.id === action.id);
    if (!registered) throw new ActionError('NOT_IMPLEMENTED', 'TAGO 실행기에 등록되지 않은 행동입니다.');
    const input = registered.schema.parse(context.job.input) as Record<string, any>;
    const key = context.secrets.serviceKey?.trim();
    if (!key) throw new ActionError('AUTH_REQUIRED', 'TAGO 일반 인증키(Decoding)를 등록하세요.', 'awaiting_auth');
    if (context.signal.aborted) throw new ActionError('CANCELLED', '작업이 취소됐습니다.', 'cancelled');
    const template = tagoRequestTemplate(action.id, input), url = new URL(template.endpoint);
    for (const [name, value] of Object.entries(template.query)) url.searchParams.set(name, String(value));
    url.searchParams.set(template.authentication.queryParameter, key); context.dispatch();
    const signal = AbortSignal.any([context.signal, AbortSignal.timeout(30_000)]);
    try {
      const response = await fetcher(url, { method: 'GET', headers: { Accept: 'application/json' }, redirect: 'error', signal });
      if ([401, 403].includes(response.status)) throw new ActionError('AUTH_REQUIRED', 'TAGO 인증과 해당 버스정보 활용신청 권한을 확인하세요.', 'awaiting_auth');
      if (response.status === 429) throw new ActionError('PROVIDER_RATE_LIMIT', 'TAGO 호출 한도를 초과했습니다. 잠시 뒤 다시 요청하세요.');
      if (!response.ok) throw new ActionError(`PROVIDER_HTTP_${response.status}`, `TAGO HTTP ${response.status} 응답입니다.`);
      const raw = await response.text(); if (raw.length > 2_000_000) throw new ActionError('RESULT_TOO_LARGE', 'TAGO 응답이 너무 큽니다.');
      return { data: normalize(registered, input, raw), evidence: registered.resultCheck };
    } catch (error) {
      if (context.signal.aborted) throw new ActionError('CANCELLED', '작업이 취소됐습니다.', 'cancelled');
      if (error instanceof ActionError) throw error;
      if (signal.aborted || error instanceof Error && error.name === 'TimeoutError') throw new ActionError('PROVIDER_TIMEOUT', 'TAGO 응답 시간이 초과됐습니다. 다시 요청하세요.');
      throw new ActionError('PROVIDER_CONNECTION_ERROR', 'TAGO에 연결하지 못했습니다. 네트워크와 서비스 상태를 확인하세요.');
    }
  };
}
