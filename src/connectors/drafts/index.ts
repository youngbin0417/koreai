import { z } from 'zod';
import { zodToJsonSchema } from 'zod-to-json-schema';
import { appApiBacklog } from '../../research/app-api-backlog.js';
import { ActionError, type Action, type Executor } from '../../types.js';
import { kmaAction, kmaExample, kmaRequestTemplate } from '../kma.js';
import { airkoreaAction, airkoreaExample, airkoreaRequestTemplate } from '../airkorea.js';
import { tagoActions, tagoArrivalsAction, tagoCitiesAction, tagoStopsAction, tagoExample, tagoRequestTemplate } from '../tago.js';
import { egenAction, egenRequestTemplate } from '../egen.js';

const nonempty = (description: string, max = 100) => z.string().trim().min(1).max(max).describe(description);
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
  actionId?: string;
  serviceId: string;
  title: string;
  description: string;
  schema: z.ZodTypeAny;
  example: Record<string, unknown>;
  resultCheck: string;
  request?: (input: Record<string, any>) => DraftRequest;
}

// Request templates contain no secrets and never dispatch HTTP. Two schemas are
// KoreAI proposals pending review of the provider's detailed parameter contract.
const definitions: Definition[] = [
  {
    serviceId: 'kma', title: '기상청 초단기실황 조회',
    description: kmaAction.description,
    schema: kmaAction.schema,
    example: { date: '2026-10-10', time: '0900', nx: 60, ny: 127 },
    resultCheck: '정상 resultCode와 요청한 baseDate/baseTime·nx/ny 일치, 관측 항목·단위·결측값·출처를 검증합니다.',
    request: kmaRequestTemplate,
  },
  {
    serviceId: 'airkorea', title: '에어코리아 대기질 예보 조회',
    description: airkoreaAction.description,
    schema: airkoreaAction.schema,
    example: { date: '2026-10-10', pollutant: 'PM25' },
    resultCheck: airkoreaAction.resultCheck,
    request: airkoreaRequestTemplate,
  },
  {
    actionId: tagoArrivalsAction.id, serviceId: 'tago', title: tagoArrivalsAction.title,
    description: tagoArrivalsAction.description, schema: tagoArrivalsAction.schema,
    example: tagoExample(tagoArrivalsAction.id)!, resultCheck: tagoArrivalsAction.resultCheck,
    request: input => tagoRequestTemplate(tagoArrivalsAction.id, input),
  },
  {
    actionId: tagoCitiesAction.id, serviceId: 'tago', title: tagoCitiesAction.title,
    description: tagoCitiesAction.description, schema: tagoCitiesAction.schema,
    example: tagoExample(tagoCitiesAction.id)!, resultCheck: tagoCitiesAction.resultCheck,
    request: input => tagoRequestTemplate(tagoCitiesAction.id, input),
  },
  {
    actionId: tagoStopsAction.id, serviceId: 'tago', title: tagoStopsAction.title,
    description: tagoStopsAction.description, schema: tagoStopsAction.schema,
    example: tagoExample(tagoStopsAction.id)!, resultCheck: tagoStopsAction.resultCheck,
    request: input => tagoRequestTemplate(tagoStopsAction.id, input),
  },
  {
    serviceId: 'egen', title: 'E-Gen 병·의원 찾기',
    description: egenAction.description,
    schema: egenAction.schema,
    example: { region: '서울특별시', district: '강남구' },
    resultCheck: egenAction.resultCheck,
    request: egenRequestTemplate,
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

export const planningActions: Action[] = definitions.map(definition => {
  if (definition.serviceId === 'kma') return kmaAction;
  if (definition.serviceId === 'airkorea') return airkoreaAction;
  if (definition.serviceId === 'tago') return tagoActions.find(action => action.id === definition.actionId)!;
  if (definition.serviceId === 'egen') return egenAction;
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
export const draftActions = planningActions.filter(action => !action.implemented);

export interface DraftPreview {
  actionId: string;
  networkDispatched: false;
  validatedInput: Record<string, unknown>;
  request: DraftRequest | null;
  mappingStatus: 'documented-template' | 'pending-parameter-review';
  nextStep: string;
}
export function draftExample(actionId: string): Record<string, unknown> | undefined {
  if (actionId === kmaAction.id) return kmaExample();
  if (actionId === airkoreaAction.id) return airkoreaExample();
  const index = planningActions.findIndex(a => a.id === actionId);
  return index < 0 ? undefined : structuredClone(definitions[index]!.example);
}
export function previewDraftRequest(actionId: string, raw: unknown): DraftPreview {
  const index = planningActions.findIndex(a => a.id === actionId);
  if (index < 0) throw new ActionError('NOT_FOUND', '연결 초안을 찾을 수 없습니다.');
  const action = planningActions[index]!;
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
