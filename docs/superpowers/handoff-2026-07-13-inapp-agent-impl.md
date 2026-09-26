> ⚠️ **SUPERSEDED** — 정본은 `handoff-2026-07-14-m0-spike.md` 다. 이 문서는 M1a 구현 과정의 기록으로만 남긴다.

# 핸드오프 — 인앱 에이전트 구현 (2026-07-13 갱신)

**브랜치**: `feature/inapp-agent` (HEAD `b2d40eb`)
**정본 스펙**: `docs/superpowers/specs/2026-07-11-inapp-agent-orchestration-spec-v11.md` — **이게 계약이다.**

> ⚠️ `docs/superpowers/` 는 `.gitignore` 대상이라 스펙/플랜/핸드오프는 **git에 안 잡힌다.** 디스크에만 있다. 지우지 마라.

---

## 0. 한 줄

**M1a (D24a storyboard-first) 코드가 전부 끝났다. 커밋 12개. 전체 스위트 550 files / 6038 tests 그린, 빌드 통과.**
**남은 건 (1) 실앱 눈검증, (2) step 6·7의 Codex 교차 리뷰(쿼터 소진으로 미완).**

---

## 1. 작업 방식

| 성격 | 담당 |
|---|---|
| **어려운 것** (설계, 코드 고고학, 트랜잭션/동시성/identity) | **Codex `gpt-5.6-sol`** — `mcp__codex__codex`, `sandbox: workspace-write`, `config: {model_reasoning_effort: "xhigh"}` |
| **기계적인 것** (배선, 테스트, UI) | **Claude** |
| **리뷰** | **누가 쓰든 다른 쪽이 뜯는다. findings 0까지 loop.** |

- ⚠️ **Codex 세션은 30분 idle timeout.** 스코프를 잘게 쪼개라 (step 3→3a/3b, step 4→4a/4b/4c/4d로 쪼갠 이유). 한 번 timeout 났지만 작업물은 디스크에 남아 있었다.
- ⚠️ **Codex 사용량 한도가 있다.** 소진되면 리셋까지 대기. Claude subagent로 대체 가능하지만 교차 리뷰 품질은 Codex가 낫다.

### 리뷰 방법 — **뮤테이션이 유일하게 작동한 도구**

**매 스텝마다 Codex 스위트에서 살아남는 뮤턴트가 나왔다** (2, 3a, 3b, 4a, 4b, 4c, 5 전부). **세 번은 Codex가 "죽었다"고 보고했는데 실제로는 안 죽었다.** → **직접 돌려라. 보고를 믿지 마라.**

**뮤테이션 하네스 함정 (내가 전부 밟았다 — 반복하지 마라):**
1. **베이스라인이 그린인지 먼저 확인해라.** step 5에서 내 앞선 뮤턴트가 파일에 남은 채 백업을 떠서, 이후 모든 결과가 무의미했다. 매 배터리 시작에 `baseline이 failed면 abort` 가드를 넣어라.
2. `perl -0pi -e 's/…/…/'` 는 **첫 매치만** 바꾼다 → 엉뚱한 줄을 건드리고 "생존" 오판. **줄 번호로 타겟팅해라** (`awk 'NR==L{print "..."; next}{print}'`).
3. `npx vitest run a.js b.js` 멀티 경로가 조용히 빈 출력 → 전부 "생존" 오판. **한 파일씩 돌려라.** 결과가 비면 SURVIVED가 아니라 **ERROR**로 처리해라.
4. 적용 여부를 `git diff` 로 판정하지 마라 (파일이 이미 dirty면 항상 "적용됨"). **백업과 `diff -q`** 로 판정해라.
5. **`git checkout -- <file>` 로 복원하지 마라 — 커밋 안 된 작업을 날린다** (4c에서 Codex 작업을 실제로 날렸다가 /tmp 백업으로 겨우 복구). **`cp <backup>` 만.**
6. **동치 뮤턴트(equivalent mutant)** 를 finding으로 착각하지 마라. `true && expr`, `x || fallback` 이 rescue하는 뮤턴트는 동작이 안 변한다. 생존하면 **뮤턴트가 잘못된 건지 먼저 의심**해라.

---

## 2. 완료 — 커밋 12개

