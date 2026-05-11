# W5: TTS/SFX + 타임코드 검증

이 문서는 story-engine 스킬의 W5(TTS/SFX 생성 + 타임코드 검증) 단계 가이드입니다.

W4에서 추출한 나레이션/대사/SFX 데이터로 오디오를 생성한다.

---

## TTS 제공자 옵션 (overview)

대본에서 추출한 나레이션과 인물별 대사를 TTS로 생성한다. 아래 표는 제공자 옵션 개요이며, 실제 실행 순서는 **5-0 → 5-1** 이다.

**TTS 제공자 옵션** (사용자가 선택):

| 제공자 | 번들 스크립트 | 모드 지원 | 인증 | 특징 |
|--------|-------------|----------|------|------|
| **ElevenLabs** | `generate_tts_elevenlabs.cjs` | 나레이션 | `~/.elevenlabs/credentials` | 다국어, with-timestamps alignment |
| **Typecast** | `generate_tts_typecast.cjs` | 나레이션 + 대사 | `~/.typecast/credentials` | 한국어 강세, with-timestamps alignment, 감정 파라미터(normal/happy/sad/angry) |
| **Vrew** | (없음 — 로컬 앱 수동) | — | — | AI 자막+편집, 무료 크레딧 |
| **Google AI Studio** | (없음 — 추후 연동) | — | `~/.google-ai-studio/credentials` | Gemini TTS |

**지원 조합** (alignment shape 통일됨 — 다운스트림 동일):
- **EL only**: 5-1a EL 나레이션 → 대사 없음
- **EL + TC**: 5-1a EL 나레이션 → 5-1f TC 대사
- **TC only (나레이션 + 대사)**: 5-1a TC 나레이션 → 5-1f TC 대사
- **Vrew 나레이션 + TC 대사**: Vrew mp3+srt를 사용자가 `final_{파트}.mp3` / `.srt`로 직접 import → 5-1f TC 대사. 이 경우 segments dir이 없으므로 dialogs.json에 `start` 직접 기입 필요 (`after_paragraph` 자동 도출 불가)

> **미지원**: "TC dialogue-only (나레이션 0)" — 마스터 타임라인 source가 없어 W6+ 다운스트림(scenes.csv, SRT 매칭)이 성립 안 함. 필요 시 사용자가 외부 도구로 마스터 SRT/mp3 직접 작성해 `final_{파트}.mp3/.srt`로 제공 후 5-1f 진행.

---

## 5-0. 캐릭터 성우(보이스) 지정 (TTS 생성 전 필수)

**대본에 등장인물 대사가 있으면 TTS 생성 전에 반드시 실행한다.**

### 5-0-prep. 제공자 결정 (먼저)

`AskUserQuestion`으로 두 트랙의 제공자를 별도로 묻기:

1. **나레이션 제공자**: ElevenLabs / Typecast / Vrew(외부 import)
2. **대사 제공자**: Typecast / (대사 없음)
   - 현재 번들에는 **대사 TTS 스크립트가 Typecast 전용**임 (`generate_tts_typecast.cjs dialogue`). ElevenLabs로 대사 생성하는 번들 스크립트 없음.
   - 1번에서 Typecast를 골랐으면 자연스럽게 동일 제공자 사용. ElevenLabs를 골랐으면 대사 부분만 Typecast로 갈라지거나, 대사가 없도록 시나리오 다시 검토.

이 결정에 따라 5-0의 voice 추천 라이브러리가 갈림:
| 제공자 | voice ID 형식 | 추천 소스 |
|--------|--------------|----------|
| ElevenLabs | 22자 영숫자 (예: `nucVFUFVgPmKHjgXNbJ7`) | ElevenLabs 보이스 라이브러리 + `/v1/voices` API |
| Typecast | `tc_` prefix (예: `tc_6800a387534948f191cc952b`) | Typecast `/v1/voices` API |

> **혼용 금지**: ElevenLabs 스크립트에 Typecast voice_id 넘기면 401, 반대도 fail. provider별로 정확히 매칭.

### 5-0-assign. 캐릭터별 voice 할당

