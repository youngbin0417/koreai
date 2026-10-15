import { z } from 'zod';
import { zodToJsonSchema } from 'zod-to-json-schema';
import { ActionError, type Action, type Executor } from '../../types.js';
import type { FirstReadPlan } from './types.js';

export const tossAccountInput = z.object({
  limit: z.number().int().min(1).max(20).default(5).describe('KoreAI 제안 상한. 공급자 계좌 조회·페이지 규격은 미확인.'),
}).strict();
const account = z.object({
  accountRef: z.string().uuid().describe('KoreAI가 발급할 로컬 참조 UUID. 계좌번호·CI·공급자 사용자/계좌 식별자가 아님.'),
  institutionName: z.string().trim().min(1).max(100).describe('제공된 금융기관 표시명.'),
  accountNumberHint: z.string().regex(/^\*{4}\d{4}$/).nullable().describe('KoreAI 제안 표시 형식 ****1234. 끝 네 자리만 제공하며 확인할 수 없으면 null.'),
}).strict();
/** Proposed consumer contract only; no financial API, consent collection or account mapping is implemented. */
export const tossAccountOutput = z.object({
  status: z.enum(['available', 'no_data']).describe('허용된 조회의 자료 존재 여부. no_data도 사용자의 전체 계좌 부재를 뜻하지 않음.'),
  accounts: z.array(account).max(20),
  coverage: z.literal('not_verified').describe('전체 연결 계좌에 대한 조회 범위·완전성은 미검증.'),
  retrievedAt: z.string().datetime(), providerUpdatedAt: z.string().datetime().nullable(),
}).strict().refine(value => value.status === 'available' ? value.accounts.length > 0 : value.accounts.length === 0, '결과 상태와 계좌 수가 일치해야 합니다.')
  .refine(value => new Set(value.accounts.map(item => item.accountRef)).size === value.accounts.length, '로컬 계좌 참조가 중복될 수 없습니다.');

export const tossAccountPlan: FirstReadPlan = {
  actionId: 'toss.accounts.list', title: '내 연결 계좌 목록 확인', state: 'defined', access: 'provider-confirmation-required', checkedAt: '2026-10-15',
  description: '사용자가 조회에 동의한 연결 계좌의 기관명·마스킹 식별정보를 확인할 규격을 정의했습니다. 자동 조회는 아직 지원하지 않습니다. 잔액·거래내역·송금은 별도 후속 기능입니다.',
  manualUrl: 'https://toss.im/', manualLabel: '토스 안내·앱 직접 확인',
  inputSchema: zodToJsonSchema(tossAccountInput, { $refStrategy: 'none' }) as Record<string, unknown>,
  outputSchema: zodToJsonSchema(tossAccountOutput, { $refStrategy: 'none' }) as Record<string, unknown>,
  example: { limit: 5 },
  accountRequirement: '개인 금융 조회의 API·제휴·인증·동의 조건 확인 대기. 앱인토스 사용자 식별·토스 로그인·마이데이터 서명 검증 성공을 금융 조회 권한으로 간주하지 않습니다. 준비 저장은 계좌 연결·동의 수집이 아닙니다.',
  resultCheck: '확인된 본인·동의 범위/유효기간·계정 권한과 제공 기관·마스킹·로컬 참조·조회 시각을 대조합니다. 미연결·동의 만료/회수·접근 거절은 빈 결과와 구분하고 전체 계좌 조회를 보장하지 않습니다.',
  nextChecks: [
    '토스 또는 허용된 제휴 경로의 개인 연결 계좌 조회 제공 여부·이용 주체·인증/동의 조건을 확인',
    'KoreAI 사용자·공급자 본인·계정·에이전트 범위를 서버에서 결속하고 동의 만료/회수 시 조회·캐시 접근 차단을 설계',
    '원본 금융 식별자와 로컬 UUID를 분리하고 끝 네 자리 마스킹·보관/삭제·외부 LLM 전달 조건을 검증',
    '앱인토스 콘솔 MCP는 운영자용 별도 범위로 관리하고 금융 조회용으로 연결하지 않음',
    '허용된 환경에서 본인/타인 구분·부분/빈 결과·동의 거절/철회·인증 만료를 검증한 뒤 실행기 활성화',
  ],
};
export const tossAccountAction: Action = {
  id: tossAccountPlan.actionId, serviceId: 'toss', connectorId: 'toss-read-plan', title: '토스 내 연결 계좌 목록 확인 · 초안',
  description: `${tossAccountPlan.description} 입력·출력은 KoreAI 제안이며 공급자 API 명세가 아닙니다.`,
  category: '금융·인증', effect: 'read', method: 'partnership', schema: tossAccountInput, inputSchema: tossAccountPlan.inputSchema,
  requiredSecrets: [], scopes: [], sourceUrl: tossAccountPlan.manualUrl, checkedAt: tossAccountPlan.checkedAt,
  verification: 'documented', resultCheck: tossAccountPlan.resultCheck, domains: ['toss.im'], version: '0.1.0-draft.1', maintainer: 'KoreAI', origin: 'bundled', implemented: false,
};
export const tossReadPlanExecutor: Executor = async () => {
  throw new ActionError('NOT_IMPLEMENTED', '토스 연결 계좌 조회는 기능 정의 단계입니다. 개인 금융 조회의 제공 경로·인증·동의 조건과 공급자 규격을 확인한 뒤 구현해야 합니다.');
};
