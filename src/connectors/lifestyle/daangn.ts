import type { ConnectionDefinition } from './types.js';
import { daangnItemPlan } from './daangn-read.js';
export const daangn: ConnectionDefinition = {
  serviceId: 'daangn', name: '당근마켓', version: '0.1.1', domains: ['www.daangn.com', 'business.daangn.com', 'businessdaangn.gitbook.io'],
  routes: [
    { id: 'consumer', title: '사용자 서비스', kind: 'handoff', url: 'https://www.daangn.com/', description: '동네 거래 서비스로 이동합니다. 로그인·동네 인증은 사용자가 직접 진행합니다.' },
    { id: 'items', title: '공개 중고거래 목록 직접 확인', kind: 'handoff', url: 'https://www.daangn.com/kr/buy-sell/', description: '공식 중고거래 페이지를 열고 검색어·동네를 사용자가 직접 선택합니다. KoreAI가 물품을 검색하거나 동네를 인증하지 않습니다.' },
    { id: 'business', title: '당근비즈니스', kind: 'partnership', url: 'https://business.daangn.com/', description: '광고·비즈프로필 등 사업자용 연동 조건을 확인합니다.' },
    { id: 'ads-mcp-guide', title: '광고주용 MCP 공식 가이드', kind: 'partnership', url: 'https://businessdaangn.gitbook.io/business.daangn/ads-pro/tools/mcp', description: '당근비즈니스 계정 인증으로 광고 계정·성과 등을 조회하는 공식 MCP 안내입니다. 소비자 물품·채팅 연동이 아니며 KoreAI의 실제 연결은 별도 검증이 필요합니다.' },
  ],
  boundary: '동네 중고 물품 후보 찾기를 첫 기능으로 정의했습니다. 소비자 API·자동 접근 조건은 확인 대기입니다. 공식 광고 MCP/OpenAPI는 광고주 업무 범위이며 개인 거래·채팅·동네 인증 권한과 구분합니다.',
  firstRead: daangnItemPlan,
  sources: [
    { title: '당근 공식 서비스 소개 · 중고거래와 동네 인증', url: 'https://about.daangn.com/service/', checkedAt: '2026-10-15' },
    { title: '공식 광고 MCP 소개 · 2026-09-16 발표', url: 'https://business.daangn.com/insights/b4ff5ccf-ed98-4784-a88d-686b9b358aae/당근-광고-MCP-소개', checkedAt: '2026-10-15' },
    { title: '광고 MCP 인증·범위·호출 한도 공식 가이드', url: 'https://businessdaangn.gitbook.io/business.daangn/ads-pro/tools/mcp', checkedAt: '2026-10-15' },
  ],
};