1. **등장인물 추출**: `dialogs_{part}.json`(전체 파트 합산)에서 unique 캐릭터 이름 수집 + 중복 제거
2. **기존 매핑 로드**: 메모리(`tts_settings.md`)에서 기존 매핑을 읽고 두 그룹으로 분류:
   - **매핑 있음**: 보이스 ID 이미 지정됨
   - **매핑 없음**: 신규 캐릭터 — 보이스 ID 누락
3. **매핑 없는 캐릭터가 하나라도 있으면 → STOP, 사용자에게 질문.** `AskUserQuestion` 사용:
   - 캐릭터 이름 + 대본에서 뽑은 성격/연령/톤 힌트
   - **5-0-prep에서 선택된 제공자**의 보이스 라이브러리에서 캐릭터에 맞는 3~4개 추천 (성별, 연령대, 스타일)
   - "직접 입력" 옵션 — 사용자가 voice ID 제공
4. **선택 적용**: `tts_settings.md`에 새 매핑을 기록. `narrator`는 EL 또는 TC 둘 다 가능, **캐릭터(대사) 항목은 모두 Typecast(`tc_*`)로 통일**해야 함 (현재 번들 dialogue 스크립트가 Typecast 전용 — non-tc voice_id는 실행 전 throw):
   ```
   # narrator 예시 1 (ElevenLabs):
   narrator: nucVFUFVgPmKHjgXNbJ7          # Aaron — 깊고 차분한 다큐멘터리

   # narrator 예시 2 (Typecast):
   # narrator: tc_6800a387534948f191cc952b # Taewoo — 묵직, 진중

   # 캐릭터 (모두 tc_*):
   곽주사:   tc_6731b3ac075b04a944644234   # 중년 남성, 진중
   연이:     tc_677f2aa4a854ddffa0ebda89   # 젊은 여성
   ```
5. **사용자 확인**: 5-1로 진행하기 전에 전체 매핑 테이블 + 각 항목의 제공자를 다시 보여주고 확인 받기.

**나레이션 보이스 (단일 나레이터 스크립트에도 적용):**
- 야담: 묵직하고 느리며 약간 걸걸한 목소리, 발음 명확
- `tts_settings.md`에 `narrator` 항목이 없으면 위 AskUserQuestion에 함께 포함해 한 번에 선택 받기.

---

## 5-1. TTS 음성 생성 (5단계: 나레이션은 자동, 자막 다듬기만 수동)

**원칙:** mp3 + baseline SRT는 **TTS 단계에서 자동으로** 떨어진다. 의미 단위 분리는 baseline 위에서 사용자가 다듬는 **선택적 refinement**이다.

> **스크립트 경로 (W5 전 단계 공통 — 5-1a~f + 5-2 SFX):**
>
> W5에서 호출하는 모든 번들 스크립트(5-1a~f의 TTS/자막/병합 + 5-2의 SFX)는 **설치된 스킬 번들**의 절대 경로를 통해 실행한다. cwd가 repo 루트가 아니어도 작동하도록 셸 변수로 한 번 잡는다. **사용 중인 셸**에 맞는 한 줄만 실행하면 그 다음 모든 명령에서 동일하게 재사용.
>
> | 셸 | SCRIPT_DIR 설정 | 명령에서 참조 |
> |-----|----------------|--------------|
> | **bash** (macOS / Linux / Windows Git Bash / WSL) | `SCRIPT_DIR="$HOME/.claude/skills/story-engine/scripts"` | `"$SCRIPT_DIR/..."` |
> | **PowerShell** (Windows) | `$SCRIPT_DIR = "$HOME/.claude/skills/story-engine/scripts"` | `"$SCRIPT_DIR/..."` (bash와 동일 — PowerShell도 `$VAR` 확장 + forward slash 허용) |
> | **cmd.exe** (Windows) | `set SCRIPT_DIR=%USERPROFILE%\.claude\skills\story-engine\scripts` | `"%SCRIPT_DIR%\..."` (역슬래시 + `%VAR%`) |
>
> 아래 W5 명령은 **모두 한 줄 형식**으로 작성됨 (셸별 줄 연결 문자가 다른 문제를 회피).
> - **bash / PowerShell**: 그대로 복붙
> - **cmd.exe**: `$SCRIPT_DIR` → `%SCRIPT_DIR%`, `/` → `\`로 치환 후 복붙
>
> 가독성 위해 줄 나누고 싶으면 셸별 줄 연결 문자: bash/Git Bash `\` · PowerShell 백틱(`` ` ``) · cmd `^`. 셸 간 복붙 시 충돌하므로 doc 자체는 한 줄을 표준으로 유지.
>
> repo 루트의 `skills/story-engine/scripts/` 상대 경로는 개발자 모드 외엔 깨지므로 사용 금지.

