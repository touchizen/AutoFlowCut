# 스토리 자동화 파이프라인 (Story Pipeline) — 설계 스펙

**날짜**: 2026-07-02 (v9 최종 — 리뷰 8라운드 수렴: 자체 리뷰 FINDINGS 0, Codex 잔여 MED 3건 반영)
**상태**: 승인 — 구현 플랜 작성 단계
**대상**: AutoFlowCut (AutoCraft Studio) — 배포용 정식 기능

## 1. 목표

제목 또는 대본만 입력하면 대본 생성 → 씬/화자 분리 → TTS·SRT 생성 → 씬별 이미지/비디오 프롬프트 작성까지 자동화하고, 결과를 기존 씬 그리드/이미지·비디오 생성/CapCut 내보내기 파이프라인에 합류시킨다. 진행 상황은 실시간으로 시각화한다.

### 진입점 (3개)

| 진입점 | 시작 단계 |
|---|---|
| 제목만 입력 | ① 대본 생성부터 |
| 대본 붙여넣기 | ② 씬/화자 분리부터 |
| 프롬프트 직접 입력 | 기존 흐름 그대로 (변경 없음) |

### 범위 결정 (확정 사항)

- **배포용 정식 기능** (개인 도구 아님)
- **LLM**: Gemini 기본 — 이미지 생성 때문에 모든 사용자가 이미 Gemini 키 보유(진입장벽 0). Claude는 품질 옵션
- **Claude 인증**: **구독 로그인(각자의 Claude 구독, Agent SDK 월간 크레딧)이 기본 경로**. Anthropic API 키는 폴백 옵션(설정에 두되 강조하지 않음 — 종량제 진입장벽 때문에 실사용 기대 안 함)
  - 근거 정책: 2026-06-15 발표 — Pro $20 / Max 5x $100 / Max 20x $200 상당 Agent SDK 월간 크레딧, 서드파티 앱의 구독 인증 허용
  - **릴리스 블로커**: 이 정책은 현재 시행 연기 상태. 출시 시점에 시행 여부를 확인하고, 미시행이면 Claude 경로 전체를 feature flag 뒤로 숨기고 Gemini 단독으로 출시한다
- **GCF/크레딧 게이트**: v1 제외, 다이렉트 호출. 추후 유료화 시 앞단에 삽입 가능한 구조 유지
- **TTS**: ElevenLabs + Typecast + Gemini TTS 셋 다 v1 (구현 순서는 마일스톤 참조)
- **화자 분리**: 다중 화자 완전 지원 — 캐릭터별 목소리 배정 UI, 세그먼트별 TTS. 단 **오디오 트랙은 v1에서 단일 합성 트랙**(§4-③ 트랙 시맨틱 참조)
- **진행 방식**: 단계별 게이트 기본 + "끝까지 자동 실행" 토글
- **@레퍼런스 멘션**: v1에서 **사용하지 않음**. ④의 프롬프트는 플레인 텍스트(캐릭터 외형 묘사를 프롬프트에 직접 포함). 캐릭터 레퍼런스 자동 생성·연결은 v2 (§9)

## 2. 전체 구조

```
진입점                     Story 뷰 (신규)                          기존 앱
─────────   ┌──────────────────────────────────────────┐   ─────────────
제목 입력 ──→ │ ①대본 생성 → ②씬/화자 분리 → ③오디오 → ④프롬프트 │ ──→ 씬 그리드
대본 입력 ──────────────→ │      (TTS+SRT)              │      → 이미지/비디오 생성
프롬프트 직접 ────────────────────────────────────────────────→ (기존 그대로)
```

- 오케스트레이션: **Electron main process의 결정적 스텝 머신**(신규 모듈 `electron/story/stepMachine.js`). LLM이 루프를 돌리는 게 아니라 앱이 순서를 제어
- 렌더러는 IPC 이벤트로 진행률/스트리밍 텍스트 구독 (§6 IPC 계약)

### 상태 소유권 (story.json vs project.json)

| 상태 | 소유자 | 파일 |
|---|---|---|
| 파이프라인 상태·산출물 | **main process 스텝 머신** | `story/story.json` 등 (temp 파일 + rename으로 원자적 쓰기) |
| 씬 그리드·앱 상태 | renderer (기존 useScenes/useProjectData) | `project.json` (기존 오토세이브 그대로) |

- `project.json` 스키마 버전은 변경하지 않는다. 씬에 additive 확장 필드만 추가 — 목록은 §4-④ "씬 확장 필드" (storyId, stalePrompt, stalePromptAt, staleVideo, staleVideoAt)
- **race 가드**: 프로젝트 전환/rename/삭제 시 renderer가 `story:abort`를 먼저 호출 → 스텝 머신이 진행 중 스텝을 중단(AbortSignal)하고 상태 flush 후 응답. 스텝 머신은 시작 시점의 projectPath를 토큰으로 보관, 불일치 시 모든 파일 쓰기 skip

