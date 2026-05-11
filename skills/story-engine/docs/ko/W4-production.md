# W4: 프로덕션 추출 + 검증

이 문서는 story-engine 스킬의 W4(프로덕션 추출 + 검토) 단계 가이드입니다.

**번들 스크립트** (`skills/story-engine/scripts/` — 실제 W5에서 호출됨; W4는 텍스트 추출만):

| 스크립트 | 용도 |
|----------|------|
| `generate_tts_elevenlabs.cjs` | ElevenLabs TTS 나레이션 (with-timestamps → mp3 + alignment JSON) |
| `generate_tts_typecast.cjs` | Typecast TTS — `narration` 모드(나레이션) 또는 `dialogue` 모드(인물별 대사). 둘 다 with-timestamps alignment 제공 |
| `draft_subtitles.cjs` | baseline `subtitles_{파트}.txt` 자동 분할 (의미 단위 다듬기 전 초안) |
| `build_srt.cjs` | alignment + `subtitles_{파트}.txt` → `final_{파트}.srt` |
| `merge_audio.cjs` | 한 파트의 segment mp3들 → `final_{파트}.mp3` 병합 (W5-1e). **5파트 전체(hook + 1..4)** → `final_full.*` 통합 병합은 W5-3에서 ffmpeg로 별도 처리 |
| `generate_sfx.cjs` | ElevenLabs Sound Generation (SFX, manifest 기반) |

---

## 프로덕션 추출 + 검토

**대본이 W3 검토를 거쳐 확정된 후에만 실행한다.** 대본 확정 전에 추출하면 수정 시 재작업이 발생한다.

### 4-1. 나레이션 추출
**나레이션 추출** → `narration_{파트}.txt` — 순수 나레이션 텍스트 (대사/지문 제거). `{파트}` 값은 `{hook, 1, 2, 3, 4}` — **콜드 오픈 파일 `{title}_hook.md`는 동일한 contract로 `narration_hook.txt`를 산출**한다. Hook 나레이션 추출은 일반 파트와 완전히 동일한 처리; 다운스트림 TTS/SRT/timeline 파이프라인이 5번째 파트로 다룰 뿐이고, 유일한 특수성은 W5-3에서 full timeline의 offset `0`에 머지된다는 점이다.

**리뷰 (서브스텝 4-1)** — 서브에이전트 자가검토 → 이슈 목록 → 수정. 최대 5회. 0 이슈 시 다음 서브스텝(4-2)으로 즉시 진행. 5회 초과 시 사용자에게 에스컬레이션.

### 4-2. 인물별 대사 추출
**인물별 대사 추출** → `dialogs_{파트}.json` (`파트=hook`인 경우에도 동일하게 산출. 일반적으로 hook은 나레이션-only 이므로 파일 내용은 `[]`)

**필수 필드 (각 entry):**
| 필드 | 타입 | 설명 |
|------|------|------|
| `order` | int | 파트 내 대사 순서 (1부터, 파일명 prefix `{order:03d}`로 사용됨) |
| `character` | string | 캐릭터명 (W5-0 voice 매핑 키) |
| `line` | string | 대사 텍스트 |
| `emotion` | string | 감정 라벨 (예: "절박", "단호") — Typecast `EMOTION_MAP`이 normal/happy/sad/angry로 자동 매핑 |
| **`after_paragraph`** | **int** | **이 대사가 오는 직전 narration 단락 인덱스 (0-based, narration_{파트}.txt 기준)**. W5-1f가 `segments_{파트}/index.json`의 `paragraph_idx`와 매칭해 자동 타임코드 산출 |

> **`after_paragraph` 필수.** 없으면 W5-1f가 `_HHMMSS` 산출 못 해 silent collision 가능 → 스크립트가 throw로 거부. 대본 파싱 시 narration 단락 카운터를 유지하면서 각 dialogue 직전의 paragraph idx를 기록.
>
> **연속 대사 OK** — 같은 `after_paragraph` 그룹에 대사 N개를 두면 W5-1f가 `order` 순으로 자동 누적 (이전 대사 끝 + 0.2s gap)해서 collision 방지. 그룹 첫 대사만 narration 끝 + 0.3s, 그 다음부터는 이전 대사 끝 + 0.2s.

