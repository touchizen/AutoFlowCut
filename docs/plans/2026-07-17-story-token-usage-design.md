# Story 토큰 사용량 표시 — 설계 v2 (2026-07-17)

**상태**: v1 승인 취소됨. Codex(gpt-5.6-sol) + Fable 5 병렬 리뷰에서 MAJOR 3건 → v2 반영본.
codex payload 미결은 `generate-ts --experimental` 실측으로 **종결됨** → **구현 착수 가능.**
**전제**: `@openai/codex` **0.144.5** (2026-07-17 에 0.142.5 에서 올림. llm 테스트 420/420 통과,
`codexAppServer.js` 가 쓰는 method 4종 전부 존속 확인).
**범위**: 이 프로젝트 세션의 누적 토큰을 도는 동안 보여준다. 그뿐이다.

---

## 무엇을 / 무엇을 안 만드나

만든다: Story 뷰에 **이 프로젝트 세션 누적** `in 8.1k / out 4.2k`.

안 만든다 (명시적 비목표): **영속 없음**(앱 끄면 사라짐) · **비용($) 추정 없음** · **스텝별 표시 없음**.

---

## ⚠️ 유일한 진짜 실패 모드 — 조용히 틀린 합계

숫자가 안 보이면 사용자가 안다. **틀린 건 모른다.** 그러면 없느니만 못하다.
아래 모든 결정은 이 하나를 막기 위한 것이다.

---

## v1 이 틀렸던 것 (리뷰로 밝혀짐 — 같은 실수 반복 금지)

| v1 주장 | 실제 | 잡은 쪽 |
|---|---|---|
| claude 는 `extractClaudeSdkResult` 만 찌르면 된다 | **거짓.** 파서가 둘이고 주 경로는 `readStructuredResult` | Codex + Fable 독립 발견 |
| claude 는 thinking 분리 **불가** | **거짓.** `usage.output_tokens_details.thinking_tokens` 존재 | Codex |
| node_modules codex 는 0.144.1 | **거짓.** 0.142.5 (PATH 의 별도 설치본이 0.144.1) | Codex |
| `ThreadTokenUsage = {5개 필드}` | **거짓.** 그 5개는 `TokenUsageBreakdown` | Codex + Fable |
| `progressLog` 는 stepMachine 에 있다 | **거짓.** 렌더러 `useStoryPipeline.js:44` | Codex + Fable |
| gemini 도 대상 | **프로덕션 미배선** — 라우터는 claude/codex 뿐 | Codex + Fable |

**교훈**: v1 은 `strings` 덤프와 파일 이름만 보고 썼다. 파서가 둘인 걸 못 봤고, 버전 라벨을
다른 바이너리에서 가져왔다. **앵커는 열어야 하고, 버전은 그 바이너리에서 찍어야 한다.**

---

## 확인된 사실 (전부 코드로 대조함)

### 수집 지점 — claude 는 **두 파서 모두** 찔러야 한다

```
llmClaude.js:247  structuredClaudeCall
  ├─ 주 경로   → claudeSdk.js:84  readStructuredResult   ← v1 이 놓친 곳
  └─ 폴백(:274) → claudeSdk.js:62  extractClaudeSdkResult ← v1 이 유일하게 지정한 곳
```

주 경로를 타는 메서드: `splitScenes`, `reviewScript`, `reviewSynopsis`, `reviewScenes`,
`reviseScenes`, `reviewPrompts`, `revisePrompts`, `writePrompts`, `analyzeResearch`,
**`factCheckClaims`** — 파이프라인 LLM 호출의 과반.

> **v1 의 자기모순**: provider 레벨로 내려간 유일한 명분이 "factCheckClaims 가 라우터를
> 우회하니까"였는데, 그 factCheckClaims 가 `structuredClaudeCall` 을 써서 v1 표대로면 **여전히
> 안 잡힌다.** v1 의 TDD 4번은 v1 표대로 구현하면 **통과 자체가 불가능**했다. (Fable)

**결정**: `m.type === 'result'` 메시지를 **소비하기 전에** 한 번 기록한다. extract 함수 안이 아니라.
- 실패 result 도 `usage` 를 갖는다(`SDKResultError.usage` 필수) — 실제 과금이므로 포함.
- 구조화 1차 실패 → 폴백 재시도는 **두 query 모두** 과금 → 둘 다 기록.

### 라우터 우회는 factCheck 하나뿐 (전수조사 완료)

Codex·Fable 이 각각 `stepMachine.js` 의 `llm.*` 호출을 전수 확인. **factCheck 외 우회 없음.**
주석 실재: `storyLlmRouter.js:21`. 주입: `story-api.js:55` → `stepMachine.js:2058`.

