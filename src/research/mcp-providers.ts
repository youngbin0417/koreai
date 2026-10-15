/** Reviewed configuration only; document/metadata checks are not an account verification. */
export const mcpProviders = [
  {
    id: 'toss-console', name: '토스 운영 콘솔', status: 'preset' as const,
    url: 'https://mcp.toss.im/adapters/apps-in-toss-console/mcp',
    sourceUrl: 'https://developers-apps-in-toss.toss.im/guide/console-mcp.md', checkedAt: '2026-10-16',
    accountVerified: false, defaultTools: ['workspace_list'],
    oauth: { clientId: 'mcp-gateway', issuerUrl: 'https://mcp.toss.im', scope: 'openid' },
    endpoints: { authorization: 'https://business-accounts.toss.im/oauth2/authorize', token: 'https://business-accounts.toss.im/oauth2/token' },
    description: '앱인토스 운영자의 워크스페이스 조회부터 연결합니다. 개인 계좌·잔액 조회 권한을 제공하지 않습니다.',
    requirements: '로그인할 운영 계정과 콜백 허용 여부를 확인하세요. 공식 Client ID는 미리 입력하며, 별도 등록을 요구받으면 발급된 Client ID로 바꾸세요. 실제 계정 호환성은 확인 대기입니다.',
  },
  {
    id: 'daangn-ads', name: '당근 광고', status: 'registration_required' as const,
    url: 'https://ads-mcp.kr.karrotmarket.com/mcp',
    sourceUrl: 'https://businessdaangn.gitbook.io/business.daangn/ads-pro/tools/mcp', checkedAt: '2026-10-16',
    accountVerified: false, defaultTools: [],
    oauth: { issuerUrl: 'https://accounts.daangn.com/internal-oidc', scope: 'ads:read' },
    description: '광고주 계정의 광고 현황·성과 조회 범위입니다. 소비자 중고 물품·채팅과 별도입니다.',
    requirements: '공개 메타데이터에 동적 등록 엔드포인트가 없고 Client ID Metadata Document 지원이 표시됩니다. 등록된 Client ID 또는 공개 메타데이터 URL과 지원 클라이언트 조건·정확한 도구 이름을 확인한 뒤 직접 연결하세요. 자동 프리셋 연결은 대기 중입니다.',
  },
] as const;
export const tossConsolePreset = mcpProviders[0]!;