### 5-1a. 나레이션 TTS — 제공자 선택 (ElevenLabs 또는 Typecast)

**ElevenLabs:**
```bash
node "$SCRIPT_DIR/generate_tts_elevenlabs.cjs" ep{N}/narration_{파트}.txt ep{N}/segments_{파트}/ <narrator_voice_id>
```

**Typecast:**
```bash
node "$SCRIPT_DIR/generate_tts_typecast.cjs" narration ep{N}/narration_{파트}.txt ep{N}/segments_{파트}/ <narrator_voice_id>
```

**산출 (둘 다 동일):** `segments_{파트}/seg_NNN.mp3` + `seg_NNN.json` (캐릭터 단위 alignment, ElevenLabs 호환 shape) + `index.json`

> 두 제공자 모두 alignment 포맷이 통일돼 있어 5-1b 이후 단계는 제공자 무관하게 동일하게 작동.

### 5-1b. baseline 자막 자동 분할
```bash
node "$SCRIPT_DIR/draft_subtitles.cjs" ep{N}/segments_{파트}/ ep{N}/subtitles_{파트}.txt
```
**산출:** `subtitles_{파트}.txt` (한 자막 ≤ 42자 / 문장·절 경계 자동 분할)
**형식:** `[NNN|N] 자막1|자막2|자막3` (N = 나레이션, D:캐릭터명 = 대사)

### 5-1c. baseline SRT 빌드 (+ timeline JSON)
```bash
node "$SCRIPT_DIR/build_srt.cjs" ep{N}/segments_{파트}/ ep{N}/subtitles_{파트}.txt ep{N}/final_{파트}.srt ep{N}/timeline_{파트}.json
```
**4번째 인자 `timeline_{파트}.json` 필수** — W6 scenes.csv 빌드 입력. 빠지면 W6에서 막힘.

**산출:** `final_{파트}.srt` (alignment 기반 정확한 타임코드) + `timeline_{파트}.json` (세그먼트별 누적 시작/끝, W6 입력)

### 5-1d. 사용자 검토 (선택적 refinement)
- baseline SRT를 읽고 컷이 의미 단위인지 확인
- 만족 → 그대로 진행
- 다듬기 필요 → `subtitles_{파트}.txt`를 손으로 편집 (자막을 합치거나 `|`로 더 쪼개기) → 5-1c 재실행

> **자동 분할이 끊은 자리가 의미상 어색할 수 있음** (예: 절 경계는 잡지만 강조점은 모름). 그럴 때만 손대고, 문제없으면 baseline 그대로 사용.

### 5-1e. 세그먼트 mp3 → 파트 mp3 병합
```bash
node "$SCRIPT_DIR/merge_audio.cjs" ep{N}/segments_{파트}/ ep{N}/final_{파트}.mp3
```
**산출:** `final_{파트}.mp3` (`segments_{파트}/index.json` 기반 ffmpeg concat)

