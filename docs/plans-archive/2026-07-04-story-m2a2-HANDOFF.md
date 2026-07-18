# Story M2a-2 — 정밀 push/timing 핸드오프

**날짜**: 2026-07-04
**BASE**: `732195b` (feature/story-pipeline, M2a-1 완료, 전체 3903 pass)
**스펙**: `docs/superpowers/specs/2026-07-04-story-m2-audio-design.md` (§4 재TTS 정책 / §7 export 통합·revision 소유 / §8 M2a-2 / §9 테스트)
**이전 원장**: `.superpowers/sdd/progress.md` (M2a-1 섹션, line 93~128 — 이연 항목 명시)

---

## 0. 한 줄 요약

M2a-1은 audio 스텝이 **실측 timing·SRT·manifest·finalScenes(startSec/endSec)를 디스크에 다 써두는데**,
**push는 여전히 글자수 추정(`buildFallbackTimeline`)으로 나간다.** 실측값이 push까지 흐르게 잇는 게 M2a-2의 본질.
그 위에 재실행 identity(세그먼트 id 승계) + 재TTS 정책을 얹는다.

---

## 1. 착수 전 반드시 확인할 계약 (renderer / IPC)

착수 전에 이 3개를 코드로 재확인하고 시작할 것. 여기가 어긋나면 push가 렌더러에 안 꽂힌다.

### C1. tts/probe가 실제 앱에 **주입되지 않음** (블로커 겸 범위 결정 지점)
- `electron/ipc/story-api.js:64` — `createStepMachine({ projectPath, llm, emit, getApiKey, loadMetaPrompt })`.
  **`tts`, `probe` 인자가 없다.** 팩토리 시그니처는 `stepMachine.js:41`에서 둘을 받는다.
- 즉 **실앱에서 audio 스텝 실행 시 `tts.capabilities()` (stepMachine.js:178)에서 즉시 크래시.** M2a-1은 테스트가 mock tts/probe를 주입해서 통과했을 뿐, 앱에선 audio가 못 돈다.
- Codex HIGH3가 "story-api tts/probe 미주입 = M2a-3 범위"로 이연했지만 — **measured push를 실앱에서 검증하려면 최소 주입이 필요.**
- **✅ 결정됨 (2026-07-04, 사용자): (a) 채택.** M2a-2a에서 **최소 default 주입**(Typecast 어댑터 `electron/api/tts/index.js` + `music-metadata` probe)을 `story-api.js:64` `createStepMachine` 호출에 배선 → measured push를 앱에서 end-to-end 검증. 화자매핑 UI·멀티 provider 선택·keyStore 마이그레이션은 M2a-3로 남김.
  - 배선 범위(2a): (1) `story-api.js`에서 tts 어댑터 인스턴스 + probe 함수를 createStepMachine에 전달. (2) 화자 voice는 **최소 하드 배정**(기본 화자 1인, Typecast voice_id — CLAUDE.md의 Joonkyu `tc_6436dbbb602bde66c6b39504` 등)로 audio가 돌게만. **정식 화자매핑 UI는 2a 범위 아님.** (3) Typecast key는 `~/.typecast/credentials`(평문 소스 금지, keyStore/env 경유).
  - (참고) 원 후보 (b)=mock 한정: 기각. measured push는 "실측→push→렌더 반영"이 핵심이라 mock만으론 진짜 검증 아님.

### C2. `importStoryScenes` payload 필드명이 렌더러에 의해 **고정**돼 있음
- `src/hooks/useScenes.js:675-712`가 소비하는 필드 (변경 금지, push가 여기 맞춰야 함):
  - `p.storyId`, `p.prompt`, `p.videoT2VPrompt`, `p.duration`(**초 단위**, staleVideo 판정 `Math.abs(prev.duration - p.duration) > 0.5` @ line 691), `p.startTime`/`p.endTime`(mapScene 계약), `p.srtLineIds`, `p.subtitle`.
  - `srtTrack` 인자가 있으면 **wholesale 교체 + non-story 씬 srtLineIds 비움** (line 700-702, 710).
- **주의 — 필드명 불일치**: audio가 쓰는 `finalScenes`(stepMachine.js:231-240)는 `startSec`/`endSec`인데, 렌더러/`mapScene`는 `startTime`/`endTime`/`duration`을 기대. **push 매핑에서 초 단위 그대로 startTime/endTime/duration으로 옮길 것.** 렌더러 필드명을 바꾸지 말 것(다른 CSV/편집 경로도 공유).

