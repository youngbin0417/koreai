# 커넥터 개발

## 기본 제공 행동

| 커넥터 | 행동 ID | 범위 |
|---|---|---|
| 네이버 검색 | `naver.search.news`, `.blog`, `.cafearticle`, `.shop`, `.local` | 공개 검색 결과의 제목·요약·링크 |
| 네이버 카페 | `naver.cafe.join`, `.publish` | 가입 요청, 텍스트·HTML 글 작성 |
| 네이버 캘린더 | `naver.calendar.create` | 기본 캘린더의 단일 일정 추가 |
| 밴드 | `band.bands`, `.posts`, `.post`, `.publish` | 모임·게시글 조회와 글 작성 |
| 카카오톡 | `kakao.message.self` | 나와의 채팅 텍스트 템플릿 |
| 카카오맵 | `kakao.map.places`, `.address` | 장소·주소 조회 |
| 다음 검색 | `daum.search.web`, `.blog`, `.cafe` | 공개 검색 결과 |
| 공공혜택 | `gov.benefits.list`, `.detail` | 목록·상세 정보 조회 |
| 기상청 | `kma.observation` | 발표일·정시·격자의 초단기실황, 단위·결측·페이지·출처 |
| 에어코리아 | `airkorea.forecast` | 발표 날짜·PM10/PM25/O3별 예보 통보, 대상 날짜·등급 원문·출처 |

공식 문서 확인일은 **2026-09-29**입니다. 모든 기본 행동의 최초 검증 상태는 `documented`입니다. 실제 키·심사·계정 호출이 성공하기 전에는 실사용 지원으로 표시하지 않습니다.

