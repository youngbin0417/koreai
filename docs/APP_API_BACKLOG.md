# 앱·API 확장 계획

정리일: **2026-10-20**. 초기 26개 후보와 요청 앱·대안 36개를 중복 병합한 뒤 네이버 도서 검색·전기차 충전소·오피넷·OP.GG를 추가해 확장 후보는 **62개**, 전체 카탈로그는 **102개 서비스**입니다. 네이버 도서는 기존 네이버 검색 서비스·커넥터를 사용합니다. 아래 표는 주요 후보이며, 추가 요청의 전체 목록과 첫 연결 초안은 [요청 앱 목록](REQUESTED_APPS.md)에 있습니다. 우선순위는 생활 과업 기여도·공식 접근 가능성·유지보수 부담을 기준으로 한 개발 제안입니다.

구현 상태 갱신: **2026-10-20**, TourAPI 세 조회·식품안전나라 회수·판매중지·LH 공고·KOSIS 지역 인구/고령화 조회까지 구현했습니다. 2026-10-19에는 KOPIS·네이버 도서·정보나루·HIRA·치지직·동물병원 조회를 추가했습니다. 동물병원은 실제 강남구 파일의 HTTP 전체 흐름을 검증했으며 다른 신규 API는 본인 키의 정상 응답 검증이 남아 있습니다. 공개 샘플·문서 예제와 실계정 검증도 구분합니다. 알라딘 종료 공지도 반영했습니다. 따릉이 검토일은 2026-10-17, 나이스·KOBIS는 2026-10-15, 에어코리아·TAGO·E-Gen은 2026-10-14, 기상청은 2026-10-12입니다.

원본 데이터는 [`src/research/app-api-backlog.ts`](../src/research/app-api-backlog.ts), 행동 초안은 [`src/connectors/drafts/index.ts`](../src/connectors/drafts/index.ts)에 있습니다. 관리 화면의 **확장 계획**에서 같은 자료를 검색할 수 있습니다.

**공식 공개 MCP는 별도로 1개 커넥터·5개 조회**입니다. OP.GG의 LoL 프로필·최근 경기·라인별 챔피언 통계, TFT 메타 덱, 발로란트 요원 목록을 키 없이 실행합니다. 프로젝트 HTTP API에서 실제 다섯 행동의 성공을 확인했습니다. API 구현 수에는 더하지 않고, 시험 DB의 검증 증거를 사용자 DB에 가져오지 않습니다. [사용·구현 범위](OPGG.md).

전기차 충전소 1개·오피넷 3개 조회와 두 전용 계정·미리보기를 추가했습니다. EV 공식 v1.25의 지역/상태/제한/삭제·평면 JSON과 XML, 오피넷 지역코드·저가순·ID 상세/유종별 가격·KATEC를 구현했습니다. 실제 무효 키의 EV 403/30은 인증 대기, 오피넷 200의 빈 OIL은 **결과 확인 필요**로 중단합니다. 본인 키 정상 응답·최신 자료·한도·이용 조건 검증은 대기입니다. [사용 안내](VEHICLE_ENERGY.md).

**네이버 검색 7개를 제외한 공식 API 구현은 24개 커넥터·43개 행동**입니다. 확장 API는 도서 2개를 제외한 **28개**, 공공파일 1개·공개 MCP 5개를 합치면 활성 확장 정의는 34개입니다. 과거 코드·규격을 보존한 중단 행동은 구현/지원 집계에서 제외합니다. 따릉이는 HTTP 전송을 운영자가 허용해야 실행되고, 신규 실행기의 실제 키 검증과 공개 지원 지정도 구분합니다. 후보의 `implementedActionIds`·`draftActionIds`·`unavailableActionIds`가 활성 구현·초안·중단 규격을 구분합니다. 미조사 후보의 홈페이지 등록은 API 존재·이용 허용을 확인했다는 뜻이 아닙니다.

