import type { Service, Verification } from '../types.js';
import { requestedApps, type ConnectionPlan, type ProviderNotice } from './requested-apps.js';

export interface ApiCandidate {
  serviceId: string;
  name: string;
  category: string;
  homeUrl: string;
  priority: 1 | 2 | 3;
  access: 'public-key' | 'public-file' | 'merchant' | 'unknown';
  verification: Extract<Verification, 'documented' | 'unresearched'>;
  sourceUrl: string;
  checkedAt: string | null;
  documentedScope: string | null;
  proposedActions: string[];
  draftActionIds: string[];
  implementedActionIds: string[];
  nextStep: string;
  connectionPlan?: ConnectionPlan;
  notice?: ProviderNotice;
}

const checkedAt = '2026-10-11';
type CandidateInput = Omit<ApiCandidate, 'verification' | 'checkedAt' | 'draftActionIds' | 'implementedActionIds'> & { draftActionIds?: string[]; implementedActionIds?: string[]; checkedAt?: string };
function candidate(input: CandidateInput): ApiCandidate {
  return { ...input, draftActionIds: input.draftActionIds ?? [], implementedActionIds: input.implementedActionIds ?? [], verification: input.documentedScope ? 'documented' : 'unresearched', checkedAt: input.documentedScope ? input.checkedAt ?? checkedAt : null };
}

