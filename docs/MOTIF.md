# Motif(Morfac) 연결

Motif는 **Motif 3**를 OpenAI 호환 Chat Completions로 제공하는 AI 공급자입니다. KoreAI는 **새 대화에서 공급자를 직접 고를 때만** Motif를 사용합니다. 기본 공급자는 계속 DeepSeek입니다.

## 연결 정보

| 항목 | 값 |
| --- | --- |
| Base URL | `https://api-cbt.morphfactory.io/v1` |
| 모델 | `motif/motif-3` (고정, 다른 모델로 자동 전환하지 않음) |
| 인증 | `Authorization: Bearer <MORPH_API_KEY>` |
| 문서 | [Chat Completions](https://cbt.morphfactory.io/docs/en/chat-completions) |

## 키 관리

`MORPH_API_KEY`는 **`.env`로만** 관리합니다. 화면에서 암호화해 저장하는 경로가 없으므로 키 등록·변경은 `.env`를 수정하고 서버를 다시 시작합니다. 값은 상태 API·대화 기록·로그·오류 메시지에 남기지 않으며, 응답에 키가 섞여 오면 `[REDACTED]`로 바꿉니다.

## 선택과 고정

- **AI 대화 → 새 대화 → AI 공급자**에서 Motif를 고릅니다. 대화를 만드는 시점에 공급자가 **고정**되며, 이후 기록은 같은 공급자로만 전송합니다.
- 공급자를 바꾸려면 새 대화를 시작합니다. 기존 대화의 기록을 다른 모델로 재전송하지 않습니다.
- 공급자 정보가 없는 이전 대화는 **DeepSeek**로 유지됩니다.
- Motif 키가 없으면 Motif 대화를 만들 수 없고 DeepSeek로 대신 실행하지 않습니다. 화면에서도 해당 선택지가 비활성화됩니다.

## 요청과 응답

- 요청: `model`, `messages`, 필요할 때만 `tools`·`tool_choice: "auto"`, `max_tokens`, `stream: false`.
- DeepSeek 전용 `thinking`·`reasoning_effort`는 보내지 않습니다. 대화 재생 시 남아 있는 `reasoning_content`도 제거합니다.
- 응답: `choices[0].message.content`와 `tool_calls`(있을 때). `finish_reason: "length"`와 형식 오류는 실패로 처리하고 부분 응답을 사용하지 않습니다.
- 도구 호출 흐름(작업 생성 → 상태 조회 → 승인 대기)은 DeepSeek와 동일하게 동작합니다. 공급자 문서가 호환 범위를 제한적으로 설명하므로, 쓰기는 계속 **사용자 승인**을 거칩니다.

## 검증 (2026-10-26, 실제 키)

- `POST /v1/chat/completions` (텍스트): HTTP 200, `MORPH_OK` 응답.
- `tools` + `tool_choice: "auto"`: HTTP 200, `finish_reason: "tool_calls"`, OpenAI 형식 `tool_calls` 반환.
- `GET /v1/models`: `motif/motif-3`가 `callable: true`로 표시.

이 확인은 연결·도구 호출 형식의 검증이며, Motif 응답 품질·도구 호출 신뢰도·한도는 공급자 정책에 따릅니다. 모의 시험(`tests/motif.test.ts`)은 요청 본문·오류 매핑·공급자 고정을 검사합니다.
