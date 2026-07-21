# Story 오디오 API 키 게이트 + 설정 키 통합 — 설계 (v4, 최종)

작성: 2026-07-20 / 대상 repo: AutoFlowCut (AutoCraft Studio, Electron)
개정: Codex(gpt-5.6-sol) + Fable 5 교차검증 4라운드로 v1 핵심 가정 4개 오류 + 후속 findings를 실측 확인·반영. 두 리뷰어 findings 0 수렴(R4에서 Codex auth-범위 1건 반영, Fable 0). 대응 이력 §9.

## 1. 배경 / 문제 (실측 정정 포함)

Story 오디오 탭은 화자별 TTS로 나레이션을 만들고, SFX 세그먼트도 합성한다. 현재:

- **키 없으면 raw 영어 에러**: 키가 없으면 합성 어댑터가 `throw new Error('No <Provider> API key')` 또는 resolver가 `Typecast API key not found: ...`([typecastKey.js:17](../../electron/api/tts/typecastKey.js#L17))를 던지고, 이 에러엔 대체로 `errorKind`가 없어([stepMachine.js:1690](../../electron/story/stepMachine.js#L1690)) 오디오 로그에 **번역 안 된 영어**가 인라인으로 뜬다.
- **키 소스는 3중, 게이트가 볼 status는 1중**: 런타임 키 해석은 `multiKeyStore.getKey() || env || ~/.<svc>/credentials` 폴백([main.js:233-238](../../electron/main.js#L233))인데, renderer가 보는 `keys:status`는 `multiKeyStore.hasKey()` **store만**([tts-api.js:20-26](../../electron/ipc/tts-api.js#L20)) 본다. 이 불일치가 v1 게이트의 치명적 결함이었다(폴백 키 사용자를 거짓 차단).
- **성우 목록은 키를 요구하지 않는다(v1 오독 정정)**: `listVoices()`는 키 없으면 `KNOWN_VOICES`/정적목록/시드를 **반환**([typecast.js:69-71](../../electron/api/tts/typecast.js#L69) → `fetchAndCacheVoices` [:41-63](../../electron/api/tts/typecast.js#L41)), main도 예외를 삼켜 `[]`를 준다([main.js:262](../../electron/main.js#L262)). 키가 실제 필요한 지점은 **성우 미리듣기(preview→synthesize)** 와 **합성**이다. 목록 로드는 Story 진입 시 App effect가 이미 수행([App.jsx:711](../../src/App.jsx#L711)).
- **provider 이름 불일치**: Story 화자 provider는 `'gemini'`([storyTtsProviders.js:1](../../src/config/storyTtsProviders.js#L1))인데 키 store/ resolver 식별자는 `'genai'`([main.js:237](../../electron/main.js#L237)). `keyStoreMulti` allowlist엔 `genai`만 있고 `gemini`는 없다.
- **설정 키 UI 분산 + genai 이중 store**: "API 키" 탭(Gemini, `keyStore` → `userData/genai-key.enc` [main.js:213](../../electron/main.js#L213)) + "TTS 키" 탭(Typecast/ElevenLabs/GoogleTTS, `keyStoreMulti` → `userData/keys/*.enc`). 그런데 `keyStoreMulti`의 allowlist에도 `genai`가 있어([keyStoreMulti.js:8-14](../../electron/api/keyStoreMulti.js#L8)) `userData/keys/genai-key.enc`라는 **다른 파일**을 쓸 수 있다(split-brain 위험).

## 2. 목표 (스코프)

1. **오디오 생성 pre-flight 게이트(진실 소스 = main)**: 생성 시작 전, 실제로 합성될 세그먼트가 요구하는 provider 키가 **런타임 resolver 기준으로 해석되는지** main에서 판정. 없으면 시작 안 하고 안내.
2. **미리듣기 게이트**: 성우 목록은 키 없이 보여주되, **미리듣기/합성 시** 키 없으면 안내 + 인라인 입력.
3. **키 없을 때 그 자리 인라인 입력**: 게이트/미리듣기 카드 안에 provider 키 입력. 저장 → 재검사 후 진행 + 목록 refetch.
4. **설정 "API 키" 탭 통합(방법 B, UI만 통합)** + genai split-brain 제거.
5. **테스트용 "키 없음" 재현**: dev 전용 폴백 무시 스위치, 게이트가 쓰는 resolver IPC와 동일 경로.

## 3. 비목표

- Gemini 키 데이터 store 이전/마이그레이션(방법 A). Gemini 키는 계속 `keyStore`(`genai-key.enc`, 저장 전 검증)에 저장.
- Story 성우 picker에 GoogleTTS 추가(현재 picker는 typecast/gemini/elevenlabs).
- 이미지/Veo 기능의 키 UX 변경.

## 4. 아키텍처

### 4.1 진실 소스 — main pre-flight IPC

`ipcMain.handle('story:audio-preflight', (params) => …)`를 추가한다. **renderer의 `keys:status`가 아니라** 런타임 합성과 **동일한 `ttsKeyFor`/`sfxKeyFor` closure를 IPC에 직접 주입**(재구현 금지 — 이 두 객체는 [main.js:233-238/273-283](../../electron/main.js#L233)의 module-local closure이므로 preflight 핸들러를 main.js에서 배선하거나 `resolveTtsKey`/`resolveSfxKey` 의존성으로 주입)해 각 필요 provider의 키가 **해석되는지**(폴백 포함) 판정한다.

- **판정은 `resolveKey(provider) → { key|null, source }`로**(§4.8 2계층의 nullable 진입점): `key === null` → `missing`, `source === 'store'` → `resolved-store`, 그 외(env/credentials) → `resolved-fallback`. **`hasKey()`로 판정하지 않는다** — 깨진 암호문에서 `hasKey=true`인데 `getKey=null`이 가능하고([keyStore.js:52/70](../../electron/api/keyStore.js#L52)), 폴백 사용 시에도 store로 오표시된다. 실제 `resolveKey` 결과의 `source`만 신뢰한다. loader가 null 통일(§4.8)되므로 throw 신호는 없다. dev 스위치(§4.9)는 loader 내부라 자동 공유.

반환 shape(3분류를 실을 수 있게 per-provider status):

```
{
  providers: [{ provider, keyId, status: 'resolved-store'|'resolved-fallback'|'missing', encryptionAvailable }],
  encryptionAvailable: boolean            // 전역(safeStorage)
}
```

- `status`: `resolved-store`(store 키) / `resolved-fallback`(store엔 없지만 env·credentials로 해석됨 → **차단 안 함**) / `missing`(입력 유도). §4.10 3분류가 이 값으로 구현된다. 평문 키는 반환하지 않는다.
- `provider`(표시용) / `keyId`(설정·저장 대상, §4.3 registry; 'gemini'→'genai').
- renderer 게이트는 이 결과를 **표시만** 하고, 실제 `start('audio')`도 main에서 동일 검사를 반복(§4.4 배치 주의).

### 4.2 필요 provider/키 계산 (backend, 세그먼트 기준) — async planner

`buildAudioParams`([StoryView.jsx:1077-1104](../../src/components/story/StoryView.jsx#L1077))가 만든 `params`(speakers[].voice, sfxSources, regenerate, onlySpeaker)와 `scenes` 세그먼트로, **실제 합성할 세그먼트만** 골라 provider 집합을 만든다. 규칙(합성 루프 [stepMachine.js:1524-1588](../../electron/story/stepMachine.js#L1524)와 동일):

- **narration 세그먼트**: 화자 voice → `voice.provider`. `voice:null`(voiceId 빈값 = "기본 성우")이면 **defaultVoice.provider = 'typecast'**([story-api.js:70](../../electron/ipc/story-api.js#L70), `voiceOf` [stepMachine.js:1357](../../electron/story/stepMachine.js#L1357)). `voice.provider==='import'`이면 **제외**(TTS 키 불필요).
- **SFX 세그먼트**(부분 실행이 아닐 때): `sfxSources[segId] || seg.sourceMode || 'elevenlabs'`([stepMachine.js:1582](../../electron/story/stepMachine.js#L1582)). `'library'`는 키 불필요 → **제외**.
- **재사용 가능한 완료 세그먼트**(`canReuse`/`canReuseSfx`)는 재합성 안 하므로 **제외**. **단, 이 판정은 `await stat()` 파일 실재 확인이 포함된 IO**([stepMachine.js:1573-1588](../../electron/story/stepMachine.js#L1573)) — 순수 함수로 못 만든다(§8 정정).
- **스코프 정정(중요)**: 부분 실행은 **`onlySpeaker`뿐**([stepMachine.js:1375](../../electron/story/stepMachine.js#L1375))이다. **`params.regenerate`는 부분 실행이 아니라 전체 실행**이며 지정 ID의 reuse만 강제 무효화(`forceRegen`)한다([stepMachine.js:1570-1574](../../electron/story/stepMachine.js#L1570)) — 같은 런에서 다른 pending/error/파일없음 세그먼트와 SFX도 합성된다([stepMachine.js:1668/1700](../../electron/story/stepMachine.js#L1668)). 따라서 regenerate는 **전체 세그먼트로 집합 계산 + `forceRegen`을 reuse 제외 판정에 반영**해야 한다(스코프 축소 금지). 세그먼트 테스트(`synthPreview` [stepMachine.js:1969-1977](../../electron/story/stepMachine.js#L1969), 지정 id·import 제외·sfx는 sfxTargets만)와 onlySpeaker만 진짜 부분 스코프.

**공유 async planner로 추출**: `planAudioWork(params, scenes, { speakers, defaultVoice, mode, segmentIds, stat, segmentsDir, forceRegen }) → { toSynth, requiredProviders }`.
- **권위 입력 명시(계약 완결)**: `speakers = params.speakers || state.speakers`([stepMachine.js:1350](../../electron/story/stepMachine.js#L1350)), `defaultVoice`(주입, [story-api.js:68](../../electron/ipc/story-api.js#L68)) — voice/fingerprint를 실루프와 동일하게 계산하려면 필수. `mode ∈ {full, onlySpeaker, segmentTest}`, `segmentIds`(segmentTest/부분용).
- 순수 부분(`providerForSegment(seg, speakers, defaultVoice)`, fingerprint/sfxSource)은 별도 순수 함수. IO 부분(reuse `stat`)은 planner.
- **모드별 경로**: `full`/`onlySpeaker`는 reuse 제외(canReuse/canReuseSfx) 포함. **`segmentTest`는 reuse를 보지 않고**(synthPreview는 지정 id를 항상 합성 [stepMachine.js:1969-1998](../../electron/story/stepMachine.js#L1969)) **순수 `providerForSegment`로 `segmentIds`만** 계산 — planner의 reuse 제외를 태우면 done 세그먼트 재테스트가 잘못 스킵된다.
- **합성 루프도 이 planner의 `toSynth`를 사용**해 pre-flight와 실제 실행이 갈리지 않게 한다(single source). preflight IPC는 `requiredProviders`를 §4.1 `resolveKey`에 넘긴다.

### 4.3 provider → keyId → resolver/store registry (별칭 명문화)

단일 매핑 테이블을 둔다(가칭 `src/config/apiKeyRegistry.js` + main 대응):

| storyProvider | keyId(store/status) | 저장 hook | resolver |
|---|---|---|---|
| typecast | typecast | useTtsKeys('typecast') | ttsKeyFor.typecast |
| elevenlabs | elevenlabs | useTtsKeys('elevenlabs') | ttsKeyFor.elevenlabs (+ sfxKeyFor) |
| gemini | **genai** | **useApiKey**(검증O) | ttsKeyFor.gemini = genaiKeyStore |
| (설정 전용) googletts | googletts | useTtsKeys('googletts') | ttsKeyFor.googletts |

pre-flight/게이트/VoicePicker는 storyProvider를 이 테이블로 keyId에 매핑해서 status/save 대상을 결정한다. **'gemini'를 그대로 keys:*에 넘기지 않는다.**

### 4.4 게이트 진입점 통합

오디오를 **생성/합성**하는 경로를 공통 `runAudioWithPreflight(scopeParams)`로 감싼다:
- 기본 생성 `start('audio')`, 재실행, 자동 진행([StoryView.jsx:1292/1312/1395](../../src/components/story/StoryView.jsx#L1292)), 세그먼트 재생성([:1144](../../src/components/story/StoryView.jsx#L1144)), 화자 단독([:1150](../../src/components/story/StoryView.jsx#L1150), 그 화자 provider만), 세그먼트 테스트([:1180](../../src/components/story/StoryView.jsx#L1180)).
- **성우 미리듣기는 여기 포함하지 않는다** — 선차단하면 키리스 캐시/previewUrl 미리듣기가 막힌다(§4.7). 미리듣기는 attempt-first(§4.7)로 별도 처리.
- 흐름: preflight IPC → `missing` 있으면 인라인 게이트 카드 표시(키 저장 후 재검사→해당 action 재개) / 없으면 진행.
- **main 재검사 배치(중요)**: `start('audio')`의 동일 preflight 재검사는 **`running` 마킹·downstream reset 전에** 실행하고, `onlySpeakerScopeError`처럼 **`{ error: errorKind }` 반환 패턴**([stepMachine.js:2510-2513](../../electron/story/stepMachine.js#L2510))으로 "시작 안 함"을 표현한다. audio 스텝 fn 안에서 throw하면 이미 done이던 스텝 상태가 교체된 뒤라 **done→error 회귀**가 된다([stepMachine.js:2505-2531](../../electron/story/stepMachine.js#L2505) 주석이 이 함정을 설명). renderer preflight와 start 사이 TOCTOU는 이 재검사로 닫히고, 그 이후 외부 키/파일 변경 race는 런타임 errorKind(§4.8)가 담당.

### 4.5 설정 "API 키" 통합 탭 + split-brain 제거

- `ApiKeyTab.jsx`를 provider 목록으로: `genai(Gemini) · typecast · elevenlabs · googletts` 각 행. `TtsKeyTab.jsx`와 탭 id `ttsKey` 제거, `SettingsModal.jsx` 탭 정의([:18-25](../../src/components/SettingsModal.jsx#L18)) 갱신, `openSettings('ttsKey')` → `openSettings('apiKey')` 이관(호출부는 리터럴 grep이 아니라 탭 정의 기준으로 확인).
- GoogleTTS 행엔 "Story에서 현재 선택 불가" 표시(죽은 설정 오해 방지). `anthropic`은 소비처 없음 → 통합 목록에서 **제외**.
- **genai split-brain 제거**: `keyStoreMulti`의 `FILENAME_BY_PROVIDER`에서 `genai`를 제거하거나 `genaiKeyStore`로 위임하고, `keys:*`가 `'genai'`를 거부/위임하도록 하드닝. Gemini 행은 반드시 `useApiKey`(→ `genai:status`/`genai:*`)만 사용.

### 4.6 공용 키 입력 컴포넌트 (hook 규칙 안전)

- `src/components/settings/ApiKeyField.jsx` — **표시 전용 presentational**(props: `provider,label,hasKey,encryptionAvailable,loading,onSave,onClear,requireValidation,getKeyUrl`). hook을 내부에서 조건부 호출하지 않는다.
- 두 얇은 wrapper가 hook을 고정 호출: `GenaiApiKeyField`(=`useApiKey`, 검증O), `TtsApiKeyField`(=`useTtsKeys(provider)`, 검증X). 소비처는 keyId로 wrapper를 고른다 → **React hook 순서 안전**(조건부 hook 금지).

### 4.7 VoicePicker / 미리듣기

- 성우 목록은 지금처럼 **키 없이도 로드/표시**(후퇴 없음). picker의 provider 칩도 유지.
- **미리듣기는 선차단하지 않는다(중요)**: `voicePreviewService.getPreview`는 이미 **디스크 캐시 히트**([voicePreviewService.js:43-49](../../electron/api/tts/voicePreviewService.js#L43))와 **elevenlabs `previewUrl` 다운로드**([:52-56](../../electron/api/tts/voicePreviewService.js#L52))를 **키 없이** 처리하고, 이 둘이 없을 때만 synthesize가 키를 요구하며 그때 `{ error: 'no-key', provider }`를 반환한다([:79-83](../../electron/api/tts/voicePreviewService.js#L79)). 따라서 hasKey 선차단(캐시/previewUrl까지 막고 store-only false-negative 재발)이 아니라 **미리듣기를 먼저 시도 → `no-key` 응답에만 인라인 `ApiKeyField`(그 provider) 표시**. 기존 계약 재사용, 후퇴 0. (§4.8 표준화 시 [:81](../../electron/api/tts/voicePreviewService.js#L81)의 `/no .* key/i` 정규식 분류도 errorKind 기반으로 교체.)
- **저장 후 목록 refetch(replace semantics)**: 키 저장 시 App의 listVoices effect가 자동으로 안 도므로([App.jsx:711-727](../../src/App.jsx#L711) 의존성 `activeView`뿐), 저장 wrapper가 공유하는 App-level reload를 호출한다. 단 `mergeTtsVoices`([App.jsx:700-710](../../src/App.jsx#L700))는 이전 목록을 보존·병합만 하므로, 계정 교체 시 옛 계정 전용 voice가 남아 합성 실패한다 → **전체 refetch는 해당 provider slice를 replace**하고 remote search/gender 태그만 merge. 설정에서 저장한 경우엔 VoicePicker 콜백이 없으므로 **키-변경 이벤트 또는 App-level reload를 모든 저장 wrapper가 공유**한다.

### 4.8 errorKind 일원화 (런타임 안전망)

- 키 해석/인증 실패를 표준 에러로: `MissingProviderKeyError(provider)`(errorKind `story-audio-no-tts-key`) + `ProviderAuthError(provider)`(errorKind `story-audio-tts-auth`).
- **auth 판정은 provider별 신호로**(401/403만 아님): Typecast/ElevenLabs는 HTTP 401/403, **Google 계열(Gemini TTS·GoogleTTS)은 무효 키에 `400 INVALID_ARGUMENT` + `ErrorInfo.reason === 'API_KEY_INVALID'`** 를 반환한다([gemini.js:102](../../electron/api/tts/gemini.js#L102), [googletts.js:78](../../electron/api/tts/googletts.js#L78)) — 이것도 `ProviderAuthError`로 매핑(모든 400이 아니라 reason 기준). 안 그러면 키 존재 pre-flight를 통과한 무효 Gemini 키가 raw 영어로 샌다.
- **2계층 키 계약(throw 경계 = synthesize/generate, listVoices 아님)**: loader들(`getTypecastKey`/`readCredentialsKey`/`genaiKeyStore.getKey`)은 **null만 반환**하도록 통일(§4.9 정합 — typecast의 현재 throw [typecastKey.js:17](../../electron/api/tts/typecastKey.js#L17)도 null로). 그 위에 두 진입점:
  - `resolveKey(provider) → { key|null, source }` — **nullable**. `listVoices()`/시드 폴백이 쓴다. **여기서 throw하면 안 된다** — elevenlabs/googletts `listVoices`는 키 없으면 시드 목록을 반환해야 하는데([elevenlabs.js:99-136](../../electron/api/tts/elevenlabs.js#L99), [googletts.js:53](../../electron/api/tts/googletts.js#L53)) main이 예외를 `[]`로 접어([main.js:262](../../electron/main.js#L262)) **키리스 목록(F6/R3)이 후퇴**한다.
  - `requireKey(provider) → string (throw)` — 키 없으면 `MissingProviderKeyError`. **synthesize/generate 진입점**(4 TTS 어댑터 + SFX 어댑터)에서만 호출. loader/adapter 이중 throw는 제거하되 throw 자체는 이 경계에 유지.
- **대상에 SFX 어댑터 포함(누락 정정)**: 화자 TTS 4어댑터뿐 아니라 **SFX ElevenLabs 어댑터**([sfx/elevenlabs.js:15-16/27-29](../../electron/api/sfx/elevenlabs.js#L15))도 missing/auth를 raw로 던지므로 동일 표준 에러로 감싼다(TOCTOU·무효키 시 F8/F9가 SFX에서 재현되는 것 방지).
- **집계 안전망 typed 우선 보존**: 현재 세그먼트 catch는 `errorKind`만 저장하고 `provider`를 버리며([stepMachine.js:1690/1719](../../electron/story/stepMachine.js#L1690)), 집계는 씬 순서상 **첫 실패만** 고른다([stepMachine.js:1750](../../electron/story/stepMachine.js#L1750)) — 앞이 generic·뒤가 auth면 auth kind가 소실된다. → 세그먼트별 `{ errorKind, provider, message }`를 보존하고 집계는 **typed(key/auth) 실패를 generic보다 우선** 선택. pre-flight로 대부분 예방되므로 잔여 담당.
- **미리듣기 IPC**([story-api.js:174](../../electron/ipc/story-api.js#L174))는 aggregate를 안 거치고 IPC throw 시 custom errorKind가 소실되므로([story-api.js:143](../../electron/ipc/story-api.js#L143)), `{errorKind, provider}` 객체 반환으로 보존.
- ko/en 로케일에 두 kind 문구 + `resolveDisplayError`([errorDisplay.js:29-40](../../src/utils/errorDisplay.js#L29)) 매핑 추가. 이로써 raw 영어는 missing-key/auth 한정으로 제거.

### 4.9 dev 스위치

`AUTOFLOWCUT_DISABLE_KEY_FALLBACK=1`이면 `getTypecastKey`/`readCredentialsKey`의 env·credentials 폴백을 무시하고 store만 본다. 스위치는 **폴백 무시만** 담당한다. loader의 null 계약 통일(typecast throw→null 포함)은 스위치와 무관하게 §4.8이 상시 적용한다. `resolveKey`가 이 loader들을 쓰므로 게이트(preflight)와 런타임이 자동으로 같은 스위치를 공유한다.

### 4.10 상태 3분류

게이트/미리듣기 카드는 세 상태를 구분: `missing`(입력 유도) / `fallback-available`(폴백으로 해석됨 → 차단 안 함) / `encryption-unavailable`(입력해도 저장 불가 → 안내만, 입력 비활성 [keyStore.js:34-36](../../electron/api/keyStore.js#L34)). generic "실패"로 뭉치지 않는다.

## 5. 에러 처리

- pre-flight/미리듣기 게이트: 정상 흐름(에러 아님), 안내 UI.
- 런타임 missing-key/auth: 표준 errorKind → 번역 안내 + 입력 유도.
- 저장 실패(암호화 불가): `encryption-unavailable` 상태로 명시.

## 6. 테스트 전략 (경계 매트릭스)

mock만으로 넘기지 않고 다음 조합을 커버:
- genai: `userData/genai-key.enc`만 / `userData/keys/genai-key.enc`만(split-brain 회귀) — 통합 UI가 올바른 store를 읽는지.
- typecast: store만 / env만 / credentials만 / 없음 — pre-flight가 폴백을 존중하는지(F1 회귀).
- 폴백 스위치 on/off로 게이트=런타임 일치.
- safeStorage unavailable → encryption-unavailable 경로.
- narration 전원 typecast + SFX만 elevenlabs → SFX provider가 집합에 포함(F4 회귀).
- import 화자 / 대사 없는 roster 화자 → 게이트 대상에서 제외(F3 회귀).
- gemini 화자 → keyId 'genai'로 status/save(F2 회귀).
- 진입점별(배치/자동진행/화자단독/세그먼트테스트/미리듣기) provider 스코프.
- **실앱 눈검증**: `AUTOFLOWCUT_DISABLE_KEY_FALLBACK=1` + store 비우고 각 경로.

## 7. 확정 사항 (2026-07-20)

- **게이트 UI = 인라인 카드**(별도 모달 없음).
- **테스트 재현 = env 스위치** `AUTOFLOWCUT_DISABLE_KEY_FALLBACK=1`, preflight resolver와 동일 경로.
- **`ApiKeyField` = presentational + `GenaiApiKeyField`/`TtsApiKeyField` wrapper**, `src/components/settings/`.
- **reuse 세그먼트 제외**: 1차 구현부터 정확 계산(제외 포함). 단 reuse 판정은 `stat()` IO라 **순수 함수 불가 → async `planAudioWork`**로 구현(§4.2/§8). 보수적 전체-provider 차단은 F1/F3 정신에 어긋나므로 회피.

## 8. 구현 단위 (isolation)

- `apiKeyRegistry`(순수 매핑) — storyProvider↔keyId↔hook/resolver.
- `providerForSegment` + fingerprint/sfxSource(순수) — 세그먼트→provider·재사용 지문 계산.
- `planAudioWork(params, scenes, { speakers, defaultVoice, mode, segmentIds, stat, segmentsDir, forceRegen })`(**async**) — 세그먼트 선별(voiceOf·import 분리·canReuse·canReuseSfx) 전체를 담아 `{ toSynth, requiredProviders }` 반환. `segmentTest` 모드는 reuse 미적용(순수 `providerForSegment`로 `segmentIds`만). **합성 루프와 preflight가 이 하나를 공유**(순수 아님 — reuse가 stat IO).
- `resolveKey(provider) → {key,source}`(nullable) / `requireKey(provider)`(throw) — 2계층 키 계약. listVoices는 resolveKey(시드 폴백), synthesize/generate는 requireKey.
- `story:audio-preflight` IPC(main) — 주입된 `resolveKey`로 판정(`{key,source}`→missing/resolved-store/resolved-fallback), dev 스위치 연동, per-provider status 반환.
- `runAudioWithPreflight`(renderer) — 진입점 통합 + main `start('audio')` 재검사(running 마킹 전 `{error}` 반환).
- `ApiKeyField`(presentational) + `GenaiApiKeyField`/`TtsApiKeyField` wrapper — 설정/게이트/미리듣기 공용.
- errorKind 표준화(2계층 `requireKey` throw 경계 + SFX 어댑터 + Google 400 `API_KEY_INVALID` auth 매핑 + 로케일/errorDisplay + preview IPC 객체 반환).
- keyStoreMulti genai 하드닝(split-brain 제거).
- voices refetch(provider slice **replace**) — 저장 wrapper 공유 App-level reload.

각 단위는 독립 테스트 가능하고, 무엇을 하는지/어떻게 쓰는지/무엇에 의존하는지가 명확하다.

## 9. 리뷰 반영 이력 (Codex + Fable, 2026-07-20)

v1의 확정 결함(둘 다 실측 지적, 필자 직접 코드 대조 확인):
- **F1** 게이트 store-status vs 런타임 폴백 불일치 → §4.1 main resolver preflight, §4.9 스위치 연동.
- **F2** gemini/genai 이름 불일치 → §4.3 registry 별칭.
- **F3** effective provider 오규칙(voiceId 빈값→typecast, import 제외) → §4.2 세그먼트 규칙.
- **F4** SFX(elevenlabs) 누락 → §4.2 SFX 소스 포함.
- **F5** 방법 B genai split-brain(이중 store) → §4.5 하드닝.
- **F6** listVoices 키리스(v1 오독) → §4.7 목록 유지 + 미리듣기 게이트.
- **F7** 저장 후 목록 refetch 부재 → §4.7 refetch 콜백.
- **F8** errorKind 부여 지점(typecast는 어댑터 전 throw) → §4.8 해석 일원화.
- **F9** 무효 키(401/403) auth 에러 → §4.8 ProviderAuthError.
- **hook 규칙** 조건부 hook → §4.6 wrapper 분리.
- **암호화 불가** → §4.10 상태 분리.
- **진입점 다수** → §4.4 공통 진입점 + main 재검사.

### v3 반영 (R2 라운드, 잔여 문구성 findings)
- **R1** `regenerate`는 부분 스코프 아님(전체 실행 + forceRegen) → §4.2 스코프 정정.
- **R2** reuse 판정이 stat IO라 순수 함수 불가 → §4.2/§7/§8 async `planAudioWork`.
- **R3** 미리듣기 선차단이 캐시/previewUrl 키리스를 막음 → §4.7 시도-후-`no-key`-게이트.
- **R4** missing 신호 이원(throw/null) + SFX 어댑터 누락 → §4.1 throw/falsy 통일, §4.8 SFX 포함·loader null 통일.
- **R5** 반환 shape이 fallback-available 못 실음 → §4.1 per-provider status.
- **R6** main 재검사 배치(running 마킹 전 `{error}` 반환) → §4.4.
- **R7** refetch가 merge라 stale voice 잔존 → §4.7 provider slice replace.
- resolver 주입 경계(main closure 재구현 금지) → §4.1.
- 확인됨(무결): resolver 동일성(stepMachine `resolveTts`=주입된 `ttsFor`), googletts 설정전용/anthropic 제외, genai split-brain 하드닝은 마이그레이션 무손실(`keys:set('genai')` 호출 UI 부재).

### v4 반영 (R3 라운드)
- **N1** canonical throw가 키리스 listVoices 후퇴시킴 → §4.8 2계층(`resolveKey` nullable / `requireKey` throw), throw 경계 = synthesize/generate.
- **N2** §4.4 미리듣기 선차단이 §4.7과 모순 → §4.4에서 미리듣기 제외(attempt-first만).
- **N3** planAudioWork 계약 불완전 → §4.2/§8 `speakers/defaultVoice/mode/segmentIds` 추가, segmentTest는 순수 경로(reuse 미적용).
- **source 판별**: hasKey 오표시 → §4.1 `resolveKey→{key,source}`로 store/fallback 판정.
- **집계 보존**: typed(key/auth) > generic 우선 + `{errorKind,provider,message}` → §4.8.
- 오타/드리프트 정정(typecastKey, sfx/elevenlabs 라인).
- R1~R7 클로즈 확인됨(두 리뷰어 판정표 일치).

### v5 반영 (R4 라운드 — 수렴)
- **auth 범위**(Codex): Google 계열 무효키는 401/403이 아니라 `400 API_KEY_INVALID` → §4.8 reason 기준 `ProviderAuthError` 매핑([gemini.js:102](../../electron/api/tts/gemini.js#L102), [googletts.js:78](../../electron/api/tts/googletts.js#L78)).
- 문구 정리(Fable nit): §4.9 dev 스위치=폴백무시만/null계약은 §4.8 상시, §8 2계층 용어 통일, 헤더 v4.
- R4에서 Fable findings 0, N1~N3 + source/aggregate 전부 클로즈 확인. 스코프 내 리뷰 루프 종료(findings 0 수렴).