## 3. 데이터 모델

```
<project>/story/
  story.json          # 파이프라인 상태 (스텝 머신 소유)
  script.md           # 대본
  scenes.json         # 씬 + 세그먼트 (화자 분리 결과)
  audio/              # ③의 오디오 패키지 루트 — 기존 스캐너 포맷 준수 (§4-③)
    media/
      full_narration.mp3
      final.srt
    cache/
      segments/       # 세그먼트별 TTS mp3 (s001-1.mp3 ...) — 스캐너 비인식 경로 = export 제외, 미리듣기/재생성 전용
```

### story.json

```json
{
  "version": 1,
  "input": { "type": "title", "title": "...", "options": { "genre": "...", "targetMinutes": 10, "language": "ko", "tone": "..." } },
  "engine": { "llm": "gemini", "claudeAuth": "subscription" },
  "steps": {
    "script":  { "status": "done",    "updatedAt": "..." },
    "scenes":  { "status": "running", "progress": { "current": 0, "total": 0 } },
    "audio":   { "status": "pending", "registration": null },
    "prompts": { "status": "pending" }
  },
  "autoRun": false,
  "pushedAt": null,
  "pendingPushRevision": 0,
  "lastPushedRevision": 0,
  "speakers": [
    { "id": "narrator", "name": "나레이션", "voice": { "provider": "typecast", "voiceId": "tc_...", "defaultEmotion": "normal" } },
    { "id": "kim", "name": "김첨지", "voice": { "provider": "elevenlabs", "voiceId": "..." } }
  ]
}
```

- `status`: `pending | running | done | error`
- 상류 단계를 재실행하면 하류 단계는 `pending`으로 리셋. 이미 씬 그리드에 push된 뒤라면 재push 정책(§4-④) 적용
- **리셋 규칙 예외**: ③(오디오)은 ④(프롬프트)의 입력(씬 텍스트)에 영향을 주지 않으므로 **③ 재실행은 ④를 리셋하지 않는다**. ④를 리셋하는 것은 ①·②뿐. ③ (재)완료 시에는 **timing-only push**(§4-④)로 타이밍만 갱신 — ④ LLM 재호출 불필요

### scenes.json — 씬 하나의 형태

```json
{
  "storyId": "b3f1c2e4-...",
  "sceneNo": 1,
  "summary": "장면 요약 (프롬프트 생성용 컨텍스트)",
  "segments": [
    { "id": "s001-1", "speaker": "narrator", "text": "...", "emotion": "normal" },
    { "id": "s001-2", "speaker": "kim", "text": "...", "emotion": "angry" }
  ],
  "imagePrompt": null,
  "videoPrompt": null,
  "startSec": null,
  "endSec": null
}
```

- `imagePrompt/videoPrompt`는 ④에서, `startSec/endSec`는 ③에서 채워짐 (세그먼트별 타이밍도 ③에서 `segments[].startSec/endSec`로 기록)

## 4. 단계별 스펙

### ① 대본 생성 (제목 진입 시만)

- 입력: 제목 + 옵션(장르, 목표 길이(분), 언어, 톤)
- 출력: `script.md` — 스트리밍 생성, UI 실시간 표시
- Claude 경로: Agent SDK로 쓰기 → 자체 검토 → 수정 루프(최대 3회) 옵션
- Gemini 경로: 단발 스트리밍 호출 + 검토 호출 1회(옵션)
- 스트리밍 중단/실패 시 재시도 정책: **스텝 단위 전체 재생성** (부분 이어쓰기 없음 — 단순성 우선)

### ② 씬/화자 분리

- 입력: `script.md`
- 출력: `scenes.json` — structured output(JSON schema 강제)으로 파싱 실패 방지, 실패 시 1회 재요청
- 씬 길이 기준: 나레이션 낭독 시간 추정 **6~10초** (언어별 초당 글자수 휴리스틱: ko ≈ 5.5자/초, en ≈ 15자/초 — 구현 시 상수화·테스트). 초과 추정 씬은 LLM에게 분할 지시
- 세그먼트마다 `speaker`, `emotion` 추출. 등장 화자 목록 확정 → `story.json.speakers` 시드(voice 미배정)
- **② 재실행 시 speakers 병합 규칙**: speaker id는 스텝 머신이 발급·유지(LLM 출력의 이름은 표시용). 재실행 시 **정규화된 이름(공백/조사 제거) 완전 일치 → 자동 승계**로 기존 voice 배정 보존, 그 외(표기 변경·동명이인 의심)는 **자동 배정하지 않고 미배정 + 화자 매핑 UI에서 "이전 화자와 연결" 후보 제시** 후 사용자 확인. 사라진 화자는 확인 후 제거
- 긴 대본은 챕터 단위 분할 호출 후 병합