**(선택)** `start` 필드 — 외부 도구(Vrew 등)로 narration이 이미 만들어진 경우 SRT-format 시작 시각을 직접 기입하면 `after_paragraph` 대신 사용됨.

**리뷰 (서브스텝 4-2)** — 서브에이전트 자가검토 → 이슈 목록 → 수정. 최대 5회. 0 이슈 시 다음 서브스텝(4-3)으로 즉시 진행. 5회 초과 시 사용자에게 에스컬레이션.

### 4-3. SFX 추출
**SFX 추출** → `08_sfx_목록.md` — 음향효과 필요 구간 목록 (영문 프롬프트 포함)

**`08_sfx_목록.md` 포맷 (SRT 앵커 기반):**

| # | 파트 | 파일명 | 앵커 나레이션 | 배치 | 오프셋(초) | 영문 프롬프트 | 길이(초) |
|---|------|--------|-------------|------|-----------|-------------|---------|
| 1 | 기 | 01_주판_구슬_튕기기 | "주판알이 튕기며" | concurrent | 0 | Wooden abacus beads clicking gently | 3 |
| 2 | 기 | 02_문_삐걱 | "문이 열리고" | before | 0.5 | Creaking wooden door slowly opening | 2 |
| 3 | 승 | 03_빗소리 | "빗소리가 들렸다" | concurrent | 0 | Heavy rain on tiled rooftop | 4 |

**컬럼 설명:**
- **앵커 나레이션**: W5에서 SRT를 검색할 때 쓰는 기준 텍스트
  - 단일 SRT 엔트리 안에 **완전히 포함**되는 **짧고 고유한 문구** (3~10어절 권장)
  - 대본에 동일/유사 표현이 반복되는 구간은 더 구별되는 문구 선택
  - **0건 또는 2건 이상 매칭 → 즉시 에스컬레이션** (추정 배치 금지)
- **배치**: `before` / `concurrent` / `after`
  - `before N초`: 앵커 나레이션 SRT_start 기준 N초 **앞**에 배치 (분위기 선제 조성)
  - `concurrent`: SRT_start와 동시 (나레이션과 같이 시작)
  - `after N초`: 앵커 나레이션 SRT_end 기준 N초 **뒤**에 배치 (여운/강조)
- **오프셋(초)**: `before`/`after` 시 이동량. `concurrent`는 0 고정

**리뷰 (서브스텝 4-3)** — 서브에이전트 자가검토 → 이슈 목록 → 수정. 최대 5회. 0 이슈 시 다음 Wave로 즉시 진행. 5회 초과 시 사용자에게 에스컬레이션.

### 추출 검토 방법 (subagent, 서브스텝당 최대 5회)

- subagent가 대본 파일과 추출 파일을 **Read 도구로 직접 읽고** 대조
- **프로그램 코드 사용 금지**: 반드시 Read 도구로 직접 읽고 눈으로 대조
- 수정사항이 없을 때까지 반복 (최대 5회)

### SFX 카테고리

| SFX 카테고리 | 예시 |
|----------|------|
| 소품 | 주판 소리, 장부 넘기는 소리 |
| 환경음 | 바람, 빗소리, 새소리, 장터, 풀벌레 |
| 인체 | 숨소리, 한숨, 발소리 |
| 금속/문 | 문 여닫기, 자물쇠 |
| 필기 | 붓으로 쓰는 소리 |
| 군중 | 수군거림, 웅성거림 |

---

## Wave 리뷰 요약
위 각 서브스텝은 최대 5회 리뷰(0 이슈 시 즉시 진행)를 강제한다. 마지막 서브스텝의 리뷰가 통과하면 Wave 4 완료. 어느 서브스텝이든 5회 초과 시 사용자에게 에스컬레이션.
