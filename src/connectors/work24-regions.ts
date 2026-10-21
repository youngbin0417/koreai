import { z } from 'zod';
import { zodToJsonSchema } from 'zod-to-json-schema';
import { ActionError, type Action } from '../types.js';
import { work24RegionApiDocs } from '../research/work24-reference.js';
import { parseWork24Xml, work24Action, work24XmlExecutor } from './work24.js';

export const work24RegionsEndpoint = 'https://www.work24.go.kr/cm/openApi/call/wk/callOpenApiSvcInfo21L01.do';
export const work24RegionsSchema = z.object({}).strict();
export const work24RegionsAction: Action = {
  ...work24Action, id: 'work24.regions.list', title: '고용24 지역 코드 조회',
  description: '공통코드 이용을 승인받은 본인 키로 지역 코드 전체 응답을 조회합니다. 상위·하위 코드와 공급자 이름을 보존하며 정적 XLS 코드표와 구분합니다. 채용공고 조회와 별도의 행동 허용이 필요합니다.',
  schema: work24RegionsSchema, inputSchema: zodToJsonSchema(work24RegionsSchema, { $refStrategy: 'none' }) as Record<string, unknown>,
  sourceUrl: work24RegionApiDocs,
  resultCheck: 'XML·공급자 오류·5자리 코드·이름·상위 코드 연결·전체 코드 중복·누락·문서 밖 계층·빈 응답을 검증합니다. total의 계층별 집계 범위는 미확인이므로 공급자 total과 수신 건수를 따로 반환합니다.',
};
export function work24RegionsExample() { return {}; }
export function work24RegionsRequestTemplate(input: unknown) {
  work24RegionsSchema.parse(input);
  return { method: 'GET' as const, endpoint: work24RegionsEndpoint,
    query: { returnType: 'XML', target: 'CMCD', dtlGb: '1' },
    authentication: { secretField: 'authKey' as const, queryParameter: 'authKey' }, responseFormat: 'xml' as const };
}

const code = z.string().regex(/^\d{5}$/);
const name = z.string().min(1).max(200).refine(value => !/\p{C}/u.test(value));
const child = z.object({ regionCd: code, regionNm: name, superCd: code }).strict();
const parent = z.object({ regionCd: code, regionNm: name, twoDepth: z.unknown().optional() }).strict();
const envelope = z.object({ total: z.string().regex(/^\d{1,9}$/).transform(Number), codeName: name, oneDepth: z.unknown().optional() }).strict();
const list = (value: unknown) => value === undefined || value === '' ? [] : Array.isArray(value) ? value : [value];
const invalid = () => new ActionError('INVALID_RESPONSE', '고용24 지역 코드의 XML·이름·상위 관계·중복·계층·총건수를 확인하지 못했습니다.');

export function normalizeWork24Regions(raw: string) {
  const parsed = parseWork24Xml(raw);
  if (!parsed || Object.keys(parsed).length !== 1) throw invalid();
  const result = envelope.safeParse(parsed.cmcdRegion);
  if (!result.success) throw invalid();
  const roots = z.array(parent).max(1000).safeParse(list(result.data.oneDepth));
  if (!roots.success) throw invalid();
  const regions: { code: string; name: string; parentCode: string | null; depth: 1 | 2 }[] = [];
  const seen = new Set<string>();
  const add = (row: z.infer<typeof child> | z.infer<typeof parent>, parentCode: string | null) => {
    if (seen.has(row.regionCd) || regions.length >= 1000) throw invalid();
    seen.add(row.regionCd);
    regions.push({ code: row.regionCd, name: row.regionNm, parentCode, depth: parentCode === null ? 1 : 2 });
  };
  for (const root of roots.data) {
    add(root, null);
    const children = z.array(child).max(1000).safeParse(list(root.twoDepth));
    if (!children.success) throw invalid();
    for (const row of children.data) {
      if (row.superCd !== root.regionCd) throw invalid();
      add(row, root.regionCd);
    }
  }
  if ((result.data.total === 0) !== (regions.length === 0)) throw invalid();
  return {
    status: regions.length ? 'available' : 'no_data', codeName: result.data.codeName, regions,
    counts: { providerTotal: result.data.total, returnedCount: regions.length, rootCount: roots.data.length,
      childCount: regions.length - roots.data.length, providerTotalBasis: 'unconfirmed' },
    completenessVerified: false, retrievedAt: new Date().toISOString(),
    dataNote: '고용24 공통코드 API에서 받은 지역 정보입니다. 정적 XLS 코드표를 대체·자동 갱신하지 않습니다. 공급자 total의 계층별 집계 범위와 실제 계정의 전체 코드 일치는 미확인입니다. 이름·상위 관계를 원문대로 보존하며 일반 행정구역 코드나 채용공고 존재 여부로 해석하지 않습니다.',
    source: { name: '고용24 · 고용노동부/한국고용정보원', url: work24RegionApiDocs, attribution: '출처: 고용24 공통코드 Open API · 지역' },
  };
}

export function work24RegionsExecutor(fetcher: typeof fetch = fetch) {
  return work24XmlExecutor(work24RegionsAction, work24RegionsRequestTemplate, normalizeWork24Regions, fetcher);
}