| 커밋 | 무엇 | 리뷰에서 잡은 것 |
|---|---|---|
| `60c0fac` | **2** `electron/story/fixedScenes.js` — `validateFixedScenes()` + `checkFixedSceneConsistency()` | **4 findings.** ① `sceneOrdinal`을 slot index로 쓰면 `10,20,30` CSV 거부 ② rule 6이 **틈 있는 시계** 통과 → export는 누적 duration으로 깔아서 A/V desync ③ 모르는 segment `type`이 coverage를 빠져나가는데 subtitle엔 들어감 ④ 전역 coverage 체크가 **테스트 0개** |
| `6ef85e3` | **3a** fs 트랜잭션 (stage/abort/commit + journal 복구/격리, D11 strict PNG) | **BLOCKER.** journal이 **절대 경로** 저장 → 작업폴더 이동/rename 시 `load-project-data` **영구 실패** → project.json이 멀쩡한데 프로젝트를 **영영 못 엶.** 복구 실패는 절대 open을 막으면 안 됨 |
| `ff3a263` | **3b** renderer import window (6-writer 게이트, FixedSceneState 영속, PNG normalizer, `useScenes` prompt 수정) | **동어반복 테스트.** `getTimerCount()===0` 을 `runAllTimersAsync()` **뒤에** 확인 → 항상 통과. Codex가 **`importEpoch`** 를 스스로 추가 (await 중 window가 열렸다 **닫히는** 경우) |
| `dbcb4c6` | **4a** `buildStoryboardArtifacts()` 어댑터 + `storyInputTypes.js` predicate | **byte-for-byte가 테스트 불가능했음** — fixture prompt가 전부 이미 trim돼 있어 `.trim()` 넣어도 안 죽음. **차등 테스트** 추가 (adapter ↔ validator 독립 구현 대조) |
| `da34989` | **4b** `machine.stageImageFirst()` — committed-but-unstaged 유일 소비자 | **스펙 모순.** stage에서 `validateFixedScenes(speakers: state.speakers)` 하라는데 신규 import는 roster가 **비어 있어서** self-promote된 화자를 전부 거부 → **stage 자체가 불가능** |
| `f3dfecd` | **4c** 게이트 4개 (`fixed-scenes-immutable`, `fixed-audio-required`, synopsis pin, confirm roster) | **게이트 순서가 곧 게이트** — `operationId`/`AbortController`/`DOWNSTREAM` reset **앞**이어야 함 |
| `7f39cf1` | **5** slot-anchored clock + deterministic prompt-sync | **`timingOnly` 강제 해제가 급소** — 안 하면 prompt-sync·`fixed-audio-required`가 **전부 죽은 코드** |
| `0f34708`+`30db2f3` | **8** export admission (consistency→readiness→completeness) | **BLOCKER (Codex가 내 코드에서).** **paper fix** — fixed set을 검증하고 **버린 뒤** `scenes.filter()` 로 export → renderer 순서/비-fixed 씬이 그대로 나감. 내 consistency predicate가 owner보다 약해 **5개 입력에서 불일치**. 내 테스트는 동어반복 (뮤턴트 5개 생존) |
| `f0ceb29` | **4d** resend/open/start consistency + durable `fixedSceneError` | **BLOCKER (Codex가 발견).** `maybeResendPush`가 owner를 안 부름 → 크래시 후 `open()`이 **old scenes를 resend해 새 fixed set을 덮어씀** (데이터 손실) |
| `285fb2a` | **6** ImportModal + App import coordinator | **이게 없으면 전 기능이 도달 불가**였다 (Codex 리치빌리티 리뷰가 잡음: 제품 caller 0개) |
| `b2d40eb` | **7** StoryView 라우팅/컨트롤 숨김/복구 패널 | **autoSteps 데드락** — 기본 `audio:false` 라 `nextAutoStep`이 prompts를 먼저 골라 게이트에 막힘. **스펙 누락**: `confirmSynopsis`가 fixed identity를 요구하는데 스펙엔 없음 → 안 보내면 **모든 D24a roster confirm이 죽음** |

---

## 3. 실앱 눈검증 — **2026-07-13 완료. 전 항목 통과.**

측정값이 D24a-9와 정확히 일치했다 (`test8`):
```
scene1  start=0      end=20      planned 20s 유지
scene2  start=20     end=27.85   정확히 20.000s 시작 → 300ms tail drift 0
                                 duration = max(planned 3s, TTS 7.55s + 300ms)  → 나레이션 안 잘림
scene3  start=27.85  end=31.85   visual-only, planned 4s 그대로
manifest.pushRevision=1, steps 전부 done, CapCut 열어서 눈으로 확인 OK
```
JPEG→PNG 정규화도 실증됐다 — `scenes/scene_4.png`, `scene_5.png` 가 jpg 유래인데 디스크에 진짜 PNG 1280×720 RGBA. **jsdom엔 canvas가 없어서 그 경로는 한 번도 실행된 적이 없었다.**

### 🔴 실앱 검증이 잡은 버그 5개 — **전부 559파일 6000+테스트가 그린인 채로 통과했다**

