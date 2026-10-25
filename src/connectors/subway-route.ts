import { z } from 'zod';
import { zodToJsonSchema } from 'zod-to-json-schema';
import { XMLParser, XMLValidator } from 'fast-xml-parser';
import { ActionError, type Action, type Executor } from '../types.js';
import { subwayRouteDocs } from '../research/seoul-subway.js';

const station = z.string().trim().min(1).max(50).refine(value => !/[\p{C},/\\?#%]/u.test(value), '공식 역 이름 한 개를 입력하세요.');
export const subwayRouteSchema = z.object({
  origin: station, destination: station,
  preference: z.enum(['duration', 'distance', 'transfer']).default('duration'),
  at: z.string().datetime({ offset: true }).optional(),
  includeTimetable: z.boolean().default(false),
}).strict().refine(value => value.origin !== value.destination, '출발역과 도착역을 다르게 입력하세요.');
export const subwayRouteAction: Action = {
  id: 'seoul-subway.route', serviceId: 'seoul-subway', connectorId: 'seoul-metro-route-api',
  title: '서울 지하철 경로·환승 조회', category: '지도·교통', effect: 'read', method: 'api',
  description: '서울교통공사의 최소시간·최단거리·최소환승 경로를 HTTPS로 조회합니다. 구간별 역·지선·거리·시간·환승 원문을 보존합니다. 실시간 운행 보장이 아니며 별도 공공데이터포털 활용신청 키가 필요합니다.',
  schema: subwayRouteSchema, inputSchema: zodToJsonSchema(subwayRouteSchema, { $refStrategy: 'none' }) as Record<string, unknown>,
  credentialType: 'seoul-subway-route-api', requiredSecrets: ['serviceKey'], scopes: [],
  sourceUrl: subwayRouteDocs, checkedAt: '2026-10-25', verification: 'documented',
  resultCheck: '정상 코드·구조·검색 유형·시간표 포함 조건·출발/도착 역명·구간 코드 연속성·거리/시간 단위를 검사합니다. 공급자 환승 표시를 보존하며 목록 순서로 자체 그래프를 만들지 않습니다.',
  domains: ['apis.data.go.kr'], version: '0.1.0', maintainer: 'KoreAI', origin: 'bundled', implemented: true, resultTtlMs: 60_000,
};
export const subwayRouteExample = () => ({ origin: '신도림', destination: '서울역', preference: 'duration', includeTimetable: false });
const seoulParts = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Seoul', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23' });
export function subwayRouteRequestTemplate(raw: unknown, now = new Date()) {
  const input = subwayRouteSchema.parse(raw), date = input.at ? new Date(input.at) : now;
  const p = Object.fromEntries(seoulParts.formatToParts(date).map(part => [part.type, part.value]));
  return { method: 'GET' as const, endpoint: 'https://apis.data.go.kr/B553766/path2/getShtrmPath2',
    query: { dataType: 'JSON', dptreStn: input.origin, arvlStn: input.destination, searchDt: `${p.year}-${p.month}-${p.day} ${p.hour}:${p.minute}:${p.second}`, searchType: input.preference, schInclYn: input.includeTimetable ? 'Y' : 'N', stationValueType: 'name' },
    authentication: { secretField: 'serviceKey' as const, queryParameter: 'serviceKey' }, responseFormat: 'json' as const };
}
const invalid = () => new ActionError('INVALID_RESPONSE', '경로 응답의 구조·출발/도착·구간 연결·조회 조건이 유효하지 않습니다.');
const text = z.string().min(1).max(200).refine(value => !/\p{C}/u.test(value));
const optional = z.string().max(200).nullish().transform(value => value || null);
const integer = z.union([z.number().int().nonnegative().safe(), z.string().regex(/^\d{1,10}$/).transform(Number)]);
const stationRow = z.object({ stnNm: text, lineNm: text, brlnNm: optional, stnCd: text, stnNo: optional });
const segmentRow = z.object({ dptreStn: stationRow, arvlStn: stationRow, stnSctnDstc: integer, reqHr: integer,
  trsitYn: z.string().min(1).max(20), tmnlStnCd: optional, tmnlStnNm: optional, upbdnbSe: optional,
  trainDptreTm: optional, trainArvlTm: optional, trainno: optional, nonstopYn: optional, etrnYn: optional, wtngHr: integer.nullish() });
