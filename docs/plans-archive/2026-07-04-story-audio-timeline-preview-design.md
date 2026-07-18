# Story Audio 타임라인 프리뷰 — 설계 (경량 어댑터)

**날짜**: 2026-07-04
**맥락**: story audio 스텝 완료 후, 세그먼트 오디오를 기존 AudioTimeline에 **화자별 voice 트랙**으로 보여준다. UI/기능은 지금 AudioTimeline 그대로, story audio만 주입.

## 0. 목표 / 비목표

- **목표**: audio 스텝 done이면 StoryView audio 패널에 타임라인 표시. 세그먼트가 화자별 서브트랙(왼쪽 dropdown 펴고/접기) + timecode 위치 clip + 전체재생/헤드/clip 상세 — 전부 **기존 AudioTimeline 기능 그대로**.
- **비목표**: AudioTimeline 컴포넌트 수정 금지. 디스크 재배치(media/voices/<char>/) + audio-import 스캔 같은 무거운 경로 안 씀 — **메모리에서 audioPackage로 순수 변환**(경량).

## 1. 핵심 — 어댑터 하나

AudioTimeline은 `audioPackage.voices = [{ character, files: [{ path, filename, timecodeMs, durationMs }] }]`를 화자별 서브트랙으로 그린다(useAudioTimeline.js:270, filesystem.js:1158이 만드는 형식과 동일). story 세그먼트는 이미 동일 필드를 가진다(`startMs`→timecodeMs, `durationMs`, `audioPath`→path, `speaker`→character). 따라서 순수 변환만 하면 된다.

### `buildStoryAudioPackage(scenes)` — `src/utils/storyAudioPackage.js` (순수)
```
입력: scenes (story 씬 배열, 각 sc.segments[] = { id, startMs, durationMs, audioPath, speaker, type })
출력: { voices: [{ character, files: [{ path, filename, timecodeMs, durationMs }] }], sfx: [] }
```
- narration(type==='narration' 또는 미지정) + audioPath 있는 세그먼트만.
- speaker로 그룹 → 화자별 voices. files는 timecodeMs(=startMs) 오름차순.
- filename = audioPath basename. sfx는 빈 배열(M2b에서 채움).
- 대상 세그먼트 없으면 `{ voices: [], sfx: [] }`(AudioTimeline null-safe → 빈 트랙).

## 2. 렌더 통합

StoryView audio 패널, **audio 스텝 status==='done'** 이고 오디오 세그먼트≥1일 때 `<LiveTimeline audioPackage={buildStoryAudioPackage(scenes)} scenes={[]} srtEntries={...} compact />` 렌더(세그먼트 테이블 위).
- `scenes`: story audio 단계엔 이미지/비디오 없음 → 빈 배열(voice 트랙만). (이미지 트랙은 push 후 일반 생성 화면에서 봄.)
- `srtEntries`: story SRT 있으면 전달(자막 트랙). 없으면 생략 — MVP는 voices 우선, srt는 후속 가능.
- 기존 세그먼트 테이블(화자/텍스트/status/테스트/미리듣기/재생성)은 그대로 유지.

## 3. TDD

- **buildStoryAudioPackage**(단위, 순수):
  - 세그먼트 → 화자별 voices 그룹, files timecodeMs 정렬, filename=basename.
  - audioPath 없는/narration 아닌 세그먼트 제외.
  - 대상 없으면 `{ voices: [], sfx: [] }`.
  - 여러 화자 → 여러 voice 트랙.
- **StoryView 통합**(컴포넌트): audio done이면 LiveTimeline 렌더 + audioPackage.voices 전달, audio 미완료면 미렌더.

## 4. 무변경

- AudioTimeline / LiveTimeline / useAudioTimeline **수정 없음** — audioPackage만 주입.
- 기존 세그먼트 테이블·개별 ▶미리듣기 유지.
- M2 manifest/export 경로(story_narration)와 독립 — 이건 앱 내 프리뷰 전용, export는 그대로.