### 5-1f. 인물별 대사 TTS (Typecast, 대사가 있을 때만)
```bash
node "$SCRIPT_DIR/generate_tts_typecast.cjs" dialogue ep{N}/dialogs_{파트}.json ep{N}/voices/ ep{N}/tts_settings.md ep{N}/segments_{파트}/
```
**4번째 인자 `ep{N}/segments_{파트}/`** — 5-1a 산출 segments dir. 이게 있어야 `after_paragraph`로 대사 start 자동 도출. 없으면 `dialogs.json`의 명시적 `start` 필드 필수.
**산출:** `voices/{order:03d}_{캐릭터}_{HHMMSS}.mp3` + `result.json`
- 파일명의 `_HHMMSS`는 대사 시작 시각 (W8 자동 배치용)
- start 산출 우선순위 (스크립트 내부):
  1. `dialogs.json`의 명시적 `start` (SRT-format 문자열) — 그대로 사용
  2. `dialogs.json`의 `after_paragraph` + `segments_{파트}/index.json` `paragraph_idx` 매칭 → 누적 ffprobe duration + 0.3초 gap → start
  3. 둘 다 없으면 **throw** (silent `00:00:00` collision 차단)
- 감정 파라미터는 `dialogs_{파트}.json`의 `emotion` 필드에서 자동 매핑 (normal/happy/sad/angry)
- Vrew 케이스(segments dir 없음): `dialogs.json`에 `start` 모두 직접 기입 후 4번째 인자 생략

**최종 산출 (파트당):**
- `segments_{파트}/` — 나레이션 세그먼트 mp3 + alignment + index.json (`paragraph_idx` 포함)
- `subtitles_{파트}.txt` — baseline 또는 다듬은 자막 분할 명세
- `final_{파트}.mp3` — 파트별 병합 오디오
- `final_{파트}.srt` — 파트별 SRT (alignment 정확)
- **`timeline_{파트}.json`** — 세그먼트별 누적 시작/끝 시각 (W6 scenes.csv 빌드 입력 — 이거 빠지면 W6에서 막힘)
- `voices/` — 인물별 대사 mp3 (선택, 대사 있을 때만)

**리뷰 (서브스텝 5-1)** — 서브에이전트 자가검토 → 이슈 목록 → 수정. 최대 5회. 0 이슈 시 다음 서브스텝(5-2)으로 즉시 진행. 5회 초과 시 사용자에게 에스컬레이션.

---

## 5-2. SFX 음향효과 생성

W4에서 추출한 SFX 목록을 기반으로 음향효과를 생성한다.

**SFX 제공자:** ElevenLabs Sound Generation API
```
API: https://api.elevenlabs.io/v1/sound-generation
인증: ~/.elevenlabs/credentials
```

**SFX 파일명 타임코드 규칙 (AutoFlowCut 연동):**

SFX 파일은 AutoFlowCut에서 자동으로 타임라인에 overlay 배치된다.
파일명의 **마지막 `_` 뒤 숫자**가 타임코드로 파싱된다.

| 자릿수 | 형식 | 예시 파일명 | 의미 |
|--------|------|------------|------|
| 4자리 | `MMSS` | `주판_구슬_0134.mp3` | 01분 34초 |
| 6자리 | `HHMMSS` | `밤바람_촛불_010056.mp3` | 1시간 00분 56초 |

- 타임코드는 전체 오디오(final mp3) 기준 절대 시간
- AutoFlowCut의 `parseTimecodeFromFilename()` 함수가 자동 파싱
- 타임코드 없는 SFX 파일은 타임라인에 배치되지 않음

**타임코드 계산 방법 (SRT 앵커 기반):**

W4의 `08_sfx_목록.md`에 기록된 **앵커 나레이션**을 `final_{파트}.srt`에서 검색하여 타임코드를 결정한다.

1. `final_{파트}.srt`를 파싱하여 모든 엔트리의 `(start_ms, end_ms, text)` 목록 구성
2. 각 SFX 큐의 `앵커 나레이션`을 SRT 엔트리에서 부분 문자열 매칭
   - **0건 또는 2건 이상 매칭 → 즉시 에스컬레이션** (추정 배치 절대 금지)
3. 배치 규칙으로 **파트 내** 타임코드 결정:
   - `before N초` → `SRT_start - N초`
   - `concurrent` → `SRT_start`
   - `after N초` → `SRT_end + N초`
   - **경계 검증**: 결과 타임코드는 `0 ≤ timecode ≤ ffprobe(final_{파트}.mp3) 길이` 범위 안. 음수 또는 파트 길이 초과 → 즉시 에스컬레이션 (앵커/배치/오프셋 수정 필요)
