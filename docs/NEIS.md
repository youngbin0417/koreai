# 나이스 학교 검색·급식 조회

문서 확인·구현일: **2026-10-15**. 공개 [학교기본정보](https://open.neis.go.kr/portal/data/service/selectServicePage.do?infId=OPEN17020190531110010104913&infSeq=2)와 [급식식단정보](https://open.neis.go.kr/portal/data/service/selectServicePage.do?infId=OPEN17320190722180924242823&infSeq=2)의 JSON API를 사용합니다. 학생 개인정보·재학 조회는 제공하지 않습니다.

## 연결과 사용 순서

1. [나이스 교육정보 개방 포털](https://open.neis.go.kr/portal/guide/apiGuidePage.do)에서 본인 인증키를 발급받습니다. 공공데이터포털의 `serviceKey`와 다른 키입니다.
2. **연결 계정 → 계정 연결 → 나이스 학교·급식**에서 `apiKey`를 등록하고 **학교 찾기·학교 급식 조회** 중 필요한 행동을 허용합니다.
3. **확장 계획 → 나이스 교육정보 → 나이스 학교 찾기**에서 이름으로 검색합니다. 동명 학교의 지역·주소를 확인하세요.
4. 결과의 `educationOfficeCode`, `schoolCode`를 **나이스 학교 급식 조회** 입력에 복사하고 날짜·식사를 지정합니다.

학교 검색(`neis.schools.search`):

```json
{"name":"서울고등학교","educationOfficeCode":"B10","page":1,"limit":10}
```

학교 이름 `name`은 필수이며 `educationOfficeCode`와 시도명 `region`은 선택입니다. 학교 코드와 전화번호의 앞자리 0을 보존합니다. 주소·학교급·포털 연계 일자는 제공된 값만 반환하며 폐교·재학 여부를 판정하지 않습니다.

급식 조회(`neis.meals`):

```json
{"educationOfficeCode":"B10","schoolCode":"7010057","date":"2026-10-15","meal":"lunch","page":1,"limit":10}
```

코드는 학교 검색 결과로 확인하세요. 날짜는 유효한 `YYYY-MM-DD`, 식사는 `breakfast`(조식 1), `lunch`(중식 2·기본값), `dinner`(석식 3)입니다. 예시 날짜는 Asia/Seoul의 오늘을 사용하며 특정 날짜의 자료 존재를 보증하지 않습니다. `page` 기본 1·최대 1,000, `limit` 기본 10·최대 100입니다.

**요청 구조 미리보기**는 키 조회·외부 호출·작업 생성 없이 동작합니다. 실제 실행에는 사용자 키가 필수이며 키 누락·`sample` 입력을 공개 샘플 호출로 대체하지 않습니다. 연결 후 새 **AI 대화**에서 두 행동을 허용하거나 기존 HTTP·MCP 인터페이스로 실행할 수 있습니다.

## 결과와 오류

| 결과 필드 | 의미 |
|---|---|
| `schools[]` | 교육청·학교 코드, 학교명·학교급·지역·주소·대표전화 |
| `meals[].menuRaw`, `menuLines` | 요리명·알레르기 번호 원문과 `<br>`로 구분한 텍스트 목록 |
| `caloriesRaw`, `nutrientsRaw`, `originRaw` | 제공된 단위·영양·원산지 원문; 미제공은 `null` |
| `portalLinkedAtRaw` | 공급자가 제공한 포털 연계 일자 원문 |
| `providerUpdatedAt` | 원자료 최종 수정 시각은 확인되지 않아 `null` |
| `retrievedAt`, `pagination`, `source` | 조회 시각·요청 페이지/전체 건수·공식 출처 |

요리명·알레르기 번호를 HTML로 실행하지 않고 데이터로 반환합니다. 표시 누락을 알레르기 유발 성분 없음으로 판단하지 않습니다. `LOAD_DTM`은 포털 연계 일자이며 원자료 최종 수정 시각이나 현재 정확성을 보증하지 않습니다.

자료 없음(`INFO-200`)·빈 결과·빈 페이지는 `status: no_data`로 구분합니다. 이 결과만으로 방학·휴교·급식 미실시를 단정하지 않습니다. 요청한 교육청·학교·날짜·식사가 다르거나 중복 식단·잘못된 건수·응답 구조가 오면 `INVALID_RESPONSE`로 중단합니다.

키 오류/사용중지는 `awaiting_auth`, 일일 한도는 `PROVIDER_RATE_LIMIT`, 입력 거절·통신 실패·시간 초과·취소는 각각 구분합니다. 공급자 오류 메시지·키가 든 요청 URL은 결과로 전달하지 않습니다.

## 검증과 다음 단계

공식 Open API 메타데이터에서 요청 필드·출력 필드·오류 코드를 확인하고, 인증키 없는 공식 공개 샘플에서 응답 구조와 식사 코드를 대조했습니다. 공개 샘플은 오래된 고정 자료일 수 있으며 실제 사용자 계정 검증으로 집계하지 않습니다.

실행기·HTTP 권한·모바일 학교 검색 → 코드 선택 → 급식 조회는 모의 응답으로 검증합니다. 실제 키·지역별 자료·동명 학교 구분·식사별 제공 범위 확인은 남아 있습니다. [검증 기록](VALIDATION.md), [할 일 목록 API-05](../TODO.md)를 참고하세요. 학사일정은 후속 행동으로 정의합니다.
