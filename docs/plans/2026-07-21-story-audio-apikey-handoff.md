# 핸드오프 — Story 오디오 API키 게이트 + 설정통합 (다음 세션은 여기부터)

작성 2026-07-21 / 브랜치 `feature/story-audio-apikey-gate` (로컬, **미푸시**)
메모리: `autoflowcut-story-audio-apikey-gate` / SDD ledger: `.superpowers/sdd/progress.md`

## 현 상태 — 전체 코드 완성, M3b 리뷰 findings 미fix

스펙 `docs/plans/2026-07-20-story-audio-apikey-gate-design.md`(v4, Codex+Fable 4R findings 0) 기반으로 6개 마일스톤 구현 완료. 전체 스위트 6717 tests green(사전존재 `VideoDetailModal` 2 async-race 무관).

| 마일스톤 | 커밋 | 상태 |
|---|---|---|
| M1 키레이어(2계층 키계약·split-brain·dev스위치) | `95fcdbfd..77ee38cf` | ✅ 리뷰+뮤테이션 |
| M2 pre-flight(audioPreflight·resolveKeyWithSource·IPC) | `5e0c5bfc..4fff3062` | ✅ 리뷰+뮤테이션 |
| M3a 설정통합탭 | `63be45c6..78a65f40` | ✅ 리뷰+뮤테이션+**눈검증 통과** |
| M3b-1 errorKind 로케일 | `bb0a01ba..ddf8e268` | ✅ |
| M3b-2 게이트 UI | `136763e3..fb96a9e8`(+`4a35e1a1..30c38f74` 2a) | ✅ 코드, 게이트카드 눈검증 뜨는 것 확인 |

각 마일스톤 plan: `docs/plans/2026-07-21-story-audio-m{1,2,3a,3b1,3b2a,3b2b}-*.md`.

## ⚠️ 다음 세션 STEP 0 — M3b 최종 리뷰 findings fix (Fable5+Codex, 미fix)

**High (실질 버그):**
1. **onKeySaved voices refetch 무동작** — StoryView `onKeySaved`가 `onVoiceSearch(provider)`(문자열) 호출, App `handleTtsVoiceSearch`(App.jsx:752)는 `({provider,query})`+`query.length<2` 조기반환 → silent no-op. 게이트 해제는 preflight 재검사가 해서 겉만 멀쩡. **fix: App에 provider 단위 reload(`ttsListVoices({provider})`→merge, spec §4.7) 별도 prop; 테스트 실계약으로**(`storyAudioGate.test.jsx:1629`가 틀린 계약 `toHaveBeenCalledWith('typecast')` 고정=mock-drift).
2. **redo/세그먼트재생성 게이트카드 안 보임** — `handleStepRedo`·`regenerateSegment`가 preflight 후 `setViewedStep(null)`→완료 audio는 화면 prompts로(StoryView:714), 카드는 audio 패널(:2133)에만 → 차단은 되는데 키입력 UI 미표시.
3. **세그먼트 테스트 미게이트** — `testSegment`(StoryView:1210)는 preflight 없이 `ttsPreview` 직접(story-api.js:206 synthPreview), IPC rejection에서 errorKind 소실→raw toast. backend `mode:'segmentTest'` 경로(stepMachine:1971) 이미 있음.

**Med/Low:**
4. VoicePicker 인라인카드 `onKeySaved` 미전달(VoicePicker.jsx:268 근처)→저장 후 재시도·해소 없음. fix=`onKeySaved={()=>onPreview(v)}`.
5. `GETKEY_URL` 중복(AudioKeyGateCard vs ApiKeyTab)→registry `API_KEY_REGISTRY[p].url`로 단일화.
6. main 재검사(§4.4) 유예OK(errorKind로 번역배너 강등, raw없음). 구현 시 running마킹 전 `{error:kind}` 반환(stepMachine:2510 패턴).

**확인됨(무결):** 오디오만 게이트, audioPreflight-fn 가드 prod 우회없음, wrapper 선택, useVoicePreview no-key 한정(throw/decode 오분류 없음), 목록 키리스, useSafeT 숏핸드 안전.

## STEP 1~ (findings fix 후)
1. High 3개 fix → SDD 재리뷰(Fable5+Codex, findings 0까지).
2. **실앱 눈검증**: `AUTOFLOWCUT_DISABLE_KEY_FALLBACK=1` + 키store 백업(`~/Library/Application Support/AutoFlowCut/keys`,`genai-key.enc` → `.bak`)으로 키없음 재현 → (a)오디오 생성 게이트카드+키입력→진행 (b)VoicePicker 미리듣기 no-key 인라인 (c)성우목록 키리스. 끝나면 `.bak` 복원.
3. main PR (push & pr merge 패턴).

## 눈검증 재현 명령
```bash
UD="$HOME/Library/Application Support/AutoFlowCut"; mv "$UD/keys" "$UD/keys.bak" 2>/dev/null; mv "$UD/genai-key.enc" "$UD/genai-key.enc.bak" 2>/dev/null
cd ~/workspace/AutoFlowCut-bugfix && AUTOFLOWCUT_DISABLE_KEY_FALLBACK=1 npm run dev
# 복원: mv "$UD/keys.bak" "$UD/keys"; mv "$UD/genai-key.enc.bak" "$UD/genai-key.enc"
```
(주의: 백업 이동 중 앱이 빈 `keys/`를 새로 만들면 복원 mv가 중첩됨 — `keys/keys.bak` 생기면 안의 것을 `keys/`로 올리고 빈 껍데기 제거. 이 머신은 keyStoreMulti store에 키 없음=원래 빈 디렉토리, genai-key.enc만 실제 키.)
