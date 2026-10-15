# KOBIS 일별 박스오피스 조회

문서 확인·구현일: **2026-10-15**. 영화진흥위원회 [일별 박스오피스 공식 규격](https://www.kobis.or.kr/kobisopenapi/homepg/apiservice/searchServiceDesc.do?apiSvcId=searchDailyBoxOffice)을 사용합니다. 행동 ID는 `kobis.boxoffice.daily`, 계정 종류는 `kobis-api`입니다.

## 연결과 조회

1. [KOBIS 오픈API](https://www.kobis.or.kr/kobisopenapi/homepg/main/main.do)에 가입하고 **키 발급/관리**에서 본인 키를 발급받습니다. [공식 이용 안내](https://www.kobis.or.kr/kobisopenapi/homepg/board/findServiceGuideList.do)
2. KoreAI **연결 계정 → 계정 연결 → KOBIS 일별 박스오피스**에서 `apiKey`를 등록하고 조회 행동을 허용합니다.
3. **확장 계획 → KOBIS 영화정보 → 조회 기능 열기**에서 예시를 불러오고 날짜·결과 수를 확인한 뒤 실행합니다.

```json
{"date":"2026-10-14","limit":10}
```

`date`는 실제 달력 날짜 `YYYY-MM-DD`, `limit`은 1~10(기본 10)입니다. 예시는 서버 시간대와 관계없이 **Asia/Seoul의 어제**를 사용합니다. 당일·미래 날짜에 자료가 없을 수 있으며 날짜를 자동으로 바꿔 재조회하지 않습니다.

첫 행동은 전국·전체 영화 기준입니다. 영화 구분·국적·지역 필터와 주간 조회·영화 상세는 후속 범위입니다. 연결 후 새 **AI 대화**에서 행동을 허용하거나 기존 HTTP·MCP 인터페이스로 실행할 수 있습니다.

**요청 구조 미리보기**는 키 조회·외부 호출·작업 생성 없이 `targetDt`, `itemPerPage`와 고정 HTTPS 경로만 표시합니다. 실제 요청에서만 키를 `key` 매개변수에 넣습니다. 공개 예제 키나 다른 공급자 키로 대체하지 않습니다.

## 결과와 의미

| 결과 필드 | 의미 |
|---|---|
| `date`, `showRange` | 요청 날짜와 공급자가 반환한 동일 날짜 범위 |
| `movies[].movieCode`, `title`, `openingDate` | 앞자리 0을 보존한 영화 코드·국문명·제공된 개봉일 |
| `rank`, `rankChange`, `entryStatus` | 순위·전일 대비 순위 증감·기존/신규 진입 표시 |
| `audienceCount`, `cumulativeAudienceCount` | 해당일 관객수·누적 관객수 |
| `audienceChange`, `audienceChangePercentRaw` | 전일 대비 관객수 증감·증감 비율 원문 |
| `salesAmountRaw`, `cumulativeSalesAmountRaw` | 해당일·누적 매출액의 숫자 문자열 |
| `salesSharePercentRaw`, `salesChangeRaw`, `salesChangePercentRaw` | 매출 비중·증감액·증감 비율 원문 |
| `screenCount`, `screeningCount` | 해당일 상영 스크린 수·상영 횟수; 미제공이면 `null` |
| `retrievedAt`, `providerUpdatedAt` | 조회 시각과 미제공 자료 갱신 시각(`null`) |
| `scope`, `returnedCount`, `source` | 전국/전체 범위·반환 건수·공식 출처 |

매출액은 JavaScript 숫자 정밀도 한도를 넘더라도 원문이 바뀌지 않도록 문자열로 반환합니다. 영화 제목 등 외부 텍스트를 실행 지시문이나 HTML로 처리하지 않습니다. 일별 집계 결과는 현재 상영시간·잔여좌석·예매 가능 여부를 제공하지 않습니다.

빈 목록은 `status: no_data`이며 영화 상영 자체가 없었다고 판단하지 않습니다. 일별 유형·날짜 범위가 다르거나 중복 코드/순위·잘못된 숫자·과도한 결과 수가 오면 `INVALID_RESPONSE`로 중단합니다.

확인한 인증 오류 `320010`과 HTTP 401/403은 `awaiting_auth`, HTTP 429는 `PROVIDER_RATE_LIMIT`로 처리합니다. 상세 문서에서 의미를 확인하지 못한 공급자 오류는 코드만 `PROVIDER_<숫자>`로 보존하고 일반 안내를 반환합니다. 공급자 메시지·키를 포함한 URL을 노출하지 않습니다. 시간 초과·통신 실패·취소도 구분합니다.

## 검증과 남은 작업

공식 상세 규격·튜토리얼에서 요청과 응답 필드를 확인했고 HTTPS 요청에서 무효 시험 키의 `faultInfo.errorCode: 320010`을 확인했습니다. 문서의 공개 예제 키도 현재 같은 인증 오류를 반환해 정상 응답 증거로 사용하지 않았습니다.

정상/빈 결과·날짜/숫자/중복 검증·HTTP 권한·멱등 요청·인증 대기와 모바일 화면은 모의 응답으로 검사합니다. 실제 본인 키로 정상·빈 결과·한도 조건·데이터 제공 범위를 검증하는 작업은 남아 있습니다. 모의 응답·무효 키 확인은 실제 지원 수를 증가시키지 않습니다. [검증 기록](VALIDATION.md), [다음 할 일 API-06](../TODO.md).
