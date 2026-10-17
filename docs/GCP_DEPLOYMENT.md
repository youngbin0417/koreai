# GCP VM에서 휴대폰으로 사용하기

따릉이 API를 추가로 사용한다면 [따릉이 연결 설정](SEOUL_BIKE.md#연결-조건과-linux-설정)을 참고하세요. 서울 데이터 키를 HTTP로 전송하므로 기본 차단하며, 운영자가 사용 조건을 확인한 뒤 서버 환경 변수로 허용합니다. Tailscale HTTPS가 공급자까지의 HTTP 구간을 암호화하지는 않습니다.

기준: **2026-10-13**, 개인 사용자 1명. GCP VM에서 KoreAI·DeepSeek API 호출·서비스 작업을 실행하고 휴대폰 웹 화면으로 대화·확인·승인합니다. 실제 GCP 배포와 휴대폰 설치는 사용자의 VM에서 진행합니다.

## 1. VM 만들기

| 항목 | 첫 구성 |
|---|---|
| OS | Ubuntu 24.04 LTS, x86_64/amd64 일반 이미지 |
| 머신 | E2 `e2-medium`, RAM 4GB. 개인 시작 구성 제안이며 브라우저 동시 실행이 많으면 증설 |
| 지역 | 서울 `asia-northeast3`에서 사용 가능한 영역 |
| 디스크 | 균형 영구 디스크 30GB |
| 네트워크 | 설치/API 요청에 필요한 외부 인터넷 접속. 관리 접속은 GCP SSH/IAP |
| 웹 접근 | 서버와 휴대폰을 같은 Tailscale 네트워크에 연결해 HTTPS 사용 |

Ubuntu 이미지와 E2 규격은 [Google OS 이미지 문서](https://docs.cloud.google.com/compute/docs/images/os-details), [E2 머신 문서](https://docs.cloud.google.com/compute/docs/general-purpose-machines#e2_machine_types)를 참고합니다. `e2-medium`은 공유 코어 방식입니다. 실제 비용은 VM 생성 화면에서 선택한 지역·디스크·네트워크의 견적을 확인하세요. 모델은 DeepSeek API를 호출하므로 GPU는 필요하지 않습니다.

KoreAI의 4318 포트는 루프백에 유지합니다. 이 구성은 Tailscale HTTPS로 접속하며 GCP의 일반 HTTP/HTTPS 서버 허용 옵션은 필요하지 않습니다. SSH는 본인 접속 경로에 맞춰 허용합니다. [Tailscale Serve](https://tailscale.com/docs/reference/tailscale-cli/serve)는 같은 Tailscale 네트워크에서 로컬 서비스를 제공합니다.

## 2. VM에 코드 준비

현재 변경을 저장소에 반영한 뒤 VM의 **일반 SSH 사용자**로 실행합니다. `<저장소주소>`는 본인 저장소 주소로 바꾸세요.

```bash
sudo apt-get update
sudo apt-get install -y git
git clone <저장소주소> "$HOME/koreai"
cd "$HOME/koreai"
bash deploy/setup-gcp.sh
```

설치기는 공식 Node 24 LTS 배포 파일의 SHA256을 확인하고 사용자 전용 경로에 설치합니다. 의존성·빌드·Chromium·Tailscale을 준비하고 사용자 systemd 서비스로 실행합니다. OS 패키지 설치에는 sudo가 필요하며 코드·데이터·키·브라우저는 해당 SSH 사용자 소유로 유지합니다. 기존 VM의 Tailscale 설정은 유지합니다.

Windows의 `node_modules`, `.koreai`, DPAPI로 암호화한 키 파일을 이 설치에 복사하지 않습니다. 서버에서 계정 키를 다시 등록합니다.

## 3. 휴대폰 접속 연결

서버에서:

```bash
sudo tailscale up
# 표시된 인증 주소를 열어 본인 계정으로 연결
bash deploy/enable-mobile.sh
```

휴대폰에 Tailscale을 설치하고 같은 계정/네트워크로 연결합니다. 서버에 출력된 `https://장비이름.네트워크이름.ts.net`을 휴대폰 브라우저에서 열고 관리 화면의 일회용 연결 코드로 로그인하세요. HTTPS 인증서 사용 안내가 나오면 본인 Tailscale 설정에서 활성화합니다. 같은 네트워크의 접근 권한은 본인 사용 범위로 설정합니다.

설정 스크립트는 `~/.config/koreai/server.env`에 `KOREAI_PUBLIC_URL`을 저장합니다. 이 값이 Host·Origin 허용 목록과 OAuth 콜백 주소에 반영됩니다. 외부 URL은 HTTPS 한 개만 명시적으로 허용하며 임의 프록시 헤더로 주소를 결정하지 않습니다.

로그인 쿠키는 HttpOnly·SameSite=Strict이며 HTTPS 로그인에서 Secure를 적용합니다. 세션은 해시로 SQLite에 보관해 서버 재시작 후 유지하고 30일 뒤 만료됩니다. 로그아웃하면 해당 세션이 해제됩니다. 만료 후에는 서버를 재시작해 새 연결 코드로 로그인할 수 있습니다.

## 4. 기존 DeepSeek 키 연결

휴대폰의 **AI 대화 → DeepSeek 키 연결**에서 기존 키를 입력합니다. 서버의 Linux 저장소에 암호화해 저장하며 모델은 `deepseek-flash`만 사용합니다. 일반 대화는 서비스 계정 연결 전에도 가능합니다.

SSH에서 등록하는 방법도 있습니다:

```bash
export PATH="$HOME/.local/lib/koreai-node24/bin:$PATH"
export KOREAI_MASTER_KEY_FILE="$HOME/.config/koreai/master.key"
cd "$HOME/koreai"
npm run ai:key -- --data-dir "$HOME/.local/share/koreai"
npm run ai:check -- --data-dir "$HOME/.local/share/koreai"
```

키 입력은 숨김 처리합니다. DeepSeek 키는 모델 호출용입니다. 네이버·카카오·기상청 등은 **서비스 계정 연결**에서 해당 공급자의 키·토큰을 별도로 등록해야 합니다.

## 5. 대화와 승인

1. **AI 대화**에서 새 대화를 시작하고 사용할 기능을 선택합니다. 새 대화의 기본 선택은 연결된 공식 API의 조회 기능입니다.
2. 예를 들어 카카오 계정을 연결한 뒤 장소 검색을 허용하고 “강남역 근처 도서관을 찾아줘”라고 요청합니다.
3. 게시·메시지·일정 행동을 선택했다면 모델의 실행 요청은 승인 대기로 남습니다. **작업과 승인** 카드에서 대상·내용을 확인하거나 수정한 후 승인합니다.
4. 실행 후 **결과 이어서 확인**을 눌러 기존 작업의 결과를 확인합니다.

화면을 닫아도 접수한 대화는 서버에서 진행됩니다. 대화 기록을 다시 선택하면 작업 상태를 확인할 수 있습니다. 같은 메시지 요청 ID는 중복 처리하지 않고, 같은 대화에서 같은 계정·행동·내용의 쓰기는 기존 멱등 요청을 재사용합니다. 같은 내용을 새로 실행해야 할 때는 새 대화에서 요청합니다. 서버 중단으로 끊긴 대화는 중단 상태로 보존하며 자동 재전송하지 않습니다. 실패했더라도 생성된 작업 상태를 확인하세요.

대화마다 최대 20개 작업, 메시지당 최대 6회 모델 호출을 허용합니다. 대화가 길어지면 새 대화를 시작합니다. 화면에 내부 모델 추론·계정 토큰·에이전트 토큰은 전달하지 않습니다.

## 6. 홈 화면에 설치

Android Chrome의 설치/홈 화면 추가, iPhone Safari의 공유 → 홈 화면에 추가를 사용합니다. 지원 여부는 실제 휴대폰 브라우저에서 확인하세요. [PWA 설치 안내](https://developer.mozilla.org/en-US/docs/Web/Progressive_web_apps/Guides/Installing)

이 앱은 온라인 사용을 전제로 합니다. 서비스 워커는 API 응답·대화·승인·비밀정보를 캐시하지 않습니다. 휴대폰 화면이 앱처럼 열리는 기능과 휴대폰에 설치된 다른 앱을 직접 조작하는 기능은 별도 범위입니다.

## 운영·업데이트·백업

```bash
systemctl --user status koreai
journalctl --user -u koreai -n 30 --no-pager
systemctl --user restart koreai
```

서비스는 SSH 로그아웃 후에도 실행됩니다. 코드 업데이트는 새 코드에서 `npm ci && npm run check && npm run build`를 실행한 뒤 서비스를 재시작합니다. 서버와 휴대폰의 Tailscale 연결을 유지하세요.

백업은 서비스 종료 후 `~/.local/share/koreai`와 **별도의** `~/.config/koreai/master.key`를 함께 보존합니다. 데이터 디렉터리·키 디렉터리는 700, 마스터 키 파일은 600이어야 합니다. 다른 사용자나 장치에서는 저장한 계정을 다시 연결하는 것을 기본으로 합니다. [운영 안내](OPERATIONS.md)

실제 GCP VM·휴대폰에서 확인할 항목은 [할 일 목록 MOB-04](../TODO.md)에 기록합니다.