### ③ 오디오 (TTS + SRT)

**화자 매핑**: speaker별 provider + voice + 기본 감정 지정(혼용 가능). voice 목록은 `listVoices()`. 미배정 화자 있으면 실행 불가.

**TTS 생성**: 세그먼트 단위 병렬(provider별 동시성 제한, §5 capability), 실패 세그먼트만 개별 재시도. 산출물은 `audio/cache/segments/`.

**포맷 정규화**: provider 혼용 시 세그먼트 코덱/샘플레이트가 제각각(mp3/wav/pcm, §5 matrix)이므로, concat 전에 **모든 세그먼트를 공통 포맷(44.1kHz mono)으로 정규화**하는 단계를 둔다 (ffmpeg 트랜스코딩).

**타이밍/SRT + 합침 (단일 배치 함수)**: 타이밍 계산과 오디오 합침은 **같은 배치 함수의 출력**을 사용한다 — SRT와 실제 오디오가 어긋나는 드리프트 방지가 목적.
1. 세그먼트 실제 길이 측정(`music-metadata`, 순수 JS)
2. 배치 함수가 세그먼트 간 갭(기본 0.15s)을 포함한 타임라인 산출 → `final.srt`(세그먼트=자막 1개) + scenes.json의 씬/세그먼트별 `startSec/endSec`
3. 합침은 **같은 타임라인대로 갭 구간에 무음을 삽입**하여 **선택된 concat/정규화 backend**(아래 M2 결정사항 — `ffmpeg-static`은 후보 중 하나)로 → `audio/media/full_narration.mp3`
4. 검증: concat 결과 길이 ≈ SRT 마지막 endSec (허용 오차 내, 단위 테스트 §8)

***M2 착수 전 결정사항 (릴리스 블로커)**: ffmpeg 번들 전략 확정 — ⑴ ffmpeg-static(GPL — 배포 앱에서 단순 고지로 부족할 수 있음, 법적 검토), ⑵ LGPL 빌드 별도 제작, ⑶ 최초 실행 시 별도 다운로드, ⑷ 순수 JS 폴백(모든 provider가 WAV/PCM 출력을 지원해야 성립 — ElevenLabs pcm output_format 확인 필요) 중 하나를 선택. 미결정 상태로 M2 구현 시작 금지 (concat/정규화 구현이 선택에 종속).*

**트랙 시맨틱 (v1 결정)**: **단일 나레이션 트랙**.
- export 대상은 `media/full_narration.mp3` + `media/final.srt` 뿐. 모든 화자 음성이 이 한 파일에 시간순으로 들어있다
- `media/voices/` 폴더는 **만들지 않는다** — 기존 `buildAudioTracks`의 "SRT 구간 컷 + voice 치환" 로직은 별도 녹음 대사 치환 워크플로우 전용이라 story 산출물과 의미가 충돌(이중 재생)하기 때문
- 화자별 분리 트랙(CapCut 멀티트랙)은 v2 (§9)

**기존 통합**:
- `story/audio/`가 기존 오디오 패키지 스캐너가 인식하는 레이아웃(`media/` 하위 첫 오디오 + SRT)을 준수 → 파형/재생/내보내기는 기존 `useAudioImport.importByPath` 경로 재사용
- **API 변경**: `importByPath(folderPath, { absorbSrt })` 옵션 추가. story 등록은 **`absorbSrt: false`로 호출** — 현재 구현은 SRT가 있으면 항상 `onAudioSrtAbsorbed`를 호출하므로, 옵션 없이는 push 트랜잭션 밖에서 srtTrack이 먼저 바뀌는 구멍이 생긴다. **story의 srtTrack 변경은 오직 `story:pushScenes` 트랜잭션에서만** 일어난다
- ③ 완료 시 main이 `story:audioReady` 이벤트(§6 객체형 payload) 발신 → renderer가 audioFolderPath를 `story/audio`로 등록. **기존에 사용자가 다른 오디오 폴더를 연결해 둔 경우 확인 다이얼로그 후 교체** (silent 교체 금지). autoRun 중에는 다이얼로그에서 파이프라인이 **대기** (기본값 자동 선택 없음)
- renderer는 등록 결과를 `story:audioAck`(§6)로 회신. 결과는 `story.json.steps.audio.registration = 'ok' | 'cancelled' | 'failed' | null`로 기록
- **audioReady 재발신**: `story:open`/`story:getState` 처리 시 `audio=done && (registration==null || registration=='failed')`이면 `story:audioReady`를 재발신한다 (push 재전달과 동일 패턴, 멱등 — 다이얼로그 표시 중 크래시나 기술 실패 시 복구. `'cancelled'`는 사용자 의사이므로 재발신하지 않음)
- **export 경고 배너**: push된 story 씬이 있는데 `registration !== 'ok'`(cancelled **및** null)이면 export 시 경고 배너로 명시 (기존 export는 audioPackage의 SRT가 project srtTrack보다 우선하므로, 새 씬 + 옛 오디오가 조용히 섞여 나가는 것 차단)
- **srtTrack 갱신은 absorb 경로를 사용하지 않는다** — 기존 `onAudioSrtAbsorbed`는 "srtTrack이 비어 있을 때만" 채우는 가드가 있어 ③ 재실행 시 갱신이 막힌다. 대신 srtTrack은 push 계약(§4-④)의 payload로 **명시적 wholesale 교체**. fuzzy 매칭(`mergeSRTIntoScenes`)도 사용하지 않음. source of truth는 `final.srt`이며, SRT 라인 id는 push payload에서 스텝 머신이 직접 발급하여 `srtLineIds`와 원자적으로 일치시킨다