const bodySchema = z.object({ paths: z.array(segmentRow).max(1000), schInclYn: z.enum(['Y', 'N']), searchType: z.enum(['duration', 'distance', 'transfer']),
  totalDstc: integer, totalReqHr: integer, totalCardCrg: integer, trsitNmtm: integer,
  trfstnNms: z.array(z.object({ stnNm: text, dptreLineNm: text, arvlLineNm: text })).max(100) });
function failCode(code: string, gateway: boolean) {
  if (['20', '21', '30', '31', '32'].includes(code) && gateway) throw new ActionError('AUTH_REQUIRED', '공공데이터포털 경로 API 활용신청·승인과 일반 인증키(Decoding)를 확인하세요.', 'awaiting_auth');
  if (['22', '23'].includes(code) && gateway) throw new ActionError('PROVIDER_RATE_LIMIT', '경로 API 호출 한도를 초과했습니다.');
  if (['01', '02', '10', '11', '12', '13', '20', '21'].includes(code) && !gateway) throw new ActionError('PROVIDER_INVALID_INPUT', '경로 공급자가 조회 조건을 거절했습니다. 역 이름·기준 시각을 확인하세요.');
  throw new ActionError('PROVIDER_ERROR', '경로 공급자가 정상 결과를 반환하지 않았습니다.');
}
function decode(raw: string) {
  if (raw.length > 2_000_000) throw new ActionError('RESULT_TOO_LARGE', '경로 응답이 너무 큽니다.');
  let p: any;
  try { p = JSON.parse(raw); } catch {
    if (/<!DOCTYPE|<!ENTITY/i.test(raw) || XMLValidator.validate(raw) !== true) throw invalid();
    try { p = new XMLParser({ parseTagValue: false, ignoreAttributes: true, ignoreDeclaration: true, processEntities: false }).parse(raw); } catch { throw invalid(); }
  }
  const gateway = p?.OpenAPI_ServiceResponse?.cmmMsgHeader;
  if (gateway) { const code = String(gateway.returnReasonCode ?? '').padStart(2, '0'); if (!/^\d{2}$/.test(code)) throw invalid(); failCode(code, true); }
  const response = p?.response ?? p;
  const header = z.object({ resultCode: z.union([z.number().int().min(0).max(99), z.string().regex(/^\d{1,2}$/)]) }).safeParse(response?.header);
  if (!header.success) throw invalid();
  const code = String(header.data.resultCode).padStart(2, '0'); if (code !== '00') failCode(code, false);
  const body = bodySchema.safeParse(response?.body); if (!body.success) throw invalid(); return body.data;
}
export function normalizeSubwayRoute(raw: string, value: unknown, now = new Date()) {
  const input = subwayRouteSchema.parse(value), body = decode(raw), rows = body.paths;
  if (body.searchType !== input.preference || body.schInclYn !== (input.includeTimetable ? 'Y' : 'N')) throw invalid();
  if (rows.length) {
    if (rows[0]!.dptreStn.stnNm !== input.origin || rows.at(-1)!.arvlStn.stnNm !== input.destination) throw invalid();
    for (let i = 1; i < rows.length; i++) {
      const previous = rows[i - 1]!.arvlStn, next = rows[i]!.dptreStn;
      // A different platform code needs an explicit provider segment; never invent a transfer from a shared name.
      if (previous.stnCd !== next.stnCd || previous.stnNm !== next.stnNm || previous.lineNm !== next.lineNm) throw invalid();
    }
  } else if (body.totalDstc || body.totalReqHr || body.trsitNmtm || body.trfstnNms.length) throw invalid();
  const station = (row: z.infer<typeof stationRow>) => ({ name: row.stnNm, line: row.lineNm, branch: row.brlnNm, code: row.stnCd, number: row.stnNo });
  return { kind: subwayRouteAction.id, status: rows.length ? 'available' : 'no_data', query: input, timezone: 'Asia/Seoul',
    searchAt: input.at ?? now.toISOString(), retrievedAt: now.toISOString(), providerObservedAt: null,
    summary: rows.length ? { distanceMeters: body.totalDstc, durationSeconds: body.totalReqHr, cardFareWon: body.totalCardCrg, transferCount: body.trsitNmtm } : null,
    segments: rows.map((row, index) => ({ index: index + 1, from: station(row.dptreStn), to: station(row.arvlStn), distanceMeters: row.stnSctnDstc, durationSeconds: row.reqHr,
      transferRaw: row.trsitYn, directionRaw: row.upbdnbSe, terminalName: row.tmnlStnNm, terminalCode: row.tmnlStnCd,
      departureRaw: row.trainDptreTm, arrivalRaw: row.trainArvlTm, trainNumber: row.trainno, nonstopRaw: row.nonstopYn, expressRaw: row.etrnYn, waitingSeconds: row.wtngHr ?? null })),
    transfers: body.trfstnNms.map(row => ({ stationName: row.stnNm, fromLine: row.dptreLineNm, toLine: row.arvlLineNm })),
    source: { name: '서울교통공사 · 최단경로이동정보', url: subwayRouteDocs, license: '이용허락범위 제한 없음', checkedAt: '2026-10-25' },
    dataNote: '공급자가 지정 기준 시각으로 계산한 경로입니다. 실시간 지연·운행·환승 가능·실제 결제액을 보장하지 않습니다. 시간표와 환승/급행/무정차 표시는 원문이며 관측 시각은 미제공입니다. 빈 경로는 운행 종료를 뜻하지 않습니다. 역 코드로 다른 서비스를 자동 조회하지 않습니다.' };
}
async function read(response: Response) {
  const reader = response.body?.getReader(); if (!reader) throw invalid();
  const decoder = new TextDecoder('utf-8', { fatal: true }); let raw = '', size = 0;
  try { for (;;) { const part = await reader.read(); if (part.done) break; size += part.value.byteLength;
    if (size > 2_000_000) throw new ActionError('RESULT_TOO_LARGE', '경로 응답이 너무 큽니다.'); raw += decoder.decode(part.value, { stream: true }); } return raw + decoder.decode();
  } catch (error) { try { await reader.cancel(); } catch {} if (error instanceof TypeError) throw invalid(); throw error; } finally { reader.releaseLock(); }
}
export function subwayRouteExecutor(fetcher: typeof fetch = fetch): Executor { return async (action, context) => {
  if (action.id !== subwayRouteAction.id) throw new ActionError('NOT_IMPLEMENTED', '등록되지 않은 경로 조회입니다.');
  const input = subwayRouteSchema.parse(context.job.input), key = context.secrets.serviceKey?.trim();
  if (context.signal.aborted) throw new ActionError('CANCELLED', '취소된 작업입니다.', 'cancelled');
  if (!key || key.length > 512 || /[^\x21-\x7e]|%[\da-f]{2}/i.test(key)) throw new ActionError('AUTH_REQUIRED', '경로 API의 일반 인증키(Decoding)를 등록하세요.', 'awaiting_auth');
  const started = new Date(), resolved = { ...input, at: input.at ?? started.toISOString() }, template = subwayRouteRequestTemplate(resolved), url = new URL(template.endpoint);
  for (const [name, value] of Object.entries(template.query)) url.searchParams.set(name, value); url.searchParams.set('serviceKey', key);
  const signal = AbortSignal.any([context.signal, AbortSignal.timeout(30_000)]);
  try {
    context.dispatch(); const response = await fetcher(url, { method: 'GET', headers: { Accept: 'application/json' }, redirect: 'error', cache: 'no-store', signal });
    if ([401, 403].includes(response.status)) throw new ActionError('AUTH_REQUIRED', '경로 API 키·활용신청 승인을 확인하세요.', 'awaiting_auth');
    if (response.status === 429) throw new ActionError('PROVIDER_RATE_LIMIT', '경로 API 호출 한도를 초과했습니다.');
    if (!response.ok) throw new ActionError('PROVIDER_HTTP_' + response.status, '경로 API의 정상 응답을 확인하지 못했습니다.');
    const data = normalizeSubwayRoute(await read(response), resolved, new Date());
    if (context.signal.aborted) throw new ActionError('CANCELLED', '취소된 작업입니다.', 'cancelled');
    return { data, evidence: subwayRouteAction.resultCheck };
  } catch (error) {
    if (context.signal.aborted) throw new ActionError('CANCELLED', '취소된 작업입니다.', 'cancelled');
    if (error instanceof ActionError) throw error;
    if (signal.aborted || error instanceof Error && error.name === 'TimeoutError') throw new ActionError('PROVIDER_TIMEOUT', '경로 API 응답 시간이 초과됐습니다.');
    throw new ActionError('PROVIDER_UNAVAILABLE', '경로 API 연결·응답을 확인하지 못했습니다.');
  }
}; }
