import { z } from 'zod';
import { zodToJsonSchema } from 'zod-to-json-schema';
import { ActionError, type Action, type Executor } from '../types.js';

const docs = 'https://chzzk.gitbook.io/chzzk/chzzk-api/';
const channelId = z.string().regex(/^[A-Za-z0-9_-]{1,128}$/);
const cursor = z.string().min(1).max(4096).refine(value => !/[\x00-\x1f\x7f]/.test(value));
export const chzzkLivesSchema = z.object({ size: z.number().int().min(1).max(20).default(20), next: cursor.optional() }).strict();
export const chzzkChannelsSchema = z.object({ channelIds: z.array(channelId).min(1).max(20).refine(ids => new Set(ids).size === ids.length, '중복 없는 채널 ID를 입력하세요.') }).strict();
const common = { serviceId: 'chzzk', connectorId: 'chzzk-client-api', category: '검색·콘텐츠', effect: 'read', method: 'api', credentialType: 'chzzk-client',
  requiredSecrets: ['clientId', 'clientSecret'], scopes: [], checkedAt: '2026-10-19', verification: 'documented', domains: ['openapi.chzzk.naver.com'], version: '0.1.0', maintainer: 'KoreAI', origin: 'bundled', implemented: true } as const;
export const chzzkLivesAction: Action = { ...common, requiredSecrets: [...common.requiredSecrets], scopes: [], domains: [...common.domains], id: 'chzzk.lives.list', title: '치지직 라이브 목록 조회',
  description: '공식 Client 인증으로 현재 라이브 목록의 한 페이지를 조회합니다. 최대 20개이며 다음 커서는 후속 요청에 사용합니다. 채팅·후원·방송 설정은 포함하지 않습니다.',
  schema: chzzkLivesSchema, inputSchema: zodToJsonSchema(chzzkLivesSchema, { $refStrategy: 'none' }) as Record<string, unknown>, sourceUrl: `${docs}live`,
  resultCheck: '정상 코드·최대 결과 수·라이브 ID 중복·시청자 수·커서를 검증하고 조회 시각과 시작 시각 원문을 구분합니다.' };
export const chzzkChannelsAction: Action = { ...common, requiredSecrets: [...common.requiredSecrets], scopes: [], domains: [...common.domains], id: 'chzzk.channels.get', title: '치지직 채널 정보 조회',
  description: 'Client 인증으로 최대 20개 채널 ID의 공개 이름·팔로워 수·인증 마크를 조회합니다. 미반환 ID를 구분하며 사용자 팔로우·구독자 개인정보는 조회하지 않습니다.',
  schema: chzzkChannelsSchema, inputSchema: zodToJsonSchema(chzzkChannelsSchema, { $refStrategy: 'none' }) as Record<string, unknown>, sourceUrl: `${docs}channel`,
  resultCheck: '반환된 채널 ID가 요청 집합에 속하고 중복이 없는지 검사합니다. 미반환 ID를 삭제된 채널로 단정하지 않습니다.' };
export const chzzkActions = [chzzkLivesAction, chzzkChannelsAction];
export function chzzkExample(id: string) { return id === chzzkLivesAction.id ? { size: 20 } : { channelIds: ['00000000000000000000000000000000'] }; }
export function chzzkRequestTemplate(id: string, raw: unknown) {
  let query: Record<string, string | number | string[]>;
  if (id === chzzkLivesAction.id) { const input = chzzkLivesSchema.parse(raw); query = { size: input.size, ...(input.next ? { next: input.next } : {}) }; }
  else if (id === chzzkChannelsAction.id) query = chzzkChannelsSchema.parse(raw);
  else throw new ActionError('NOT_IMPLEMENTED', '치지직 실행기에 등록되지 않은 행동입니다.');
  return { method: 'GET' as const, endpoint: `https://openapi.chzzk.naver.com/open/v1/${id === chzzkLivesAction.id ? 'lives' : 'channels'}`, query,
    authentication: { headers: { 'Client-Id': { secretField: 'clientId' }, 'Client-Secret': { secretField: 'clientSecret' } } }, responseFormat: 'json' as const };
}
const invalid = () => new ActionError('INVALID_RESPONSE', '치지직 응답 형식·요청 범위·식별자 또는 숫자가 유효하지 않습니다.');
const count = z.number().int().nonnegative().safe();
const baseRow = { channelId, channelName: z.string().min(1).max(300) };
const liveRow = z.object({ ...baseRow, liveId: count.refine(n => n > 0), liveTitle: z.string().min(1).max(1000), concurrentUserCount: count,
  openDate: z.string().min(1).max(80), adult: z.boolean(), tags: z.array(z.string().max(100)).max(100),
  categoryType: z.string().max(40).nullable().optional(), liveCategory: z.string().max(300).nullable().optional(), liveCategoryValue: z.string().max(300).nullable().optional() });
