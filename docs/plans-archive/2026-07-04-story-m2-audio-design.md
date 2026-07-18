# Story M2 — 오디오/TTS 설계 스펙 (ffmpeg 폐기 재작성)

**날짜**: 2026-07-04 (v2 — Codex 설계 리뷰 findings 8건 반영)
**상태**: 승인 — 구현 플랜 작성 단계
**대상**: AutoFlowCut (AutoCraft Studio) — 배포용 정식 기능
**관계**: 원 스펙 `2026-07-02-story-pipeline-design.md`의 **§4-③(오디오)와 그에 종속된 등록 흐름을 대체**한다. 나머지 절(§1·§2 race 가드·§4-①②④ push 계약·§6 IPC)은 그대로 유효하되, 이 문서가 명시적으로 갱신하는 지점(storyId 발급 시점·audio 등록 흐름·재TTS 정책)은 이 문서가 우선한다.

---

## 1. 배경 — 왜 재작성했나

원 스펙 §4-③은 세그먼트별 TTS를 **ffmpeg으로 concat**해 `full_narration.mp3` 한 덩어리를 만들고, 이를 기존 오디오 패키지 스캐너(`useAudioImport.importByPath` → `audioPackage` → `story:audioReady`/`audioAck`/`registration`)로 등록하는 구조였다. ffmpeg 번들이 릴리스 블로커였다.

**핵심 결정(사용자 합의): ffmpeg 불필요.** AutoFlowCut은 최종 렌더러가 아니라 **CapCut/Premiere/Vrew 프로젝트 생성기**다. TTS 세그먼트 오디오를 합치지 않고 **export 타임라인에 개별 클립으로 배치**하면 렌더링은 편집기가 한다. concat·정규화·ffmpeg 불필요. → **full_narration.mp3 + 스캐너 등록 흐름 전체가 새 구조에서 무효**가 되므로, 이 문서는 그 대체 계약(§7 manifest)까지 정의한다.

여기에 더해 브레인스토밍에서 드러난 근본 문제를 함께 해결한다: M1의 씬 분할이 **글자수 추정(부정확)** 위에 모든 것을 쌓아 대략적이었다. M2는 **TTS 실측 시간을 timing의 유일한 기준**으로 삼는다.

---

## 2. 핵심 원칙 — SRT(TTS 실측)가 timing의 유일한 소스

```
TTS 세그먼트 생성 → 세그먼트별 정확한 실측 길이 → SRT (단일 소스)
                                                    │
                    ┌───────────────────────────────┼───────────────────────────┐
              세그먼트 오디오 배치              씬 경계·duration          (v2) SFX 배치
              (나레이션 export)              (이미지/영상 길이)        (SRT 축 위에)
```

- **timing은 TTS 생성 결과에서만 나온다.** TTS 이전엔 어떤 확정 타이밍도 없다(글자수 추정은 대략 모드 폴백일 뿐).
- SRT·세그먼트 배치·씬 duration은 모두 이 하나의 실측 결과에서 파생한다. 독립 계산하면 재생성 시 드리프트가 나고 씬이 틀어진다.
- **TTS 재생성 → SRT 변경 → 씬·배치 재정렬.** 단, 재정렬이 **씬 멤버십(어느 세그먼트가 어느 씬에 속하는지)을 바꾸는지**에 따라 push 방식이 갈린다(§4 "재TTS 정책"). 이 구분이 원 스펙 §4-④ timing-only push와 정합하는 핵심이다.

---

## 3. 파이프라인 순서 변경 — audio가 prompts 앞으로

```
M1:  scenes(글자수 추정, storyId 즉시 발급) ──────────→ prompts/이미지        (대략)
M2:  scenes(세그먼트 id 발급 + 잠정 그룹) → audio(TTS 실측 → 씬 확정 → storyId 발급) → prompts/이미지
```

