import type { ConnectionDefinition } from './types.js';
export const kurly: ConnectionDefinition = {
  serviceId: 'kurly', name: '마켓컬리', version: '0.1.0', domains: ['www.kurly.com', 'developers.kurly.com'],
  routes: [
    { id: 'consumer', title: '사용자 서비스', kind: 'handoff', url: 'https://www.kurly.com/', description: '공식 쇼핑 서비스에서 로그인과 구매 관련 작업을 직접 진행합니다.' },
    { id: 'logistics', title: '컬리 물류 개발자센터', kind: 'partnership', url: 'https://developers.kurly.com/', description: 'KLS 물류 연동 경로입니다. 접속 허용 IP 등록과 인증키 발급 조건을 확인합니다.' },
  ],
  boundary: 'KLS OpenAPI는 물류 서비스용입니다. 마켓컬리 소비자 상품·구매내역·주문 API가 확인된 것은 아닙니다.',
  sources: [{ title: 'KLS 인증 안내', url: 'https://developers.kurly.com/docs/auth/', checkedAt: '2026-10-10' }],
};
