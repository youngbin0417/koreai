import { z } from 'zod';
import { zodToJsonSchema } from 'zod-to-json-schema';
import { ActionError, type Action, type Executor } from '../../types.js';
import type { FirstReadPlan } from './types.js';

export const gangnamunniHospitalInput = z.object({
  query: z.string().trim().min(1).max(100).describe('병원 이름 또는 진료 분야 검색어. KoreAI 제안 입력이며 공급자 요청 필드는 미확인.'),
  region: z.string().trim().min(1).max(80).optional().describe('지역·역 이름. 공급자의 지역 코드로 자동 변환하지 않음.'),
  limit: z.number().int().min(1).max(20).default(5),
}).strict();
const hospitalUrl = z.string().url().max(1000).refine(value => {
  try {
    const url = new URL(value);
    return url.protocol === 'https:' && ['unni.app', 'www.gangnamunni.com'].includes(url.hostname) && !url.username && !url.password && !url.port && /^\/hospitals\/[^/?#]+\/?$/.test(url.pathname) && !url.search && !url.hash;
  } catch { return false; }
}, '공식 병원 상세 페이지의 HTTPS 주소가 필요합니다.');
/** Proposed result shape only; no provider data is fetched or represented as verified. */
export const gangnamunniHospitalOutput = z.object({
  status: z.enum(['available', 'no_data']),
  hospitals: z.array(z.object({ providerId: z.string().min(1).max(100).nullable(), name: z.string().min(1).max(200), locationText: z.string().max(300).nullable(), sourceUrl: hospitalUrl }).strict()).max(20),
  retrievedAt: z.string().datetime(), providerUpdatedAt: z.string().datetime().nullable(),
}).strict().refine(value => value.status === 'available' ? value.hospitals.length > 0 : value.hospitals.length === 0, '결과 상태와 병원 수가 일치해야 합니다.');

export const gangnamunniHospitalPlan: FirstReadPlan = {
  actionId: 'gangnamunni.hospitals.search', title: '공개 병원 후보 찾기', state: 'defined', access: 'provider-confirmation-required', checkedAt: '2026-10-15',
  description: '병원 이름·지역으로 후보의 이름·제공된 위치 설명·공식 상세 링크를 찾는 기능을 정의했습니다. 자동 조회는 아직 지원하지 않습니다.',
  manualUrl: 'https://unni.app/hospitals',
  inputSchema: zodToJsonSchema(gangnamunniHospitalInput, { $refStrategy: 'none' }) as Record<string, unknown>,
  outputSchema: zodToJsonSchema(gangnamunniHospitalOutput, { $refStrategy: 'none' }) as Record<string, unknown>,
  example: { query: '피부과', region: '강남역', limit: 5 },
  accountRequirement: '소비자 검색 API·인증 방식·자동 접근 허용 범위 확인 대기. 병원 파트너 계정을 소비자 검색 권한으로 사용하지 않으며 키·쿠키 입력을 받지 않습니다.',
  resultCheck: '허용된 접근 방식·검색/지역 조건 적용·공식 병원 상세 링크·이름/위치·중복 식별자·결측값·조회 시각을 대조합니다. 로그인 필요·접근 거절을 검색 결과 없음으로 바꾸지 않습니다.',
  nextChecks: [
    '공급자에게 소비자 병원 검색 API 또는 제휴 조회 제공 여부와 허용 범위를 확인',
    '허용된 인증 방식·병원 공개 필드·페이지/한도·갱신/재사용 조건을 문서로 확인',
    '소비자 이용약관 본문·브라우저 자동 접근 조건과 전용 프로필 이용 가능 범위를 확인',
    '허용된 테스트 환경에서 검색/지역/빈 결과/로그인 만료를 검증한 뒤 실행기 활성화',
  ],
};
export const gangnamunniHospitalAction: Action = {
  id: gangnamunniHospitalPlan.actionId, serviceId: 'gangnamunni', connectorId: 'gangnamunni-read-plan', title: '강남언니 공개 병원 후보 찾기 · 초안',
  description: `${gangnamunniHospitalPlan.description} 입력·출력은 KoreAI 제안이며 공급자 API 명세가 아닙니다.`,
  category: '의료·예약', effect: 'read', method: 'partnership', schema: gangnamunniHospitalInput, inputSchema: gangnamunniHospitalPlan.inputSchema,
  requiredSecrets: [], scopes: [], sourceUrl: gangnamunniHospitalPlan.manualUrl, checkedAt: gangnamunniHospitalPlan.checkedAt,
  verification: 'documented', resultCheck: gangnamunniHospitalPlan.resultCheck, domains: ['unni.app', 'www.gangnamunni.com'], version: '0.1.0-draft.1', maintainer: 'KoreAI', origin: 'bundled', implemented: false,
};
export const gangnamunniReadPlanExecutor: Executor = async () => {
  throw new ActionError('NOT_IMPLEMENTED', '강남언니 병원 검색은 기능 정의 단계입니다. 허용된 연결 방식과 공급자 규격을 확인한 뒤 구현해야 합니다.');
};
