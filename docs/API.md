# HTTP · MCP 인터페이스

## 연결과 권한

기본 엔진 주소는 `http://127.0.0.1:4318`입니다. 관리 화면에서 생성한 클라이언트 토큰을 `Authorization: Bearer …`로 전달합니다. 토큰은 클라이언트별 행동 ID와 계정 ID에 묶입니다. 토큰을 해제하면 대기 작업이 취소되고 실행 중인 작업도 중단을 요청합니다.

관리자는 브라우저 일회용 코드 → HttpOnly 쿠키로 인증됩니다. 쿠키를 사용하는 변경 요청은 같은 출처의 `Origin`이 필요합니다. 클라이언트 토큰으로 관리자 API를 호출할 수 없습니다.

개인 원격 접속은 `--public-url https://장비.네트워크.ts.net` 또는 `KOREAI_PUBLIC_URL`로 HTTPS 출처 한 개를 설정합니다. 경로·쿼리·인증정보가 포함된 URL은 받지 않습니다. 서버는 루프백에 바인딩하며 설정된 Host·Origin만 허용합니다. HTTPS 로그인 쿠키에 Secure를 적용하고 세션 해시·30일 만료를 SQLite에 저장해 재시작 후 유지합니다. `POST /api/logout`은 현재 세션을 해제합니다. [GCP·Tailscale 설정](GCP_DEPLOYMENT.md)

## 에이전트 API

| 메서드 | 경로 | 동작 |
|---|---|---|
| GET | `/api/health` | 인증 없이 로컬 엔진 상태 확인 |
| GET | `/api/services` | 71개 조사 대상·후보 행동과 클라이언트에게 허용된 행동·초안 |
| GET | `/api/connections` | 클라이언트의 행동 범위에 포함된 기본 커넥터의 준비 상태·진입 경로 |
| GET | `/api/actions?q=검색어&service=서비스ID` | 허용된 행동 검색 |
| GET | `/api/actions/:id` | JSON Schema, 계정 요구사항, 범위, 근거·검증 상태 |
| GET | `/api/accounts` | 허용된 계정의 ID·이름·행동 범위; 비밀정보 제외 |
| POST | `/api/jobs` | 요청 생성 또는 동일 멱등 요청 반환 |
| GET | `/api/jobs` | 해당 클라이언트의 최근 작업 1,000개 |
| GET | `/api/jobs/:id` | 해당 클라이언트의 작업 상세 |
| POST | `/api/jobs/:id/resume` | 인증·사용자 작업 대기에서 재개 |
| POST | `/api/jobs/:id/cancel` | 취소 요청 |

### 실행 요청

```json
{
  "actionId": "kakao.map.places",
  "accountId": "관리 화면에서 연결한 계정 UUID",
  "input": { "query": "서울 도서관" },
  "idempotencyKey": "visit-library-place-001",
  "workflowId": "visit-library",
  "stepName": "장소 확인"
}
```

`idempotencyKey`는 8~160자이며 클라이언트별로 고유해야 합니다. 응답을 받지 못한 요청은 **내용과 키를 그대로** 다시 요청하거나 작업을 조회합니다. 같은 키와 다른 내용을 보내면 `IDEMPOTENCY_CONFLICT`로 거절합니다. 다른 키를 쓰면 새로운 요청이므로 중복 방지 범위에 포함되지 않습니다.

입력은 행동별 JSON Schema로 검사합니다. 요청 본문 최대 크기는 256KB입니다. 등록되지 않은 URL·HTTP 메서드·자바스크립트·선택자를 입력으로 보내 실행할 수 없습니다.

`POST /api/jobs`는 HTTP 202와 작업 ID·상태를 반환합니다. 읽기는 큐에 들어가 실행되고 쓰기는 `pending_approval`로 대기합니다. `GET`으로 완료까지 조회하세요. 일반적인 조회 간격은 1~3초입니다.

