# Story 스텝퍼 토큰 사용량 표시 — 설계 (2026-07-17)

**상태**: 설계 승인됨, 구현 전
**범위**: Story 파이프라인이 LLM 을 쓸 때 이번 실행의 누적 토큰을 보여준다. 그뿐이다.

---

## 무엇을 만드나

Story 뷰에 **이번 실행 누적** 토큰을 `in 8.1k / out 4.2k` 로 표시한다.

## 무엇을 안 만드나 (명시적 비목표)

- **영속 없음** — 앱을 끄면 사라진다. 사용자 요구가 "도는 동안만"이었다.
- **비용($) 추정 없음** — 모델별 단가표를 들고 있어야 하고, 틀리면 없느니만 못하다.
- **스텝별 표시 없음** — 누적 합계 하나만. 스텝퍼 행은 건드리지 않는다.

---

## 사전 조사 결과 (전부 코드/바이너리로 확인함, 추측 아님)

### 세 엔진 모두 usage 를 준다 — 지금은 전부 버려지고 있다

| 엔진 | 어디에 오나 | 현재 |
|---|---|---|
| claude-sdk | SDK `result` 메시지의 `usage` | `extractClaudeSdkResult` 가 `message.result` 문자열만 꺼내고 버림 (claudeSdk.js:60) |
| gemini | 응답 JSON 의 `usageMetadata` | 응답 파싱 4곳이 `candidates[0].content.parts[0].text` 만 꺼내고 버림 (llmGemini.js:98·125·169) |
| codex | `thread/tokenUsage/updated` 알림 | `onNotification` 이 그 method 를 아예 안 받음 (codexAppServer.js:166~) |

codex 프로토콜 타입 (바이너리 `strings` 로 확인, codex-cli 0.144.1):

```
ThreadTokenUsage = {
  totalTokens, inputTokens, cachedInputTokens,
  outputTokens, reasoningOutputTokens
}
```

---

## ⚠️ 이 기능의 유일한 진짜 실패 모드

**조용히 틀린 합계.** 숫자가 안 보이는 건 사용자가 안다. 숫자가 **틀린 건 모른다** — 그러면 없느니만 못하다.
아래 두 함정이 정확히 그걸 만든다.

### 함정 1 — codex 는 누적, claude/gemini 는 호출당

`ThreadTokenUsage` 는 이름 그대로 **thread 누적치**다. 알림이 올 때마다 더하면 중복 합산으로 뻥튀기된다.

| 엔진 | 누산 방식 |
|---|---|
| codex | **교체** (latest wins, thread 단위) |
| claude / gemini | **가산** (호출당 delta) |

누산기는 엔진별로 다르게 동작해야 한다. 같은 `record()` 에 넣고 전부 더하면 틀린다.

### 함정 2 — thinking 분리 가능 여부가 엔진마다 다르다

| 엔진 | thinking |
|---|---|
| codex | `reasoningOutputTokens` 로 분리됨 |
| gemini | `thoughtsTokenCount` 로 분리됨 |
| claude | `output_tokens` 에 **포함 — 분리 불가** |

**결정: 셋 다 thinking 을 out 에 포함한다.** 분리 가능한 쪽(codex/gemini)을 굳이 빼지 않는다.
안 그러면 같은 "out" 이 엔진마다 다른 걸 세게 되고, 그게 바로 조용히 틀린 합계다.

### 함정 3 — progressLog 에 얹으면 안 된다

`progressLog` 는 메모리이고 `start()` 마다 지워진다. 전체 실행은 audio done 직후 prompts 를 시작하므로
숫자가 몇 초 만에 사라진다. (2026-07-17 화자 오디오 핸드오프 문서에 기록된 함정과 동일)

→ 누산기는 **`start()` 가 건드리지 않는 별도 인메모리 스토어**여야 한다.

---

## 설계

### 수집 지점 — 라우터가 아니라 provider

`storyLlmRouter.js` 는 완전한 통로가 **아니다**. 그 파일 주석이 직접 말한다:

> `factCheckClaims` 는 라우터에 넣지 않는다(M1 — Claude 강제, machine 에 factCheck deps 로 직접 주입)

라우터에서만 걷으면 팩트체크 토큰이 통째로 빠진다 → 함정 1과 같은 병(조용히 틀린 합계).
그래서 provider 레벨에서 찌른다. 반환 shape 을 안 바꾸므로 **호출부는 한 줄도 안 바뀐다.**

| 파일 | 넣을 곳 |
|---|---|
| `electron/api/llm/claudeSdk.js` | `extractClaudeSdkResult` — `message.usage` 를 가산 record |
| `electron/api/llm/llmGemini.js` | 응답 파싱 4곳 — `data.usageMetadata` 를 가산 record |
| `electron/api/llm/codexAppServer.js` | `onNotification` 에 `thread/tokenUsage/updated` 분기 — 교체 record |

### 새 모듈: `electron/api/llm/usageSink.js` (~40줄)

```js
recordDelta({ engine, input, output })        // claude, gemini — 가산
recordCumulative({ engine, key, input, output }) // codex — key(threadId) 단위 교체
snapshot()   // { input, output }
reset()      // 실행 시작 시
```

- 세션 스코프 인메모리. `start()` 가 안 건드린다.
- codex 는 `key` = threadId. 같은 key 재수신 시 **교체**, 서로 다른 key 는 합산.

### 표시

- main → renderer 로 snapshot 전달 (기존 progress IPC 채널 재사용 검토)
- Story 뷰에 `in 8.1k / out 4.2k` 누적 1줄

---

## 검증 (TDD — 테스트 먼저)

우선순위 순. 위 두 개가 이 기능의 존재 이유다.

1. **codex 누적 중복 합산 안 함** — 같은 threadId 로 `{total:100}` → `{total:250}` 이 연달아 오면
   합계는 **250 이지 350 이 아니다**. 이걸 못 잡으면 기능이 거짓말을 한다.
2. **엔진 혼합 합산** — codex(교체) + claude(가산) + gemini(가산) 이 한 실행에 섞여도 합계가 맞다.
3. `start()` 가 누산기를 지우지 않는다 (progressLog 함정 회귀).
4. 라우터를 우회하는 `factCheckClaims` 경로의 토큰도 잡힌다.
5. usageSink 단위 테스트 (가산/교체/reset/snapshot).

**뮤테이션 관점**: 함정 1의 테스트는 "교체"를 "가산"으로 바꿨을 때 반드시 죽어야 한다.
안 죽으면 테스트가 제품이 가는 길을 안 지나간 것이다.

---

## 열린 질문 (구현 시 확인)

- `thread/tokenUsage/updated` 가 turn 마다 오나, 더 잦나? (잦으면 렌더 스로틀 필요)
- gemini `thoughtsTokenCount` 가 `candidatesTokenCount` 에 포함인가 별도인가
  → 별도면 out = candidates + thoughts 로 더해야 함. 포함이면 그대로.
- claude SDK `result` 메시지의 usage 필드명 실측 (`input_tokens` / `output_tokens` / cache 계열)
