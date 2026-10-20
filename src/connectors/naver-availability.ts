import type { Action } from '../types.js';

export const naverRetirementNotice = 'https://developers.naver.com/notice/article/32564';
export const naverTerms = 'https://developers.naver.com/products/intro/terms/terms.md';
const retired = new Set(['naver.search.shop', 'naver.search.book', 'naver.book.isbn']);
const restricted = new Set(['naver.search.news', 'naver.search.blog', 'naver.search.cafearticle', 'naver.search.local']);
/** Provider state is bundled metadata, independent of an operator's suspension switch. */
export function naverSearchAvailability(id: string): Action['unavailable'] {
  if (retired.has(id)) return { kind: 'retired', reason: '네이버 개발자센터의 쇼핑·책 검색 API는 2026-07-31 종료 공지에 따라 중단했습니다. 기존 키로도 실행할 수 없습니다.', sourceUrl: naverRetirementNotice, effectiveAt: '2026-08-01T00:00:00+09:00', checkedAt: '2026-10-20' };
  if (restricted.has(id)) return { kind: 'policy-restricted', reason: '네이버 검색 약관 2.3의 검색 데이터 AI 입력·활용 제한으로 KoreAI 연결을 중단했습니다. 별도 허용 경로를 확인한 뒤 재검토합니다.', sourceUrl: naverTerms, effectiveAt: '2026-09-07T00:00:00+09:00', checkedAt: '2026-10-20' };
  return undefined;
}
