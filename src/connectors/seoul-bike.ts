import { z } from 'zod';
import { zodToJsonSchema } from 'zod-to-json-schema';
import { XMLParser, XMLValidator } from 'fast-xml-parser';
import { ActionError, type Action, type Executor } from '../types.js';

const sourceUrl = 'https://data.seoul.go.kr/dataList/OA-15493/A/1/datasetView.do';
export const seoulBikeSchema = z.object({
  start: z.number().int().min(1).max(1_000_000).default(1),
  end: z.number().int().min(1).max(1_000_000).default(100),
  stationId: z.string().regex(/^ST-\d{1,12}$/).optional(),
  query: z.string().trim().min(1).max(80).optional(),
}).strict().refine(input => input.end >= input.start && input.end - input.start < 1000, '시작~종료 위치는 오름차순으로 최대 1,000건이어야 합니다.');
export const seoulBikeAction: Action = {
  id: 'seoul-bike.stations', serviceId: 'seoul-bike', connectorId: 'seoul-bike-public-data', title: '서울 따릉이 대여소 잔여 자전거 조회',
  description: '서울시 실시간 대여정보를 요청 구간별로 조회합니다. 이름·대여소 ID 필터는 해당 구간에만 적용됩니다. 서버 운영자의 HTTP 전송 허용 설정과 서울 데이터 키가 필요합니다.',
  category: '지도·교통', effect: 'read', method: 'api', schema: seoulBikeSchema,
  inputSchema: zodToJsonSchema(seoulBikeSchema, { $refStrategy: 'none' }) as Record<string, unknown>,
  credentialType: 'seoul-bike-api', requiredSecrets: ['apiKey'], scopes: [], sourceUrl, checkedAt: '2026-10-17', verification: 'documented',
  resultCheck: '요청 구간·최대 1,000건·대여소 ID 중복·숫자/좌표를 검증하고 조회 시각과 미제공 관측 시각을 구분합니다. 자전거 수는 거치대 수를 초과할 수 있습니다.',
  domains: ['openapi.seoul.go.kr'], version: '0.1.0', maintainer: 'KoreAI', origin: 'bundled', implemented: true,
};
export const seoulBikeExample = () => ({ start: 1, end: 100 });
export function seoulBikeRequestTemplate(raw: unknown) {
  const input = seoulBikeSchema.parse(raw);
  return { method: 'GET' as const, endpoint: `http://openapi.seoul.go.kr:8088/{apiKey}/json/bikeList/${input.start}/${input.end}/`,
    query: {}, authentication: { secretField: 'apiKey' as const, pathParameter: 'apiKey' }, responseFormat: 'json' as const,
    transport: { encrypted: false, operatorOptIn: 'KOREAI_ALLOW_SEOUL_BIKE_HTTP=1' },
    localFilter: { stationId: input.stationId ?? null, query: input.query ?? null, scope: 'requested_range' } };
}
const invalid = () => new ActionError('INVALID_RESPONSE', '서울 따릉이 응답 형식·대여소 ID·숫자 또는 요청 구간이 유효하지 않습니다.');
const integer = z.union([z.number().int().nonnegative().safe(), z.string().regex(/^\d{1,16}$/).transform(Number).refine(Number.isSafeInteger)]);
const decimal = z.string().regex(/^-?\d{1,12}(?:\.\d{1,12})?$/).transform(Number);
const rowSchema = z.object({
  stationId: z.string().regex(/^ST-\d{1,12}$/), stationName: z.string().trim().min(1).max(300),
  rackTotCnt: integer, parkingBikeTotCnt: integer, shared: decimal.refine(n => n >= 0),
  stationLatitude: decimal.refine(n => n >= -90 && n <= 90), stationLongitude: decimal.refine(n => n >= -180 && n <= 180),
});
const resultSchema = z.object({ CODE: z.string().regex(/^(?:INFO|ERROR)-\d{3}$/) });
const errorXml = new XMLParser({ parseTagValue: false, ignoreAttributes: false, ignoreDeclaration: true, trimValues: true, processEntities: false });
function normalize(raw: string, input: z.infer<typeof seoulBikeSchema>) {
  let payload: unknown;
  try {
    // Seoul returns XML authentication faults even when the requested format is JSON.
    if (raw.trimStart().startsWith('<')) {
      if (/<!DOCTYPE|<!ENTITY/i.test(raw) || XMLValidator.validate(raw) !== true) throw invalid();
      const fault = z.object({ RESULT: resultSchema }).strict().safeParse(errorXml.parse(raw));
      if (!fault.success || fault.data.RESULT.CODE === 'INFO-000') throw invalid();
      payload = fault.data;
    } else payload = JSON.parse(raw);
  } catch { throw invalid(); }
  const envelope = z.object({ RESULT: z.unknown().optional(), rentBikeStatus: z.object({ RESULT: z.unknown(), row: z.unknown().optional(), list_total_count: z.unknown().optional() }).optional() }).safeParse(payload);
  if (!envelope.success) throw invalid();
  const root = envelope.data, body = root.rentBikeStatus, result = resultSchema.safeParse(body?.RESULT ?? root.RESULT);
  if (!result.success || root.RESULT && body) throw invalid();
  const code = result.data.CODE;
  if (code === 'INFO-100') throw new ActionError('AUTH_REQUIRED', '서울 열린데이터광장의 일반 인증키를 확인한 뒤 재개하세요.', 'awaiting_auth');
  if (code !== 'INFO-000' && code !== 'INFO-200') throw new ActionError(`PROVIDER_${code}`, '서울 데이터 API가 요청을 거절했습니다. 키 상태·요청 조건·호출 한도를 확인하세요.');
  let rows: z.infer<typeof rowSchema>[] = [], reportedCount: number | null = null;
  if (code === 'INFO-000') {
    const parsed = z.object({ list_total_count: integer, row: z.array(rowSchema).max(1000) }).safeParse(body);
    if (!parsed.success) throw invalid();
    rows = parsed.data.row; reportedCount = parsed.data.list_total_count;
    if (rows.length > input.end - input.start + 1 || new Set(rows.map(row => row.stationId)).size !== rows.length) throw invalid();
  } else if (body?.row !== undefined && (!Array.isArray(body.row) || body.row.length)) throw invalid();
  const stations = rows.filter(row => (!input.stationId || row.stationId === input.stationId) && (!input.query || row.stationName.toLocaleLowerCase('ko-KR').includes(input.query.toLocaleLowerCase('ko-KR'))));
  return { status: stations.length ? 'available' : 'no_data', returnedCount: stations.length, providerReturnedCount: rows.length, providerReportedCount: reportedCount,
    pagination: { start: input.start, end: input.end, requestedCount: input.end - input.start + 1, totalStations: null, hasMore: null,
      suggestedNextRange: rows.length === input.end - input.start + 1 && input.end < 1_000_000 ? { start: input.end + 1, end: Math.min(input.end + input.end - input.start + 1, 1_000_000) } : null },
    filter: { stationId: input.stationId ?? null, query: input.query ?? null, scope: 'requested_range' },
    stations: stations.map(row => ({ stationId: row.stationId, name: row.stationName, rackCount: row.rackTotCnt, availableBikes: row.parkingBikeTotCnt,
      parkingRatioPercent: row.shared, latitude: row.stationLatitude, longitude: row.stationLongitude })),
    ...(!stations.length ? { reason: rows.length ? 'no_match_in_range' : 'empty_provider_range', message: '요청 구간에 해당 결과가 없습니다. 서울 전체의 검색 결과나 대여 가능 여부를 의미하지 않습니다.' } : {}),
    retrievedAt: new Date().toISOString(), providerUpdatedAt: null, timezone: 'Asia/Seoul',
    dataNote: '관측 시각은 API에서 제공하지 않습니다. 조회 구간의 결과이며 실시간 대여 가능을 보장하지 않습니다. 거치대보다 자전거가 많을 수 있고 반납 가능 수를 계산하지 않습니다. HTTP 응답의 출처 무결성은 보장되지 않습니다.',
    source: { name: '서울특별시 · 서울 열린데이터광장', url: sourceUrl, attribution: '서울특별시 공공자전거 따릉이 실시간 대여정보 · 공공누리 제1유형' } };
}
async function readBody(response: Response) {
  const reader = response.body?.getReader(); if (!reader) throw invalid();
  const decoder = new TextDecoder(); let size = 0, raw = '';
  try {
    for (;;) {
      const part = await reader.read(); if (part.done) break;
      size += part.value.byteLength;
      if (size > 2_000_000) { await reader.cancel(); throw new ActionError('RESULT_TOO_LARGE', '서울 따릉이 응답이 너무 큽니다. 조회 구간을 줄이세요.'); }
      raw += decoder.decode(part.value, { stream: true });
    }
    return raw + decoder.decode();
  } finally { reader.releaseLock(); }
}
export function seoulBikeExecutor(fetcher: typeof fetch = fetch, allowHttp = false): Executor {
  return async (action, context) => {
    if (action.id !== seoulBikeAction.id) throw new ActionError('NOT_IMPLEMENTED', '서울 따릉이 실행기에 등록되지 않은 행동입니다.');
    const input = seoulBikeSchema.parse(context.job.input);
    if (context.signal.aborted) throw new ActionError('CANCELLED', '작업이 취소됐습니다.', 'cancelled');
    if (!allowHttp) throw new ActionError('TRANSPORT_DISABLED', '서울 데이터 API는 HTTP로 키를 전송합니다. 서버 운영자가 전송 조건을 확인하고 KOREAI_ALLOW_SEOUL_BIKE_HTTP=1로 재시작해야 합니다.');
    const key = context.secrets.apiKey?.trim();
    if (!key || key === 'sample') throw new ActionError('AUTH_REQUIRED', '서울 열린데이터광장에서 발급한 본인 일반 인증키를 등록하세요. sample 키는 실사용에 사용할 수 없습니다.', 'awaiting_auth');
    if (key.length > 256 || /[\s\x00-\x1f\x7f]/.test(key) || ['.', '..'].includes(key)) throw new ActionError('AUTH_REQUIRED', '서울 데이터 인증키 형식을 확인하세요.', 'awaiting_auth');
    const url = new URL(`http://openapi.seoul.go.kr:8088/${encodeURIComponent(key)}/json/bikeList/${input.start}/${input.end}/`);
    const signal = AbortSignal.any([context.signal, AbortSignal.timeout(30_000)]);
    context.dispatch();
    try {
      const response = await fetcher(url, { method: 'GET', headers: { Accept: 'application/json' }, redirect: 'error', signal });
      if ([401, 403].includes(response.status)) throw new ActionError('AUTH_REQUIRED', '서울 데이터 키와 접근 권한을 확인하세요.', 'awaiting_auth');
      if (response.status === 429) throw new ActionError('PROVIDER_RATE_LIMIT', '서울 데이터 호출 한도를 초과했습니다. 한도 초기화 후 다시 요청하세요.');
      if (!response.ok) throw new ActionError(`PROVIDER_HTTP_${response.status}`, `서울 데이터 HTTP ${response.status} 응답입니다.`);
      const data = normalize(await readBody(response), input);
      if (context.signal.aborted) throw new ActionError('CANCELLED', '작업이 취소됐습니다.', 'cancelled');
      return { data, evidence: seoulBikeAction.resultCheck };
    } catch (error) {
      if (context.signal.aborted) throw new ActionError('CANCELLED', '작업이 취소됐습니다.', 'cancelled');
      if (error instanceof ActionError) throw error;
      if (signal.aborted || error instanceof Error && error.name === 'TimeoutError') throw new ActionError('PROVIDER_TIMEOUT', '서울 따릉이 응답 시간이 초과됐습니다. 다시 요청하세요.');
      throw new ActionError('PROVIDER_CONNECTION_ERROR', '서울 데이터 API에 연결하지 못했습니다. 네트워크와 서비스 상태를 확인하세요.');
    }
  };
}
