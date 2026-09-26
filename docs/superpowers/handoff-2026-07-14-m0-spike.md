# 핸드오프 — M0 스파이크 (2026-07-14)

**브랜치**: `feature/inapp-agent` (HEAD `beffd06`)
**전체 스위트**: **560 files / 6097 tests 그린**. `origin/main`(3.0.1) 병합 완료. 워킹트리 clean.

**정본 스펙**: `docs/superpowers/specs/2026-07-11-inapp-agent-orchestration-spec-v11.md` — **이게 계약이다.**
**M0 결과 정본**: `docs/superpowers/specs/2026-07-11-m0-sdk-spike-RESULT.md` (raw: 같은 폴더 `m0-*-raw.jsonl`)

> ⚠️ `docs/superpowers/` 는 `.gitignore` 대상이다. 스펙·결과·핸드오프는 **git에 안 잡힌다. 디스크에만 있다. 지우지 마라.**

---

## 0. 한 줄

**M1a(D24a storyboard-first)는 완전 종료. M0 스파이크 진행 중이고, 설계를 좌우하는 측정은 전부 GREEN이다. 남은 하나는 M0-9의 allow 경로 — 그게 M2의 Codex option ship 여부를 가른다.**

### 새 세션 첫 수

```
1. 이 문서 + M0 RESULT 문서 읽기
2. git checkout feature/inapp-agent   (HEAD beffd06)
3. npm run test:run  → 560 files / 6097 tests 그린 확인
4. §3 "M0-9 를 닫는 법" 으로 바로 간다
```

---

## 1. 작업 방식 — 이걸 지켜야 한다

| 성격 | 담당 |
|---|---|
| **어려운 것** (설계, 코드 고고학, 트랜잭션/동시성/identity) | **Codex `gpt-5.6-sol`** — `mcp__codex__codex`, `sandbox: workspace-write`, `config: {model_reasoning_effort: "xhigh"}` |
| **기계적인 것** (배선, 테스트, UI) | **Claude** |
| **리뷰** | **누가 쓰든 다른 쪽이 뜯는다. findings 0까지 loop.** |

- ⚠️ **Codex 세션은 30분 idle timeout.** 스코프를 잘게 쪼개라. 한 번 timeout 났지만 작업물은 디스크에 남아 있었다.
- ⚠️ **Codex/Fable 사용량 한도가 있다.** 소진되면 리셋까지 대기하거나 Claude subagent로 대체.
- **Codex는 이전 맥락을 못 본다.** 매 호출에 완전한 맥락(왜/앵커/금지사항/직전 findings 전문)을 다 실어야 한다.

### 리뷰에서 **실제로 작동한** 것 — 이 순서로 해라

1. **뮤테이션 테스트.** 매 스텝 Codex 스위트에서 살아남는 뮤턴트가 나왔다(2,3a,3b,4a,4b,4c,5 전부). **세 번은 Codex가 "죽었다"고 보고했는데 실제로는 안 죽었다.** → **직접 돌려라. 보고를 믿지 마라.**
2. **실앱 눈검증.** 뮤테이션도 못 잡는 게 있다 — 아래 §4 참고.
3. **교차 리뷰(Codex↔Claude).** 리뷰할 때마다 BLOCKER가 나왔다. 마지막 리뷰(step 6/7)에서도 2개.

### 🔴 뮤테이션이 **원리적으로 못 잡는 것** — 이번에 5번 걸렸다

**테스트가 버그를 계약으로 못박아 놓은 경우.** 뮤테이션은 *"테스트가 죽는가"*를 묻지 *"테스트가 옳은가"*를 안 묻는다.

| 실제 사례 | 테스트가 못박고 있던 것 |
|---|---|
| CSV 없이 미구현 D24b로 fail-open | `"image-only가 합법 variant"` |
| 이미지 세트 교체 불가 (복구 패널도 죽은 버튼) | `"옛 revision이면 전이 불허"` |
| 사용자에게 raw 에러코드 노출 | `toHaveTextContent('fixed-scenes-invalid')` |
| 사용자에게 raw 에러코드 노출 | `toHaveTextContent('fixed-scenes-stale')` |
| 복구 패널이 신규 프로젝트에선 안 뜸 | `ensureStoryOpen`/`recoverStory`를 **다른 mock으로 갈라놔** 같은 함수 2회 호출을 은폐 |

**→ 테스트를 읽을 때 "이게 우리가 원하는 계약인가, 아니면 코드가 하는 짓을 받아적은 건가"를 매번 물어라.**

### 뮤테이션 하네스 함정 (내가 전부 밟았다 — 반복하지 마라)

