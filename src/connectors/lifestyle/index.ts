import { z } from 'zod';
import { zodToJsonSchema } from 'zod-to-json-schema';
import { Store } from '../../core/store.js';
import { ActionError, type Action, type Executor } from '../../types.js';
import { gangnamunni } from './gangnamunni.js';
import { daangn } from './daangn.js';
import { kurly } from './kurly.js';
import { coupang } from './coupang.js';
import { toss } from './toss.js';
import { tlocker } from './tlocker.js';
import { seoulSubway } from './seoul-subway.js';
import type { BasicConnection, ConnectionDefinition, ConnectionProfile } from './types.js';

export const connectionDefinitions: readonly ConnectionDefinition[] = [gangnamunni, daangn, kurly, coupang, toss, seoulSubway, tlocker];
const schema = z.object({}).strict();
const profileSchema = z.object({ routeId: z.string().min(1).max(64) }).strict();
const stages: BasicConnection['stages'] = [
  { id: 'base', title: '기본 연결·진입 경로', state: 'available' },
  { id: 'read', title: '조회 기능 정의·검증', state: 'planned' },
  { id: 'draft', title: '초안·사용자 확인', state: 'planned' },
  { id: 'write', title: '승인 후 실행·결과 확인', state: 'planned' },
];

/** Foundation only: fixed entry links and local preparation. Provider actions are added separately. */
export class LifestyleConnections {
  readonly actions: Action[];
  constructor(private readonly store: Store) {
    for (const definition of connectionDefinitions) {
      for (const route of definition.routes) {
        const url = new URL(route.url);
        if (url.protocol !== 'https:' || url.username || url.password || !definition.domains.includes(url.hostname)) throw new Error(`허용되지 않은 기본 연결 경로: ${definition.serviceId}`);
      }
    }
    this.actions = connectionDefinitions.flatMap(d => (['status', 'open'] as const).map(kind => ({
      id: `${d.serviceId}.connection.${kind}`, serviceId: d.serviceId, connectorId: `${d.serviceId}-base`,
      title: `${d.name} ${kind === 'status' ? '연결 상태 조회' : '서비스 열기 안내'}`,
      description: kind === 'status' ? '로컬 연결 준비 상태·공식 진입 경로·후속 개발 단계를 조회합니다. 로그인 성공을 검증하는 기능은 아닙니다.' : '관리 화면에서 선택한 고정 경로를 반환합니다. 사용자가 링크를 열어 직접 진행하며 외부 서비스 자동 실행은 수행하지 않습니다.',
      category: '기본 연결', effect: 'read' as const, method: 'handoff' as const, schema,
      inputSchema: zodToJsonSchema(schema, { $refStrategy: 'none' }) as Record<string, unknown>,
      requiredSecrets: [], scopes: [], sourceUrl: d.sources[0].url, checkedAt: d.sources[0].checkedAt,
      verification: 'documented' as const, resultCheck: '로컬 준비 상태와 등록된 고정 진입 경로 일치; 외부 서비스 실행·계정 검증 아님',
      domains: d.domains, version: d.version, maintainer: 'KoreAI', origin: 'bundled' as const, implemented: true,
    })));
  }
  private definition(serviceId: string) {
    const definition = connectionDefinitions.find(d => d.serviceId === serviceId);
    if (!definition) throw new ActionError('NOT_FOUND', '기본 연결을 제공하지 않는 서비스입니다.');
    return definition;
  }
  describe(serviceId: string): BasicConnection {
    const definition = this.definition(serviceId);
    const profile = this.store.get<ConnectionProfile>('connection-profile', serviceId) ?? null;
    return { ...definition, profile, state: profile ? 'prepared' : 'unprepared', accountVerified: false, automaticActions: 0,
      stages: stages.map(stage => stage.id === 'read' && definition.firstRead ? { ...stage, title: '첫 조회 기능 정의·접근 조건 확인', state: 'defined' } : stage) };
  }
  list(): BasicConnection[] { return connectionDefinitions.map(d => this.describe(d.serviceId)); }
  prepare(serviceId: string, input: unknown): BasicConnection {
    const definition = this.definition(serviceId);
    const { routeId } = profileSchema.parse(input);
    if (!definition.routes.some(r => r.id === routeId)) throw new ActionError('INVALID_ROUTE', '이 서비스에 등록되지 않은 연결 경로입니다.');
    const previous = this.store.get<ConnectionProfile>('connection-profile', serviceId);
    const now = new Date().toISOString();
    this.store.put('connection-profile', serviceId, { serviceId, routeId, preparedAt: previous?.preparedAt ?? now, updatedAt: now } satisfies ConnectionProfile);
    return this.describe(serviceId);
  }
  remove(serviceId: string) { this.definition(serviceId); this.store.delete('connection-profile', serviceId); }
  execute: Executor = async (action, context) => {
    if (!this.actions.some(registered => registered.id === action.id && registered.serviceId === action.serviceId)) throw new ActionError('NOT_IMPLEMENTED', '기본 연결 실행기에 등록되지 않은 행동입니다.');
    const connection = this.describe(action.serviceId);
    if (action.id.endsWith('.status')) return { data: connection, evidence: '로컬 기본 연결 정보 조회; 외부 서비스 검증 아님' };
    if (!connection.profile) throw new ActionError('CONNECTION_NOT_PREPARED', '관리 화면의 기본 서비스 연결에서 진입 경로를 선택하고 연결 준비를 저장하세요.', 'awaiting_user');
    const route = connection.routes.find(r => r.id === connection.profile!.routeId);
    if (!route) throw new ActionError('CONNECTION_ROUTE_CHANGED', '연결 경로가 변경됐습니다. 관리 화면에서 다시 선택하세요.', 'awaiting_user');
    if (context.signal.aborted) throw new ActionError('CANCELLED', '취소된 작업입니다.', 'cancelled');
    return { data: { serviceId: connection.serviceId, name: connection.name, url: route.url, route, requiresUser: true,
      externalActionExecuted: false, accountVerified: false, instructions: route.description, boundary: connection.boundary },
      evidence: '고정된 사용자 진입 링크 제공; 로그인·외부 실행 확인 아님' };
  };
}
