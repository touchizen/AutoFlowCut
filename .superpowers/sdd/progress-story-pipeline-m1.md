# Story Pipeline M1 — SDD progress ledger
Plan: docs/superpowers/plans/2026-07-02-story-pipeline-m1.md
Spec: docs/superpowers/specs/2026-07-02-story-pipeline-design.md (v9)
BASE commit (before Task 1): cf670bf
Branch: feature/story-pipeline
(이전 원장: progress-flow-m0-nocdp.md 로 보존)

## Tasks
(진행 시 기록)

## Minor findings (for final review)
- Task 1: complete (commit 97d3fca, review clean — Minor: ||→?? 취향, float 누적 참고)
- Task 2: complete (commit d665e42, review clean — Minor: 짧은 텍스트 포함매칭 오탐 가능성 참고)
- Task 3: complete (commit e3928e2, TDD RED→GREEN, 4 tests pass — No concerns)
- Task 3: complete (commit e3928e2, review clean — Minor: catch-all 삼킴/pid tmp race 참고)
- Task 4: complete (commits 91cc4bc+c615c58 fix, review Approved — Minor: abort/5xx 테스트 공백, 함수단위 JSDoc)
- Task 5: complete (commits 0cbf47f+f101735+f82a2aa, review Approved after 2 fix rounds — Critical 1·Important 3 실증 수정)
  - Minor(최종리뷰용): signal 비협조 어댑터 시 stale 부수효과 가드 밖 (M3 llmClaude 구현 시 signal 계약 준수 필수)
  - Minor: open() 전 abort() 시 state null flush 가능 — Task 6 IPC에서 open 선행 보장 확인 필요
- Task 6: complete (commits 65f41a0+2f209db fix, review Approved — Minor: stale ack의 lastPushError 덮어씀 이론적, ackPush operationId 미사용(스펙상 OK), ackPush state-null 도달불가)
- Task 7: complete (commits bab5973+c8fb1b2 fix, review Approved — 필드명 Critical은 플랜 문서 유래, 코드·문서 정정 완료)
- Task 8: complete (commit 6d1dc80, review Approved — Minor: {ok:false}에 error 사유 없음(Task 9에서 throw 처리), skip 경로 ok:true 해석)
- Task 9: complete (commits 1da4980+1041d7c fix, review Approved — race를 getState 재조회로 복구, 전 구간 멱등 확인. Minor: projectPath null(로컬 저장 모드) open 가드는 Task 10에서)
- Task 10: complete (commits 3160350+54360fc fix, review Approved — High 크로스프로젝트 오염 수정 검증)
  - Minor(최종리뷰용): useStoryAutoOpen open 실패 시 재시도 불가+unhandled rejection / 전환 직후 in-flight 찰나 윈도우(버튼 disable로 근본 해결) / autoOpen 테스트 잔재 state prop
  - 참고: tests/packaging/appxAssets.test.js 실패는 기존 버전 드리프트(2.1.0 vs 2.0.1) — 이번 브랜치 무관 pre-existing
- Task 11: complete (commits 75c74cc+156567f 보강, review Approved — 통합 테스트 첫 실행 통과, 단언 보강 완료)
## Status: Task 1~11 전부 완료. 최종 whole-branch 리뷰 + Codex 교차 리뷰 단계.
- 최종 리뷰 1차: Fable C-1+I-1~3, Codex HIGH4+MED1 → 단일 fixer로 8건 수정 (ff7ddf2..2c7306c), 재검증 대기
- Codex 재검증 2차: 이전 5건 해소 확인, 신규 5건 (HIGH: in-flight open 토큰 부활 / abort 후 늦은 done·push / projectPath workFolder 검증 부재 / 중복 start 동시 실행, MED: pushAck future revision) — Fable 재검증 결과와 합쳐 최종 fix 웨이브 예정
- 최종 fix 웨이브 2 (7건: 7a52bc7, e97606f, be78ab1, 0ac081d) + 렌더 동기 무효화 (3683bd0)
- 최종 판정: Fable whole-branch "머지 가능" + Codex FINDINGS: 0
## Status: M1 완료. 3709/3710 PASS (유일 실패 appxAssets = pre-existing 버전 드리프트, BASE에서 재현 확인). 브랜치 feature/story-pipeline (32 커밋).