- 스텝 머신 의존성(정밀 모드): `script → scenes → audio → prompts`.
- **storyId 발급 시점 이동 (HIGH1 대응)**: ②는 **세그먼트 id만 발급**(불변, identity 기준). **씬 storyId는 ③audio가 재그룹으로 씬을 확정한 뒤 발급**한다 — 재그룹이 씬 경계를 바꾸기 전에 storyId를 발급하면 identity가 깨지기 때문. prompts/push는 확정된 storyId를 쓴다.
- **대략 모드**: audio 스킵 경로. 이때만 ②가 **잠정 storyId**를 발급하고 글자수 추정 duration(`buildFallbackTimeline`)으로 push한다. 이후 사용자가 audio를 실행하면 정밀 모드로 승격되며 §4 승계 규칙으로 storyId를 재정렬한다.

> 원 스펙 §4-④ "③ optional, prompts 선행 아님"은 **정밀 모드에서 audio를 prompts 선행으로 승격**하는 것으로 갱신. 대략 모드에서만 스킵 가능.

---

## 4. 세그먼트 / 씬 모델 + identity

### 세그먼트 = 타임라인 원자

`scenes.json`의 `segments[]`가 두 타입을 갖는다:

```json
{ "id": "s001-1", "type": "narration", "speaker": "narrator", "emotion": "normal", "text": "...",
  "audioPath": null, "durationMs": null, "startMs": null, "status": "pending" }
{ "id": "s001-2", "type": "sfx", "description": "문 여는 소리 끼익", "sourceMode": "placeholder",
  "audioPath": null, "durationMs": null, "startMs": null, "status": "pending" }
```

- `type`: `narration`(TTS) | `sfx`(효과음). **`type` 없으면 `narration`으로 간주**(additive, 하위호환).
- **세그먼트 `id`는 ②에서 발급하는 불변 identity.** **발급은 M2a-1**(위치 기반 결정론 `s{sceneIdx+1}-{segIdx+1}`, safe-filename 패턴 `^[A-Za-z0-9_-]+$` 강제 — 파일명 path traversal 방어). **승계는 M2a-2** — ② 재실행 시 정규화 텍스트 완전/포함 일치 + 1:1 제약으로 세그먼트 id를 승계(원 스펙 §4-④ storyId 매칭 규칙을 세그먼트 레벨로 적용)해 재실행 identity 안정성을 확보. M2a-1은 위치 기반이라 세그먼트 삽입/재정렬 시 id가 재사용될 수 있음(첫 실행엔 무해, 재실행 안정성은 M2a-2 승계로 해결).
- `type:'sfx'`(M2b): 세그먼트 시퀀스의 자기 자리를 차지 — 나레이션과 같은 레벨의 원자라 word-level timestamp 불필요.
- `audioPath`·`startMs`·`durationMs`·`status`(`pending|done|error`)는 ③audio에서 채워짐.
- **maxChars 초과 처리 (MED7)**: provider 최대 길이를 넘는 narration은 ②에서 **문장 경계로 자식 세그먼트(s001-1a, s001-1b …)로 분할**해 방출한다 — 각 자식이 **독립 타임라인 원자**(자기 TTS·startMs·SRT 라인)다. 오디오를 이어붙이지 않는다(concat 없음 원칙 유지).

### 씬 = 세그먼트 그룹, identity는 그룹 구성에서 파생

- **씬 identity(storyId) = 그룹을 구성하는 세그먼트 id 집합에서 파생.** ③audio가 재그룹으로 씬을 확정할 때 발급.
- ②씬분할: 세그먼트 시퀀스 + **잠정 그룹**(글자수 추정, storyId 미발급).
- ③audio: 세그먼트 실측 후 **목표 6~10초로 재그룹핑** → 씬 확정 → storyId 발급. duration = 그룹 내 세그먼트 실측 구간 합.
- 재그룹 규칙: 세그먼트 **순서 보존**, 세그먼트 쪼개지 않음(원자). **`minMs` 도달 시 마감이 지배 규칙**이고 min/max 판정은 **gap 포함 span**(`startMs` 기반)으로 한다. 단일 세그먼트가 10초 초과면 단독 씬. **화자 변경 경계 강제 분리는 후속(v2)** — minMs 마감 규칙이 우선하므로 M2a-1은 화자 경계를 별도 강제하지 않는다(화자별 트랙이 들어오는 v2에서 실 필요성과 함께 재검토).
- **storyId 승계 (HIGH1)**: audio 재실행/재그룹 시, 새 그룹의 세그먼트 id 집합이 이전 씬의 집합과 **동일하면 storyId 승계**, 다르면(멤버십 변화) **새 storyId = 신규 씬**(이전 씬은 원 스펙 §4-④ 삭제 후보 → 확인). invariant: 확정 scenes.json 내 storyId 유일(push 전 검증).