미리듣기: 세그먼트/씬 단위 재생(cache의 세그먼트 파일), 개별 세그먼트 재생성(voice/감정 변경) 후 ③ 후반부(타이밍 재계산+재합침)만 재실행.

### ④ 씬별 이미지/비디오 프롬프트

- 입력: `scenes.json` + `script.md` + 선택된 스타일
- 출력: 씬별 `imagePrompt`, `videoPrompt` — structured output. 플레인 텍스트 프롬프트(@멘션 없음, §1)
- 캐릭터 일관성: 프롬프트에 캐릭터 외형 묘사를 반복 포함하도록 LLM에 지시 (레퍼런스 이미지 연결은 v2)

### 씬 그리드 push 계약 (④ 완료 시)

**선행 조건**: ④는 "② done"이면 실행 가능 — **③은 optional** (M1 및 오디오 스킵 사용자 지원). 스텝 머신 의존성: `script → scenes → (audio?) → prompts`.

**메커니즘**: main이 `story:pushScenes` IPC로 renderer에 전달 → `useScenes`에 신규 `importStoryScenes()` 추가 (기존 `normalizeScene` 재사용, CSV 파서와 동일한 정규화 경로). **payload에 srtTrack 포함** (③ 완료 상태인 경우) — §4-③의 명시 교체 규칙.

**필드 매핑**:

| story scenes.json | 기존 씬 모델 |
|---|---|
| `imagePrompt` | `prompt` |
| `videoPrompt` | `videoT2VPrompt` (I2V는 이미지 생성 후 기존 frame-to-video 흐름에서) |
| `startSec` / `endSec` | `startTime` / `endTime` / `duration` |
| `segments[]` ↔ SRT 라인 인덱스 | `srtLineIds` (명시 매핑 — fuzzy 매칭 우회) |
| `storyId` (uuid — identity) | `scene.storyId` (그리드 id는 기존 `scene_N` 발급 유지) |
| `sceneNo` (표시용 순번) | 표시 전용 — identity로 사용 금지 |

**③ 이전 push의 타이밍 폴백 (M1)**: 오디오 없이 push하는 경우(M1, 또는 사용자가 ③ 스킵) `startSec/endSec`가 없다. 이때는 ②의 낭독 시간 추정값으로 **순차 배치한 폴백 타이밍**을 채워서 push한다 (`normalizeScene`의 기본값 `startTime=0, duration=3`으로 전 씬이 겹치는 것 방지). `srtLineIds`는 이 경우 비움.

**timing-only push (push 변형)**: ④ push가 이미 이뤄진 뒤 ③이 (재)완료되면 — 최초 ③ 완료, 세그먼트 재생성 후 ③ 후반부 재실행 포함 — **full push 대신 timing-only push**를 보낸다: `storyId` 기준으로 `startTime/endTime/duration/srtLineIds` + srtTrack만 갱신하고 프롬프트·이미지 stale 플래그는 건드리지 않는다. ④ LLM 재호출 없음. **단, 기존 T2V/I2V 비디오·framePairs가 있는 씬의 duration이 유의미하게 바뀌면(±0.5s 초과) `staleVideo`는 세운다** — M1 폴백 길이로 만든 영상이 실제 오디오 타이밍과 어긋나는 것을 표시하기 위함 (재push 정책의 staleVideo 규칙과 일관).

