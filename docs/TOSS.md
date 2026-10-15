# 토스 첫 조회 기능 정의

확인일: **2026-10-15**. 첫 범위는 **내 연결 계좌 목록의 기관명·마스킹 정보 확인**입니다. 제안 규격·비활성 행동·관리 화면을 추가했습니다. 개인 금융 조회의 실제 API·제휴·인증·동의 조건은 확인 대기이며 현재 금융 데이터를 읽지 않습니다.

## 공식 근거와 권한 범위

| 근거 | 확인한 내용 | KoreAI 적용 |
|---|---|---|
| [토스 공식 안내](https://toss.im/) | 소비자 서비스 안내·앱 진입 정보 | 홈페이지 고정 링크. 앱 계좌 화면의 자동 실행·딥 링크는 제공하지 않음 |
| [현재 앱인토스 문서](https://developers-apps-in-toss.toss.im/readme.md)·[문서 목록](https://developers-apps-in-toss.toss.im/llms.txt) | 미니앱 개발·등록·SDK·운영 안내. 기존 소개 `.html` 주소에서 현재 문서로 이동 확인 | 토스 안의 미니앱 플랫폼과 Linux 서버·휴대폰 웹의 실행 환경을 구분 |
| [앱인토스 로그인](https://developers-apps-in-toss.toss.im/guide/authentication/intro.md)·[유저 정보 불러오기](https://developers-apps-in-toss.toss.im/guide/authentication/user-info.md) | 로그인/식별과 별도 동의 기반 이름·연락처·주소 등 제공 | 금융 계좌 조회 권한으로 간주하지 않음. 계좌 조회 API·Scope는 확인하지 못함 |
| [앱인토스 서버 API](https://developers-apps-in-toss.toss.im/documentation/integration/server-api.md) | 파트너 서버 mTLS 인증서 설정 안내 | 인증서 발급·배포는 별도 작업이며 SDK나 서버 인증만으로 금융 조회가 활성화되지 않음 |
| [외부 서비스용 토스 로그인](https://auth-docs.toss.im/tosslogin/common.html) | Client 등록·자격정보·개인정보 Scope·약관·연결 끊기 | 일반 웹/앱 로그인과 앱인토스 미니앱 로그인을 구분. 실제 등록·OAuth 호출 미수행 |
| [마이데이터 통합인증](https://auth-docs.toss.im/auth/integration_mydata.html) | 사업자/정보제공자의 서명 검증·CI 반환 | 계좌 목록·잔액·거래내역 API로 해석하지 않음 |
| [앱인토스 콘솔 MCP](https://developers-apps-in-toss.toss.im/guide/console-mcp.md) | 워크스페이스·미니앱·검수·운영 통계·운영 작업과 로그인 안내 | 운영자용 후속 연결로 기록. 소비자 금융 조회와 구분하며 서버 등록·OAuth·실제 호출 미수행 |

[2026-04-27 공식 개발자 커뮤니티 답변](https://techchat-apps-in-toss.toss.im/t/sdk/3644)은 당시 앱 전체 거래 데이터·마이데이터 인프라의 미니앱 제공을 지원하지 않는다고 안내했습니다. 과거 답변을 현재의 모든 제휴 경로에 대한 영구적 제한으로 단정하지 않습니다. 이번에 확인한 문서에서는 개인 연결 계좌 조회 경로를 확보하지 못했습니다.

## 첫 행동과 제안 규격

- 행동 ID: `toss.accounts.list`
- 효과·방식: 읽기·`partnership`, `implemented: false`, `enabled: false`
- 상태: 정의 완료·공급자 확인 대기. 아래는 **KoreAI 제안**이며 토스의 실제 요청/응답 명세가 아님.
- 자격정보: 금융 조회 경로가 확정되지 않아 임의의 키 유형·OAuth Scope를 만들지 않음.

```json
{"limit":5}
```

`limit`은 기본 5·1~20인 제안 상한입니다. 실제 제공 범위·페이지·한도는 확인 대기입니다. 계좌번호·CI·공급자 userKey·로그인 코드·토큰·쿠키·PIN·임의 URL·`consented: true` 같은 추가 입력을 거절합니다. 준비 설정에도 동의 표시를 넣을 수 없습니다.

제안 결과는 다음과 같습니다.

| 필드 | 제안 의미 |
|---|---|
| `status` | `available` 또는 `no_data`. 허용된 조회 결과의 자료 존재 여부이며 전체 계좌 보유 여부가 아님 |
| `accounts[].accountRef` | KoreAI가 발급할 로컬 참조 UUID. 실제 계좌번호·CI·공급자 사용자/계좌 식별자를 모델에 전달하지 않기 위한 제안. 중복 불허 |
| `accounts[].institutionName` | 제공된 금융기관 표시명 |
| `accounts[].accountNumberHint` | 고정 표시 형식 `****1234`의 끝 네 자리. 확인할 수 없으면 `null`. 원본 번호나 부분 마스킹 번호는 불허 |
| `coverage` | 고정값 `not_verified`. 전체 연결 계좌에 대한 조회 범위·완전성 보장 없음 |
| `retrievedAt`, `providerUpdatedAt` | 조회 시각과 제공된 갱신 시각. 갱신 시각 미제공은 `null` |

현재 UUID 발급/금융 계좌 매핑·마스킹 변환·동의 수집·계좌 수집은 구현하지 않았습니다. 테스트 예시는 가상 데이터입니다. 실제 어댑터를 추가할 때 원본 식별자 매핑을 서버에 보관하고 결과에는 허용된 마스킹 정보만 넣도록 검증해야 합니다.

미연결·인증 필요·동의 거절/만료/회수·접근 거절을 빈 목록으로 바꾸지 않습니다. 연결 준비 저장·로그인 성공·서명 검증을 금융 조회 동의로 간주하지 않습니다. 잔액·거래내역·계좌 소유자명·송금·결제·투자 실행은 첫 규격에서 제외했습니다.

## 현재 사용하는 방법

1. **기본 서비스 연결 → 토스**에서 첫 조회 규격·접근 조건을 확인합니다.
2. **토스 서비스 안내** 경로를 선택하고 **연결 준비 저장**을 누릅니다.
3. **서비스 열기** 또는 **토스 안내·앱 직접 확인**에서 안내를 보고 사용자가 앱을 직접 엽니다. 실제 계좌 확인은 앱 안에서 수행합니다.

준비 API는 `PUT /api/connections/toss`에 `{"routeId":"consumer"}`를 보냅니다. 기존 `consumer`·`apps-in-toss` 경로를 유지하고 `login-guide`·`mydata-auth`·`console-mcp-guide` 안내 링크를 추가했습니다. `toss.connection.open`은 입력 `{}`로 고정 URL만 반환하며 앱·로그인·인증·금융 작업을 실행하지 않습니다.

`toss.connection.status`와 허용된 `GET /api/connections`의 `firstRead`에는 제안 JSON Schema·예시·계정 조건·결과 확인·다음 조사 항목을 제공합니다. 조회 초안 실행은 관리자와 허용된 에이전트 모두 409 `NOT_IMPLEMENTED`로 거절하고 작업을 만들지 않습니다. AI 대화의 허용 기능으로 선택해도 409 `INVALID_GRANT`로 거절합니다.

`automaticActions: 0`·`accountVerified: false`를 유지합니다. 링크 안내·규격 정의·모의 테스트를 실제 금융 연결·계정 검증·지원 실적으로 집계하지 않습니다.

## 운영 콘솔 MCP의 별도 후속 연결

공식 가이드의 서버 주소는 `https://mcp.toss.im/adapters/apps-in-toss-console/mcp`입니다. 미니앱 운영자의 워크스페이스·등록/검수·운영 통계·푸시 등을 다룹니다. 운영 예산/매출 조회를 개인 계좌 잔액으로 표시하지 않습니다.

현재는 `console-mcp-guide`에 안내 링크만 제공합니다. KoreAI 상위 MCP는 정적 Bearer 토큰 연결을 지원하며 OAuth 로그인·갱신은 후속 구현입니다. 실제 로그인·도구 목록·워크스페이스 권한·계정 호환성을 검증해야 합니다. 공통 계정/행동 범위와 승인 정책을 유지하고 상위 도구의 읽기 힌트로 승인을 생략하지 않습니다. [공통 OAuth 후속 작업 MCP-01](../TODO.md).

## 공급자 확인과 활성화 조건

다음은 미발송 문의 질문 초안입니다.

1. 사용자가 토스에 연결한 계좌 목록을 외부 개인용 에이전트에 제공하는 API/제휴 경로가 있는가? 허용된 이용 주체와 인증·권한 조건은 무엇인가?
2. 본인 확인·동의 범위·유효기간·만료/회수와 외부 LLM 전달·보관/삭제 조건을 어떻게 검증해야 하는가?
3. 제공 기관·계좌 종류·부분 조회·페이지·한도·갱신 시각·빈 결과/오류를 어떤 규격으로 구분하는가?
4. 원본 계좌번호를 모델에 전달하지 않고 로컬 참조·끝 네 자리로 표시할 수 있는가?
5. 운영 콘솔 MCP를 별도 연결할 때 OAuth 등록·워크스페이스/도구 권한·호출 한도 조건은 무엇인가?

허용된 조회 경로를 확보하면 KoreAI 사용자·공급자 본인·계정·에이전트 권한과 동의 상태를 서버에서 결속합니다. 본인/타인·부분/빈 결과·만료/철회·마스킹·캐시 삭제·재접속을 검증한 뒤 실행기를 활성화합니다. 금융 조회의 거절을 로그인·인증·운영 MCP 성공으로 바꾸지 않습니다. [정의 코드](../src/connectors/lifestyle/toss-read.ts), [실제 조회 후속 APP-06](../TODO.md).