1. **베이스라인이 그린인지 먼저 확인.** 앞 뮤턴트가 파일에 남은 채 백업을 뜨면 이후 전부 무의미. **`baseline이 failed면 abort` 가드를 넣어라.**
2. `perl -0pi -e 's/…/…/'` 는 **첫 매치만** 바꾼다 → 엉뚱한 줄 건드리고 "생존" 오판. **줄 번호로 타겟팅** (`awk 'NR==L{print "..."; next}{print}'`).
3. `npx vitest run a.js b.js` 멀티 경로가 조용히 빈 출력 → 전부 "생존" 오판. **한 파일씩.** 출력이 비면 SURVIVED가 아니라 **ERROR**로 처리.
4. 적용 여부를 `git diff` 로 판정 금지 (파일이 이미 dirty면 항상 "적용됨"). **백업과 `diff -q`.**
5. **`git checkout -- <file>` 로 복원 금지 — 커밋 안 된 작업을 날린다** (실제로 Codex 작업을 날릴 뻔했다). **`cp <backup>` 만.**
6. **동치 뮤턴트**를 finding으로 착각 금지. `true && expr`, `x || fallback` 이 rescue하는 건 동작이 안 변한다. 생존하면 **뮤턴트가 잘못됐는지 먼저 의심.**

---

## 2. M0 현황 — **설계는 살았다**

**M0는 제품 코드 0줄이다. 전부 측정이다.** 스파이크는 `npm run test:spike` (SPIKE=1)로만 돈다.

### 측정 기준 (버전을 안 적으면 측정이 아니다)

| | 버전 |
|---|---|
| Claude CLI | **2.1.177** |
| `@anthropic-ai/claude-agent-sdk` | **0.3.207** (`--save-exact`, 커밋 `67ea194`) |
| Codex CLI | **0.144.1** — ⚠️ app-server는 스스로를 **0.142.5**로 보고 |
| 인증 | Claude/Codex 둘 다 **구독 로그인** (ambient API 키 없음) |

### 판정

| | 결과 |
|---|---|
| **M0-2** | ✅ **PASS** — **12분 블로킹 MCP 툴이 종단 `tool_result`로 살아 돌아왔다.** `MCP_TOOL_TIMEOUT`이 `type:'sdk'` 서버에 hard call bound로 적용됨. **→ 폴링 붕괴 없음. 턴 예산 33~45 유지. M2를 지금 설계대로 진행 가능.** |
| **M0-5** | ✅ **PASS** (하드 게이트) — **10분 승인 보류 생존.** hold 중 tool body 0회, allow 뒤 1회, 후속 user turn 수용 |
| **M0-1** | ✅ PASS — overrides-only env → `Not logged in` 재현. allowlist 핀 필수 확인. **D23-1 재현 안 됨 → 접었다** |
| **M0-12** | ✅ 측정완료 — app-server `initialize` 필수, 모델 **4개**, **gpt-5.6 없음** |
| **M0-11** | ✅ 부분 판정 — MCP 연결 경로 = **temp `CODEX_HOME` + 생성 `config.toml`** (inline `mcpServers`는 무시됨) |
| **M0-8/9** | ⚠️ **부분** — §3 참고 |

### 🔴 스파이크가 잡은 제품 직결 발견 — **M2 설계에 반드시 반영**

1. **`allowedTools`에 넣으면 `canUseTool`이 안 열린다** (*"auto-allowed without prompting"*). **D9의 게이트할 툴을 거기 넣으면 게이트가 통째로 죽는다.**
2. **in-process MCP 툴은 기본이 deferred.** `tool()` extras에 **`alwaysLoad:true`** 없으면 모델이 `tool_reference`만 받고 **body가 실행조차 안 된다**(2회 실증). → **툴 검색 턴 추가 = D2 턴 예산의 입력값.**
3. **`McpSdkServerConfig`엔 per-server `timeout`이 없다** (stdio/HTTP엔 있다). in-process 서버의 유일한 bound가 **프로세스 전역 `MCP_TOOL_TIMEOUT`** → 12분 툴과 5초 툴이 상한을 공유. **툴 내부 자체 타임아웃 필요.**
4. **Codex `thread/start`의 inline `mcpServers`는 무시된다** → temp `CODEX_HOME` + `config.toml`. 그래야 **프로필 격리**도 된다.
5. **바이너리 실측(0.144.1): D9가 옳았다.** `item/mcpToolCall/progress`는 있는데 **MCP tool call 승인 요청 메서드 자체가 없다.** **elicitation이 유일한 게이트 경로다.**

---

## 3. 🎯 다음 작업 — **M0-9를 닫아라**

스파이크: `tests/spike/m0-8-9.codexMcpElicitation.spike.test.js`
raw: `docs/superpowers/specs/m0-8-9-raw.jsonl`

### 이미 확정된 것

