import { XMLParser, XMLValidator } from 'fast-xml-parser';
import { z } from 'zod';
import { zodToJsonSchema } from 'zod-to-json-schema';
import { ActionError, type Action, type Executor } from '../types.js';

const sourceUrl = 'https://www.data.go.kr/data/15001698/openapi.do';
const endpoint = 'https://apis.data.go.kr/B551182/hospInfoServicev2/getHospBasisList';
const label = (max: number) => z.string().trim().min(1).max(max);
export const hiraSchema = z.object({
  name: label(150).optional().describe('병원명 검색. 예: 서울의료원'),
  provinceCode: z.string().regex(/^\d{2}0000$/).optional().describe('HIRA 시도코드. 예: 서울 110000. 정보나루·행정구역 코드와 구분'),
  districtCode: z.string().regex(/^\d{6}$/).optional().describe('HIRA 시군구코드. 예: 강남구 110001, 서초구 110021, 중랑구 110019'),
  town: label(100).optional().describe('읍면동명'),
  institutionTypeCode: z.string().regex(/^\d{2}$/).optional().describe('HIRA 종별코드. 예: 종합병원 11, 의원 31'),
  departmentCode: z.string().regex(/^\d{2}$/).optional().describe('HIRA 진료과목코드. 예: 내과 01, 소아청소년과 11. 현재 진료 가능 판정이 아님'),
  page: z.number().int().min(1).max(1000).default(1), limit: z.number().int().min(1).max(100).default(10),
}).strict().refine(input => !!(input.name || input.provinceCode || input.districtCode), '병원명·시도코드·시군구코드 중 하나 이상 입력하세요.')
  .refine(input => !input.provinceCode || !input.districtCode || input.provinceCode.slice(0, 2) === input.districtCode.slice(0, 2), 'HIRA 시도·시군구 코드의 지역이 일치해야 합니다.');
type HiraInput = z.infer<typeof hiraSchema>;
export const hiraAction: Action = {
  id: 'hira.hospitals.search', serviceId: 'hira', connectorId: 'hira-hospitals-api', title: 'HIRA 병원정보 검색',
  category: '의료·예약', effect: 'read', method: 'api',
  description: '심평원에 신고한 병원 기본목록을 기관명·지역·종별·진료과목으로 조회합니다. 암호화 요양기호·주소·전화·제공 좌표·신고 의사 수를 반환하며 현재 진료 가능·병상·예약·의료의 질은 판정하지 않습니다.',
  schema: hiraSchema, inputSchema: zodToJsonSchema(hiraSchema, { $refStrategy: 'none' }) as Record<string, unknown>,
  credentialType: 'hira-api', requiredSecrets: ['serviceKey'], scopes: [], sourceUrl, checkedAt: '2026-10-19', verification: 'documented',
  resultCheck: '공식 XML 정상 헤더·페이지·결과 수·중복 암호화 요양기호·요청한 지역/종별을 대조합니다. 개설일·조회일·미제공 갱신 시각과 현재 진료 상태를 구분하고 출처를 표시합니다.',
  domains: ['apis.data.go.kr'], version: '0.1.0', maintainer: 'KoreAI', origin: 'bundled', implemented: true,
};
export function hiraExample() { return { name: '서울의료원', provinceCode: '110000', districtCode: '110019', page: 1, limit: 10 }; }
export function hiraRequestTemplate(raw: unknown) {
  const input = hiraSchema.parse(raw), query: Record<string, string | number> = { pageNo: input.page, numOfRows: input.limit };
  for (const [key, field] of Object.entries({ name: 'yadmNm', provinceCode: 'sidoCd', districtCode: 'sgguCd', town: 'emdongNm', institutionTypeCode: 'clCd', departmentCode: 'dgsbjtCd' })) {
    const value = input[key as keyof HiraInput]; if (value !== undefined) query[field] = value;
  }
  return { method: 'GET' as const, endpoint, query, authentication: { secretField: 'serviceKey' as const, queryParameter: 'ServiceKey' }, responseFormat: 'xml' as const };
}
const invalid = () => new ActionError('INVALID_RESPONSE', 'HIRA 응답의 XML·페이지·기관 식별자·필터·개수·날짜 또는 좌표가 유효하지 않습니다.');
const integer = z.string().trim().regex(/^\d+$/).transform(Number).pipe(z.number().int().nonnegative().safe());
const text = z.string().trim().max(20_000);
const optionalText = text.nullish();
const optionalCount = z.union([integer, z.literal('')]).nullish();
const itemSchema = z.object({ ykiho: text.min(1).max(1024).refine(value => !/[\x00-\x20\x7f]/.test(value)), yadmNm: text.min(1).max(300),
  sidoCd: z.string().trim().regex(/^\d{6}$/).optional(), sgguCd: z.string().trim().regex(/^\d{6}$/).optional(), clCd: z.string().trim().regex(/^\d{2}$/).optional(),
  sidoCdNm: optionalText, sgguCdNm: optionalText, clCdNm: optionalText, emdongNm: optionalText, addr: optionalText, telno: optionalText, postNo: optionalText,
  hospUrl: optionalText, estbDd: optionalText, XPos: optionalText, YPos: optionalText, drTotCnt: optionalCount });
