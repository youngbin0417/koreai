import type { Service, Verification } from '../types.js';
import { requestedApps, type ConnectionPlan, type ProviderNotice } from './requested-apps.js';

export interface ApiCandidate {
  serviceId: string;
  name: string;
  category: string;
  homeUrl: string;
  priority: 1 | 2 | 3;
  access: 'public-key' | 'public-file' | 'public-mcp' | 'merchant' | 'unknown';
  verification: Extract<Verification, 'documented' | 'unresearched'>;
  sourceUrl: string;
  checkedAt: string | null;
  documentedScope: string | null;
  proposedActions: string[];
  draftActionIds: string[];
  implementedActionIds: string[];
  unavailableActionIds?: string[];
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
  candidate({serviceId:'seoul-subway',name:'서울·수도권 지하철',category:'지도·교통',homeUrl:'https://www.seoulmetro.co.kr',priority:1,access:'public-key',checkedAt:'2026-10-25',sourceUrl:'https://www.data.go.kr/data/15143842/openapi.do',documentedScope:'서울시 도착·getTrainSch 공개 sample JSON과 HTTP 조건 확인. 별도 서울교통공사 최단경로이동정보의 현행 path2/getShtrmPath2·역명/코드 구분·구간/환승/시간표 명세·HTTPS 무키 인증 오류 확인. 경로 API 개발 자동승인·운영 심의승인·이용허락 제한 없음. 정상 경로는 본인 키 검증 대기.',proposedActions:['역별 도착정보 조회','역·호선·방향·요일별 예정 시간표','출발·도착역의 공식 경로·환승 조회','공식 노선도 직접 확인'],implementedActionIds:['seoul-subway.arrivals','seoul-subway.timetable','seoul-subway.route'],nextStep:'공식 경로 HTTPS 조회·별도 공공데이터 키 계정·경로/환승 카드·역 선택 출발/도착 초안 구현. 본인 키로 역명·분기·환승 코드 연속성·현재 시간표·제공 구간·한도를 확인. 자체 그래프·코드 자동 대응은 후속. 도착·시간표 HTTP만 운영자의 KOREAI_ALLOW_SEOUL_SUBWAY_HTTP=1 필요.'}),
  candidate({serviceId:'champrice',name:'참가격',category:'쇼핑·중고',homeUrl:'https://www.price.go.kr',priority:2,access:'public-file',checkedAt:'2026-10-21',
    sourceUrl:'https://www.data.go.kr/data/15083256/fileData.do',documentedScope:'한국소비자원 공식 현재/과거 2026년 8월·9월 CSV·키 없는 다운로드 확인. 실제 CP949·8월 246,543행/9월 235,632행·한글 헤더 7개·조사일·빈 할인 정보 확인. 월 선택·파일 검증/7일·64MB 캐시·동시 다운로드 공유 구현. 월간 제공·이용허락 제한 없음. 변환 API는 별도 신청.',
    proposedActions:['상품·판매업소·조사일별 생필품 조사 가격 찾기'],implementedActionIds:['champrice.prices.search'],nextStep:'검토된 8월·9월 선택·상품/제조사/업소/조사일 필터·미리보기·검증된 캐시·모바일 조건 입력/가격·할인·출처 카드·페이지 이동 구현. 새 월은 공식 파일 검토 후 등록하고 상품/용량/단위 식별·가격 비교는 별도 정의. 현재 결제가·재고·최저가를 보장하지 않음.'}),
  candidate({serviceId:'work24',name:'고용24',category:'교육·취업',homeUrl:'https://www.work24.go.kr',priority:2,access:'public-key',checkedAt:'2026-10-21',
    sourceUrl:'https://www.work24.go.kr/cm/e/a/0110/selectOpenApiSvcInfo.do?apiSvcId=000000000000000000000000000060&fullApiSvcId=000000000000000000000000000000%5E000000000000000000000000000001&upprApiSvcId=000000000000000000000000000059',documentedScope:'기업회원 전용·신청/심사 후 인증키 발급. HTTPS 채용정보 목록 XML의 검색어·지역 코드·고용형태·페이지/건수·구인인증번호·급여/마감 원문 확인. 무효 키의 HTTP 200/GO24 서비스 미등록 오류 확인. 공통코드 지역 고정 경로·CMCD/1·2단계 XML 확인.',
    proposedActions:['검색어·지역별 채용공고 조회','공통코드 지역 조회'],implementedActionIds:['work24.jobs.search','work24.regions.list'],nextStep:'전용 기업회원 계정·목록 조회·공식 지역 XLS 285개/고용형태 폼·공고/급여/마감/출처 카드·원래 계정의 페이지 이동·인증 재개·미리보기 구현. 공통코드 지역 조회·명시적 행동 허용·API 수신 코드 카드 구현. 조회 코드의 공고 폼 적용·초안/공고 계정 유지·API 출처 표시 구현. 직종·상세는 후속. 승인받은 본인 키로 정상/빈 목록·필터·페이지·이용 조건/한도 확인. 개인 로그인·이력서·지원·추천·공고 상세는 후속 정의.'}),
  candidate({serviceId:'opgg',name:'OP.GG',category:'게임·e스포츠',homeUrl:'https://op.gg',priority:1,access:'public-mcp',checkedAt:'2026-10-20',
    sourceUrl:'https://github.com/opgginc/opgg-mcp/blob/main/README.ko.md',documentedScope:'공식 Streamable HTTP MCP의 키 없는 도구 목록 29개와 LoL 프로필/최근 전적/라인 통계·TFT 메타 덱·발로란트 요원 응답 확인. 일부 array outputSchema 및 LoL class 데이터 표기 호환 차이는 전용 조회 어댑터로 처리.',
    proposedActions:['LoL 소환사 프로필 조회','LoL 최근 전적 조회','LoL 라인별 챔피언 통계','TFT 메타 덱 조회','발로란트 요원 찾기'],implementedActionIds:['opgg.lol.profile','opgg.lol.matches','opgg.lol.meta','opgg.tft.meta','opgg.valorant.agents'],
    nextStep:'검토된 공개 조회 5개·키 없는 미리보기 구현. 공식 서버의 규격·오류·갱신/패치·한도·출처와 실제 휴대폰 사용을 지속 확인. 다른 게임/지역·빌드/카운터·e스포츠는 후속 정의. 일반 상위 MCP의 승인 정책은 유지.'}),
  candidate({serviceId:'ev-chargers',name:'전기차 충전소',category:'지도·교통',homeUrl:'https://ev.or.kr',priority:1,access:'public-key',checkedAt:'2026-10-20',
    sourceUrl:'https://www.data.go.kr/data/15076352/openapi.do',documentedScope:'한국환경공단 공식 가이드 v1.25(2026-07-01)의 getChargerInfo·지역/ID·충전기 타입/상태·제한/삭제·좌표/변경시각, JSON/XML. HTTPS 무효 키 403/30 확인.',
    proposedActions:['지역별 충전소·충전기 상태 찾기'],implementedActionIds:['ev-chargers.search'],nextStep:'조회·전용 계정·미리보기 구현. 본인 키로 정상/빈·지역/ID·페이지·응답 구조·제한/삭제/상태 시각·한도 검증. 이름/타입/삭제 필터는 받은 페이지 안에서 적용. 반경/거리순·차량 호환·요금·예약은 후속 정의.'}),
  candidate({serviceId:'opinet',name:'오피넷 주유소',category:'지도·교통',homeUrl:'https://www.opinet.co.kr',priority:1,access:'public-key',checkedAt:'2026-10-20',
    sourceUrl:'https://www.opinet.co.kr/user/custapi/openApiInfo.do',documentedScope:'공식 지역코드·지역 저가순 TOP20·ID 상세/유종별 가격 HTTPS API. 일반 API 신청·하루 300회·상업적 이용 조건 확인. 세 무효 키 경로가 HTTP 200의 빈 OIL을 반환해 인증 성공과 구분 불가.',
    proposedActions:['오피넷 지역코드 찾기','지역별 저렴한 주유소 찾기','주유소 상세·유종별 가격 조회'],implementedActionIds:['opinet.regions.list','opinet.stations.cheapest','opinet.stations.get'],nextStep:'세 조회·전용 계정·미리보기 구현. 빈 OIL은 결과 확인 필요로 중단하며 성공 증거를 생성하지 않음. 본인 키로 정상/빈·지역/ID·가격 기준 시각·한도·이용 조건 검증. 반경 검색은 KATEC 좌표 변환을 검증한 뒤 별도 구현.'}),
  candidate({ serviceId: 'naver-search', name: '네이버 도서 검색', category: '교육·도서', homeUrl: 'https://search.naver.com', priority: 2, access: 'unknown', checkedAt: '2026-10-20',
    sourceUrl: 'https://developers.naver.com/notice/article/32564', documentedScope: '쇼핑·책·전문자료 검색은 2026-07-31 종료 공지. 나머지 기존 검색도 현행 약관의 데이터 AI 입력 제한으로 KoreAI에서 중단. API HUB 이용 조건은 별도 확인.',
    notice: {type:'shutdown',checkedAt:'2026-10-20',newKeysClosedOn:'2026-07-31',existingAccessEndsOn:'2026-07-31',title:'네이버 도서 API 종료·검색 AI 이용 제한',message:'기존 키로 신규 연결·실행하지 않습니다. 과거 요청 규격만 보존하며 API 구현/지원 수에서 제외합니다.',url:'https://developers.naver.com/notice/article/32564'},
    proposedActions: ['도서 검색 대체 경로 조사', '검색 AI 이용 허용 경로 확인'], unavailableActionIds:['naver.search.book','naver.book.isbn'], nextStep: 'API HUB의 별도 약관·AI 입력/저장/제3자 전달·키·비용·결과 규격을 확인한 뒤 새 커넥터로 검토. 도서관·ISBN 소장 조회는 정보나루 안내 참조. 과거 파서·작업 이력은 보존.' }),
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
  candidate({ serviceId: 'kosis', name: 'KOSIS 지역통계', category: '공공·세무', homeUrl: 'https://kosis.kr', priority: 2, access: 'public-key', checkedAt:'2026-10-20',
    sourceUrl:'https://kosis.kr/openapi/devGuide/devGuide_0201List.do', documentedScope:'현재 Param 통계자료 JSON·smblChk=Y, 공식 고령인구비율 표 101/DT_1YL20631의 SGG 시도 17개·T10/T001/T002·월/연·단위·수록 시작 확인. 2026-07-15 분당 200건 공지, HTTPS 무효 키 200/11 확인.',
    proposedActions:['지역 생활 통계 조회'], implementedActionIds:['kosis.aging.search'], nextStep:'지역 인구·고령화 조회·전용 계정·미리보기 구현. 본인 키로 다중 지역/항목 인자·정상/빈 결과·연 응답 주기 A/Y·통계부호·단위·수정일·미반환 셀·호출 한도 확인. 시군구·과거 지역·다른 지표는 별도 검토 후 확장.' }),
  candidate({ serviceId: 'tourapi', name: '한국관광 TourAPI', category: '여행·지역생활', homeUrl: 'https://api.visitkorea.or.kr', priority: 2, access: 'public-key', checkedAt:'2026-10-20',
    sourceUrl: 'https://www.data.go.kr/data/15101578/openapi.do', documentedScope:'현재 Swagger·공식 매뉴얼 v4.4(2026-02-10)의 KorService2 법정동 코드·지역 관광정보·행사 조회. 폐기 예정 지역코드 대신 법정동 사용. 세 HTTPS 경로의 무효 키 403/30 확인. 이미지별 이용 조건은 별도.',
    proposedActions:['법정동 지역 찾기','지역 관광정보 조회','축제·행사 조회'], implementedActionIds:['tourapi.regions.list','tourapi.places.search','tourapi.festivals.search'], nextStep:'세 실행기·전용 계정·미리보기 구현. 본인 승인 키로 정상/빈 결과·법정동/관광타입 필터·페이지 크기·행사 날짜 검색 의미·한도/운영 심사 검증. 상세·키워드/위치·이미지·예약은 별도 행동. 후속 신규 서비스 순서는 작업 체크리스트에서 관리.' }),
  candidate({ serviceId: 'foodsafety', name: '식품안전나라', category: '날씨·환경', homeUrl: 'https://www.foodsafetykorea.go.kr', priority: 2, access: 'public-key', checkedAt:'2026-10-20',
    sourceUrl:'https://www.foodsafetykorea.go.kr/api/openApiInfo.do?menu_grp=MENU_GRP31&menu_no=661&svc_no=I0490&svc_type_cd=API_TYPE06', documentedScope:'공식 I0490 회수·판매중지 JSON/XML, 등록일·변경일·품목제조보고번호 조건. 공개 HTTPS 샘플과 무효 키 200/INFO-100 확인. 2026-09 변경일 최대 7일·시간대/증분 호출 제한, 개인정보 빈 값 공지 확인.',
    proposedActions:['회수·판매중지 식품 조회'], implementedActionIds:['foodsafety.recalls.search'], nextStep:'조회·전용 계정·경로형 키 없는 미리보기 구현. 본인 키·I0490 승인으로 정상/빈 결과·증분/날짜 경계·범위/전체 수·한도 검증. 이름·바코드는 요청 구간 내 필터이며 개인 제품 해당 여부·안전성은 판정하지 않음. 과거 전체 CSV·알림은 별도 단계. 후속 신규 서비스 순서는 작업 체크리스트에서 관리.' }),
  candidate({ serviceId: 'lh', name: 'LH 청약플러스', category: '일정·문화·주거', homeUrl: 'https://apply.lh.or.kr', priority: 2, access: 'public-key', checkedAt:'2026-10-20',
    sourceUrl:'https://www.data.go.kr/data/15058530/openapi.do', documentedScope:'공식 첨부 20260708 가이드의 분양임대공고 목록 JSON·게시/마감일 범위·유형/지역/상태 표. 포털 요약과 날짜 인자 차이, 가이드의 링크 ID 불일치 확인. HTTPS 무효 키 403/30 확인.',
    proposedActions:['임대·분양 공고 찾기'], implementedActionIds:['lh.notices.search'], nextStep:'조회·전용 계정·미리보기 구현. 본인 승인 키로 정상/빈 결과·최신 날짜/지역 조건·페이지/순번·복합 식별자·상세 링크·한도 검증. 개인 자격·청약 신청·첨부/상세 조회는 별도 단계. 후속 신규 서비스는 작업 체크리스트에서 관리.' }),
  candidate({ serviceId: 'tmap', name: 'TMAP', category: '지도·교통', homeUrl: 'https://www.tmap.co.kr', priority: 2, access: 'public-key',checkedAt:'2026-10-21',
    sourceUrl: 'https://tmapapi.tmapmobility.com/main.html#webservice/docs/tmapRouteDoc',documentedScope:'공식 자동차 경로 v1·POST form·appKey 헤더·WGS84·totalValue=2 요약·거리 m/시간 초/요금 원. 공식 Free 경로안내 일 1,000건 및 유료 조건·데이터 24시간 사용 제한 확인.',
    proposedActions:['자동차 경로·소요시간 조회'],implementedActionIds:['tmap.route.car'],nextStep:'요약 조회·전용 계정·미리보기·결과/대화 만료 구현. 본인 앱 키로 정상/미지원 좌표·상품 권한·요금/한도 확인. 보행·대중교통·미래 시각·경유지·지도 형상은 후속 정의.' }),
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
