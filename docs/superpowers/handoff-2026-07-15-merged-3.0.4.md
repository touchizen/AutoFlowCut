# 핸드오프 — 승인창 서술형 + S6 D8 정규화 + main(3.0.4) 병합 완료 (2026-07-15)

**브랜치**: `feature/inapp-agent` — HEAD `ef10b76`. **origin 에 push 됨** (`c18ff32..ef10b76`). 워킹트리 클린.
**전체 스위트**: **631 files / 6860 tests 그린** (`npm run test:run` 직접 실행, exit 0). `npm run build` 그린.
**뮤테이션**: 승인창 39/39 + S6 15/15 = **54/54 killed, 사각지대(NO-OP) 0.**

> ⚠️ **`| tail` 로 파이프하면 exit code 가 `tail` 것이 되어 항상 0 이다.** `npm run test:run > /tmp/f.log 2>&1; echo $?` 로 **직접** 받아라.
> ⚠️ Codex 는 샌드박스 loopback(`listen EPERM`) 때문에 3파일을 못 돈다 — "전부 그린" 보고를 그대로 믿지 말고 **Opus 가 직접** 전체를 돌려라.

### 정본 문서
1. **스펙 = 계약**: `docs/superpowers/specs/2026-07-11-inapp-agent-orchestration-spec-v11.md` — **D9 ERRATA "(A) 채택 조건 5개"** 가 본문보다 우선. (S6 에서 D8 텍스트 갱신 — reason open set, `getStateLight()` 유령 제거, 심볼 앵커.)
2. **직전 핸드오프**: `handoff-2026-07-15-approval-narrative.md` (승인창·S6 상세 — §승인창 불변식 6개, §S6 설계 근거). **이 문서는 그 위에 병합 상태만 얹은 것이다.**
3. `handoff-2026-07-15-m2-gate-live.md` (M2 게이트 구조 §2, 실앱/패키징이 잡은 것 §3 — **여전히 유효**).

> ⚠️ `docs/superpowers/` 는 `.gitignore` 대상이다. **git 에 안 잡힌다. 디스크에만 있다. 지우지 마라.**

---

## 0. 이번 세션 커밋

| | |
|---|---|
| `8d8d295` | 승인창 **서술형** + 신뢰 경계(message↔argsHash 검증) + 게이트 구멍 2개(`characters:null`, `params.input`) + 거짓 문구 정정 |
| `e9abe2f` | danger 줄 **빨강 박스** (연주황+굵게는 약해서 사람이 놓친다) |
| `89cbf9f` | **S6 — D8 반환 정규화** (4가지 관용구 → 한 어휘, fail-CLOSED) |
| `ef10b76` | **main(3.0.4) 병합** (아래 §2) |

✅ **실앱 눈검증 통과** (사용자): 서술형으로 뜸 / 좁은 창에서 전체 보임 / 다른 UI 에 안 가림.
🟡 **미확인**: danger 를 **빨강 박스로 바꾼 뒤(`e9abe2f`)의 재확인**. — **블로커 아님.** 순수 CSS 변경이고 danger 클래스 부착은 테스트가 잡는다. 앱 쓸 때 아무 때나 눈으로 보면 됨.

---

## 1. 작업 방식 (그대로 유효 — 이번 세션에 4라운드 리뷰로 검증됨)

| 성격 | 담당 |
|---|---|
| **어려운 것** (설계·코드 고고학·동시성/identity/보안) | **Codex `gpt-5.6-sol`** — `mcp__codex__codex`, `sandbox: workspace-write`, `model_reasoning_effort: xhigh` |
| **적대적 리뷰** (findings 0 까지 loop) | **Fable 5** — Agent tool, `model: 'fable'` |
| **오케스트레이션 + 검증 + 뮤테이션** | **Opus** (직접 전체 스위트·뮤테이션 실행) |

**설계 결정은 혼자 하지 마라.** 승인창·S6 둘 다 Codex + Fable 에게 **독립적으로** 물어 수렴점으로 진행했다. 두 번 다 둘이 같은 결함을 독립 발견했다 (승인창: message↔argsHash 무검증 / S6: fail-open).

### 🔴 뮤테이션이 전부다 — 이번에도 반복됐다
> **코드는 맞는데 테스트가 제품이 실제로 가는 길을 안 지나간다.**

이번에 뮤테이션으로만 잡힌 것: 화자 **배열 원소**의 fail-closed 미테스트 / residual 형제-접두사 과잉 커버 / `toolCore` 가 스스로 `input.type` 지어내는 경로 / normalizer fail-open. **하네스**: `mutate.mjs` (scratchpad) — byte-exact `cp` 백업/복원 + md5 + **NO-OP(패턴 불일치)를 사각지대로 보고** + 복원 후 baseline 재확인. `git checkout` 복원 금지 (untracked 섞이면 pathspec 에러로 복원 실패 → "killed" 가 거짓).

### 🔴 앵커는 **심볼**로 (줄번호 금지)
S6 병합에서 `STORY_STEP_DOWNSTREAM` export 가 6줄 밀며 승인창 앵커 29개가 −6 드리프트했었다 (커밋 전에 잡음). 전부 심볼 앵커. **다시 줄번호로 쓰지 마라.**

---

## 2. 🔴 main(3.0.4) 병합이 도입한 것 — **새 코드가 지켜야 할 규칙**

병합으로 들어온 main 기능: **UI 가상화**(`@tanstack/react-virtual` — SceneList/results/timeline), **Windows SRT import + encoding 감지**, **large import safeguards**, **Flow 로케일-안전 수정**, 그리고 🔴 **main-process 에러 로케일화**.

