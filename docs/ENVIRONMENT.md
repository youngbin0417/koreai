# API 키와 환경변수

저장소에는 **`.env.example`만** 올립니다. `.env`, `.env.local`, `.env.production`, `.env.backup` 등 `.env*`는 Git에서 제외합니다. 실제 키·토큰은 예시·문서·커밋 메시지에 넣지 않습니다.

## Linux에서 시작하기

프로젝트 작업 폴더에서 한 번 준비합니다. 기존 `.env`는 덮어쓰지 않습니다.

```bash
test -e .env || install -m 600 .env.example .env
chmod 600 .env
nano .env
npm run build
npm start
```

필요한 공급자의 빈 키 슬롯에 발급받은 키를 입력하고 해당 `_ACTIONS` 목록에서 사용할 행동만 남깁니다. 예시는 26개 API 계정 유형의 키와 현재 조회 행동을 안내하며, 게시/메시지/일정 쓰기는 기본 권한이 비어 있습니다. 공급자의 활용신청·승인도 별도로 필요합니다. 예시는 실제 키를 포함하지 않습니다.

```dotenv
# 실제 값은 로컬 .env에만 입력합니다.
KOREAI_SEOUL_SUBWAY_ROUTE_SERVICE_KEY=
KOREAI_SEOUL_SUBWAY_ROUTE_ACTIONS=seoul-subway.route
KOREAI_SEOUL_SUBWAY_API_KEY=
KOREAI_SEOUL_SUBWAY_ACTIONS=seoul-subway.arrivals,seoul-subway.timetable
DEEPSEEK_API_KEY=
```

지하철 경로는 공공데이터포털 일반 인증키(Decoding)로 HTTPS 호출합니다. 도착·시간표는 별도 서울시 키이며 HTTP 허용 기본값은 `0`입니다. 필요한 경우 키 전송 조건을 확인한 운영자가 `KOREAI_ALLOW_SEOUL_SUBWAY_HTTP=1`로 바꿉니다. 키를 넣는 것만으로 HTTP 허용 설정이 변경되지 않습니다. 공공파일·OP.GG 공개 MCP에는 API 키가 필요하지 않습니다. [지하철 사용 안내](SEOUL_TRANSIT.md)

## 로딩과 변경

- 서버·AI CLI·MCP 실행기·진단 명령은 **작업 폴더의 `.env`**를 읽습니다. 다른 위치는 실행 환경의 `KOREAI_ENV_FILE=/absolute/path/server.env`로 지정합니다. 이 경로 설정은 `.env` 안에서 재귀적으로 처리하지 않습니다.
- **이미 설정된 셸/systemd 환경변수가 파일보다 우선**합니다. 빈 문자열로 설정된 셸 변수도 파일 값을 덮습니다. GCP 서비스의 기존 `~/.config/koreai/server.env`는 systemd가 읽으므로 같은 이름이 있으면 프로젝트 `.env`보다 우선합니다. 작업 폴더와 파일 경로를 고정하세요.
- Node의 [`util.parseEnv`](https://nodejs.org/docs/latest-v22.x/api/util.html#utilparseenvcontent)로 따옴표·주석을 처리합니다. 애플리케이션은 파일의 `KOREAI_*`와 `DEEPSEEK_API_KEY`만 읽고 `process.env`를 수정하지 않습니다. API 키를 `VITE_*` 이름에 넣지 마세요. 프론트엔드 공개 설정과 키를 구분합니다.
- 변경 후 서버를 재시작합니다. `npm start`는 빌드된 코드를 쓰므로 코드 변경 후에는 먼저 빌드합니다. systemd 사용 시 해당 사용자 서비스를 재시작합니다. 명시한 파일을 읽지 못하면 값이나 원문을 출력하지 않고 시작 오류로 처리합니다.

## 환경 관리 계정과 권한

키를 넣은 공급자는 **연결 계정**에 `.env · 공급자 이름`으로 나타납니다. `_ACTIONS`는 쉼표로 구분한 명시적 행동 ID입니다. 없거나 비면 허용 행동은 0개이며 전체 권한을 자동 부여하지 않습니다. 다른 공급자·중단·미구현·사용자 설치 행동을 넣으면 시작 전에 설정 오류로 처리합니다. 치지직처럼 여러 필드가 필요한 계정은 모든 필드를 입력해야 합니다.

`.env`는 운영자가 관리하는 평문 원본입니다. 기존 엔진은 실행용 계정을 OS 비밀정보 저장소로 암호화해 DB에 반영합니다. 재시작 시 키 회전과 권한 축소를 반영하고 같은 계정 ID를 유지합니다. 키를 전부 지우면 **해당 환경 관리 계정**을 제거하고 대기 작업을 취소합니다. 수동 계정은 별도로 유지합니다. 환경 계정은 화면/API의 수정·삭제·OAuth 갱신으로 변경하지 않고 `.env`에서 관리합니다. 여러 키/동일 공급자 여러 계정은 기존 수동 계정 기능을 사용할 수 있습니다.

외부 MCP 클라이언트·DeepSeek 대화의 행동/계정 권한은 자동으로 늘리지 않습니다. 쓰기 행동을 `_ACTIONS`에 명시해도 대상·내용의 사용자 승인이 필요합니다. 키 등록은 공급자의 승인·실제 검증·배포 지원을 의미하지 않습니다. API 응답과 일반 로그에는 키를 노출하지 않습니다.

## DeepSeek

`DEEPSEEK_API_KEY`가 있으면 기존 암호화 파일보다 우선합니다. 잘못된 환경 키는 오류로 처리하며 다른 키나 모델로 자동 전환하지 않습니다. 환경 키가 비어 있으면 기존 암호화 키를 계속 사용할 수 있습니다. 기존 키를 복호화해 `.env`로 자동 이전하지 않습니다. 모델은 계속 **`deepseek-flash`(V4.1 Flash)**로 고정합니다.

환경 키 사용 시 대화 화면은 `.env` 관리 상태를 표시하며 키 변경은 파일 수정·재시작으로 진행합니다. 파일·환경 키의 값은 상태 API와 진단 결과에 반환하지 않습니다.
