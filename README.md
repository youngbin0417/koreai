# KoreAI

한국 생활 서비스를 외부 AI 에이전트가 호출하도록 연결하는 **Linux 우선 로컬 게이트웨이**입니다. 계정·승인·작업 이력을 한국어 관리 화면에서 관리하고 MCP 또는 HTTP로 연결합니다.

**현재 버전: 0.1.0-alpha.1.** 71개 서비스 조사 카탈로그, 8개 공식 API 커넥터의 20개 행동, 강남언니·당근마켓·마켓컬리·쿠팡·토스의 기본 커넥터 5개, 별도 브라우저 실행기, 기존 MCP 서버 연결을 구현했습니다. 공식 서비스의 실제 키·계정 검증은 사용자의 계정 연결 이후에 수행됩니다. 기본 커넥터의 진입 안내와 시험 데이터 성공을 실제 서비스 실행·지원 실적에 포함하지 않습니다.

**확장 계획:** [추가 앱·API 후보 26개](docs/APP_API_BACKLOG.md)를 기록하고 기상청·에어코리아·TAGO·E-Gen·나이스·KOBIS의 조회 초안 6개를 등록했습니다. 관리 화면의 **확장 계획**에서 입력 예시와 요청 구조를 확인할 수 있습니다. 초안은 비활성 상태이며 지원 실적과 구현된 API 행동 수에 포함하지 않습니다.

**다음 할 일:** [작업 체크리스트](TODO.md)에서 우선순위·완료 기준·필요한 조건을 관리합니다. Linux 운영 검증, 실제 API 호출 검증, 새 조회 API 구현, 생활 앱 5개의 세부 기능 정의 순서로 진행합니다.

## 빠른 시작

필요한 환경: Linux, Node.js **22.17 이상**, npm. 브라우저 실행은 Playwright가 설치한 Chromium을 기본으로 사용합니다. API·MCP 연결만 사용하면 브라우저나 그래픽 환경은 필요하지 않습니다. Node 내장 SQLite는 22.x에서 실험 기능 경고를 출력할 수 있습니다.

프로젝트 폴더에서:

```bash
npm ci
npm run build
npm start
```