기상청 추가 행동의 문서 확인일은 **2026-10-12**입니다. [공공데이터포털 상세](https://www.data.go.kr/data/15084084/openapi.do)의 HTTPS 요청 주소·`ServiceKey` 필드와 2026년 9월 활용가이드의 단위·결측 기준을 확인했습니다. 실행기는 `src/connectors/kma.ts`, 계정 종류는 `kma-api`, 필요한 값은 일반 인증키(Decoding) `serviceKey`입니다. `URLSearchParams`로 인증키를 한 번 인코딩하며 요청 주소·키를 결과나 오류에 복사하지 않습니다. 정상 응답의 기준일·정시·격자·페이지를 대조하고, 900 이상 또는 -900 이하 관측값은 원본을 보존하면서 `value: null`, `status: missing`으로 반환합니다. 모의 검증 통과와 실제 계정 검증을 따로 관리합니다.

네이버 카페 텍스트는 문서가 요구하는 UTF-8 URL 인코딩 후 MS949 URL 인코딩을 적용합니다. 이미지 첨부·상품 게시판은 제공하지 않습니다. 캘린더는 UTC iCalendar 시간과 요청 작업 ID 기반 UID를 사용하고, 반환된 UID를 대조합니다. 밴드 페이징 결과의 접근 토큰은 제거합니다. 다음 페이지에는 반환받은 `after` 값만 입력하세요.

에어코리아 추가 행동의 문서 확인일은 **2026-10-14**입니다. 실행기는 [airkorea.ts](../src/connectors/airkorea.ts), 계정 종류는 `airkorea-api`, 필수 키는 `serviceKey`입니다. 고정 HTTPS 주소·`searchDate`·`InformCode`를 사용하며 날짜 조회에 적용되지 않는 페이지 입력은 받지 않습니다. 발표 날짜·항목을 대조하고 예보 대상 날짜·지역 등급·설명 원문과 출처·공공누리 제3유형 조건을 보존합니다. [사용·결과 규격](AIRKOREA.md)

## 새 공식 API 커넥터 추가

초안 생성 도구:

```bash
npm run connector:new -- --id hira-hospitals --service-id hira --name "병원 찾기"
npm run connector:new -- --id hira-hospitals --service-id hira --name "병원 찾기" --dry-run
```

`src/connectors/custom/hira-hospitals.ts`에 Zod 입력, 행동 메타데이터, 실행 함수의 초안이 생성됩니다. 경로 입력과 기존 파일 덮어쓰기는 거절합니다. 생성된 행동은 `implemented: false`, `verification: unresearched`이므로 실행할 수 없습니다.

검토한 확장은 `src/connectors/extensions.ts`에서 명시적으로 가져와 `reviewedExtensions`에 넣습니다. 등록 시 기존 행동과 중복된 ID를 거절합니다. 로컬 확장 코드는 엔진의 OS 권한으로 실행되므로 출처와 코드를 검토한 후 등록하세요. 키·승인·실행 결과는 공통 엔진의 규칙을 따릅니다.

1. 카탈로그에서 서비스·행동을 선택하고 공식 근거, 계정 주체, 필요한 키·권한, 허용 도메인을 확인합니다. 판매자 API와 소비자 계정 API를 구분합니다.
2. `Action`과 Zod 입력 스키마를 작성합니다. 입력은 가능한 한 명시적인 필드로 제한하고 JSON Schema를 생성합니다.
3. `Executor`에서 고정된 공급자 URL로만 요청합니다. 키는 `context.secrets`로 받고 에이전트 인자로 요구하지 않습니다. 리다이렉트를 자동 추적하지 않습니다.
4. 외부 요청 직전에 `context.dispatch()`를 호출합니다. 요청 취소용 `context.signal`과 제한된 타임아웃을 적용합니다.
5. 성공을 확정하는 공급자 응답 필드를 검사하고 `{data, evidence}`를 반환합니다. 전송 후 불확실한 쓰기는 `ActionError(..., 'needs_review')`로 처리합니다.
6. 모의 요청·응답, 인증 만료, 입력 오류, 반환값의 비밀정보 제거, 쓰기 응답 유실을 테스트합니다.
7. 테스트 계정으로 실제 동작을 확인한 후 버전·범위를 기록하고 배포 지원을 지정합니다. 기능 변경 시 커넥터 버전을 올립니다.

```ts
const execute: Executor = async (action, context) => {
  // 검증된 고정 URL과 context.secrets로 요청을 준비합니다.
  context.dispatch();
  // 호출 → 정상 결과 확인 → 반환. 쓰기는 무조건 재시도하지 않습니다.
  return { data: verifiedResult, evidence: '공급자 리소스 ID 확인' };
};
engine.register([action], execute);
```

## 브라우저 레시피 추가

처음부터 전체 사이트를 조작하는 범용 자바스크립트 도구로 노출하지 않습니다. 사용자에게 보일 행동·입력·대상·최종 결과를 먼저 정합니다.

- 허용 출처와 리소스 요청 범위, 전용 프로필, 필요한 수동 로그인 단계를 선언합니다.
- 제공자의 이용조건과 자동화 허용 범위를 기록합니다. 허용이 확인되지 않으면 활성화하지 않습니다.
- 식별 가능한 화면·입력 필드·제출 버튼·결과 영수증을 사용합니다. 선택자가 없거나 여러 개면 중단합니다.
- 결제·전송·예약 등 확정 단계에 앞서 승인한 입력과 화면값이 일치하는지 확인합니다.
- CAPTCHA, 본인확인, 접근 거절을 만나면 사용자에게 넘깁니다. API 거절을 브라우저로 자동 우회하지 않습니다.
- 화면 변경·브라우저 종료·인증 만료·응답 유실을 시험합니다.

현재 `browser.demo.read`와 `browser.demo.publish`가 운영자 소유 페이지를 사용하는 참조 구현입니다. 이 두 행동은 20개 공식 API 행동과 별도이며 실제 서비스 지원 실적에 포함되지 않습니다.

Linux headless 시험에서는 관리 화면의 **시험 사용자로 로그인**을 누릅니다. 관리자 전용 `/api/browser/demo-login`이 고정된 로컬 시험 사이트에서만 로그인 버튼을 누르며, 에이전트는 이 API를 사용할 수 없습니다. 실제 서비스 로그인이나 인증을 자동 완료하는 기능은 아닙니다.

## 조사 카탈로그

71개 서비스 목록은 `src/catalog.ts`에서 유지합니다. 신규 앱·API 후보 데이터는 `src/research/app-api-backlog.ts`에 있으며 기존 서비스 ID를 재사용해 중복 없이 카탈로그에 추가합니다. 후보 행동은 실행 가능한 `Action`과 별개입니다. `/api/services`는 미조사 행동의 `sourceUrl`, `checkedAt`, `method`를 `null`로 내보냅니다. 조사하지 않은 기능에 근거나 허용 상태를 추정해 넣지 않습니다.

공개 정보 조회 초안 6개는 `src/connectors/drafts/index.ts`에 등록했습니다. 입력·근거·키 종류·결과 확인 규칙을 선언하지만 `implemented: false`이며 실행기는 `NOT_IMPLEMENTED`를 반환합니다. 엔진의 기존 실행 제한도 적용하므로 계정·클라이언트 권한만으로 활성화되지 않습니다. 사용자 확장 등록 전에 기본 초안을 등록해 ID 중복을 검사합니다. [후보 목록과 미리보기](APP_API_BACKLOG.md)를 참고하세요.

생활 서비스 기본 커넥터는 `src/connectors/lifestyle/`에서 서비스별 정의와 공통 준비 저장·진입 안내 실행기를 관리합니다. 현재 5개 서비스의 행동은 모두 `handoff`이며 외부 API 호출 증거로 집계하지 않습니다. 후속 API·브라우저 행동은 새로운 행동 ID로 등록하고 계정 권한·승인·결과 확인을 선언합니다. [확장 단계와 규칙](LIFESTYLE_CONNECTIONS.md)을 참고하세요.

검증·출시 전에 API 공지, 접근 주체, 최근 변경일을 다시 확인하세요. 지원 중단은 관리 화면에서 행동별로 적용할 수 있습니다. 새 서비스 추가가 공통 권한·승인 엔진 수정을 요구한다면 먼저 인터페이스 범위를 검토합니다.