네이버 도서 `naver.search.book`·`naver.book.isbn`과 쇼핑 검색은 [공식 종료 공지](https://developers.naver.com/notice/article/32564)로 중단했습니다. 뉴스·블로그·카페글·지역 검색도 현재 검색 약관의 AI 입력 제한 때문에 이 프로젝트에서는 중단합니다. 과거 키·권한·증거가 있어도 실행하지 않습니다. [상태·API HUB 후속 조건](NAVER_AVAILABILITY.md), [과거 도서 규격](NAVER_BOOKS.md), [정보나루](LIBRARY_NARU.md)를 참고하세요.

정보나루는 공식 매뉴얼 v20260620의 `library-naru.libraries.search`·`library-naru.collections.search`·`library-naru.book.status`를 구현했습니다. 세 HTTPS XML 경로의 무효 키 오류를 실제 실행기에서 인증 대기로 확인했습니다. 소장 제공값·전날 기준 대출 상태·현재 상태를 구분하며 본인 키의 정상 응답·등록 서버 IP·사용량 검증은 남아 있습니다. 공식 MCP 매뉴얼의 주소·`X-Auth-Key`·공유 사용량과 후속 항목도 [사용 안내](LIBRARY_NARU.md)에 기록했습니다.

**공공파일은 별도로 1개 커넥터·1개 행동**입니다. `animal-hospitals.search`는 키 없이 지역별 동물병원 CSV를 조회합니다. API 구현 수에는 더하지 않으며 강남구의 실제 파일 확인과 다른 지역·운영 한도 검증을 구분합니다. [사용·결과 안내](ANIMAL_HOSPITALS.md)

HIRA는 `hira.hospitals.search`를 추가했습니다. 현재 공식 Swagger의 v2 병원 기본목록·지역/종별/진료과목 필터·암호화 요양기호와 출처를 보존합니다. 공식 코드 조회·첨부 가이드와 무효 키의 HTTPS 403/30을 확인했으며 본인 키·정상/빈 결과·운영 조건 검증은 남아 있습니다. [사용·결과 안내](HIRA.md)

KOPIS는 `kopis.performances.search`·`kopis.performances.get`을 추가했습니다. 공식 개발 가이드 v5.0의 XML·지역/장르·31일·출처 조건을 확인하고, 정규 HTTPS 두 경로의 무효 키 200/02를 인증 대기로 처리했습니다. 현재 좌석·회차별 최종 가격은 미확인이고 본인 키의 정상/빈 결과·상세 예매처 구조·한도 검증은 남아 있습니다. [사용·결과 안내](KOPIS.md).

TourAPI는 `tourapi.regions.list`·`tourapi.places.search`·`tourapi.festivals.search`를 추가했습니다. 현재 Swagger와 공식 v4.4의 법정동 코드·관광타입·원문 취소/연기·출처 조건, 세 HTTPS 경로의 무효 키 403/30을 확인했습니다. 본인 키의 정상/빈 결과·페이지 반환 크기·행사 날짜 경계·운영 심사는 남아 있습니다. [사용·결과 안내](TOURAPI.md).

식품안전나라는 `foodsafety.recalls.search`를 추가했습니다. 공식 I0490의 경로형 필터·본인 키/서비스 이용신청·최신 운영 공지, HTTPS 공개 샘플과 무효 키의 200/INFO-100을 확인했습니다. 제품명·바코드는 구간 내 필터이며 제조일·기한·등급은 원문으로 보존하고 제품 안전성을 판정하지 않습니다. 본인 키·증분/구간·한도 검증은 남아 있습니다. [사용·결과 안내](FOODSAFETY.md).

LH는 `lh.notices.search`·전용 계정·미리보기를 추가했습니다. 20260708 첨부 가이드의 날짜/지역·JSON 구조·복합 ID·순번/전체 수·링크 대조와 HTTPS 무효 키 403/30을 확인했습니다. 포털 요약과 날짜 인자 차이·문서 예제 링크 불일치는 실계정 검증과 구분해 기록했습니다. [사용·결과 안내](LH.md).

KOSIS는 `kosis.aging.search`·전용 계정·미리보기를 구현했습니다. 공식 101/DT_1YL20631의 전국·시도·비율/인구·월/연·단위를 확인했고 숫자 문자열·통계부호·기준 시점·미반환 셀을 구분합니다. 최신 분당 200건 공지와 HTTPS 무효 키 200/11 인증 대기를 확인했습니다. 본인 키의 정상 응답 검증은 대기입니다. [사용 안내](KOSIS.md). 다음 신규 후보는 TMAP 경로·소요시간의 상품·키·요금·제공 범위 확인입니다.

## 1순위: 조회 초안을 실행기로 발전

| 서비스 | 첫 행동 / 공식 확인 범위 | 이번 적용 | 다음 작업 |
|---|---|---|---|
| OP.GG | 키 없는 게임 정보. [공식 공개 MCP](https://github.com/opgginc/opgg-mcp/blob/main/README.ko.md) | `opgg.lol.profile`, `opgg.lol.matches`, `opgg.lol.meta`, `opgg.tft.meta`, `opgg.valorant.agents`: 다섯 실제 HTTP 조회 성공·전용 파서·미리보기·모바일 크기 UI | 미존재 ID·빈 결과·한도·다른 지역·후속 게임 도구와 실제 휴대폰 대화 검증. [사용법](OPGG.md) |
| 기상청 | 초단기실황 조회. [단기예보 API](https://www.data.go.kr/data/15084084/openapi.do) | `kma.observation`: 실제 실행기·계정 화면, 시각/격자 대조, 단위·결측·오류 처리, 모의 검증 | 실제 키 응답 검증, 주소→격자 변환, 예보 조회 |
| 에어코리아 | 대기질 예보. [대기오염정보 API](https://www.data.go.kr/data/15073861/openapi.do) | `airkorea.forecast`: 실행기·계정 화면, 발표/예보 날짜 구분, 등급/설명 원문·출처 보존·모의 검증 | 운영 권한·실제 키 응답 확인, 측정소별 현재 관측 조회 |
| TAGO | 지원 도시·정류소 검색·도착정보. [도착정보](https://www.data.go.kr/data/15098530/openapi.do), [정류소정보](https://www.data.go.kr/data/15098534/openapi.do) | `tago.cities`, `tago.bus.stops`, `tago.bus.arrivals`: 실행기·계정 화면·초/분·자료 시각·모의 검증 | 두 API의 실제 권한·지역별 제공 범위·빈 응답·갱신 조건 확인 |
| E-Gen | 전국 병·의원 검색. [병·의원 찾기 API](https://www.data.go.kr/data/15000736/openapi.do) | `egen.hospitals.search`: XML 실행기·계정 화면·연락처·요일별 시간·출처·모의 검증 | 실제 키·정보 갱신 조건, 진료과목/기관분류 필터·상세 조회 |
| 나이스 | 공개 학교 검색·급식. [학교기본정보](https://open.neis.go.kr/portal/data/service/selectServicePage.do?infId=OPEN17020190531110010104913&infSeq=2), [급식식단](https://open.neis.go.kr/portal/data/service/selectServicePage.do?infId=OPEN17320190722180924242823&infSeq=2) | `neis.schools.search`, `neis.meals`: 실행기·계정 화면·학교코드/주소·알레르기 원문·빈 자료 구분 | 실제 키·동명 학교 구분·지역/식사별 자료·학사일정 정의 |
| KOBIS | 일별 박스오피스. [공식 상세 규격](https://www.kobis.or.kr/kobisopenapi/homepg/apiservice/searchServiceDesc.do?apiSvcId=searchDailyBoxOffice) | `kobis.boxoffice.daily`: 실행기·계정 화면·날짜 대조·순위/관객수·매출 문자열 보존 | 실제 키·정상/빈 응답·한도 조건 검증, 영화 상세·주간 조회 정의 |
| 서울 따릉이 | 대여소 실시간 정보·최대 1,000건. [공식 데이터셋](https://data.seoul.go.kr/dataList/OA-15493/A/1/datasetView.do) | `seoul-bike.stations`: 구간 조회·로컬 이름/ID 필터·관측 시각 미제공·HTTP 기본 차단 | 본인 키·구간/빈 결과·한도 확인, 공식 HTTPS 재확인. [사용법](SEOUL_BIKE.md) |

치지직은 `chzzk.lives.list`·`chzzk.channels.get`의 Client 헤더 인증·최대 20개·커서/다중 ID 검증과 계정 화면을 추가했습니다. [공식 라이브 규격](https://chzzk.gitbook.io/chzzk/chzzk-api/live), [채널 규격](https://chzzk.gitbook.io/chzzk/chzzk-api/channel), [사용법](CHZZK.md)을 참고하세요.

위 8개 서비스는 공식 페이지·메타데이터에서 확인한 요청 주소와 변수로 템플릿을 구성했습니다. KOBIS·치지직 HTTPS 경로는 무효 시험 키로 오류 구조까지, 따릉이는 공식 공개 샘플의 HTTP 응답을 확인했습니다. 실제 사용자 키의 정상 응답을 확인한 상태는 아닙니다. 관행적으로 알려진 경로나 비공식 예제의 키를 실행 코드에 넣지 않습니다.

### 요청 구조 확인 방법

1. `npm run build` 후 `npm start`로 엔진을 실행합니다.
2. 관리 화면 **확장 계획 → 1순위 → 조회 기능 열기**를 선택합니다.
   TAGO는 **지원 도시 목록·버스 정류소 찾기·버스 도착예정 조회** 행동 이름으로 선택합니다.
   나이스는 **학교 찾기·학교 급식 조회** 행동 이름으로 선택합니다.
3. **예시 입력 불러오기 → 요청 구조 미리보기**로 입력 검증과 요청 매핑을 확인합니다.

미리보기는 외부 요청·작업 생성·키 조회 없이 동작합니다. 입력에 API 키·임의 URL 필드를 추가하면 거절합니다. 예시는 형식 검토용이며 해당 날짜·학교·정류소의 실제 데이터 존재를 보증하지 않습니다. 구성된 계정이나 에이전트 권한이 있어도 초안의 실행 요청은 `NOT_IMPLEMENTED`로 거절됩니다.

기상청은 `kma-api` 계정을 연결하고 `kma.observation`을 허용하면 실행 요청이 가능합니다. 예시는 한국 표준시 최근 발표 정시를 계산하며, 실제 호출과 지원 상태는 [기상청 사용 안내](../README.md#기상청-날씨-조회), [검증 기록](VALIDATION.md)을 참고합니다.

에어코리아는 `airkorea-api` 계정에서 `airkorea.forecast`를 허용합니다. 날짜는 예보가 발표된 날짜이며 페이지 입력은 제거했습니다. 예보 대상 날짜와 원문 등급은 결과에 따로 보존합니다. [에어코리아 사용 안내](AIRKOREA.md)

TAGO는 `tago-api` 계정에서 필요한 도시·정류소·도착 행동을 선택합니다. 두 API의 활용신청과 앞 단계 결과를 이용하는 순서는 [TAGO 사용 안내](TAGO.md)를 따릅니다.

E-Gen은 `egen-api` 계정을 연결하고 `egen.hospitals.search`를 허용합니다. 지역·이름·진료요일로 검색하며 제공된 일정과 현재 진료 가능 여부를 구분합니다. [E-Gen 사용 안내](EGEN.md)

나이스는 `neis-api` 계정의 `apiKey`를 등록하고 학교 검색 → 코드·지역 확인 → 급식 조회 순서로 사용합니다. 본인 키가 없는 경우 공개 샘플로 실행하지 않습니다. [나이스 사용 안내](NEIS.md)

KOBIS는 `kobis-api` 계정의 `apiKey`를 등록해 날짜별 최대 10개 영화를 조회합니다. 조회 날짜·상영 일정·자료 갱신 시각을 구분하며 매출액은 원문 숫자 문자열로 보존합니다. [KOBIS 사용 안내](KOBIS.md)

## 2순위: 공식 경로와 동작 범위 검증

| 후보 | 먼저 정의할 행동 | 공식 근거 또는 조사 시작점 | 남은 확인 |
|---|---|---|---|
| 건강보험심사평가원 | 병원 기본목록 검색·지역/종별/진료과목 필터 | [병원정보서비스](https://www.data.go.kr/data/15001698/openapi.do) — v2 실행기·계정·미리보기 구현 | 본인 키·정상/빈 결과·운영 심사·자료 시점 검증. 코드 탐색·상세·평가·비급여는 후속. [사용법](HIRA.md) |
| KOPIS | 지역 공연·공연 상세 | [Open API 안내](https://kopis.or.kr/por/cs/openapi/openApiInfo.do?menuId=MNU_00077) — 두 조회·계정·미리보기 구현, HTTPS 무효 키 오류 확인 | 본인 키 정상/빈 결과·예매처 구조·한도 검증. [사용법](KOPIS.md). 티켓 예매는 별도 |
| 도서관 정보나루 | 도서관 찾기·ISBN 소장 도서관·개별 소장/대출 제공값 | [API 활용방법](https://www.data4library.kr/apiUtilization) — 세 실행기·전용 계정·미리보기 구현 | 본인 키·등록 IP·정상/빈 응답·자료 시점 확인. 이름/지역 코드 탐색·MCP 비밀 헤더 주입은 후속. [사용법](LIBRARY_NARU.md) |
| 서울 따릉이 | 대여소 잔여 자전거 | [실시간 대여정보](https://data.seoul.go.kr/dataList/OA-15493/A/1/datasetView.do) — 실행기 구현·본인 키 미검증 | HTTP는 운영자 설정 전 차단. HTTPS 재확인·실제 키 검증. 결제·대여 확정은 별도 |
| KOSIS | 지역 인구·고령화 지표 | [현재 통계자료 가이드](https://kosis.kr/openapi/devGuide/devGuide_0201List.do)·공식 표 — 조회 구현·무효 키 확인 | 본인 키 정상 응답·다중 선택·월/연·통계부호·단위·시점·개편/미반환 셀·한도. [안내](KOSIS.md) |
| 전기차 충전소 | 지역별 충전소·보고 상태·제한 | [한국환경공단 API](https://www.data.go.kr/data/15076352/openapi.do)·v1.25 — 조회 구현·무효 키 확인 | 본인 키 정상/빈·지역/ID·JSON/XML·문서 필수 표기 차이·페이지·상태 시각·최신 코드·한도. [안내](VEHICLE_ENERGY.md) |
| 오피넷 | 지역코드·저가순 주유소·상세 가격 | [공식 API](https://www.opinet.co.kr/user/custapi/openApiInfo.do) — 3개 조회 구현·무효 키 빈 응답 확인 | 본인 키 정상/빈·한도·가격 시각·KATEC·이용 조건. 빈 목록은 인증 성공과 구분 불가해 결과 확인 필요로 중단 |
| TourAPI | 법정동 지역·관광지·축제 찾기 | [공식 Swagger·국문 매뉴얼](https://www.data.go.kr/data/15101578/openapi.do) — 세 조회·계정·미리보기 구현, HTTPS 무효 키 오류 확인 | 본인 키·정상/빈 결과·날짜 검색 경계·페이지·한도 검증. [사용법](TOURAPI.md) |
| 식품안전나라 | 회수·판매중지 공고 | [공식 I0490 명세](https://www.foodsafetykorea.go.kr/api/openApiInfo.do?menu_grp=MENU_GRP31&menu_no=661&svc_no=I0490&svc_type_cd=API_TYPE06) — 조회·계정·미리보기 구현, HTTPS 공개 샘플·인증 오류 확인 | 본인 키·증분 날짜·구간/전체 수·한도 검증. [사용법](FOODSAFETY.md) |
| LH 청약플러스 | 임대·분양 공고 | [공식 API·첨부 가이드](https://www.data.go.kr/data/15058530/openapi.do) — 조회·계정·미리보기·링크 대조 구현, HTTPS 무효 키 오류 확인 | 본인 키·날짜 인자·지역/상태·페이지·한도 검증. [사용법](LH.md). 자격 판정·신청은 별도 |
| TMAP | 경로·소요시간 | [개발자 상품](https://openapi.sk.com/products/detail?svcSeq=4) — 상세 범위 미조사 | 상품별 요금·키·조회 범위. 앱 계정의 저장 장소와 구분 |
| 11번가 | 허용된 상품 정보 | [Open API 센터](https://openapi.11st.co.kr/openapi/OpenApiFrontMain.tmall) — 문서 확인 | 접근 주체·상품 검색 범위·키 만료. 판매자 주문 API를 소비자 구매내역으로 표시하지 않음 |
| 네이버 쇼핑·스마트스토어 | 판매자 소유 상품·주문 | [커머스API](https://apicenter.commerce.naver.com/docs/commerce-api/current) — 문서 확인 | 판매자 인증·최소 출력 필드. 기존 검색 API·소비자 구매내역과 구분 |

## 3순위: 일반 앱의 API·제휴 경로 조사

아래 행동은 제품 후보입니다. **공식 서비스 홈페이지만 등록했으며 API 제공 여부·자동화 허용·소비자 계정 접근을 확인하지 않았습니다.** 브라우저 자동화 활성화 전에 이용조건과 사용자 권한을 따로 확인합니다.

| 앱 | 첫 조회 후보 | 조사 시작점 |
|---|---|---|
| 네이버 예약 | 상품·내 예약 조회 | [네이버 예약](https://booking.naver.com/) |
| 캐치테이블 | 매장·예약 정보 조회 | [캐치테이블](https://www.catchtable.co.kr/) |
| 쏘카 | 차량·대여 장소 찾기 | [쏘카](https://www.socar.kr/) |
| NOL | 숙소·여가 상품 찾기 | [NOL](https://nol.yanolja.com/) |
| YES24 티켓 | 공연 일정 찾기 | [YES24 티켓](https://ticket.yes24.com/) |
| SSG.COM | 상품 찾기 | [SSG.COM](https://www.ssg.com/) |
| 무신사 | 상품 찾기 | [무신사](https://www.musinsa.com/) |
| 오늘의집 | 상품·시공 업체 찾기 | [오늘의집](https://ohou.se/) |
| CJ대한통운 | 사용자 소유 운송장 배송 조회 | [CJ대한통운](https://www.cjlogistics.com/) |

기존 강남언니·당근·컬리·쿠팡·토스는 [기본 연결 계획](LIFESTYLE_CONNECTIONS.md)을 이어갑니다. 각각 조회 행동과 접근 주체를 정의한 뒤 승인·결과 확인이 필요한 쓰기 행동을 추가합니다.

## 행동을 활성화할 때

- 초안의 공급자 실행기를 구현하고 고정 도메인·HTTPS·응답 제한·오류·비밀정보 제거를 확인합니다. 따릉이의 확인된 공식 경로는 HTTP이므로 별도의 운영자 환경 변수로만 허용하며, 기본 차단·암호화되지 않는 키 전송 조건을 화면과 문서에 표시합니다. 다른 커넥터의 HTTPS 요구를 완화하지 않습니다.
- 공공데이터 키도 서비스별 계정 종류로 구분합니다. 같은 키로 모든 데이터셋이 자동 허용된다고 간주하지 않습니다.
- 출력에는 출처·조회 시각·자료 기준 시각·단위·빈 결과를 포함합니다. 외부 내용은 데이터로 취급합니다.
- 모의 응답 검증 후 사용자 소유 실제 키로 읽기를 확인합니다. 구현 완료와 실제 계정 검증을 별도 기록합니다.
- 예약·게시·결제 등 쓰기는 독립 행동으로 추가하고 사용자 승인·멱등 처리·결과 확인을 검증합니다.

문서·입력 초안 → 요청/응답 실행기 → 모의 검증 → 실제 계정 검증 → 배포 지원의 순서로 상태를 올립니다.
