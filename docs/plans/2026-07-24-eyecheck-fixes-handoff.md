# 세션 핸드오프 — 2026-07-24 (눈검증 버그 수정)

워크트리 `~/workspace/AutoFlowCut-bugfix` (브랜치 **main**).
⚠️ `~/workspace/AutoFlowCut`, `-main`, `-selfrender` 등 다른 `-*` 워크트리는 건드리지 말 것(다른 브랜치).

`origin/main` = `3cea66e5`. **이 세션의 커밋은 전부 push 됨. 미푸시 0.**

## 작업 방식 (이 저장소 확립 루프)
- **구현은 Codex(gpt-5.6-sol, xhigh), 리뷰는 Fable 5 + Codex 둘 다, 검증(전체 스위트·뮤테이션 실측)은 Opus.**
- 커밋마다: 구현 → 전체 스위트 → 커밋 → **뮤테이션(되돌리는 뮤턴트가 죽는지, 적용 줄 수까지 확인 — 거짓 kill 주의)** → Fable+Codex findings 0 → push.
- **리뷰어 충돌 = 실측 신호.** 이 세션에서 Fable 이 "메커니즘은 맞게 보고 사용자가 겪는 상태를 놓친" 사례가 반복됐다. 충돌하면 Opus 가 직접 코드로 판정.
- 뮤테이션 전 반드시 커밋(dirty 면 `git checkout` 금지). 전체 초록불 ≠ 앱이 뜬다 — App 배선은 렌더 테스트가 거의 없어 **실앱 눈검증이 유일한 그물**.

## 커밋 이력 (이번 세션, 오래된→최신)
- `1da10432` 버그1 자동 스크롤
- `88fba125` `92ca43c5` `62676d32` `7bc6665c` 버그2 스타일 (4커밋)
- `968d60f7` 버그2 저장 race 별건 등재 (문서)
- `ead57e00` Typecast -15 LUFS
- `3cea66e5` 버그3 Flow 이름 방어선

전체 스위트: **675파일 / 7063테스트 통과** (기존 `VideoDetailModal.generateButton.test.jsx` 의 `meta=null` → `meta.seed` unhandled rejection 2건은 이 세션과 무관한 기존 문제, exit 1 원인).

---

## 1. 버그1 — 자동 스크롤 ✅ 완료·리뷰 0·push
생성 중인 씬(거터 링 도는 문단)이 뷰포트 밖이면 편집기가 그 줄로 자동 스크롤. `BusyLinesPlugin`(`src/components/PromptInput.jsx`)에서 `Math.max(...busyLines)`(마지막 busy) 문단으로 `scrollIntoView({block:'nearest'})`, 타깃 변화 시에만(`lastScrolledIndexRef`), empty 시 리셋. Fable findings 0. 뮤테이션 4/4. **실앱 눈검증 대기**(생성 중 스크롤 따라가는지).

## 2. 버그2 — 레퍼런스 스타일 반영 ✅ 완료·리뷰 0·push
증상: "한국 애니" 골랐는데 캐릭터 카드에 안 붙음. 원인: 이전 실패/중지로 `styleId:null` 각인된 미생성 카드가 그 null 로 현재 선택을 가림(`useReferenceGeneration.js:386`).
**확정 정책**: **이미지 없는(미생성) 카드는 생성 시 전역 스타일을 따른다**(사용자 요구). 상세모달에서 직접 고르고 즉시 재생성하면 그 세션 선택 override 가 이김. 저장만 하면 전역(정책의 귀결) — 라벨이 그 진실을 말함. **provenance 영속(스타일을 카드에 박기)은 안 함**(스코프 밖).
- `88fba125` `sourceAvailable(ref)` 로 미생성 판정 → 전역 우선.
- `92ca43c5` 상세모달 `styleDirtyRef` 로 명시 선택 추적 → override 전달, 무스타일은 `'none'`.
- `62676d32` 라벨 정책 정렬 + 모달 key 에 projectName + `'none'→null` 피커 매핑.
- `7bc6665c` 모달 스타일카드 판정을 생성과 `isStyleReference` 로 통일 + 테스트 하드닝 4.
Fable+Codex findings 0(마지막 라운드). 뮤테이션 전부 kill. **실앱 눈검증 대기**.
**별건 등재**(핸드오프 `2026-07-22-session-handoff.md` "남은 별건 후속" 4번): 상세모달 저장 continuation race(저장 await 중 프로젝트 전환 시 옛 draft 가 새 프로젝트 카드 오염) — pre-existing, 좁은 async race, 저장 시작 token 캡처로 가드하는 게 정석.

## 3. Typecast 성량 (-15 LUFS) ✅ 완료·리뷰 0·push
`electron/api/tts/typecast.js` synthesize body 에 `output: { target_lufs: -15 }`. 서버측 라우드니스 정규화라 ffmpeg 불필요. Fable findings 0 + **공식 문서로 계약 검증**(output 최상위 필드, target_lufs -70~0, audio_format 생략 시 wav, volume 과 상호배타). 모든 synthesize 경로(생성·재생성·미리듣기) 적용. 뮤테이션 2/2.
⚠️ **실앱 귀검증 필수**: ssfm-v21 에서 실제로 성량이 커졌는지 들어봐야 함. **캐시 주의** — fix 전 생성한 옛 세그먼트는 캐시 키(`provider:voiceId:emotion`, lufs 미포함)로 재사용돼 조용한 채 남는다. 이미 만든 나레이션은 forceRegen(재생성) 해야 -15 적용. 새로 생성하는 건 바로 적용.