**push 원자성 (ack 프로토콜)**: renderer는 **`importStoryScenes({ scenes, srtTrack })` 적용과 프로젝트 저장을 하나의 트랜잭션으로 수행**한 뒤 성공 시에만 `story:pushAck`(§6 객체형 payload, `ok: true`)를 보낸다. main은 ack 수신 후에만 `pushedAt` + `lastPushedRevision`을 기록한다 (autosave debounce에 의존하지 않음). srtTrack 교체는 이 트랜잭션 **안**에서 일어난다 — ack 이후에 srtTrack이 바뀌는 순서 없음.

**저장 API 변경 (stale closure 방지)**: 현재 `saveCurrentProject()`는 hook render 시점의 `scenes/srtTrack` 클로저를 저장하므로, push 직후 호출하면 **이전 상태가 저장되고도 ack가 나갈 수 있다**. 따라서 `importStoryScenes`는 적용 결과 `{ nextScenes, nextSrtTrack }`을 반환하고, 신규 **`saveCurrentProjectWithPayload({ scenes, srtTrack, ... })`** — 명시 payload를 저장하는 API — 로 저장한다. ack는 이 payload 저장 성공 후에만 발신.

**씬 identity (storyId 안정성)**: identity는 **`storyId`(uuid) 단 하나** — `sceneNo` 같은 순번은 표시 전용이며 identity로 쓰지 않는다. ②에서 스텝 머신이 씬마다 불변 storyId를 발급하고, ② **재실행 시 이전 scenes.json과 매칭으로 storyId를 승계**한다. 매칭 규칙은 speakers 병합(§4-②)과 동일하게 **보수적이고 1:1 제약**:
- 자동 승계는 정규화 텍스트(세그먼트 text concat) 완전/포함 일치이면서 **옛 씬↔새 씬이 서로 유일하게 매칭될 때만**. 한쪽이라도 후보가 2개 이상(씬 분할/병합 — 재실행의 가장 흔한 변화)이면 자동 승계하지 않고 사용자 확인 UI에 후보 제시
- **invariant: 승계 결과 storyId는 scenes.json 내 유일** — 스텝 머신이 push 전 검증 (위반 시 push 차단). §8 단위 테스트에 분할/병합 케이스 포함
- 매칭이 확정된 씬만 미디어 보존 대상이고, 미확정 씬은 새 storyId = 신규 씬으로 취급(기존 씬은 삭제 후보 → 사용자 확인)

**push revision (ack 상관관계)**: push가 필요한 상태 변화마다 `story.json.pendingPushRevision`을 증가시키고, `story:pushScenes`/timing-only push payload와 `story:pushAck`에 `operationId + pushRevision`을 포함한다. main은 ack의 revision으로 `lastPushedRevision`을 갱신하며, **재발신 조건은 `pendingPushRevision > lastPushedRevision`** (full push든 timing-only push든 ack 유실 시 `story:open`/`story:getState`에서 자동 재발신 — `pushedAt=null` 조건만으로는 timing-only 유실을 못 잡으므로 revision 기준으로 통일).

**재push 정책** (상류 재실행 후):
- `storyId` 기준 **upsert** (위 identity 규칙으로 매칭 확정된 것만)
- 프롬프트/텍스트만 변경: 기존 생성 **이미지 보존** + `stalePrompt` 플래그
- `videoPrompt`/`duration`/`srtLineIds` 변경: 기존 T2V/I2V 비디오·framePairs **보존 + `staleVideo` 플래그** (clear하지 않음 — 재생성 여부는 사용자 선택)
- **씬 확장 필드 (project.json에 추가되는 것 전체)**: `storyId`, `stalePrompt`, `stalePromptAt`, `staleVideo`, `staleVideoAt` — 전부 additive 필드로 기존 파서/스키마에 영향 없음(`schemaVersion` 불변). 이 목록 외 필드 추가 금지
- **stale 플래그 설정/해제 규칙**: 설정 시 플래그와 타임스탬프를 **동시에** 기록 — `stalePrompt=true`와 함께 `stalePromptAt=now`, `staleVideo=true`와 함께 `staleVideoAt=now`. 해제는 해당 씬의 **이미지 생성 성공 시 `stalePrompt`**, **T2V/I2V/framePair 재생성 성공 시 `staleVideo`** (사용자 수동 dismiss도 가능). 해제/dismiss 시 **플래그와 타임스탬프를 함께 clear**. 해제 로직은 기존 생성 성공 핸들러에 후크. **가드: 플래그별 타임스탬프 독립 비교** — 이미지 성공은 `생성 시작 시각 > stalePromptAt`일 때만, 비디오 성공은 `생성 시작 시각 > staleVideoAt`일 때만 해제 (in-flight 생성의 오해제 및 플래그 간 교차 오염 방지, §8 테스트 포함)
- scenes.json에서 사라진 `storyId`: 확인 다이얼로그 후 삭제 (생성물 있는 씬은 기본 보존 선택지 제공)