### 🔴 새 로케일 가드 2개 — 새 코드가 **반드시** 통과해야 한다
main 이 CI 가드를 추가했다. 이번 병합에서 내 인앱 에이전트 코드 5곳이 걸려 고쳤다:
- **`tests/electron/noKoreanIpcErrors.test.js`**: `electron/` 의 `throw new Error(...)` / `error:` 값에 **한글 문장 금지**. 이유: main-process 실패가 IPC 로 renderer 에 plain object 로 넘어가 영어 사용자가 한글을 본다 (Electron 은 renderer 의 `useI18n` 못 부름). → **electron 에러는 영어로 쓰고, 이유는 한글 주석으로.**
- **`tests/renderer/noHardcodedKoreanNotifications.test.js`**: `src/` 의 `toast.*` 에 **하드코딩 한글 금지** (fallback `t('key', '오류')` 의 한글 fallback 도 걸린다). → `t('key')` 만.
- 에러 표시는 `src/utils/errorDisplay.js` 의 `resolveDisplayError` + 로케일 독립 `errorKind` 코드. stepMachine 의 step 실패는 `state.steps[step].errorKind` 를 싣는다 (병합에서 내 D8 `outcome` 과 공존시킴).

### 파일 읽기 도구 교체 (병합 결과)
- `readTextFile` 은 이제 `src/utils/decodeTextFile.js` 에서 import (encoding 감지). 로컬 `FileReader` 정의는 제거됨.

---

## 3. 승인창 불변식 (깨면 게이트가 죽는다 — `handoff-2026-07-15-approval-narrative.md §2` 참조)
1. 서술이 원본을 **대체하지 않는다** — residual 강제 노출. 2. **앱이** 만든다(순수 함수). 3. 모르는 툴/타입 → 승인 **disabled**. 4. **나쁜 요약은 없는 것보다 나쁘다(안심시킴).** 5. **드리프트 락** 테스트(`APPROVAL_KEY_DECISIONS`↔inputSchema, `APPROVAL_DOWNSTREAM`↔`STORY_STEP_DOWNSTREAM`). 6. **출하 게이트**: 모든 G/B 툴은 presenter 필수 — **M4 에서 `generate_videos` 넣는 순간 빨간불**.

## D8 반환 계약 (S6 — `handoff-2026-07-15-approval-narrative.md §S6`)
에이전트 툴 결과는 `{status:'done'|'error'|'aborted'|'rejected', operationId?, reason?, error?, ...}`. `normalizeToolResult` 는 **fail-CLOSED** (모르면 throw=isError, done 지어내기 금지). `start()` 의 outcome 은 **실행 지역 캡처** (전역 slot 은 abort 후 다른 실행이 덮는다). 선행 거부 top-level `{error}` 는 **renderer 계약이라 동결**. unconfirmed 분리(`unconfirmed` vs `characters-unconfirmed`).

---

## 4. 🔴 다음 할 일

### (A) M3 — 에이전트의 눈 + Export  ← **추천 다음**
에이전트가 자기가 만든 것(scene 이미지 등)을 **보고**, CapCut/Premiere 로 **Export** 하는 툴. 방금 정리한 D8 반환 계약 위에 자연스럽게 얹힌다.
- 🔴 **착수 전 스펙 조사부터**: `spec-v11.md` 에서 M3 범위(어떤 툴? nativeImage decode? export 툴?)를 Explore 로 훑고, 설계는 Codex+Fable 독립 자문 → 수렴.
- 새 툴은 **출하 게이트**(presenter)·**D8 반환**·**로케일 가드**(§2) 를 전부 통과해야 한다.

### (B) M4 — Veo + 크레딧 (M3 뒤)
`generate_videos` = **과금 툴**. `video.admit` 이 없어서 지금 출하 툴 표에서 **의도적으로 뺐다** (`toolCore.js` 주석 + `list()` 단언). 되넣으려면 **의식적으로** 그 테스트를 고쳐야 하고, presenter 는 **과금 수량·크레딧을 명시**해야 한다 (승인창 6번 게이트가 강제). 정직한 구현은 renderer 구독/크레딧 admission 의 batchId·consumeGate 를 Veo pipeline 끝까지 같은 identity 로 운반. **제일 위험 — 크레딧 게이트가 제품 급소. 그래서 M3 뒤.**

### (C) 그 다음
M5 (리서치 툴 7종).

### 빚 (paper fix 로 때우지 마라)
- ~~S6 D8 정규화~~ ✅ 완료.
- **M4 `generate_videos`/`video.admit`** (위 B).

---

## 5. 잡일 / 미측정
- danger 빨강 박스 실앱 재확인(위 §0, 블로커 아님).
- **레거시 MCP HTTP 토큰 인증** — CORS 는 끊었지만 같은 머신 다른 프로세스는 닿는다. 제품 결정 필요.
- **flaky 테스트 1개** — 드물게 1개 실패, 재현 안 됨.
- D23 잔여: `keyStoreMulti` 의 `anthropic` 슬롯이 읽는 곳 0개.
- 미측정: 장기 세션 `auth.json` refresh / 지속 thread context 상한 / M0-3·4·6·7·14·15·16.
- 리뷰 LOW (안전 방향 부정확, 고칠 필요 없음): audio timingOnly 는 하류 리셋 후 prompts 를 done 복원하는데 창은 무조건 초기화라고 말함(실제보다 나쁘게 경고) / 생성 경로 빈 문자열 `synopsis` 폴백 억제(비파괴).
- **패키징 최종 확인**: 승인창 실앱 눈검증의 완결은 `npm run pack` + 터미널 실행 (유닛이 못 잡는 부류 — z-index/WebContentsView/asar spawn). ⚠️ `electron-builder --dir` 만으론 vite/main 번들 갱신 안 됨.
