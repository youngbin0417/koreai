import type { ConnectionDefinition } from './types.js';
export const daangn: ConnectionDefinition = {
  serviceId: 'daangn', name: '당근마켓', version: '0.1.0', domains: ['www.daangn.com', 'business.daangn.com'],
  routes: [
    { id: 'consumer', title: '사용자 서비스', kind: 'handoff', url: 'https://www.daangn.com/', description: '동네 거래 서비스로 이동합니다. 로그인·동네 인증은 사용자가 직접 진행합니다.' },
    { id: 'business', title: '당근비즈니스', kind: 'partnership', url: 'https://business.daangn.com/', description: '광고·비즈프로필 등 사업자용 연동 조건을 확인합니다.' },
  ],
  boundary: '당근비즈니스 경로가 개인의 중고거래·채팅 접근 권한을 제공한다는 의미는 아닙니다. 소비자 기능의 공개 API와 자동화 허용 범위는 추가 확인 대상입니다.',
  sources: [{ title: '당근비즈니스 소개', url: 'https://business.daangn.com/', checkedAt: '2026-10-10' }],
};
