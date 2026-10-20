# 네이버 도서 검색·ISBN 조회

상태 갱신: **2026-10-21 — 종료로 실행 중단.** [공식 종료 공지](https://developers.naver.com/notice/article/32564)와 현행 약관 부칙을 반영해 두 도서 행동의 신규 연결·실행을 차단했습니다. 기존 키도 사용할 수 없습니다. 아래 요청·응답 규격은 과거 구현 기록입니다. [검색 전체의 상태·API HUB 후속 조건](NAVER_AVAILABILITY.md)을 먼저 확인하세요.

## 중단 안내와 과거 규격

**확장 계획 → 네이버 도서 검색 → 중단 안내**에서 종료 사유와 과거 입력·요청 구조를 확인합니다. 예시와 미리보기는 외부 호출·키 조회 없이 동작하며 실제 실행은 차단합니다. 도서관·ISBN 소장 조회는 [정보나루 사용 안내](LIBRARY_NARU.md)를 참고하세요.

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

알고 있는 ISBN-13을 [정보나루 도서관·소장 조회](LIBRARY_NARU.md)에 입력할 수 있습니다. 세 조회 실행기·전용 계정·미리보기를 구현했으며 본인 정보나루 키의 정상 응답은 검증 대기입니다. 종료된 네이버 API를 먼저 호출하지 않습니다.

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

기존 JSON/XML 파서 검증은 과거 규격의 모의 시험으로 유지합니다. 현재 검증은 신규 실행·권한 차단, 이전 계정·토큰·작업·대화의 재사용 차단이며 공급자 정상 호출 실적으로 집계하지 않습니다. 과거 모의 성공은 API 종료를 무효화하지 않습니다.
