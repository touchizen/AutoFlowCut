# Story — 성우 카드 피커 + 미리듣기 + F0 성별 자동 태깅 (Spec)

**날짜**: 2026-07-06
**브랜치**: `feature/story-pipeline` (base `b9b62a5`)
**상태**: 설계 확정(brainstorm + 목업 승인) → Codex 방향리뷰 대기
**목업**: 승인됨 (실제 Typecast 음성 4개 재생 + F0 성별 태깅 시연 완료)

## 0. 목표 (한 줄)

story > audio 탭의 성우 선택을 **드롭다운 → 모달 카드 피커**로 바꾸고, **미리듣기(▶)**를 중심에 둔다. Typecast는 **라이브 1129개** 목록, 성별은 Gemini(웹 매핑)·ElevenLabs(API)는 확정 표시, **Typecast는 미리듣기 오디오의 F0 분석으로 자동 태깅**(보너스, 추가 비용 0).

## 1. 문제 진단 (조사 결과 — 사실)

- **Typecast**: 공식 `/v1/voices` 실재 → **1129개** 반환. 필드는 `voice_id / voice_name / model / emotions / voice_type`뿐, **gender·language·previewUrl 없음**. 현재 앱은 하드코딩 9개(`KNOWN_VOICES`)만 노출.
- **ElevenLabs**: 코드는 이미 라이브(`/v2/voices` + `/v1/shared-voices` + 검색). 지금 6개만 뜨는 원인 = **API 키에 `voices_read` 권한 없어 401** → seed 폴백. **코드 아님, 키 문제.**
- **Gemini**: 프리빌트 **고정 30개**(목록 API 없음이 정상). gender 공식 라벨 없음 → 웹 소스로 남/여 확보(29 합의, Pulcherrima 1개만 상충 → 미상 처리).
- **성우 미리듣기**: 앱에 없음. `synthPreview`는 세그먼트 단건 합성이지 성우 샘플 미리듣기가 아님 → **새 액션 필요**.
- **F0 성별 판별**: numpy autocorrelation으로 시연 성공 — Joonkyu 132Hz→남, Hanyoung 180Hz→여, Sanghyun 151Hz→남, Seohyeon 214Hz→여. 임계값 ~165Hz. 겹침 구간 오분류 가능 → "추정" 표기.

## 2. 확정된 설계 결정 (brainstorm)

| 결정 | 선택 | 근거 |
|---|---|---|
| UI | **모달 카드 피커**(StylePicker 패턴) | 드롭다운·검색 불편. 카드+미리듣기가 성우 선택에 맞음. |
| 미리듣기 | **중심 기능** | 성별보다 목소리 청취가 본질. |
| 미리듣기 소스 | ElevenLabs=`preview_url` 즉시 / Typecast·Gemini=**온디맨드 합성 + 캐시** | preview URL 없는 provider는 짧은 고정 문장 합성, voiceId별 캐시(처음만 지연). |
| 성별 | Gemini(웹 매핑)·ElevenLabs(API) 확정 / Typecast=**F0 자동 태깅** | Typecast는 API가 gender 미제공. 미리듣기 합성 오디오를 F0 분석해 태깅. |
| F0 태깅 시점 | **미리듣기 시 재활용** | 어차피 합성/재생하는 오디오를 분석 → 추가 비용 0. 안 들은 성우는 미상 유지. |
| Typecast 목록 | **라이브 1129개** + seed 9개 gender 오버레이 | 하드코딩 제거. seed는 gender/emotion 보강. |
| ElevenLabs 확장 | **키 권한(`voices_read`)은 사용자 액션** | 코드 범위 밖. spec에 안내만. |
| F0 정확도 한계 | **"추정" 표기 + 신뢰구간** | 165Hz 경계(저음여/고음남)는 오류 가능 → 확정 아님 명시. |

## 3. 아키텍처

