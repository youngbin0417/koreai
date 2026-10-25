import type { Engine } from './engine.js';

export const environmentProviders = [
  ['naver-user', 'NAVER_USER', '네이버 사용자', ['accessToken']], ['band-user', 'BAND', '밴드', ['accessToken']],
  ['kakao-user', 'KAKAO_USER', '카카오 사용자', ['accessToken']], ['kakao-app', 'KAKAO_APP', '카카오 지도·다음 검색', ['restApiKey']],
  ['data-go-kr', 'BENEFITS', '공공혜택', ['serviceKey']], ['kma-api', 'KMA', '기상청', ['serviceKey']],
  ['airkorea-api', 'AIRKOREA', '에어코리아', ['serviceKey']], ['tago-api', 'TAGO', '대중교통 TAGO', ['serviceKey']],
  ['egen-api', 'EGEN', 'E-Gen', ['serviceKey']], ['hira-api', 'HIRA', '건강보험심사평가원', ['serviceKey']],
  ['neis-api', 'NEIS', '나이스 교육정보', ['apiKey']], ['kobis-api', 'KOBIS', '영화관입장권', ['apiKey']],
  ['kopis-api', 'KOPIS', '공연예술', ['apiKey']], ['tourapi-api', 'TOURAPI', '한국관광공사', ['serviceKey']],
  ['foodsafety-api', 'FOODSAFETY', '식품안전나라', ['apiKey']], ['lh-api', 'LH', 'LH 공고', ['serviceKey']],
  ['kosis-api', 'KOSIS', '국가통계', ['apiKey']], ['tmap-api', 'TMAP', 'TMAP', ['appKey']],
  ['work24-api', 'WORK24', '고용24', ['authKey']], ['seoul-subway-api', 'SEOUL_SUBWAY', '서울 지하철 도착·시간표', ['apiKey']],
  ['seoul-subway-route-api', 'SEOUL_SUBWAY_ROUTE', '서울 지하철 경로·환승', ['serviceKey']],
  ['ev-chargers-api', 'EV_CHARGERS', '전기차 충전소', ['serviceKey']], ['opinet-api', 'OPINET', '오피넷', ['apiKey']],
  ['seoul-bike-api', 'SEOUL_BIKE', '따릉이', ['apiKey']], ['chzzk-client', 'CHZZK', '치지직', ['clientId', 'clientSecret']],
  ['library-naru-api', 'LIBRARY_NARU', '도서관 정보나루', ['apiKey']],
] as const;
export const environmentKeyName = (prefix: string, field: string) => `KOREAI_${prefix}_${field.replace(/([a-z])([A-Z])/g, '$1_$2').toUpperCase()}`;

export async function syncEnvironmentAccounts(engine: Engine, env: NodeJS.ProcessEnv) {
  // Validate all configured entries before mutating accounts. Errors contain variable names only.
  const plans = environmentProviders.flatMap(([credentialType, prefix, label, fields]) => {
    const secrets: Record<string, string> = Object.fromEntries(fields.map(field => [field, env[environmentKeyName(prefix, field)]?.trim() ?? '']));
    if (!Object.values(secrets).some(Boolean)) return [];
    if (Object.values(secrets).some(value => !value || value.length > 10000)) throw Error(`KOREAI_${prefix}: 필요한 키 이름과 값을 확인하세요.`);
    const allowedActions = [...new Set((env[`KOREAI_${prefix}_ACTIONS`] ?? '').split(',').map(value => value.trim()).filter(Boolean))];
    for (const id of allowedActions) {
      const action = engine.actions.get(id);
      if (!action || action.credentialType !== credentialType || action.origin !== 'bundled' || action.method !== 'api' || !action.implemented || action.unavailable) throw Error(`KOREAI_${prefix}_ACTIONS: 허용 가능한 공식 행동 ID를 확인하세요.`);
      if (action.requiredSecrets.some(field => !secrets[field])) throw Error(`KOREAI_${prefix}: 필요한 키 이름과 값을 확인하세요.`);
    }
    return [{ credentialType, label: `.env · ${label}`, allowedActions, secrets }];
  });
  const previous = engine.accounts().filter(account => account.managedBy === 'environment');
  for (const account of previous) if (!plans.some(plan => plan.credentialType === account.credentialType)) await engine.removeAccount(account.id, true);
  for (const plan of plans) {
    const account = previous.find(account => account.credentialType === plan.credentialType);
    await engine.saveAccount({ ...plan, ...(account ? { id: account.id } : {}) }, true);
  }
}