## M3 Claude 엔진 (2026-07-03 시작) — plan: docs/superpowers/plans/2026-07-03-story-claude-engine.md
BASE: 3683bd0 (feature/story-pipeline)
- Task 1: complete (commits f3b62f4+4eba6fc fix, review Approved after 1 fix — lockfile desync 수정, 범위 ^0.3.199로 수렴(계열 내))
- Task 2: complete (commit afb37ac, review Approved — Minor: 테스트 2단계 중첩까지, 3단계는 Task 7 통합서 검증(최종리뷰용))
- Task 3: complete (commit d0011f5, review Approved — Minor: 테스트 vi 미사용 import, pre-aborted signal 케이스 미커버(브리프 유래, 최종리뷰용))
- Task 4: complete (commit c1efc8e, review Approved — 이슈 없음, no-meta 바이트 동일 검증)
- Task 5: complete (commit c53ab21, review Approved — 파일명 매핑 실제 ls 100%- Task 5: complete (commit c53ab21, review Approved — 파일명 매핑 실제 ls 100pct 일치. Minor: 테스트 beforeEach 미사용, W3_FILES[genre] prototype키 방어(실질무해), 미지원장르 케이스 없음(최종리뷰용))
- Task 6: complete (commit 0c867c5, review Approved — Minor: abort catch 이중 Error(harmless, 브리프 유래))
- Task 7: complete (commit 656393e, Fable, review Approved(opus) — 폴백 도달성 핵심 통과. Minor: needFallback dead 변수, 폴백루프 abort검사 없음(무해, 최종리뷰용))
- Task 8: complete (commit a397466, Fable, review Approved(opus) — 이슈 없음. fallback 3곳 제거, engine.llm 표기필드 무해, 회귀 없음)
- Task 9: complete (commit e257349, review Approved — Minor: running-state 오염방지 테스트 없음, activeOpRef projectPath 리셋 비대칭(UUID라 무해, 최종리뷰용))
- Task 10: complete (commit 1ee9afd, review Approved — 이슈 없음, 기존 테스트 exact-match 유지)
- Task 11: complete (commit a841896, review Approved — Minor: vi 미사용. 통합 PASS, 전체 3740 pass/1 무관fail(appxAssets), 패키징 빌드+ASAR언팩 검증 성공, GUI런타임만 수동)
## Status: M3 Task 1~11 전부 완료. 최종 whole-branch + Codex 교차리뷰 단계.
### 최종 리뷰 1차: Fable(Important: asarUnpack 글롭 플랫폼패키지 미커버) + Codex(P1: structured 폴백 스키마검증 누락). 단일 fixer로 반영 예정.
- 최종 fix 웨이브: eb3b674(structured 검증+asarUnpack글롭+cleanup) + ac8398f(primitive타입+writePrompts커버리지 계약)
- Codex 교차리뷰: P1 → P1x2 → FINDINGS: 0. Fable whole-branch Important(asarUnpack) 반영.
## Status: M3 완료. 최종 판정 대기(전체 회귀 확인 중).
- 전체 회귀 ac8398f: 3746 pass / 1 fail(appxAssets pre-existing, 무관). M3 관련 실패 0.
- 최종 판정: Codex FINDINGS: 0 + Fable whole-branch fixes 반영 완료. GUI 실기동만 수동 검증 남음. 머지 미실행(사용자 결정).

## StoryView 폼 재설계 (2026-07-03) — plan: docs/superpowers/plans/2026-07-03-storyview-form-redesign.md
BASE: 6f54f77 (feature/story-pipeline)
- Task 1: complete (commit 5ac505f, review Approved — Minor: 언어치환 테스트 삭제/lengthValue:0 폴백(브리프 유래). StoryView targetMinutes 잔존은 Task 3서 교체)
- Task 2: complete (commits caea69f+2dd05c8 fix, review Approved after 1 fix — tautological disableMentions 테스트를 microtask flush+양성대조군으로 실효화, mutation 확인. Minor: SyncPlugin deps 주석)
- Task 3: complete (commit ffac711, review Approved — Minor: 테스트명 stale(lengthValue 기본10이라 미입력 undefined 설명 부정확, 기능무관))
- Task 4: complete (commits ff6a61f+10ff831 fix, review Approved after 1 fix — I18nProvider 중첩(언어전환 미전파) → useHasI18n로 상위 provider 재사용, 신규 테스트로 전파 검증. dead CSS 제거)
## Status: 폼 재설계 Task 1~4 완료. Codex 교차리뷰 단계.
- Codex whole-branch R1: F1(언어변경시 길이단위 불일치) fix 커밋 / F2(편집 미반영, M1구조) 사용자 결정 대기
- Codex whole-branch 재리뷰: F1 반영 확인, F2 후속 분리 → FINDINGS: 0. 폼 재설계 완료.
## Status: 폼 재설계 완료. 다음: M1 파이프라인 검증(프롬프트→씬그리드 push).

## 대본 스텝 재설계 (2026-07-03) — plan: docs/superpowers/plans/2026-07-03-story-script-step-redesign.md
BASE: 4a90da0 (feature/story-pipeline). Codex spec findings=0(5R). 9 tasks.
- Task 1: complete (commit e2346fd, review Approved — 이슈 없음. buildTitle/Continue + 씬분리 5~10초)
- Task 2: complete (commit 847f507, review Approved — 브리프 abort race 수정. Minor: top-of-loop 가드 redundant(문서 정확성))
- Task 3: complete (commit d018c47, Fable, review Approved(opus) — 5리스크 클리어. Minor: 완료 emit마다 script.md read, continue null guard(무해))
- Task 4: complete (commit e49551a, controller 검증 — story:generate-title guarded IPC + preload storyGenerateTitle, 135 pass)
- Task 5: complete (commit 48bd23d, controller 검증 — scriptText 동기화+generateTitle, 946 pass 회귀0)
- Task 6: complete (commit 9dab08b, controller 검증 — PromptInput hideTip footer 조건부, 19 pass)
- Task 7: complete (commit 72a5d82, Fable — scriptText 단일+scriptPhase+displayStep 강제+hydrate. 우려: 재오픈 async open 시 phase 승격은 초기값 기반이라 setup 머묾 가능(리뷰 확인))
- Task 7: review Approved(opus) — Important(재오픈 async phase 승격 갭) Task 9로 인계 / Minor(hydrate 재실행 조건, editor 레거시 버튼) Task 8/9 흡수
  ⭐ Task 9 필수: open() 응답 마운트 뒤 도착 시 scriptText 있으면 scriptPhase editor 승격(effect), 단 사용자가 명시적으로 setup 이동한 경우는 존중
- appxAssets: 버전 기대 2.0.1→2.1.0 sync 수정(commit 31ce351, pre-existing 드리프트 정리 — 회귀 노이즈 제거)
- Task 8: complete (commit e7ecf34, review Approved(sonnet) — setup 화면 spec 일치. Minor: FileReader error-path("null" 문자열), scriptPhase/currentStep 커플링 → Task 9 hardening)
- Task 9: complete (commit 650eb24, Fable — editor 3버튼+제목자동생성+이어쓰기+분리시작+재오픈 phase 승격(userWentToSetupRef)+FileReader 보정. editor 16/16, 전체 3823 전부 통과)
- Task 9: review Approved(opus) — 6리스크 spec 일치, 16테스트. Minor(async갭 더블클릭, isRunning엣지, drag&drop토스트, 전환강등) 전부 spec미규정 엣지
## Status: 대본 스텝 재설계 Task 1~9 완료. 최종 whole-branch Codex 교차리뷰.
### 최종 whole-branch Codex R1: 3 blocking
- F1: 프로젝트 전환 상태 누수(StoryView key 없음 → scriptPhase/폼 리셋 안 됨)
- F2: handlePasteStart가 {language,model}만 → genre/length/title 디스크 손실
- F3: 분리시작 resolveTitle 결과가 start(scenes) payload에 없음(title 커밋 안 됨)
- 최종 fix 웨이브: 9f09817 (F1 StoryView key 격리 / F2 handlePasteStart 전체옵션+title / F3 handleSplit title 커밋). 전체 3826 통과.
- Codex R2: 1 blocking — F1 key만으론 부족(useStoryPipeline이 전환 렌더에서 옛 state/scriptText 반환, reset은 effect 다음tick). hook 렌더 동기 반환값 리셋 필요.
- 최종 fix 5cb455e: useStoryPipeline 전환 렌더 즉시 빈 상태 반환.
## Status: 대본 스텝 재설계 완료. Codex whole-branch FINDINGS: 0(3R). 전체 3827 통과. working tree clean.

## M2a-1 오디오 백엔드 (2026-07-04) — plan: docs/superpowers/plans/2026-07-04-story-m2a-audio-backend.md
spec: docs/superpowers/specs/2026-07-04-story-m2-audio-design.md (Codex findings=0, 5R)
BASE: 26d3630 (feature/story-pipeline)
## Tasks
- Task 1: complete (commits 460fae5..8111dcd fix, review clean — Important parse-guard fix 반영[손상파일→0]. Minor: bare catch 무로깅=설계의도 부합)
- Task 2: complete (commits 69d1919..82587e8 fix, review clean — Important prototype-pollution allowlist 우회[constructor/__proto__] → PROVIDERS.includes 가드로 수정, 보안경계 Task3 대비)
- Task 3: complete (commit 7cb5bf5, review Approved — 이슈 없음. Minor(최종리뷰용): language:'ko' 하드코딩[plan-mandated], dark-history 영어장르 시 오태깅 가능 — Task8 세그먼트 language 전달 고려)
- Task 4: complete (commits 203598a..9795518 fix, review Approved — Critical: 플랜 fixture 산수오류(3750→3100), implementer가 sfx 특수 gap branch 발명 → uniform gap(스펙 §5-3)로 정정+테스트 수정. Minor(type falsy→narration, trim) 스펙§4 하위호환 의도 유지)
- Task 5: complete (commit f0f4562, review Approved — 리뷰어 경계값(==minMs/==maxMs)+sfx혼합 직접 trace 검증, drop/dup 0. Minor(최종리뷰용): sfx type 테스트 fixture 없음[코드 type-agnostic이라 이미 정확, M2b서 락킹])
- Task 6: complete (commit 2f01695, review Approved — Issues None. 리뷰어 order-independent/size-sensitive(subset·superset)/중복storyId collision guard 직접 trace 검증. 9/9 pass)
- Task 7: complete (commits 5835a05..2045cbc fix, review Approved — Important saveBinary 테스트 부재[플랜 갭] → round-trip(non-utf8 바이트)/atomicity/nested-dir 테스트 추가, 67 pass. Minor(manifest type||narration) 스펙§4 하위호환 의도 유지)
- Task 8: complete (commits 2b4717a..924d2a9 fix, review Approved — Important: DOWNSTREAM audio-reset(script/scenes재실행→audio pending) 테스트 갭 → 커버 추가(done→pending 실증). Minor(최종리뷰용): tts undefined시 bare TypeError, 부분배치 TTS실패 orphaned wav[재시도 덮어씀, M2a-2 cleanup]. 전체 3885 pass 회귀0)
## Status: M2a-1 Task 1~8 전부 완료. 최종 whole-branch + Codex 교차리뷰 단계.
### 최종 whole-branch 리뷰 (Fable + Codex 병렬) — Ready to merge: No
- Fable C1/Codex HIGH2: 세그먼트 id 미발급(SCENES_SCHEMA에 id 없음) → production undefined.wav (마일스톤 무효화)
- Fable C2/Codex HIGH1: audio가 sceneNo/summary 드롭 → prompts 깨짐(claude throw/gemini 빈프롬프트)
- Codex HIGH4/Fable M3: Typecast auth 불일치(Bearer vs 실제 x-api-key) + .wav 하드코딩(format 무시)
- Codex HIGH3/Fable: story-api.js tts/probe 미주입(M2a-3 범위)
- Fable I1: 쓰기순서 SRT→scenes→manifest (스펙은 manifest→scenes, M2a-2 전 스왑)
- Fable I2: probe 0 수용→타임라인 오염(error 실패시켜야)
- Codex MED7: regroup speaker경계 무시+gap 제외 span
- Minor: abort saveBinary전 체크, 화자 배치전 선검증, capabilities 가드, maxChars 미소비, keyStore 마이그레이션(M2a-3)
- 이연(M2a-2): HIGH5 sendPush measured timing 미반영(1번과제), I3 세그먼트 status/부분재시도
- 근본: per-task mock이 실계약(스키마 id/sceneNo) 미대변 → 통합서만 드러남. audio→prompts 통합테스트 추가 필요
## fix 웨이브 진행 중 (C1→C2/I1/I2→Typecast→regroup/minor→Codex 재검증)
## fix 웨이브 완료 (4 fixer, 3898 pass)
- C1(bc16773): 세그먼트 id scenes스텝 결정론 발급(s{i}-{j})+audio fail-fast, id숨긴 mock 정정
- C2/I1/I2(363663c): finalScenes sceneNo+summary(텍스트파생) 보존, 쓰기순서 manifest→scenes, probe0→error, audio→prompts 통합테스트(실 sceneNo 병합)
- HIGH4(ba856ab): Typecast x-api-key(실계약)+format-derived 확장자. 실응답=raw WAV
- MED7+minor(00da681): regroup gap-included span+speaker경계, pre-loop voice검증, abort-before-saveBinary, capabilities 가드
- Fixer4 concern: speaker-flush 분기가 eager ≥minMs 규칙상 현재 unreachable(테스트로 락). Codex 재검증서 정합성 확인
## Status: M2a-1 완료. Codex 교차리뷰 FINDINGS: 0 (3R fix loop) + Fable whole-branch 반영. 전체 3903 pass.
- fix 2차(1c447f6): HIGH id path-traversal 패턴검증 + MED abort 각-커밋전 재체크 + LOW dead speaker분기 제거
- Codex-3 fix(732195b): pre-loop voice.voiceId non-empty 검증(낭비 TTS 방지)
- 스펙 이연 문서화: §4 세그먼트 id 승계/재그룹 speaker→v2, §8 M2a-2(sendPush measured timing 1번과제·id승계·status/부분재시도)
- BASE 26d3630 → HEAD 732195b. 머지/푸시 미실행(사용자 결정). 다음: M2a-2(정밀 push/timing) 또는 M2a-3(renderer)

## M2a-2a measured push (2026-07-04) — handoff: docs/handoffs/2026-07-04-story-m2a2-HANDOFF.md
spec: 2026-07-04-story-m2-audio-design.md §7. BASE: 732195b. 범위분할 2a(measured push)먼저.
결정 C1-a: story-api에 Typecast tts+probe 최소 주입 + 기본화자 하드배정(앱 end-to-end 검증). 화자매핑 UI는 M2a-3.
## Tasks (TDD RED→GREEN, 각 스텝 검증)
- IP1 sendPush measured timing (buildFallbackTimeline→finalScenes startSec/endSec, audio미실행시만 폴백)
- IP2 srtLineIds 수집(sub_<segId>) + srtTrack payload(wholesale, 초단위) 전송
- IP3 prompts가 manifest.pushRevision 재스탬프(현재 null→pendingPushRevision)
- C1-a story-api.js:64 createStepMachine에 tts(typecast)+probe(music-metadata) 주입 + 기본화자
## Status: 착수 — 계약 C1/C2/C3 확정(srtTrack={id,startTime,endTime,text}초, 확장테스트=stepMachine.audioPrompts.integration.test.js). RED IP1부터.
- IP1 complete: mapScene이 finalScenes startSec/endSec 우선(measured), 없으면 buildFallbackTimeline 폴백. RED(endTime 1.45 추정≠7.0 실측)→GREEN.
- IP2 complete: mapScene srtLineIds=narrationLineIds(sub_<segId>), sendPush가 buildSrtTrackPayload로 srtTrack(초) wholesale 전송(라인0면 미전송=폴백보존). RED(srtTrack undefined)→GREEN.
- IP3 complete: prompts가 pendingPushRevision++ 후 manifest.pushRevision 재스탬프(manifest 없으면 skip). RED(null 유지)→GREEN. push.pushRevision==manifest.pushRevision 확인.
- C1-a complete: typecastKey.js 신규(env→~/.typecast/credentials→에러, 동기, 4테스트) + story-api.js가 tts(Typecast)/probe(music-metadata) 주입, 테스트/커스텀 주입 우선. RED(audio 'error')→GREEN(audio 'done' via IPC).
## Status: M2a-2a IP1/2/3+C1-a 구현 완료. Codex 교차리뷰 단계.
### Codex R1: 2 findings
- High: C1-a가 tts/probe만 주입, 기본 화자 voice 하드배정 누락 → 실앱 audio 'voice not assigned' error. IPC 테스트가 speakers 수동 전달로 블로커 놓침.
- Med: IP3 abort 창 — manifest 재스탬프 후 push 전 abort면 manifest.pushRevision>lastPushed(export는 어차피 차단하나 §5 커밋전 재검사 미적용).
### fix: High=createStepMachine defaultVoice + voiceOf 폴백 + story-api Typecast Joonkyu 주입(injectable), speakers 없이 audio done 테스트. Med=manifest 재스탬프 !signal.aborted 가드 + abort 회귀테스트.
### Codex R2: 2 findings — Med(가드가 loadText 앞 → saveText 직전 재검사 필요), Med(typecastKey.js/test untracked). fix: saveText 직전 재검사 추가 + git add 스테이징.
### Codex R3: FINDINGS: 0.
## Status: M2a-2a 완료. 전체 3913 pass(신규 10), 회귀 0. 변경: stepMachine.js/story-api.js/typecastKey.js(신규)+테스트3. BASE 732195b. 머지 미실행(사용자 결정). 다음: M2a-2b(재실행 identity IP4 세그먼트 id승계/IP5 재TTS 정책·status·부분재시도).
## 이연 노트(M2a-3): StoryView UI audio 진행/트리거는 아직 없음 — 현재 audio는 backend/IPC 경로만 실행 가능(측정 push 로직·앱 배선 완료). 화자매핑 UI + audio 스텝 progression은 M2a-3.

## M2a-2b 재실행 identity + 재TTS push (2026-07-04, BASE 3377aa0)
- IP4(commit b1dffa0): inheritSegmentIds(정규화텍스트 1:1 전역) + assignSegmentIds 충돌회피. 재실행 세그먼트 id 안정.
- IP5-a: 세그먼트 status + done 재사용(resume/부분재시도) + params.regenerate 강제 재합성.
- IP5-b/c: 재TTS push 정책 — hadPrompts&&membershipUnchanged=timing-only(audio가 revision 소유+manifest 재스탬프+프롬프트 보존 push, prompts done 복원) / 변화=no-push 대기(prompts pending, manifest null, revision 불변).
### Codex R1(M2a-2b): 5 findings → HIGH1/MED2/MED3 수정, HIGH2/MED1 이연 문서화
- HIGH1(수정): timingOnly가 state(revision/prompts)를 write 전 변경 → abort 시 미커밋 revision 재발신. nextRevision 로컬화 + 커밋·미-abort 확인 후 state 변경(중간 await 없음).
- MED2(수정): reuse가 파일 실재 미확인 → 이동/삭제 시 stale/타프로젝트. basename을 현 프로젝트 segmentsDir 기준 재구성 + stat 확인.
- MED3(수정): 부분 실패 시 성공분 status 미영속 → 전체 재-TTS. 개별 실패는 errored 표시, 성공분 done·실패분 error를 원 씬구조에 영속 후 실패(재실행이 done 재사용).
- **HIGH2(이연/문서화)**: scenes 재실행 시 scenes.json이 잠정 그룹으로 덮여 audio의 prevScenes(멤버십 기준)가 잠정이 됨 → storyId 멤버십이 재-split 넘어 안정 안 됨. **선재존재(M1 assignStoryIdsByMembership)이고 재-TTS 경로(scenes 재실행 없음)엔 무영향**(scenes 재실행은 hadPrompts=false→firstRun, prompts 리셋됨=재-split은 새 identity가 맞음). 확정 멤버십 영속화(별도 아티팩트)는 설계 결정 필요 → 후속.
- **MED1(이연/문서화)**: timing-only push가 프롬프트 필드를 실어 renderer가 overlay. 현 아키텍처(main=프롬프트 원천, 동일값 멱등 재전송→stale 안 뜸)선 기능상 정확. 진짜 omit-path는 renderer 계약 변경(p.prompt 부재=무변경) 필요=M2a-3.
## Status: M2a-2b 완료. Codex 2R findings 0. 전체 3925 pass, 회귀 0. commits IP4 b1dffa0 / IP5+fixes fc9b0f5. BASE 3377aa0→HEAD fc9b0f5. 머지 미실행(사용자 결정).
## M2a-2(2a+2b) 전체 완료. 다음: M2a-3(renderer 통합) → M2a-4(export/GCF).

## M2a-3 renderer 통합 (2026-07-04, BASE fc9b0f5) — vertical slice 분해
- **M2a-3a 완료(commit b590578)**: audio를 UI 1급 스텝 — StoryStepper 클릭가능화(M2예정 제거) + PROGRESSABLE_STEPS에 audio + audio 패널(세그먼트 화자/텍스트/status) + "오디오 실행"→start('audio',{}). 기본화자 폴백으로 화자매핑 없이도 실행. dead CSS 정리. 전체 3927 pass(collateral 테스트 4개 갱신). Explore로 renderer surface 매핑 완료(StoryView presentational+pipeline prop, keyStoreMulti 미배선, listVoices 미구현, useApiKey/ApiKeyTab 패턴).
- **M2a-3b backend 완료(commit b1a885c)**: 설계결정=설정탭 키+audio패널 매핑. Typecast listVoices(정적 Joonkyu/Piljae) + registerTtsIPC(keys:set/status/delete + tts:list-voices) + main.js multiKeyStore 배선(Typecast 어댑터 키 multiKeyStore→env/creds 통일, audio 합성과 IPC 공유) + preload 브릿지(keysStatus/keysSet/keysDelete/ttsListVoices). 전체 3932 pass.
- **M2a-3b renderer 예정(다음)**: 설정 TTS 키 탭(useApiKey/ApiKeyTab mirror → useTtsKeys/TtsKeyTab, provider별) + audio 패널에 화자별 voice 드롭다운(ttsListVoices로 채움) → start('audio',{speakers:[{id,voice:{provider,voiceId}}]}). 미배정 화자 경고.
- **M2a-3c 예정**: 세그먼트/씬 미리듣기(useAudioPlayback로 seg.audioPath 재생 or tts:preview).
- **M2a-3d 예정**: re-TTS 컨트롤(세그먼트별 regenerate→start('audio',{regenerate:[id]})) + SRT/status 표시 보강. 이연분 MED1(timing-only omit-path)·HIGH2(확정멤버십) 흡수 검토.
- **M2a-3b renderer 완료(commit bda7930)**: audio 패널 화자별 voice 드롭다운(voices=App이 ttsListVoices로 로드)→start('audio',{speakers}). useTtsKeys 훅 + TtsKeyTab 설정 탭(Typecast 키) + SettingsModal 'ttsKey' 탭 + i18n(ko/en) + voice-map CSS. buildAudioParams(빈 speakers 미전달).
- **M2a-3c/3d 완료(commit 71e418e)**: audio 패널 세그먼트 행에 ▶미리듣기(useAudioPlayback→readFileAbsolute) + ↻재생성(start('audio',{regenerate:[id],speakers})).
### M2a-3 Codex 리뷰(gpt-5.5/xhigh) R1: 3 findings → 전부 수정(commit a69e75b)
- Important: 기본성우(빈옵션) 선택이 기존 voice 유지 → hasOwnProperty로 오버라이드 구분, voice:null.
- Medium: 합성 실패 사유(키 없음 등)가 generic retry로 묻힘 → errorMsgs로 사유 보존(probe=0은 generic).
- Low: tts-api null payload throw → payload||{} 정규화.
### R2: FINDINGS: 0.
## Status: M2a-3(3a~3d) 완료. Codex 2R findings 0. 전체 3946 pass, 회귀 0. commits b590578/b1a885c/bda7930/71e418e/a69e75b. UI로 대본→씬→오디오(화자선택·합성·미리듣기·재생성)→프롬프트 전 과정 가능.
## 다음: M2a-4(export/GCF) — prepareCloudRequest manifest 분기 + story_narration 전용 타입 배치(timecodeMs=startMs,trackIndex=0,vol1.0) + whisk2capcut/whisk2premiere GCF 배포(test→prod, index.suffixed.js 수정→deploy.sh) + Vrew 실측 SRT 전달. **크로스 레포 + 배포 포함**. 그다음 M2b(SFX).

## 버그픽스: 자막 타임라인 중첩 (2026-07-04, commit d60d5b2)
Untitled 프로젝트: 씬나누기→프롬프트 반복 → storyId churn → 옛 story 씬 잔류 → 옛/새 0-기준 타임라인 겹침(자막 #1/#6 t=0). fix: importStoryScenes가 story push=완전집합 취급, push에 없는 story 씬 전량 제거(수동 씬 보존, 빈 push 방어). 재현테스트. HIGH2 체감증상 renderer 차단.

## TTS 확장 (2026-07-04) — provider 4종(C) + 화자별 엔진 + 세그먼트 단건테스트
결정: C(Gemini+GoogleCloud+ElevenLabs+Polly), 화자별 엔진(voice.provider), 설정+탭 전환 둘다.
- 슬1 완료(a32e6f0): synthPreview(단건 합성·저장, 스텝/push 미변경) + story:tts-preview IPC + ttsPreview + ▶테스트 버튼.
- 슬2 backend 완료(f29b24f): 어댑터 elevenlabs/googletts/gemini(API계약 웹서치, gemini PCM→WAV) + FACTORIES + keyStoreMulti googletts + ttsFor(provider) 라우팅(단일tts 폴백) + main.js 4provider 메모이즈·키소스(gemini=genai재사용).
- 슬3 UI 완료(078cb34): StoryView 화자행 [엔진][목소리] + App 4provider voices 로드 + TtsKeyTab multi-provider. i18n.
- 남음 **Amazon Polly**: SigV4+AWS 이중크레덧(accessKey/secretKey/region). 단일키보다 복잡(구조화 저장+3필드 설정UI+SigV4). ttsFor에 그대로 꽂힘. SigV4 테스트벡터 검증 권장.
## Status: TTS 슬1~3 완료(3961 pass, 회귀0). Polly만 남음. M2a-4(export/GCF)·M2b(SFX)도 남음.

### TTS 확장 Codex 리뷰(gpt-5.5/xhigh) — Polly 드롭 후
R1: 4 findings → HIGH(voice 지문 재사용, commit d924d3f: voiceKey provider:voiceId:emotion, canReuse 일치 요구) + HIGH(preview 경쟁: previewing 플래그 직렬화+merge-before-write+start busy가드) + MED(preview assertSegmentIdsValid) 수정 / MED(GoogleTTS auth) 이연.
R2: fixes 1-3 완료 확인, MED GoogleTTS ?key= → x-goog-api-key 헤더(commit a7df50e). Med3 해소.
## Status: TTS 확장 완료(Gemini/GoogleCloud/ElevenLabs + Typecast, 화자별 엔진, 단건 테스트). Codex 2R findings 0. Polly 드롭(사용자). 전체 3964 pass. 앱 리로드 필요. 남은 M2: M2a-4(export/GCF), M2b(SFX).

## M2a-4a (app-side export 배선) 완료 (2026-07-04, BASE 8b4b389)
manifest → export 연결의 앱 측 절반. TDD RED→GREEN, Codex(gpt-5.5/xhigh) 3R findings 0. 전체 3994 pass(BASE 3964 +30).
- **IP-A1 story_narration 변환**: prepareCloudRequest에 `options.storyAudio={manifest,lastPushedRevision}` 추가. narration 세그먼트→`story_narration` audioTrack(timecodeMs=startMs, durationMs, trackIndex??0, vol은 GCF서 1.0). audioFiles+pathMap 등록. **audioPackage와 배타**(storyAudio 있으면 audioTracks/srtEntries/audioDurationSec 모두 audioPackage 무시 — Codex F2). 정합게이트: manifest.pushRevision===lastPushedRevision일 때만, 불일치/null(미ack)이면 throw로 export 차단(3 exporter 공유).
- **IP-A2 배선**: `readAudioPackage(projectPath)` 모듈함수(stepMachine.js, machine 독립—fresh session서도 IPC가 projectPath로 디스크 직접 읽기). machine.loadAudioPackage 위임. IPC `story:load-audio-package`(projectPath 검증=story:open과 동일 validateProjectPath+workFolder, 없으면 열린 machine) → preload storyLoadAudioPackage(projectPath) → useExport.loadStoryAudio(storyProjectPath, CapCut/Premiere 전용, Vrew 제외 IP-A3) → options.storyAudio. App.jsx storyProjectPath 주입.
- **capcutCloud sidecar SRT**: shouldUsePackageSrt(options) — story면 audioPackage.srtContent 무시(Codex F2 누수).
- **Codex 3라운드**: R1 F1(교차프로젝트 주입)/F2(srtEntries·duration 배타누수)/F3(손상manifest silent) → R2 F1(mismatch silent omission)/F2(capcut sidecar) → R3 F1(fresh session machine없음)/F2(경로검증) → **R4 findings 0**.
- 변경: src/exporters/{prepareCloudRequest,capcutCloud}.js, src/hooks/useExport.js, electron/story/stepMachine.js, electron/ipc/story-api.js, electron/preload.js, src/App.jsx. 신규 테스트 3파일+기존 3파일 확장.
- **미커밋**(사용자 결정 대기). **다음 M2a-4b(whisk2capcut GCF)**: index.suffixed.js:1274 audioTracks 블록에 story_narration 필터+배치 → `./deploy.sh test generateCapcutJson` → CapCut 실export 검증. 그다음 4c(whisk2premiere). **⚠️ GCF test만, prod 금지.**

## M2a-4b/4c (GCF story_narration 배치) 코드 완료 (2026-07-04, 배포 대기)
- **4b whisk2capcut**(index.suffixed.js): audioTracks 필터에 story_narration 추가 + 전용 audio 트랙 배치(sfx_timed 패턴 복제, timecodeMs*1000=start, durationMs*1000=len, vol 1.0, 0-len skip). _buildCapcutJsonPayload export(테스트훅). 통합테스트 3 pass(storyNarration.test.js). node --check OK. Codex(gpt-5.5/xhigh) findings 0. 함수명 generateCapcutJson.
- **4c whisk2premiere**(src/premiereExport.js): story_narration을 나레이션 트랙 A1(idx0)에 명시 라우팅(story는 narration/voice/sfx_timed와 배타→A1 독점) + timecodeTicks 위치 배치(기존 로직 재사용) + **0-length 세그먼트 skip(characterization으로 발견한 실버그—audioTracks 계열엔 sfx와 달리 0-len 가드 없었음)**. 통합테스트 2 pass + 기존 premiereExport 41 pass(회귀0). deploy SOURCES에 src/ 포함 확인. Codex findings 0. 함수명 generatePremiereJson.
- **미배포**: `./deploy.sh test generateCapcutJson`(whisk2capcut) + `./deploy.sh test generatePremiereJson`(whisk2premiere). ⚠️ test만, prod 금지. 배포 후 실제 CapCut/Premiere export로 오디오 위치 눈검증 필요(사용자).
- Vrew: 무변경(IP-A3, prepareCloudRequest.srtEntries 경로로 이미 배타 처리).

## M2a-4 배포 완료 (2026-07-04, test)
- generateCapcutJson_test 업데이트 성공(creator-tools-6bb8b). generatePremiereJson_test 업데이트 성공. 둘 다 test만(prod 미배포).
- **남은 검증(사용자)**: 앱에서 story 프로젝트 → audio 실행 → CapCut/Premiere export → 오디오 클립이 세그먼트 timecodeMs 위치에 배치되는지 눈으로 확인.
- **미커밋**: AutoFlowCut(feature/story-pipeline), whisk2capcut, whisk2premiere 3개 레포 전부. 사용자 커밋 결정 대기.
## Status: M2a-4(export/GCF) 코드+test배포 완료. Codex 각 findings 0. 남은 M2: M2b(SFX). 실export 눈검증은 사용자.

## M2a-4 + story audio UX(A~D) 실앱 검증 완료 (2026-07-04)
사용자 실앱 확인: 앱 audio 타임라인/실시간진행/재생성/키폴백 + GCF export(CapCut/Premiere) 전부 정상. commit ab49efc(AutoFlowCut) / 1da9f61(whisk2capcut feat/story-narration) / dc2941a7(whisk2premiere feat/story-narration). 미푸시. 다음: M2b(SFX).

## Story LLM provider options (2026-07-05)
- Codex SDK Story 엔진 추가 완료(commit e21f46c): Claude Opus 4.8/Sonnet 5 + Codex GPT-5.5/GPT-5.4 동적 catalog, ChatGPT 로그인 기반 Codex SDK adapter, runtime option strip, 전체 4182 pass + Codex(gpt-5.5/xhigh) findings 0.
- Claude AgentSDK reasoning 옵션 추가 완료(이번 작업): Claude catalog `off|low|medium|high|max`, 기본 `off`(기존 thinking disabled 보존), non-off는 SDK `thinking:{type:'adaptive'}` + `effort`로 변환. raw SDK `thinking/effort/maxThinkingTokens`는 renderer normalize와 SDK helper 양쪽에서 차단. StoryView 모델/추론 메뉴는 한 행에 배치하고 좁은 폭에서 wrap.
- Spec: docs/superpowers/specs/2026-07-05-story-claude-agent-effort.md (ignored/local). Spec review findings 0(Herschel), code review findings 0(Volta).
- TDD/검증: RED 확인 후 GREEN. Target 53 pass, Story/LLM related 176 pass, component Story 130 pass, full `npm test` 440 files / 4189 tests pass, `npm run build` pass, `git diff --check` pass.

## M2b(SFX) 착수 (2026-07-04, BASE 8c75a29)
Codex(gpt-5.5/xhigh, thread 019f2d38) 방향 리뷰 완료 — 방향 OK + 보정(M2b-0 스파이크, M2b-2+3 통합, 스키마 계약 oneOf우회, sfxKey reuse, export category/filename, api/sfx 별도). spec: docs/superpowers/specs/2026-07-04-story-m2b-sfx-design.md(gitignore, 로컬).
- **M2b-0 완료**: ElevenLabs SFX API 확정 — POST /v1/sound-generation, xi-api-key, {text,model_id:'eleven_text_to_sound_v2',duration_seconds?:0.5~30(null=자동),prompt_influence,loop}, query output_format, resp mp3 octet-stream. duration 요청 가능.
- **M2b-1 완료(commit 6251e23)**: electron/api/sfx/ (elevenlabs 생성 어댑터 + library stub + createSfxAdapter 라우팅). TTS 패턴 재사용, 별도 모듈. getKey/fetch 주입 TDD 6 pass.
- **다음 M2b-2+3(통합 slice)**: schemas.js SCENES_SCHEMA에 sfx 세그먼트(type/description, speaker/text loose + post-validation) + prompts.js splitScenes 프롬프트 sfx 큐 추출 + stepMachine audio 스텝이 sfx도 생성(sfxFor 주입, sfxKey=source:description:durationHint reuse, ID검증 sfx포함) + buildSegmentTimeline sfx 배치(이미 all seg) + manifest sfx + main.js sfxFor 배선. **분리만 단독 금지**(sfx가 생성 전 나오면 durationMs=0 timing 붕괴). 그다음 M2b-4(export sfx_timed) → M2b-5(UI).
## 버그픽스(commit 8c75a29): prompts done '다시/닫기'(redoStep audio/prompts 일반화) + 스텝퍼 active=displayStep(클릭 탭 반영). 4024 pass.

## M2b 백엔드 완성 (2026-07-04)
- M2b-1(6251e23) 어댑터 / M2b-3(d3029af) audio sfx 생성+배선 / M2b-4 export sfx_timed. SFX end-to-end 백엔드: sfx 세그먼트 → sfxFor 생성 → manifest → prepareCloudRequest sfx_timed. 전체 4033 pass.
- **남음**: M2b-2(LLM 자동 추출 — schemas.js SCENES_SCHEMA sfx 계약[Claude validator oneOf 미지원→loose+post-validation] + prompts.js splitScenes 프롬프트 sfx 큐) / M2b-5(UI — StoryView sfx 행 + buildStoryAudioPackage sfx[현재 narration만] + 소스 선택). 현재는 sfx 세그먼트 수동 주입 시 동작.

## M2b-2 + M2b-5 완료 (2026-07-04, BASE bb7f75e)
LLM sfx 자동추출 + UI. TDD RED→GREEN, Codex(gpt-5.5/xhigh) 2R findings 0. 전체 4063 pass(BASE 4033 +30, 회귀0).
- **M2b-2a** schemas.js: SCENES_SCHEMA segments를 loose(speaker/text required 제거, type/description 추가) + `validateScenesSegments` export(narration=speaker+text, sfx=description, unknown type throw). Claude validator oneOf 미지원 우회.
- **M2b-2b** splitScenes(llmClaude+llmGemini) 반환 후 validateScenesSegments post-validation 호출.
- **M2b-2c** prompts.js buildSplitPrompt: 효과음 큐 → `{type:'sfx',description:영어묘사}` 세그먼트 삽입 지시(세그먼트 단위, 절제).
- **M2b-2d** stepMachine assertSegmentIdsValid: narration만→오디오보유(narration+sfx) 전부 검사(sfx도 audio/segments/${id} 파일명 사용, path traversal 방어).
- **M2b-5a** storyAudioPackage: buildStoryAudioPackage가 sfx→pkg.sfx[{category:'story',files}], withStoryAudio가 sfx도 합류(narration 없이 sfx만 있어도).
- **M2b-5b** StoryView: audio 테이블 sfx 행(description 표시 + 소스 드롭다운 elevenlabs/library[stub]). sourceMode 스레딩: buildAudioParams가 params.sfxSources 전달 → stepMachine audio가 `params.sfxSources[id]||seg.sourceMode||'elevenlabs'`로 resolve(생성+sfxKey+영속). IPC story:start params 통째 통과(무변경).
- **Codex R1**: Med(stale sfx override가 재사용 id에 샘) → override를 {source,desc}로 저장, description 일치할 때만 적용 + buildAudioParams가 현재 scenes sfx만 순회. Low(sfx-only story 타임라인 숨김) → hasStoryAudio에 sfx 포함. **R2 findings 0**.
- 변경: electron/api/llm/{schemas,llmClaude,llmGemini,prompts}.js, electron/story/stepMachine.js, src/utils/storyAudioPackage.js, src/components/story/StoryView.{jsx,css}. 신규 테스트: schemas.test.js, StoryView.sfx.test.jsx + 기존 4파일 확장.
- **미커밋**(사용자 결정 대기). GCF 변경 없음(sfx_timed 기존 처리). 실LLM sfx 추출 품질·실ElevenLabs sfx 생성은 실호출 눈검증 필요(사용자, 비용발생).
## Status: M2b(SFX) 전체 완료 — 백엔드(M2b-0~4)+LLM추출(M2b-2)+UI(M2b-5). Codex findings 0. 남은: 실앱 눈검증(사용자).

## M3 대본 검토 루프 완료 (2026-07-05, BASE b8aa011)
Claude 품질 경로의 남은 actionable 작업. brainstorm→spec(Codex 3R findings 0, 로컬)→TDD 5슬라이스. 전체 4104 pass(+38, 회귀0). commit 82848bd.
- **M3-1** schemas.REVIEW_SCHEMA + prompts.buildReviewPrompt(내장 루브릭: 훅/구조/페이싱/일관성/화자/결말 + 장르 metaPrompt)/buildRevisePrompt.
- **M3-2/3** llmClaude·llmGemini reviewScript({verdict:pass/revise,critique}, non-pass→pass 정규화) + reviseScript(NON-streaming 전체 재작성). Gemini reviseScript=plain generateContent(SSE 아님).
- **M3-4** stepMachine: script 생성 경로 뒤 검토 루프. `reviewRounds(opts.model||state.engine?.model)`=claude 3/그 외 1(effective model — state.engine엔 model 없음). 루프만 try/catch→실패해도 마지막 저장본 유지+스텝 done+progress error(품질옵션이 본생성 안깸). abort 라운드사이 조용히 중단. pasted/continue early-return이라 제외. **빈 수정본 저장 거부(Codex-High: Gemini safety block/빈응답, Claude 빈result → draft 빈대본 덮어쓰기 방지)**.
- **M3-5** useStoryPipeline reviewProgress{operationId,round,of,phase,error}(operationId 필터, start/terminal story:state/프로젝트전환 시 정리, **error phase는 terminal에도 유지**). StoryView setup 토글(기본 off, currentOptions/handlePrimaryAction에 reviewLoop 스레딩) + "검토 중/수정 중 N/M"·"검토 중단" 배지(non-streaming이라 진행 신호 필수).
- **Codex(gpt-5.5/xhigh) R1**: High(빈 수정본이 draft 덮어씀) → 저장 전 `!r.scriptMd.trim()` throw(루프 catch가 원본 보존). **R2 findings 0**.
- **M3 남은 것(코드 아님)**: 정책 시행 확인/feature flag = 릴리스 시점 게이트(Anthropic 구독 크레딧 정책 의존). 실LLM 검토 품질은 실호출 눈검증(사용자).
## Status: M3(대본 검토 루프) 완료. Claude 어댑터+모델선택+구독로그인은 기존 완료 → M3 actionable 전부 done. 남은 V2 후보: 캐릭터 레퍼런스 자동생성(외형 일관성)/화자별 분리 오디오 트랙/BGM.

## V2-B export fallback 버그픽스 (2026-07-06)
사용자 실export 확인: 프리뷰 타임라인은 펼치면 화자별 분리로 보이나 CapCut/Premiere 결과는 단일 narration 트랙처럼 보임. 조사 결과 GCF는 이미 `trackIndex`별 배치 처리 중이고, 앱 export payload가 legacy/stale manifest(`trackIndex` 없음)를 `0`으로 폴백해 납작하게 보내는 경로가 원인.
- fix: `src/utils/storyNarrationTracks.js` 신규 공유 유틸. `electron/story/manifest.js`와 `src/exporters/prepareCloudRequest.js`가 동일한 narrator/speaker track 규칙 사용.
- export fallback: manifest segment에 명시 `trackIndex`가 있으면 보존, 없으면 speaker 기준으로 재계산. mixed explicit/missing manifest는 2-pass로 같은 speaker의 명시 trackIndex를 재사용하고, 새 speaker는 기존 명시 trackIndex와 충돌하지 않는 번호를 할당.
- TDD: legacy all-missing `[0,1,0,1,2]` RED→GREEN, mixed explicit/missing `[2,1,2,3,1,0]` RED→GREEN.
- 검증: target 13 pass, 관련 71 pass, 전체 `npm test` 444 files / 4266 tests pass, `npm run build` pass, `git diff --check` clean.
- Codex subagent review(gpt-5.5/xhigh): R1 Important 1(mixed explicit/missing 불일치) → 수정 후 R2 findings 0.
- GCF 변경/배포 없음: payload 계약은 동일하고 GCF는 이미 `trackIndex`를 소비함. 다음 사용자 검증은 기존 프로젝트에서 재export만 필요(씬나누기부터 재실행 불필요).

### V2-B export fallback 후속 (2026-07-06)
사용자 재검증: CapCut/Premiere 모두 나레이터와 서준이 여전히 같은 트랙. 최신 CapCut draft 1302 확인 결과 story narration 파일(`s1-1.mp3`~`s7-1.mp3`)은 단일 audio track, `s6-2.mp3`만 별도 track(SFX) — storyAudio는 실렸으나 narration `trackIndex`가 모두 0으로 들어간 정황.
- root cause: 기존 manifest가 `trackIndex` 필드를 아예 생략한 게 아니라 non-narrator까지 `trackIndex:0`을 명시한 legacy 형태일 수 있음. 이전 fix는 `seg.trackIndex ?? fallback`이라 explicit 0을 그대로 보존해 fallback이 안 탐.
- fix: non-narrator의 `trackIndex<=0`/non-integer는 legacy/invalid로 보고 speaker fallback 사용. narrator/empty speaker는 항상 track 0. positive explicit non-narrator만 보존·예약.
- TDD: all-zero legacy manifest `[0,0,0,0,0]` → `[0,1,0,1,2]` RED→GREEN. narrator positive malformed reservation `[0,2]` → `[0,1]` RED→GREEN.
- 검증: target 15 pass, 관련 73 pass, 전체 `npm test` 444 files / 4268 tests pass, `npm run build` pass, `git diff --check` clean.
- Codex subagent review(gpt-5.5/xhigh): R1 Minor 1(narrator positive 예약) → 수정 후 R2 findings 0.
- GCF 변경/배포 없음. 기존 프로젝트는 오디오/씬 재실행 없이 앱 코드 갱신 후 재export만 필요.

## V2-A 캐릭터 레퍼런스 자동 등록 완료 (2026-07-05, BASE b8aa011)
스토리 캐릭터를 기존 Ref 탭 conditioning에 다리놓기(새 이미지 API 없음). brainstorm→spec(Codex 5R findings 0)→TDD 6슬라이스→Codex code 4R findings 0. 전체 4124 pass(+21, 회귀0). commit db96633.
- 발견: 일반플로우는 이미 getMatchingReferences→inline base64→gemini-2.5-flash-image로 캐릭터 conditioning함. 스토리만 characters:''로 와서 안 탐. → speaker appearance→character 카드 등록 + 씬 characters 태그가 갭.
- A1 schemas speakers.appearance(optional) + prompts buildSplitPrompt appearance지시/buildPromptsPrompt appearance컨텍스트. A2 splitScenes passthrough. A3 stepMachine: 병합 appearance승계(voice미러) + mapScene seg.speaker(id)→speaker.name characters태그(non-narrator·appearance보유) + sendPush storyCharacters + writePrompts에 characterSpeakers(). A4 useScenes characters 보존(normalizeScene ...s spread라 코드무변경, 테스트고정). A5 src/utils/storyCharacterRefs.js upsertStoryCharacterRefs(type-aware, numeric id max+1, 동명character 보존, 동명 비-character collision). A6 useProjectData saveCurrentProjectWithPayload references override + App onPushScenes 브리지.
- Codex code R1: High(refs push 트랜잭션 저장 — saveCurrentProjectWithPayload references)/High(seg.speaker id→name)/High-Med(동명 type 충돌) + Low(narrator appearance 누수→characterSpeakers). R2: High(push 미직렬화 stale refs→referencesRef 동기 + pushQueueRef 직렬화)/Low. R3: High(직렬화가 만든 새 이슈 — 큐 대기 push가 프로젝트 전환 후 실행→dequeue시 storyProjectPathRef 가드). R4(가드 return→throw로 ok:false ack, revision 오advance 방지) findings 0.
- **사용자 흐름**: 스토리 대본→씬→프롬프트 push되면 Ref 탭에 character 카드(pending) 자동 등록 + 씬 characters 태그. 사용자가 [레퍼런스 생성](Flow/API)→[씬 생성]하면 캐릭터 conditioning. 실이미지 일관성은 실호출 눈검증(사용자).
- **미검증(사용자)**: 실앱에서 실제 대본으로 카드 등록·일관성 눈검증. GCF 무변경.
## Status: V2-A(캐릭터 레퍼런스) 완료. 남은 V2 후보: V2-B 화자별 분리 오디오 트랙(크로스레포 GCF), V2-C BGM 생성/선곡.

## Story Codex SDK LLM 엔진 추가 완료 (2026-07-05, BASE c6009be 계열)
요청 범위: 기존 Claude AgentSDK 경로 유지 + Codex SDK를 Story 생성 엔진으로 추가. V2-B/V2-C 본작업 전 추가 옵션 작업. brainstorm→spec/plan(로컬 gitignore)→Codex 방향리뷰 3R findings 0→TDD slices→Codex 코드리뷰 loop findings 0.
- **동적 모델 카탈로그**: `story:list-llm-options` IPC + preload + `useStoryPipeline`으로 StoryView가 모델 4개를 동적으로 렌더. 초기 옵션: Claude Opus 4.8(default), Claude Sonnet 5, Codex GPT-5.5, Codex GPT-5.4. Codex 선택 시 reasoning effort(minimal/low/medium/high/xhigh) 표시·전달.
- **Claude/Codex 공존 라우팅**: `storyLlmRouter`가 `engine:'codex'`는 `llmCodex`, 그 외/legacy는 Claude로 dispatch. stepMachine은 script/paste/continue/scenes/prompts/title/review/revise 경로에서 options 정규화.
- **Codex SDK 어댑터**: `@openai/codex-sdk` 추가 + `llmCodex`가 기존 Story LLM public signature(generateScript/splitScenes/writePrompts/generateTitle/continueScript/review/revise)를 구현. structured output은 `outputSchema`로 요청하고 기존 schemas 검증 재사용.
- **구독 로그인 정책**: OpenAI API key UI 없음. native Codex binary `login status` preflight로 ChatGPT login만 허용. `OPENAI_API_KEY`/`CODEX_API_KEY`/토큰 env는 SDK env allowlist에서 제외. 누락 시 "codex login → Sign in with ChatGPT" 안내 에러.
- **보안 보강(리뷰 반영)**: 임시 `CODEX_HOME`에는 `auth.json`만 복사(config/hooks/mcp 미복사), `forced_login_method:'chatgpt'`, approval never/read-only/network off/webSearch off. `include_permissions_instructions=false`, `include_environment_context=false`, `skills.include_instructions=false` 등으로 Codex prompt surface 축소(실제 `codex debug prompt-input`에서 user prompt만 확인). private temp working dir(`autoflowcut-story-codex-*`)에 non-empty model instructions 파일 생성 후 cleanup. renderer/persisted Story options에서 workingDirectory/sandbox/network/env/config/apiKey 등 SDK 제어 필드 제거, Codex runner에는 `{model, reasoningEffort}`만 전달.
- **리뷰 루프**: code R1 4 findings(auth/timeout/env/tool risk) 수정 → R2 2 findings(native binary/cleanup) 수정 → R3 2 findings(prompt/tool surface, copy-fail cleanup) 수정 → R4 2 findings(empty model_instructions_file, skills/permissions prompt surface) 수정 → R5 1 finding(workingDirectory injection) 수정 → R6 `findings: 0`.
- **검증**: targeted 61 files / 448 tests pass. 전체 `npm test`: 440 files / 4182 tests pass. `npm run build` pass. `git diff --check` pass. 실앱에서 Story 버튼→StoryView 선택 UI 및 실제 Codex 호출은 미수동검증(비용/로그인 세션 의존).
- **상태**: 구현 완료, 미커밋/미푸시(사용자 OK 대기). GCF 배포 없음. 다음 후보는 원래 핸드오프대로 V2-B(화자별 분리 오디오 트랙, 크로스레포 GCF test 배포 포함) 또는 V2-C(BGM 생성/선곡).

## M3 확장: 씬/프롬프트 검수 컨트롤 완료 (2026-07-05)
요청 범위: M3 대본 검토 루프를 각 탭(대본/씬 분리/프롬프트)에 일관되게 확장하고, 검수 횟수 조정·수동 검수·localization·하단 액션 배치를 정리. brainstorm→spec/plan(로컬 gitignore)→Subagent spec review findings 0→TDD RED→GREEN slices→Subagent code review loop findings 0.
- **LLM/프롬프트**: script review rubric을 장르별 metaPrompt 기준에서 몰입도(궁금증/기대감/페이싱/명확성/보상감) 중심으로 전환. review prompt에는 genre metaPrompt를 넣지 않음. Claude/Codex/Gemini adapter와 router에 scenes/prompts review/revise 추가.
- **StepMachine**: explicit `review.{script,scenes,prompts}.{enabled,rounds}` 지원. legacy `reviewLoop`는 explicit review가 없을 때만 script-only로 보존. `reviewOnly` manual path는 변경 없음이면 downstream/pushRevision/manifest를 건드리지 않고, 변경 때만 해당 downstream을 reset/push. scenes review는 speaker voice 보존+appearance update, schema-only no-change가 prompt/audio 필드를 잃지 않게 canonical 비교.
- **Renderer**: setup에 단계별 자동 검수+횟수 입력. 대본 editor는 기존처럼 하단 editor 버튼 줄에 수동 검수. 씬/프롬프트 수동 검수는 사용자 피드백 반영해 결과 테이블 내부가 아니라 대본 탭과 동일하게 공통 하단 버튼 줄(`story-controls`)에서 기존 액션 버튼 옆에 표시. 버튼/number input 높이 정렬, 글자 세로 줄바꿈 방지.
- **Localization**: `src/locales/ko.js`/`en.js`에 `story.*` 키 추가. 검수 visible label/aria label, step/status/action/form/scenes/audio/prompts/error 주요 문구가 I18nProvider 언어 전환을 따름. provider 없는 단위 테스트는 한국어 fallback 유지.
- **리뷰 루프**: Dewey→Kepler→McClintock→Ptolemy→Carver 리뷰에서 발견된 reset/no-change/speaker fallback/prompts path/UI placement 이슈 수정. 최종 Carver(gpt-5.5/xhigh) 재리뷰 `findings: 0`.
- **검증**: RED 확인 후 GREEN. Targeted Story/LLM/step tests 25 files / 246 tests pass. Full `npm run test:run`: 441 files / 4220 tests pass. `npm run build` pass. `git diff --check` pass. GCF 배포 없음.
- **상태**: 구현 완료, 커밋 예정. 다음 후보는 여전히 V2-B(화자별 분리 오디오 트랙, 크로스레포 GCF test 배포 포함) 또는 V2-C(BGM 생성/선곡).

## V2-B 화자별 분리 오디오 트랙 완료 (2026-07-06)
요청 범위: story narration을 화자별 오디오 트랙으로 분리하고, story SFX가 speaker track과 충돌하지 않게 CapCut/Premiere GCF test 함수까지 배포. V2-C(BGM)는 사용자 결정으로 제외. spec: docs/superpowers/specs/2026-07-06-story-v2b-speaker-audio-tracks.md(ignored/local), plan: docs/superpowers/plans/2026-07-06-story-v2b-speaker-audio-tracks-plan.md(ignored/local).
- **설계/리뷰**: brainstorming 후 spec 작성. Subagent 방향 리뷰 R1 4건(story SFX 충돌/고트랙 Premiere/GCF 0-1-2-1/V2-A·Vrew 회귀) → R2 2건(A7 SFX/strict sanitize) → R3 findings 0.
- **App**: `buildManifest`가 narration speaker를 정규화해 narrator/empty/narration 계열은 `trackIndex:0`, non-narrator는 등장순 `1+`로 배정하고 동일 화자 재사용. 미등록 non-empty speaker도 독립 화자. `prepareCloudRequest`는 manifest의 `trackIndex`를 `story_narration`에 보존.
- **CapCut GCF**: `index.suffixed.js`가 `story_narration`을 strict numeric `trackIndex`별 audio track으로 분리. invalid/missing/fractional/string/boolean/negative는 0. `category:'story'` SFX는 story narration tracks 뒤 별도 track, non-story SFX legacy 유지.
- **Premiere GCF**: `story_narration`을 A1/A2/A3...로 라우팅. A4+는 AudioClipTrack shell 생성 + AudioTrackGroup `<Tracks>` 등록 + AudioTrackInlet `<Sources>` 등록 + `NextTrackID` bump. story SFX는 max story narration track 뒤(A7 케이스 포함), legacy voice/non-story SFX는 A2 유지.
- **Codex code review(gpt-5.5/xhigh)**: R1 2건(P1 Premiere A4+ group/inlet 미등록, P2 coercive sanitize) 수정 → R2 findings 0.
- **검증**: AutoFlowCut targeted 18 pass, V2-A/Vrew regression 34 pass, full `npm test` 441 files / 4246 tests pass, `npm run build` pass, `git diff --check` pass. CapCut GCF `storyNarration.test.js` 6 pass, `node --check index.suffixed.js`, `git diff --check` pass(전체 `npm test`는 기존 test/prod 복사본 discovery 노이즈로 신뢰 제외). Premiere GCF full 9 files / 105 tests pass, `node --check src/premiereExport.js`, `git diff --check` pass.
- **배포(test only)**: `./deploy.sh test generateCapcutJson` 성공 → `generateCapcutJson_test(us-central1)` 업데이트. `./deploy.sh test generatePremiereJson` 성공 → `generatePremiereJson_test(us-central1)` 업데이트. prod 미배포.
- **상태**: V2-B 완료. 3개 레포 모두 미커밋/미푸시(사용자 OK 대기). 남은 사용자 검증: 실제 Story 프로젝트 export 후 CapCut/Premiere에서 화자별 트랙 분리와 story SFX 위치 눈검증.

## Flow 인증 UI/문구 핫픽스 (2026-07-06)
사용자 실앱 검증 중 Flow 모드 auth failure가 "설정에서 API 키"로 안내되고 헤더 unauth 버튼이 API 키로 보이는 문제 수정. `~/workspace/touchizen/AutoFlowCut.old`의 Flow login wording 확인 후 current app에 mode-aware auth message helper 추가.
- **수정**: Header unauth 버튼은 Flow=`로그인`, API=`API 키`. authenticated badge도 Flow=`Flow 로그인됨`, API=`API 키 설정됨`.
- **수정**: App/useAutomation/useVideoAutomation/useReferenceGeneration/useSceneGeneration/useStyleThumbnails auth failure/no-token fallback을 mode-aware helper로 통일. Flow는 "Flow에 로그인", API는 "API 키 확인" 안내. App tag-validation Proceed/video retry 같은 우회 경로도 Flow toast 처리.
- **수정**: QuotaExhaustedModalProvider의 `useI18n` provider 크래시를 `useOptionalI18n()` non-throwing hook으로 수정(HMR/단독렌더 안전).
- **수정**: `errorKind:'auth'` 표시 시 mode-specific free-form error가 있으면 static locale auth message보다 우선 표시. static auth locale은 현재 모드 인증 상태 확인으로 generic화.
- **리뷰 루프**: Subagent(gpt-5.5/xhigh) R1/R2/R3 findings 반영 → R4 `FINDINGS: 0`.
- **검증**: targeted auth/Quota 15 files / 76 tests pass, full `npm test` 444 files / 4262 tests pass, `npm run build` pass, `git diff --check` pass.
- **상태**: 미커밋. V2-B 변경과 함께 working tree에 남아 있음.

## Story timeline hydration 핫픽스 (2026-07-06)
사용자 실앱 검증 중 앱 재시작 후 일반 타임라인의 story audio/SFX가 사라지고, Story 화면을 한번 열었다 닫으면 다시 보이는 증상 조사.
- **원인**: 일반 타임라인은 `withStoryAudio(audioPackage, storyPipeline.scenes)`로 story audio/SFX를 합류시키는데, `storyPipeline.scenes`는 `storyPipeline.open()` 이후에만 hydrate된다. 기존 `useStoryAutoOpen`은 `activeView === 'story'`에서만 open해서, 앱 재시작 직후 일반 뷰에서는 디스크의 story scenes가 renderer state에 올라오지 않았다.
- **수정**: `storyProjectPath`가 있으면 Story 화면 진입 여부와 무관하게 `useStoryAutoOpen`이 한 번 open한다. 같은 path rerender/view switch는 ref로 dedupe하고, projectPath 변경은 reopen한다.
- **리뷰 반영**: `/A -> null -> /A`에서 ref가 유지돼 재hydrate가 스킵될 수 있는 구멍을 subagent가 지적. `projectPath`가 null이면 `openedPathRef`를 reset하도록 수정하고 회귀 테스트 추가. `useStoryPipeline` stale comment 정리.
- **TDD/검증**: RED(`/A -> null -> /A` expected 2 got 1) 확인 후 GREEN. Target `useStoryAutoOpen` 6 pass, 관련 5 files / 67 tests pass, full `npm test` 444 files / 4269 tests pass, `npm run build` pass, `git diff --check` clean.
- **리뷰 루프**: Subagent(gpt-5.5/xhigh) R1 Important 1 + Minor 1 → 수정 후 R2 `Findings: 0`.
- **상태**: 미커밋. GCF 변경 없음.

## AudioTimeline 오디오 더블클릭 단독 재생 핫픽스 (2026-07-06)
사용자 요청: 타임라인 오디오 클립을 더블클릭하면 전체 타임라인이 아니라 해당 클립 파일만 즉시 재생.
- **원인**: 기존 타임라인 클립에는 더블클릭 경로가 없고, 오디오 단일 클릭이 즉시 상세 선택/modal을 열어 두 번째 클릭을 가로챌 수 있었다. 펼친 파일 행 mini-clip도 동일하게 단일 선택만 처리했다.
- **수정**: 오디오 클립/mini-clip은 단일 클릭을 500ms 지연해 더블클릭과 분기. 더블클릭은 pending 단일 클릭을 취소하고 `stopAll()`→`jumpToClip()`→기존 `startClipAt(..., {ignoreMute:true})`로 해당 파일만 시작점부터 재생. 일반 전체 재생의 mute 동작은 기존대로 유지. 비오디오 더블클릭은 오디오 preview를 시작하지 않음.
- **리뷰 반영**: action button dblclick 버블 차단, slow double-click modal 선오픈 방지, `playbackSessionRef`로 stale async `readFileAbsolute` 무시. R2에서 click→drag pending modal 취소, mini-clip pointer/native dblclick 중복 dedupe, initial dedupe `-Infinity` 보정.
- **TDD/검증**: main clip RED 확인 후 GREEN, mini-clip RED 확인 후 GREEN. 리뷰 회귀 RED(flag dblclick/slow dblclick/stale async/click→drag/mini duplicate) 확인 후 GREEN. Target `AudioTimeline` 58 pass, 관련 6 files / 102 tests pass, full `npm test` 444 files / 4277 tests pass, `npm run build` pass, `git diff --check` clean.
- **리뷰 루프**: Subagent(gpt-5.5/xhigh) R1 3건, R2 2건 수정 → R3 `Findings: 0`.
- **상태**: 미커밋. GCF 변경 없음.

## Story Codex structured schema 핫픽스 (2026-07-06)
사용자 실앱 검증 중 Story에서 Codex 선택 후 씬분리 시 OpenAI `invalid_json_schema`: `additionalProperties` must be supplied and false.
- **원인**: `llmCodex`가 Codex SDK `outputSchema`에 기존 Gemini/Claude용 `toJsonSchema()` 결과를 그대로 전달했다. OpenAI/Codex structured output은 object마다 `additionalProperties:false`가 필요하고, strict schema에서는 optional field를 required+nullable로 표현해야 하는데 기존 변환에는 이 처리가 없었다.
- **수정**: 기본 `toJsonSchema()`는 Claude/Gemini 호환을 위해 유지. Codex 전용 `toOpenAiJsonSchema()`를 추가해 모든 object에 `additionalProperties:false`, 전체 property `required`, 기존 optional property nullable 변환을 재귀 적용. `llmCodex`의 split/revise/review/prompts JSON 경로는 strict 변환기 사용.
- **추가 원인(사용자 재검증)**: schema 에러 해결 뒤 SFX/캐릭터 ref/narrator가 빠져 보이는 증상은 원 프롬프트 변경이 아니라 Codex strict JSON의 optional→nullable 출력과 앱 보정 비대칭 때문이었다. Codex가 `description/speaker/text/emotion`을 `null`로 채우는 동안 SFX/appearance 지시가 약했고, `appearance:null` non-narrator는 V2-A ref 필터에서 빠졌다. 또 최초 scenes 경로는 `segments[].speaker`에 있는 narrator가 `speakers` 목록에서 빠져도 보정하지 않아 오디오 탭에 narrator가 안 보였다(review 경로에만 보정 존재).
- **추가 수정**: Codex scenes/revise scenes prompt에 strict JSON 규칙(type별 nullable 필드, SFX description, non-narrator appearance 필수)을 명시. `llmCodex`가 non-narrator narration speaker의 missing/empty appearance를 실패시켜 캐릭터 ref 누락을 조기 차단하고, narrator 별칭 판정은 story narration track 유틸과 공유. `stepMachine` 최초 scenes 경로도 참조 speaker 보정을 적용해 narrator/누락 speaker를 state.speakers에 합성·보존.
- **TDD/검증**: RED(2 files / 3 failures: strict 변환기 없음, Codex schema missing `additionalProperties`) 확인 후 GREEN. 추가 RED: non-narrator appearance 누락, narrator 별칭 appearance 오판, 최초 scenes narrator 누락 보정. 리뷰 반영 RED: narrator 별칭 segment의 batch audio/synthPreview voice lookup, reviseScenes 수정 JSON의 speakers 누락+기존 fallback appearance. Target Codex/Story related 8 files / 93 pass, full `npm test` 444 files / 4285 tests pass, `npm run build` pass, `git diff --check` clean.
- **리뷰 루프**: Subagent(gpt-5.5/xhigh) R1 2건(narrator 별칭 voice lookup, reviseScenes fallback speakers 누락) 수정 → R2 `Findings: 0`.
- **상태**: 미커밋. GCF 변경 없음. 사용자 재검증: Story Codex 선택 후 씬분리 → 오디오 탭 narrator 표시, SFX segment, 캐릭터 ref 카드 주입 확인.


---

# Voice Picker — SDD progress ledger
Plan: docs/superpowers/plans/2026-07-06-voice-picker.md
Spec: docs/superpowers/specs/2026-07-06-voice-picker-design.md
BASE commit (before Task 1): b9b62a5
Branch: feature/story-pipeline

## Tasks
Task 1: complete (commit 69201c2, 4/4 pass, F0 gender pure fn)
Task 2: complete (commit 0e6c82b, 4/4 pass, genderOverlay pure fn)
Task 3: complete (commit e848a9f, 3/3 pass, voiceGenderCache)
Task 4: complete (commit 21a7ac2, 8/8 pass, Typecast live listVoices; note: storyPipelineM1.test.js pre-existing failure unrelated)
Task 5: complete (commit a7df5cb, 44 tests pass, Gemini/EL structured gender)
SLICE 1 complete (b9b62a5..a7df5cb) — Codex review pending
NOTE: real base for slice1 is 7d77a0d (user commit "Improve story scene split" on top of b9b62a5). Slice1 pure diff = 7d77a0d..a7df5cb (13 files).
SLICE 1 Codex review: Important x4 + Minor x1 (typecast key-throw, EL seed gender, cache non-object degrade, cache manual>f0, F0 rounding boundary) — dispatching fix
SLICE 1 fix: commit edabd9c (22/22 covering + 224 regression). Re-review pending.
SLICE 1 CLEAN (7d77a0d..edabd9c, Codex findings 0). Next: review user commit 7d77a0d per request, then slice2.
User commit 7d77a0d review: Codex found 2 real bugs (narrator alias in char candidates, refs snapshot race). Fixed in 10e6cb9 (TDD; bug#2 full regression, bug#1 mechanism test + 1-line fix). Verifying.
Codex found regression in bug#2 fix (isNarratorTrackSpeaker(empty)=true excludes real speakers). Fixed 2fc3930 (empty-guard, 12/12 + 170 story tests pass). Verifying.
2fc3930: Codex Minor only (whitespace-only speaker → blank card) — DEFERRED to final review (ledger). 7d77a0d review DONE: Important x2 fixed (10e6cb9), regression fixed (2fc3930), Minor x1 deferred.

## SLICE 2 (preview service)
Task 6: complete (commit e899545, 4 pass, ssrfSafeFetch)
Task 7: complete (commit 361ec6a, 3/3, voicePreviewService; concern: dedupe key uses raw language — note for review)
Task 8: complete (commit 806c471, 10/10 + 862 pass, preview/tag IPC + main overlay wiring)
SLICE 2 complete (2fc3930..806c471) — Codex review pending
SLICE 2 Codex review: Important x3 (ssrf byte-cap post-buffer, redirect unbounded, MIME wav-mislabel) + Minor x2 (tag voiceId unvalidated, voiceMetaCache unbounded). dedupe-language concern: benign (IPC normalizes). Dispatching fix.
SLICE 2 fix: commit d8b99db (22/22 + 869 pass). Re-review pending.
SLICE 2 followup fix: commit 93e7193 (14/14 + 872 pass). Re-verify.
SLICE 2 CLEAN (f7e42d2 meta-cache clear-before-fill; SSRF 1&3 verified). Final whole-branch review will re-cover.

## SLICE 3 (renderer hook + VoicePicker)
Task 9: complete (commit 22ab906, hook test pass, useVoicePreview)
Task 10: complete (commit 0964e3a, 3/3 + 162 pass, VoicePicker component; concern: footer onClose/confirm semantics → resolve in Task 11)
SLICE 3 complete (f7e42d2..0964e3a) — Codex review pending
SLICE 3 Codex: Important x2 (resource cleanup, play-reject infinite loading) + Minor x2 (unawaited tag, default confirm). Fixed 2bcc346 (8/8 + 1153 pass). Re-verify.
SLICE 3 followup: Codex Important (unmount seq not invalidated). Fixed 1dd045f (5 pass + new seq-invalidation test). Re-verify (check [cleanup] deps re-run).
SLICE 3 CLEAN (1dd045f; cleanup useCallback([]) stable, seq invalidation verified). findings 0.

## SLICE 4 (StoryView+App integration)
Task 11: complete (commit fbfd0bd, 163 pass, StoryView modal + App gender sync). SLICE 4 complete (1dd045f..fbfd0bd) — Codex review pending.
CONCERN: ElevenLabs remote live-search (onVoiceSearch, shared-voices fetch beyond loaded) dropped — VoicePicker client-filter only. Plumbing left intact. → final-review/user decision.
SLICE 4 Codex: Important (manual gender flipped by later F0 preview in renderer) + Minor (ElevenLabs remote search dead-wired). Fixing Important; Minor DEFERRED (feature regression → user decision: remove vs rewire).
SLICE 4 fix: commit 1de08eb (6/6 + 1155 pass; useVoicePreview skips manual F0 + App guard). Re-verify.
SLICE 4 CLEAN (1de08eb; manual F0 skip + App guard verified). findings 0.

## SLICE 5 (finalize: regression + i18n + EL doc)
Task 12: complete (commit c3167c9, EL voices_read hint + i18n complete). Full suite exit 0.
SLICE 5 complete.
storyPipelineM1 failure ROOT CAUSE: 7d77a0d widened characterSpeakers (appearance-optional) for Ref pending cards, but the SAME fn feeds @mention injection (sceneCharacterNames→withMentions), so appearance-less chars (김첨지) leak @mention into prompt. User confirmed: @mention should be appearance-only. Fix: filter sceneCharacterNames to appearance-present chars; keep Ref-card registration wide.
M1 fix: commit 3a41971 (@mention appearance-only). FULL SUITE GREEN: 4374 pass, 0 fail. 7d77a0d review total: 3 bugs fixed (narrator alias 10e6cb9, empty-guard 2fc3930, @mention leak 3a41971).

## FINAL whole-branch review
FINAL correctness review: Important (hidden saved-voice shown as default → wrong paid audio) + Minor x2 (manual race, preview state key voiceId-only). Deferred 2 = acceptable. Now running structure/duplication/error-handling review per user.
STRUCTURE review: 10 findings. TRIAGE — NOW: correctness merge-blocker (hidden saved voice), races (manual, preview key), dedup (voiceKey helper, confidence type, dead onVoiceSearch, test spy, whitespace trim). DEFER (separate refactor): StoryView hook extract, storyTtsProviders neutral module, gender-policy helpers.
Final fix A: c976f43 (hidden saved-voice label + manual/F0 race guard via genderGuard.js; 4381 pass). Now fix B: dedup+consistency.
Final fix B: e995106 (voiceKey helper, preview provider identity, confidence type, dead onVoiceSearch removed, test spy fixed, whitespace speaker; 2031 pass). Re-verify + full regression.
FINAL FIXES CLEAN (Codex). Full regression exit 0.


---
# Voice Picker — deferred refactors (R1-R3)
BASE: e995106
R1 (storyTtsProviders neutral move): SKIP — electron importing src/ is the established repo pattern (voiceKey/genModels/storyNarrationTracks/parseSfxList). Moving only storyTtsProviders would be the lone inconsistency. Codex #8 is a generic anti-pattern that this repo already broadly adopts. Proceeding with R2 (hook) + R3 (remote search).
R2 (useStoryVoiceSelection): DONE f7f1c06 (5/5 hook + 165 regression + 4387 full; pure extraction). concern: unused speakers param.
R3 (ElevenLabs remote search rewire): DONE 1a1d489 (14/14 + 1166 pass; debounced elevenlabs-only). R2+R3 range e995106..1a1d489 — Codex review pending.
R2+R3 Codex: Important (preload replace clobbers search). Fixed bc22ee7 (preload→mergeTtsVoices; 1938 pass). Re-verify.
R2+R3 re-review: Minor only (merge preload never prunes account/key-deleted voices → stale selectable → preview fails). DEFERRED (rare edge, has error-state handling, fix = key-revision event wiring is disproportionate). R2+R3 CLEAN modulo this deferred Minor.

## DONE: voice picker feature + R2/R3 refactors. Full suite green. Awaiting user visual QA + push decision.
PREVIEW BUG root causes confirmed via live API: (1) Typecast model hardcoded ssfm-v21, list is 592 v30 / 537 v21 → v30 gives HTTP 422 VOICE_MODEL_NOT_SUPPORTED. (2) ElevenLabs preview_url host api.us.elevenlabs.io not in SSRF allowlist (only api.elevenlabs.io+storage.googleapis.com). Fixed be64010 (per-voice model cache + *.elevenlabs.io allowlist; 23/23 + 880 pass). Verifying.
Typecast lazy-populate: 3fbd628 (fetchAndCacheVoices extracted; batch v30 no longer 422s pre-preload; 15 + 883 pass). Verifying.
TYPECAST LAZY FIX CLEAN (Codex). Both preview bugs resolved.
Final full regression after preview fixes: exit 0.