## 4. 버그3 — Flow 캐릭터 이름 반영 ✅ 구현·push, ⚠️ **리뷰 미실시**
증상: (1) 마지막 캐릭터 동기화하면 프로젝트 나갔다 재진입해야 이름 반영. (2) 짝수 개일 때 "Untitled Character".
`3cea66e5`:
- **빈 이름 등록 차단**(`electron/flow-character-api.js` `normalizeEntityDisplayName` + `character.js` IPC 경계): 빈/공백 displayName 이면 DOM 작업 전 `character-display-name-required` coded failure. `displayName || ''` 가 빈 값을 서버에 보내 "Untitled" orphan 을 만들던 IPC 계약 구멍을 막음. **이름 있는 캐릭터는 그대로 등록**(정상 흐름 안 막음).
- **refresh 보장**(`flowCharacterSync.js` `needsComposerRefresh`: `nameApplied !== true` → `return true`): 캐릭터 entity 동기화(성공+캐릭터+entityId)가 하나라도 있으면 루프 끝에 refresh 1회. 대상 0건은 스킵(`ReferencePanel.jsx:108`).
뮤테이션 2/2 kill(빈값 가드 제거 / refresh return true→false).

⚠️ **한계(정직하게)**: 이건 **안전망 + refresh 보장**이지 근본 수정이 아니다. "왜 짝수일 때 빈 payload 가 오는가"는 코드상 결정적 분기가 아니라 **공유 flowView DOM 자동화(`applyEntityNameToSpa`)의 타이밍 아티팩트**로 판정됨(조사 전수 확인 — %2/pairwise/인덱스스킵 없음). 빈 이름 차단은 orphan 을 막지만, 그 캐릭터는 이제 "동기화 실패"로 남아 재시도 필요(타이밍이 매번 같으면 반복 실패 가능성 — 실앱에서 관찰 필요). DOM 자동화 자체는 데드락 위험(모달=flowView 0×0)이라 재설계 안 함.

### 🔴 새 세션 첫 할 일: 버그3 리뷰
`3cea66e5` 를 **Fable 5 + Codex(gpt-5.6-sol, xhigh) 둘 다** 리뷰. 관점:
- `normalizeEntityDisplayName` 차단이 정상 흐름(이름 있는 캐릭터)을 안 막는지, coded failure 가 동기화 루프에서 어떻게 표시/재시도되는지.
- `needsComposerRefresh` 항상 refresh 가 과한 비용(loadURL 2회+1s 매번)인지, 함수명 vs 동작 불일치(이제 "동기화 있었나"를 반환).
- 순수 로직만 테스트됨(DOM 자동화는 실앱). 리뷰어에게 "짝수 타이밍 근본을 실앱 로그로 잡아야 하는지" 판단 요청.

---

## 5. Story > 오디오 speed 지정 UI — ⬜ 미착수 (다음 큰 트랙)
사용자 요구: Typecast **speed(속도)를 Story>오디오 UI 에서 화자별/전역 지정** 가능하게. (speed 값 1.2 언급했으나 "일단 내비둬" → UI 로 지정하게 만드는 게 목표.)

조사 완료(`aa74298d` 에이전트). 파일 체인(위→아래):
1. `src/hooks/useStoryVoiceSelection.js` — speed state 추가(`voiceBySpeaker` 패턴).
2. `src/components/story/VoicePicker.jsx` 또는 `StoryView.jsx` 오디오 패널 — 슬라이더 UI.
3. `src/components/story/StoryView.jsx:1107` `buildAudioParams()` — `voice: { provider, voiceId }` 에 `speed` 추가.
4. `electron/ipc/story-api.js` — params pass-through.
5. `electron/story/stepMachine.js:1705`·`:2056` — `synthesize(...)` 에 speed 인자. ⚠️ **캐시 키 `ttsVoiceKey`(`:210`, 현재 `provider:voiceId:emotion`)에 speed 포함해야** 값 변경 시 재생성됨.
6. `electron/api/tts/typecast.js` — `synthesize` 시그니처에 speed, body `output` 에 **`audio_tempo: speed`**(범위 0.5~2.0, 기본 1.0). ⚠️ 방금 `output: { target_lufs: -15 }` 넣었으니 그 객체에 audio_tempo 를 **추가**(둘 다 output 안, 공존 가능 — volume 과만 상호배타).
7. 테스트: `tests/electron/api/tts/typecast.test.js` body assert 갱신 + stepMachine 캐시 키 테스트.
주의: elevenlabs/gemini/googletts 어댑터는 speed 형태가 달라 공통 인터페이스에 speed 넣으면 각자 무시/매핑.

---

## 실앱 눈검증 종합 (사용자 몫)
새 세션 전/중에 확인할 것:
1. 버그1 — 생성 중 편집기가 그 씬으로 자동 스크롤.
2. 버그2 — 미생성 카드에 전역 스타일 붙는지, 상세모달 명시 선택이 이기는지, 라벨이 진실인지.
3. Typecast — 성량 커졌는지(귀). 이미 만든 건 재생성해야 함.
4. 버그3 — 마지막 캐릭터 이름 반영(재진입 불필요해졌는지), Untitled 안 뜨는지(대신 실패로 뜨면 재시도).
