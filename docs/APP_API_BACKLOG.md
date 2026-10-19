# 앱·API 확장 계획

정리일: **2026-10-19**. 초기 26개 후보와 요청 앱·대안 36개를 중복 병합한 뒤 네이버 도서 검색을 추가해 확장 후보는 **59개**, 전체 카탈로그는 **99개 서비스**입니다. 네이버 도서는 기존 네이버 검색 서비스·커넥터를 사용합니다. 아래 표는 초기 26개 후보이며, 추가 요청의 전체 목록과 첫 연결 초안은 [요청 앱 목록](REQUESTED_APPS.md)에 있습니다. 우선순위는 생활 과업 기여도·공식 접근 가능성·유지보수 부담을 기준으로 한 개발 제안입니다.

구현 상태 갱신: **2026-10-19**, 치지직 두 조회와 동물병원 공공파일 조회를 추가했습니다. 동물병원은 공식 지역 코드·CP949 CSV·EPSG:5174를 확인하고 실제 강남구 파일의 HTTP 전체 흐름을 검증했습니다. 알라딘 종료 공지도 반영했습니다. 따릉이 검토일은 2026-10-17, 나이스·KOBIS는 2026-10-15, 에어코리아·TAGO·E-Gen은 2026-10-14, 기상청은 2026-10-12입니다.

원본 데이터는 [`src/research/app-api-backlog.ts`](../src/research/app-api-backlog.ts), 행동 초안은 [`src/connectors/drafts/index.ts`](../src/connectors/drafts/index.ts)에 있습니다. 관리 화면의 **확장 계획**에서 같은 자료를 검색할 수 있습니다.

**기상청·에어코리아·TAGO·E-Gen·나이스·KOBIS·따릉이·치지직과 네이버 도서의 확장 조회 행동 14개를 구현했습니다.** 구현된 공식 API는 총 16개 커넥터·34개 행동이며 따릉이는 HTTP 전송을 운영자가 허용해야 실행됩니다. 신규 실행기도 실제 키 검증 전에는 실사용 지원으로 집계하지 않습니다. 후보 데이터의 `implementedActionIds`와 `draftActionIds`로 구현/초안 상태를 구분합니다. 후속 초안은 `implemented: false`로 유지하며 지원·구현 수에 포함하지 않습니다. 알라딘은 종료 공지만 표시하고 신규 연결·행동을 추가하지 않았습니다. 미조사 후보의 홈페이지 등록은 API 존재·이용 허용을 확인했다는 뜻이 아닙니다.

네이버 도서는 `naver.search.book`·`naver.book.isbn`을 추가했습니다. 기존 검색 앱 키를 쓰되 새 행동은 직접 허용해야 합니다. [공식 도서 규격](https://developers.naver.com/docs/serviceapi/search/book/book.md)의 JSON 검색·XML ISBN 상세 검색을 사용하며 가격·재고·출간일·검색 생성 시각을 구분합니다. [사용 안내](NAVER_BOOKS.md)에 정보나루의 도서관 → ISBN 소장 → 개별 소장 조회 순서와 별도 인증·자료 시점 확인 항목도 기록했습니다.

**공공파일은 별도로 1개 커넥터·1개 행동**입니다. `animal-hospitals.search`는 키 없이 지역별 동물병원 CSV를 조회합니다. API 구현 수에는 더하지 않으며 강남구의 실제 파일 확인과 다른 지역·운영 한도 검증을 구분합니다. [사용·결과 안내](ANIMAL_HOSPITALS.md)

## 1순위: 조회 초안을 실행기로 발전

| 서비스 | 첫 행동 / 공식 확인 범위 | 이번 적용 | 다음 작업 |
|---|---|---|---|
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
| 건강보험심사평가원 | 병원·공개 기관 정보 찾기 | [병원정보서비스](https://www.data.go.kr/data/15001698/openapi.do) — 문서 확인 | 활용명세·지역코드·XML 필드·운영 심사. 개인 진료내역과 구분 |
| KOPIS | 지역 공연·공연 상세 | [Open API 안내](https://kopis.or.kr/por/cs/openapi/openApiInfo.do?menuId=MNU_00077) — 문서 확인 | 요청 규격·키 관리·출처 표시·HTTPS. 티켓 예매는 별도 |
| 도서관 정보나루 | 도서관 찾기·소장/대출 가능 정보 | [API 활용방법](https://www.data4library.kr/apiUtilization) — 문서 확인 | API와 공식 MCP 범위 비교, HTTPS·도서관별 갱신 시점. 개인 대출내역은 별도 |
| 서울 따릉이 | 대여소 잔여 자전거 | [실시간 대여정보](https://data.seoul.go.kr/dataList/OA-15493/A/1/datasetView.do) — 실행기 구현·본인 키 미검증 | HTTP는 운영자 설정 전 차단. HTTPS 재확인·실제 키 검증. 결제·대여 확정은 별도 |
| KOSIS | 지역 생활 통계 | [Open API 가이드](https://kosis.kr/serviceInfo/openAPIGuide.do) — 문서 확인 | 사용할 통계표 ID·시점·단위·키 |
| TourAPI | 관광지·축제 찾기 | [관광콘텐츠랩](https://api.visitkorea.or.kr/) — 상세 범위 미조사 | 최신 서비스 버전·키·관광 정보 필드 |
| 식품안전나라 | 회수·판매중지 식품 | [공공데이터 안내](https://www.foodsafetykorea.go.kr/apiMain.do) — 상세 범위 미조사 | 정확한 서비스 ID·필드·키·HTTPS |
| LH 청약플러스 | 임대·분양 공고 | [공식 서비스](https://apply.lh.or.kr/) — 미조사 | 공개 공고 API·지역/기간 조건. 자격 판정·신청은 별도 |
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