- **`mcpServer/elicitation/request`가 실제로 발화한다.** MCP 툴 handler의 `elicitInput()`이 Codex 승인을 띄운다. `turnId`도 채워져 온다(스펙이 우려한 `null` 아님).
- **deny 경로 PASS** — 5초 hold 뒤 거절 → **tool body 0회** (marker 파일로 관측).

### ❌ 막힌 지점

`{action:'accept', content:{approve:true}}` 로 응답했는데 fixture가 **`decline`을 받는다.**
관측: `mcpToolCall status: failed`, agentMessage `blocked:decline`, tool body **0회**.

**elicitation 요청 params 원문:**
```json
{"threadId":"...","turnId":"...","serverName":"echo","mode":"form",
 "_meta":{"codex_approval_kind":"mcp_tool_call","persist":["session","always"],
          "tool_title":"Echo (gated)","tool_description":"...","tool_params":{...}}}
```

**바이너리 타입 힌트:**
> `McpServerElicitationRequestResponse` — *"Structured user input for accepted elicitations, mirroring RMCP `CreateElicitationResult`. This is nullable because decline/cancel responses have no content. **Optional client metadata for form-mode action handling.**"*
> `McpServerElicitationAction` = `accept` | `decline` | `cancel`
> TUI 문자열에 **`accept_session`**, **`accept_always`** 가 보인다.

**→ `mode:'form'` 응답에 client metadata(persist 선택)가 더 필요한 것으로 보인다.**

### 순서

1. **form-mode 응답 payload를 확정한다.** `_meta.persist: ["session","always"]` 에 대응하는 필드를 찾아라. 후보: 응답에 `persist:'session'` 또는 action을 `accept_session` 계열로. **바이너리 `strings`로 스키마를 더 파거나, `codex` TUI를 한 번 돌려 실제 응답을 관찰하는 것도 방법이다.**
2. 맞으면 **allow → tool body 1회 + result** 확인.
3. 그 뒤 **deny/allow 각각 10분 hold**. 스파이크에 이미 작성돼 있다:
   ```
   npm run test:spike -- tests/spike/m0-8-9.codexMcpElicitation.spike.test.js -t "hold 10분"
   ```
4. **`codex_apps`가 temp CODEX_HOME에서도 로드되는 이유**를 확인해 완전 격리를 만든다.

### 판정 기준 (스펙 M0-9, 단일 criterion)

> deny/allow 두 run 모두 **MCP tool call을 elicitation에서 10분 hold해도 어떤 Codex call/turn/session timeout에도 죽지 않고**, deny → tool body 0회/blocked, allow → tool body 1회/result여야 PASS. **exec approval로 대체한 test는 무효다.**

**FAIL이면**: D9의 **two-step one-shot-token gate**를 두 engine 공통 경로로 채택하고 결과 문서/Tool surface를 개정한다. **그리고 M2에서 Codex option을 ship하지 않는다.**

### 그 다음 M0 (M0-9 뒤)

| 항목 | 비고 |
|---|---|
| **M0-10** | Codex 지속 thread 60분 + `turn/steer`. **app-server handshake·MCP 연결 경로는 이미 확보됨** → 바로 가능 |
| M0-3 | turn/tool batch 계수기 |
| M0-4 | 이미지 output maxN (D24b의 선결) |
| M0-6/7 | 중첩 Claude / 패키징 Claude |
| M0-13 | 패키징 Codex adapter (PATH에서 node 제거) |
| M0-14 | 오케×story 4조합 |
| M0-15 | **사람만 가능** (D24b blind gate). D24b는 지금 막아뒀으므로 **불급** |
| M0-16 | **API 키 필요.** 없으면 BYOK 경로 미확정 → **D23의 BYOK 노출 결정 보류** |

---

## 4. M1a (D24a) — **완전 종료** ✅

구현 → 교차 리뷰 → **실앱 눈검증**까지 끝. 커밋 15개 (`60c0fac`~`b2d40eb`, 리뷰 수정 포함).

### 실앱 검증 결과 — 스펙 숫자와 정확히 일치

```
scene1  start=0      end=20      planned 20s 유지
scene2  start=20     end=27.85   정확히 20.000s 시작 → 300ms tail drift 0
                                 duration = max(planned 3s, TTS 7.55s + 300ms) → 나레이션 안 잘림
scene3  start=27.85  end=31.85   visual-only, planned 4s 그대로
manifest.pushRevision=1, steps 전부 done, CapCut 열어서 눈으로 확인 OK
```
JPEG→PNG 정규화도 실증 (jpg 유래 파일이 디스크에 진짜 PNG 1280×720 RGBA). **jsdom엔 canvas가 없어 그 경로는 한 번도 실행된 적이 없었다.**