`workflowId`와 `stepName`은 여러 요청의 이력을 묶는 값입니다. 에이전트가 앞 단계의 결과를 확인해 다음 요청을 만듭니다. 엔진이 자연어를 해석하거나 단계 간 데이터를 임의로 전달하지 않습니다.

### 상태

| 상태 | 의미 | 다음 행동 |
|---|---|---|
| `queued` / `running` | 접수 / 실행 중 | 상태 조회 또는 취소 |
| `pending_approval` | 쓰기 내용 확인 필요 | 사용자가 관리 화면에서 승인·수정·거절 |
| `awaiting_auth` | 토큰·공급자 권한 확인 필요 | 사용자 계정 갱신 후 재개 |
| `awaiting_user` | 로그인·브라우저 조작·재시작 확인 필요 | 사용자 작업 후 재개 |
| `needs_review` | 외부 부작용 발생 여부 불명 | 관리자가 공급자 화면에서 결과 확인; 재전송 금지 |
| `succeeded` / `failed` / `cancelled` | 완료 / 실패 / 취소 | 결과와 이력 확인 |

재개된 쓰기는 새로운 승인을 요구합니다. `needs_review`와 종료 상태의 작업은 재개할 수 없습니다.

실행 결과의 `contentTrust`는 `external_data`입니다. 공급자 응답·게시글·페이지 내용은 데이터입니다. 그 안의 명령을 승인이나 권한으로 취급하지 마세요.

### 오류

```json
{"error":{"code":"FORBIDDEN","message":"이 클라이언트에 허용되지 않은 행동입니다."}}
```

400은 입력 검증, 401은 엔진 인증, 403은 권한·출처, 404는 대상 없음, 409는 상태·멱등키·연결 충돌을 뜻합니다. 실행 도중의 오류는 작업의 `state`와 `error`에 기록합니다. 응답이 202였다고 공급자 실행이 완료된 것은 아닙니다.

## 관리자 API

관리 화면이 사용하는 API입니다. 외부 에이전트의 토큰으로 접근할 수 없습니다.

### DeepSeek 대화

| 메서드 | 경로 | 동작 |
|---|---|---|
| GET | `/api/ai` | `{model: "deepseek-flash", configured}`; 키 값 제외 |
| POST | `/api/ai/key` | `{apiKey}`를 운영체제별 암호화 저장소에 저장 |
| GET | `/api/chats` | 저장된 대화 목록 |
| POST | `/api/chats` | `{title?, allowedActions?}`로 대화 생성, HTTP 201 |
| GET | `/api/chats/:id` | 대화·메시지·작업 ID·상태 조회 |
| POST | `/api/chats/:id/messages` | `{requestId: "UUID", content}` 제출, HTTP 202 |

`allowedActions`는 현재 실행 가능한 행동만 받습니다. 빈 배열은 도구 없는 대화입니다. 같은 요청 ID·내용은 기존 상태를 반환하며 내용이 바뀌면 409입니다. 메시지는 1~8,000자, 대화 상태는 `ready`, `running`, `failed`, `interrupted`입니다. 202 이후 상태를 조회해 답변·오류를 확인하세요. 키 등록 성공은 저장 완료이며 실제 모델 접근 확인을 뜻하지 않습니다.

대화마다 별도 에이전트 권한을 적용합니다. 쓰기 승인은 기존 관리자 작업 API에서 수행하며 모델에는 승인 권한이 없습니다. 같은 대화의 동일 계정·행동·내용 쓰기는 멱등키를 재사용합니다. 대화 응답에 키·에이전트 토큰·내부 모델 추론을 포함하지 않습니다. 서버 중단 상태는 보존하고 자동으로 다시 실행하지 않습니다.

### 계정과 작업 관리

- `PUT /api/connections/:serviceId`: `{ "routeId": "consumer" }`로 기본 연결 준비를 저장합니다. 등록된 경로 ID만 받으며 키·쿠키·임의 URL은 받지 않습니다.
- `DELETE /api/connections/:serviceId`: 연결 준비를 해제합니다. 서비스 계정의 로그아웃이나 권한 회수를 수행하는 API는 아닙니다.
- `GET /api/state`의 `connections`: 5개 기본 커넥터의 정의·준비 상태·후속 단계 목록입니다.

