# Story M2b — SFX 설계

**날짜**: 2026-07-04
**맥락**: M2a(narration audio)에 이어, `type:'sfx'` 세그먼트(효과음)를 대본에서 자동 추출 → 소스별 생성/매칭 → 타임라인 배치 → `sfx_timed` export. Codex(gpt-5.5/xhigh) 방향 리뷰 반영(thread 019f2d38).

## 0. 목표 / 비목표

- **목표**: 대본의 효과음 큐를 세그먼트 단위(word-level X)로 `type:'sfx'` 세그먼트화 → SFX 오디오 확보(생성/라이브러리 선택식) → narration과 같은 시퀀스에 자리잡기 → export `sfx_timed`.
- **비목표(YAGNI)**: word-level SFX(문장 내부 정밀). library 실제 매칭 로직(인터페이스만, 후속). SFX overlay(세그먼트=serial 자리).

## 1. M2b-0 스파이크 결과 (확정)

**ElevenLabs SFX API**: `POST https://api.elevenlabs.io/v1/sound-generation`, header `xi-api-key`, query `output_format`(기본 mp3),
body `{ text, model_id:'eleven_text_to_sound_v2', duration_seconds:0.5~30|null(자동), prompt_influence:0.3, loop:false }`. 응답 200=audio(octet-stream mp3), 422=검증오류. **duration은 요청 가능**(narration은 실측만; sfx는 요청 or 실측 둘 다 가능 → 실측을 진실로 통일).

## 2. 데이터 계약 (segment)

- 공통: `{ id, type: 'narration' | 'sfx' }` (type 없으면 narration — 하위호환).
- narration: `{ speaker, text, emotion }`
- sfx: `{ description, sourceMode?, durationHint? }` (speaker/text 없음)
- audio 스텝 후(공통): `{ startMs, durationMs, audioPath, status }`
- **reuse 지문**: narration=`voiceKey`(provider:voiceId:emotion). sfx=`sfxKey`=`${source}:${description}:${durationHint||'auto'}`.
- **ID 검증**: 현재 narration만 검사(SAFE_SEGMENT_ID) → **오디오 보유 세그먼트(narration+sfx) 전부** 검사로 확장(path traversal 방어).

## 3. SFX 소스 — `electron/api/sfx/` (별도, tts 오버로드 X)

- `createSfxAdapter(provider, { getKey, fetch })` → `{ generate({ description, durationSeconds? }) → { audio: Buffer, format } , capabilities() }`
- `elevenlabs`: sound-generation 호출(위 계약). 키는 기존 `~/.elevenlabs`(readCredentialsKey/multiKeyStore 재사용).
- `library`: description→로컬 파일 매칭. **인터페이스만(MVP stub)** — throw 'library source not configured'. 실제 매칭은 후속.
- main.js: `sfxFor(provider)` 라우팅(ttsFor 패턴). 기본 elevenlabs.

## 4. slice (순서 = Codex 권장)

| slice | 내용 |
|---|---|
| **M2b-0** ✅ | ElevenLabs API 확정 + 계약 |
| **M2b-1** | `api/sfx` 어댑터(elevenlabs 생성 + library stub) + main.js sfxFor. TDD(fetch mock). |
| **M2b-2+3** (통합) | LLM sfx 분리(SCENES_SCHEMA loose+post-validation, Claude validator oneOf 미지원 우회) + audio 스텝이 sfx도 생성(sfxKey reuse) → buildSegmentTimeline이 sfx도 startMs 배치 → manifest에 sfx. **분리만 단독 배포 금지**(sfx가 생성 전 나오면 durationMs=0으로 timing 붕괴). |
| **M2b-4** | export: prepareCloudRequest storyAudio 분기가 sfx 세그먼트 → `sfx_timed` audioTrack. category 파생('story') + collision-safe filename + audioFiles/pathMap 등록(기존 legacy sfx 매핑 참고). |
| **M2b-5** | UI: sfx 소스 선택 + 목록(테이블 sfx 행) + 타임라인(`buildStoryAudioPackage`가 현재 `sfx:[]` → sfx 반영). |

## 5. M2a 정합 (Codex 확인)

- **재생성 정책 M2a 미러**: 멤버십 불변 & duration 변화 → timing-only push. 멤버십 변화 → no-push 대기. sfx-only 파일 변경(동일 timing) → manifest 재스탬프.
- **SRT**: narration만(sfx 제외) — 기존 유지(변경 없음).
- **정합 게이트/pushRevision**: 기존 그대로(sfx는 audioTracks에만 영향, SRT/revision 무관).

## 6. 테스트 (TDD)

- **어댑터**(M2b-1): elevenlabs generate — POST body/헤더/query·응답 파싱(fetch mock). library stub throw. sfxFor 라우팅.
- **통합**(M2b-2+3): sfx 세그먼트 → audio 스텝 생성 → buildSegmentTimeline startMs 배치 → manifest sfx. sfxKey reuse(재실행 스킵). 미배정/실패 부분재시도.
- **export**(M2b-4): manifest sfx → sfx_timed(category/filename/timecodeMs/durationMs) + pathMap.
- **UI**(M2b-5): sfx 행 표시, buildStoryAudioPackage sfx.
