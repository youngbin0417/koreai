import { z } from 'zod';
import { zodToJsonSchema } from 'zod-to-json-schema';
import { appApiBacklog } from '../../research/app-api-backlog.js';
import { ActionError, type Action, type Executor } from '../../types.js';
import { kmaAction, kmaExample, kmaRequestTemplate } from '../kma.js';
import { airkoreaAction, airkoreaExample, airkoreaRequestTemplate } from '../airkorea.js';
import { tagoActions, tagoArrivalsAction, tagoCitiesAction, tagoStopsAction, tagoExample, tagoRequestTemplate } from '../tago.js';
import { egenAction, egenRequestTemplate } from '../egen.js';
import { hiraAction, hiraExample, hiraRequestTemplate } from '../hira.js';
import { neisActions, neisSchoolsAction, neisMealsAction, neisExample, neisRequestTemplate } from '../neis.js';
import { kobisAction, kobisExample, kobisRequestTemplate } from '../kobis.js';
import { kopisActions, kopisExample, kopisRequestTemplate } from '../kopis.js';
import { tourapiActions, tourapiExample, tourapiRequestTemplate } from '../tourapi.js';
import { foodsafetyAction, foodsafetyExample, foodsafetyRequestTemplate } from '../foodsafety.js';
import { lhAction, lhExample, lhRequestTemplate } from '../lh.js';
import { kosisAction, kosisExample, kosisRequestTemplate } from '../kosis.js';
import { vehicleEnergyActions, vehicleEnergyExample, vehicleEnergyRequestTemplate } from '../vehicle-energy.js';
import { opggActions, opggExample, opggRequestTemplate } from '../opgg.js';
import { seoulBikeAction, seoulBikeExample, seoulBikeRequestTemplate } from '../seoul-bike.js';
import { naverBooksActions, naverBooksExample, naverBooksRequestTemplate } from '../naver-books.js';
import { naruActions, naruExample, naruRequestTemplate } from '../library-naru.js';
import { chzzkActions, chzzkExample, chzzkRequestTemplate } from '../chzzk.js';
import { animalHospitalsAction, animalHospitalsExample, animalHospitalsRequestTemplate } from '../animal-hospitals.js';

export interface DraftRequest {
  method: 'GET' | 'POST';
  endpoint: string;
  query: Record<string, string | number | string[]>;
  authentication: { secretField: 'serviceKey' | 'apiKey'; queryParameter: string } | { secretField: 'apiKey'; pathParameter: string } | { headers: Record<string, { secretField: string }> } | { type: 'none' };
  responseFormat: 'json' | 'xml' | 'csv' | 'mcp';
  body?: Record<string, unknown>;
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

// Request templates contain no secrets and never dispatch HTTP.
const definitions: Definition[] = [
  ...opggActions.map(action=>({actionId:action.id,serviceId:action.serviceId,title:action.title,description:action.description,schema:action.schema,
    example:opggExample(action.id),resultCheck:action.resultCheck,request:(input:Record<string,any>)=>opggRequestTemplate(action.id,input)})),
  ...vehicleEnergyActions.map(action=>({actionId:action.id,serviceId:action.serviceId,title:action.title,description:action.description,schema:action.schema,
    example:vehicleEnergyExample(action.id),resultCheck:action.resultCheck,request:(input:Record<string,any>)=>vehicleEnergyRequestTemplate(action.id,input)})),
  { actionId:kosisAction.id, serviceId:kosisAction.serviceId, title:kosisAction.title, description:kosisAction.description,
    schema:kosisAction.schema, example:kosisExample(), resultCheck:kosisAction.resultCheck, request:kosisRequestTemplate },
  { actionId:lhAction.id, serviceId:lhAction.serviceId, title:lhAction.title, description:lhAction.description,
    schema:lhAction.schema, example:lhExample(), resultCheck:lhAction.resultCheck, request:lhRequestTemplate },
  { actionId:foodsafetyAction.id, serviceId:foodsafetyAction.serviceId, title:foodsafetyAction.title, description:foodsafetyAction.description,
    schema:foodsafetyAction.schema, example:foodsafetyExample(), resultCheck:foodsafetyAction.resultCheck, request:foodsafetyRequestTemplate },
  ...tourapiActions.map(action => ({ actionId: action.id, serviceId: action.serviceId, title: action.title, description: action.description,
    schema: action.schema, example: tourapiExample(action.id), resultCheck: action.resultCheck, request: (input: Record<string,any>) => tourapiRequestTemplate(action.id,input) })),
  ...kopisActions.map(action => ({ actionId: action.id, serviceId: action.serviceId, title: action.title, description: action.description,
    schema: action.schema, example: kopisExample(action.id), resultCheck: action.resultCheck, request: (input: Record<string,any>) => kopisRequestTemplate(action.id,input) })),
  { actionId: hiraAction.id, serviceId: hiraAction.serviceId, title: hiraAction.title, description: hiraAction.description, schema: hiraAction.schema,
    example: hiraExample(), resultCheck: hiraAction.resultCheck, request: hiraRequestTemplate },
  ...naruActions.map(action => ({ actionId: action.id, serviceId: action.serviceId, title: action.title, description: action.description,
    schema: action.schema, example: naruExample(action.id), resultCheck: action.resultCheck, request: (input: Record<string, any>) => naruRequestTemplate(action.id, input) })),
  ...naverBooksActions.map(action => ({ actionId: action.id, serviceId: action.serviceId, title: action.title, description: action.description,
    schema: action.schema, example: naverBooksExample(action.id), resultCheck: action.resultCheck, request: (input: Record<string, any>) => naverBooksRequestTemplate(action.id, input) })),
  { serviceId: 'animal-hospitals', title: animalHospitalsAction.title, description: animalHospitalsAction.description, schema: animalHospitalsAction.schema,
    example: animalHospitalsExample(), resultCheck: animalHospitalsAction.resultCheck, request: animalHospitalsRequestTemplate },
  ...chzzkActions.map(action => ({ actionId: action.id, serviceId: action.serviceId, title: action.title, description: action.description,
    schema: action.schema, example: chzzkExample(action.id), resultCheck: action.resultCheck, request: (input: Record<string, any>) => chzzkRequestTemplate(action.id, input) })),
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
    actionId: neisMealsAction.id, serviceId: 'neis', title: neisMealsAction.title,
    description: neisMealsAction.description, schema: neisMealsAction.schema,
    example: neisExample(neisMealsAction.id)!, resultCheck: neisMealsAction.resultCheck,
    request: input => neisRequestTemplate(neisMealsAction.id, input),
  },
  {
    actionId: neisSchoolsAction.id, serviceId: 'neis', title: neisSchoolsAction.title,
    description: neisSchoolsAction.description, schema: neisSchoolsAction.schema,
    example: neisExample(neisSchoolsAction.id)!, resultCheck: neisSchoolsAction.resultCheck,
    request: input => neisRequestTemplate(neisSchoolsAction.id, input),
  },
  {
    serviceId: 'kobis', title: 'KOBIS 일별 박스오피스 조회',
    description: kobisAction.description, schema: kobisAction.schema,
    example: kobisExample(), resultCheck: kobisAction.resultCheck, request: kobisRequestTemplate,
  },
  {
    serviceId: 'seoul-bike', title: seoulBikeAction.title, description: seoulBikeAction.description, schema: seoulBikeAction.schema,
    example: seoulBikeExample(), resultCheck: seoulBikeAction.resultCheck, request: seoulBikeRequestTemplate,
  },
];

