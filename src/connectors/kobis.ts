import { z } from 'zod';
import { zodToJsonSchema } from 'zod-to-json-schema';
import { ActionError, type Action, type Executor } from '../types.js';

const sourceUrl = 'https://www.kobis.or.kr/kobisopenapi/homepg/apiservice/searchServiceDesc.do?apiSvcId=searchDailyBoxOffice';
const date = z.string().regex(/^\d{4}-\d{2}-\d{2}$/).refine(value => {
  const parsed = new Date(`${value}T00:00:00Z`);
  return Number.isFinite(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
}, '실제 달력 날짜 YYYY-MM-DD를 입력하세요.');
export const kobisSchema = z.object({ date, limit: z.number().int().min(1).max(10).default(10) }).strict();
export const kobisAction: Action = {
  id: 'kobis.boxoffice.daily', serviceId: 'kobis', connectorId: 'kobis-public-data', title: 'KOBIS 일별 박스오피스 조회',
  description: '날짜별 전국 전체 영화의 박스오피스 순위·관객수·매출 집계를 조회합니다. 최대 10개 결과이며 극장 상영시간·잔여좌석·예매 기능은 포함하지 않습니다. 예시는 한국 표준시 어제 날짜입니다.',
  category: '일정·문화·주거', effect: 'read', method: 'api', schema: kobisSchema,
  inputSchema: zodToJsonSchema(kobisSchema, { $refStrategy: 'none' }) as Record<string, unknown>,
  credentialType: 'kobis-api', requiredSecrets: ['apiKey'], scopes: [], sourceUrl, checkedAt: '2026-10-15', verification: 'documented',
  resultCheck: '일별 유형·조회 날짜 범위 일치, 영화 코드·순위 중복·숫자 형식·결과 수를 검증하고 조회/갱신 시각을 구분합니다.',
  domains: ['www.kobis.or.kr'], version: '0.1.0', maintainer: 'KoreAI', origin: 'bundled', implemented: true,
};
export function kobisExample(now = new Date()): Record<string, unknown> {
  return { date: new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Seoul', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(now.getTime() - 86_400_000)), limit: 10 };
}
export function kobisRequestTemplate(raw: unknown) {
  const input = kobisSchema.parse(raw);
  return { method: 'GET' as const, endpoint: 'https://www.kobis.or.kr/kobisopenapi/webservice/rest/boxoffice/searchDailyBoxOfficeList.json',
    query: { targetDt: input.date.replaceAll('-', ''), itemPerPage: String(input.limit) },
    authentication: { secretField: 'apiKey' as const, queryParameter: 'key' }, responseFormat: 'json' as const };
}
const invalid = () => new ActionError('INVALID_RESPONSE', 'KOBIS 응답 형식 또는 요청한 날짜·결과 수가 일치하지 않습니다.');
const integer = z.string().regex(/^\d{1,20}$/).transform(Number).refine(Number.isSafeInteger);
const signedInteger = z.string().regex(/^-?\d{1,20}$/).transform(Number).refine(Number.isSafeInteger);
const amount = z.string().regex(/^\d{1,30}$/);
const signedAmount = z.string().regex(/^-?\d{1,30}$/);
const percent = z.string().regex(/^-?\d{1,10}(?:\.\d{1,10})?$/);
const rowSchema = z.object({
  rnum: integer.refine(n => n >= 1 && n <= 10), rank: integer.refine(n => n >= 1 && n <= 10), rankInten: signedInteger,
  rankOldAndNew: z.enum(['OLD', 'NEW']), movieCd: z.string().regex(/^\d{1,20}$/), movieNm: z.string().min(1).max(500),
  openDt: z.union([date, z.literal('')]), audiCnt: integer, audiAcc: integer,
  audiInten: signedInteger.optional(), audiChange: percent.optional(), salesAmt: amount, salesAcc: amount,
  salesShare: percent.optional(), salesInten: signedAmount.optional(), salesChange: percent.optional(), scrnCnt: integer.optional(), showCnt: integer.optional(),
});
function normalize(raw: string, input: z.infer<typeof kobisSchema>) {
  let payload: unknown; try { payload = JSON.parse(raw); } catch { throw invalid(); }
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) throw invalid();
  if (Object.hasOwn(payload, 'faultInfo')) {
    const parsed = z.object({ faultInfo: z.object({ errorCode: z.string().regex(/^\d{1,10}$/), message: z.string().optional() }) }).safeParse(payload);
    if (!parsed.success) throw invalid();
    // 320010 was confirmed against the official HTTPS endpoint using an invalid test key.
    if (parsed.data.faultInfo.errorCode === '320010') throw new ActionError('AUTH_REQUIRED', 'KOBIS에서 발급받은 인증키의 유효성을 확인한 뒤 재개하세요.', 'awaiting_auth');
    throw new ActionError(`PROVIDER_${parsed.data.faultInfo.errorCode}`, 'KOBIS가 요청을 거절했습니다. 공급자의 키 상태·호출 한도·입력 조건을 확인하세요.');
  }
  const parsed = z.object({ boxOfficeResult: z.object({ boxofficeType: z.literal('일별 박스오피스'), showRange: z.string(), dailyBoxOfficeList: z.array(rowSchema).max(10) }) }).safeParse(payload);
  if (!parsed.success) throw invalid();
  const body = parsed.data.boxOfficeResult, day = input.date.replaceAll('-', ''), rows = body.dailyBoxOfficeList;
  if (body.showRange !== `${day}~${day}` || rows.length > input.limit || new Set(rows.map(row => row.movieCd)).size !== rows.length || new Set(rows.map(row => row.rank)).size !== rows.length || new Set(rows.map(row => row.rnum)).size !== rows.length || rows.some((row, index) => index > 0 && row.rank <= rows[index - 1]!.rank)) throw invalid();
  return { status: rows.length ? 'available' : 'no_data', date: input.date, boxofficeType: body.boxofficeType, showRange: body.showRange,
    scope: { region: 'national', movies: 'all' }, limit: input.limit, returnedCount: rows.length,
    movies: rows.map(row => ({ movieCode: row.movieCd, title: row.movieNm, openingDate: row.openDt || null, rank: row.rank, rankChange: row.rankInten, entryStatus: row.rankOldAndNew,
      audienceCount: row.audiCnt, cumulativeAudienceCount: row.audiAcc, audienceChange: row.audiInten ?? null, audienceChangePercentRaw: row.audiChange ?? null,
      salesAmountRaw: row.salesAmt, cumulativeSalesAmountRaw: row.salesAcc, salesSharePercentRaw: row.salesShare ?? null, salesChangeRaw: row.salesInten ?? null, salesChangePercentRaw: row.salesChange ?? null,
      screenCount: row.scrnCnt ?? null, screeningCount: row.showCnt ?? null })),
    ...(!rows.length ? { reason: 'empty_result', message: '해당 날짜의 박스오피스 자료가 없습니다. 영화 상영이 없었다는 의미로 단정하지 마세요.' } : {}),
    retrievedAt: new Date().toISOString(), providerUpdatedAt: null, timezone: 'Asia/Seoul',
    dataNote: '집계 대상 날짜와 조회 시각을 구분합니다. 현재 상영시간·잔여좌석 정보는 포함하지 않습니다. 매출액은 정밀도 손실 없이 원문 숫자 문자열로 제공합니다.',
    source: { name: '영화진흥위원회 KOBIS', url: sourceUrl } };
}
export function kobisExecutor(fetcher: typeof fetch = fetch): Executor {
  return async (action, context) => {
    if (action.id !== kobisAction.id) throw new ActionError('NOT_IMPLEMENTED', 'KOBIS 실행기에 등록되지 않은 행동입니다.');
    const input = kobisSchema.parse(context.job.input), key = context.secrets.apiKey?.trim();
    if (!key) throw new ActionError('AUTH_REQUIRED', 'KOBIS에서 발급받은 본인 인증키를 등록하세요.', 'awaiting_auth');
    if (context.signal.aborted) throw new ActionError('CANCELLED', '작업이 취소됐습니다.', 'cancelled');
    const template = kobisRequestTemplate(input), url = new URL(template.endpoint);
    for (const [name, value] of Object.entries(template.query)) url.searchParams.set(name, value);
    url.searchParams.set('key', key); context.dispatch();
    const signal = AbortSignal.any([context.signal, AbortSignal.timeout(30_000)]);
    try {
      const response = await fetcher(url, { method: 'GET', headers: { Accept: 'application/json' }, redirect: 'error', signal });
      if ([401, 403].includes(response.status)) throw new ActionError('AUTH_REQUIRED', 'KOBIS 인증키와 접근 권한을 확인하세요.', 'awaiting_auth');
      if (response.status === 429) throw new ActionError('PROVIDER_RATE_LIMIT', 'KOBIS 호출 한도를 초과했습니다. 한도 초기화 후 다시 요청하세요.');
      if (!response.ok) throw new ActionError(`PROVIDER_HTTP_${response.status}`, `KOBIS HTTP ${response.status} 응답입니다.`);
      const raw = await response.text(); if (raw.length > 2_000_000) throw new ActionError('RESULT_TOO_LARGE', 'KOBIS 응답이 너무 큽니다.');
      return { data: normalize(raw, input), evidence: kobisAction.resultCheck };
    } catch (error) {
      if (context.signal.aborted) throw new ActionError('CANCELLED', '작업이 취소됐습니다.', 'cancelled');
      if (error instanceof ActionError) throw error;
      if (signal.aborted || error instanceof Error && error.name === 'TimeoutError') throw new ActionError('PROVIDER_TIMEOUT', 'KOBIS 응답 시간이 초과됐습니다. 다시 요청하세요.');
      throw new ActionError('PROVIDER_CONNECTION_ERROR', 'KOBIS에 연결하지 못했습니다. 네트워크와 서비스 상태를 확인하세요.');
    }
  };
}