**push 재전달 (ack 유실 복구)**: `story:open`/`story:getState` 처리 시 main이 `pendingPushRevision > lastPushedRevision`이면 해당 push(full 또는 timing-only)를 **재발신**한다 (upsert라 멱등 — push 직후 크래시로 ack가 유실돼도 재시작 시 자동 복구, LLM 재호출 불필요). 이 revision 규칙이 유일한 재전달 조건이다.

**자막 편집·임포트 정책 (불변식 보호)**: story 씬(`storyId` 있음)의 자막은 재push wholesale 교체로 덮이므로, 사용자 편집이 소리 없이 유실되는 경로를 **중앙 계층에서** 차단한다:
- story 씬의 자막 변경은 **모든 진입점**(SceneList 인라인, SceneDetailModal, MCP `update-srt-track`/`update-scene`)에서 잠그고 Story 뷰(세그먼트 테이블)로 유도 — UI 잠금이 아니라 setter 계층에서 차단
- **storyId 씬이 존재하는 프로젝트에서 SRT/CSV/텍스트 임포트 시 경고+확인** (CSV wholesale 교체는 storyId 소실 → 이후 재push가 전부 신규 취급됨을 고지, SRT fuzzy 임포트는 story 자막 매핑 파기 고지)

**비어있지 않은 프로젝트에서의 push**: 프로젝트에 기존 non-story 씬이 있는 상태에서 push하면 srtTrack wholesale 교체가 그 씬들의 `srtLineIds` 연결을 끊는다 → push 전 확인 다이얼로그("기존 씬 N개의 자막 연결이 해제됩니다")로 명시 동의를 받는다. 동의 시 **같은 push 트랜잭션 안에서 non-story 씬의 `srtLineIds`를 비운다** (dangling line id 참조 금지 — 씬 자체와 생성물은 보존). 권장 흐름은 빈 프로젝트(또는 story 씬만 존재)에서 시작.

## 5. LLM / TTS 어댑터

### LLM (`electron/api/llm/` — 신규 모듈)

기존 `genai.js`는 이미지/비디오 전용(단발 JSON 요청)이라 **재사용하지 않는다**. 공유하는 것은 keyStore와 에러 포맷터뿐.

공통 인터페이스:

```js
generateScript(input, opts, { onDelta, signal }) → { scriptMd }
splitScenes(scriptMd, opts, { signal })          → { scenes, speakers }
writePrompts(scenes, context, opts, { signal })  → { scenes }
```

- 모든 호출에 `AbortSignal` 필수 (§2 race 가드), `onDelta`는 IPC `story:delta` 이벤트로 중계
- `llmGemini.js`: `streamGenerateContent`(SSE) + `responseSchema`(structured output). retry with backoff(429/5xx), 파싱 실패 1회 재요청
- `llmClaude.js`: `@anthropic-ai/claude-agent-sdk`
  - **인증 기본: Claude 구독 로그인** — OAuth 크리덴셜은 SDK가 자체 관리, keyStore에 저장하지 않음. 앱 설정에 "Claude 로그인" 버튼 → SDK 로그인 플로우 실행, 상태(로그인됨/크레딧 관련 에러) 표시
  - **크리덴셜 라이프사이클 (M3 착수 전 확정, 보안 블로커)**:
    - 크리덴셜 홈은 **앱 전용 디렉토리로 격리** (`CLAUDE_CONFIG_DIR=<userData>/claude` 지정) — 사용자의 글로벌 `~/.claude`(Claude Code 등 다른 도구와 공유)를 건드리지 않음
    - IPC: `claude:login` / `claude:logout`(크리덴셜 삭제) / `claude:status` — renderer에 토큰 노출 없음
    - Mac App Store 등 샌드박스 배포 시 홈 디렉토리 접근 정책 확인
  - 폴백: keychain의 Anthropic API 키
  - *구현 전 체크: SDK+번들 CLI가 Electron 패키징(크기·코드사인·notarize)에 미치는 영향 검증, 구독 크레딧 정책 시행 여부 확인(릴리스 블로커, §1)*

### TTS (`electron/api/tts/`)

공통 인터페이스:

```js
capabilities() → { supportsEmotion, maxCharsPerRequest, outputFormats, supportsPreview, maxConcurrency }
listVoices()   → [{ id, name, language, previewUrl }]
synthesize({ text, voiceId, emotion, signal }) → { audio: Buffer, format: 'mp3' | 'wav' }
```

