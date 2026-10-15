import type { ConnectionDefinition } from './types.js';
import { kurlyProductPlan } from './kurly-read.js';
export const kurly: ConnectionDefinition = {
  serviceId: 'kurly', name: '마켓컬리', version: '0.1.1', domains: ['www.kurly.com', 'developers.kurly.com'],
  routes: [
    { id: 'consumer', title: '사용자 서비스', kind: 'handoff', url: 'https://www.kurly.com/', description: '공식 쇼핑 서비스에서 로그인과 구매 관련 작업을 직접 진행합니다.' },
    { id: 'products', title: '공식 상품 직접 확인', kind: 'handoff', url: kurlyProductPlan.manualUrl, description: '공식 홈에서 상품을 직접 찾습니다. 자동 검색·옵션 선택·가격 확정·주소별 배송 확인을 수행하지 않습니다.' },
    { id: 'logistics', title: '컬리 물류 개발자센터', kind: 'partnership', url: 'https://developers.kurly.com/', description: 'KLS 물류 연동 경로입니다. 접속 허용 IP 등록과 인증키 발급 조건을 확인합니다.' },
    { id: 'logistics-auth', title: 'KLS 물류 인증 안내', kind: 'partnership', url: 'https://developers.kurly.com/docs/auth/', description: '화주 물류용 IP 등록·secretKey/clientId·토큰 안내입니다. 소비자 상품 검색 권한이 아니며 KoreAI에서 인증·물류 API를 실행하지 않습니다.' },
  ],
  boundary: 'KLS OpenAPI는 물류 서비스용입니다. 마켓컬리 소비자 상품·구매내역·주문 API가 확인된 것은 아닙니다.',
  firstRead: kurlyProductPlan,
  sources: [
    { title: '공식 상품 서비스', url: kurlyProductPlan.manualUrl, checkedAt: '2026-10-15' },
    { title: 'KLS 서비스 소개', url: 'https://developers.kurly.com/docs/intro/', checkedAt: '2026-10-15' },
    { title: 'KLS 인증 안내', url: 'https://developers.kurly.com/docs/auth/', checkedAt: '2026-10-15' },
  ],
};
