# 네이버 도서 검색·ISBN 조회

확인일: **2026-10-19**. 알라딘 신규 연결 보류 이후의 첫 도서 조회 실행기입니다. 기존 `naver-search` 커넥터에 두 행동을 추가했습니다. 별도 서비스·커넥터 수는 늘리지 않습니다. 구현·모의 응답 검증 상태이며 유효한 사용자 키로 성공 응답을 확인한 상태는 아닙니다.

## 계정 연결과 실행

1. [NAVER Developers](https://developers.naver.com/apps/#/register)에서 본인 앱의 **검색 API**를 설정합니다.
2. KoreAI **연결 계정 → 네이버 검색 앱**에 `clientId`·`clientSecret`을 등록합니다. 기존 검색 앱 키를 사용할 수 있습니다.
3. **네이버 도서 검색**, **네이버 ISBN 도서 조회** 권한을 선택하고 저장합니다. 기존 계정은 수정하여 새 행동을 추가해야 합니다. 에이전트·대화의 허용 행동에도 원하는 조회를 추가합니다.
4. **확장 계획 → 네이버 도서 검색**에서 행동을 선택합니다. 예시 입력·요청 구조 미리보기는 키 조회나 외부 호출 없이 동작합니다. **실행 요청**에서 실제 공급자 호출을 수행합니다.

Linux 서버에서도 동일하게 동작하며 GUI 브라우저나 네이버 사용자 로그인이 필요하지 않습니다. 휴대폰에서는 이미 설정한 HTTPS 주소로 관리 화면에 접속합니다. Windows DPAPI 저장 키를 Linux로 복사해서 사용하지 않고 서버에서 다시 등록합니다.

## 행동과 입력

| 행동 | 공식 요청 | 입력 |
|---|---|---|
| `naver.search.book` | `GET https://openapi.naver.com/v1/search/book.json` | `query` 필수, `display` 1~100(기본 10), `start` 1~1000(기본 1), `sort` `sim`/`date` |
| `naver.book.isbn` | `GET https://openapi.naver.com/v1/search/book_adv.xml` | 문자열 `isbn` 필수. ISBN-10/13, 공백·하이픈 제거, 체크 숫자 검증. `d_isbn`으로 전송 |

```json
{"query":"한국 문학","display":10,"start":1,"sort":"date"}
```

```json
{"isbn":"9788960515529"}
```

두 번째 예시는 공식 문서의 ISBN으로 형식을 보여 줍니다. 현재 검색 가능·재고 존재를 보증하는 예시가 아닙니다. ISBN 상세 조회는 최대 100개를 확인하며 동일 ISBN의 결과만 허용합니다. ISBN-10과 대응하는 978 ISBN-13은 같은 식별자로 대조합니다. 다른 판본·전자책의 ISBN은 별도입니다. 제한을 넘는 상세 결과는 `pagination.truncated`로 표시합니다.

## 결과 해석

- `books`: 제목·저자 원문·출판사·ISBN 문자열·책 소개·출간일·네이버 링크·제공된 판매 가격만 반환합니다. 표지·링크의 추가 HTTP 요청은 수행하지 않습니다.
- `isbnRaw`는 공급자 원문, `isbn10`·`isbn13`은 실제로 반환된 식별자입니다. 앞자리 0·끝자리 X를 숫자로 바꾸지 않습니다. 검색 결과 ISBN은 비어 있을 수 있으나 ISBN 상세 조회는 일치하는 식별자가 필요합니다.
- `sellingPriceKrw: null`은 가격 미제공입니다. 무료·절판·품절로 판정하지 않습니다. 가격 0은 제공값 그대로 보존하며 배송비·최저가·결제 가격을 보장하지 않습니다.
- `availability: "unverified"`를 유지합니다. 지점 재고·대출 가능 여부·개인 구매내역은 이 API의 조회 범위에 포함하지 않습니다.
- `publicationDateRaw`는 출간일 원문입니다. 유효한 완전한 날짜만 `publishedOn`으로 표시하며 연도·월 등 부분 날짜에는 날짜를 보충하지 않습니다.
- `searchGeneratedAtRaw`는 검색 응답 생성 시각, `retrievedAt`은 KoreAI 조회 시각입니다. 서지 갱신 시각은 미제공(`providerUpdatedAt: null`)입니다.
- 키워드 검색의 `pagination.nextStart`를 후속 `start`에 사용합니다. 1000을 넘는 시작 위치를 요청하지 않습니다. 빈 결과는 `status: "no_data"`이며 재고·절판 판정이 아닙니다.

페이지·식별자·가격·날짜·XML 구조가 맞지 않으면 실패로 중단합니다. 응답은 최대 2MB, 대기 시간은 30초이며 리다이렉트와 XML DTD/엔티티 선언은 거절합니다. 공급자 데이터는 기존 엔진의 `external_data`로 표시하고 승인·계정 권한에 영향을 주지 못합니다.

401·403은 `awaiting_auth`로 보존합니다. 앱 키와 검색 API 설정을 고친 뒤 같은 작업을 재개합니다. 429는 호출 한도 오류입니다. 검색 API는 클라이언트 ID별 사용량을 공유하므로 도서만의 별도 할당량으로 계산하지 않습니다. 현재 공식 안내는 일 25,000회이며 실제 앱의 한도·조건은 개발자센터에서 확인합니다. 오류에 공급자 본문·키·요청 헤더를 첨부하지 않습니다.

## 정보나루로 소장 조회

네이버 조회 결과의 `isbn13`을 [정보나루 도서관·소장 조회](LIBRARY_NARU.md)에 입력할 수 있습니다. 직접 API의 세 조회 실행기·전용 계정·미리보기를 추가했으며 본인 정보나루 키의 정상 응답은 검증 대기입니다. 네이버와 정보나루의 키·계정 권한은 각각 등록합니다.

| 순서 | 행동 후보 | 공식 근거·확인할 항목 |
|---|---|---|
| 1 | 참여 도서관 찾기 | API `libSrch` 구현. MCP의 `search_libraries`·`search_library_codes`·`search_region_codes`는 비교 대상으로 기록. 이름/코드 탐색은 후속 |
| 2 | ISBN 소장 도서관 찾기 | API `libSrchByBook` / MCP `get_library_collection`. 요청한 판본·지역·페이지 대조 |
| 3 | 개별 도서관의 소장·대출 가능 값 | API `bookExist` / MCP `check_book_availability`. 실제 응답 필드·권한·자료 시점 확인. 소장 여부와 대출 가능 여부를 따로 표시 |

공식 MCP 안내는 소장 자료가 월 단위로 갱신되어 현재 재고와 시차가 있을 수 있다고 설명하며, API 매뉴얼의 대출 상태는 전날 기준입니다. 조회 시각으로 자료 기준일을 추정하지 않습니다. 직접 API는 세 HTTPS 경로의 무효 키 오류를 확인해 HTTPS로만 실행합니다. 공식 MCP 주소·`X-Auth-Key` 헤더도 확인했으며, 해당 비밀 헤더의 주입과 실제 연결 검증은 후속입니다. 모델 입력으로 인증키를 받지 않습니다.

## 근거와 검증

- [네이버 책 검색 공식 규격](https://developers.naver.com/docs/serviceapi/search/book/book.md): 검색·XML 상세 검색·키·결과·권한 오류.
- [정보나루 API 활용 방법](https://www.data4library.kr/apiUtilization): 도서관·소장·도서 조회 및 인증키 신청.
- [정보나루 MCP 활용 방법](https://www.data4library.kr/mcpUtilization): 16개 도구·입력·소장 갱신 시점.
- [알라딘 종료 조사](ALADIN.md), [검증 기록](VALIDATION.md#2026-10-19-네이버-도서-조회-검증), [다음 작업](../TODO.md).

모의 JSON/XML·실제 로컬 HTTP 엔진·휴대폰 크기 UI·Linux 실행을 구분하여 검증 기록에 남깁니다. 사용자 키의 정상/빈 응답과 실제 권한 확인 전 공개 지원 실적으로 집계하지 않습니다.