**Capability matrix** (구현 시 검증·갱신):

| provider | emotion | maxChars | format | preview | 동시성 |
|---|---|---|---|---|---|
| Typecast (`ssfm-v21`) | ✓ normal/happy/sad/angry | ~2000 | mp3/wav | ✓ | 1~2 |
| ElevenLabs | ✗ (voice settings로 근사) | ~5000 | mp3 | ✓ | 2~5 |
| Gemini TTS | ✗ (프롬프트 지시로 근사) | ~8000 | pcm→wav | ✗ | 분당 제한 |

- emotion 미지원 provider에 emotion 지정 시: 어댑터가 무시하거나 근사(voice settings/프롬프트) — UI에 "이 목소리는 감정 미지원" 표시
- maxChars 초과 세그먼트: 어댑터가 문장 경계로 분할 후 이어붙임

### 키 저장 (keyStore 확장)

현재 keyStore는 단일 파일(`genai-key.enc`)·단일 키 API. **provider 파라미터를 받는 멀티 키 구조로 확장**:

- 파일: `<userData>/keys/<provider>-key.enc` (safeStorage 암호화, 기존 genai 키는 마이그레이션)
- **provider 검증**: `genai | elevenlabs | typecast | anthropic` **enum allowlist만 허용** — IPC 진입점에서 거부. 파일 경로는 enum→경로 매핑 테이블로만 생성하고 provider 문자열을 직접 path join하지 않는다 (path traversal 방어)
- IPC: `keys:set(provider, key)` / `keys:delete(provider)` / `keys:status(provider) → { present: bool, masked: "sk-...abc" }`
- **renderer에 평문 키를 절대 반환하지 않음** — 키 사용은 main process 내부에서만
- 대상 provider: `genai`(기존), `elevenlabs`, `typecast`, `anthropic`(폴백용)

## 6. UI / IPC

### Story 뷰 (신규)

- 진입: 프로젝트 시작 화면에 "제목으로 시작 / 대본으로 시작" 추가 + Header 뷰 전환
- 레이아웃:
  - 상단: 가로 스텝퍼 `① 대본 → ② 씬 분리 → ③ 오디오 → ④ 프롬프트` (상태 뱃지: 대기/진행중+진행률/완료/에러)
  - 중앙: 단계별 콘텐츠 — 대본 에디터 / 씬·세그먼트 테이블(텍스트·화자·감정 인라인 편집) / 화자 매핑+미리듣기 / 프롬프트 테이블
  - 하단: `다음 단계` · `이 단계 재실행` · `끝까지 자동 실행` 토글 · `일시정지`
- 진행상황: LLM 스트리밍 텍스트 실시간 렌더, TTS `34/120` 카운터, 단계 로그 패널 (기존 QAProgressBanner/StatusBar 패턴)
- 편집 후 재실행 시 하류 무효화 경고 (push 후라면 재push 정책 §4-④ 안내 포함)

### IPC 계약 (main ↔ renderer)

모든 R→M 명령은 `projectToken`(= `story:open`이 발급한 projectPath 기반 토큰)을 포함한다 — 프로젝트 전환 race 방지(§2). **M→R 이벤트도 전부 `projectToken` + `operationId`를 payload에 포함**하며, renderer는 현재 토큰과 다르면 무조건 drop한다 (프로젝트 전환 직후 늦게 도착한 이전 프로젝트 이벤트가 현재 프로젝트에 반영되는 것 방지).

| 채널 | 방향 | 내용 |
|---|---|---|
| `story:open({ projectPath })` | R→M | 프로젝트의 story 상태 로드/바인딩, `projectToken` 발급. 프로젝트 열기/전환 시 호출. `pendingPushRevision > lastPushedRevision`이면 push 재발신, `audio=done && registration==null`이면 audioReady 재발신 |
| `story:getState({ projectToken })` | R→M | story.json 스냅샷 요청 (재시작/뷰 진입 시). 재발신 규칙 동일 |
| `story:start({ projectToken, step, params })` | R→M | 스텝 실행 (또는 autoRun). 응답으로 `operationId` 발급 |
| `story:abort({ projectToken })` | R→M | 진행 중 스텝 중단 (프로젝트 전환/닫기 시 필수 선행) |
| `story:pushAck({ projectToken, operationId, pushRevision, ok, reason? })` | R→M | push 트랜잭션(scenes+srtTrack+save) 결과 통지. **성공/실패 모두 반드시 발신** — `ok:true`면 main이 `pushedAt`+`lastPushedRevision` 갱신, `ok:false`면 갱신하지 않고 `reason` 저장(재시도 가능 상태 유지, revision 규칙에 의해 재발신됨) (§4-④) |
| `story:state({ projectToken, operationId, state })` | M→R | story.json 스냅샷 (스텝 상태 변화마다) |
| `story:delta({ projectToken, operationId, text })` | M→R | LLM 스트리밍 텍스트 조각 |
| `story:progress({ projectToken, operationId, ... })` | M→R | 세부 진행률 (TTS 카운터 등) |
| `story:pushScenes({ projectToken, operationId, pushRevision, scenes, srtTrack? })` | M→R | §4-④ push 계약 (full / timing-only, srtTrack 명시 교체 포함) |
| `story:audioReady({ projectToken, operationId, folderPath })` | M→R | ③ 완료 → audioFolderPath 등록 트리거 (§4-③, 확인 다이얼로그 포함) |
| `story:audioAck({ projectToken, operationId, ok, reason? })` | R→M | audio 등록 결과 회신 — **성공/실패/취소 모두 발신**. `registration = 'ok' | 'cancelled' | 'failed'(+reason) | null(미회신)` 기록. `'failed'`/`null`은 재발신 규칙 대상 (§4-③) |