### 재TTS 정책 (HIGH4 — timing-only vs full push)

TTS 재생성(개별 세그먼트 voice/감정 변경 등) 후:

| 재그룹 결과 | push 방식 | 근거 |
|---|---|---|
| 씬 멤버십 **불변**(세그먼트 id 집합 동일), 길이만 변화 | **timing-only push** — `startTime/endTime/duration/srtLineIds/srtTrack`만 갱신, 프롬프트·이미지 보존. duration ±0.5s 초과 변화 씬은 `staleVideo` | 같은 storyId upsert → stale 플래그가 실제 씬에 안착(원 스펙 §4-④) |
| 씬 멤버십 **변화**(재그룹으로 경계 이동) | **audio는 push하지 않는다 — no-push 대기 전이 (아래)**. 사용자가 **prompts 재실행** → 신규 씬 프롬프트 생성 후 **prompts가 full push emit**(새 그룹=신규 storyId 씬, 겹치는 옛 storyId 씬=원 스펙 §4-④ 삭제 후보로 생성물 보존 선택지, **stale 미사용**) | 신규 storyId=신규 씬이라 프롬프트가 없어 audio 단독 push 불가. stale은 같은 storyId에만 유효하므로 멤버십 변화엔 부적용(HIGH 신규1) |

**멤버십 변화 시 no-push 대기 전이 (HIGH 신규 — 상태 명시):** audio 재실행이 멤버십을 바꾸면 audio는 push하지 않고 다음 상태로 두고 종료한다 —
- `steps.prompts` → **`pending`(needs-rerun)** 로 리셋(원 스텝머신 DOWNSTREAM 리셋과 동일 성격 — audio 재그룹이 prompts 입력을 바꿨으므로).
- `manifest.pushRevision` → **`null`** 유지 → export 정합 검사에서 **차단**(옛 acked 오디오가 새 씬과 짝지어지는 것 방지).
- `pendingPushRevision` → **증가 안 함**(push를 안 하므로).
- 이후 사용자가 prompts 재실행하면 prompts가 `pendingPushRevision++` + manifest 재스탬프 + full push(§7 revision 프로토콜).

즉 "TTS 재생성이 씬을 조용히 틀어지게" 만드는 경로를 차단하고, 멤버십이 바뀌면 **prompts 재실행이 강제**되어 신규/삭제로 정직하게 드러난다(옛 프롬프트/이미지 자동 이월 없음).

---

## 5. audio 스텝 (신규 — ffmpeg 없음)

`electron/story/` + `electron/api/tts/` 신규. main process 스텝 머신 소유.

**절차:**
1. **세그먼트별 TTS 생성** — provider 어댑터(§6). 세그먼트 병렬(provider별 동시성 제한), 실패 세그먼트만 개별 재시도. 산출물 `story/audio/segments/<segmentId>.mp3`.
2. **실측 길이 측정** — `music-metadata`(순수 JS)로 `durationMs`. (provider가 timestamp 주면 우선; 세그먼트 단위라 파일 길이면 충분.)
3. **타임라인 산출** — 세그먼트 순서대로 누적 + 갭(기본 0.15s) → 각 세그먼트 `startMs`. 이것이 SRT의 정확한 시간.
4. **SRT 생성** — narration 세그먼트 1개 = 자막 1라인(sfx 제외). 라인 id는 세그먼트 id에서 결정론적 발급(§7). `final.srt` + `manifest.json`.
5. **씬 재그룹 + storyId 발급 + duration 확정** — §4.
6. **concat 안 함.**