const parser = new XMLParser({ parseTagValue: false, trimValues: false, ignoreAttributes: true, ignoreDeclaration: true,
  processEntities: { enabled: true, maxTotalExpansions: 10_000, maxExpandedLength: 100_000 }, htmlEntities: false });
function providerCode(code: string) {
  if (code === '00') return;
  if (['20', '30', '31'].includes(code)) throw new ActionError('AUTH_REQUIRED', 'HIRA 병원정보서비스의 활용신청·승인과 일반 인증키(Decoding)를 확인한 뒤 재개하세요.', 'awaiting_auth');
  if (['22', '23'].includes(code)) throw new ActionError('PROVIDER_RATE_LIMIT', 'HIRA 호출 한도를 초과했습니다. 본인 계정의 한도를 확인하세요.');
  if (code === '29') throw new ActionError('PROVIDER_IP_BLOCKED', 'HIRA가 서버 IP의 접근을 차단했습니다. 공급자 접근 조건을 확인하세요.');
  if (code === '10') throw new ActionError('PROVIDER_INVALID_INPUT', 'HIRA가 검색 조건을 거절했습니다. 공식 지역·종별·진료과목 코드를 확인하세요.');
  if (code === '05') throw new ActionError('PROVIDER_TIMEOUT', 'HIRA 또는 공공데이터 게이트웨이의 응답 시간이 초과됐습니다.');
  throw new ActionError(`PROVIDER_${code}`, 'HIRA가 정상 결과를 반환하지 않았습니다. 공급자 서비스 상태와 명세를 확인하세요.');
}
function readResponse(raw: string) {
  if (/<!\s*(?:DOCTYPE|ENTITY)\b/i.test(raw) || XMLValidator.validate(raw) !== true) throw invalid();
  let root: any; try { root = parser.parse(raw); } catch { throw invalid(); }
  const codeSchema = z.string().trim().regex(/^\d{1,2}$/).transform(value => value.padStart(2, '0'));
  const fault = z.object({ OpenAPI_ServiceResponse: z.object({ cmmMsgHeader: z.object({ returnReasonCode: codeSchema }) }) }).safeParse(root);
  if (fault.success) { providerCode(fault.data.OpenAPI_ServiceResponse.cmmMsgHeader.returnReasonCode); throw invalid(); }
  const response = z.object({ response: z.object({ header: z.object({ resultCode: codeSchema }), body: z.unknown().optional() }) }).safeParse(root);
  if (!response.success) throw invalid(); providerCode(response.data.response.header.resultCode);
  const body = z.object({ pageNo: integer, numOfRows: integer, totalCount: integer, items: z.union([z.object({ item: z.unknown().optional() }), z.literal('')]).optional() }).safeParse(response.data.response.body);
  if (!body.success) throw invalid(); return body.data;
}
function coordinates(row: z.infer<typeof itemSchema>) {
  const raw = { x: row.XPos || null, y: row.YPos || null };
  if (!raw.x || !raw.y) return { longitude: null, latitude: null, raw };
  if (![raw.x, raw.y].every(value => /^-?\d+(?:\.\d+)?$/.test(value))) throw invalid();
  const longitude = Number(raw.x), latitude = Number(raw.y); if (Math.abs(longitude) > 180 || Math.abs(latitude) > 90) throw invalid();
  return { longitude: longitude === 0 && latitude === 0 ? null : longitude, latitude: longitude === 0 && latitude === 0 ? null : latitude, raw };
}
function openingDate(raw?: string | null) {
  if (!raw || raw === '00000000') return null;
  if (!/^\d{8}$/.test(raw)) throw invalid();
  const date = `${raw.slice(0,4)}-${raw.slice(4,6)}-${raw.slice(6)}`;
  if (!Number.isFinite(Date.parse(date)) || new Date(date).toISOString().slice(0,10) !== date) throw invalid(); return date;
}
function homepage(value?: string | null) {
  if (!value) return null;
  try { const url = new URL(value); return ['http:', 'https:'].includes(url.protocol) && !url.username && !url.password ? url.href : null; } catch { return null; }
}
function normalize(raw: string, input: HiraInput) {
  const body = readResponse(raw), offset = (input.page - 1) * input.limit;
  const item = typeof body.items === 'object' ? body.items.item : undefined;
  const items = item === undefined || item === '' ? [] : Array.isArray(item) ? item : [item];
  const parsed = z.array(itemSchema).max(input.limit).safeParse(items);
  if (!parsed.success || body.pageNo !== input.page || body.numOfRows !== input.limit || items.length !== Math.min(input.limit, Math.max(0, body.totalCount - offset))) throw invalid();
  if (new Set(parsed.data.map(row => row.ykiho)).size !== items.length) throw invalid();
  const hospitals = parsed.data.map(row => {
    if (input.provinceCode && row.sidoCd !== input.provinceCode || input.districtCode && row.sgguCd !== input.districtCode || input.institutionTypeCode && row.clCd !== input.institutionTypeCode) throw invalid();
    return { providerId: row.ykiho, providerIdType: 'encrypted_ykiho', name: row.yadmNm, address: row.addr || null, phone: row.telno || null, postalCode: row.postNo || null, homepageUrl: homepage(row.hospUrl),
      province: { code: row.sidoCd ?? null, name: row.sidoCdNm || null }, district: { code: row.sgguCd ?? null, name: row.sgguCdNm || null }, town: row.emdongNm || null,
      institutionType: { code: row.clCd ?? null, name: row.clCdNm || null }, openedOn: openingDate(row.estbDd), openingDateRaw: row.estbDd || null,
      coordinates: coordinates(row), reportedDoctorCount: typeof row.drTotCnt === 'number' ? row.drTotCnt : null, currentlyTreating: null, emergencyAvailable: null };
  });
  return { status: hospitals.length ? 'available' : 'no_data', hospitals, returnedCount: hospitals.length, query: input,
    pagination: { page: input.page, limit: input.limit, totalCount: body.totalCount, nextPage: hospitals.length && offset + hospitals.length < body.totalCount && input.page < 1000 ? input.page + 1 : null },
    retrievedAt: new Date().toISOString(), providerUpdatedAt: null, timezone: 'Asia/Seoul',
    dataNote: 'HIRA 신고 기준의 기관 정보입니다. 암호화 요양기호는 원래 요양기호·E-Gen 기관 ID와 다르며 복호화하지 않습니다. 개설일은 자료 갱신일이 아닙니다. 의사 수·진료과목 조건은 현재 진료 인력·진료 가능·병상·예약·의료의 질을 확정하지 않습니다.',
    source: { name: '건강보험심사평가원', url: sourceUrl, attribution: '건강보험심사평가원 병원정보서비스 · 공공누리 제1유형(출처표시)' } };
}
async function readBody(response: Response) {
  const reader = response.body?.getReader(); if (!reader) throw invalid();
  const decoder = new TextDecoder('utf-8', { fatal: true }); let raw = '', bytes = 0;
  const decode = (value?: Uint8Array, stream = false) => { try { return decoder.decode(value, { stream }); } catch { throw invalid(); } };
  try { for (;;) { const part = await reader.read(); if (part.done) break; bytes += part.value.byteLength;
    if (bytes > 2_000_000) { await reader.cancel(); throw new ActionError('RESULT_TOO_LARGE', 'HIRA 응답이 너무 큽니다. 조회 개수를 줄여 주세요.'); } raw += decode(part.value, true); } return raw + decode();
  } finally { reader.releaseLock(); }
}
export function hiraExecutor(fetcher: typeof fetch = fetch): Executor {
  return async (action, context) => {
    if (action.id !== hiraAction.id) throw new ActionError('NOT_IMPLEMENTED', 'HIRA 실행기에 등록되지 않은 행동입니다.');
    const input = hiraSchema.parse(context.job.input), template = hiraRequestTemplate(input);
    if (context.signal.aborted) throw new ActionError('CANCELLED', '작업이 취소됐습니다.', 'cancelled');
    const key = context.secrets.serviceKey?.trim();
    if (!key || key.length > 4096 || /[^\x21-\x7e]/.test(key)) throw new ActionError('AUTH_REQUIRED', 'HIRA 병원정보서비스를 신청한 일반 인증키(Decoding)를 등록하세요.', 'awaiting_auth');
    const url = new URL(template.endpoint); for (const [name, value] of Object.entries(template.query)) url.searchParams.set(name, String(value)); url.searchParams.set('ServiceKey', key);
    const signal = AbortSignal.any([context.signal, AbortSignal.timeout(30_000)]); context.dispatch();
    try {
      const response = await fetcher(url, { method: 'GET', headers: { Accept: 'application/xml, text/xml' }, redirect: 'error', cache: 'no-store', signal });
      if ([401,403].includes(response.status)) throw new ActionError('AUTH_REQUIRED', 'HIRA 키·활용신청·승인·서버 접근 조건을 확인한 뒤 재개하세요.', 'awaiting_auth');
      if (response.status === 429) throw new ActionError('PROVIDER_RATE_LIMIT', 'HIRA 호출 한도를 초과했습니다. 본인 계정의 한도를 확인하세요.');
      if (!response.ok) throw new ActionError(`PROVIDER_HTTP_${response.status}`, 'HIRA API가 정상 결과를 반환하지 않았습니다.');
      const data = normalize(await readBody(response), input);
      if (context.signal.aborted) throw new ActionError('CANCELLED', '작업이 취소됐습니다.', 'cancelled');
      return { data, evidence: hiraAction.resultCheck };
    } catch (error) {
      if (context.signal.aborted) throw new ActionError('CANCELLED', '작업이 취소됐습니다.', 'cancelled');
      if (error instanceof ActionError) throw error;
      if (signal.aborted || error instanceof Error && error.name === 'TimeoutError') throw new ActionError('PROVIDER_TIMEOUT', 'HIRA 응답 시간이 초과됐습니다.');
      throw new ActionError('PROVIDER_CONNECTION_ERROR', 'HIRA HTTPS API에 연결하지 못했습니다. 네트워크·서비스 상태를 확인하세요.');
    }
  };
}
