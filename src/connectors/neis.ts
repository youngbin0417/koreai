import { z } from 'zod';
import { zodToJsonSchema } from 'zod-to-json-schema';
import { ActionError, type Action, type Executor } from '../types.js';

const schoolSource = 'https://open.neis.go.kr/portal/data/service/selectServicePage.do?infId=OPEN17020190531110010104913&infSeq=2';
const mealSource = 'https://open.neis.go.kr/portal/data/service/selectServicePage.do?infId=OPEN17320190722180924242823&infSeq=2';
const officeCode = z.string().regex(/^[A-Z]\d{2}$/);
const schoolCode = z.string().regex(/^\d{1,20}$/);
const page = z.number().int().min(1).max(1000).default(1);
const limit = z.number().int().min(1).max(100).default(10);
const date = z.string().regex(/^\d{4}-\d{2}-\d{2}$/).refine(value => {
  const parsed = new Date(`${value}T00:00:00Z`);
  return Number.isFinite(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
}, '실제 달력 날짜 YYYY-MM-DD를 입력하세요.');
const mealCodes = { breakfast: '1', lunch: '2', dinner: '3' } as const;
export const neisSchoolsSchema = z.object({ name: z.string().trim().min(1).max(100), educationOfficeCode: officeCode.optional(), region: z.string().trim().min(1).max(50).optional(), page, limit }).strict();
export const neisMealsSchema = z.object({ educationOfficeCode: officeCode, schoolCode, date, meal: z.enum(['breakfast', 'lunch', 'dinner']).default('lunch'), page, limit }).strict();

function action(id: string, title: string, description: string, schema: z.ZodTypeAny, sourceUrl: string, resultCheck: string): Action {
  return { id, serviceId: 'neis', connectorId: 'neis-public-data', title, description, schema,
    category: '교육·도서', effect: 'read', method: 'api', inputSchema: zodToJsonSchema(schema, { $refStrategy: 'none' }) as Record<string, unknown>,
    credentialType: 'neis-api', requiredSecrets: ['apiKey'], scopes: [], sourceUrl, checkedAt: '2026-10-15', verification: 'documented',
    resultCheck, domains: ['open.neis.go.kr'], version: '0.1.0', maintainer: 'KoreAI', origin: 'bundled', implemented: true };
}
export const neisSchoolsAction = action('neis.schools.search', '나이스 학교 찾기',
  '학교 이름으로 공개 학교기본정보를 검색합니다. 동명 학교의 지역·주소를 확인하고 반환된 교육청·학교 코드로 급식을 조회하세요. 학생 개인정보·재학 여부는 조회하지 않습니다.',
  neisSchoolsSchema, schoolSource, '정상 RESULT 코드·전체 건수·교육청 조건·중복 학교 코드를 확인하고 학교명·주소·연계 일자를 보존합니다.');
export const neisMealsAction = action('neis.meals', '나이스 학교 급식 조회',
  '학교 검색으로 확인한 교육청·학교 코드와 날짜·식사를 지정해 공개 식단을 조회합니다. 알레르기 번호·칼로리·영양 원문을 보존하며 빈 결과를 휴교·급식 미실시로 단정하지 않습니다.',
  neisMealsSchema, mealSource, '정상 RESULT 코드·교육청·학교·날짜·식사 일치, 전체 건수·중복을 검증하고 알레르기 표기 원문을 보존합니다.');
export const neisActions = [neisSchoolsAction, neisMealsAction];
export function neisExample(id: string): Record<string, unknown> | undefined {
  if (id === neisSchoolsAction.id) return { name: '서울고등학교', educationOfficeCode: 'B10' };
  if (id === neisMealsAction.id) return { educationOfficeCode: 'B10', schoolCode: '7010057', date: new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Seoul', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date()), meal: 'lunch' };
}
export function neisRequestTemplate(id: string, raw: unknown) {
  let endpoint: string, query: Record<string, string | number>;
  if (id === neisSchoolsAction.id) {
    const input = neisSchoolsSchema.parse(raw); endpoint = 'https://open.neis.go.kr/hub/schoolInfo';
    query = { Type: 'json', pIndex: input.page, pSize: input.limit, SCHUL_NM: input.name, ...(input.educationOfficeCode ? { ATPT_OFCDC_SC_CODE: input.educationOfficeCode } : {}), ...(input.region ? { LCTN_SC_NM: input.region } : {}) };
  } else if (id === neisMealsAction.id) {
    const input = neisMealsSchema.parse(raw); endpoint = 'https://open.neis.go.kr/hub/mealServiceDietInfo';
    query = { Type: 'json', pIndex: input.page, pSize: input.limit, ATPT_OFCDC_SC_CODE: input.educationOfficeCode, SD_SCHUL_CODE: input.schoolCode, MLSV_YMD: input.date.replaceAll('-', ''), MMEAL_SC_CODE: mealCodes[input.meal] };
  } else throw new ActionError('NOT_IMPLEMENTED', '나이스 실행기에 등록되지 않은 행동입니다.');
  return { method: 'GET' as const, endpoint, query, authentication: { secretField: 'apiKey' as const, queryParameter: 'KEY' }, responseFormat: 'json' as const };
}

const invalid = () => new ActionError('INVALID_RESPONSE', '나이스 응답 형식 또는 요청한 학교·날짜·식사·페이지가 일치하지 않습니다.');
const resultSchema = z.object({ CODE: z.string().regex(/^(?:INFO|ERROR)-\d{3}$/), MESSAGE: z.string().optional() });
const totalSchema = z.union([z.number().int().nonnegative(), z.string().regex(/^\d+$/)]).transform(Number).refine(Number.isSafeInteger);
const text = z.string().min(1).max(200);
const optionalText = z.string().max(2000).nullable().optional();
const common = { ATPT_OFCDC_SC_CODE: officeCode, SD_SCHUL_CODE: schoolCode, SCHUL_NM: text, ATPT_OFCDC_SC_NM: optionalText, LOAD_DTM: z.string().max(50).nullable().optional() };
const schoolRow = z.object({ ...common, SCHUL_KND_SC_NM: optionalText, LCTN_SC_NM: optionalText, ORG_RDNMA: optionalText, ORG_RDNDA: optionalText, ORG_TELNO: optionalText });
const mealRow = z.object({ ...common, MMEAL_SC_CODE: z.enum(['1', '2', '3']), MMEAL_SC_NM: text, MLSV_YMD: z.string().regex(/^\d{8}$/), DDISH_NM: z.string().min(1).max(20000), ORPLC_INFO: z.string().max(20000).nullable().optional(), CAL_INFO: optionalText, NTR_INFO: z.string().max(20000).nullable().optional() });
function checkCode(code: string) {
  if (['INFO-000', 'INFO-200'].includes(code)) return;
  if (['ERROR-290', 'INFO-300'].includes(code)) throw new ActionError('AUTH_REQUIRED', '나이스 인증키의 발급·사용중지 상태를 확인한 뒤 재개하세요.', 'awaiting_auth');
  if (code === 'ERROR-337') throw new ActionError('PROVIDER_RATE_LIMIT', '나이스 일일 호출 한도를 초과했습니다. 한도 초기화 후 다시 요청하세요.');
  if (['ERROR-300', 'ERROR-333', 'ERROR-336'].includes(code)) throw new ActionError('PROVIDER_INVALID_INPUT', '나이스가 조회 조건을 거절했습니다. 학교 코드·날짜·페이지를 확인하세요.');
  throw new ActionError('PROVIDER_ERROR', '나이스가 정상 결과를 반환하지 않았습니다. 공급자 상태를 확인하세요.');
}
function readResponse(raw: string, dataset: string) {
  let payload: unknown; try { payload = JSON.parse(raw); } catch { throw invalid(); }
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) throw invalid();
  const object = payload as Record<string, unknown>;
  if (Object.hasOwn(object, 'RESULT')) {
    const result = resultSchema.safeParse(object.RESULT); if (!result.success) throw invalid();
    checkCode(result.data.CODE);
    if (result.data.CODE !== 'INFO-200' || Object.hasOwn(object, dataset)) throw invalid();
    return { rows: [] as unknown[], total: 0, noData: true };
  }
  const parsed = z.tuple([
    z.object({ head: z.tuple([z.object({ list_total_count: totalSchema }), z.object({ RESULT: resultSchema })]) }),
    z.object({ row: z.array(z.unknown()).max(100) }),
  ]).safeParse(object[dataset]);
  if (!parsed.success) throw invalid();
  const [header, body] = parsed.data, code = header.head[1].RESULT.CODE; checkCode(code);
  if (code !== 'INFO-000') throw invalid();
  return { rows: body.row, total: header.head[0].list_total_count, noData: false };
}
function normalize(action: Action, input: Record<string, any>, raw: string) {
  const schools = action.id === neisSchoolsAction.id;
  const { rows, total, noData } = readResponse(raw, schools ? 'schoolInfo' : 'mealServiceDietInfo');
  const offset = (input.page - 1) * input.limit;
  if (rows.length > input.limit || rows.length && offset + rows.length > total || !rows.length && total > offset) throw invalid();
  let data: Record<string, unknown>;
  if (schools) {
    const parsed = z.array(schoolRow).safeParse(rows);
    if (!parsed.success || parsed.data.some(row => input.educationOfficeCode && row.ATPT_OFCDC_SC_CODE !== input.educationOfficeCode)) throw invalid();
    if (new Set(parsed.data.map(row => `${row.ATPT_OFCDC_SC_CODE}:${row.SD_SCHUL_CODE}`)).size !== rows.length) throw invalid();
    data = { schools: parsed.data.map(row => ({ educationOfficeCode: row.ATPT_OFCDC_SC_CODE, educationOfficeName: row.ATPT_OFCDC_SC_NM ?? null, schoolCode: row.SD_SCHUL_CODE, name: row.SCHUL_NM, schoolType: row.SCHUL_KND_SC_NM ?? null, region: row.LCTN_SC_NM ?? null, address: row.ORG_RDNMA ?? null, addressDetail: row.ORG_RDNDA ?? null, phone: row.ORG_TELNO ?? null, portalLinkedAtRaw: row.LOAD_DTM ?? null })) };
  } else {
    const parsed = z.array(mealRow).safeParse(rows);
    if (!parsed.success || parsed.data.some(row => row.ATPT_OFCDC_SC_CODE !== input.educationOfficeCode || row.SD_SCHUL_CODE !== input.schoolCode || row.MLSV_YMD !== input.date.replaceAll('-', '') || row.MMEAL_SC_CODE !== mealCodes[input.meal as keyof typeof mealCodes])) throw invalid();
    if (rows.length > 1) throw invalid();
    data = { educationOfficeCode: input.educationOfficeCode, schoolCode: input.schoolCode, date: input.date, meal: input.meal,
      meals: parsed.data.map(row => ({ schoolName: row.SCHUL_NM, date: input.date, mealCode: row.MMEAL_SC_CODE, mealName: row.MMEAL_SC_NM, menuRaw: row.DDISH_NM, menuLines: row.DDISH_NM.split(/<br\s*\/?>/i).map(line => line.trim()).filter(Boolean), originRaw: row.ORPLC_INFO ?? null, caloriesRaw: row.CAL_INFO ?? null, nutrientsRaw: row.NTR_INFO ?? null, portalLinkedAtRaw: row.LOAD_DTM ?? null })),
      allergyNote: '요리명의 알레르기 번호를 원문 그대로 제공합니다. 표시 누락을 알레르기 유발 성분 없음으로 판단하지 마세요.' };
  }
  return { status: rows.length ? 'available' : 'no_data', ...data,
    ...(!rows.length ? { reason: noData ? 'provider_no_data' : total ? 'empty_page' : 'empty_result', message: schools ? '해당 조건의 학교 정보가 없습니다. 이름·지역·페이지를 확인하세요.' : '해당 조건의 급식 자료가 없습니다. 방학·휴교·급식 미실시 여부는 이 결과만으로 판단할 수 없습니다.' } : {}),
    pagination: { page: input.page, limit: input.limit, totalCount: total, hasMore: input.page * input.limit < total },
    retrievedAt: new Date().toISOString(), providerUpdatedAt: null, timezone: 'Asia/Seoul',
    timestampNote: 'portalLinkedAtRaw는 교육정보 개방포털 연계 일자 원문이며 원자료의 최종 수정 시각이 아닙니다.',
    source: { name: '나이스 교육정보 개방 포털', url: action.sourceUrl } };
}
export function neisExecutor(fetcher: typeof fetch = fetch): Executor {
  return async (action, context) => {
    const registered = neisActions.find(item => item.id === action.id);
    if (!registered) throw new ActionError('NOT_IMPLEMENTED', '나이스 실행기에 등록되지 않은 행동입니다.');
    const input = registered.schema.parse(context.job.input) as Record<string, any>, key = context.secrets.apiKey?.trim();
    if (!key || key.toLowerCase() === 'sample') throw new ActionError('AUTH_REQUIRED', '나이스에서 발급받은 본인 인증키를 등록하세요. 공개 샘플로 대신 실행하지 않습니다.', 'awaiting_auth');
    if (context.signal.aborted) throw new ActionError('CANCELLED', '작업이 취소됐습니다.', 'cancelled');
    const template = neisRequestTemplate(action.id, input), url = new URL(template.endpoint);
    for (const [name, value] of Object.entries(template.query)) url.searchParams.set(name, String(value));
    url.searchParams.set('KEY', key); context.dispatch();
    const signal = AbortSignal.any([context.signal, AbortSignal.timeout(30_000)]);
    try {
      const response = await fetcher(url, { method: 'GET', headers: { Accept: 'application/json' }, redirect: 'error', signal });
      if ([401, 403].includes(response.status)) throw new ActionError('AUTH_REQUIRED', '나이스 인증키와 접근 권한을 확인하세요.', 'awaiting_auth');
      if (response.status === 429) throw new ActionError('PROVIDER_RATE_LIMIT', '나이스 호출 한도를 초과했습니다. 잠시 후 다시 요청하세요.');
      if (!response.ok) throw new ActionError(`PROVIDER_HTTP_${response.status}`, `나이스 HTTP ${response.status} 응답입니다.`);
      const raw = await response.text(); if (raw.length > 2_000_000) throw new ActionError('RESULT_TOO_LARGE', '나이스 응답이 너무 큽니다.');
      return { data: normalize(registered, input, raw), evidence: registered.resultCheck };
    } catch (error) {
      if (context.signal.aborted) throw new ActionError('CANCELLED', '작업이 취소됐습니다.', 'cancelled');
      if (error instanceof ActionError) throw error;
      if (signal.aborted || error instanceof Error && error.name === 'TimeoutError') throw new ActionError('PROVIDER_TIMEOUT', '나이스 응답 시간이 초과됐습니다. 다시 요청하세요.');
      throw new ActionError('PROVIDER_CONNECTION_ERROR', '나이스에 연결하지 못했습니다. 네트워크와 서비스 상태를 확인하세요.');
    }
  };
}