**write safety (MED6):**
- 오디오 바이너리는 **temp 파일 → rename**(storyStore의 `writeAtomic` 패턴을 바이너리로 확장). 부분 쓰기 노출 금지.
- 세그먼트별 `status`(pending/done/error) 기록 → 부분 재시도 시 done만 skip, 실패분만 재생성. 재생성 성공 시 옛 파일/duration 교체.
- **모든 provider 호출 직후 `signal.aborted` 검사 후에만 commit**(원 스펙 §2 race 가드, stepMachine `isStale()` 패턴 준수). 프로젝트 전환 토큰 불일치 시 파일 쓰기 skip.
- `manifest.json` + `scenes.json` + `story.json` 갱신은 **하나의 복구 가능한 순서**로: 세그먼트 파일 쓰기 완료 → **manifest atomic write** → scenes.json atomic write → story.json flush. `manifest.pushRevision`은 §7 "revision 소유 프로토콜"을 따른다 — 최초 정밀 실행의 audio는 `null`로 두고 push를 소유하는 prompts가 확정 재스탬프, 재TTS는 audio가 확정 후 push emit. export 정합 검사(§7)는 이 값을 ack 후 갱신되는 `story.json.lastPushedRevision`과 대조한다.

**데이터 레이아웃:**
```
<project>/story/audio/
  segments/<id>.mp3    # 세그먼트별 TTS — export 소스 + 미리듣기 소스
  final.srt            # 세그먼트 타임라인에서 생성 (단일 timing 소스의 표현)
  manifest.json        # §7 — 세그먼트 오디오 메타 (export가 읽는 계약)
```
> 원 스펙의 `audio/media/full_narration.mp3` + `audio/cache/segments/` 폐기. `media/`(합성 트랙) 없음.

**미리듣기:** 세그먼트/씬 단위 재생(segments 개별 파일). 개별 재생성 후 ③ 3~5단계만 재실행.

---

## 6. TTS 어댑터 / keyStore (인프라)

### TTS (`electron/api/tts/`)
공통 인터페이스(원 스펙 §5 유지):
```js
capabilities() → { supportsEmotion, maxCharsPerRequest, outputFormats, supportsPreview, maxConcurrency }
listVoices()   → [{ id, name, language, previewUrl }]
synthesize({ text, voiceId, emotion, signal }) → { audio: Buffer, format: 'mp3' | 'wav' }
```
- **Typecast 어댑터 1종 먼저**(`ssfm-v21`, 감정 normal/happy/sad/angry). 이후 ElevenLabs·Gemini TTS.
- **maxChars 초과는 어댑터가 이어붙이지 않는다** — §4대로 ②가 자식 세그먼트로 미리 분할해 각 세그먼트가 provider 한도 내. (어댑터는 단일 세그먼트=단일 요청.)
- emotion 미지원 provider는 무시/근사. 모든 호출에 `AbortSignal`.

### keyStore 멀티 provider 확장
- 파일 `<userData>/keys/<provider>-key.enc`(safeStorage). 기존 `genai-key.enc` 마이그레이션.
- **enum allowlist**: `genai|elevenlabs|typecast|anthropic` — IPC 거부 + enum→경로 매핑(path traversal 방어).
- IPC `keys:set/delete/status`. renderer에 평문 키 미반환.

### 화자 매핑 UI
- speaker별 provider+voice+기본 감정. `listVoices()` 기반. 미배정 화자 있으면 audio 실행 불가.
- ② 재실행 speakers 병합은 원 스펙 §4-② 규칙 유지.

---

## 7. 세그먼트 → export 통합 (HIGH2/HIGH3/MED5 — 신규 계약)

