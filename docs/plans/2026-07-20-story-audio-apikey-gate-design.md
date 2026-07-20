# Story 오디오 API 키 게이트 + 설정 키 통합 — 설계

작성: 2026-07-20 / 대상 repo: AutoFlowCut (AutoCraft Studio, Electron)

## 1. 배경 / 문제

Story 기능의 오디오 탭에서 나레이션을 생성하려면 화자별 TTS provider의 API 키가 필요하다. 현재 상태:

- **키 없으면 raw 영어 에러**: 키가 없으면 `synthesize()`(그리고 `listVoices()`)가 `throw new Error('No Typecast API key')`. 이 에러엔 `errorKind`가 없어서([stepMachine.js:1690](../../electron/story/stepMachine.js#L1690), [story-api.js:149](../../electron/ipc/story-api.js#L149)) 오디오 로그에 **번역 안 된 영어 문자열**이 인라인 배너로 뜬다. 모달·토스트·사전 안내·설정 유도 전부 없다.
- **성우 목록도 키를 요구**: "기본 성우" 옆 🎙 버튼 → VoicePicker가 `listVoices()`를 부르는데 [typecast.js:73-74](../../electron/api/tts/typecast.js#L73)는 키 없으면 즉시 throw. 즉 성우를 고르는 것부터 키가 있어야 한다.
- **설정 키 UI 분산**: 설정에 "API 키" 탭(Gemini/Google BYOK)과 "TTS 키" 탭(Typecast/ElevenLabs/GoogleTTS 드롭다운)이 분리돼 있고, TTS 탭은 드롭다운이라 **어떤 provider 키가 있고 없는지 한눈에 안 보인다**.
- **테스트가 어렵다**: 키 소스가 3중(설정 store → env → `~/.<svc>/credentials`)이라, 설정에서 지워도 폴백 때문에 "키 없음" 상태를 재현할 수 없다.

## 2. 목표 (스코프)

1. **오디오 생성 pre-flight 게이트**: 생성 시작 전에 이 대본에 쓰이는 화자들의 provider 키가 다 있는지 확인. 없으면 시작하지 않고 안내한다.
2. **VoicePicker 게이트**: 성우 목록 로드 전에 해당 provider 키 유무 확인. 없으면 빈 목록/에러 대신 안내 + 인라인 입력.
3. **키 없을 때 그 자리에서 바로 입력**: VoicePicker·게이트 안에 provider 키 입력 필드. 입력 저장 → 즉시 재시도(목록 로드/생성 진행).
4. **설정 "API 키" 탭으로 통합(방법 B, UI만 통합)**: Gemini + Typecast + ElevenLabs + GoogleTTS를 한 탭에 목록형으로. 각 provider의 키 유무를 한눈에. "TTS 키" 탭 제거.
5. **테스트용 "키 없음" 재현**: dev 전용으로 credentials/env 폴백을 무시하는 스위치.

## 3. 비목표 (이번 스코프 밖)

- Gemini 키의 **데이터 store 이전/마이그레이션** (방법 A). Gemini 키는 계속 `keyStore`(단일 파일, 저장 전 검증)에 저장한다.
- Story 성우 picker에 Google Cloud TTS provider 추가 (현재 picker는 `typecast|gemini|elevenlabs`만).
- 오디오 외 기능(이미지/Veo)의 키 UX 변경.

## 4. 아키텍처

### 4.1 공용 키 입력 컴포넌트 (설계의 핵심 단위)

세 곳(설정 목록 / VoicePicker / 생성 게이트)이 같은 "provider 키 상태 + 입력" UI를 쓰므로 **하나의 재사용 컴포넌트**로 추출한다.

- 컴포넌트: `src/components/settings/ApiKeyField.jsx` (가칭)
- 책임: 한 provider의 키 상태 표시(있음 ✓/없음 배지) + 입력 + 저장/삭제 + (Gemini만) 저장 전 검증.
- 인터페이스(무엇을 하는가/어떻게 쓰는가/무엇에 의존하는가):
  - props: `{ provider, label, getKeyUrl?, requireValidation?, onSaved? }`
  - provider별 hook 선택: `provider === 'genai'` → `useApiKey`(validateKey O), 그 외 → `useTtsKeys(provider)`(validateKey X). 이 분기가 "방법 B(저장은 기존 경로 그대로, UI만 통합)"의 실체다.
  - 평문 키는 저장 직후 폐기(기존 hook 계약 유지). renderer는 `hasKey` boolean만 본다.
- 이 컴포넌트만 이해하면 세 소비처가 어떻게 키를 다루는지 알 수 있다. 내부(어느 store를 쓰는지)는 소비처가 몰라도 된다.

### 4.2 설정 "API 키" 통합 탭

- `ApiKeyTab.jsx`를 provider 목록으로 재작성: `genai(Google Gemini) · typecast · elevenlabs · googletts` 각각을 `ApiKeyField` 행으로 세로 나열.
- 기존 `TtsKeyTab.jsx` 및 탭 정의([SettingsModal.jsx:18-25](../../src/components/SettingsModal.jsx#L18)) 제거, 탭 id `ttsKey` 삭제. `openSettings('ttsKey')` 호출부는 `openSettings('apiKey')`로 이관.
- Gemini 행에는 기존 안내(Gemini TTS가 이 키를 재사용) 문구 유지.
- 데이터 흐름: 각 행이 자기 provider의 `keys:status`/`genai:*`를 독립 구독. 한 행의 저장이 다른 행에 영향 없음.

### 4.3 오디오 생성 pre-flight 게이트

- 위치: renderer(StoryView), 오디오 생성 트리거 직전([buildAudioParams](../../src/components/story/StoryView.jsx#L1077) 흐름 / `regenerateSegment`).
- 필요 provider 집합 계산: 대본 화자 목록 → 각 화자의 **effective provider**(선택된 voiceId의 provider, 미선택이면 기본 `typecast` — [useStoryVoiceSelection.js:31-37](../../src/hooks/useStoryVoiceSelection.js#L31), [story-api.js:68](../../electron/ipc/story-api.js#L68)) → 중복 제거.
- 각 provider의 `hasKey`를 `keys:status`(genai는 `genai:status`)로 확인. 없는 provider가 하나라도 있으면 **생성 시작 안 함** + 게이트 UI 표시(4.1 `ApiKeyField`를 없는 provider마다). 입력·저장되면 재확인 후 진행.

### 4.4 VoicePicker 게이트

- 위치: [VoicePicker.jsx](../../src/components/story/VoicePicker.jsx) / 열기 경로 `voiceSel.openVoicePicker(sp)`.
- 성우 목록 로드 전에 해당 화자 provider의 `hasKey` 확인. 없으면 `listVoices()` 호출하지 않고 `ApiKeyField`(그 provider) 표시. 저장되면 목록 재로드.
- 이렇게 하면 대부분의 사용자가 성우 선택 단계에서 이미 키를 넣게 되어, 4.3 게이트는 안전망이 된다.

### 4.5 런타임 안전망 (errorKind)

pre-flight를 통과해도 런타임에 키가 무효/폐기될 수 있다. missing-key throw에 `errorKind: 'story-audio-no-tts-key'`를 부여([stepMachine.js:1690](../../electron/story/stepMachine.js#L1690) catch가 errorKind 보존)하고, ko 로케일에 안내 문구 + `resolveDisplayError`가 이 kind면 "키 설정" 유도 문구를 보이게 한다. (raw 영어 문자열 제거.)

### 4.6 테스트용 "키 없음" 재현 (dev 전용)

- env 스위치 `AUTOFLOWCUT_DISABLE_KEY_FALLBACK=1`이면 [typecastKey.js](../../electron/api/tts/typecastKey.js)/`credentialsKey.js`의 env·`~/.<svc>/credentials` 폴백을 무시하고 설정 store만 본다. dev에서 설정 키를 비우면 진짜 "키 없음"이 재현된다.
- 단위 테스트는 `getKey` mock으로 폴백 자체를 우회하므로 이 스위치와 무관하게 게이트 로직을 검증한다.

## 5. 에러 처리

- pre-flight/VoicePicker 게이트: 정상 흐름(에러 아님) — 안내 UI로 처리, 콘솔 에러 없음.
- 런타임 missing-key: `errorKind='story-audio-no-tts-key'` → 로케일 번역된 안내 + 설정/입력 유도.
- 저장 실패(암호화 불가 등): 기존 hook의 `{success:false, error}` 표시.

## 6. 테스트 전략

- **단위**: `ApiKeyField`(provider별 hook 분기, 저장 후 상태 갱신), pre-flight 필요-provider 계산(화자→provider 집합, 누락 감지), VoicePicker 게이트(hasKey=false면 listVoices 미호출), errorKind 부여/번역.
- **통합**: 키 없음 → 게이트 표시 → 입력·저장 → 진행되는 흐름(mock IPC).
- **실앱 눈검증**: `AUTOFLOWCUT_DISABLE_KEY_FALLBACK=1`로 키 없는 상태 만들고 VoicePicker·오디오 생성·설정 통합 탭 확인.

## 7. 미해결/확인 필요

- `ApiKeyField` 최종 파일명/위치.
- 게이트 UI를 인라인(카드 내부)로 할지 작은 모달로 할지 — 기본 인라인(모달 최소화).
- 테스트 재현을 env 스위치로 할지 설정 UI 토글로 할지 — 기본 env 스위치.
