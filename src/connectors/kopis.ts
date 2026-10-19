import { XMLParser, XMLValidator } from 'fast-xml-parser';
import { z } from 'zod';
import { zodToJsonSchema } from 'zod-to-json-schema';
import { ActionError, type Action, type Executor } from '../types.js';

const docs = 'https://kopis.or.kr/por/cs/openapi/openApiInfo.do?menuId=MNU_00077';
const base = 'https://kopis.or.kr/openApi/restful/pblprfr';
export const kopisGenres = { AAAA: '연극', BBBC: '무용(서양/한국무용)', BBBE: '대중무용', CCCA: '서양음악(클래식)', CCCC: '한국음악(국악)', CCCD: '대중음악', EEEA: '복합', EEEB: '서커스/마술', GGGA: '뮤지컬' } as const;
export const kopisRegions = { '11': '서울특별시', '26': '부산광역시', '27': '대구광역시', '28': '인천광역시', '29': '광주광역시', '30': '대전광역시', '31': '울산광역시', '36': '세종특별자치시', '41': '경기도', '51': '강원특별자치도', '43': '충청북도', '44': '충청남도', '45': '전라북도', '46': '전라남도', '47': '경상북도', '48': '경상남도', '50': '제주특별자치도' } as const;
const states = { '01': '공연예정', '02': '공연중', '03': '공연완료' } as const;
const performanceId = z.string().trim().regex(/^PF\d{6,10}$/);
const date = z.string().regex(/^\d{4}-\d{2}-\d{2}$/).refine(value => Number.isFinite(Date.parse(value)) && new Date(value).toISOString().slice(0,10) === value, '유효한 YYYY-MM-DD 날짜를 입력하세요.');
const region = z.enum(Object.keys(kopisRegions) as [keyof typeof kopisRegions, ...(keyof typeof kopisRegions)[]]);
export const kopisSearchSchema = z.object({
  startDate: date, endDate: date, name: z.string().trim().min(1).max(100).optional(), venue: z.string().trim().min(1).max(100).optional(),
  regionCode: region.optional().describe('KOPIS signgucode. 서울 11·부산 26·경기 41·강원 51 등'),
  districtCode: z.string().regex(/^\d{4}$/).optional().describe('KOPIS 구군코드. 종로구 1111·강남구 1168. 시도코드와 함께 입력'),
  genreCode: z.enum(Object.keys(kopisGenres) as [keyof typeof kopisGenres, ...(keyof typeof kopisGenres)[]]).optional(), state: z.enum(['01','02','03']).optional().describe('공연예정·공연중·공연완료. 좌석/회차 예약 가능 여부와 다름'),
  page: z.number().int().min(1).max(999).default(1), limit: z.number().int().min(1).max(100).default(10),
}).strict().refine(input => Date.parse(input.endDate) >= Date.parse(input.startDate) && Date.parse(input.endDate) - Date.parse(input.startDate) < 31 * 86_400_000, '시작일 이후의 종료일을 입력하세요. 검색 기간은 양 끝을 포함해 최대 31일입니다.')
  .refine(input => !input.districtCode || !!input.regionCode && input.districtCode.startsWith(input.regionCode), '구군코드와 일치하는 시도코드를 함께 입력하세요.');
