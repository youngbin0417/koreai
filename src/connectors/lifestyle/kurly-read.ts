import { z } from 'zod';
import { zodToJsonSchema } from 'zod-to-json-schema';
import { ActionError, type Action, type Executor } from '../../types.js';
import type { FirstReadPlan } from './types.js';

const query = z.string().trim().min(1).max(100);
export const kurlyProductInput = z.object({
  query: query.describe('상품 검색어. KoreAI 제안 입력이며 공급자 요청 필드는 미확인.'),
  limit: z.number().int().min(1).max(20).default(5),
}).strict();
const productUrl = z.string().url().max(1000).refine(value => {
  try {
    const url = new URL(value);
    return url.protocol === 'https:' && url.hostname === 'www.kurly.com' && !url.username && !url.password && !url.port && /^\/goods\/\d+\/?$/.test(url.pathname) && !url.search && !url.hash;
  } catch { return false; }
}, '공식 상품 상세 페이지의 HTTPS 주소가 필요합니다.').describe('www.kurly.com/goods/<숫자 ID>의 HTTPS 주소. 쿼리·인증정보를 허용하지 않는 KoreAI 제안 규칙.');
const priceText = z.string().min(1).max(200);
const conditionsText = z.string().min(1).max(500).nullable().describe('화면에 표시된 회원·쿠폰 등 가격 조건 원문. 적용 가능 여부는 미검증.');
export const kurlyPriceProposal = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('listed'), amountKrw: z.number().int().positive().safe(), text: priceText, conditionsText }).strict(),
  z.object({ kind: z.literal('from'), amountKrw: z.number().int().positive().safe(), text: priceText, conditionsText }).strict(),
  z.object({ kind: z.literal('unknown'), amountKrw: z.null(), text: priceText.nullable(), conditionsText }).strict(),
]).describe('화면 표시 금액의 제안 규격. listed도 결제 확정가가 아니며 from은 옵션별 시작가. 미선택 총액 0원을 상품 가격으로 사용하지 않음.');
/** Proposed contract only; no consumer API, price parser or provider response is implemented. */
export const kurlyProductOutput = z.object({
  status: z.enum(['available', 'no_data']).describe('검색 데이터 존재 여부이며 상품 구매 가능 상태가 아님.'), query,
  products: z.array(z.object({
    providerId: z.string().min(1).max(100).nullable(), title: z.string().min(1).max(200), sourceUrl: productUrl,
    optionText: z.string().max(500).nullable().describe('용량·구성·택일 등 표시 원문. 옵션을 자동 선택하지 않음.'),
    price: kurlyPriceProposal,
    availabilityText: z.string().max(300).nullable().describe('품절 등 명시된 안내 원문. 담기 버튼만으로 재고를 추정하지 않음.'),
    deliveryText: z.string().max(500).nullable().describe('표시된 배송 안내. 사용자 주소의 배송 가능 여부·도착일을 보장하지 않음.'),
    deliveryEligibility: z.literal('not_verified'),
  }).strict()).max(20),
  retrievedAt: z.string().datetime(), providerUpdatedAt: z.string().datetime().nullable(),
}).strict().refine(value => value.status === 'available' ? value.products.length > 0 : value.products.length === 0, '결과 상태와 상품 수가 일치해야 합니다.');

export const kurlyProductPlan: FirstReadPlan = {
  actionId: 'kurly.products.search', title: '공개 상품 후보 찾기', state: 'defined', access: 'provider-confirmation-required', checkedAt: '2026-10-15',
  description: '검색어로 공개 상품의 이름·옵션·표시 가격과 조건·배송 안내·공식 상세 링크를 찾는 기능을 정의했습니다. 자동 조회는 아직 지원하지 않습니다.',
  manualUrl: 'https://www.kurly.com/main', manualLabel: '공식 상품 직접 확인',
  inputSchema: zodToJsonSchema(kurlyProductInput, { $refStrategy: 'none' }) as Record<string, unknown>,
  outputSchema: zodToJsonSchema(kurlyProductOutput, { $refStrategy: 'none' }) as Record<string, unknown>,
  example: { query: '우유', limit: 5 },
  accountRequirement: '소비자 상품 조회 API·자동 접근 조건 확인 대기. KLS의 IP 등록·secretKey/clientId·토큰은 화주 물류용이며 소비자 검색 권한으로 사용하지 않습니다.',
  resultCheck: '공식 상세 링크·상품/옵션 식별·가격 원문과 회원/쿠폰 조건·조회 시각을 대조합니다. 시작가·미제공 가격·미선택 총액 0원을 구분하고, 배송 안내를 주소별 가능 판정으로 바꾸지 않습니다. 접근 거절을 빈 결과로 처리하지 않습니다.',
  nextChecks: [
    '공급자에게 소비자 공개 상품 조회 API/제휴 또는 전용 브라우저 자동 조회 허용 여부를 확인',
    '인증·검색/페이지/한도·상품/옵션 식별자·가격 조건·품절 표시·보관/LLM 전달 범위를 확인',
    '허용된 환경에서 시작가·옵션 미선택·회원/쿠폰 조건·품절·로그인 만료·접근 거절을 검증',
    '주소별 배송·장바구니·주문은 후속 행동으로 분리하고 KLS 물류 연동은 별도 사업자 범위로 관리',
  ],
};
export const kurlyProductAction: Action = {
  id: kurlyProductPlan.actionId, serviceId: 'kurly', connectorId: 'kurly-read-plan', title: '마켓컬리 공개 상품 후보 찾기 · 초안',
  description: `${kurlyProductPlan.description} 입력·출력은 KoreAI 제안이며 공급자 API 명세가 아닙니다.`,
  category: '쇼핑·중고', effect: 'read', method: 'partnership', schema: kurlyProductInput, inputSchema: kurlyProductPlan.inputSchema,
  requiredSecrets: [], scopes: [], sourceUrl: kurlyProductPlan.manualUrl, checkedAt: kurlyProductPlan.checkedAt,
  verification: 'documented', resultCheck: kurlyProductPlan.resultCheck, domains: ['www.kurly.com'], version: '0.1.0-draft.1', maintainer: 'KoreAI', origin: 'bundled', implemented: false,
};
export const kurlyReadPlanExecutor: Executor = async () => {
  throw new ActionError('NOT_IMPLEMENTED', '마켓컬리 상품 검색은 기능 정의 단계입니다. 소비자 조회의 허용 범위와 공급자 규격을 확인한 뒤 구현해야 합니다.');
};