### C3. srtTrack 엔트리 shape
- `src/utils/srtTrack.js`의 `createSrtTrackFromScenes` / `pruneSrtTrackToScenes`가 쓰는 엔트리 구조(id/start/end/text 등)를 **착수 전 확인**하고, audio의 세그먼트 타임라인(`timed[].startMs`, `srtLineId(id)=sub_<id>`)에서 그 shape로 srtTrack payload를 생성. 현재 `sendPush`는 srtTrack을 아예 안 보냄(아래 IP2).

---

## 2. 통합 지점 5개 (integration seams)

각 seam = "M2a-1이 반쪽만 이어둔 지점". 파일:라인 고정.

### IP1 — sendPush measured timing (★ M2a-2 1번 과제)
- **현재**: `stepMachine.js:67-75` `sendPush` → `buildFallbackTimeline(scenes, language)`(글자수 추정, `timing.js:13`)로 startTime/endTime/duration 계산. `mapScene`(:54-64)이 그걸 실어보냄.
- **해야 할 것**: `steps.audio.status === 'done'`이면 **실측 timing 사용**. 소스는 `scenes.json`의 finalScenes `startSec`/`endSec`(이미 저장돼 있음, stepMachine.js:235-236). audio 미실행(대략 모드)일 때만 `buildFallbackTimeline` 폴백 유지.
- **정합**: `startSec`→`startTime`, `endSec`→`endTime`, `duration = endSec - startSec` (초). C2 필드명 고정 준수.

### IP2 — srtLineIds 수집 + srtTrack payload
- **현재**: `mapScene`(stepMachine.js:62)이 `srtLineIds: []` 하드코딩. `sendPush`(:71-74)는 `{pushRevision, scenes}`만 보내고 **srtTrack 없음.** 렌더러(C2)는 srtTrack로 wholesale 교체를 기대.
- **해야 할 것**:
  - 씬(그룹)별 `srtLineIds` = 그룹 내 narration 세그먼트들의 `srtLineId(seg.id)`(=`sub_<id>`, `timing.js:35`) 배열, 순서 보존.
  - `final.srt`/`timed` 세그먼트에서 srtTrack payload(C3 shape) 생성해 push에 포함.
  - 스펙 §7 흐름A: srtTrack **wholesale 교체**(fuzzy 금지), 재실행 시 세그먼트 id 안정이면 라인 id도 안정(IP4 선행).

### IP3 — revision 소유: prompts가 manifest.pushRevision 재스탬프 (audio↔prompts↔manifest 봉합)
- **현재**: audio가 `manifest.pushRevision = null` 기록(stepMachine.js:251, "prompts가 재스탬프" 주석). prompts는 `state.pendingPushRevision += 1`(:264)만 하고 **manifest를 다시 안 씀.** → manifest.pushRevision이 영원히 null → 스펙 §7 export 정합 검사(`manifest.pushRevision === lastPushedRevision`)에서 **항상 차단.**
- **해야 할 것**(스펙 §7 revision 소유 프로토콜): 최초 정밀 실행에서 **prompts가 full push emit 시 `pendingPushRevision++` 후 그 값으로 manifest.json을 atomic 재스탬프.** (재TTS 경로는 audio가 소유 — IP5.)
- 참고: prompts는 push를 `return { pushScenes }`로 넘기고 실제 emit은 start() 래퍼가 flush 후(:264-268, 326-328). 재스탬프 타이밍이 flush/emit 순서와 정합되게.

### IP4 — 세그먼트 id 승계 (재실행 identity)
- **현재**: `assignSegmentIds`(M2a-1, 위치기반 `s{i}-{j}`). ② 재실행 시 세그먼트 삽입/재정렬이면 id 재사용/드리프트. 씬 storyId 승계(`assignStoryIdsByMembership`, `sceneIdentity.js:63`)가 **세그먼트 id 집합을 key로** 쓰므로, 세그먼트 id가 안정해야 씬 storyId도 안정.
- **해야 할 것**: `inheritStoryIds`(sceneIdentity.js:21, 씬 레벨 정규화 텍스트 1:1)와 같은 방식을 **세그먼트 레벨**로. `scenes` 스텝(stepMachine.js:145-148, `inheritStoryIds`→`assignSegmentIds` 사이)에서 이전 scenes.json 세그먼트와 정규화 텍스트 완전/포함 + 1:1 매칭으로 id 승계, 미매칭만 신규.