4. 이 값이 **파트 내 타임코드** — `sfx/` 파일명의 `_MMSS`로 사용 (파트 오프셋은 5-3에서만 더함)
5. SRT 앵커 검색 결과로 `generate_sfx.cjs`용 manifest.json 생성 후 실행:
   ```json
   [{"num":1,"part":"기","filename":"01_주판_구슬_튕기기_0030","prompt":"...","duration":3}]
   ```
   - `filename`에 파트 내 `_MMSS` 타임코드 포함 → `generate_sfx.cjs`가 그대로 파일명 사용
   - `node "$SCRIPT_DIR/generate_sfx.cjs" manifest.json sfx/`

**앵커 미매칭 처리:**
- 0건 또는 2건 이상 매칭 → W4 `08_sfx_목록.md`의 앵커를 더 짧고 고유한 문구로 수정 후 재실행 (추정 배치 금지)

**SFX 디렉토리 (2단계):**

1. **`sfx/`** — 파트별 타임코드 원본 (`generate_sfx.cjs`가 생성)
   - 파일명의 `_MMSS`는 해당 파트의 `final_{파트}.mp3` 기준 시간
2. **`media/sfx/`** — 전체 타임라인 기준 (5-3 병합 후 변환)
   - 파일명의 `_MMSS`는 `final_full.mp3` 기준 절대 시간
   - AutoFlowCut 임포트 시 이 파일을 사용

**전체 타임코드 변환:**
```
파트별 시작 시간 = ffprobe로 각 final_{파트}.mp3 길이 누적
전체 타임코드 = 파트 오프셋 + 파트 내 타임코드
예) 승 SFX 2:01 → 기 6:35 + 2:01 = 전체 8:36
```

```
sfx/                          ← 원본 (파트별 기준)
├── 01_주판_구슬_튕기기_0030.mp3
├── 13_시장_소리_0201.mp3      ← 승 파트 내 2:01
└── ...

media/sfx/                    ← 최종 (전체 기준)
├── 01_주판_구슬_튕기기_0030.mp3  ← 기 0:30 그대로
├── 13_시장_소리_0836.mp3      ← 승 2:01 → 전체 8:36
└── ...
```

**SFX 데이터 구조:**
```python
# (번호, 파트, 파일명, 앵커나레이션, 배치, 오프셋초, 영문프롬프트, 길이초)
(1, "기", "01_주판_구슬_튕기기",
 "주판알이 튕기며", "concurrent", 0,
 "Wooden abacus beads clicking gently, traditional Korean counting", 3)
```

**출력:** `sfx/{파일명}_{파트별타임코드}.mp3` → 병합 후 `media/sfx/{파일명}_{전체타임코드}.mp3`

**리뷰 (서브스텝 5-2)** — 서브에이전트 자가검토 → 이슈 목록 → 수정. 최대 5회. 0 이슈 시 다음 서브스텝(5-3)으로 즉시 진행. 5회 초과 시 사용자에게 에스컬레이션.

---

## 5-3. 전체 오디오 병합 + SFX 타임코드 변환 (5파트)

**5파트**의 `final_{파트}.mp3`와 `final_{파트}.srt`를 하나로 병합하여 `media/`에 저장한다.
병합 순서 — `hook`을 첫째, 그 뒤에 4개 본편 파트를 장르 canonical 순서로:
- **yadam**: `hook → 기 → 승 → 전 → 결`
- **dark-history / bespoke**: `hook → setup → rising → crisis → resolution`

Hook이 full timeline의 offset 0 에서 시작한다.
SFX 파일은 파트별 타임코드에서 전체 타임라인 기준으로 변환하여 `media/sfx/`에 저장한다.

**mp3 병합:**
```bash
# merge_all.txt
file 'final_hook.mp3'
file 'final_기.mp3'
file 'final_승.mp3'
file 'final_전.mp3'
file 'final_결.mp3'

ffmpeg -y -f concat -safe 0 -i merge_all.txt -c copy media/final_full.mp3
```

