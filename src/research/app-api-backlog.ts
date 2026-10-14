import type { Service, Verification } from '../types.js';

export interface ApiCandidate {
  serviceId: string;
  name: string;
  category: string;
  homeUrl: string;
  priority: 1 | 2 | 3;
  access: 'public-key' | 'merchant' | 'unknown';
  verification: Extract<Verification, 'documented' | 'unresearched'>;
  sourceUrl: string;
  checkedAt: string | null;
  documentedScope: string | null;
  proposedActions: string[];
  draftActionIds: string[];
  implementedActionIds: string[];
  nextStep: string;
}

const checkedAt = '2026-10-11';
type CandidateInput = Omit<ApiCandidate, 'verification' | 'checkedAt' | 'draftActionIds' | 'implementedActionIds'> & { draftActionIds?: string[]; implementedActionIds?: string[]; checkedAt?: string };
function candidate(input: CandidateInput): ApiCandidate {
  return { ...input, draftActionIds: input.draftActionIds ?? [], implementedActionIds: input.implementedActionIds ?? [], verification: input.documentedScope ? 'documented' : 'unresearched', checkedAt: input.documentedScope ? input.checkedAt ?? checkedAt : null };
}

// Proposed actions are product ideas; documentedScope describes only the reviewed source.
export const appApiBacklog: ApiCandidate[] = [
  candidate({ serviceId: 'kma', name: '기상청 날씨', category: '날씨·환경', homeUrl: 'https://www.weather.go.kr', priority: 1, access: 'public-key', checkedAt: '2026-10-12',
    sourceUrl: 'https://www.data.go.kr/data/15084084/openapi.do', documentedScope: '초단기실황·초단기예보·단기예보 조회, JSON/XML, 공공데이터포털 키.',
    proposedActions: ['동네 날씨 조회', '시간별 예보 조회'], implementedActionIds: ['kma.observation'], nextStep: '초단기실황 실행기 구현·모의 검증 완료. 실제 키 검증과 주소→격자 변환·예보 조회는 다음 단계.' }),
  candidate({ serviceId: 'airkorea', name: '에어코리아', category: '날씨·환경', homeUrl: 'https://www.airkorea.or.kr', priority: 1, access: 'public-key', checkedAt: '2026-10-14',
    sourceUrl: 'https://www.data.go.kr/data/15073861/openapi.do', documentedScope: '대기오염 측정·대기질 예보 조회, JSON/XML. 출처표시·변경금지 조건과 운영 심사 확인 필요.',
    proposedActions: ['대기질 예보 조회', '동네 미세먼지 조회'], implementedActionIds: ['airkorea.forecast'], nextStep: '예보 실행기·계정 화면·원문 보존·모의 검증 완료. 실제 키 응답·운영 권한 확인과 측정소별 현재 관측 조회는 다음 단계.' }),
  candidate({ serviceId: 'tago', name: 'TAGO 대중교통', category: '지도·교통', homeUrl: 'https://www.tago.go.kr', priority: 1, access: 'public-key', checkedAt: '2026-10-14',
    sourceUrl: 'https://www.data.go.kr/data/15098530/openapi.do', documentedScope: '정류소별 버스 도착예정정보와 제공 도시코드 조회, JSON/XML.',
    proposedActions: ['버스 도착 조회', '도시·정류소 찾기'], implementedActionIds: ['tago.bus.arrivals', 'tago.cities', 'tago.bus.stops'], nextStep: '도시 목록·정류소 찾기·도착 조회 실행기와 계정 화면 구현. 두 API의 실제 키 권한·지역별 응답·자료 갱신 조건 검증은 다음 단계.' }),
  candidate({ serviceId: 'egen', name: 'E-Gen 병·의원 정보', category: '의료·예약', homeUrl: 'https://www.e-gen.or.kr', priority: 1, access: 'public-key', checkedAt: '2026-10-14',
    sourceUrl: 'https://www.data.go.kr/data/15000736/openapi.do', documentedScope: '시도·시군구·진료요일·기관명 등으로 전국 병·의원 정보 조회, XML.',
    proposedActions: ['병·의원 찾기', '요일별 진료 정보 조회'], implementedActionIds: ['egen.hospitals.search'], nextStep: 'XML 검색 실행기·계정 화면·연락처·요일별 시간·출처·모의 검증 구현. 실제 키·지역별 정보·갱신 조건 확인과 진료과목/기관분류 필터는 다음 단계.' }),
  candidate({ serviceId: 'neis', name: '나이스 교육정보', category: '교육·도서', homeUrl: 'https://open.neis.go.kr', priority: 1, access: 'public-key',
    sourceUrl: 'https://open.neis.go.kr/portal/data/service/selectServicePage.do?infId=OPEN17320190722180924242823&infSeq=1', documentedScope: '학교 급식식단 공개 정보: 일자별 요리명·원산지·칼로리·영양 정보.',
    proposedActions: ['학교 급식 조회', '학교·학사일정 찾기'], draftActionIds: ['neis.meals'], nextStep: 'Open API 탭의 정확한 요청·출력 규격과 학교코드 검증. 개인 학생정보는 별도 범위.' }),
  candidate({ serviceId: 'kobis', name: 'KOBIS 영화정보', category: '일정·문화·주거', homeUrl: 'https://www.kobis.or.kr', priority: 1, access: 'public-key',
    sourceUrl: 'https://www.kobis.or.kr/kobisopenapi/homepg/apiservice/searchServiceInfo.do', documentedScope: '일별·주간 박스오피스, 영화 목록·상세 등의 공식 Open API 제공.',
    proposedActions: ['일별 박스오피스 조회', '영화 정보 찾기'], draftActionIds: ['kobis.boxoffice.daily'], nextStep: '세부 요청 규격·HTTPS·키 발급 조건 검증. 극장별 상영 시간과 예매는 별도.' }),
  candidate({ serviceId: 'hira', name: '건강보험심사평가원', category: '의료·예약', homeUrl: 'https://www.hira.or.kr', priority: 2, access: 'public-key',
    sourceUrl: 'https://www.data.go.kr/data/15001698/openapi.do', documentedScope: '신고 기준 병원 정보 조회, XML. 지역 코드표와 암호화된 요양기관 식별자 제공.',
    proposedActions: ['병원 찾기', '공개 병원 정보 상세 조회'], nextStep: '최신 활용명세·지역코드·XML 필드 검증과 운영 심사 확인.' }),
  candidate({ serviceId: 'kopis', name: 'KOPIS 공연정보', category: '일정·문화·주거', homeUrl: 'https://kopis.or.kr', priority: 2, access: 'public-key',
    sourceUrl: 'https://kopis.or.kr/por/cs/openapi/openApiInfo.do?menuId=MNU_00077', documentedScope: '공연·시설 목록 및 상세 등 공개 API. 발급 키 관리와 출처 표기 필요.',
    proposedActions: ['지역 공연 찾기', '공연 상세 조회'], nextStep: '최신 가이드의 요청 규격·HTTPS 제공·출처 표기를 확인하고 키로 검증.' }),
  candidate({ serviceId: 'library-naru', name: '도서관 정보나루', category: '교육·도서', homeUrl: 'https://www.data4library.kr', priority: 2, access: 'public-key',
    sourceUrl: 'https://www.data4library.kr/apiUtilization', documentedScope: '참여 도서관 목록·서지·인기 대출 등 API. 공식 MCP 활용 안내도 제공.',
    proposedActions: ['동네 도서관 찾기', '도서 소장·대출 가능 여부 조회'], nextStep: 'API와 기존 MCP의 범위를 비교하고 HTTPS·도서관별 자료 시점을 검증.' }),
  candidate({ serviceId: 'seoul-bike', name: '서울 따릉이', category: '지도·교통', homeUrl: 'https://www.bikeseoul.com', priority: 2, access: 'public-key',
    sourceUrl: 'https://data.seoul.go.kr/dataList/OA-15493/A/1/datasetView.do', documentedScope: '서울 열린데이터광장의 공공자전거 실시간 대여정보 데이터셋.',
    proposedActions: ['대여소 잔여 자전거 조회'], nextStep: 'API 키·HTTPS·페이지 범위·갱신 주기 검증. 이용권 결제·대여 실행은 별도.' }),
  candidate({ serviceId: 'kosis', name: 'KOSIS 지역통계', category: '공공·세무', homeUrl: 'https://kosis.kr', priority: 2, access: 'public-key',
    sourceUrl: 'https://kosis.kr/serviceInfo/openAPIGuide.do', documentedScope: '통계자료 Open API 제공 안내. 생활 지역 통계에 활용 가능.',
    proposedActions: ['지역 생활 통계 조회'], nextStep: '사용할 통계표 ID·단위·기준 시점·키 조건 검증.' }),
  candidate({ serviceId: 'tourapi', name: '한국관광 TourAPI', category: '여행·지역생활', homeUrl: 'https://api.visitkorea.or.kr', priority: 2, access: 'unknown',
    sourceUrl: 'https://api.visitkorea.or.kr', documentedScope: null, proposedActions: ['지역 관광지·축제 찾기'], nextStep: '현재 제공 서비스 버전·관광 정보 필드·키 조건을 공식 개발 문서에서 확인.' }),
  candidate({ serviceId: 'foodsafety', name: '식품안전나라', category: '날씨·환경', homeUrl: 'https://www.foodsafetykorea.go.kr', priority: 2, access: 'unknown',
    sourceUrl: 'https://www.foodsafetykorea.go.kr/apiMain.do', documentedScope: null, proposedActions: ['회수·판매중지 식품 조회'], nextStep: '회수 정보의 정확한 서비스 ID·공개 필드·키 발급·HTTPS 확인.' }),
  candidate({ serviceId: 'lh', name: 'LH 청약플러스', category: '일정·문화·주거', homeUrl: 'https://apply.lh.or.kr', priority: 2, access: 'unknown',
    sourceUrl: 'https://apply.lh.or.kr', documentedScope: null, proposedActions: ['임대·분양 공고 찾기'], nextStep: '공공 공고 API·갱신 주기와 청약 신청·자격 확인의 별도 권한 조사.' }),
  candidate({ serviceId: 'tmap', name: 'TMAP', category: '지도·교통', homeUrl: 'https://www.tmap.co.kr', priority: 2, access: 'unknown',
    sourceUrl: 'https://openapi.sk.com/products/detail?svcSeq=4', documentedScope: null, proposedActions: ['경로·소요시간 조회'], nextStep: '개발자 상품별 요금·키·경로 API 범위 확인. 소비자 계정·저장 장소와 구분.' }),
  candidate({ serviceId: '11st', name: '11번가', category: '쇼핑·중고', homeUrl: 'https://www.11st.co.kr', priority: 2, access: 'merchant',
    sourceUrl: 'https://openapi.11st.co.kr/openapi/OpenApiFrontMain.tmall', documentedScope: '상품·주문·취소/교환/반품 등 API 안내와 키 발급 경로 확인.',
    proposedActions: ['허용된 상품 정보 조회'], nextStep: '접근 주체·상품 검색 제공 범위·키 유효기간 확인. 소비자 구매내역과 구분.' }),
  candidate({ serviceId: 'naver-shopping', name: '네이버 쇼핑·스마트스토어', category: '쇼핑·중고', homeUrl: 'https://shopping.naver.com', priority: 2, access: 'merchant',
    sourceUrl: 'https://apicenter.commerce.naver.com/docs/commerce-api/current', documentedScope: '커머스API의 상품·주문·정산·판매자정보 및 인증 문서.',
    proposedActions: ['판매자 소유 상품·주문 조회'], nextStep: '판매자 권한과 기존 네이버 검색 API를 분리하고 인증·개인정보 최소 필드 검증.' }),
  ...[
    ['naver-booking', '네이버 예약', '의료·예약', 'https://booking.naver.com', '예약 상품·내 예약 조회'],
    ['catchtable', '캐치테이블', '의료·예약', 'https://www.catchtable.co.kr', '매장·예약 정보 조회'],
    ['socar', '쏘카', '지도·교통', 'https://www.socar.kr', '차량·대여 장소 찾기'],
    ['nol', 'NOL', '여행·지역생활', 'https://nol.yanolja.com', '숙소·여가 상품 찾기'],
    ['yes24-ticket', 'YES24 티켓', '일정·문화·주거', 'https://ticket.yes24.com', '공연 일정 찾기'],
    ['ssg', 'SSG.COM', '쇼핑·중고', 'https://www.ssg.com', '상품 찾기'],
    ['musinsa', '무신사', '쇼핑·중고', 'https://www.musinsa.com', '상품 찾기'],
    ['ohouse', '오늘의집', '쇼핑·중고', 'https://ohou.se', '상품·시공 업체 찾기'],
    ['cj-logistics', 'CJ대한통운', '배달·지역생활', 'https://www.cjlogistics.com', '사용자 소유 운송장 배송 조회'],
  ].map(([serviceId, name, category, homeUrl, action]) => candidate({
    serviceId: serviceId!, name: name!, category: category!, homeUrl: homeUrl!, priority: 3, access: 'unknown', sourceUrl: homeUrl!, documentedScope: null,
    proposedActions: [action!], nextStep: '소비자용 공식 API·제휴 제공 경로·자동화 허용 범위 확인 후 읽기 행동부터 정의.',
  })),
];

export function expansionServices(existingIds: ReadonlySet<string>): Service[] {
  return appApiBacklog.filter(c => !existingIds.has(c.serviceId)).map(c => ({
    id: c.serviceId, name: c.name, category: c.category, homeUrl: c.homeUrl, candidateActions: c.proposedActions,
    sourceUrl: c.sourceUrl, note: c.documentedScope ? `공식 자료 확인: ${c.documentedScope} 다음 단계: ${c.nextStep}` : `추가 조사 후보입니다. ${c.nextStep}`,
  }));
}