export const kopisDetailSchema = z.object({ performanceId }).strict();
const common = { serviceId: 'kopis', connectorId: 'kopis-api', category: '일정·문화·주거', effect: 'read', method: 'api', credentialType: 'kopis-api', requiredSecrets: ['apiKey'], scopes: [], sourceUrl: docs, checkedAt: '2026-10-19', verification: 'documented', domains: ['kopis.or.kr'], version: '0.1.0', maintainer: 'KoreAI', origin: 'bundled', implemented: true } as const;
function define(id: string, title: string, description: string, schema: z.ZodTypeAny): Action {
  return { ...common, requiredSecrets: [...common.requiredSecrets], scopes: [], domains: [...common.domains], id, title, description, schema,
    inputSchema: zodToJsonSchema(schema, { $refStrategy: 'none' }) as Record<string,unknown>, resultCheck: '공식 XML의 공연 ID·중복·최대 건수·날짜를 검증합니다. 상세는 요청 ID와 대조하며 출처를 포함합니다. 공연 상태·가격 안내와 현재 좌석/결제 가능 여부는 구분합니다.' };
}
export const kopisSearchAction = define('kopis.performances.search', 'KOPIS 공연 검색', '최대 31일 기간의 공연 목록 한 페이지를 지역·장르·이름·상태로 검색합니다. 전체 건수는 미제공이며 요약·재표시에도 반환된 KOPIS 출처를 함께 표시하세요.', kopisSearchSchema);
export const kopisDetailAction = define('kopis.performances.get', 'KOPIS 공연 상세 조회', '검색 결과의 공연 ID로 기간·공연장·출연진·시간/연령/가격 안내·예매처를 조회합니다. 좌석·주문·결제를 실행하지 않으며 재표시에도 KOPIS 출처를 함께 표시하세요.', kopisDetailSchema);
export const kopisActions = [kopisSearchAction,kopisDetailAction];
export function kopisExample(id: string, now = new Date()): Record<string,unknown> {
  if (id === kopisDetailAction.id) return { performanceId: 'PF132236' };
  const seoulDate = now.getTime() + 9 * 3_600_000;
  return { startDate: new Date(seoulDate).toISOString().slice(0,10), endDate: new Date(seoulDate + 6 * 86_400_000).toISOString().slice(0,10), regionCode: '11', page: 1, limit: 10 };
}
export function kopisRequestTemplate(id: string, raw: unknown) {
  let endpoint: string, query: Record<string,string|number> = {};
  if (id === kopisSearchAction.id) {
    const input = kopisSearchSchema.parse(raw); endpoint = base;
    query = { stdate: input.startDate.replaceAll('-',''), eddate: input.endDate.replaceAll('-',''), cpage: input.page, rows: input.limit };
    for (const [key,field] of Object.entries({ name: 'shprfnm', venue: 'shprfnmfct', regionCode: 'signgucode', districtCode: 'signgucodesub', genreCode: 'shcate', state: 'prfstate' })) { const value = input[key as keyof typeof input]; if (value !== undefined) query[field] = value; }
  } else if (id === kopisDetailAction.id) endpoint = `${base}/${kopisDetailSchema.parse(raw).performanceId}`;
  else throw new ActionError('NOT_IMPLEMENTED','KOPIS 실행기에 등록되지 않은 행동입니다.');
  return { method: 'GET' as const, endpoint, query, authentication: { secretField: 'apiKey' as const, queryParameter: 'service' }, responseFormat: 'xml' as const };
}
const invalid = () => new ActionError('INVALID_RESPONSE','KOPIS 응답의 XML·공연 ID·건수·날짜 또는 상세 구조가 유효하지 않습니다.');
const text = z.string().trim().max(100_000), optionalText = text.nullish();
const rowSchema = z.object({ mt20id: performanceId, prfnm: text.min(1).max(1000), fcltynm: optionalText, prfpdfrom: optionalText, prfpdto: optionalText, area: optionalText, genrenm: optionalText, prfstate: optionalText, openrun: z.union([z.enum(['Y','N']),z.literal('')]).nullish(),
  mt10id: z.union([z.string().regex(/^FC\d{6,10}$/),z.literal('')]).nullish(), mt13id: z.union([z.string().regex(/^FC\d{6,10}-\d{2,4}$/),z.literal('')]).nullish(),
  prfcast: optionalText, prfcrew: optionalText, prfruntime: optionalText, prfage: optionalText, pcseguidance: optionalText, dtguidance: optionalText, sty: optionalText, frstregdt: optionalText, updatedate: optionalText, relates: z.unknown().optional() });
const parser = new XMLParser({ parseTagValue: false, trimValues: false, ignoreAttributes: true, ignoreDeclaration: true,
  processEntities: { enabled: true, maxTotalExpansions: 10_000, maxExpandedLength: 100_000 }, htmlEntities: false });
