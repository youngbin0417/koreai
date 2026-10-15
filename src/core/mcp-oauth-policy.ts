import type { AuthorizationServerMetadata } from '@modelcontextprotocol/sdk/shared/auth.js';
import type { RemoteServer } from '../types.js';
import { ActionError } from '../types.js';
import { tossConsolePreset } from '../research/mcp-providers.js';
import { oauthUrl } from './mcp-oauth-network.js';

/** Only a reviewed preset can cross issuer origins. No caller-supplied allowlist. */
export function validateMcpOAuthEndpoints(remote: Pick<RemoteServer, 'url' | 'presetId'>, issuer: string, metadata: AuthorizationServerMetadata) {
  if (oauthUrl(metadata.issuer).href !== oauthUrl(issuer).href) throw new ActionError('OAUTH_ISSUER', '인증 서버 메타데이터의 issuer가 일치하지 않습니다.');
  const expected = remote.presetId === tossConsolePreset.id ? tossConsolePreset : undefined;
  if (remote.presetId && (!expected || oauthUrl(remote.url).href !== expected.url || oauthUrl(issuer).href !== oauthUrl(expected.oauth.issuerUrl).href)) throw new ActionError('OAUTH_PRESET', '프리셋의 서버·인증 서버 주소가 일치하지 않습니다.');
  for (const [kind, endpoint] of [['authorization', metadata.authorization_endpoint], ['token', metadata.token_endpoint], ['registration', metadata.registration_endpoint]] as const) {
    if (!endpoint) continue;
    const url = oauthUrl(endpoint);
    if (expected && kind !== 'registration') {
      if (url.href !== expected.endpoints[kind]) throw new ActionError('OAUTH_ENDPOINT', '공식 프리셋의 인증 주소가 변경됐습니다. 연결을 중단하고 확인하세요.');
    } else if (url.origin !== oauthUrl(issuer).origin) throw new ActionError('OAUTH_ENDPOINT', 'OAuth 엔드포인트는 인증 서버와 같은 출처여야 합니다.');
  }
}