### IP5 — 재TTS 정책 + no-push 대기 전이 + status/부분재시도
- **현재**: audio 스텝에 **재실행 분기 없음.** 항상 전체 재-TTS, 항상 manifest pushRevision=null. 세그먼트 `status`(pending/done/error) 미기록(M2a-1 이연 I3).
- **해야 할 것**(스펙 §4 표 + §5 write safety):
  - **멤버십 불변**(세그먼트 id 집합 동일): audio가 push 소유 → `pendingPushRevision++` + manifest 재스탬프 + **timing-only push**(startTime/endTime/duration/srtLineIds/srtTrack만, 프롬프트/이미지 보존). duration ±0.5s 초과 씬은 렌더러가 staleVideo(C2 line 691).
  - **멤버십 변화**(재그룹 경계 이동): **audio no-push** → `steps.prompts=pending`(needs-rerun) 리셋 + `manifest.pushRevision=null` + `pendingPushRevision` 증가 안 함. 사용자 prompts 재실행이 full push 소유(신규 storyId 씬, 겹치는 옛 씬=삭제 후보, **stale 미사용**).
  - 세그먼트 `status` 기록 + **단일 실행 내 부분 재시도**(done skip, error만 재생성). M2a-1 orphaned wav(재시도 시 덮어씀) cleanup.

---

## 3. 범위 분할 — measured push 먼저

M2a-2를 둘로 쪼갠다. 2a가 자체 완결·독립 검증 가능하고 "1번 과제"라 먼저.

### M2a-2a — measured push (IP1 + IP2 + IP3 + C1-a 최소 배선)
> "최초 정밀 1회전이 실측 timing으로 push되고 export가 열린다."
- IP1 measured timing push + IP2 srtLineIds/srtTrack + IP3 prompts 재스탬프.
- **C1-a 확정**: story-api에 Typecast tts + music-metadata probe 최소 주입 + 기본 화자 하드 배정 → 앱 end-to-end 검증(화자매핑 UI는 M2a-3).
- **검증**: 기존 audio→prompts 통합테스트(stepMachine, C2/I1/I2 fix서 추가됨)에 **push payload 단언 확장** — startTime/endTime이 실측(글자수 추정 아님)인지, srtLineIds 채워졌는지, srtTrack 오는지, prompts 후 manifest.pushRevision == lastPushedRevision인지.
- 재실행/재TTS **없이** 첫 실행만 다룸 → membership 변화·승계 복잡도 배제. 독립 머지 가능.

### M2a-2b — 재실행 identity & 재TTS (IP4 + IP5)
> "재실행/재TTS해도 씬이 조용히 안 틀어진다."
- IP4 세그먼트 id 승계 + IP5 재TTS 정책(timing-only vs no-push 대기 전이) + 세그먼트 status/부분재시도 + 대략 모드 폴백 공존.
- 상태 전이·stale 플래그·멤버십 분기라 무겁고, 2a의 첫-실행 push와 직교.
- **검증**(스펙 §9): 멤버십 불변→timing-only+staleVideo / 변화→prompts=pending·manifest null·pendingPushRevision 불변, 세그먼트 승계 집합 동일→storyId 승계, 재시작 후 status 기반 재개.

---

## 4. 작업 방식 (변경 없음)

- TDD: RED→GREEN, `tests/` 미러. audio/push는 통합테스트가 실계약(스키마 id/sceneNo/startSec) 대변하게 — M2a-1 근본원인(per-task mock이 실계약 미대변, 통합서만 드러남) 반복 방지.
- 서브페이즈 완료마다 **Codex Review findings 0까지 loop** ([[codex-review-per-milestone]]). 난제는 Fable subagent ([[use-fable5-for-hard-problems]]).
- 완료 plan/spec은 `docs/plans-archive/`로 이동(CLAUDE.md 규칙). 스펙은 M2a 전체 끝날 때.

## 5. 착수 첫 액션
1. C1~C3 코드 재확인 (story-api.js:64 / useScenes.js:675 / utils/srtTrack.js) + C1 (a/b) 사용자 확인.
2. `docs/superpowers/plans/`에 M2a-2a 플랜 작성(IP1/2/3, TDD task 분해) → 진행 원장에 M2a-2a 섹션.
3. 기존 audio→prompts 통합테스트를 RED로 확장(measured push 단언)부터.