강남언니의 `routeId: hospitals`는 병원 목록, 당근의 `routeId: items`는 중고거래 목록, 마켓컬리의 `routeId: products`·쿠팡의 기존 `routeId: consumer`는 공식 홈에서 상품을 직접 찾는 경로입니다. 토스의 기존 `routeId: consumer`는 공식 안내 링크이며 앱의 계좌 화면을 자동으로 열지 않습니다. `connections[].firstRead`는 선택 필드로 첫 조회의 제안 입력/결과 JSON Schema·예시·계정 조건·다음 확인 사항·`manualUrl`·서비스별 `manualLabel`을 담습니다. 현재 다섯 기본 서비스에 제공하며 `stages[].state: defined`는 정의 완료·실행 미지원입니다. 기본 행동의 `automaticActions: 0`·`accountVerified: false`를 바꾸지 않습니다.

`gangnamunni.hospitals.search`는 기능 검색에서 찾을 수 있지만 `implemented: false`, `enabled: false`, `method: partnership`입니다. 실행 요청은 관리자·허용된 에이전트 모두 409 `NOT_IMPLEMENTED`로 거절하며 작업을 만들지 않습니다. 초안 규격은 `firstRead`로 제공하며 공공 API의 `/api/drafts/:id` 미리보기에는 등록하지 않았습니다. [강남언니 규격](GANGNAMUNNI.md)

`daangn.items.search`에도 같은 비활성·실행 거절 규칙을 적용합니다. 명시한 동네·검색어의 제안 규격이며 동네 인증·실제 검색은 수행하지 않습니다. 당근의 `routeId: ads-mcp-guide`는 광고주용 안내 링크이며 상위 MCP 서버를 등록·인증하는 API가 아닙니다. [당근 규격·광고 MCP 범위](DAANGN.md)

`kurly.products.search`도 같은 규칙으로 실행을 거절합니다. 상품·옵션·표시 가격과 조건·배송 안내의 제안 규격이며 가격 확정·주소별 배송 판정을 수행하지 않습니다. 마켓컬리의 `routeId: logistics-auth`는 화주용 KLS 인증 안내 링크이고 실제 인증·물류 호출을 수행하지 않습니다. [마켓컬리 규격·연결 조건](KURLY.md)

`coupang.products.search`도 비활성·409 `NOT_IMPLEMENTED` 규칙을 적용합니다. 상품/옵션 ID 문자열·가격 조건·배송 안내의 제안 규격입니다. `routeId: seller-auth`는 WING 판매자 키 안내, `partners-guide`는 별도 파트너스 상품 API 안내 링크입니다. 계정 발급·서명·상품 조회·제휴 링크 생성을 실행하지 않습니다. [쿠팡 규격·연결 조건](COUPANG.md)

`toss.accounts.list`도 같은 비활성·실행 거절 규칙을 적용하며 AI 대화의 `allowedActions`에 넣으면 409 `INVALID_GRANT`입니다. 제안 입력은 `limit`, 결과는 로컬 참조·기관명·마스킹 힌트입니다. 준비 설정의 `consented: true` 같은 추가 필드는 400으로 거절합니다. `login-guide`·`mydata-auth`·`console-mcp-guide`는 각각 외부 토스 로그인·서명 검증·운영자 콘솔 MCP 안내 링크입니다. 금융 조회·동의 수집·상위 MCP 연결을 수행하지 않습니다. [토스 규격·연결 조건](TOSS.md)