const channelRow = z.object({ ...baseRow, followerCount: count, verifiedMark: z.boolean() });
function providerError(code: number): never {
  if ([401, 403].includes(code)) throw new ActionError('AUTH_REQUIRED', '치지직 개발자 앱의 Client ID·Secret과 API 권한을 확인한 뒤 재개하세요.', 'awaiting_auth');
  if (code === 429) throw new ActionError('PROVIDER_RATE_LIMIT', '치지직 호출 한도를 초과했습니다. 한도를 확인한 뒤 다시 요청하세요.');
  throw new ActionError(`PROVIDER_${code}`, '치지직 API가 요청을 거절했습니다. 입력·권한·서비스 상태를 확인하세요.');
}
function normalize(raw: string, action: Action, input: Record<string, any>) {
  let value: unknown; try { value = JSON.parse(raw); } catch { throw invalid(); }
  const envelope = z.object({ code: z.number().int().min(100).max(599), content: z.unknown().optional() }).safeParse(value);
  if (!envelope.success) throw invalid();
  if (envelope.data.code !== 200) providerError(envelope.data.code);
  let data: Record<string, unknown>;
  if (action.id === chzzkLivesAction.id) {
    const parsed = z.object({ data: z.array(liveRow).max(20), page: z.object({ next: z.union([cursor, z.literal(''), z.null()]).optional() }).optional() }).safeParse(envelope.data.content);
    if (!parsed.success) throw invalid();
    const body = parsed.data, next = body.page?.next || null;
    if (body.data.length > input.size || new Set(body.data.map(row => row.liveId)).size !== body.data.length || next && next === input.next) throw invalid();
    data = { lives: body.data.map(row => ({ liveId: row.liveId, title: row.liveTitle, channelId: row.channelId, channelName: row.channelName, concurrentViewers: row.concurrentUserCount,
      openedAtRaw: row.openDate, adult: row.adult, tags: row.tags, category: { type: row.categoryType ?? null, id: row.liveCategory ?? null, name: row.liveCategoryValue ?? null } })),
      returnedCount: body.data.length, pagination: { size: input.size, next, hasMore: body.page ? next !== null : null },
      dataNote: '시청자 수는 조회 시점의 제공값입니다. 시작 시각은 공급자 원문이며 시간대를 추정하지 않습니다. 목록은 현재 페이지이며 전체 방송 수·개별 채널의 오프라인 여부를 확정하지 않습니다.' };
  } else {
    const parsed = z.object({ data: z.array(channelRow).max(20) }).safeParse(envelope.data.content);
    if (!parsed.success) throw invalid();
    const rows = parsed.data.data, requested = input.channelIds as string[], returned = new Set(rows.map(row => row.channelId));
    if (rows.length > requested.length || returned.size !== rows.length || rows.some(row => !requested.includes(row.channelId))) throw invalid();
    data = { channels: rows.map(row => ({ channelId: row.channelId, name: row.channelName, followers: row.followerCount, verified: row.verifiedMark })), returnedCount: rows.length,
      requestedChannelIds: requested, notReturnedChannelIds: requested.filter(id => !returned.has(id)), dataNote: '채널 ID로 조회한 공개 정보입니다. 미반환 ID가 삭제됐다고 단정하지 않습니다. 사용자별 팔로우·구독 목록은 포함하지 않습니다.' };
  }
  return { status: data.returnedCount ? 'available' : 'no_data', ...data, retrievedAt: new Date().toISOString(), providerUpdatedAt: null, timezone: 'Asia/Seoul', source: { name: 'NAVER CHZZK', url: action.sourceUrl } };
}
async function readBody(response: Response) {
  const reader = response.body?.getReader(); if (!reader) throw invalid();
  const decoder = new TextDecoder(); let raw = '', bytes = 0;
  try {
    for (;;) { const part = await reader.read(); if (part.done) break; bytes += part.value.byteLength;
      if (bytes > 2_000_000) { await reader.cancel(); throw new ActionError('RESULT_TOO_LARGE', '치지직 응답이 너무 큽니다.'); }
      raw += decoder.decode(part.value, { stream: true }); }
    return raw + decoder.decode();
  } finally { reader.releaseLock(); }
}
export function chzzkExecutor(fetcher: typeof fetch = fetch): Executor {
  return async (action, context) => {
    if (!chzzkActions.some(item => item.id === action.id)) throw new ActionError('NOT_IMPLEMENTED', '치지직 실행기에 등록되지 않은 행동입니다.');
    const input = action.schema.parse(context.job.input), template = chzzkRequestTemplate(action.id, input);
    if (context.signal.aborted) throw new ActionError('CANCELLED', '작업이 취소됐습니다.', 'cancelled');
    const clientId = context.secrets.clientId?.trim(), clientSecret = context.secrets.clientSecret?.trim();
    if (!clientId || !clientSecret || [clientId, clientSecret].some(value => value.length > 4096 || /[^\x21-\x7e]/.test(value))) throw new ActionError('AUTH_REQUIRED', '치지직 개발자센터에서 발급한 본인 Client ID와 Client Secret을 등록하세요.', 'awaiting_auth');
    const url = new URL(template.endpoint);
    for (const [name, value] of Object.entries(template.query)) for (const item of Array.isArray(value) ? value : [value]) url.searchParams.append(name, String(item));
    const signal = AbortSignal.any([context.signal, AbortSignal.timeout(30_000)]); context.dispatch();
    try {
      const response = await fetcher(url, { method: 'GET', headers: { Accept: 'application/json', 'Content-Type': 'application/json', 'Client-Id': clientId, 'Client-Secret': clientSecret }, redirect: 'error', signal });
      if (!response.ok) providerError(response.status);
      const data = normalize(await readBody(response), action, input);
      if (context.signal.aborted) throw new ActionError('CANCELLED', '작업이 취소됐습니다.', 'cancelled');
      return { data, evidence: action.resultCheck };
    } catch (error) {
      if (context.signal.aborted) throw new ActionError('CANCELLED', '작업이 취소됐습니다.', 'cancelled');
      if (error instanceof ActionError) throw error;
      if (signal.aborted || error instanceof Error && error.name === 'TimeoutError') throw new ActionError('PROVIDER_TIMEOUT', '치지직 응답 시간이 초과됐습니다.');
      throw new ActionError('PROVIDER_CONNECTION_ERROR', '치지직 API에 연결하지 못했습니다. 네트워크와 서비스 상태를 확인하세요.');
    }
  };
}
