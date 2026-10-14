import { z } from 'zod';
import { zodToJsonSchema } from 'zod-to-json-schema';
import { ActionError, type Action, type Executor } from '../types.js';

const sourceUrl = 'https://www.data.go.kr/data/15073861/openapi.do';
const endpoint = 'https://apis.data.go.kr/B552584/ArpltnInforInqireSvc/getMinuDustFrcstDspth';
const date = z.string().regex(/^\d{4}-\d{2}-\d{2}$/).refine(value => {
  const parsed = new Date(`${value}T00:00:00Z`);
  return Number.isFinite(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
}, '실제 달력 날짜 YYYY-MM-DD를 입력하세요.');
const pollutant = z.enum(['PM10', 'PM25', 'O3']);
export const airkoreaSchema = z.object({
  date: date.describe('예보가 발표된 날짜 YYYY-MM-DD, Asia/Seoul. 예보 대상 날짜와 다를 수 있음'),
  pollutant: pollutant.default('PM25').describe('PM10 미세먼지, PM25 초미세먼지, O3 오존'),
}).strict();
type AirInput = z.infer<typeof airkoreaSchema>;

export const airkoreaAction: Action = {
  id: 'airkorea.forecast', serviceId: 'airkorea', connectorId: 'airkorea-public-data',
  title: '에어코리아 대기질 예보 조회', category: '날씨·환경', effect: 'read', method: 'api',
  description: '발표 날짜와 PM10·PM25·O3 항목으로 대기질 예보 통보를 조회합니다. 발표 시각·예보 대상 날짜·지역별 등급과 공급자 원문·출처를 반환합니다. 현재 측정값이 아니며 날짜 조회에는 페이지 설정을 사용하지 않습니다.',
  schema: airkoreaSchema, inputSchema: zodToJsonSchema(airkoreaSchema, { $refStrategy: 'none' }) as Record<string, unknown>,
  credentialType: 'airkorea-api', requiredSecrets: ['serviceKey'], scopes: [],
  sourceUrl, checkedAt: '2026-10-14', verification: 'documented',
  resultCheck: '정상 resultCode와 요청한 발표 날짜·informCode를 확인. 예보 대상 날짜는 별도로 보존하고 등급·설명 원문·출처·변경금지 조건을 전달.',
  domains: ['apis.data.go.kr'], version: '0.1.0', maintainer: 'KoreAI', origin: 'bundled', implemented: true,
};

export function airkoreaExample(now = new Date()): Record<string, unknown> {
  return { date: new Date(now.getTime() + 9 * 60 * 60_000).toISOString().slice(0, 10), pollutant: 'PM25' };
}
export function airkoreaRequestTemplate(raw: unknown) {
  const input = airkoreaSchema.parse(raw);
  // The provider ignores pagination when searchDate is supplied.
  return { method: 'GET' as const, endpoint,
    query: { returnType: 'json', searchDate: input.date, InformCode: input.pollutant },
    authentication: { secretField: 'serviceKey' as const, queryParameter: 'serviceKey' }, responseFormat: 'json' as const };
}

const text = z.string().max(20_000).nullable().optional();
const itemSchema = z.object({
  dataTime: z.string().min(10).max(128), informCode: pollutant, informData: date,
  informOverall: text, infornOverall: text, informCause: text, informGrade: text, actionKnack: text,
  imageUrl1: text, imageUrl2: text, imageUrl3: text, imageUrl4: text, imageUrl5: text,
  imageUrl6: text, imageUrl7: text, imageUrl8: text, imageUrl9: text,
});
const integer = z.union([z.number().int().nonnegative(), z.string().regex(/^\d+$/)]).transform(Number).refine(Number.isSafeInteger);
const bodySchema = z.object({
  items: z.union([z.array(itemSchema).max(1000), itemSchema, z.null(), z.literal('')]).optional(),
  totalCount: integer.optional(),
});
const invalidResponse = () => new ActionError('INVALID_RESPONSE', '에어코리아 응답 형식 또는 요청한 발표 날짜·예보 항목이 일치하지 않습니다.');

function providerCode(code: string) {
  if (['00', '03'].includes(code)) return;
  if (['20', '21', '30', '31'].includes(code)) throw new ActionError('AUTH_REQUIRED', '에어코리아 대기오염정보 활용신청·승인과 일반 인증키(Decoding)를 확인한 뒤 재개하세요.', 'awaiting_auth');
  if (['22', '23'].includes(code)) throw new ActionError('PROVIDER_RATE_LIMIT', '에어코리아 API 호출 한도를 초과했습니다. 한도 초기화 후 다시 요청하세요.');
  if (code === '10') throw new ActionError('PROVIDER_INVALID_INPUT', '에어코리아가 조회 조건을 거절했습니다. 발표 날짜·예보 항목을 확인하세요.');
  if (code === '29') throw new ActionError('PROVIDER_IP_BLOCKED', '에어코리아가 서버 IP의 접근을 거절했습니다. 공급자 접근 조건을 확인하세요.');
  throw new ActionError(`PROVIDER_${code}`, '에어코리아가 정상 결과를 반환하지 않았습니다. 제공 상태를 확인하세요.');
}
function readResponse(raw: string) {
  // The gateway can return XML authentication errors despite returnType=json.
  if (/^\s*(?:<\?xml[^>]*>\s*)?<OpenAPI_ServiceResponse[\s>]/.test(raw)) {
    const code = raw.match(/<returnReasonCode>\s*(\d{1,2})\s*<\/returnReasonCode>/)?.[1]?.padStart(2, '0');
    if (!code) throw invalidResponse();
    providerCode(code);
    if (code !== '03') throw invalidResponse();
    return { code, body: undefined };
  }
  let payload: unknown;
  try { payload = JSON.parse(raw); } catch { throw invalidResponse(); }
  const envelope = z.object({ response: z.object({
    header: z.object({ resultCode: z.union([z.string().regex(/^\d{1,2}$/), z.number().int().min(0).max(99)]) }),
    body: z.unknown().optional(),
  }) }).safeParse(payload);
  if (!envelope.success) throw invalidResponse();
  const code = String(envelope.data.response.header.resultCode).padStart(2, '0');
  providerCode(code);
  if (code === '03') return { code, body: undefined };
  const body = bodySchema.safeParse(envelope.data.response.body);
  if (!body.success) throw invalidResponse();
  if (body.data.items === undefined && body.data.totalCount !== 0) throw invalidResponse();
  return { code, body: body.data };
}
function normalize(input: AirInput, raw: string) {
  const { code, body } = readResponse(raw);
  const forecasts = Array.isArray(body?.items) ? body.items : body?.items && typeof body.items === 'object' ? [body.items] : [];
  if (body?.totalCount !== undefined && body.totalCount < forecasts.length) throw invalidResponse();
  if (!forecasts.length && (body?.totalCount ?? 0) > 0) throw invalidResponse();
  for (const row of forecasts) {
    // dataTime is the announcement; informData can describe tomorrow or later.
    if (row.dataTime.slice(0, 10) !== input.date || !/^(?:\s|T)/.test(row.dataTime.slice(10)) || row.informCode !== input.pollutant) throw invalidResponse();
  }
  return {
    status: forecasts.length ? 'available' : 'no_data', dataKind: 'forecast', announcementDate: input.date,
    pollutant: input.pollutant, timezone: 'Asia/Seoul', forecasts,
    ...(forecasts.length ? {} : { reason: code === '03' ? 'provider_no_data' : 'empty_result', message: '요청한 발표 날짜·항목의 예보 통보가 없습니다. 발표 전이거나 제공되지 않는 자료일 수 있습니다.' }),
    retrievedAt: new Date().toISOString(),
    source: { name: '한국환경공단 에어코리아', url: sourceUrl, attribution: '한국환경공단 에어코리아 대기오염정보', license: '공공누리 제3유형: 출처표시·변경금지', originalTextPreserved: true },
  };
}

export function airkoreaExecutor(fetcher: typeof fetch = fetch): Executor {
  return async (action, context) => {
    if (action.id !== airkoreaAction.id) throw new ActionError('NOT_IMPLEMENTED', '에어코리아 실행기에 등록되지 않은 행동입니다.');
    const input = airkoreaSchema.parse(context.job.input);
    const key = context.secrets.serviceKey?.trim();
    if (!key) throw new ActionError('AUTH_REQUIRED', '에어코리아 일반 인증키(Decoding)를 등록하세요.', 'awaiting_auth');
    if (context.signal.aborted) throw new ActionError('CANCELLED', '작업이 취소됐습니다.', 'cancelled');
    const template = airkoreaRequestTemplate(input), url = new URL(template.endpoint);
    for (const [name, value] of Object.entries(template.query)) url.searchParams.set(name, value);
    url.searchParams.set(template.authentication.queryParameter, key);
    context.dispatch();
    const signal = AbortSignal.any([context.signal, AbortSignal.timeout(30_000)]);
    try {
      const response = await fetcher(url, { method: 'GET', headers: { Accept: 'application/json' }, redirect: 'error', signal });
      if ([401, 403].includes(response.status)) throw new ActionError('AUTH_REQUIRED', '에어코리아 인증과 활용신청 권한을 확인하세요.', 'awaiting_auth');
      if (response.status === 429) throw new ActionError('PROVIDER_RATE_LIMIT', '에어코리아 API 호출 한도를 초과했습니다. 잠시 뒤 다시 요청하세요.');
      if (!response.ok) throw new ActionError(`PROVIDER_HTTP_${response.status}`, `에어코리아 HTTP ${response.status} 응답입니다.`);
      const raw = await response.text();
      if (raw.length > 2_000_000) throw new ActionError('RESULT_TOO_LARGE', '에어코리아 응답이 너무 큽니다.');
      return { data: normalize(input, raw), evidence: action.resultCheck };
    } catch (error) {
      if (context.signal.aborted) throw new ActionError('CANCELLED', '작업이 취소됐습니다.', 'cancelled');
      if (error instanceof ActionError) throw error;
      if (signal.aborted || error instanceof Error && error.name === 'TimeoutError') throw new ActionError('PROVIDER_TIMEOUT', '에어코리아 응답 시간이 초과됐습니다. 다시 요청하세요.');
      throw new ActionError('PROVIDER_CONNECTION_ERROR', '에어코리아에 연결하지 못했습니다. 네트워크와 서비스 상태를 확인하세요.');
    }
  };
}