원 스펙의 `audioReady`/`audioAck`/`registration`/`importByPath`/`audioPackage` 스캐너 경로는 **full_narration.mp3 전제라 story에서 폐기**한다. 대신 두 흐름으로 분리한다:

### 흐름 A — 씬 timing/자막 (기존 push 계약 재사용)
씬 `startTime/endTime/duration`과 `srtTrack`은 **기존 `story:pushScenes` 계약**(원 스펙 §4-④)으로 전달. project.json 확장 필드는 **원 스펙의 5개(storyId/stalePrompt/stalePromptAt/staleVideo/staleVideoAt) 그대로 — 세그먼트 오디오는 project.scenes에 넣지 않는다.**

**srtLineIds 매핑 (MED5):**
- narration 세그먼트 id → SRT 라인 id를 결정론적으로 발급(예: `sub_<segmentId>`). srtTrack payload에 라인 id 포함.
- 씬(그룹)의 `srtLineIds` = 그룹 내 narration 세그먼트들의 라인 id 배열(순서 보존).
- 재실행 시 세그먼트 id가 안정이므로 라인 id도 안정. srtTrack은 push 트랜잭션에서 **wholesale 교체**(원 스펙 §4-③ fuzzy 금지).

### 흐름 B — 세그먼트 오디오 파일 (신규 manifest)
`story/audio/manifest.json`이 export가 읽는 계약:
```json
{
  "version": 1,
  "pushRevision": 7,
  "segments": [
    { "id": "s001-1", "type": "narration", "speaker": "narrator", "trackIndex": 0,
      "audioPath": "<abs>/story/audio/segments/s001-1.mp3", "startMs": 0, "durationMs": 2380 },
    { "id": "s001-2", "type": "sfx", "audioPath": "...", "startMs": 2530, "durationMs": 800 }
  ]
}
```

**manifest ↔ 씬 정합 (HIGH 신규2 — atomicity):**
- manifest는 main 소유(§5에서 atomic write), 씬/srtTrack은 renderer가 push 트랜잭션으로 project.json에 저장 — **별도 시점**이라, 정합 없이 export하면 새 오디오 timing이 옛 씬/srtTrack과 짝지어질 수 있다.
- 방어: manifest의 `pushRevision`은 그 오디오를 반영한 **push의 revision**(원 스펙 §4-④ `pendingPushRevision`)이다. export는 **`manifest.pushRevision === story.json.lastPushedRevision`**(= 그 push가 ack된 상태)일 때만 manifest를 사용한다. 불일치(ack 미완/재생성 진행 중/pushRevision 미확정=null)면 **export 차단 + 경고 배너**("오디오 타이밍이 씬과 동기화 대기 중"). 이는 원 스펙 §4-③ export 경고 배너·§4-④ revision 규칙의 연장.

**revision 소유 프로토콜 (HIGH 신규 — audio가 prompts보다 먼저 실행):**
`pushRevision`은 **push payload를 emit하는 스텝이 소유·확정**한다. audio가 먼저 돌더라도 최초 실행의 push는 prompts가 만들기 때문:
- **최초 정밀 실행 (audio → prompts)**: audio는 세그먼트/timing/manifest를 쓰되 `manifest.pushRevision = null`(미확정)로 둔다 → export 정합 검사에 자동으로 걸려 차단(prompts 전 export 방지). **prompts가 full push를 만들 때 `pendingPushRevision++` 하고 그 값으로 manifest를 재스탬프(atomic)** 후 push emit. (stepMachine의 현재 `prompts`가 revision을 올리는 위치와 일치 — `electron/story/stepMachine.js:124-136`.)
- **재TTS (prompts done 후)**: audio 재실행이 push를 소유한다 — audio가 `pendingPushRevision++` + manifest 스탬프 + push emit(멤버십 불변=timing-only). **멤버십 변화**면 신규 씬은 프롬프트가 없으므로 audio는 push하지 않고 **prompts 재실행을 사용자에게 안내**(신규 씬 프롬프트 생성 후 prompts가 push 소유).