function records(raw: string): unknown[] {
  if (/<!\s*(?:DOCTYPE|ENTITY)\b/i.test(raw) || XMLValidator.validate(raw) !== true) throw invalid();
  let root: any; try { root = parser.parse(raw); } catch { throw invalid(); }
  if (!root || !Object.hasOwn(root,'dbs')) throw invalid();
  if (root.dbs === '') return [];
  const body = root.dbs;
  if (!body || typeof body !== 'object' || Array.isArray(body) || !Object.hasOwn(body,'db')) throw invalid();
  const rows = Array.isArray(body.db) ? body.db : [body.db];
  for (const row of rows) {
    if (row && typeof row === 'object' && 'returncode' in row) {
      if (row.returncode === '02') throw new ActionError('AUTH_REQUIRED','KOPIS에서 발급받은 본인 인증키와 승인·사용 조건을 확인한 뒤 재개하세요.','awaiting_auth');
      const code = typeof row.returncode === 'string' && /^\d{2}$/.test(row.returncode) ? row.returncode : 'ERROR';
      throw new ActionError(`PROVIDER_${code}`,'KOPIS가 요청을 거절했습니다. 입력·키·호출 한도와 서비스 상태를 확인하세요.');
    }
  }
  return rows;
}
function dateValue(raw?: string|null) {
  if (!raw) return null;
  const value = raw.replaceAll('.','-'); if (!date.safeParse(value).success) throw invalid(); return value;
}
function ticketLinks(raw: unknown) {
  if (raw === undefined || raw === null || raw === '') return [];
  const container = z.object({ relate: z.unknown() }).safeParse(raw); if (!container.success) throw invalid();
  const rows = Array.isArray(container.data.relate) ? container.data.relate : [container.data.relate];
  const parsed = z.array(z.object({ relatenm: text, relateurl: text })).max(50).safeParse(rows); if (!parsed.success) throw invalid();
  return parsed.data.flatMap(row => { try { const url = new URL(row.relateurl); return ['http:','https:'].includes(url.protocol) && !url.username && !url.password ? [{ name: row.relatenm, url: url.href }] : []; } catch { return []; } });
}
function normalize(raw: string, action: Action, input: Record<string,any>) {
  const rows = records(raw), detail = action.id === kopisDetailAction.id;
  const parsed = z.array(rowSchema).max(detail ? 1 : input.limit).safeParse(rows); if (!parsed.success || new Set(parsed.data.map(row => row.mt20id)).size !== rows.length) throw invalid();
  const performances = parsed.data.map(row => {
    if (detail && row.mt20id !== input.performanceId) throw invalid();
    const startDate = dateValue(row.prfpdfrom), endDate = dateValue(row.prfpdto);
    if (startDate && endDate && endDate < startDate) throw invalid();
    const reportedStateCode = Object.entries(states).find(([,name]) => name === row.prfstate)?.[0] ?? null;
    const common = { performanceId: row.mt20id, name: row.prfnm, startDate, endDate, venueName: row.fcltynm || null, regionRaw: row.area || null, genreRaw: row.genrenm || null,
      reportedState: { code: reportedStateCode, label: row.prfstate || null }, openRun: row.openrun ? row.openrun === 'Y' : null, currentSeatsAvailable: null };
    return detail ? { ...common, facilityId: row.mt10id || null, venueId: row.mt13id || null, castRaw: row.prfcast || null, crewRaw: row.prfcrew || null, runtimeRaw: row.prfruntime || null, ageGuidanceRaw: row.prfage || null,
      ticketPriceGuidanceRaw: row.pcseguidance || null, scheduleGuidanceRaw: row.dtguidance || null, story: row.sty || null, registeredAtRaw: row.frstregdt || null, providerUpdatedAtRaw: row.updatedate || null, ticketLinks: ticketLinks(row.relates) } : common;
  });
  return { status: performances.length ? 'available' : 'no_data', ...(detail ? { requestedPerformanceId: input.performanceId, performance: performances[0] ?? null } : { performances, returnedCount: performances.length, pagination: { page: input.page, limit: input.limit, totalCount: null,
    nextPageCandidate: rows.length === input.limit && input.page < 999 ? input.page + 1 : null, hasMore: rows.length === input.limit ? null : false } }),
    retrievedAt: new Date().toISOString(), providerUpdatedAt: null, timezone: 'Asia/Seoul',
    dataNote: 'KOPIS 제공 정보입니다. 기간·상태·시간·가격 안내는 개별 회차·잔여 좌석·최종 결제 가격을 보장하지 않습니다. 전체 건수는 미제공이며 다음 페이지 후보가 실제로 존재한다고 확정하지 않습니다. 수정 시각은 공급자 원문으로 보존하며 시간대를 추정하지 않습니다. 재표시에는 source.attribution을 함께 표시하세요.',
    source: { name: '예술경영지원센터 공연예술통합전산망', url: docs, attribution: '출처: (재)예술경영지원센터 공연예술통합전산망(kopis.or.kr)' } };
}
async function readBody(response: Response) {
  const reader = response.body?.getReader(); if (!reader) throw invalid();
  const decoder = new TextDecoder('utf-8',{ fatal: true }); let raw = '', bytes = 0;
  const decode = (value?: Uint8Array, stream = false) => { try { return decoder.decode(value,{ stream }); } catch { throw invalid(); } };
  try { for (;;) { const part = await reader.read(); if (part.done) break; bytes += part.value.byteLength; if (bytes > 2_000_000) { await reader.cancel(); throw new ActionError('RESULT_TOO_LARGE','KOPIS 응답이 너무 큽니다. 조회 개수를 줄여 주세요.'); } raw += decode(part.value,true); } return raw + decode(); }
  finally { reader.releaseLock(); }
}
export function kopisExecutor(fetcher: typeof fetch = fetch): Executor {
  return async (action,context) => {
    if (!kopisActions.some(item => item.id === action.id)) throw new ActionError('NOT_IMPLEMENTED','KOPIS 실행기에 등록되지 않은 행동입니다.');
    const input = action.schema.parse(context.job.input), template = kopisRequestTemplate(action.id,input);
    if (context.signal.aborted) throw new ActionError('CANCELLED','작업이 취소됐습니다.','cancelled');
    const key = context.secrets.apiKey?.trim(); if (!key || key.length > 4096 || /[^\x21-\x7e]/.test(key)) throw new ActionError('AUTH_REQUIRED','KOPIS에서 발급받은 본인 인증키를 등록하세요.','awaiting_auth');
    const url = new URL(template.endpoint); for (const [name,value] of Object.entries(template.query)) url.searchParams.set(name,String(value)); url.searchParams.set('service',key);
    const signal = AbortSignal.any([context.signal,AbortSignal.timeout(30_000)]); context.dispatch();
    try {
      const response = await fetcher(url,{ method: 'GET', headers: { Accept: 'application/xml, text/xml' }, redirect: 'error', cache: 'no-store', signal });
      if ([401,403].includes(response.status)) throw new ActionError('AUTH_REQUIRED','KOPIS 키·승인·접근 조건을 확인한 뒤 재개하세요.','awaiting_auth');
      if (response.status === 429) throw new ActionError('PROVIDER_RATE_LIMIT','KOPIS 호출 한도를 초과했습니다. 본인 키의 한도를 확인하세요.');
      if (!response.ok) throw new ActionError(`PROVIDER_HTTP_${response.status}`,'KOPIS가 정상 결과를 반환하지 않았습니다.');
      const data = normalize(await readBody(response),action,input);
      if (context.signal.aborted) throw new ActionError('CANCELLED','작업이 취소됐습니다.','cancelled'); return { data, evidence: action.resultCheck };
    } catch (error) {
      if (context.signal.aborted) throw new ActionError('CANCELLED','작업이 취소됐습니다.','cancelled');
      if (error instanceof ActionError) throw error;
      if (signal.aborted || error instanceof Error && error.name === 'TimeoutError') throw new ActionError('PROVIDER_TIMEOUT','KOPIS 응답 시간이 초과됐습니다.');
      throw new ActionError('PROVIDER_CONNECTION_ERROR','KOPIS HTTPS API에 연결하지 못했습니다. 네트워크·서비스 상태를 확인하세요.');
    }
  };
}