| # | 버그 | 왜 테스트가 못 잡았나 |
|---|---|---|
| 1 | **CSV 선택 버튼이 안 보임.** `.image-first-import` 의 `min-width: min(720px,78vw)` 가 모달(≈510px)보다 넓어 툴바 3번째 버튼이 잘림 | **jsdom엔 레이아웃이 없다.** 테스트 11개 전부 통과 |
| 2 | **CSV 없이도 image-only(D24b, 미구현)로 fail-open.** prompt-sync가 fail-closed라 못 빠져나옴 | 테스트가 `image-only 가 합법`이라고 **못박고** 있었다 |
| 3 | **이미지 세트 교체 불가 (BLOCKER).** `stageImageFirst` 가 story revision이 **아예 없을 때만** 전이 허용 → 이미 세트가 있으면 `fixed-scenes-stale`. 복구 패널 '이미지 세트 다시 임포트'도 같이 죽음 | 테스트가 `옛 revision이면 전이 불허` 를 **계약으로 못박고** 있었다 |
| 4 | **narrator-only 스토리보드에서 roster 화면이 텅 빔.** narrator는 등장인물이 아니라 0행 → 고장난 줄 알고 멈춤 (확정 자체는 통과했다) | UI 공백 상태는 어떤 단위 테스트도 안 본다 |
| 5 | i18n: `이미지 우선`(직역 jargon), 우리가 넣은 문구만 **반말**(앱 전체는 존댓말), `← 형식 목록` | `t()` 를 mock 하니 문자열이 검증되지 않는다 |

**교훈: "테스트가 못 보는 층"이 어디인지가 곧 실앱 검증의 대상이다** — 레이아웃, 실제 인코더, 빈 상태, 문자열, 그리고 **버그를 계약으로 못박은 테스트**.

### 3.1 남은 눈검증 (선택)
- 앱을 중간에 죽이고 재시작 → 복구 패널(`role='alert'`)
- CSV에 일부러 오류(빈 speaker, 중복 헤더) → **정확한 parsed board 행**에 alert

### 3.2 제품 결정 필요
- **image-first엔 videoPrompt가 없다.** CSV 13필드 스키마에 비디오 프롬프트 컬럼이 없고 D24a는 LLM 0회라 아무도 안 만든다. Veo 영상을 쓰려면 (a) CSV에 컬럼 추가 또는 (b) videoPrompt만 LLM 생성. 지금은 수동 입력.
- **import 직후~오디오 전** 렌더러 씬은 `startTime=null` 이라 타임라인에서 전부 t=0에 겹친다(맨 위 1장만 보임). push가 prompt-sync 소유라 설계상 맞지만 고장난 것처럼 보인다.

### 3.2 Codex 교차 리뷰 미완

- **step 6 (ImportModal + coordinator)** — 내가 뮤테이션 5개로 검증했지만 Codex 리뷰 없음
- **step 7 (StoryView)** — Claude subagent가 작성, 내가 뮤테이션 검증. **Codex 리뷰 없음**
- Codex 쿼터 리셋되면 이 둘을 §"리뷰어 프롬프트 5가지"로 뜯을 것

### 3.3 스펙 문서 정리
- 스펙 §D24의 line anchor가 이미 drift했다 (Codex 지적). 함수명+고유 코드 앵커로 바꾸는 게 안전.
- 스펙 구멍 3개를 코드가 이미 고쳤다 — 스펙에 반영할 것: ① abort IPC 누락 ② journal 없는 staging 미수거 ③ `confirmSynopsis` fixed identity 누락 ④ stage의 `validateFixedScenes` roster 인자

### 3.4 M0 (별도 세션, M1a를 막지 않음)
**제품 코드 0줄.** 실제 로그인된 Claude/Codex CLI + API 키 + 60분 workflow 필요.
**가장 중요한 하나 — M0-2**: 12분 블로킹 MCP 툴이 종단 `tool_result`로 오는가. 실패하면 턴 예산 33~45 → 280턴.

### 3.5 잡일
- `CLAUDE.md`, `docs/README.md` uncommitted. 별도 커밋.
- **Veo 오디오 볼륨 옵션**은 `feature/veo-audio-volume` (`c652899`). 실앱 눈검증 미완.
- D23이 찾은 현재 코드 문제 3개 (별건): ambient `ANTHROPIC_API_KEY`가 로컬 CLI 자격증명 덮어씀 / `keyStoreMulti` anthropic 슬롯 read 0곳 / 임시 CODEX_HOME `auth.json` 크래시 시 `/tmp` 잔존.
- **flaky 테스트 1개** — 전체 스위트에서 드물게 1개 실패했다 재현 안 됨. 병렬 워커 부하로 보이고 story 스위트는 아님. 다시 보이면 파일명을 잡아둘 것.

---

## 4. D24b (image-only) 는 아직 막혀 있다

`validateFixedScenes` 는 `sourceNarrationLines` 를 요구하는데 **image-only stage가 그걸 저장하지 않는다.** `script.md` 를 line-split하는 건 발명이라 fail-closed로 뒀다. D24b를 열려면 canonical source line을 durable 저장하는 후속 명세가 필요하다. **M0-S17 blind gate가 GREEN일 때만 구현한다** (스펙 §D24b).