### 엔진별 필드 매핑 — 이게 안 맞으면 엔진마다 다른 걸 센다

| | claude (BetaUsage) | codex (TokenUsageBreakdown) |
|---|---|---|
| in | `input_tokens` + `cache_creation_input_tokens` + `cache_read_input_tokens` | `inputTokens` (cached **이미 포함** — 다시 더하지 말 것) |
| out | `output_tokens` (thinking 포함) | `outputTokens` (reasoning 포함) |
| thinking | `output_tokens_details.thinking_tokens` (**nullable**) | `reasoningOutputTokens` |

- claude 의 `input_tokens` 는 캐시를 **제외**한다(별도 필드). agent SDK 는 캐시 리드가 입력의
  대부분이라 그것만 세면 심하게 과소. **셋 다 더한다.**
- codex 의 `inputTokens` 는 cached 를 **포함**한다. `cachedInputTokens` 를 더하면 중복.

**결정 — in**: 두 엔진 모두 "캐시 포함 총 입력".
**결정 — out**: 두 엔진 모두 thinking **포함**(inclusive). 분리 가능하지만 **굳이 빼지 않는다** —
빼면 같은 "out" 이 엔진마다 다른 걸 세게 된다. (v1 은 이 결정이 맞았으나 근거("분리 불가")가 거짓이었다)

---

## ✅ 해결됨 — codex payload 는 실측으로 확정 (스파이크 불필요)

리뷰어 둘이 **정면충돌**했고(Codex: 중첩·blocking / Fable: 코스메틱), 나도 `strings` 로는 확정 못 했다.
**바이너리가 자기 Rust 타입에서 스키마를 생성해준다** — 런타임 캡처 없이 종결됐다:

```sh
node_modules/@openai/codex-darwin-arm64/vendor/aarch64-apple-darwin/bin/codex \
  app-server generate-ts --experimental -o <dir>     # → <dir>/v2/*.ts
```

```ts
// v2/ThreadTokenUsageUpdatedNotification.ts
type ThreadTokenUsageUpdatedNotification = { threadId: string, turnId: string, tokenUsage: ThreadTokenUsage }
// v2/ThreadTokenUsage.ts
type ThreadTokenUsage = { total: TokenUsageBreakdown, last: TokenUsageBreakdown, modelContextWindow: number|null }
// v2/TokenUsageBreakdown.ts
type TokenUsageBreakdown = { totalTokens, inputTokens, cachedInputTokens, outputTokens, reasoningOutputTokens }
```

**판정: Codex 가 맞았다. Fable 의 "코스메틱"은 틀렸다** — 중첩이므로 `params.tokenUsage.inputTokens` 는
`undefined` 다. blocking 이 맞다. v1 의 평면 5필드 주장도 거짓.

**결정**:
- `params.tokenUsage.total` 을 읽는다 (누적). `last` 는 delta 이므로 교체하면 축소된다.
- threadId 별 **교체**(latest wins). 알림에 `turnId` 도 있으므로 run 스코핑에 쓸 수 있다.
- codex 는 호출당 새 ephemeral thread(`codexAppServer.js:105`)이고 재시도 루프가 없다 →
  서로 다른 threadId 는 **합산**이 맞다. 같은 threadId 재수신만 교체.

> **교훈**: 리뷰어 합의도, 리뷰어 충돌도 실측을 대신하지 못한다. 여기선 `generate-ts --experimental`
> 한 줄이 두 리뷰어가 며칠 논쟁할 것을 끝냈다. **스키마를 뽑을 수 있으면 추론하지 마라.**

### gemini 는 범위에서 제외

gemini 는 프로덕션 라우터에 없다(`main.js:285` = {claude, codex}).
`story-api.js:50` 의 `llm = llmGemini` 기본값은 **테스트 DI 전용 죽은 코드**.
**결정: 이번 범위에서 제외.** 계측 가치 0. 되살릴 때 다시 판단.
(따라서 `thoughtsTokenCount ⊂ candidatesTokenCount` 열린 질문도 함께 보류)

---

## ✅ Task 5 블로커 — 해결됨 (generateTitle 에 abort 대칭 부여)

**해결**: `generateTitle` 에 `titleController` 를 줬다(`synopsisController` 패턴 미러). 이제
`abort()` 가 이 호출을 취소하고, 취소된 호출은 result 메시지를 안 뱉으므로 **뒤늦은 tap 자체가
사라진다** — 전역 sink 문제가 원천에서 없어진다.