```
[VoicePicker 모달]  ── provider 칩 · 성별 세그먼트 · 검색 · 카드 그리드
     │  ▶ 미리듣기 클릭
     ▼
useVoicePreview(hook) ── (1) 오디오 확보  ──► IPC tts:preview-voice
     │                        · ElevenLabs: preview_url fetch
     │                        · Typecast/Gemini: 합성 + 디스크 캐시
     │  (2) 재생 (renderer Audio)
     │  (3) F0 분석 (renderer Web Audio) ──► 성별 추정
     ▼                                            │ voiceId+gender+f0
   카드 성별 라벨 갱신 ◄──────────────────── IPC tts:tag-voice-gender (persist)
```

**F0 분석은 renderer(Web Audio)에서** — 미리듣기 오디오가 이미 renderer에 있고 main 왕복 불필요. 결과(성별)만 IPC로 main에 넘겨 캐시 persist.

## 4. 컴포넌트별 변경

### 4.1 Typecast 라이브 목록 (electron/api/tts/typecast.js)
- `listVoices()` 동기 → **`async listVoices()`**: `GET /v1/voices` (헤더 **`x-api-key`** — 기존 synthesize와 동일 소문자) → `normalizeTypecastVoice`로 매핑.
  - **응답 형태(관측)**: 최상위 **JSON 배열**(래퍼/페이지네이션 없음, 1회 응답에 전체). 항목: `{ voice_id, voice_name, model, emotions, voice_type }`. **fixture**: `tests/fixtures/typecast-voices.json`(실제 응답에서 축약 캡처 ~20개). 개수는 **"현재 관측치"**(테스트에 `1129` 하드코딩 금지 — fixture 길이로 검증).
  - **timeout/폴백**: fetch 15s timeout, 실패/키없음 → `KNOWN_VOICES` 폴백(현행 안전). 배열 아님/파싱 실패도 폴백.
  - `{ id: voice_id, name: voice_name, language: 'ko'(기본), previewUrl: null, traits: [], model, emotions, gender: null, source: 'live' }`.
  - **seed 오버레이(어댑터 내부)**: `KNOWN_VOICES`(9개)의 **gender 확정값**을 id 매칭으로 덮어씀(`gender:'male'/'female'`, `genderSource:'seed'`, source 'seed' 유지). — 이건 어댑터가 자기 seed로 아는 값이라 여기서 처리.
  - key 없음/실패 → `KNOWN_VOICES` 폴백(현행 안전).
  - **주의**: app-global F0/manual gender 캐시 오버레이는 여기가 **아니라** main.js `listVoices` 래퍼(§4.5) — 어댑터는 `getKey/fetch`만 알고 캐시를 모름 (Codex #4).
- `synthesize`는 무변경. `previewVoice`(§4.3)에서 미리듣기는 `emotion:'normal'` 고정.

### 4.1b Voice 결과 shape 확장 (Codex #5)
- 정규화 계약(현 `id/name/language/previewUrl/traits/source`)에 **구조화 필드 추가**: `gender:'male'|'female'|null`, `genderSource:'adapter'|'seed'|'manual'|'f0'|null`, `f0:number|null`, **`confidence:'high'|'low'|null`**(number 아님 — enum으로 통일, cache/IPC/tests 동일). `traits`는 검색/backcompat 유지(gender를 traits에 미러 안 함 — UI는 `gender` 필드 사용).

### 4.2 Gemini 성별 매핑 (electron/api/tts/gemini.js)
- `KNOWN_VOICES` 30개에 **구조화 `gender:'female'/'male'` + `genderSource:'adapter'`** 필드 추가(§4.1b shape — `traits`가 아니라 `gender` 필드). **Pulcherrima는 `gender:null, genderSource:null`**(소스 상충 → 미상, F0 태깅 대상 — adapter 아님이라 §4.4 스킵에 안 걸림).
- **ElevenLabs normalizer도 동일** (elevenlabs.js): API `labels.gender`/`gender`를 `gender`+`genderSource:'adapter'` 필드로 채움(현재 traits에만 들어감 → gender 필드 추가). traits는 검색용 유지.
- 여성(13): Zephyr, Kore, Leda, Aoede, Callirrhoe, Autonoe, Despina, Erinome, Laomedeia, Achernar, Gacrux, Vindemiatrix, Sulafat.
- 남성(16): Puck, Charon, Fenrir, Orus, Enceladus, Iapetus, Umbriel, Algieba, Algenib, Rasalgethi, Alnilam, Schedar, Achird, Zubenelgenubi, Sadachbia, Sadaltager.

### 4.3 성우 미리듣기 — main-side preview service (electron/api/tts/voicePreviewService.js)
어댑터에 `previewVoice`를 넣지 않는다(어댑터는 `synthesize` 기존 계약 유지, `{audio, format}`). 대신 **main에 preview service**가 어댑터를 래핑 (Codex indep #5).

- **`story:tts-preview` 재사용 금지**: 세그먼트/프로젝트 스코프(projectToken guard, `scenes.json` mutation). 성우 미리듣기는 **별도 IPC**.
- **IPC 위치 (indep #4)**: `story-api`(guarded) 아님 → **`tts-api.js`에 `tts:preview-voice`** (또는 전용 preview IPC 모듈). 입력 검증: `provider ∈ STORY_TTS_PROVIDERS`, `voiceId` 길이/charset, `language ∈ {ko,en}`.
- **service API**: `getVoicePreview({ provider, voiceId, language }) → { audioBase64, mimeType }`.
  1. 디스크 캐시 확인 → 히트면 즉시 반환.
  2. **in-flight dedupe**: 같은 키 동시 요청은 한 Promise 공유.
  3. ElevenLabs면 `voiceMetaCache`의 `previewUrl` 조회 → **SSRF-safe fetch**(아래). 없으면 synth 폴백.
  4. Typecast/Gemini면 고정 문장(ko `"안녕하세요, 반갑습니다."`, en `"Hello, nice to meet you."`)을 `ttsFor(provider).synthesize({text, voiceId, emotion:'normal'})`.
  5. `format→mimeType/ext` 매핑(wav→audio/wav, mp3→audio/mpeg). **atomic write**(tmp→rename)로 디스크 캐시.
- **voiceMetaCache** (main): `provider:voiceId → { previewUrl, language }`, `listVoices` 래퍼가 채움. preview IPC는 `voiceId`만 받고 main이 자체 조회 → **renderer가 URL 안 넘김**.
- **SSRF 방어 (indep #2, BLOCKER)**: preview_url fetch는 `ssrfSafeFetch`로 —
  - `https:`만 허용, **host allowlist**(elevenlabs.io / ElevenLabs CDN 도메인) 또는 미매치 시 synth 폴백.
  - **redirect 수동 처리**(`redirect:'manual'`) — 리다이렉트 타깃도 재검증, private/loopback IP(10./127./169.254./::1 등) 차단.
  - **byte cap**(예: 5MB) + **MIME 화이트리스트**(audio/*) + fetch timeout(15s).
- **디스크 캐시**: `<userData>/voice-preview/<sha256(provider:voiceId:language)>.<ext>` — **해시 파일명**(path traversal/특수문자 방지). language가 오디오에 영향 → 키 포함.
- **반환**: `{ audioBase64, mimeType }` (renderer가 Blob/ArrayBuffer 구성).
- **키 없음/401 (indep #6)**: synth 폴백 경로도 키 필요 → 실패 시 `{ error: 'no-key'|'unauthorized'|'failed', provider }` 반환. **무한 로딩 금지** — 카드 ▶는 error 상태(툴팁: provider별 메시지)로 전이.
- **취소/직렬화**: `AbortSignal`은 IPC 못 건넘 → **requestId(seq) stale-drop**: renderer가 요청마다 seq 증가, 최신 seq 아닌 응답 폐기 + 이전 `Audio` 정지.

### 4.4 F0 성별 분석 (src, renderer)
- **`src/utils/voiceGender.js`**: `estimateGenderFromPcm(float32, sampleRate) → { gender: 'male'|'female'|null, f0: number|null, confidence }`.
  - 프레임(40ms/hop 20ms), RMS 게이트(무음 스킵), autocorrelation로 F0(80~400Hz), 주기성 임계 0.3, 유효 F0 중앙값.
  - **분류(경계 명확화, R2 #3)**: 유성 프레임 부족 → `gender:null`(태깅 안 함). 그 외 **항상 `165Hz`에서 이분**: `<165`→`male`, `≥165`→`female`. **confidence**: `<150 || >185`면 high, `150~185`(겹침대)면 low(라벨은 붙되 "추정" 강조 + 수동정정 유도). → `gender`는 enum(male/female)이거나 null만, persist enum 검증과 정합.
- **hook `useVoicePreview`**: 미리듣기 오디오를 `AudioContext.decodeAudioData` → 멀티채널이면 채널0(또는 다운믹스) → `estimateGenderFromPcm` → 결과. **AudioContext는 사용 후 `close()`**(리소스 누수 방지), 재사용 시 단일 컨텍스트 lazy.
- **F0 태깅 스코프 (indep #8)**: **`genderSource`가 `adapter`/`seed`인 voice는 F0 태깅/`tag-voice-gender` 호출 안 함**(확정 라벨 보존). F0 자동 태깅은 gender 미상 voice만.
- **수동 오버라이드 스코프 (R2 #2)**: 고정(`adapter`/`seed`)만 숨김 → **non-fixed(`genderSource: null | 'f0' | 'manual'`)엔 항상 노출**. 즉 F0 '추정' 라벨은 물론 이미 수동 지정한 것도 다시 ♀/♂로 정정 가능(오분류 교정 경로 보존, `manual`끼리는 최신이 덮음).
- 오분류 방지: confidence low면 라벨에 "추정" 강조.
- **테스트 목**: `Audio`/`AudioContext`(decodeAudioData) mock. `estimateGenderFromPcm`은 순수 함수라 합성 사인파로 결정적 검증.

### 4.5 성별 태깅 persist + 오버레이 (electron main, 앱 전역) — Codex #4
- **`electron/api/tts/voiceGenderCache.js`**: `{ [provider:voiceId]: { gender, f0, confidence, source: 'f0'|'manual' } }` — 앱 userData의 json. 프로젝트 무관(성우는 전역). keyStoreMulti류 앱 전역 저장과 동일 계층.
- **IPC** `tts:tag-voice-gender`(tts-api, indep #4) → `{ provider, voiceId, gender, f0, confidence, source }` (`source:'f0'|'manual'`, main이 F0/수동 구분; gender enum·f0/confidence 검증) → 캐시 저장. `manual`은 `f0` 캐시보다 우선하되 `adapter`/`seed` 확정값은 덮지 않음(순서와 일치).
- **오버레이는 순수 모듈로 추출 (indep #9)**: **`electron/api/tts/genderOverlay.js`**의 `applyGenderOverlay(provider, voices, cache) → voices'` (순수 함수, side effect 없음 → 단위 테스트 가능). main.js는 이 모듈을 호출만.
  - **순서(R2 #3)**: `genderSource:'adapter'|'seed'`(확정 — 동급) > `manual` > `f0` 캐시 > 미상. 결과 voice의 `gender/genderSource/f0/confidence` 채움. **확정(adapter/seed) voice는 캐시가 못 덮음.**
  - 배선: `listVoices: async (provider, options) => { try { return await ttsFor(provider).listVoices(options) } catch { return [] } }` (main.js:242) → `const raw = await ttsFor(provider).listVoices(options); try { return applyGenderOverlay(provider, raw, cache) } catch { return raw }`.
  - **실패 경계 (R2 #7)**: 오버레이/캐시 read 에러는 **raw voices로 degrade**(빈 `[]` 금지). voiceMetaCache 채우기도 여기서(previewUrl/language).

### 4.6 VoicePicker 모달 (src/components/story/VoicePicker.jsx + .css)
- StylePicker 패턴. props: `{ voices, selected:{provider,voiceId}, onSelect, onPreview, onTagGender, t, isKo }`.
- **필터**: provider 칩(전체/Typecast N/Gemini/ElevenLabs) + 성별 세그먼트(전체/♀/♂) + 검색(이름·특성).
- **대용량 렌더 (indep #7)**: 새 의존성 없이 **render cap + "더 보기"** — 필터/검색 결과를 초기 `RENDER_CAP`(예: 120)개만 렌더, 하단 [더 보기]로 증분. 검색은 필터가 목록을 좁히므로 cap 충분. (가상화 라이브러리 도입 안 함 — YAGNI.) main 목록은 TTL 캐시(재진입 시 재fetch 회피).
- **카드**: 미리듣기 ▶(idle/loading/playing/**error** 상태) + 이름 + 성별(♀/♂/— 미상, 색 구분) + 언어 + 특성 태그 + provider 배지. 선택 시 ring.
- **기본 성우 옵션 (indep #3)**: 그리드 맨 앞 **[기본 성우] 카드**(선택 시 `voiceId: ''` → backend defaultVoice 폴백, StoryView L553 clear 경로 유지).
- **미리듣기 상호작용**: ▶ → onPreview(재생) → 끝나면 **미상 카드만** F0 성별 자동 라벨 갱신(파랑 반짝). error면 ▶ error 상태 + provider별 툴팁(무한 로딩 금지). 성별 **수동 오버라이드**(우클릭/롱프레스 ♀/♂) → onTagGender manual — **non-fixed(null/f0/manual) voice에 노출**, 고정(adapter/seed)만 숨김.
- 하단: 선택 표시 + [이 성우로 지정]/[취소].
- i18n `story.voicePicker.*` (ko+en).

### 4.7 StoryView 통합 (src/components/story/StoryView.jsx) — Codex #6
- 기존 성우 드롭다운(`<option>` 렌더 ~L1173, 로직 ~L520-554) → **[성우 선택] 버튼 → VoicePicker 모달** 오픈. 화자별 버튼에 현재 성우명 표시.
- 모달 `onSelect({provider, voiceId})`는 **`providerBySpeaker[sp.id]`와 `voiceBySpeaker[sp.id]` 둘 다** set (StoryView는 provider/voice를 별도 state 맵으로 보유, ~L241). **빈 voiceId="기본 성우"** 는 명시 보존 → 기존 `sp.voice` clear 경로 유지(L553).
- audio 스텝 params 계약 무변경(`params.speakers[].voice = {provider, voiceId}`, L547 회귀 고정).
- App.jsx의 `ttsListVoices` 로딩은 유지 — main 래퍼가 gender 오버레이를 실어 반환.
- **F0/manual 태깅 후 renderer state sync (indep #3, BLOCKER)**: `App`이 `ttsVoices`를 소유(`mergeTtsVoices`, App.jsx). VoicePicker의 `onTagGender({provider, voiceId, gender, f0, confidence, source})` → (1) IPC `tts:tag-voice-gender` persist, (2) **`mergeTtsVoices`로 해당 voice의 gender optimistic 갱신**(재fetch 없이 카드/필터 즉시 반영). App이 이 콜백을 VoicePicker에 전달. 다음 story 재진입 시 오버레이가 캐시로 동일 gender 재적용.

### 4.8 ElevenLabs 키 권한 (사용자 액션, 코드 아님)
- spec/README 안내: ElevenLabs 대시보드 → API Key → **`Voices: Read` 권한 활성화**. 없으면 seed 6개 폴백(현행). 코드 변경 없음.

## 5. TDD 슬라이스 (RED → GREEN 순서)

1. **데이터 레이어 (순수/어댑터, UI 없음)**
   - Typecast `listVoices` 라이브(async): fetch mock + `tests/fixtures/typecast-voices.json` → 정규화, seed gender 오버레이(어댑터 내부), key없음/파싱실패/timeout 폴백. **`typecast.test.js:34` 동기 호출 `await`로 갱신**(옛 동작 고정). 개수는 fixture 길이(하드코딩 X).
   - Gemini `KNOWN_VOICES`: `gender`+`genderSource:'adapter'`(여13/남16, Pulcherrima null). ElevenLabs normalizer: `gender`+`genderSource` 필드.
   - `voiceGenderCache` get/set(+source) + corrupt json degrade.
   - **`genderOverlay.js` 순수 함수**: `adapter|seed > manual > f0 > 미상`, 확정값 불변, 미상만 캐시 적용, 필드 채움.
2. **F0 분석** (순수 함수, 결정적)
   - `estimateGenderFromPcm`: 합성 사인파(120→male, 210→female, 무음→null, 경계 170→low confidence). 실측 4샘플 PCM fixture 회귀. 다운믹스.
3. **미리듣기 service + IPC**
   - `voicePreviewService.getVoicePreview`: 캐시 히트/인플라이트 dedupe, EL previewUrl(ssrf-safe fetch: https/allowlist/redirect/사설IP차단/byte·MIME cap), TC/GM 합성, format→mime/ext, atomic write, no-key/401→error. **`ssrfSafeFetch` 순수 검증 단위 테스트**.
   - IPC `tts:preview-voice`/`tts:tag-voice-gender`(입력 검증) + contextBridge(`ttsPreviewVoice`/`ttsTagVoiceGender`) 배선.
4. **VoicePicker 컴포넌트**
   - 필터(provider/성별/검색), render cap + 더보기, [기본 성우] 카드, 카드 렌더, 선택 콜백(provider+voiceId), 미리듣기 상태(idle/loading/playing/error) 전이, F0 후 미상만 자동 라벨, 수동 오버라이드(non-fixed=null/f0/manual 노출, adapter/seed 숨김). `Audio`/`AudioContext` mock.
5. **StoryView + App 통합**
   - 드롭다운 → 모달 버튼, 선택 반영(`providerBySpeaker`+`voiceBySpeaker`, 빈=기본 보존), audio params 계약 유지(회귀). App: `onTagGender` optimistic `mergeTtsVoices` + persist. 통합 커밋(옛 드롭다운 1129 렌더 회피).

## 6. 비목표 (YAGNI)

- 1129개 전수 배치 합성/성별 분류 — 안 함(온디맨드만).
- Typecast 웹 스크래핑/스샷 매핑 — 안 함(F0로 대체).
- ElevenLabs 키 권한 자동화 — 안 함(사용자 대시보드).
- 미리듣기 문장 커스터마이즈, 성우 즐겨찾기 — 후속(이 spec 범위 밖).
- 런타임 웹검색 — 안 함(Gemini gender는 정적 매핑).

## 7. 리스크 / 확인 필요

- **출시 순서**: 라이브 Typecast(관측 ~1129개)를 **모달과 함께** 머지. 옛 드롭다운은 provider voice를 전부 `<option>` 렌더(StoryView.jsx:1173) → 라이브만 먼저 나가면 대량 option 렌더로 버벅임 → 슬라이스 1~5를 **한 번에 완성 후** 통합 커밋.
- **초기 로딩**: Typecast 대량 fetch 지연 → main 목록 TTL 캐시 + App 로딩 UX. 모달은 render cap + 더보기(§4.6).
- **F0 정확도**: 경계 성우 오분류 → "추정" + 미상 수동 오버라이드로 완화.
- **미리듣기 비용**: 온디맨드+디스크캐시로 최소화. Gemini 미리듣기는 genai 키 필요(이미지 생성과 공유).
- **preview_url 유무**: ElevenLabs voice별 preview_url 필드 실재 확인(shared는 대개 있음). 없으면 synth 폴백.
