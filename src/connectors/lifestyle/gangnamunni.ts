import type { ConnectionDefinition } from './types.js';
import { gangnamunniHospitalPlan } from './gangnamunni-read.js';
export const gangnamunni: ConnectionDefinition = {
  serviceId: 'gangnamunni', name: '강남언니', version: '0.1.1', domains: ['unni.app', 'www.gangnamunni.com', 'docs.channel.io'],
  routes: [
    { id: 'consumer', title: '사용자 서비스', kind: 'handoff', url: 'https://unni.app/', description: '기존 강남언니 공식 주소가 이동하는 unni.app에서 사용자가 직접 진행합니다.' },
    { id: 'hospitals', title: '공개 병원 목록 직접 확인', kind: 'handoff', url: 'https://unni.app/hospitals', description: '공식 병원 목록을 열고 이름·지역을 사용자가 직접 검색합니다. KoreAI가 병원 정보를 읽거나 검색을 대신 실행하지 않습니다.' },
    { id: 'partner', title: '병원 파트너 안내', kind: 'partnership', url: 'https://docs.channel.io/unni/ko', description: '병원용 파트너 기능과 연동 조건을 확인하는 경로입니다.' },
  ],
  boundary: '공개 병원 후보 찾기를 첫 조회 기능으로 정의했습니다. 소비자 검색 API·자동 접근 조건은 확인 대기이며 병원 파트너 권한과 별개입니다. 현재는 사용자 직접 확인 경로만 제공합니다.',
  firstRead: gangnamunniHospitalPlan,
  sources: [
    { title: '강남언니 공식 진입 주소 → unni.app 이동 확인', url: 'https://www.gangnamunni.com/', checkedAt: '2026-10-15' },
    { title: '공식 공개 병원 목록 · 사용자 직접 확인', url: 'https://unni.app/hospitals', checkedAt: '2026-10-15' },
    { title: '병원용 파트너센터 사용 설명서', url: 'https://docs.channel.io/unni/ko/articles/파트너센터-사용-설명서--3d48f641', checkedAt: '2026-10-15' },
  ],
};
