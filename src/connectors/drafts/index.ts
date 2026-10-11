import { z } from 'zod';
import { zodToJsonSchema } from 'zod-to-json-schema';
import { appApiBacklog } from '../../research/app-api-backlog.js';
import { ActionError, type Action, type Executor } from '../../types.js';

const nonempty = (description: string, max = 100) => z.string().trim().min(1).max(max).describe(description);
const page = z.number().int().min(1).max(1000).default(1);
const limit = z.number().int().min(1).max(100).default(10);
const date = z.string().regex(/^\d{4}-\d{2}-\d{2}$/).refine(value => {
  const parsed = new Date(`${value}T00:00:00Z`);
  return Number.isFinite(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
}, '실제 달력 날짜 YYYY-MM-DD를 입력하세요.');

export interface DraftRequest {
  method: 'GET';
  endpoint: string;
  query: Record<string, string | number>;
  authentication: { secretField: 'serviceKey'; queryParameter: string };
  responseFormat: 'json' | 'xml';
}
interface Definition {
  serviceId: string;
  title: string;
  description: string;
  schema: z.ZodTypeAny;
  example: Record<string, unknown>;
  resultCheck: string;
  request?: (input: Record<string, any>) => DraftRequest;
}
const dataRequest = (path: string, query: DraftRequest['query'], responseFormat: DraftRequest['responseFormat'] = 'json', keyParameter = 'serviceKey'): DraftRequest => ({
  method: 'GET', endpoint: `https://apis.data.go.kr/${path}`, query,
  authentication: { secretField: 'serviceKey', queryParameter: keyParameter }, responseFormat,
});

// Request templates contain no secrets and never dispatch HTTP. Two schemas are
// KoreAI proposals pending review of the provider's detailed parameter contract.
const definitions: Definition[] = [
  {
    serviceId: 'kma', title: '기상청 초단기실황 조회',
    description: '발표일·정시·기상청 격자로 관측값을 조회하는 초안입니다. 입력은 한국 표준시 기준이며 주소 변환과 최신 발표 시각 계산은 후속 구현입니다.',
    schema: z.object({ date: date.describe('발표일, Asia/Seoul'), time: z.string().regex(/^(?:[01]\d|2[0-3])00$/).describe('발표 정시 HH00, Asia/Seoul'), nx: z.number().int().min(1).max(1000).describe('기상청 격자 X, 경도가 아님'), ny: z.number().int().min(1).max(1000).describe('기상청 격자 Y, 위도가 아님'), page, limit }).strict(),
    example: { date: '2026-10-10', time: '0900', nx: 60, ny: 127 },
    resultCheck: '정상 resultCode와 요청한 baseDate/baseTime·nx/ny 일치, 관측 항목·단위·결측값·출처를 검증합니다.',
    request: input => dataRequest('1360000/VilageFcstInfoService_2.0/getUltraSrtNcst', { dataType: 'JSON', base_date: input.date.replaceAll('-', ''), base_time: input.time, nx: input.nx, ny: input.ny, pageNo: input.page, numOfRows: input.limit }, 'json', 'ServiceKey'),
  },
  {
    serviceId: 'airkorea', title: '에어코리아 대기질 예보 조회',
    description: '날짜와 PM10·PM25·O3 항목으로 예보를 조회하는 초안입니다. 측정소의 현재 관측값 조회와 별개의 행동입니다.',
    schema: z.object({ date, pollutant: z.enum(['PM10', 'PM25', 'O3']).default('PM10'), page, limit }).strict(),
    example: { date: '2026-10-10', pollutant: 'PM25' },
    resultCheck: '정상 resultCode와 통보 날짜·informCode, 발표 시각·예보 지역·출처·변경금지 조건을 검증합니다.',
    request: input => dataRequest('B552584/ArpltnInforInqireSvc/getMinuDustFrcstDspth', { returnType: 'json', searchDate: input.date, InformCode: input.pollutant, pageNo: input.page, numOfRows: input.limit }),
  },
  {
    serviceId: 'tago', title: 'TAGO 버스 도착예정 조회',
    description: '도시코드와 정류소 ID로 버스 도착 정보를 조회하는 초안입니다. 도시·정류소 탐색은 다음 행동으로 추가합니다.',
    schema: z.object({ cityCode: z.number().int().min(1).max(999999999), nodeId: nonempty('TAGO 정류소 ID', 30).regex(/^[A-Za-z0-9_-]+$/), page, limit }).strict(),
    example: { cityCode: 25, nodeId: 'DJB8001793' },
    resultCheck: '정상 resultCode와 요청 nodeId 일치, 노선·도착 예정 초/분 단위·조회 시점·지역 제공 여부를 검증합니다.',
    request: input => dataRequest('1613000/ArvlInfoInqireService/getSttnAcctoArvlPrearngeInfoList', { _type: 'json', cityCode: input.cityCode, nodeId: input.nodeId, pageNo: input.page, numOfRows: input.limit }),
  },
  {
    serviceId: 'egen', title: 'E-Gen 병·의원 찾기',
    description: '지역과 기관명·진료요일을 조건으로 병·의원 정보를 조회하는 초안입니다. 실시간 진료 가능 판정이나 응급실 가용 병상 확인은 이 행동에 포함되지 않습니다.',
    schema: z.object({ region: nonempty('시도명', 16), district: nonempty('시군구명', 60).optional(), name: nonempty('병·의원 이름', 100).optional(), day: z.number().int().min(1).max(8).optional().describe('월~일 1~7, 공휴일 8'), page, limit }).strict(),
    example: { region: '서울특별시', district: '강남구' },
    resultCheck: 'XML 정상 결과와 기관 식별자·주소·진료요일·자료 시점을 검증합니다. 목록 조회를 실제 운영 여부로 단정하지 않습니다.',
    request: input => dataRequest('B552657/HsptlAsembySearchService/getHsptlMdcncListInfoInqire', { Q0: input.region, ...(input.district ? { Q1: input.district } : {}), ...(input.name ? { QN: input.name } : {}), ...(input.day ? { QT: input.day } : {}), pageNo: input.page, numOfRows: input.limit }, 'xml'),
  },
  {
    serviceId: 'neis', title: '나이스 학교 급식 조회',
    description: '교육청·학교·날짜를 지정하는 KoreAI 입력 초안입니다. 공개 식단을 대상으로 하며 공급자 요청 필드 매핑은 상세 문서 검토 후 구현합니다.',
    schema: z.object({ educationOfficeCode: nonempty('교육청 코드', 20).regex(/^[A-Za-z0-9]+$/), schoolCode: nonempty('학교 코드', 20).regex(/^\d+$/), date, meal: z.enum(['breakfast', 'lunch', 'dinner']).default('lunch') }).strict(),
    example: { educationOfficeCode: 'B10', schoolCode: '7010000', date: '2026-10-10', meal: 'lunch' },
    resultCheck: '학교·날짜·급식 구분 일치와 빈 식단/인증 오류를 구분하고 원본 알레르기 표시를 보존합니다.',
  },
  {
    serviceId: 'kobis', title: 'KOBIS 일별 박스오피스 조회',
    description: '조회 날짜와 결과 수를 지정하는 KoreAI 입력 초안입니다. 공급자 필드·HTTPS 확인 후 요청 매핑을 구현합니다. CGV·메가박스 예매 연동과 별개입니다.',
    schema: z.object({ date, limit: z.number().int().min(1).max(10).default(10) }).strict(),
    example: { date: '2026-10-10', limit: 10 },
    resultCheck: '조회 날짜·영화 코드·순위·관객수 응답과 집계 시점을 검증합니다. 극장 상영 시간·좌석 정보로 표시하지 않습니다.',
  },
];

export const draftActions: Action[] = definitions.map(definition => {
  const candidate = appApiBacklog.find(c => c.serviceId === definition.serviceId)!;
  const domains = definition.request ? ['apis.data.go.kr'] : definition.serviceId === 'neis' ? ['open.neis.go.kr'] : ['www.kobis.or.kr'];
  return {
    id: candidate.draftActionIds[0]!, serviceId: candidate.serviceId, connectorId: `${candidate.serviceId}-public-data`,
    title: definition.title, description: definition.description, category: candidate.category,
    effect: 'read', method: 'api', schema: definition.schema,
    inputSchema: zodToJsonSchema(definition.schema, { $refStrategy: 'none' }) as Record<string, unknown>,
    credentialType: `${candidate.serviceId}-api`, requiredSecrets: [definition.request ? 'serviceKey' : 'apiKey'], scopes: [],
    sourceUrl: candidate.sourceUrl, checkedAt: candidate.checkedAt, verification: 'documented', resultCheck: definition.resultCheck,
    domains, version: '0.1.0-draft.1', maintainer: 'KoreAI', origin: 'bundled', implemented: false,
  };
});

export interface DraftPreview {
  actionId: string;
  networkDispatched: false;
  validatedInput: Record<string, unknown>;
  request: DraftRequest | null;
  mappingStatus: 'documented-template' | 'pending-parameter-review';
  nextStep: string;
}
export function draftExample(actionId: string): Record<string, unknown> | undefined {
  const index = draftActions.findIndex(a => a.id === actionId);
  return index < 0 ? undefined : structuredClone(definitions[index]!.example);
}
export function previewDraftRequest(actionId: string, raw: unknown): DraftPreview {
  const index = draftActions.findIndex(a => a.id === actionId);
  if (index < 0) throw new ActionError('NOT_FOUND', '연결 초안을 찾을 수 없습니다.');
  const action = draftActions[index]!;
  const input = action.schema.parse(raw) as Record<string, unknown>;
  const definition = definitions[index]!;
  return {
    actionId, networkDispatched: false, validatedInput: input,
    request: definition.request?.(input) ?? null,
    mappingStatus: definition.request ? 'documented-template' : 'pending-parameter-review',
    nextStep: appApiBacklog.find(c => c.serviceId === action.serviceId)!.nextStep,
  };
}

// Defence in depth: even an accidental implemented=true cannot dispatch a draft.
export const draftExecutor: Executor = async () => {
  throw new ActionError('NOT_IMPLEMENTED', '입력·요청 구조 초안입니다. 공급자 실행기와 실제 계정 검증을 완료해야 합니다.');
};