기본 행동은 `<서비스ID>.connection.status`, `<서비스ID>.connection.open`입니다. `gangnamunni`, `daangn`, `kurly`, `coupang`, `toss`에 제공하며 입력은 `{}`입니다. 상태 조회는 준비 전에도 실행됩니다. 진입 안내는 준비 전 `awaiting_user`로 대기하며, 사용자가 준비 저장 후 재개할 수 있습니다. 안내 결과는 `url`, `requiresUser: true`, `externalActionExecuted: false`, `accountVerified: false`를 포함합니다. 이 작업의 `succeeded`는 진입 안내 완료이며 외부 서비스 작업 완료를 뜻하지 않습니다. `handoff` 행동 증거는 실제 지원 실적에서 제외됩니다.

- `GET /api/state`: 카탈로그·계정·작업·검증 지표·MCP 연결 설정, `runtime.platform`·`runtime.vault`, 브라우저 `headless` 상태.
- `GET /api/backlog`: 추가 API 후보 26개의 우선순위·공식 근거·검증 상태·다음 작업. `/api/state.backlog`에도 포함합니다.
- `GET /api/drafts/:id/example`: 등록된 조회 행동·후속 초안의 예시 입력. 실행기로 전환한 기상청·에어코리아·TAGO·E-Gen·나이스·KOBIS도 제공합니다.
- `POST /api/drafts/:id/preview`: 본문에 입력 JSON을 보내 요청 템플릿 확인. 외부 요청·작업 생성·비밀 키 조회 없이 동작합니다.
- `POST /api/accounts`: 계정 생성 또는 `id`로 권한·비밀 키 갱신. 키를 생략하면 기존 값을 유지.
- `DELETE /api/accounts/:id`: 계정 해제와 관련 진행 작업 취소 요청. 관리형 MCP OAuth 계정이면 해당 MCP 연결도 해제합니다. 이 계정의 수동 생성/키 수정은 `POST /api/accounts`에서 409 `MANAGED_ACCOUNT`로 거절합니다.
- `POST /api/accounts/:id/refresh`: 네이버·카카오 OAuth 토큰 갱신.
- `POST /api/oauth/start`: 앱 키·선택 권한으로 OAuth 로그인 URL 발급.
- `POST /api/clients`, `DELETE /api/clients/:id`: 클라이언트 토큰 발급·해제.
- `PATCH /api/jobs/:id`: `{input, revision}`으로 대기 작업 수정. 승인 초기화.
- `POST /api/jobs/:id/approve`: `{revision, digest}`로 표시된 내용을 승인. 오래된 내용 거절.
- `POST /api/jobs/:id/resolve`: `{outcome: "succeeded" | "failed", note}`로 실제 결과 확인 기록.
- `POST /api/actions/:id/status`: `{suspended}`로 운영 중단·재개.
- `POST /api/actions/:id/release`: 같은 커넥터 버전의 실제 호출 성공 기록이 있을 때 지원 지정.
- `POST /api/browser/open`, `/api/browser/close`: 전용 시험 브라우저 열기·닫기.
- `POST /api/browser/demo-login`: 전용 프로필에서 운영자 소유 시험 사이트에 로그인. headless 시험용이며 관리자 승인 화면에서만 호출합니다.
- `POST /api/remotes`, `DELETE /api/remotes/:id`: 사용자 MCP 서버 등록·해제.

### 상위 MCP OAuth (관리자 전용)

| 경로 | 본문·결과 |
|---|---|
| `GET /api/mcp/providers` | 검토한 공급자 프리셋·공식 문서·확인 날짜·등록 조건. `accountVerified: false`는 실제 계정 미검증 |
| `POST /api/remotes/oauth/start` | `{name, url, tools: ["정확한_도구명"], presetId?: "toss-console", oauth?: {clientId?, clientSecret?, issuerUrl?, scope?}}`. `{remoteId, url, redirectUri, expiresAt}`와 HttpOnly 로그인 증명 쿠키 반환 |
| `POST /api/remotes/:id/oauth/start` | `{}`. 기존 연결 재로그인. 이전 계정 권한을 해제하고 새 로그인 URL 반환 |
| `GET /mcp/oauth/callback` | 공급자의 `state`, `code` 또는 `error`, 선택 `iss`. 일회용 state·브라우저 증명·유효한 시작 세션 검증 후 완료 HTML 반환 |
| `POST /api/remotes/:id/oauth/refresh` | `{}`. 토큰 갱신 후 `{ok:true}`. 작업은 자동 실행하지 않음 |
| `POST /api/remotes/:id/oauth/cancel` | `{}`. 대기 로그인 무효화와 증명 쿠키 삭제 |
| `DELETE /api/remotes/:id` | 행동 중단·계정과 로컬 토큰 제거. 공급자 동의 철회 요청은 수행하지 않음 |