### 🔴 실앱 검증이 잡은 버그 5개 — **전부 6000+ 테스트가 그린인 채로 통과했다**

| 버그 | 왜 테스트가 못 잡았나 |
|---|---|
| CSV 선택 버튼이 잘려서 안 보임 (`min-width:720px` > 모달 510px) | **jsdom엔 레이아웃이 없다** |
| CSV 없이 미구현 D24b로 fail-open | 테스트가 **"image-only는 합법"이라 못박음** |
| **이미지 세트 교체 불가 (BLOCKER)** — 복구 패널도 죽은 버튼 | 테스트가 **"옛 revision이면 전이 불허"를 계약으로 못박음** |
| narrator-only일 때 roster 화면이 텅 빔 | 빈 상태는 단위 테스트가 안 본다 |
| i18n 직역/반말/오라벨 | `t()`를 mock하니 문자열이 검증 안 됨 |

**교훈: "테스트가 못 보는 층"이 곧 실앱 검증의 대상이다** — 레이아웃, 실제 인코더, 빈 상태, 문자열, 그리고 **버그를 계약으로 못박은 테스트**.

### 마지막 Codex 교차 리뷰(step 6/7)가 잡은 BLOCKER 2개 (`2426077`)

1. **`ensureStoryOpen()` 대기 중 프로젝트 전환** → A의 import가 B 화면에 적용. `useStoryPipeline.open()`이 stale을 감지하고도 성공 payload를 반환하고 있었다.
2. **복구 패널이 일반 프로젝트에선 안 뜬다** — `fixedSceneError`가 `prompts=done && pending>lastPushed`일 때만 기록돼서 **신규 story는 영영 그 조건을 못 만족.** step 4d에서 만든 복구가 흔한 경우엔 죽어 있었다.

### 남은 것 (선택)

- 크래시 복구 패널 + CSV 오류 행 alert **실앱 눈검증** (자동 테스트는 통과)
- **image-first엔 `videoPrompt`가 없다** — CSV 13필드 스키마에 컬럼이 없고 D24a는 LLM 0회. Veo 영상 쓰려면 (a) CSV 컬럼 추가 또는 (b) videoPrompt만 LLM 생성. **제품 결정 필요.**
- **duration 오타가 무음으로 조용히 나간다** — `duration=20`을 실수로 써도 경고 없이 19초 무음. 가져오기 미리보기에 "planned가 오디오보다 N배 이상 길면 경고"를 붙일 수 있다. (스펙 D24a-15가 "측정 후 정책 결정"으로 미뤄둔 것)

---

## 5. D24b (image-only) 는 의도적으로 막아뒀다

`validateFixedScenes`가 `sourceNarrationLines`를 요구하는데 **image-only stage가 그걸 저장하지 않는다.** `script.md`를 line-split하는 건 발명이라 fail-closed로 뒀고, **ImportModal이 CSV를 필수로 강제**한다(`imageFirstVariant`는 `'storyboard'` 하드코딩).

D24b를 열려면: **M0-4(maxN) + M0-15(blind gate)가 GREEN** + canonical source line을 durable 저장하는 후속 명세.

---

## 6. 잡일

- `CLAUDE.md`, `docs/README.md` uncommitted (교차 리뷰 프로세스 문서). 별도 커밋.
- **Veo 오디오 볼륨 옵션**은 `feature/veo-audio-volume` (`c652899`). 실앱 눈검증 미완.
- **스펙 §D24의 line anchor가 드리프트했다** (Codex 지적). 함수명+고유 코드 앵커로 바꾸는 게 안전.
- **스펙이 틀렸던 곳 4개** — 코드가 이미 고쳤으니 스펙에 반영할 것:
  1. abort IPC 누락 (D24a-5의 staging cleanup이 불가능했다)
  2. journal 없는 staging 미수거
  3. stage의 `validateFixedScenes` roster 인자가 틀려서 **stage 자체가 불가능**했다
  4. `confirmSynopsis`가 fixed identity를 요구하는데 스펙엔 없어서 **모든 D24a roster confirm이 죽을 뻔**
- **flaky 테스트 1개** — 전체 스위트에서 드물게 1개 실패했다 재현 안 됨. 병렬 워커 부하로 보이고 story 스위트는 아님. 다시 보이면 파일명을 잡아둘 것.
- **D23의 "현재 코드 문제 3개" 중 1번은 접었다** (D23-1, §2 참고). 나머지 2개는 유효:
  - `keyStoreMulti`에 `anthropic` 슬롯이 있고 렌더러에서 저장까지 되는데 **읽는 곳이 0개** — 죽은 반쪽 배선
  - 임시 CODEX_HOME의 `auth.json`이 **크래시 시 `/tmp`에 영구 잔존** (cleanup이 `finally`에만, 부팅 스윕 없음)
