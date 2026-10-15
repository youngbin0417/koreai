import type { ConnectionDefinition } from './types.js';
import { tossAccountPlan } from './toss-read.js';
export const toss: ConnectionDefinition = {
  serviceId: 'toss', name: '토스', version: '0.1.1', domains: ['toss.im', 'developers-apps-in-toss.toss.im', 'auth-docs.toss.im'],
  routes: [
    { id: 'consumer', title: '토스 서비스 안내', kind: 'handoff', url: 'https://toss.im/', description: '공식 안내에서 앱으로 이동합니다. 로그인·본인인증과 금융 작업은 사용자가 앱에서 직접 진행합니다.' },
    { id: 'apps-in-toss', title: '앱인토스 개발자센터', kind: 'partnership', url: 'https://developers-apps-in-toss.toss.im/intro/overview.html', description: '토스 안에서 동작하는 미니앱의 개발·등록·인증 조건을 확인합니다.' },
    { id: 'login-guide', title: '외부 서비스 토스 로그인 안내', kind: 'partnership', url: 'https://auth-docs.toss.im/tosslogin/common.html', description: '외부 서비스용 Client 등록·사용자 정보 Scope·약관·연결 끊기 안내입니다. 개인 계좌 조회 권한이 아니며 KoreAI에서 로그인 인증을 실행하지 않습니다.' },
    { id: 'mydata-auth', title: '마이데이터 통합인증 안내', kind: 'partnership', url: 'https://auth-docs.toss.im/auth/integration_mydata.html', description: '사업자·정보제공자용 서명 검증과 CI 반환 안내입니다. 계좌 목록·잔액 조회 API가 아니며 KoreAI에서 인증·금융 조회를 실행하지 않습니다.' },
    { id: 'console-mcp-guide', title: '앱인토스 운영 콘솔 MCP 안내', kind: 'partnership', url: 'https://developers-apps-in-toss.toss.im/guide/console-mcp.md', description: '워크스페이스·미니앱·검수·운영 통계용 MCP 안내입니다. 소비자 금융 조회가 아니며 KoreAI의 상위 MCP 등록·OAuth·도구 호출은 별도 검증이 필요합니다.' },
  ],
  boundary: '앱인토스·외부 토스 로그인·마이데이터 통합인증·운영 콘솔 MCP의 권한을 구분합니다. 개인 계좌 목록의 자동 조회와 금융정보 제공 조건은 확인 대기입니다.',
  firstRead: tossAccountPlan,
  sources: [
    { title: '토스 공식 서비스 안내', url: tossAccountPlan.manualUrl, checkedAt: '2026-10-15' },
    { title: '앱인토스 현재 문서', url: 'https://developers-apps-in-toss.toss.im/readme.md', checkedAt: '2026-10-15' },
    { title: '앱인토스 로그인·사용자 정보', url: 'https://developers-apps-in-toss.toss.im/guide/authentication/intro.md', checkedAt: '2026-10-15' },
    { title: '외부 서비스 토스 로그인', url: 'https://auth-docs.toss.im/tosslogin/common.html', checkedAt: '2026-10-15' },
    { title: '마이데이터 통합인증', url: 'https://auth-docs.toss.im/auth/integration_mydata.html', checkedAt: '2026-10-15' },
    { title: '앱인토스 콘솔 MCP', url: 'https://developers-apps-in-toss.toss.im/guide/console-mcp.md', checkedAt: '2026-10-15' },
  ],
};