export const planningActions: Action[] = definitions.map(definition => {
  if (definition.serviceId === 'opgg') return opggActions.find(action=>action.id===definition.actionId)!;
  if (vehicleEnergyActions.some(action=>action.id===definition.actionId)) return vehicleEnergyActions.find(action=>action.id===definition.actionId)!;
  if (definition.serviceId === 'kosis') return kosisAction;
  if (definition.serviceId === 'lh') return lhAction;
  if (definition.serviceId === 'foodsafety') return foodsafetyAction;
  if (definition.serviceId === 'tourapi') return tourapiActions.find(action => action.id === definition.actionId)!;
  if (definition.serviceId === 'kopis') return kopisActions.find(action => action.id === definition.actionId)!;
  if (definition.serviceId === 'hira') return hiraAction;
  if (definition.serviceId === 'library-naru') return naruActions.find(action => action.id === definition.actionId)!;
  if (definition.serviceId === 'animal-hospitals') return animalHospitalsAction;
  if (definition.serviceId === 'naver-search') return naverBooksActions.find(action => action.id === definition.actionId)!;
  if (definition.serviceId === 'chzzk') return chzzkActions.find(action => action.id === definition.actionId)!;
  if (definition.serviceId === 'kma') return kmaAction;
  if (definition.serviceId === 'airkorea') return airkoreaAction;
  if (definition.serviceId === 'tago') return tagoActions.find(action => action.id === definition.actionId)!;
  if (definition.serviceId === 'egen') return egenAction;
  if (definition.serviceId === 'neis') return neisActions.find(action => action.id === definition.actionId)!;
  if (definition.serviceId === 'kobis') return kobisAction;
  if (definition.serviceId === 'seoul-bike') return seoulBikeAction;
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
  unavailable?: Action['unavailable'];
  networkDispatched: false;
  validatedInput: Record<string, unknown>;
  request: DraftRequest | null;
  mappingStatus: 'documented-template' | 'pending-parameter-review';
  nextStep: string;
}
export function draftExample(actionId: string): Record<string, unknown> | undefined {
  if (actionId === kosisAction.id) return kosisExample();
  if (actionId === lhAction.id) return lhExample();
  if (actionId === foodsafetyAction.id) return foodsafetyExample();
  if (tourapiActions.some(action => action.id === actionId)) return tourapiExample(actionId);
  if (kopisActions.some(action => action.id === actionId)) return kopisExample(actionId);
  if (actionId === kmaAction.id) return kmaExample();
  if (actionId === airkoreaAction.id) return airkoreaExample();
  if (neisActions.some(action => action.id === actionId)) return neisExample(actionId);
  if (actionId === kobisAction.id) return kobisExample();
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
    ...(action.unavailable?{unavailable:action.unavailable}:{}),
    request: definition.request?.(input) ?? null,
    mappingStatus: definition.request ? 'documented-template' : 'pending-parameter-review',
    nextStep: appApiBacklog.find(c => c.serviceId === action.serviceId)!.nextStep,
  };
}

// Defence in depth: even an accidental implemented=true cannot dispatch a draft.
export const draftExecutor: Executor = async () => {
  throw new ActionError('NOT_IMPLEMENTED', '입력·요청 구조 초안입니다. 공급자 실행기와 실제 계정 검증을 완료해야 합니다.');
};
