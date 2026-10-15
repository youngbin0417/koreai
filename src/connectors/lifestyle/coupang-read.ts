import { z } from 'zod';
import { zodToJsonSchema } from 'zod-to-json-schema';
import { ActionError, type Action, type Executor } from '../../types.js';
import type { FirstReadPlan } from './types.js';

const query = z.string().trim().min(1).max(100);
const identifier = z.string().regex(/^\d{1,40}$/).describe('숫자로 된 식별자 원문. JavaScript 숫자로 변환하지 않음.');
export const coupangProductInput = z.object({
  query: query.describe('소비자 상품 검색어. KoreAI 제안 입력이며 공급자 요청 필드는 미확인.'),
  limit: z.number().int().min(1).max(20).default(5),
}).strict();
const productUrl = z.string().url().max(1000).refine(value => {
  try {
    const url = new URL(value);
    return url.protocol === 'https:' && url.hostname === 'www.coupang.com' && !url.username && !url.password && !url.port && /^\/vp\/products\/\d{1,40}\/?$/.test(url.pathname) && !url.hash
      && [...url.searchParams].every(([key, id]) => ['itemId', 'vendorItemId'].includes(key) && /^\d{1,40}$/.test(id) && url.searchParams.getAll(key).length === 1);
  } catch { return false; }
}, '공식 상품 상세 HTTPS 주소와 중복 없는 숫자 itemId/vendorItemId만 허용합니다.').describe('www.coupang.com/vp/products/<숫자 ID>. itemId/vendorItemId만 허용하며 추적·제휴 링크는 별도 규격 확인 전 제외.');
const priceText = z.string().min(1).max(200);
const conditionsText = z.string().min(1).max(500).nullable().describe('와우회원·쿠폰·옵션 등 표시 가격 조건 원문. 혜택 적용 여부 미검증.');
export const coupangPriceProposal = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('listed'), amountKrw: z.number().int().positive().safe(), text: priceText, conditionsText }).strict(),
  z.object({ kind: z.literal('from'), amountKrw: z.number().int().positive().safe(), text: priceText, conditionsText }).strict(),
  z.object({ kind: z.literal('unknown'), amountKrw: z.null(), text: priceText.nullable(), conditionsText }).strict(),
]).describe('화면 표시가·옵션 시작가·미확인 금액의 제안 규격. 결제 확정가가 아니며 미제공 가격을 0원으로 바꾸지 않음.');
/** Proposed consumer contract only; neither Seller Open API nor Partners API is called here. */
export const coupangProductOutput = z.object({
  status: z.enum(['available', 'no_data']).describe('검색 데이터 존재 여부이며 구매 가능 상태가 아님.'), query,
  products: z.array(z.object({
    productId: identifier.nullable(), itemId: identifier.nullable(), vendorItemId: identifier.nullable(),
    title: z.string().min(1).max(200), sourceUrl: productUrl,
    optionText: z.string().max(500).nullable(), price: coupangPriceProposal,
    availabilityText: z.string().max(300).nullable().describe('품절 등 명시된 안내. 재고를 추정하지 않음.'),
    deliveryText: z.string().max(500).nullable().describe('로켓배송 등 표시된 안내. 사용자 주소별 배송·도착일 보장이 아님.'),
    deliveryEligibility: z.literal('not_verified'),
  }).strict().refine(product => {
    try {
      const url = new URL(product.sourceUrl);
      return (product.productId === null || product.productId === url.pathname.split('/')[3])
        && (['itemId', 'vendorItemId'] as const).every(key => product[key] === url.searchParams.get(key));
    } catch { return false; }
  }, '결과의 상품·옵션 식별자와 상세 링크가 일치해야 합니다.')).max(20),
  retrievedAt: z.string().datetime(), providerUpdatedAt: z.string().datetime().nullable(),
}).strict().refine(value => value.status === 'available' ? value.products.length > 0 : value.products.length === 0, '결과 상태와 상품 수가 일치해야 합니다.');

export const coupangProductPlan: FirstReadPlan = {
  actionId: 'coupang.products.search', title: '공개 상품 후보 찾기', state: 'defined', access: 'provider-confirmation-required', checkedAt: '2026-10-15',
  description: '검색어로 공개 상품의 이름·옵션·표시 가격과 조건·배송 안내·공식 상세 링크를 찾는 기능을 정의했습니다. 자동 조회는 아직 지원하지 않습니다.',
  manualUrl: 'https://www.coupang.com/', manualLabel: '공식 상품 직접 확인',
  inputSchema: zodToJsonSchema(coupangProductInput, { $refStrategy: 'none' }) as Record<string, unknown>,
  outputSchema: zodToJsonSchema(coupangProductOutput, { $refStrategy: 'none' }) as Record<string, unknown>,
  example: { query: '생수', limit: 5 },
  accountRequirement: '판매자 API는 WING 계정·발급 키·IP 등록·HMAC 서명이 필요합니다. 파트너스 상품 API는 별도 승인·활동/표시 조건 확인 대상이며 개인 구매내역 권한과 다릅니다. 소비자 조회의 연결 방식 확정 전입니다.',
  resultCheck: '상품·옵션 식별자와 공식 상세 링크·가격 원문/조건·조회 시각을 대조합니다. 로켓배송 표시를 주소별 가능 판정으로 바꾸지 않습니다. 접근 거절은 빈 결과와 구분하고 파트너스 링크의 표시 조건을 확인합니다.',
  nextChecks: [
    '파트너스 상품 API의 최신 세부 규격·최종승인/키 발급·활동 채널·LLM 전달/캐시 조건을 확인',
    '파트너스 경로 채택 시 제휴 링크 형식·경제적 이해관계 표시·가격 재사용 조건에 맞게 결과/화면 규격을 갱신',
    '소비자 제휴 API 또는 전용 브라우저 자동 조회의 허용 범위를 확인하고 판매자 키로 우회하지 않음',
    '허용된 환경에서 상품/옵션 식별·회원/쿠폰 가격·품절·빈 결과·인증 만료·한도/접근 거절 검증 후 활성화',
  ],
};
export const coupangProductAction: Action = {
  id: coupangProductPlan.actionId, serviceId: 'coupang', connectorId: 'coupang-read-plan', title: '쿠팡 공개 상품 후보 찾기 · 초안',
  description: `${coupangProductPlan.description} 입력·출력은 KoreAI 제안이며 공급자 API 명세가 아닙니다.`,
  category: '쇼핑·중고', effect: 'read', method: 'partnership', schema: coupangProductInput, inputSchema: coupangProductPlan.inputSchema,
  requiredSecrets: [], scopes: [], sourceUrl: coupangProductPlan.manualUrl, checkedAt: coupangProductPlan.checkedAt,
  verification: 'documented', resultCheck: coupangProductPlan.resultCheck, domains: ['www.coupang.com'], version: '0.1.0-draft.1', maintainer: 'KoreAI', origin: 'bundled', implemented: false,
};
export const coupangReadPlanExecutor: Executor = async () => {
  throw new ActionError('NOT_IMPLEMENTED', '쿠팡 상품 검색은 기능 정의 단계입니다. 소비자 조회의 허용 범위와 공급자 규격을 확인한 뒤 구현해야 합니다.');
};