**manifest locator (MED 신규):**
- export options에 **`storyProjectPath`(또는 `storyManifestPath`)를 명시 전달**한다 — 현재 export hook은 `audioPackage`만 넘기므로 story 경로를 알 방법이 없다.
- story 프로젝트 감지: 열린 프로젝트에 **storyId를 가진 씬이 하나라도 있으면** story 경로로 간주(또는 앱이 story 프로젝트 경로를 top-level 상태로 보유). 감지되면 `<storyProjectPath>/story/audio/manifest.json` 로드.
- manifest **없음/로드 실패** → 오디오 없이 export(경고), **stale**(pushRevision 불일치) → 위 정합 검사로 차단.

- **export 시**: story 프로젝트면 exporter가 manifest를 로드해 `prepareCloudRequest(project, { storyAudio: manifest })`로 전달. `prepareCloudRequest`가 세그먼트를 `audioTracks[]`로 변환(아래 배치 타입). `audioFiles`/`pathMap`에 세그먼트 파일 추가.
- 기존 `audioPackage`(드롭/스캔) 경로와 **배타**: story 프로젝트는 manifest, 비-story는 기존 audioPackage. `prepareCloudRequest`에서 분기.
- 완료 추적은 `story.json.steps.audio.status`. **audioReady/audioAck/registration IPC는 story에서 미사용**(원 스펙 대체).

### 배치 타입

| 세그먼트 | audioTrack 타입 | 배치 | GCF |
|---|---|---|---|
| **narration** | **전용 타입 신설**(`story_narration`) | `timecodeMs=startMs`, `durationMs`, `trackIndex`, vol 1.0 | whisk2capcut + whisk2premiere **배포** |
| **sfx** (M2b) | `sfx_timed`(기존) | `timecodeMs=startMs`, `durationMs` | 무변경 |

**전용 타입 근거**: CapCut `voice`는 SRT 중앙 스냅(fuzzy), `narration`은 full mp3 vol0.5, `sfx_timed`는 SFX 시맨틱 — 셋 다 나레이션 세그먼트에 부적합(조사 확인). timecodeMs 그대로·전용 트랙·vol 1.0은 전용 타입만 가능.

**화자 trackIndex**: 스키마에 `trackIndex` 필드 두되 **M2a는 항상 0(단일 트랙)**. 화자별 분리(videoOverlays trackIndex 패턴 재사용)는 **v2**.

### Vrew — 오디오 미배치
- Vrew는 나레이션 생성 특화 서비스. AutoFlowCut은 **export만** 하면 Vrew 안에서 사용자가 나레이션 생성.
- Vrew엔 오디오 mp3 미배치, **실측 SRT/자막/씬 duration만** 넘겨 **external-TTS-derived guide timing**으로 제공(LOW: Vrew 자체 TTS 길이는 이 값과 정확히 일치하지 않을 수 있음 — Vrew가 자기 나레이션으로 재조정). 기존 `srtEntries` 경로라 **Vrew GCF 무변경**.
- audio 스텝(TTS)은 **타겟 무관 항상 실행**(씬 timing 실측 목적). Vrew는 결과 중 자막/씬만 사용.

---

## 8. 마일스톤 (MED8 — M2a 서브페이즈 분할)

각 마일스톤/서브페이즈는 독립 검증 가능. 완료 시 Codex Review(findings 0까지 loop).