**SRT 병합:**
- 각 파트의 SRT 타임코드에 앞 파트들의 누적 길이를 오프셋으로 더한다
- `ffprobe`로 각 `final_{파트}.mp3` 길이를 측정하여 오프셋 계산 (hook 먼저)
- 자막 번호를 1부터 연속으로 재부여

**SFX 전체 타임코드 변환:**
- 각 파트의 `final_{파트}.mp3` 길이를 ffprobe로 측정 → 파트별 오프셋 계산
- Hook 파트의 오프셋은 `0` (full timeline 시작)
- `sfx/` 원본 파일의 파트별 타임코드를 전체 타임라인 기준으로 변환
- 변환된 파일을 `media/sfx/`에 저장

```bash
# 파트 오프셋 예시 (ep10, hook = 22초)
# hook: 0초, 기: 22초(0:22), 승: 417초(6:57), 전: 798초(13:18), 결: 1401초(23:21)
# sfx/13_시장_소리_0201.mp3 (승 2:01 = 121초)
# → media/sfx/13_시장_소리_0858.mp3 (417 + 121 = 538초 = 8:58)
```

**최종 출력:**
- `media/final_full.mp3` — 전체 오디오 (hook+기+승+전+결 연속)
- `media/final_full.srt` — 전체 자막 (오프셋 적용된 타임코드)
- `media/sfx/*.mp3` — SFX (전체 타임라인 기준 MMSS 타임코드)

**리뷰 (서브스텝 5-3)** — 서브에이전트 자가검토 → 이슈 목록 → 수정. 최대 5회. 0 이슈 시 다음 서브스텝(5-4)으로 즉시 진행. 5회 초과 시 사용자에게 에스컬레이션.

---

## 5-4. SFX 타임코드 mechanic 검증 (W5 내부 일관성)

**W5 단계에서 검증 가능한 것만 수행한다 — `scenes.csv` (W6 산출물)에 의존하는 "씬 매칭 검증"은 본 단계에서 제외하고 W8 8-0 (W8-1 idempotent 재임포트 / W8-2 CapCut export 전) 도입부에서 실행한다 (`docs/{lang}/W8-assembly.md`).**

**W5-4에서 검증할 항목 (scenes.csv 불필요):**
1. **겹침 검증** — 같은 타임코드에 3개 이상 몰려있으면 실패 (CapCut에서 트랙 폭발)
2. **파트 내 범위 검증** — `sfx/` 원본 타임코드가 `0 ≤ tc ≤ final_{파트}.mp3` 범위 안 (5-2의 boundary check 재확인)
3. **전체 범위 검증** — `media/sfx/` 타임코드가 `final_full.mp3` 길이를 초과하지 않는지 확인
4. **파트별 오프셋 검증** — `sfx/` 원본의 파트별 타임코드 + 파트 오프셋 = `media/sfx/`의 전체 타임코드 (W5-3 변환의 정합성)

**검증 스크립트 (예시):**
```python
# sfx/ 및 media/sfx/ 파일명에서 타임코드 파싱 (마지막 _ 뒤의 MMSS / HHMMSS)
# 1. 겹침: media/sfx/에서 같은 타임코드 ±1s 내 3개 이상 → fail
# 2. 파트 내 범위: 각 sfx/{파트}/* 타임코드가 0 ≤ tc ≤ ffprobe(final_{파트}.mp3) → 벗어나면 fail
# 3. 전체 범위: 각 media/sfx/* 타임코드가 ≤ ffprobe(media/final_full.mp3) → 초과면 fail
# 4. 오프셋: 각 sfx/ 파일에 대해 (파트 오프셋 + 파트 내 타임코드) == media/sfx/ 타임코드
```

**검증 실패 시:**
- 겹침/범위 실패: W4 `08_sfx_목록.md`에서 해당 SFX의 앵커·배치·오프셋 수정 → 5-2 타임코드 재계산
- 오프셋 불일치: 5-3 변환 스크립트 로직 확인 (파트 오프셋 계산 오류)
- 재검증 → pass까지 반복

