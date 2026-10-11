import type { ConnectionDefinition } from './types.js';
export const coupang: ConnectionDefinition = {
  serviceId: 'coupang', name: '쿠팡', version: '0.1.0', domains: ['www.coupang.com', 'developers.coupang.com'],
  routes: [
    { id: 'consumer', title: '사용자 서비스', kind: 'handoff', url: 'https://www.coupang.com/', description: '소비자용 공식 서비스에서 필요한 작업을 직접 진행합니다.' },
    { id: 'seller', title: '판매자 Open API', kind: 'partnership', url: 'https://developers.coupang.com/ko', description: '판매자 상품·주문·물류·반품 업무의 API 문서와 권한을 확인합니다.' },
  ],
  boundary: '공식 Open API는 판매자 업무용입니다. 소비자의 구매내역·장바구니·주문 자동화는 별도로 정의하고 검증해야 합니다.',
  sources: [{ title: 'Coupang Developer Center', url: 'https://developers.coupang.com/ko', checkedAt: '2026-10-10' }],
};
