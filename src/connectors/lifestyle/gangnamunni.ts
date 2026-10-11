import type { ConnectionDefinition } from './types.js';
export const gangnamunni: ConnectionDefinition = {
  serviceId: 'gangnamunni', name: '강남언니', version: '0.1.0', domains: ['www.gangnamunni.com', 'docs.channel.io'],
  routes: [
    { id: 'consumer', title: '사용자 서비스', kind: 'handoff', url: 'https://www.gangnamunni.com/', description: '공식 서비스에서 사용자가 직접 로그인하고 필요한 작업을 진행합니다.' },
    { id: 'partner', title: '병원 파트너 안내', kind: 'partnership', url: 'https://docs.channel.io/unni/ko', description: '병원용 파트너 기능과 연동 조건을 확인하는 경로입니다.' },
  ],
  boundary: '소비자용 공개 API 명세는 이번 조사에서 확인하지 못했습니다. 병원·시술 조회, 상담·예약 자동화는 다음 단계에서 범위와 접근 조건을 정의합니다.',
  sources: [{ title: '병원과 함께하는 강남언니', url: 'https://docs.channel.io/unni/ko', checkedAt: '2026-10-10' }],
};