**M2a — 나레이션 뼈대** (내부 서브페이즈, 순서대로):
- **M2a-1 오디오 백엔드**: 세그먼트 모델(narration) + 파이프라인 순서 변경 + audio 스텝(TTS 실측·SRT·씬 재그룹·storyId 발급·manifest·write safety) + Typecast 어댑터 + keyStore 멀티. → mock/테스트로 검증(UI 없이 파이프라인 동작).
- **M2a-2 정밀 push/timing**: **sendPush가 audio 측정 timing(startSec/endSec/srtLineIds) 반영**(M2a-1의 `buildFallbackTimeline` 글자수 추정 push를 대체 — M2a-2의 1번 과제) + **세그먼트 id 승계**(정규화 텍스트 1:1, 재실행 identity 안정) + 재그룹 storyId 승계 + 재TTS 정책(timing-only vs full) + srtLineIds 매핑 + **세그먼트 `status`(pending/done/error) + 단일 실행 내 부분 재시도**(§5 write safety — M2a-1은 실패 시 전체 재-TTS) + 대략 모드 폴백 공존.
- **M2a-3 renderer 통합**: 화자 매핑 UI + 세그먼트/씬 미리듣기 + Story 뷰 audio 패널.
- **M2a-4 export/GCF**: `prepareCloudRequest` manifest 분기 + 전용 나레이션 타입 배치 + whisk2capcut/whisk2premiere GCF 배포(test→prod) + Vrew 실측 SRT 전달.

**M2b — SFX**: sfx 세그먼트 분리(②) + 자리잡기(다: placeholder) + 소스(가: ElevenLabs 생성 / 나: 라이브러리) + sfx_timed 배치. (CapCut/Premiere sfx_timed 무변경. Vrew sfx 미소비 → 별도 판단.)

---

## 9. 테스트 (TDD — 단위+통합)

- **단위**: TTS 어댑터(mock), 세그먼트 실측·타임라인 누적(startMs), SRT 생성(narration=라인·sfx 제외), **씬 재그룹**(6~10초·순서·화자경계·초과 단독), **storyId 승계**(집합 동일→승계 / 변화→신규), **재TTS 정책**(멤버십 불변→timing-only + duration±0.5s staleVideo / 변화→audio no-push 대기: steps.prompts=pending + manifest.pushRevision=null + pendingPushRevision 불변, prompts 재실행이 full push[신규 storyId 씬·삭제 후보·stale 미사용]), **revision 소유**(최초=prompts 확정 스탬프 / 재TTS=audio 확정, manifest.pushRevision≠lastPushedRevision이면 export 차단), srtLineIds 발급·수집, maxChars 자식 세그먼트 분할, keyStore allowlist·경로매핑, manifest→audioTracks 변환(startMs→timecodeMs·trackIndex=0), 대략 모드 폴백, **write safety**(temp-rename·부분재시도·abort commit skip).
- **통합**: 대본→audio→prompts 전체(mock TTS), audio 재실행 시 duration 갱신 + push 방식 분기, TTS 재생성 후 SRT·씬 재정렬 드리프트 0, manifest 로드→export audioTracks, Vrew가 실측 SRT 수신, 재시작 후 status 기반 재개, 프로젝트 전환 중 abort(파일 쓰기 skip).
- 위치: `tests/` 미러 구조.

---

## 10. v2로 미룬 것
- 화자별 분리 오디오 트랙(trackIndex 화자별) — M2a 단일 트랙, 구조만 준비.
- SFX word-level 정밀 배치(문장 내부) — M2b는 세그먼트 단위.
- BGM / 다국어 / 프롬프트 QA 루프 — 원 스펙 §9 유지.

---

## 11. 결정 로그
- **ffmpeg 폐기**: 프로젝트 생성기 → 세그먼트 개별 배치, concat 불필요. 등록 흐름도 폐기(§7 manifest 대체).
- **SRT 단일기준 + 순서 변경**: 글자수 추정 제거, audio를 prompts 앞으로, storyId를 audio 확정 후 발급.
- **씬=세그먼트 그룹, 재그룹**: TTS 세그먼트 단위 → 실측 후 재그룹만으로 오디오 재생성 없이 정확. identity/재push는 멤버십 기준 분기.
- **SFX 세그먼트화**: word-level 우회, 나레이션과 같은 원자.
- **나레이션 전용 타입 배포**: 기존 타입 3종 부적합(조사 확인).
- **Vrew 오디오 미배치**: 자체 TTS 특화, guide timing만.
- **화자 트랙 v2**: YAGNI, 구조만 열어둠.