### Audio 탭

- ③ 완료 시 기존 하단 AudioTimeline에 자동 로드 (기존 임포트 경로, §4-③)
- 별도 신규 타임라인 구현 없음

## 7. 에러 처리

- 스텝 idempotent: 산출물 파일 + `story.json` status 기반 재개 (앱 재시작 포함)
- LLM: retry with backoff(429/5xx), structured output 파싱 실패 1회 재요청, 그래도 실패 시 스텝 error + 원문 로그 보존
- TTS: 세그먼트 단위 실패 격리, 실패 목록 UI + 일괄/개별 재시도
- Claude 구독 크레딧 소진/정책 미시행/로그인 만료: 명확한 안내 + Gemini 전환 제안
- 자동 실행 중 에러 → 해당 단계 정지, 상태 보존
- 프로젝트 전환 race: §2 가드 (abort 선행 + projectPath 토큰)

## 8. 테스트 (TDD)

- **단위**: LLM/TTS 어댑터(fetch/SDK mock), 스텝 머신 상태 전이(재개·abort·하류 리셋·③ optional 의존성), 배치 함수(갭 포함 타임라인 — **concat 결과 길이 ≈ SRT 마지막 endSec 검증**), 포맷 정규화, 씬 분리 스키마 검증, 씬 길이 추정 휴리스틱, push 필드 매핑·재push upsert·stale 플래그, M1 폴백 타이밍, speakers 재시드 병합, keyStore 멀티 provider
- **통합**: 제목→프롬프트 전체 흐름(mock LLM/TTS), `story/audio` 산출 → 임포트 + srtTrack 명시 교체 검증, pushAck 원자성(ack 전 종료 시 pushedAt 미기록), 재실행 시 하류 무효화+재push, 재시작 후 재개, 프로젝트 전환 중 abort
- 위치: `tests/` 미러 구조 (기존 규칙)

## 9. v1 제외 (명시적 아웃 오브 스코프)

- GCF 크레딧 게이트 / 유료화 연동
- **캐릭터 레퍼런스 자동 생성·@멘션 연결** (v1은 플레인 프롬프트)
- **화자별 분리 오디오 트랙 (CapCut 멀티트랙)** — v1은 단일 합성 나레이션 트랙
- SFX(효과음) 자동 생성 — 기존 SFX 트랙 포맷은 건드리지 않음
- BGM 생성/선곡
- 다국어 동시 생성 (한 프로젝트 = 한 언어)
- 씬별 프롬프트 자동 QA 루프 (기존 QA 시스템 재사용으로 충분)

## 10. 구현 마일스톤 (범위 분할)

리뷰 지적(단일 계획으로 과대)에 따라 3분할. 각 마일스톤은 독립적으로 머지 가능해야 한다.

| 마일스톤 | 내용 | 산출 |
|---|---|---|
| **M1** | 스텝 머신 + Gemini LLM 어댑터 + ①②④ + 씬 그리드 push + Story 뷰 골격 | 제목/대본 → 프롬프트 → 기존 생성 흐름 (오디오 없이) |
| **M2** | ③ 오디오: keyStore 확장 + Typecast 어댑터(1종 먼저) + 타이밍/SRT/concat + 오디오 임포트 통합 + 화자 매핑 UI → 이후 ElevenLabs·Gemini TTS 추가 | 완전한 TTS·SRT 파이프라인 |
| **M3** | Claude 경로: Agent SDK 구독 로그인 + 대본 검토 루프 + 정책 시행 확인/feature flag | 품질 옵션 완성 |