브라우저 시험도 사용할 경우 실행할 Linux 사용자로 아래 명령을 추가로 실행하세요. OS 패키지 설치 단계는 관리자 권한을 요구할 수 있습니다. 지원 배포판과 필요한 패키지는 [Playwright 공식 문서](https://playwright.dev/docs/browsers#install-system-dependencies)를 따릅니다.

```bash
npx playwright install --with-deps chromium
```

설치와 빌드가 준비된 뒤에는 `sh Start-KoreAI.sh`로 실행해도 됩니다. 스크립트는 의존성을 자동 다운로드하지 않습니다.

터미널에 표시되는 **관리 화면 주소**를 브라우저에서 열고 `로컬 엔진 연결`을 누르세요. 주소의 일회용 코드는 접속 후 주소창에서 제거되고, HttpOnly 세션 쿠키로 전환됩니다. 세션은 8시간이며 엔진 재시작 시 새 코드가 발급됩니다. 관리 화면 기본 주소는 `http://127.0.0.1:4318`입니다.

GUI 없는 Linux 서버에서는 headless가 자동 선택됩니다. 명시적인 서버 실행과 그래픽 세션 실행:

```bash
npm start -- --headless --port 4318 --data-dir "$HOME/.local/share/koreai"
npm start -- --headed --channel chromium
```

원격 Linux 서버는 포트를 외부에 공개하지 않고 `ssh -L 4318:127.0.0.1:4318 user@server`로 연결합니다. 터미널에 표시된 관리 주소를 내 PC 브라우저의 `127.0.0.1:4318`에서 열면 됩니다. 상시 실행용 [systemd 사용자 서비스](deploy/koreai.service)와 상세 설치 순서는 [운영 문서](docs/OPERATIONS.md)에 있습니다.

1. **연결 계정**에서 API 앱 키 또는 사용자 접근 토큰을 등록하고 허용할 행동을 선택합니다.
2. **서비스 카탈로그**에서 행동을 선택해 요청합니다. 쓰기 작업은 **작업과 승인**에서 내용을 확인해야 실행됩니다.
3. **에이전트 연결**에서 행동·계정 범위를 지정하고 MCP 설정을 복사합니다.
4. **브라우저 시험**에서 전용 프로필의 읽기·게시 흐름을 확인합니다. 실제 창에서 직접 조작하려면 그래픽 세션의 `--headed` 모드를 사용합니다.

화면의 ‘실행 준비’는 키와 권한 선택이 구성됐다는 뜻입니다. 공급자 심사·실제 권한·계정 검증 완료를 의미하지 않습니다.

## 강남언니·당근마켓·마켓컬리·쿠팡·토스 기본 연결

관리 화면의 **기본 서비스 연결**에서 서비스별 진입 경로를 선택하고 `연결 준비 저장`을 누릅니다. 준비 상태와 경로는 SQLite에 저장되며 재시작 후 유지됩니다. 서비스·파트너 안내 링크를 열고 필요한 로그인·인증은 사용자가 진행합니다.

MCP/HTTP에서는 각 서비스의 `<서비스ID>.connection.status`와 `<서비스ID>.connection.open`을 호출할 수 있습니다. 서비스 ID는 `gangnamunni`, `daangn`, `kurly`, `coupang`, `toss`입니다. 입력은 `{}`이며, `open`은 준비한 고정 진입 URL을 반환합니다. 외부 브라우저나 앱을 자동 조작하는 행동은 아닙니다.

세부 기능은 **조회 → 초안·사용자 확인 → 승인 후 실행** 순으로 정의합니다. 공급자 API의 범위·제휴 조건, 후속 행동 추가 방법은 [기본 연결 개발 문서](docs/LIFESTYLE_CONNECTIONS.md)에 기록했습니다.

## DeepSeek V4.1 Flash로 프로젝트 API 테스트

DeepSeek를 테스트 에이전트로 연결합니다. 모델이 KoreAI의 실제 HTTP API로 기능을 검색하고 작업을 생성한 뒤 결과를 조회합니다. 공식 API 모델 ID는 **`deepseek-flash`**이며 [DeepSeek 공식 문서](https://api-docs.deepseek.com/)에서 V4.1 Flash로 안내합니다. 모든 모델 요청에 이 ID를 고정합니다.

```bash
npm run ai:key                # 키를 숨김 입력으로 암호화 저장
npm run ai:check              # 접근 권한과 모델 확인
npm run ai:check -- --smoke    # 작은 실제 응답으로 확인 (API 사용량 발생)
npm run ai:test               # 실제 모델 → 로컬 엔진 → 전용 브라우저 시험
npm run ai:test -- --scenario connections  # 실제 모델 → 5개 기본 연결 상태·진입 안내
```

`ai:test`는 별도 시험 DB·브라우저 프로필·범위가 제한된 클라이언트를 생성합니다. 실제 DeepSeek의 [도구 호출](https://api-docs.deepseek.com/guides/tool_calls/)로 시험 게시글 조회 → 게시 요청 → 승인 대기를 수행합니다. 시험 관리자가 지정된 제목·내용을 대조해 승인한 뒤 모델이 완료와 새 페이지를 확인합니다. 에이전트 승인 요청의 HTTP 403, 같은 멱등키로 재요청했을 때 게시글이 하나만 남는지도 검사합니다. 이 승인은 운영자 소유 시험 사이트에만 적용됩니다. 결과와 도구 호출 기록은 `.test-data/deepseek-live/`에 저장하며 실패 시 종료 코드 1을 반환합니다. 실제 모델 호출에 API 사용량이 발생합니다.

실제 국내 서비스 조회는 먼저 해당 공급자의 키로 관리 화면에서 계정을 연결하고, 해당 행동·계정만 허용한 클라이언트 토큰을 발급하세요. DeepSeek 키는 모델 호출용이며 네이버·카카오 등의 계정 권한은 별도로 필요합니다. 예를 들어 카카오 장소 검색은:

```bash
read -rs -p 'KoreAI 클라이언트 토큰: ' KOREAI_TOKEN; echo
export KOREAI_TOKEN
npm run ai:test -- --scenario service-read --action kakao.map.places --account-id 계정UUID --input '{"query":"서울도서관"}'
unset KOREAI_TOKEN
```

`service-read`는 이미 실행 중인 엔진을 사용하며 읽기만 허용합니다. `--url`과 `--data-dir`로 엔진 주소와 DeepSeek 키 저장 폴더를 지정할 수 있습니다. 시험 사이트 성공은 국내 서비스 지원 실적에 포함되지 않습니다. API 키는 `.koreai/deepseek.secret.json`에 암호화해 저장합니다. Linux에서는 해당 Linux 사용자로 `ai:key`를 실행하세요. Windows DPAPI 키 파일은 Linux에서 복호화되지 않습니다. Linux 브라우저 준비는 위의 Playwright 설치 안내를 따릅니다.

## 서비스 API 계정 준비

| 계정 종류 | 필요한 값 | 준비 및 제한 |
|---|---|---|
| 네이버 검색 앱 | `clientId`, `clientSecret` | [NAVER Developers](https://developers.naver.com/docs/common/openapiguide/appregister.md)에서 검색 API를 사용 설정합니다. |
| 네이버 사용자 | `accessToken` 또는 OAuth 앱 키 | 카페·캘린더 사용 설정과 사용자 동의가 필요합니다. [로그인 API](https://developers.naver.com/docs/login/api/api.md) |
| 밴드 사용자 | `accessToken` | [BAND Developers](https://developers.band.us/develop/guide/api)에서 앱 등록·권한 발급 후 토큰을 가져옵니다. |
| 카카오 검색·지도 앱 | `restApiKey` | [카카오디벨로퍼스](https://developers.kakao.com/docs/ko/local/dev-guide)의 REST API 키를 사용합니다. |
| 카카오 사용자 | `accessToken` 또는 OAuth 앱 키 | `talk_message` 동의가 필요합니다. 템플릿 링크 도메인은 개발자 앱에 등록해야 합니다. [문서](https://developers.kakao.com/docs/ko/kakaotalk-message/rest-api) |
| 공공데이터포털 | `serviceKey` | [공공서비스(혜택) 정보](https://www.data.go.kr/data/15113968/openapi.do)에 활용 신청한 일반 인증키(Decoding)를 사용합니다. |

네이버·카카오 OAuth를 사용할 때는 개발자 콘솔에 관리 화면이 표시하는 콜백 주소를 등록하세요. 기본값은 `http://127.0.0.1:4318/oauth/callback`입니다. 앱이 해당 주소를 허용하는지 확인하고, 허용되지 않는 환경에서는 공급자 절차로 발급받은 토큰을 직접 등록할 수 있습니다. 밴드의 초기 연결은 토큰 직접 등록 방식입니다.

OAuth로 연결한 계정의 갱신 토큰은 암호화해 저장합니다. 토큰이 만료되면 작업은 `인증 필요`로 전환됩니다. 계정 화면에서 토큰을 갱신하거나 다시 연결한 뒤 작업을 재개하세요. 쓰기는 다시 승인을 요구합니다.

## MCP와 HTTP

엔진을 먼저 실행하고, 관리 화면에서 생성한 클라이언트 토큰으로 MCP 프로세스를 연결합니다. 관리 화면은 실제 Node·프로젝트 경로가 들어간 설정을 제공합니다.

```json
{
  "mcpServers": {
    "koreai": {
      "command": "node",
      "args": ["/home/사용자/koreai/dist/mcp.js"],
      "env": {
        "KOREAI_URL": "http://127.0.0.1:4318",
        "KOREAI_TOKEN": "관리 화면에서 발급한 클라이언트 토큰"
      }
    }
  }
}
```

MCP 설정의 경로는 **MCP 클라이언트가 실행되는 장치**의 경로입니다. 위 예시는 Linux에서 엔진과 클라이언트를 같이 실행하는 경우입니다. 내 PC의 클라이언트에서 원격 엔진을 사용할 때는 내 PC에 빌드한 `dist/mcp.js`와 SSH 터널 주소를 지정합니다.

MCP 도구는 기능 검색·설명·계정 목록·실행·작업 조회·재개·취소를 제공합니다. 클라이언트에는 승인, 계정 키 저장, 다른 클라이언트 토큰 발급 권한이 없습니다. [HTTP·MCP 인터페이스](docs/API.md)에 요청 예제가 있습니다.

기존 MCP 서버는 **Streamable HTTP** 방식으로 가져옵니다. HTTPS 또는 사용자가 지정한 로컬 HTTP 주소와 도구 이름을 등록하세요. 사용자 설치 도구로 표시하며 `readOnlyHint`와 관계없이 호출마다 승인이 필요합니다. 상위 MCP의 OAuth 자동 설정·SSE 전용 연결은 현재 범위에 포함되지 않습니다.

## 브라우저 실행

작업용 프로필은 데이터 폴더의 `browser-profiles/owned-demo`에 생성됩니다. 평소 사용하는 프로필을 복사하지 않습니다. 기본 채널은 Linux에서 `chromium`, Windows에서 `msedge`이며, 설치된 Chrome은 `--channel chrome`으로 지정할 수 있습니다.

`--headless`는 브라우저 창을 표시하지 않습니다. 사용자 로그인이 필요한 실제 서비스 레시피를 추가할 때는 Linux 그래픽 세션에서 `--headed`로 직접 로그인하고 동일한 사용자·데이터 폴더·브라우저 채널을 유지해야 합니다. SSH 포트 전달은 관리 화면에만 적용되며 브라우저 창을 전달하지 않습니다. 현재 실제 서비스용 브라우저 레시피는 활성화되어 있지 않습니다.

현재 기본 브라우저 커넥터는 KoreAI가 제공하는 로컬 시험 사이트만 허용합니다. 읽기·폼 입력·제출·완료 확인을 구현했으며 화면 구조가 바뀌면 중단합니다. 실제 한국 서비스에 대한 범용 화면 조작이나 인증·차단 우회 기능은 제공하지 않습니다. 실제 사이트 연결은 [커넥터 개발 문서](docs/CONNECTORS.md)의 절차로 추가합니다.

## 데이터와 운영

- SQLite와 설정·작업 이력은 기본 `.koreai` 폴더에 저장합니다. 한 데이터 폴더에 엔진 하나만 실행합니다.
- Linux의 API 키·토큰은 AES-256-GCM으로 암호화합니다. 마스터 키는 기본 `$XDG_CONFIG_HOME/koreai/master.key` 또는 `~/.config/koreai/master.key`에 보관하며 디렉터리 `0700`·파일 `0600` 권한을 적용합니다. `--master-key-file` 또는 `KOREAI_MASTER_KEY_FILE`로 별도 위치를 지정할 수 있습니다. DB와 마스터 키를 함께 가진 사용자는 복호화할 수 있으므로 둘을 분리해 보관하세요.
- Windows 호환 실행은 현재 사용자 범위의 DPAPI를 유지합니다. 운영체제·사용자를 바꿀 때는 기존 계정을 새 환경에서 다시 연결합니다.
- 브라우저 프로필은 브라우저가 관리하는 로컬 세션 저장소입니다. 별도 프로필도 계정 접근 정보를 포함하므로 공개 저장소에 넣지 않습니다.
- 모델에는 실행에 필요한 결과가 전달됩니다. 로컬 저장은 선택한 외부 모델로 전달되는 결과까지 로컬에 머문다는 뜻은 아닙니다.
- 비밀정보는 결과·로그에서 제거하고 실행 결과는 외부 데이터로 표시합니다. 작업 본문·결과는 로컬 DB에 남습니다.
- 전송 후 응답이 유실된 쓰기는 `결과 확인 필요` 상태가 됩니다. 자동 재시도하지 않습니다.
- 실행 중인 엔진의 관리 화면과 브라우저 시험은 루프백에서만 열립니다. 기본 CORS·Host 검사와 관리자/에이전트 권한을 적용합니다.

[운영·백업·오류 보고](docs/OPERATIONS.md)를 참고하세요.

## 개발과 검증

```bash
npm run check
npm run build
npm test
```

브라우저·화면 통합 테스트는 Linux의 Chromium과 Windows의 Edge를 headless로 사용합니다. `KOREAI_TEST_BROWSER_CHANNEL`로 테스트 채널을 지정할 수 있습니다. UI 테스트 전 `build`와 해당 브라우저 설치가 필요합니다. GitHub Actions에는 Ubuntu·Windows 검증을 구성했습니다. 실제 실행 결과와 아직 검증하지 않은 범위는 [검증 기록](docs/VALIDATION.md)에 구분합니다. 공식 API는 모의 응답으로 검증하며 실제 공급자에 게시하지 않습니다.

개발 UI는 터미널 두 개에서 실행합니다.

```bash
npm run dev
npm run dev:ui
```

첫 명령에 표시되는 `127.0.0.1:5173` 관리 화면 주소로 접속하세요. Vite가 API 요청을 로컬 엔진으로 전달합니다.

설계와 상태 전이는 [ARCHITECTURE.md](docs/ARCHITECTURE.md), 검증 구분은 [VALIDATION.md](docs/VALIDATION.md), 다음 확장은 [ROADMAP.md](docs/ROADMAP.md)에 정리했습니다.

추가 커넥터의 행동·권한·결과 확인 규격과 구현 절차는 [커넥터 개발 문서](docs/CONNECTORS.md)를 참고하세요. 조사 목록과 실제 지원 실적은 별도로 유지합니다.

### Windows 호환 실행

Windows 10/11에서는 `npm.cmd ci`, `npm.cmd run build`, `npm.cmd start` 또는 [Start-KoreAI.cmd](Start-KoreAI.cmd)를 사용합니다. 기본 브라우저는 설치된 Edge이며, 비밀정보 저장은 DPAPI를 사용합니다. Linux로 옮길 때 Windows의 `node_modules`나 브라우저 프로필을 복사하지 말고 Linux에서 설치한 뒤 계정을 다시 연결하세요.

## 라이선스

엔진과 기본 커넥터는 [Apache-2.0](LICENSE)입니다. 개별 서비스 이용 권한과 API 이용조건은 해당 공급자의 조건을 따릅니다. 외부 패키지의 라이선스는 각 패키지에 포함됩니다.
