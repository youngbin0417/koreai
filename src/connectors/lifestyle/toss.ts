import type { ConnectionDefinition } from './types.js';
export const toss: ConnectionDefinition = {
  serviceId: 'toss', name: '토스', version: '0.1.0', domains: ['toss.im', 'developers-apps-in-toss.toss.im'],
  routes: [
    { id: 'consumer', title: '토스 서비스 안내', kind: 'handoff', url: 'https://toss.im/', description: '공식 안내에서 앱으로 이동합니다. 로그인·본인인증과 금융 작업은 사용자가 앱에서 직접 진행합니다.' },
    { id: 'apps-in-toss', title: '앱인토스 개발자센터', kind: 'partnership', url: 'https://developers-apps-in-toss.toss.im/intro/overview.html', description: '토스 안에서 동작하는 미니앱의 개발·등록·인증 조건을 확인합니다.' },
  ],
  boundary: '앱인토스 연동과 개인 계좌·거래내역·송금 권한은 별개입니다. 금융 기능은 필요한 제휴·인증 조건과 함께 이후 단계에서 정의합니다.',
  sources: [{ title: '앱인토스 시작 안내', url: 'https://developers-apps-in-toss.toss.im/intro/overview.html', checkedAt: '2026-10-10' }],
};