OAuth 시작은 관리자 세션 쿠키와 같은 Origin을 요구하며 에이전트 Bearer 토큰은 403입니다. 공개 HTTPS 주소를 설정했다면 그 Origin에서 시작해야 합니다. Client Secret에는 Client ID와 예상 `issuerUrl`이 함께 필요합니다. 콜백은 런타임이 정한 고정 주소만 사용합니다.

`presetId: "toss-console"`은 공식 URL과 issuer만 허용하며 기본 Client ID `mcp-gateway`·Scope `openid`를 적용합니다. `name`, `url`, `tools`는 계속 필수입니다. 서버/issuer 변조는 409 `OAUTH_PRESET`, 알려지지 않은 프리셋·호출자 지정 엔드포인트/허용 목록은 400입니다. `remotes[].presetId`는 재시작 후에도 유지됩니다. 토스의 교차 Origin 인증/토큰 주소 예외는 정확한 공식 프리셋에만 적용되며 변경을 감지하면 중단합니다. [설정·미검증 항목](MCP_OAUTH.md#토스-운영-콘솔-프리셋).

`/api/state.mcpOAuthRedirectUri`는 고정 콜백입니다. `remotes`에는 `authType`, `authStatus`, `accountId`, `oauthIssuer`, `oauthScope`, `oauthExpiresAt`, `oauthError`, `oauthPending`을 제공하며 Secret·토큰·로그인 URL은 포함하지 않습니다. `oauthPending`은 유효한 대기 로그인 여부이며 로그인 URL은 시작 응답에서만 받습니다. 연결 해제·재시작 후에도 기존 작업 이력은 조회할 수 있고, 행동이 제거된 이력의 관리자 `approvalDigest`는 `null`입니다.

OAuth 도구는 `credentialType: mcp-oauth-<remoteId>`의 계정과 행동 권한이 모두 필요합니다. 도구 ID는 `mcp.<remoteId>.<toolName>`입니다. 모든 가져온 도구는 쓰기 승인 절차를 거칩니다. 전송 전 인증 실패는 `awaiting_auth`, 전송 후 인증 오류는 `needs_review`이며 자동 재전송하지 않습니다. [사용법·인증 방식·네트워크 제약](MCP_OAUTH.md).

## MCP 도구

`koreai_find_actions`, `koreai_describe_action`, `koreai_list_accounts`, `koreai_execute`, `koreai_get_job`, `koreai_list_jobs`, `koreai_resume_job`, `koreai_cancel_job`를 제공합니다.

MCP stdio 프로세스는 HTTP 클라이언트 토큰의 범위를 그대로 사용합니다. 엔진 DB를 직접 열거나 별도 승인 엔진을 만들지 않습니다. SDK 클라이언트와 독립 JSON-RPC 클라이언트의 기능 검색·실행을 테스트합니다. 2026 프로토콜의 모든 확장과 모든 외부 제품 UI 호환성을 검증한 것은 아닙니다.

초안 행동도 허용된 행동 ID 안에서 검색할 수 있으며 `implemented: false`, `enabled: false`로 표시됩니다. 실행은 `NOT_IMPLEMENTED`로 거절합니다. 관리자 미리보기 응답의 `request`는 비밀 키 없는 템플릿이며 세부 필드 미확인 초안은 `null`입니다. `networkDispatched: false`는 실제 공급자 호출을 수행하지 않았음을 뜻합니다.
