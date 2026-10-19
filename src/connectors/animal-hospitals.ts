import { z } from 'zod';
import { zodToJsonSchema } from 'zod-to-json-schema';
import { createHash } from 'node:crypto';
import iconv from 'iconv-lite';
import { animalHospitalRegions, animalHospitalRegionSource } from '../research/animal-hospital-regions.js';
import { ActionError, type Action, type Executor } from '../types.js';

const sourceUrl = 'https://www.data.go.kr/data/15045050/fileData.do';
const origin = 'https://file.localdata.go.kr';
const maxBytes = 5_000_000;
export const animalHospitalsSchema = z.object({
  region: z.enum(animalHospitalRegions.map(region => region.name) as [string, ...string[]], { errorMap: () => ({ message: '공식 지역 이름을 선택하세요. 예: 서울강남구' }) }),
  query: z.string().trim().min(1).max(100).optional(),
  status: z.enum(['normal', 'all']).default('normal'),
  page: z.number().int().min(1).max(1000).default(1), limit: z.number().int().min(1).max(50).default(10),
}).strict();
type Input = z.infer<typeof animalHospitalsSchema>;
export const animalHospitalsAction: Action = {
  id: 'animal-hospitals.search', serviceId: 'animal-hospitals', connectorId: 'localdata-animal-hospitals', title: '공공 동물병원 인허가 조회',
  description: '선택한 지역의 공식 공개 CSV에서 병원명·주소와 인허가 상태를 조회합니다. 키가 필요하지 않습니다. 기본은 영업/정상 등록만 조회하며 현재 진료·야간 응급·예약 가능 여부는 확인하지 않습니다.',
  category: '반려동물', effect: 'read', method: 'public-data', schema: animalHospitalsSchema,
  inputSchema: zodToJsonSchema(animalHospitalsSchema, { $refStrategy: 'none' }) as Record<string, unknown>, requiredSecrets: [], scopes: [],
  sourceUrl, checkedAt: '2026-10-19', verification: 'documented', resultCheck: 'CSV 헤더·선택 지역·관리번호 중복·행 수·일자·좌표를 검증합니다. 인허가 상태와 현재 진료를 구분하고 EPSG:5174 원좌표·행별 갱신 시점을 보존합니다.',
  domains: ['file.localdata.go.kr'], version: '0.1.0', maintainer: 'KoreAI', origin: 'bundled', implemented: true,
};
export const animalHospitalsExample = () => ({ region: '서울강남구', status: 'normal', page: 1, limit: 10 });
export function animalHospitalsRequestTemplate(raw: unknown) {
  const input = animalHospitalsSchema.parse(raw), region = animalHospitalRegions.find(region => region.name === input.region)!;
  return { method: 'GET' as const, endpoint: `${origin}/file/download/animal_hospitals/info`, query: { orgCode: region.code }, authentication: { type: 'none' as const }, responseFormat: 'csv' as const,
    preflight: { method: 'GET', endpoint: `${origin}/file/validate/download-count` }, headers: { Referer: animalHospitalRegionSource },
    localFilter: { query: input.query ?? null, status: input.status, page: input.page, limit: input.limit }, sourceCoordinateSystem: 'EPSG:5174' };
}
const invalid = () => new ActionError('INVALID_RESPONSE', '동물병원 공개 CSV의 형식·지역·관리번호·일자 또는 좌표가 유효하지 않습니다.');
// Strict CSV scanner: quoted commas/newlines, escaped quotes, CRLF and a final empty record.
function csvRows(text: string): string[][] {
  const rows: string[][] = []; let row: string[] = [], field = '', quoted = false, closed = false;
  const finishField = () => { row.push(field.trim()); field = ''; closed = false; if (row.length > 100) throw invalid(); };
  const finishRow = () => { finishField(); if (row.some(value => value !== '')) rows.push(row); row = []; if (rows.length > 20_001) throw new ActionError('RESULT_TOO_LARGE', '동물병원 파일 행 수가 너무 많습니다.'); };
  for (let index = 0; index < text.length; index++) {
    const char = text[index]!;
    if (quoted) { if (char === '"') { if (text[index + 1] === '"') { field += '"'; index++; } else { quoted = false; closed = true; } } else field += char; }
    else if (char === ',') finishField();
    else if (char === '\n' || char === '\r') { finishRow(); if (char === '\r' && text[index + 1] === '\n') index++; }
    else if (closed) { if (char !== ' ' && char !== '\t') throw invalid(); }
    else if (char === '"') { if (field) throw invalid(); quoted = true; }
    else field += char;
    if (field.length > 10_000) throw new ActionError('RESULT_TOO_LARGE', '동물병원 파일 필드가 너무 큽니다.');
  }
  if (quoted) throw invalid();
  if (field || row.length || closed) finishRow();
  return rows;
}
const calendarDate = (value: string) => { const date = new Date(`${value}T00:00:00Z`); return /^\d{4}-\d{2}-\d{2}$/.test(value) && Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value; };
const dateField = (value: string) => { if (!value) return null; if (!calendarDate(value)) throw invalid(); return value; };
const timestampField = (value: string) => { if (!value) return null; if (!/^\d{4}-\d{2}-\d{2}(?:[ T](?:[01]\d|2[0-3]):[0-5]\d:[0-5]\d(?:\.\d{1,9})?)?$/.test(value) || !calendarDate(value.slice(0, 10))) throw invalid(); return value; };
const coordinate = (value: string) => { if (!value) return null; if (!/^-?\d{1,8}(?:\.\d{1,16})?$/.test(value) || !Number.isFinite(Number(value))) throw invalid(); return Number(value); };
export function normalizeAnimalHospitalCsv(bytes: Uint8Array, raw: unknown) {
  if (bytes.byteLength > maxBytes) throw new ActionError('RESULT_TOO_LARGE', '동물병원 파일이 너무 큽니다.');
  const input = animalHospitalsSchema.parse(raw), region = animalHospitalRegions.find(region => region.name === input.region)!;
  let text: string, encoding: string;
  try { text = new TextDecoder('utf-8', { fatal: true }).decode(bytes); encoding = 'utf-8'; }
  catch {
    text = iconv.decode(Buffer.from(bytes), 'cp949'); encoding = 'cp949';
    if (text.includes('\uFFFD') || !iconv.encode(text, 'cp949').equals(Buffer.from(bytes))) throw invalid();
  }
  const rows = csvRows(text.replace(/^\uFEFF/, '')), headers = rows.shift();
  const required = ['개방자치단체코드','관리번호','사업장명','영업상태코드','영업상태명','상세영업상태코드','상세영업상태명','인허가일자','폐업일자','도로명주소','지번주소','전화번호','데이터갱신시점','최종수정시점','좌표정보(X)','좌표정보(Y)'];
  if (!headers || new Set(headers).size !== headers.length || required.some(key => !headers.includes(key))) throw invalid();
  const columns = new Map(headers.map((header, index) => [header, index])), seen = new Set<string>();
  const hospitals = rows.map(row => {
    if (row.length !== headers.length) throw invalid();
    const get = (key: string) => row[columns.get(key)!]!;
    const id = get('관리번호'), name = get('사업장명'), code = get('영업상태코드');
    if (get('개방자치단체코드') !== region.code || !/^[A-Za-z0-9_-]{1,80}$/.test(id) || seen.has(id) || !name || name.length > 300 || !/^\d{2}$/.test(code) || ['도로명주소','지번주소'].some(key => get(key).length > 2000) || get('전화번호').length > 100) throw invalid();
    seen.add(id);
    const x = coordinate(get('좌표정보(X)')), y = coordinate(get('좌표정보(Y)'));
    return { managementId: id, authorityCode: region.code, name, registration: { code, name: get('영업상태명'), detailCode: get('상세영업상태코드'), detail: get('상세영업상태명'), normal: code === '01' },
      permissionDate: dateField(get('인허가일자')), closureDate: dateField(get('폐업일자')), roadAddress: get('도로명주소') || null, lotAddress: get('지번주소') || null, phone: get('전화번호') || null,
      dataUpdatedAtRaw: timestampField(get('데이터갱신시점')), lastModifiedAtRaw: timestampField(get('최종수정시점')),
      coordinates: { crs: 'EPSG:5174', x, y, complete: x !== null && y !== null, latitude: null, longitude: null }, currentlyTreating: null, emergencyAvailable: null };
  });
  const query = input.query?.toLocaleLowerCase('ko-KR'), matching = hospitals.filter(hospital => (input.status === 'all' || hospital.registration.normal) && (!query || hospital.name.toLocaleLowerCase('ko-KR').includes(query)));
  const offset = (input.page - 1) * input.limit, page = matching.slice(offset, offset + input.limit);
  return { status: page.length ? 'available' : 'no_data', region: { name: region.name, code: region.code }, filter: { query: input.query ?? null, status: input.status, scope: 'selected_authority' },
    hospitals: page, totalSourceRows: rows.length, totalMatches: matching.length, returnedCount: page.length,
    pagination: { page: input.page, limit: input.limit, hasMore: offset + page.length < matching.length }, encoding, snapshotSha256: createHash('sha256').update(bytes).digest('hex'),
    ...(!page.length ? { reason: offset >= matching.length && matching.length ? 'empty_page' : 'no_match', message: '선택한 지역·조건·페이지에 결과가 없습니다. 진료 가능한 병원이 없다는 의미는 아닙니다.' } : {}),
    retrievedAt: new Date().toISOString(), providerUpdatedAt: null, timezone: 'Asia/Seoul',
    dataNote: '인허가 상태이며 현재 진료·응급·예약 가능 여부는 미확인입니다. 공식 안내는 약 2일 전 자료의 일일 갱신이며 실제 파일의 일괄 기준시각은 미제공입니다. 행별 갱신 원문을 확인하세요. EPSG:5174 좌표는 위경도로 변환하지 않았습니다.',
    source: { name: '행정안전부 지방행정인허가 · 공공데이터포털', url: sourceUrl, downloadUrl: animalHospitalRegionSource, referenceCheckedAt: '2026-10-19' } };
}
async function readBytes(response: Response) {
  const reader = response.body?.getReader(); if (!reader) throw invalid(); let size = 0; const chunks: Uint8Array[] = [];
  try { for (;;) { const part = await reader.read(); if (part.done) break; size += part.value.byteLength;
    if (size > maxBytes) { await reader.cancel(); throw new ActionError('RESULT_TOO_LARGE', '동물병원 파일이 너무 큽니다.'); } chunks.push(part.value); }
  } finally { reader.releaseLock(); }
  const bytes = new Uint8Array(size); let offset = 0; for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; } return bytes;
}
function checkStatus(response: Response) {
  if (response.status === 429) throw new ActionError('PROVIDER_RATE_LIMIT', '공식 파일 다운로드 한도를 초과했습니다. 한도 초기화 후 다시 요청하세요.');
  if (!response.ok) throw new ActionError(`PROVIDER_HTTP_${response.status}`, '동물병원 공개 파일 요청이 거절됐습니다. 공식 서비스 상태를 확인하세요.');
}
export function animalHospitalsExecutor(fetcher: typeof fetch = fetch): Executor {
  return async (action, context) => {
    if (action.id !== animalHospitalsAction.id) throw new ActionError('NOT_IMPLEMENTED', '동물병원 실행기에 등록되지 않은 행동입니다.');
    const input = animalHospitalsSchema.parse(context.job.input), template = animalHospitalsRequestTemplate(input), signal = AbortSignal.any([context.signal, AbortSignal.timeout(30_000)]);
    const cancelled = () => { if (context.signal.aborted) throw new ActionError('CANCELLED', '작업이 취소됐습니다.', 'cancelled'); };
    cancelled(); context.dispatch();
    try {
      const init = { method: 'GET', headers: { Referer: animalHospitalRegionSource }, redirect: 'error' as const, signal };
      const preflight = await fetcher(template.preflight.endpoint, init); try { checkStatus(preflight); } finally { await preflight.body?.cancel(); }
      cancelled();
      const url = new URL(template.endpoint); url.searchParams.set('orgCode', template.query.orgCode);
      const response = await fetcher(url, init); try { checkStatus(response); } catch (error) { await response.body?.cancel(); throw error; }
      if (!/^text\/csv(?:;|$)/i.test(response.headers.get('content-type') ?? '')) { await response.body?.cancel(); throw invalid(); }
      const data = normalizeAnimalHospitalCsv(await readBytes(response), input); cancelled();
      return { data: { ...data, providerLastModifiedRaw: response.headers.get('last-modified') }, evidence: action.resultCheck };
    } catch (error) {
      cancelled(); if (error instanceof ActionError) throw error;
      if (signal.aborted || error instanceof Error && error.name === 'TimeoutError') throw new ActionError('PROVIDER_TIMEOUT', '동물병원 공개 파일 응답 시간이 초과됐습니다.');
      throw new ActionError('PROVIDER_CONNECTION_ERROR', '동물병원 공개 파일에 연결하지 못했습니다. 네트워크와 공식 서비스 상태를 확인하세요.');
    }
  };
}
