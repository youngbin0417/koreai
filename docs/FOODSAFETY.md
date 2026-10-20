# 식품안전나라 회수·판매중지 조회

확인일: **2026-10-20**. 공식 **I0490**의 회수·판매중지 공고 조회를 구현했습니다. HTTPS 공개 샘플과 무효 키 오류를 확인했으며 본인 승인 키의 정상 응답 검증은 남아 있습니다. 공개 샘플·모의 시험을 실제 계정 검증이나 지원 실적으로 집계하지 않습니다.

## 계정 연결과 실행

1. [식품안전나라 데이터활용서비스](https://www.foodsafetykorea.go.kr/api/main.do)에서 본인 인증키를 발급받고 [회수·판매중지 I0490](https://www.foodsafetykorea.go.kr/api/openApiInfo.do?menu_grp=MENU_GRP31&menu_no=661&show_cnt=10&start_idx=1&svc_no=I0490&svc_type_cd=API_TYPE06)의 **OpenAPI 이용신청**을 완료합니다. 공공데이터포털·DeepSeek 키와 다릅니다.
2. KoreAI **연결 계정 → 계정 연결 → 식품안전나라 회수·판매중지**에서 `apiKey`를 등록하고 **식품 회수·판매중지 조회**를 허용합니다.
3. **확장 계획 → 식품안전나라 → 조회 기능 열기**에서 예시를 불러오고 요청 구조를 확인한 뒤 실행합니다.

행동 ID: **`foodsafety.recalls.search`** · 계정 종류: **`foodsafety-api`**

키는 Linux 로컬 암호화 저장소에 보관하고 HTTPS 경로에만 주입합니다. HTTP/MCP에서도 같은 계정·행동 권한을 적용하며 호출한 에이전트·미리보기·일반 오류에 키를 반환하지 않습니다. API 실행에 브라우저나 그래픽 환경은 필요하지 않습니다.

발급 키는 1개이며 타인에게 양도할 수 없다는 공식 안내를 확인했습니다. 키 경로가 바뀌지 않도록 계정 실행은 영문·숫자·`_`·`-`의 8~256자만 허용하며 `sample`은 거절합니다. 이는 KoreAI의 허용 형식입니다. 본인 키의 형식이 다르면 임의 변환하지 말고 실제 명세·키 형식을 확인해야 합니다.

## 입력

화면 예시는 **Asia/Seoul 어제**를 `changedSince`에 넣습니다. 증분 날짜가 오래되면 예시를 다시 불러오거나 날짜를 수정하세요. 저장된 작업의 날짜는 자동으로 바꾸지 않습니다.

```json
{
  "start":1,
  "end":10,
  "changedSince":"2026-10-19"
}
```

| 입력 | 범위와 의미 |
|---|---|
| `start`, `end` | 1부터 시작하는 요청 위치, 양 끝 포함. 기본 1·10, 각 최대 1,000,000, 한 번에 최대 100건 |
| `createdOn` | 선택 등록일자 `YYYY-MM-DD` → 공급자 `CRET_DTM`의 단일 날짜 |
| `changedSince` | 선택 변경일자 `YYYY-MM-DD` → 공급자 `CHNG_DT` 이후 자료. 최대 7일 증분·당일 제공 시각은 공급자가 판정 |
| `productReportNumber` | 선택 품목제조보고번호 → 공급자 `PRDLST_REPORT_NO`, 숫자 문자열 1~30자리. 바코드와 다름 |
| `name` | 선택 제품명 부분 일치, 1~100자. **요청 구간 안에서** 필터링 |
| `barcode` | 선택 바코드 원문 완전 일치, 영문·숫자 1~40자. **요청 구간 안에서** 필터링 |

제품명·바코드는 공식 요청 인자로 확인되지 않아 공급자 검색 조건으로 보내지 않습니다. 동일 이름의 다른 제품이나 서로 다른 제조일·포장을 하나로 합치지 않습니다. 바코드는 `R229632780001` 같은 영문 포함 값과 앞자리 0을 그대로 보존합니다.

공식 요청은 일반 쿼리가 아닌 다음 **경로형 필터**입니다. 미리보기는 `{apiKey}`를 유지하며 `pathFilters`와 `localFilter`를 별도로 보여줍니다.

```text
https://openapi.foodsafetykorea.go.kr/api/{apiKey}/I0490/json/1/10/CHNG_DT=20261019
```

정해진 서비스·필드만 사용하며 임의 URL·다른 서비스 ID·키·정렬 조건은 입력할 수 없습니다. 공급자 최대 요청 건수는 1,000, KoreAI 첫 구현은 100건으로 제한합니다. 요청당 한 번만 호출하며 자동 순회·재시도·전체 다운로드는 하지 않습니다.

## 결과 해석

`recalls`의 주요 필드:

- `recallId`·`productName`·`reason`: 공고 식별자·제품명·회수 사유.
- `manufacturer`·`manufacturerAddress`·`phone`: 제조업체 정보. 2026-08 개인정보 제공 변경으로 빈 연락처가 정상일 수 있습니다. 빈 값을 다른 정보로 보충하거나 추정하지 않습니다.
- `barcodeRaw`·`packageRaw`·`productReportNumber`·`manufacturerLicenseNumber`: 실물 표시와 대조할 식별/포장 정보. 숫자로 변환하지 않습니다.
- `manufacturedOnRaw`·`expiryRaw`: 제조일·유통/소비기한 원문. `데이터없음`, `미표시`, `제조일로부터 12개월`, 여러 날짜 등의 표기를 임의의 확정 날짜로 바꾸지 않습니다.
- `recallMethodRaw`·`recallGradeRaw`·`foodCategoryRaw`·`productTypeRaw`: 회수 방법·등급·유형 원문. `자율회수` 등 비숫자 등급도 보존합니다.
- `registeredAtRaw`: 공고 등록 시각 원문. 공급자가 시간대를 명시하지 않으므로 붙이지 않습니다. `retrievedAt`은 조회 시각, `providerUpdatedAt`은 `null`입니다.

**공고와 실물의 제품명·제조업체·제조일/기한·포장·바코드를 함께 대조해야 합니다.** `appliesToUserProduct`·`recallCompleted`·`productSafety`는 `null`로 반환합니다. 공고 존재나 검색 결과 부재만으로 개인 제품 해당 여부·회수 완료·안전성을 판정하지 않습니다. 이미지 URL·다운로드도 제공하지 않습니다.

`returnedCount`는 구간 내 필터 후 건수, `providerReturnedCount`는 공급자 행 수입니다. `pagination.providerTotalCount`는 공급자 조건에 대한 전체 수이며 이름·바코드 필터의 총수가 아닙니다. `matchingTotalCount`는 `null`입니다. `nextRange`는 공급자 전체 수와 요청 구간으로 계산하며 필터 후 건수로 다음 범위를 건너뛰지 않습니다. 공급자가 페이지 위치를 응답하지 않아 행의 실제 위치까지 대조한 상태는 아닙니다.

빈 결과는 `no_data`이며 `no_match_in_range`와 `empty_provider_range`를 구분합니다. 자료 없음 응답이 전체 수를 제공하지 않으면 `providerTotalCount: null`로 표시합니다. 이 결과는 전체 공고의 부재·제품의 안전성을 뜻하지 않습니다.

KoreAI는 `source.attribution`에 **출처: 식품의약품안전처 식품안전나라 회수·판매중지 정보(I0490)**를 포함합니다. 결과 재표시에도 출처와 조회 범위를 함께 표시하세요.

## 현재 운영 조건과 오류

서비스 메타정보의 최종 수정일은 2021-06-18이나 실제 운영 조건은 최신 공지를 함께 적용합니다.

- [2026-09-21 공지, 9월 22일 적용](https://www.foodsafetykorea.go.kr/api/board/boardDetail.do?bbs_no=apiNotice&ntctxt_no=1152497&menu_no=688&menu_grp=MENU_GRP33): **06:00~19:00 이용자별·API별 최대 300회**, 종료일 별도 공지. 이 수치를 시간당 300회로 해석하지 않습니다.
- [2026-09-02 변경 안내](https://www.foodsafetykorea.go.kr/api/board/boardDetail.do?bbs_no=apiNotice&ntctxt_no=1151919&menu_no=688&menu_grp=MENU_GRP33): 변경일자 최대 7일 증분, 시간당 100회 초과 호출 제한, 샘플 URL 일 100회 제한. 전체 CSV는 매일 0시 갱신이나 첫 구현은 다운로드하지 않습니다.
- [2026-08-10 개인정보 제공 변경](https://www.foodsafetykorea.go.kr/api/board/boardDetail.do?bbs_no=apiNotice&ntctxt_no=1151453&menu_no=688&menu_grp=MENU_GRP33): 성명·전화번호·이메일 등 빈 값 처리. 출력 필드 자체는 후속 공지에서 바뀔 수 있습니다.

조건별 우선순위·실제 계정 한도는 본인 키로 확인해야 합니다. 화면·실행기는 자동 반복 호출을 추가하지 않으며 공급자 오류를 다음처럼 구분합니다.

| 공급자 응답 | KoreAI 처리 |
|---|---|
| `INFO-000` | 정상. 전체 수·구간 행 수·중복 ID·요청 보고번호 대조 |
| `INFO-200` | 자료 없음. 빈 결과를 안전성 판정으로 바꾸지 않음 |
| `INFO-100/110/120/310/400/600`, HTTP 401/403 | 인증·이용신청·승인·만료 확인 후 같은 작업 재개 |
| `INFO-300/320/330`, `ERROR-503`, HTTP 429 | 한도 오류. 자동 재호출 없음 |
| `INFO-500` | 같은 키 사용 중. 잠시 뒤 사용자 재요청 |
| `INFO-700` | 당일 생성/변경 자료는 19시 이후 제공 |
| `ERROR-303` | 최대 7일 증분 날짜 조건 확인 |
| 다른 코드 | 원문·키 URL 없이 코드와 일반 오류 반환 |

30초 시간 제한·사용자 취소·2MB 스트림 제한·UTF-8·JSON/XML·중복 ID를 검증하며 DTD/엔티티 선언을 거절합니다. 공급자 내용은 `external_data`로 표시합니다. HTTPS만 사용하고 HTTP 대체·리다이렉트로 키를 재전송하지 않습니다.

## 검증과 다음 단계

공개 HTTPS 샘플 JSON/XML의 정상 구조와 무효 키의 **HTTP 200·INFO-100 → 인증 대기**를 확인했습니다. 샘플은 요청 `1/2`에도 5건을 반환했으므로 본인 계정의 범위 검증을 대신하지 않습니다. 샘플 정규화는 `{start:1,end:5}`로 별도 수행하며 생산 계정의 `sample` 키 실행은 차단합니다.

모의 단위/HTTP·모바일 크기 화면·Linux 검증·공개 샘플과 본인 계정 검증을 [검증 기록](VALIDATION.md#2026-10-20-식품안전나라-회수-조회-검증)에 구분합니다. 본인 키·I0490 승인으로 정상/빈 결과·보고번호·등록/변경일 경계·한도·요청 구간을 검증해야 합니다. 실제 휴대폰 기기 시험은 남아 있습니다.

과거 전체 CSV 조회·공고 상세·자동 알림은 별도 단계입니다. [LH 임대·분양 공고 조회](LH.md)도 첫 실행기를 구현했으며 후속 순서는 [작업 체크리스트](../TODO.md)에서 관리합니다.

공식 근거: [I0490 명세·오류 코드](https://www.foodsafetykorea.go.kr/api/openApiInfo.do?menu_grp=MENU_GRP31&menu_no=661&show_cnt=10&start_idx=1&svc_no=I0490&svc_type_cd=API_TYPE06), [키 발급·데이터활용서비스](https://www.foodsafetykorea.go.kr/api/main.do), 위 운영 공지 세 건. HTML·공지 텍스트·공개 샘플·시험 보고서는 `.test-data`에만 보관합니다.