// Proposed actions are product ideas; documentedScope describes only the reviewed source.
export const appApiBacklog: ApiCandidate[] = [
  candidate({ serviceId: 'naver-search', name: '네이버 도서 검색', category: '교육·도서', homeUrl: 'https://search.naver.com', priority: 2, access: 'public-key', checkedAt: '2026-10-19',
    sourceUrl: 'https://developers.naver.com/docs/serviceapi/search/book/book.md', documentedScope: '기존 검색 앱 키로 키워드 JSON 검색과 제목/ISBN XML 상세 검색. 앱별 검색 API 사용량 공유. 서점 재고·구매내역은 포함하지 않음.',
    proposedActions: ['도서 검색', 'ISBN 도서 조회'], implementedActionIds: ['naver.search.book', 'naver.book.isbn'], nextStep: '검색·ISBN 실행기와 미리보기 구현. 기존 계정에도 두 행동을 명시적으로 허용한 뒤 본인 키로 정상/빈 결과·권한 오류를 검증. 도서관 소장·대출 여부는 정보나루의 별도 키·제공 시점 확인 후 구현.' }),
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
  candidate({ serviceId: 'neis', name: '나이스 교육정보', category: '교육·도서', homeUrl: 'https://open.neis.go.kr', priority: 1, access: 'public-key', checkedAt: '2026-10-15',
    sourceUrl: 'https://open.neis.go.kr/portal/data/service/selectServicePage.do?infId=OPEN17320190722180924242823&infSeq=2', documentedScope: '공개 학교기본정보 검색과 학교 급식식단: 일자별 요리명·원산지·칼로리·영양 정보.',
    proposedActions: ['학교 급식 조회', '학교·학사일정 찾기'], implementedActionIds: ['neis.schools.search', 'neis.meals'], nextStep: '학교 검색·급식 조회 실행기와 계정 화면 구현. 실제 키·동명 학교·지역별 급식 제공 범위 검증과 학사일정은 다음 단계. 개인 학생정보는 별도 범위.' }),
  candidate({ serviceId: 'kobis', name: 'KOBIS 영화정보', category: '일정·문화·주거', homeUrl: 'https://www.kobis.or.kr', priority: 1, access: 'public-key', checkedAt: '2026-10-15',
    sourceUrl: 'https://www.kobis.or.kr/kobisopenapi/homepg/apiservice/searchServiceDesc.do?apiSvcId=searchDailyBoxOffice', documentedScope: '일별 박스오피스의 날짜·최대 10개 결과, 영화 코드·순위·관객수·매출 집계. 공식 HTTPS 경로·무효 키 오류 확인.',
    proposedActions: ['일별 박스오피스 조회', '영화 정보 찾기'], implementedActionIds: ['kobis.boxoffice.daily'], nextStep: '일별 실행기·계정 화면 구현. 실제 본인 키의 정상/빈 응답·한도 조건 검증과 영화 상세·주간 조회는 다음 단계. 극장별 상영시간과 예매는 별도.' }),
  candidate({ serviceId: 'hira', name: '건강보험심사평가원', category: '의료·예약', homeUrl: 'https://www.hira.or.kr', priority: 2, access: 'public-key', checkedAt: '2026-10-19',
    sourceUrl: 'https://www.data.go.kr/data/15001698/openapi.do', documentedScope: '현재 Swagger의 hospInfoServicev2 병원 기본목록 XML. 신고 기준 기관명·지역·종별·진료과목 검색과 암호화 요양기호 제공. 공식 지역 코드·HTTPS 무효 키의 403/30 확인.',
    proposedActions: ['병원 찾기', '공개 병원 정보 상세 조회'], implementedActionIds: ['hira.hospitals.search'], nextStep: '병원 검색 실행기·전용 계정·요청 미리보기 구현. 본인 병원정보서비스 승인 키로 정상/빈 응답·지역/종별·한도·운영 심사·자료 시점 검증. 상세·평가·비급여·E-Gen ID 연계는 별도 행동으로 확인.' }),
  candidate({ serviceId: 'kopis', name: 'KOPIS 공연정보', category: '일정·문화·주거', homeUrl: 'https://kopis.or.kr', priority: 2, access: 'public-key', checkedAt: '2026-10-19',
    sourceUrl: 'https://kopis.or.kr/por/cs/openapi/openApiInfo.do?menuId=MNU_00077', documentedScope: '공식 가이드 v5.0(2026-04-23)의 공연 검색·상세 XML, 최대 31일·100건. 공통 지역/장르/상태 코드·개인 인증키·출처 표시 조건 확인. HTTPS 정규 주소의 무효 키 200/02 확인.',
    proposedActions: ['지역 공연 찾기', '공연 상세 조회'], implementedActionIds: ['kopis.performances.search','kopis.performances.get'], nextStep: '검색·상세 실행기·전용 계정·미리보기 구현. 본인 키로 정상/빈 결과·지역/장르·상세 예매처 구조·사용량 검증. 전체 건수·회차/좌석·최종 결제 가격은 미확인. 공연시설 상세·축제·예매는 별도 단계.' }),
  candidate({ serviceId: 'library-naru', name: '도서관 정보나루', category: '교육·도서', homeUrl: 'https://www.data4library.kr', priority: 2, access: 'public-key', checkedAt: '2026-10-19',
    sourceUrl: 'https://www.data4library.kr/apiUtilization', documentedScope: '공식 API 매뉴얼 v20260620의 도서관 목록·ISBN 소장 도서관·개별 소장/대출 제공값. HTTPS 무효 키의 authErr 확인. 대출 상태는 전날 기준이며 공식 MCP는 소장 자료의 월 단위 갱신을 안내.',
    proposedActions: ['동네 도서관 찾기', 'ISBN 소장 도서관 찾기', '도서 소장·대출 제공값 조회'], implementedActionIds: ['library-naru.libraries.search', 'library-naru.collections.search', 'library-naru.book.status'], nextStep: '세 조회·전용 계정·XML 미리보기 구현. 본인 승인 키·서버 IP로 정상/빈 응답·한도·실제 자료 시점 검증. MCP의 X-Auth-Key 주입은 별도 구현 전 연결하지 않음. 이름/지역 코드 탐색과 네이버 ISBN→도서관 조회 묶음은 후속 단계.' }),
  candidate({ serviceId: 'seoul-bike', name: '서울 따릉이', category: '지도·교통', homeUrl: 'https://www.bikeseoul.com', priority: 2, access: 'public-key', checkedAt: '2026-10-17',
    sourceUrl: 'https://data.seoul.go.kr/dataList/OA-15493/A/1/datasetView.do', documentedScope: '서울시 실시간 대여정보: 구간별 최대 1,000건, 대여소 ID·잔여 자전거·좌표. 공식 HTTP 샘플 확인, HTTPS 접속 실패. 관측 시각 미제공.',
    proposedActions: ['대여소 잔여 자전거 조회'], implementedActionIds: ['seoul-bike.stations'], nextStep: '조회 실행기·계정 화면 구현. HTTP 키 전송은 운영자 설정 전 차단. 본인 일반 키로 구간·빈 결과·한도 검증, 공식 HTTPS 제공 여부 재확인. 결제·대여 실행은 별도.' }),
  candidate({ serviceId: 'kosis', name: 'KOSIS 지역통계', category: '공공·세무', homeUrl: 'https://kosis.kr', priority: 2, access: 'public-key',
    sourceUrl: 'https://kosis.kr/serviceInfo/openAPIGuide.do', documentedScope: '통계자료 Open API 제공 안내. 생활 지역 통계에 활용 가능.',
    proposedActions: ['지역 생활 통계 조회'], nextStep: '사용할 통계표 ID·단위·기준 시점·키 조건 검증.' }),
  candidate({ serviceId: 'tourapi', name: '한국관광 TourAPI', category: '여행·지역생활', homeUrl: 'https://api.visitkorea.or.kr', priority: 2, access: 'public-key', checkedAt:'2026-10-20',
    sourceUrl: 'https://www.data.go.kr/data/15101578/openapi.do', documentedScope:'현재 Swagger·공식 매뉴얼 v4.4(2026-02-10)의 KorService2 법정동 코드·지역 관광정보·행사 조회. 폐기 예정 지역코드 대신 법정동 사용. 세 HTTPS 경로의 무효 키 403/30 확인. 이미지별 이용 조건은 별도.',
    proposedActions:['법정동 지역 찾기','지역 관광정보 조회','축제·행사 조회'], implementedActionIds:['tourapi.regions.list','tourapi.places.search','tourapi.festivals.search'], nextStep:'세 실행기·전용 계정·미리보기 구현. 본인 승인 키로 정상/빈 결과·법정동/관광타입 필터·페이지 크기·행사 날짜 검색 의미·한도/운영 심사 검증. 상세·키워드/위치·이미지·예약은 별도 행동. 다음 신규 후보는 식품안전나라 회수·판매중지 정보.' }),
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

for (const request of requestedApps) {
  const existing = appApiBacklog.find(item => item.serviceId === request.serviceId);
  if (existing) {
    existing.name = request.name; existing.connectionPlan = request.plan;
    if (request.notice) existing.notice = request.notice;
    if (request.implementedActionIds) existing.implementedActionIds = request.implementedActionIds;
    if (request.checkedAt) existing.checkedAt = request.checkedAt;
    existing.proposedActions = [...new Set([...existing.proposedActions, request.plan.firstRead])];
  } else appApiBacklog.push(candidate({serviceId:request.serviceId,name:request.name,category:request.category,homeUrl:request.homeUrl,sourceUrl:request.sourceUrl,
    priority:request.priority,access:request.plan.method==='official-api'?'public-key':request.plan.method==='public-data'?'public-file':'unknown',documentedScope:request.documentedScope,checkedAt:request.checkedAt??'2026-10-16',
    proposedActions:[request.plan.firstRead],nextStep:request.plan.nextStep,connectionPlan:request.plan,notice:request.notice,implementedActionIds:request.implementedActionIds}));
}

export function expansionServices(existingIds: ReadonlySet<string>): Service[] {
  return appApiBacklog.filter(c => !existingIds.has(c.serviceId)).map(c => ({
    id: c.serviceId, name: c.name, category: c.category, homeUrl: c.homeUrl, candidateActions: c.proposedActions,
    sourceUrl: c.sourceUrl, aliases:c.connectionPlan?.aliases, note: c.documentedScope ? `공식 자료 확인: ${c.documentedScope} 다음 단계: ${c.nextStep}` : `추가 조사 후보입니다. ${c.nextStep}`,
  }));
}