이건 계측용 우회가 아니라 **리뷰가 이미 지적한 기존 버그의 정면 수정**이다("generateTitle 은
anyRunning() 검사도 abort 도 없이 실행"). 기존 테스트 2개가 세 번째 인자를 `{}` 로 핀해
**버그를 고정하고 있었고**, 새 계약(signal 을 싣는다)으로 갱신했다.

`anyRunning()` 에는 **넣지 않았다** — 상호배제는 "제목 생성 중엔 다른 걸 못 한다"는 UX 변경이라
누수 차단에 불필요하고 스코프 밖이다.

아래는 발견 당시의 기록(같은 실수 반복 방지).

### 원래 증상

프로젝트 A→B 전환 시 A 의 토큰이 B 의 합계에 들어갈 수 있었다. 조용히 틀린 합계 = 이 기능의
존재 이유를 정면으로 배신한다.

**확인된 사실** (전부 코드 대조):
- machine 은 **동시에 1개**다 — `story-api.js:51` 은 `let machine = null`, 단일 변수.
- 전환 시 `story-api.js:124` 가 `await machine.abort()` 를 **먼저** 한다. 대부분의 경로는 여기서 닫힌다.
- 그런데 `abort()`(`stepMachine.js:2263`)가 중단하는 건 `controller` / `synopsisController` /
  `researchController` 뿐이다.
- `generateTitle`(`stepMachine.js:1728`)은 `llm.generateTitle(scriptMd, opts, {})` — **세 번째 인자가
  비어 있다. signal 도 controller 도 없다.** 따라서 abort 가 못 멈추고, `await` 도 안 기다린다.

**경로**: A 에서 제목 생성 중 → B 로 전환(abort 는 generateTitle 을 못 잡음) → B 의 machine 이
`setClaudeUsageSink(B tracker)` → A 의 호출이 뒤늦게 끝나며 tap 발화 → **B 의 tracker 에 A 의 토큰**.

**왜 epoch 로 못 막나**: epoch 는 *같은* tracker 안의 세대 구분이다. 여기선 tracker 자체가 다른
인스턴스라 무의미하다. Task 2 의 "인스턴스끼리 격리된다" 테스트는 **거짓 안심을 준다** — tracker 는
격리되는데 정작 공유되는 건 sink 다.

**근본 원인**: **tap 이 호출의 주인을 모른다.** tap 은 SDK 메시지 스트림만 보고, 그 스트림에
projectToken 은 없다. 검토한 선택지 전부 깨끗하지 않다:
- sink 를 null 로 떼기 → B 의 `open()` 이 곧바로 다시 물리므로 경합이 남는다.
- 호출 단위 sink → `queryImpl` 을 매 호출 주입해야 하고, 11개 루프 문제로 되돌아간다.
- sink 에 projectToken 싣기 → tap 이 프로젝트를 알아야 하는데 알 방법이 없다.

**가장 유망한 방향(미검증)**: `generateTitle` 에 signal 을 준다. 그러면 `await machine.abort()` 가
진짜로 드레인되고 전역 sink 가 안전해진다. **부수 효과로 기존 버그도 고쳐진다** — 리뷰가 지적한
"generateTitle 은 `anyRunning()` 검사도 abort 도 없다"가 바로 이것이다. 다만 이건 계측이 아니라
**제품 동작 변경**이라 별도 결정이 필요하다.

**현재 상태는 안전하다**: 수집 계층(Task 1–4)은 완성·커밋됐지만 **아직 아무 데도 안 물려 있다.**
숫자를 안 보여주므로 틀린 숫자를 보여줄 수도 없다. 이 블로커를 풀기 전에 Task 5 를 넣으면 안 된다.

---

## 설계

### run 경계 — v1 이 통째로 빠뜨린 것

v1 은 `reset() // 실행 시작 시` 라고만 썼다. 이 코드베이스에 "실행 시작"이라는 단일 이벤트는 **없다**:
자동 진행은 `scenes → prompts` 를 각각 별도 `start()` 로 호출한다(`StoryView.jsx:362`; audio 는 기본 off).
게다가 `generateTitle`(:1730), 시놉시스(:1845), research(:2034), factCheck(:2058) 은 `start()` 밖이고
`generateTitle` 은 `anyRunning()` 검사도 abort signal 도 없다.

모듈 전역 싱글톤이면 전부 깨진다:
- 프로젝트 전환 시 machine 은 재생성되나(`story-api.js:125`) sink 는 살아남음 → **A 의 토큰이 B 에 뜬다**
- `start()` 마다 reset → 연쇄 중 앞 합계 소멸 (v1 이 스스로 금지한 함정)
- reset 안 함 → 세션 누적인데 라벨은 "이번 실행" = **조용히 틀린 합계**

**결정** (구현하며 v2 설계에서 한 번 더 바뀐 것 — 아래 "구현 결과" 반영):
- tracker 를 **`createStepMachine` 안의 인스턴스**로 둔다 (모듈 싱글톤 금지). 프로젝트 전환 시 함께 죽는다.
- ~~`runEpoch` 를 둔다~~ → **epoch 제거됨.** run 경계가 없어(아래) 세대 구분이 무의미했고,
  늦은 콜백은 epoch 가 아니라 **provider tap 의 호출-시작 sink 캡처**로 막는다(2R Codex/Fable).
- 표시 라벨은 **"이 프로젝트를 연 뒤 누적"**이다. "이번 실행"이 아니다 — reset 지점이 프로젝트 전환뿐이라
  같은 프로젝트에서 대본을 여러 번 재생성하면 그 합이 뜬다. "이번 실행"이라 쓰면 그 자체가 조용한 거짓말.
- renderer 이벤트에 `projectToken` 을 싣고, 4개 story 채널 전부에서 usage 를 읽는다
  (`story:state`/`research-state`/`synopsis-delta`/`delta` — 1R MINOR-5).

### 배선

provider 반환 shape 불변 → **호출부 무변경**. 각 provider ctx 에 선택적 `onUsage` 콜백 주입.

| 파일 | 넣을 곳 |
|---|---|
| `claudeSdk.js` | result 메시지 소비 지점 (`:62` extract + `:84` readStructured **둘 다**) |
| `codexAppServer.js` | `onNotification` 에 `thread/tokenUsage/updated` 분기 (현재 method 3개만 처리: `:163~184`) |

### 표시

- Story 뷰에 `in 8.1k / out 4.2k` 누적 1줄.
- **주의**: sink 를 main 에 둬도 **렌더러 상태가 `start()` 마다 비워지면 똑같이 죽는다**
  (`useStoryPipeline.js:378` 의 `setProgressLog([])` 패턴). usage 상태는 그 패턴을 따르면 안 된다.

---

## 검증 (TDD — 테스트 먼저)

1. **codex 누적 중복 합산 안 함** — 같은 threadId 로 두 번 오면 합계는 **교체값**. 스파이크로 확정한
   실제 payload 모양의 fixture 를 쓴다. 축약 객체(`{total:100}`)로 sink 만 시험하면 제품 경로를 안 지난다.
2. **claude 구조화 경로 토큰이 잡힌다** — `structuredClaudeCall` 주 경로(`readStructuredResult`)로
   성공하는 호출의 usage 가 합계에 든다. **v1 이라면 이 테스트가 실패한다** — 그게 이 테스트의 존재 이유.
3. **엔진 혼합 합산** — codex(교체) + claude(가산) 이 한 실행에 섞여도 맞다.
4. **start 연쇄 후 합계 단조 증가** — scenes→prompts 연쇄에서 앞 합계가 안 지워진다.
   (v1 의 "start() 가 누산기를 안 지운다"는 start() 가 참조조차 안 하는 모듈에 대한 **준-항진명제**였다 — Fable)
5. **늦은 콜백 격리** — 프로젝트 전환 후 도착하는 이전 프로젝트의 보고가 새 합계를 오염시키지 않는다
   (provider tap 의 호출-시작 sink 캡처로. epoch 아님 — epoch 는 제거됨).
6. **프로젝트 전환 격리** — A 의 토큰이 B 에 안 뜬다.
7. claude 실패 result 의 usage 도 포함된다.

**뮤테이션**: 1번은 교체→가산으로 바꿨을 때, 2번은 수집 지점을 v1 표로 되돌렸을 때 반드시 죽어야 한다.

---

## 리뷰 기록

Codex(gpt-5.6-sol, xhigh) + Fable 5 병렬 1라운드 → MAJOR 3 + MEDIUM 5.
두 리뷰어가 서로를 보완했다: 둘 다 `readStructuredResult` 를 독립 발견했고, Fable 이 TDD 자체모순과
항진명제를, Codex 가 cache 필드 누락과 버전 오류를 잡았다.

**둘 다 틀린 것도 있었다**:
- Fable 의 "0.144.1 실 바이너리로 재확인"은 **거짓** — vendored 는 0.142.5 였다(v1 의 거짓 주장을 받아쓴 것으로 보인다).
- Fable 은 payload 중첩을 "코스메틱"이라 했으나 **blocking 이었다**.
- Codex 의 중첩 주장은 맞았으나 근거가 **upstream 다른 버전** 소스였다 — 결론이 맞은 건 운이 섞였다.

**리뷰어 합의도, 충돌도 실측을 대신하지 못한다.** 종결한 건 `generate-ts --experimental` 한 줄이었다.