**W8로 이전된 항목 (참고):**
- **씬 매칭 검증** — 각 SFX 타임코드가 `scenes.csv`의 어느 씬 [start_time, end_time] 구간에 속하는지 확인 + 앵커 나레이션 역추적 크로스체크. `scenes.csv`는 W6 산출물이므로 W5에서는 불가능. → `docs/{lang}/W8-assembly.md`의 "8-0 SFX 씬 매칭 검증" 참조.

**STATE.md 업데이트:**
- step: `W05_sfx_timecode_qa`
- mechanic 검증 통과 후 기록 (씬 매칭은 W8에서 별도 기록)

**리뷰 (서브스텝 5-4)** — 서브에이전트 자가검토 → 이슈 목록 → 수정. 최대 5회. 0 이슈 시 다음 서브스텝(5-5)으로 즉시 진행. 5회 초과 시 사용자에게 에스컬레이션.

---

## 5-5. 오디오 임포트 (best-effort, mechanic-QA 통과 후)

**W5-4 mechanic QA가 통과한 후에만** 실행한다. 그 전에 임포트하면 사용자가
타임코드 깨진/SFX 범위 초과된 오디오를 듣게 된다. W5-4 통과 후 임포트하면
사용자는 mechanic-clean한 패키지를 W6/W7 도는 동안 병렬로 검토할 수 있다.

**voices 폴더 정리** (대사 존재 시) — API 호출 전 캐릭터별 서브폴더 생성. idempotent (W8-1에서 재실행해도 안전). **portable** — bash + zsh 모두 동작 (글로브 확장 대신 `find` 사용):
```sh
cd ep{번호}/media/voices && find . -maxdepth 1 -type f -name '*.mp3' \
  | while read -r f; do
      char=$(echo "$f" | sed 's|^\./[0-9]*_\([^_]*\)_.*|\1|')
      mkdir -p "$char"
      mv "$f" "$char/"
    done
```
루트 레벨의 모든 `*.mp3`가 캐릭터 서브폴더로 이동되면 `find`가 빈 결과를 반환해 루프가 진짜 no-op이 된다.

**API 호출 (단일 POST):**
```bash
curl -s -X POST http://localhost:3210/api/audio-import \
  -H "Content-Type: application/json" \
  -d '{"folderPath": "/path/to/project/story/ep{번호}"}'
```

**Best-effort 시맨틱:**
- 앱 오프라인 / 네트워크 에러 / non-2xx → 한 줄 warning 로그 후 진행. wave 차단/재시도 안 함. W8-1이 동일 POST를 idempotent하게 한 번 더 호출하는 안전망 역할.
- 성공 시 사용자에게 ONE 줄 chat:
  `🎧 오디오 임포트 완료 — W6/W7 진행 중 AutoFlowCut Audio 탭에서 검토하세요.`

**Best-effort인 이유:** 앱 내 audio 리뷰는 최적화(병렬 피드백)이지 정합성
요구사항이 아니다. 사용자 리뷰가 없어도 파이프라인은 정상 산출. W8-1이
idempotent하게 재임포트한다.

**재임포트 트리거:** 사용자가 W6/W7 중 Audio 탭에서 어느 세그먼트에 플래그
달고 재생성하면, 재생성된 산출물이 디스크에 떨어진 후 W5-5(또는 W8-1의
idempotent 임포트)를 다시 실행해 앱이 최신 패키지를 반영하도록 한다.

**새 파일 산출물 없음.** 임포트 부수효과는 앱 상태에 존재
(`.audio_review.json`은 앱이 쓰고 W5가 쓰지 않음).

**리뷰 (서브스텝 5-5)** — 패스스루: 부수효과 단계라 콘텐츠 리뷰 없음. 성공(진행) 또는 warning(진행, W8-1이 커버) 둘 중 하나.

---

## Wave 리뷰 요약
위 각 서브스텝은 최대 5회 리뷰(0 이슈 시 즉시 진행)를 강제한다. 마지막 서브스텝의 리뷰가 통과하면 Wave 5 완료. 어느 서브스텝이든 5회 초과 시 사용자에게 에스컬레이션.
