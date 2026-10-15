import { z } from 'zod';
import { zodToJsonSchema } from 'zod-to-json-schema';
import { ActionError, type Action, type Executor } from '../../types.js';
import type { FirstReadPlan } from './types.js';

const query = z.string().trim().min(1).max(100);
const region = z.string().trim().min(1).max(80);
export const daangnItemInput = z.object({
  query: query.describe('중고 물품 검색어. KoreAI 제안 입력이며 공급자 요청 필드는 미확인.'),
  region: region.describe('사용자가 명시한 동네 이름. 계정의 인증 동네·현재 위치로 간주하지 않음.'),
  limit: z.number().int().min(1).max(20).default(5),
}).strict();
const itemUrl = z.string().url().max(1000).refine(value => {
  try {
    const url = new URL(value);
    return url.protocol === 'https:' && url.hostname === 'www.daangn.com' && !url.username && !url.password && !url.port && /^\/kr\/buy-sell\/[^/?#]+\/?$/.test(url.pathname) && !url.search && !url.hash;
  } catch { return false; }
}, '공식 중고거래 상세 페이지의 HTTPS 주소가 필요합니다.').describe('www.daangn.com의 /kr/buy-sell/<상세 경로> HTTPS 주소. 쿼리·인증정보를 허용하지 않는 KoreAI 제안 규칙.');
const priceText = z.string().min(1).max(100);
export const daangnPriceProposal = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('amount'), amountKrw: z.number().int().nonnegative().safe(), text: priceText }).strict(),
  z.object({ kind: z.literal('free'), amountKrw: z.literal(0), text: priceText }).strict(),
  z.object({ kind: z.literal('negotiable'), amountKrw: z.null(), text: priceText }).strict(),
  z.object({ kind: z.literal('unknown'), amountKrw: z.null(), text: priceText.nullable() }).strict(),
]);
/** Proposed result contract only; no real listing is collected or normalized here. */
export const daangnItemOutput = z.object({
  status: z.enum(['available', 'no_data']), query, region,
  items: z.array(z.object({
    providerId: z.string().min(1).max(100).nullable(), title: z.string().min(1).max(200), neighborhoodText: z.string().max(300).nullable(),
    price: daangnPriceProposal, transactionStatus: z.enum(['for_sale', 'reserved', 'sold', 'unknown']), transactionStatusText: z.string().max(100).nullable(), sourceUrl: itemUrl,
  }).strict()).max(20),
  retrievedAt: z.string().datetime(), providerUpdatedAt: z.string().datetime().nullable(),
}).strict().refine(value => value.status === 'available' ? value.items.length > 0 : value.items.length === 0, '결과 상태와 물품 수가 일치해야 합니다.');

export const daangnItemPlan: FirstReadPlan = {
  actionId: 'daangn.items.search', title: '동네 중고 물품 후보 찾기', state: 'defined', access: 'provider-confirmation-required', checkedAt: '2026-10-15',
  description: '검색어·동네로 공개 물품의 제목·가격 원문·표시된 거래 상태·공식 상세 링크를 찾는 기능을 정의했습니다. 자동 조회는 아직 지원하지 않습니다.',
  manualUrl: 'https://www.daangn.com/kr/buy-sell/', manualLabel: '중고거래 목록 직접 확인',
  inputSchema: zodToJsonSchema(daangnItemInput, { $refStrategy: 'none' }) as Record<string, unknown>,
  outputSchema: zodToJsonSchema(daangnItemOutput, { $refStrategy: 'none' }) as Record<string, unknown>,
  example: { query: '자전거', region: '서울특별시 강남구 역삼동', limit: 5 },
  accountRequirement: '소비자 검색 API·자동 접근 조건 확인 대기. 로그인·동네 인증은 사용자가 직접 수행하며 광고 API/MCP 인증을 개인 거래·채팅 권한으로 사용하지 않습니다.',
  resultCheck: '실제 검색 동네·필터 적용·공식 상세 링크·중복 식별자·가격 원문·거래 상태를 대조합니다. 가격 미제공을 0원/나눔으로 바꾸지 않고 로그인/동네 인증 필요·접근 거절을 빈 결과와 구분합니다.',
  nextChecks: [
    '공급자에게 소비자 공개 중고거래 검색 API/제휴 또는 전용 브라우저 자동 조회 허용 여부를 확인',
    '검색 동네 지정·인증 조건·제공 필드·거래 상태·가격 표기·페이지/한도·보관/LLM 전달 범위를 확인',
    '허용된 환경에서 동명 동네·검색 범위·나눔/가격 미제공·예약/판매완료·로그인/동네 인증 만료를 검증',
    '광고 MCP는 광고주 계정용 후속 연동으로 관리하고 OAuth·도구 목록·계정별 권한을 별도 검증',
  ],
};
export const daangnItemAction: Action = {
  id: daangnItemPlan.actionId, serviceId: 'daangn', connectorId: 'daangn-read-plan', title: '당근 동네 중고 물품 후보 찾기 · 초안',
  description: `${daangnItemPlan.description} 입력·출력은 KoreAI 제안이며 공급자 API 명세가 아닙니다.`,
  category: '쇼핑·중고', effect: 'read', method: 'partnership', schema: daangnItemInput, inputSchema: daangnItemPlan.inputSchema,
  requiredSecrets: [], scopes: [], sourceUrl: 'https://about.daangn.com/service/', checkedAt: daangnItemPlan.checkedAt,
  verification: 'documented', resultCheck: daangnItemPlan.resultCheck, domains: ['www.daangn.com'], version: '0.1.0-draft.1', maintainer: 'KoreAI', origin: 'bundled', implemented: false,
};
export const daangnReadPlanExecutor: Executor = async () => {
  throw new ActionError('NOT_IMPLEMENTED', '당근 중고 물품 검색은 기능 정의 단계입니다. 소비자 조회의 허용 범위와 공급자 규격을 확인한 뒤 구현해야 합니다.');
};
