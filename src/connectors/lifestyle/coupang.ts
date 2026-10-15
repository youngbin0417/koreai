import type { ConnectionDefinition } from './types.js';
import { coupangProductPlan } from './coupang-read.js';
export const coupang: ConnectionDefinition = {
  serviceId: 'coupang', name: '쿠팡', version: '0.1.1', domains: ['www.coupang.com', 'developers.coupang.com', 'partners.coupang.com'],
  routes: [
    { id: 'consumer', title: '사용자 서비스', kind: 'handoff', url: 'https://www.coupang.com/', description: '소비자용 공식 서비스에서 필요한 작업을 직접 진행합니다.' },
    { id: 'seller', title: '판매자 Open API', kind: 'partnership', url: 'https://developers.coupang.com/ko', description: '판매자 상품·주문·물류·반품 업무의 API 문서와 권한을 확인합니다.' },
    { id: 'seller-auth', title: '판매자 키 발급 안내', kind: 'partnership', url: 'https://developers.coupang.com/ko/getting-started/issue-open-api-keynew', description: 'WING 판매자 계정의 키 발급·IP 등록 안내입니다. 소비자 전체 검색·개인 구매내역 권한이 아니며 KoreAI에서 인증·서명·호출을 수행하지 않습니다.' },
    { id: 'partners-guide', title: '파트너스 상품 API 안내', kind: 'partnership', url: 'https://partners.coupang.com/#help/open-api', description: '상품 정보·제휴 링크·실적 기능의 파트너스 API 안내입니다. 최종승인·활동/표시 조건과 세부 규격 확인이 필요하며 KoreAI에서 실제 API를 호출하지 않습니다.' },
  ],
  boundary: '판매자 Open API와 제휴 마케팅용 파트너스 API의 권한을 구분합니다. 소비자의 구매내역·장바구니·주문 자동화는 별도 확인 대상입니다.',
  firstRead: coupangProductPlan,
  sources: [
    { title: '쿠팡 공식 상품 서비스', url: coupangProductPlan.manualUrl, checkedAt: '2026-10-15' },
    { title: '판매자 Open API 안내', url: 'https://developers.coupang.com/ko/getting-started/coupang-open-api', checkedAt: '2026-10-15' },
    { title: '판매자 키 발급·IP 등록', url: 'https://developers.coupang.com/ko/getting-started/issue-open-api-keynew', checkedAt: '2026-10-15' },
    { title: '판매자 HMAC 서명', url: 'https://developers.coupang.com/ko/getting-started/creating-hmac-signature', checkedAt: '2026-10-15' },
    { title: '파트너스 공식 가이드 · 2025-10-28판', url: 'https://partners.coupangcdn.com/partners-guide/partners-guide-20251028182159.pdf', checkedAt: '2026-10-15' },
  ],
};
