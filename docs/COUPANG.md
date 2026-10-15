# 쿠팡 첫 조회 기능 정의

확인일: **2026-10-15**. 첫 범위는 **검색어로 공개 상품 후보 찾기**입니다. 상품·옵션 식별자, 표시 가격과 조건, 배송 안내의 제안 규격·비활성 행동·관리 화면을 추가했습니다. 소비자 자동 조회 실행은 지원하지 않습니다.

## 공식 근거와 연결 범위

| 근거 | 확인한 내용 | KoreAI 적용 |
|---|---|---|
| [공식 소비자 서비스](https://www.coupang.com/) | 공개 검색 입력과 소비자 서비스 진입 경로 | 고정 URL로 사용자 직접 확인. 로그인·상품 검색·구매내역을 실행하지 않음 |
| [판매자 Open API 안내](https://developers.coupang.com/ko/getting-started/coupang-open-api) | WING 판매자 계정과 Open API 연동, 등록상품/노출상품/옵션 ID 구분 | 소비자 전체 상품 검색·구매내역 권한과 구분 |
| [키 발급·IP 등록](https://developers.coupang.com/ko/getting-started/issue-open-api-keynew)·[HMAC 가이드](https://developers.coupang.com/ko/getting-started/creating-hmac-signature) | 사업자 인증 판매자, Access Key/Secret Key, 허용 IP와 HMAC-SHA256 서명 | 판매자 키 발급 안내 링크 제공. 실제 키 발급·서명·호출은 미수행 |
| [판매자 상품 목록 조회](https://developers.coupang.com/ko/api/products/product-list-paging-query) | `vendorId`로 등록상품 목록 페이징 조회 | 개인 소비자의 전체 검색 결과로 사용하지 않음 |
| [파트너스 공식 가이드 · 2025-10-28판](https://partners.coupangcdn.com/partners-guide/partners-guide-20251028182159.pdf) | 17쪽: 상품·딥 링크·리포팅 API 소개. 20쪽: 최종승인 이후 API 이용. 63쪽: 경제적 이해관계 표시 안내 | 상품 조회의 후보 경로로 기록. 최신 승인·활동 채널·표시/재사용 조건과 실제 API 명세는 후속 확인 |
| [파트너스 API 안내](https://partners.coupang.com/#help/open-api) | 공식 PDF 17쪽의 실제 링크에서 확인한 안내 주소 | 고정 안내 링크 제공. 조사용 비로그인 Edge에서는 Access Denied여서 세부 요청·응답을 읽지 못함 |

파트너스 상품 API를 판매자 API와 별도 경로로 조사했습니다. 기존 공식 API 중 소비자 상품 조회에 활용할 후보는 있으나, KoreAI에서 사용할 수 있는 계정·활동 방식·결과 제공 조건을 확정한 상태는 아닙니다. 조사 환경의 접근 거절을 소비자 API 부재나 모든 자동 접근의 허용/금지로 단정하지 않습니다. 현재 판매자·파트너스 API 어댑터 모두 구현하지 않았습니다.

## 첫 행동과 제안 규격

- 행동 ID: `coupang.products.search`
- 효과·방식: 읽기·`partnership`, `implemented: false`, `enabled: false`
- 상태: 정의 완료·공급자 확인 대기. 아래는 **KoreAI 제안**이며 쿠팡의 실제 요청/응답 명세가 아님.
- 자격정보: 실행 경로 확정 전이며 임의 키 유형을 만들지 않음. 행동 입력·준비 설정에 판매자/파트너스 키·쿠키·개인 배송지를 받지 않음.

```json
{"query":"생수","limit":5}
```

`query`는 공백 제거 후 1~100자, `limit`은 기본 5·1~20인 제안 상한입니다. 판매자 `vendorId`·`sellerProductId`, 파트너 식별자·임의 URL·주문 ID 등의 추가 필드를 거절합니다. 실제 공급자의 검색 필드·한도·페이지 방식은 확인 대기입니다.

제안 결과는 `status`, `query`, `products[]`, `retrievedAt`, `providerUpdatedAt`입니다.

| 상품별 필드 | 제안 의미 |
|---|---|
| `productId`, `itemId`, `vendorItemId` | 제공된 상품·옵션 식별자 원문 문자열. 미제공은 `null`. 큰 ID의 정밀도를 잃지 않도록 숫자로 변환하지 않음 |
| `title`, `optionText` | 공개 이름·표시된 옵션 원문. 옵션 자동 선택 없음 |
| `sourceUrl` | `https://www.coupang.com/vp/products/<숫자 ID>` 형식. 쿼리는 중복 없는 숫자 `itemId`·`vendorItemId`만 허용하며 결과의 해당 필드와 일치해야 함 |
| `price.kind` | `listed`: 화면 표시 금액, `from`: 옵션 시작가, `unknown`: 금액 미확인 |
| `price.amountKrw`, `price.text`, `price.conditionsText` | 표시 금액의 안전한 양의 정수·원문·와우회원/쿠폰 등 조건 원문. 미확인 금액은 `null` |
| `availabilityText` | 품절 등 명시된 공개 안내. 미제공은 `null` |
| `deliveryText`, `deliveryEligibility` | 로켓배송 등 표시 원문과 고정값 `not_verified`. 사용자 주소별 배송·도착 보장 없음 |

식별자를 판매자 등록상품 ID와 혼용하지 않으며 노출상품 ID의 영구 고정을 가정하지 않습니다. 옵션 식별자가 있으면 링크에도 보존해 다른 옵션으로 안내되는 것을 방지합니다. 쿼리가 없는 링크에 이미 선택된 옵션이 있다고 표시하지 않습니다.

표시 가격은 결제 확정가가 아닙니다. 회원·쿠폰 혜택을 자동 적용하지 않고 미제공 금액을 0원으로 바꾸지 않습니다. 첫 규격은 0원 상품 정규화를 지원하지 않습니다. `status: available`은 결과 데이터 존재 여부이며 재고·구매 가능 상태가 아닙니다. 로그인 필요·접근 거절·통신 실패는 빈 결과와 구분해야 합니다.

현재 제안은 공식 상품 직접 링크만 다룹니다. 추적 쿼리·단축 제휴 링크를 허용하거나 생성하지 않습니다. **파트너스 경로를 채택하면 실제 응답·링크 유지 조건·경제적 이해관계 표시에 맞게 결과 필드와 화면을 먼저 갱신해야 합니다.** 제휴 URL을 조용히 제거·변환하거나 개발자 개인의 파트너 ID를 삽입하지 않습니다. 구매내역·장바구니·주문·결제·판매자 업무는 첫 조회 범위 밖입니다.

## 현재 사용하는 방법

1. **기본 서비스 연결 → 쿠팡**에서 첫 조회 규격·연결 조건을 봅니다.
2. **사용자 서비스** 경로를 선택하고 **연결 준비 저장**을 누릅니다.
3. **서비스 열기** 또는 **공식 상품 직접 확인**에서 공식 홈으로 이동해 사용자가 상품을 찾습니다.

`PUT /api/connections/coupang`에 `{"routeId":"consumer"}`를 보내 준비합니다. 기존 `consumer`·`seller` 경로를 유지하고 `seller-auth`·`partners-guide` 안내 경로를 추가했습니다. 경로 선택은 계정 인증·공급자 호출을 수행하지 않습니다.

`coupang.connection.open`은 입력 `{}`로 선택한 고정 URL만 반환합니다. `coupang.connection.status`와 허용된 `GET /api/connections`의 `firstRead`에는 제안 JSON Schema·예시·계정 조건·결과 확인·다음 조사를 제공합니다. 조회 초안 실행은 관리자와 허용된 에이전트 모두 409 `NOT_IMPLEMENTED`로 거절하고 작업을 만들지 않습니다.

준비 저장 후에도 `automaticActions: 0`·`accountVerified: false`를 유지합니다. 안내 링크·기능 정의를 실제 소비자 검색·계정 검증·지원 실적으로 집계하지 않습니다.

## 공급자 확인과 활성화 조건

다음은 미발송 문의 질문 초안입니다.

1. 파트너스 상품 조회를 개인용 LLM 에이전트와 원격 휴대폰 화면에 제공하는 활동 방식이 허용되는가? 필요한 최종승인·채널 등록·키 발급 조건은 무엇인가?
2. 검색·페이지·한도·상품/옵션 ID·가격/품절·배송 정보의 최신 세부 명세와 테스트 경로는 무엇인가?
3. 응답의 제휴 링크를 유지·표시하는 조건과 경제적 이해관계 문구·위치는 무엇인가? 일반 공식 상품 링크를 별도 제공할 수 있는가?
4. 데이터의 갱신·캐시·보관·LLM 전달·가격 재사용 조건은 무엇인가?
5. 다른 소비자 제휴 API 또는 사용자 소유 전용 브라우저의 자동 조회가 허용되는가?

허용된 경로와 결과/화면 규격을 확정한 뒤 실제 계정으로 검색·옵션 일치·가격 조건·품절·빈 결과·인증 만료·한도·접근 거절을 검증하고 증거를 남겨 활성화합니다. 판매자 연동은 별도 업무 수요가 있을 때 WING 권한·서명/인코딩·허용 IP·키 수명·판매자 범위를 검증해 추가합니다. [정의 코드](../src/connectors/lifestyle/coupang-read.ts), [다음 할 일 APP-06](../TODO.md).
