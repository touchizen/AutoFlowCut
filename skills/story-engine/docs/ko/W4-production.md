# W4: 프로덕션 추출 + 검증

이 문서는 story-engine 스킬의 W4(프로덕션 추출 + 검토) 단계 가이드입니다.

**번들 스크립트** (`skills/story-engine/scripts/` — 실제 W5에서 호출됨; W4는 텍스트 추출만):

| 스크립트 | 용도 |
|----------|------|
| `generate_tts_elevenlabs.cjs` | ElevenLabs TTS 나레이션 (with-timestamps → mp3 + alignment JSON) |
| `generate_tts_typecast.cjs` | Typecast TTS — `narration` 모드(나레이션) 또는 `dialogue` 모드(인물별 대사). 둘 다 with-timestamps alignment 제공 |
| `draft_subtitles.cjs` | baseline `subtitles_{파트}.txt` 자동 분할 (의미 단위 다듬기 전 초안) |
| `build_srt.cjs` | alignment + `subtitles_{파트}.txt` → `final_{파트}.srt` |
| `merge_audio.cjs` | 한 파트의 segment mp3들 → `final_{파트}.mp3` 병합 (W5-1e). 4파트 전체 → `final_full.*` 통합 병합은 W5-3에서 ffmpeg로 별도 처리 |
| `generate_sfx.cjs` | ElevenLabs Sound Generation (SFX, manifest 기반) |

---

## 프로덕션 추출 + 검토

**대본이 W3 검토를 거쳐 확정된 후에만 실행한다.** 대본 확정 전에 추출하면 수정 시 재작업이 발생한다.

### 4-0. 프로덕션 범위 (사용자 게이트, 첫 서브스텝)

**다른 추출 작업을 시작하기 전에 반드시 먼저 실행한다.** W3 대본이 확정된 시점이므로 사용자는 이번 에피소드가 실제로 무엇을 필요로 하는지 판단할 수 있다.

1. **STATE.md `## Decisions`를 읽어 `production_scope:` 블록을 찾는다.**
   - **블록이 존재함** → 값 (`dialogue: <bool>`, `sfx: <bool>`)을 그대로 사용하고 4-1로 진행. 질문하지 않음 (재개 흐름에서 idempotent).
   - **블록이 없음 (legacy ep / fresh ep)** → 아래 `AskUserQuestion`을 호출하고 응답을 STATE.md에 영구 기록.

2. **AskUserQuestion (블록 없을 때만):**
   ```
   이번 에피소드의 프로덕션 범위:
   [x] Dialogue TTS (다중 화자 — Typecast dialogue mode)
   [x] SFX (atmospheric / 긴장 환기)

   조합:
   - Full (default)        : 둘 다 켬
   - Narration + Dialogue  : SFX 끄기 → ~10–20분 절약
   - Narration + SFX       : dialogue 끄기 → ~2–5분 절약 (대사 없는 스크립트일 때)
   - Narration only        : 둘 다 끔 → ~12–25분 절약 (draft / preview용)
   ```
   - 기본값 (응답 모호 / 미지정): 둘 다 `true` (= 현재 동작 보존).
   - 사용자에게 트레이드오프를 보이기 위해 대본의 대사 라인 수 / 캐릭터 수를 간단히 스캔해 함께 보여주면 좋다 (예: "Script has ~12 dialogue lines across 3 characters" → "narration only" 선택 시 대사 12개 모두 사라짐).

3. **STATE.md `## Decisions` 갱신** — 결정값을 nested 블록으로 추가:
   ```markdown
   - production_scope:
       dialogue: true
       sfx: true
   ```

4. **W4 시작 배너에 결정값을 echo** (오케스트레이터가 처리): `프로덕션 범위 / Scope: dialogue=on, sfx=off` 형식. 사용자가 어떤 단계가 스킵되는지 즉시 확인 가능.

**캐스케이드 (다운스트림에 미치는 영향):**

| 단계 | `dialogue: false` 일 때 | `sfx: false` 일 때 |
|------|------------------------|---------------------|
| 4-2 인물별 대사 추출 | **전체 스킵** — `dialogs_{파트}.json` 미생성 | (해당 없음) |
| 4-3 SFX 추출 | (해당 없음) | **전체 스킵** — `08_sfx_목록.md` 미생성 |
| W5-0-assign | `narrator`만 매핑 필수. 캐릭터 voice 할당 스킵 | (해당 없음) |
| W5-1f 대사 TTS | 스킵 — `voices/` 미생성 | (해당 없음) |
| W5-2 SFX 생성 | (해당 없음) | 스킵 — `media/sfx/` 미생성 |
| W5-3 4파트 병합 | 나레이션 병합은 항상 실행 | SFX timecode 변환은 no-op |
| W5-4 mechanic QA | 변동 없음 (나레이션 타이밍만 검증) | SFX 검사 항목(겹침/범위/오프셋) vacuous → empty cue list = pass (자동 통과) |
| W6 scenes.csv | 변동 없음 (SRT 기반) | 변동 없음 |
| W8-0 SFX 씬 매칭 | (해당 없음) | **전체 스킵** |
| W8-1 오디오 임포트 | 항상 실행 — 디스크에 존재하는 오디오만 임포트 (변동 없음) | 항상 실행 — `media/sfx/` 없으면 SFX 트랙 없음 (변동 없음) |

**파일명 컨벤션은 변경 없음.** 생성되지 않는 파일은 단순히 디스크에 부재한다. 다운스트림은 파일 존재 여부로 분기하며, "빈 파일"과 "missing 파일"을 구별하지 않는다.

### 4-1. 나레이션 추출
**나레이션 추출** → `narration_{파트}.txt` — 순수 나레이션 텍스트 (대사/지문 제거)

**리뷰 (서브스텝 4-1)** — 서브에이전트 자가검토 → 이슈 목록 → 수정. 최대 5회. 0 이슈 시 다음 서브스텝(4-2)으로 즉시 진행. 5회 초과 시 사용자에게 에스컬레이션.

### 4-2. 인물별 대사 추출

> **`production_scope.dialogue: false` 일 때는 본 단계를 전체 스킵한다** — `dialogs_{파트}.json`을 생성하지 않는다. W5-1f는 파일 부재로 자동 스킵된다 (빈 파일 vs missing 파일을 구별하지 않으므로 파일 자체를 만들지 말 것).

**인물별 대사 추출** → `dialogs_{파트}.json`

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

> **`production_scope.sfx: false` 일 때는 본 단계를 전체 스킵한다** — `08_sfx_목록.md`를 생성하지 않는다. W5-2는 파일 부재로 자동 스킵된다 (빈 파일 vs missing 파일을 구별하지 않으므로 파일 자체를 만들지 말 것).

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
