# W6: 스토리보드 CSV + 검토

이 문서는 story-engine 스킬의 W6(스토리보드 CSV 생성 + 검토) 단계 가이드입니다.

> ## 🚫 W6 범위 — 절대 규칙
>
> W6는 **CSV 파일만** 만든다. 프롬프트 텍스트까지만 작성하고, **이미지 생성은 하지 않는다.**
>
> **W6에서 금지** — 아래 MCP 도구/HTTP 엔드포인트를 W6 중에 호출하면 안 된다:
> - `mcp__autoflowcut__app_start_ref_batch` / `POST /api/start-ref-batch`
> - `mcp__autoflowcut__app_start_scene_batch` / `POST /api/start-scene-batch`
> - `mcp__autoflowcut__app_generate_reference` / `POST /api/generate-reference`
> - `mcp__autoflowcut__app_generate_scene` / `POST /api/generate-scene`
>
> 실제 이미지 생성은 **W7의 단독 책임**이다. W6에서 배치를 돌리면 검토되지 않은 CSV에 Flow API 크레딧을 소모하게 되고, "CSV 검토 → 이미지 생성" 경계가 무너진다.
>
> **W6에서 허용**: `get_schema`, `load_csv`, `list_scenes`, `list_references`, `save_csv`, `update_prompt`, `update_reference_prompt`, `update_field`, 그리고 파일 I/O.
>
> W6가 CSV 생성 + 검토를 마치고 이슈가 없으면, **그 자리에서 멈추고 W7로 넘긴다.** "CSV 준비됐으니" 이미지 생성을 선제적으로 시작하지 말 것.

> **W6는 외부 스크립트를 호출하지 않는다.** scenes.csv는 W5의 `final_{파트}.srt` + `timeline_{파트}.json`을 입력으로 **AutoFlowCut MCP 도구**(`get_schema`, `load_csv`, `update_field`, `save_csv`)로 직접 작성한다.

---

## 스토리보드 CSV 생성 (SRT 기반)

> **이 단계는 W5(TTS/SFX) 이후에만 실행 가능하다.**
> scenes.csv의 start_time/end_time은 SRT 타임코드와 timeline JSON에서 산출된다.
> SRT 없이는 정확한 씬 분리가 불가능하다.

**입력 데이터:**
- `final_{파트}.srt` — 파트별 자막 (의미 단위, 타임코드 포함)
- `timeline_{파트}.json` — 세그먼트별 시작/끝 시간
- 대본 원문 (기/승/전/결 .md 파일)
- **`voices/result_{파트}.json`** (대사 있는 경우, 파트별로 1개씩 = 최대 4개) — W5-1f가 작성한 dialogue TTS 결과. 각 엔트리에 `{order, character, line, emotion, file, duration, start}` — `start` 는 **TTS 실제 duration 누적까지 반영된 resolved start** (연속 대사 stacking 포함, `generate_tts_typecast.cjs` `groupEnd` 추적 결과). 단, `start` 는 **파트 내부 timecode** (각 파트가 0부터 시작) — W6는 timeline 표 [파트 오프셋 계산]에 따라 full-timeline으로 변환. `options.splitOnSpeakerChange: true` 일 때 **1차 source**.
- **`voices/*_{HHMMSS}.mp3`** (대사 있는 경우) — 파일명의 `HHMMSS` 가 파트 내부 resolved start (TC 형식). `result_{파트}.json` 부재 시 파일명만으로도 speaker(`character` 토큰) + start 복원 가능. **주의**: 파일명에 파트 접두가 없어 같은 character가 두 파트에서 같은 per-part 시각에 발화하면 fname 충돌 가능 — 그런 경우 `result_{파트}.json` 우선.
- `dialogs_{파트}.json` + `segments_{파트}/index.json` (있는 경우) — W4/W5 중간 산출. **fallback** 으로만 사용: 단일 대사 paragraph 에서는 `after_paragraph` → `paragraph_idx` 매칭으로 정확하지만, **같은 paragraph에 연속 대사가 있을 경우 stacking을 알 수 없어 부정확**. voices output이 있으면 우선.

대본과 SRT/타임라인을 기반으로 **레퍼런스 CSV**와 **씬 CSV**를 생성한다.
AutoFlowCut MCP의 `get_schema` 도구로 CSV 스키마를 조회하여 정확한 구조를 따른다.

```
AutoFlowCut MCP: get_schema({ type: "scenes" })      → 씬 CSV 컬럼 확인
AutoFlowCut MCP: get_schema({ type: "references" })   → 레퍼런스 CSV 컬럼 확인
AutoFlowCut MCP: get_schema({ type: "prompt-image" }) → 프롬프트 작성 가이드
```

### 6-1. 레퍼런스 CSV 작성 (`references.csv`)

**대본의 등장인물(`character`)과 장소(`scene`)만 레퍼런스로 정의한다. `type: style` 행은 W6에서 작성하지 않는다 — W7의 단일 책임이다.**

> **스타일 책임 분리:** 사용자에게 "어떤 아트 스타일?"을 묻는 작업, `list_styles`로 프리셋 조회, `styleId` 결정, `type: style` 행 작성은 모두 **W7 7-1**에서 수행한다. W6에서 사용자에게 스타일을 묻지 말 것 — 두 단계가 같은 질문을 반복하면 사용자 혼란.

**W6에서 작성하는 type 값:**
- `character` — 등장인물
- `scene` — 장소
- ~~`style`~~ — **W7 7-1에서 추가** (사용자 styleId 선택 후 `update_reference_prompt` MCP로 type:style 행 추가)

| 컬럼 | 설명 |
|------|------|
| `name` | 레퍼런스 이름 (인물명, 장소명) |
| `type` | `character` / `scene` (W6 범위) |
| `prompt` | 영문 이미지 생성 프롬프트 |

**인물(character) 작성 규칙:**
- `solo, single person`으로 시작
- 나이, 성별, 외모, 머리(상투/댕기머리), 의복(저고리+치마/도포 등), 표정 포함
- 조선시대 용어 병기: `topknot (상투)`, `gat hat (갓)`
- 마지막에 `historical Korean costume, no modern clothing`

**장소(scene) 작성 규칙:**
- 시대, 건축양식, 조명, 분위기 포함
- 시간대 변형: `courtyard`, `courtyard_rain`, `courtyard_night`
- 마지막에 `no modern elements`

**리뷰 (서브스텝 6-1)** — 서브에이전트 자가검토 → 이슈 목록 → 수정. 최대 5회. 0 이슈 시 다음 서브스텝(6-2)으로 즉시 진행. 5회 초과 시 사용자에게 에스컬레이션.

### 6-2. 씬 CSV 작성 (`{제목}_scenes.csv`)

| 컬럼 | 필수 | 설명 |
|------|------|------|
| `prompt` | O | 영문 이미지/비디오 프롬프트 |
| `prompt_ko` | | 한글 프롬프트 요약 |
| `subtitle` | | 나레이션/대사 자막 |
| `characters` | | 등장 인물 (쉼표 구분) |
| `scene_tag` | | 장소 태그 (references.csv의 scene name과 매칭) |
| `style_tag` | | 분위기 태그 |
| `shot_type` | | `scene` / `reaction` / `narration` / `dialogue` |
| `duration` | | 씬 길이 (초) |
| `start_time` | | 시작 시간 (초) |
| `end_time` | | 종료 시간 (초) |
| `parent_scene` | | 씬 그룹 ID (S001, S002...) |

### 씬 분리 규칙

**SRT/타임라인 기반 씬 분리:**
- `timeline_{파트}.json`의 세그먼트를 기본 단위로 삼는다
- 한 세그먼트가 15초를 넘으면 내용 기준으로 분할한다
- 짧은 세그먼트(대사 등)는 같은 장면이면 인접 세그먼트와 병합한다
- `start_time`/`end_time`은 전체 타임라인 기준 (파트 오프셋 적용)
- **타임라인 갭 0초 원칙**: 씬N의 `end_time` = 씬N+1의 `start_time`이어야 한다. 빈 구간이 있으면 CapCut export 시 해당 구간의 이미지와 오디오가 누락된다
- **SRT 전체 커버리지 원칙**: SRT의 모든 자막 구간이 반드시 어떤 씬에 포함되어야 한다. SRT 항목을 하나도 빠뜨리지 않는다. SRT 항목 사이의 무음 구간도 인접 씬에 흡수시켜 빈틈을 만들지 않는다

**일반 분리 규칙:**
- **한 씬은 15초를 넘기지 않는다** (시청자 집중력 유지)
- 내용적으로 구분되는 단위로 나눈다 (장소, 시간, 행동, 감정 전환 기준)
- 같은 장소라도 감정/행동이 바뀌면 별도 씬으로 분리
- 대사 중심 씬과 묘사 중심 씬을 구분
- 씬당 평균 10초 전후 (28분 영상 기준 약 150~250장면)

**화자 전환 분리 (옵션, options.splitOnSpeakerChange):**

W_progress.json 루트의 `options.splitOnSpeakerChange` 값을 읽어 분기:
- `true` 면: **타임코드 매핑된 speaker source가 있을 때만** 화자 전환 경계를 씬 분리 후보로 추가한다 (아래 우선순위 참조).
  - 예: 같은 5초 구간에 A→B→A 발화가 있으면 3개 씬으로 분리
  - 단 15s 한도 + 짧은 인사(1~2초)는 인접 화자와 병합 (subagent 판단)
  - **Narration-only 구간** (dialogs 엔트리 없음, narration_{파트}.txt 만 존재)은 화자 전환 후보 없음 → 기존 룰 적용
- `false` (default) 또는 필드 누락 → 기존 룰 그대로 (같은 시간대 / 같은 장면 안에서는 화자 달라도 같은 씬)

**Speaker source 우선순위** (`true` 일 때, 위에서부터 적용):
1. **`voices/result_{파트}.json`** — **1차 source**. 각 파트별로 1개 파일. 엔트리의 `start` 가 W5-1f의 TTS-resolved 값 (연속 대사 stacking까지 반영). `character` 가 speaker ID, `duration` 이 종료 시각 산출용. 파트별 timecode이므로 W6 파트 오프셋을 더해 full-timeline 으로 변환. 이 파일이 있으면 보수적 fallback 없이 분리한다.
2. **`voices/*_{HHMMSS}.mp3` 파일명 파싱** — `result_{파트}.json` 부재 시 `voices/` 디렉토리의 mp3 파일명 (`{order}_{character}_{HHMMSS}.mp3`) 에서 speaker + 파트별 resolved start 복원. duration은 ffprobe 로 산출. 어느 파트인지는 mp3 의 mtime 또는 `dialogs_{파트}.json` 의 `{order, character}` 매칭으로 결정.
3. **`dialogs_{파트}.json` + `segments_{파트}/index.json`** (fallback) — `dialogs.after_paragraph` 를 `paragraph_idx` 와 매칭해 base start 산출. **단일 대사 paragraph 일 때만 정확하고, 연속 대사가 있는 paragraph 는 stacking을 못 알아 부정확**. voices output 부재 시 + 해당 paragraph의 대사 1개일 때만 활용.
4. **대본 (`{title}_*.md`) 의 명시적 화자 라벨** — `"A:"`, `"내레이터:"`, `"{이름}:"` 형식. 위 셋 모두 부재일 때만. 라벨 paragraph를 `segments_index.paragraph_idx` 로 timeline에 매핑 (paragraph 단위로 coarse).
5. **문맥 추정** — 위 넷 모두 없을 때. subagent가 대화 흐름으로 추정. 신뢰도 낮으면 분리 안 함 (보수적). 1~5 모두 부재면 `splitOnSpeakerChange: true` 라도 실질 효과 없음 — review 노트에 `voices/result_*.json + dialogs_{파트}.json absent — speaker-change splitting skipped` 기록.

**전체 타임라인 파트 오프셋 계산:**
```
기: 0초
승: ffprobe(final_기.mp3) 누적
전: 기 + 승 누적
결: 기 + 승 + 전 누적
```

**리뷰 (서브스텝 6-2)** — 서브에이전트 자가검토 → 이슈 목록 → 수정. 최대 5회. 0 이슈 시 다음 서브스텝(6-3)으로 즉시 진행. 5회 초과 시 사용자에게 에스컬레이션.

### 6-3. 스토리보드 CSV 검토 (subagent, 최대 5회)

생성된 references.csv와 scenes.csv를 subagent가 **Read 도구로 직접 읽고** 검토한다.

**프로그램 코드 사용 금지**: 반드시 Read 도구로 파일을 직접 읽고 눈으로 대조한다.

```
┌─ subagent: CSV 파일 + 대본 + SRT 직접 읽기 → 대조 검토
│     ▼
│  수정사항 있음? → YES → 수정 반영 → 재검토 (반복)
│                → NO  → 루프 종료
│
│  ※ 최대 5라운드. 초과 시 사용자에게 보고
└─────────────────────────────────────
```

**references.csv 검토 기준:**
1. 대본에 등장하는 모든 인물이 포함되었는가 (누락)
2. 대본에 나오는 모든 장소가 포함되었는가 (누락)
3. 영문 프롬프트가 대본의 인물/장소 묘사와 일치하는가
4. 조선시대 고증이 정확한가 (의복, 건축, 소품)
5. `solo, single person` / `no modern clothing` / `no modern elements` 등 필수 키워드가 포함되었는가

**scenes.csv 검토 — batch QA × 3 parallel** (10 항목, 3-3-4 그룹핑)

10 항목을 한 subagent에 던지면 형식적 통과만 함. 3 그룹으로 나눠 **병렬 호출** (SKILL.md "Batch QA discipline" 참조).

각 그룹의 review 파일은 별도 경로에 씀: `_story_source/06_review_groupA.md`, `_groupB.md`, `_groupC.md`.

**[Group A — Completeness] (3 항목, read-only: 대본/SRT/scenes.csv)**
1. 대본의 모든 장면이 빠짐없이 포함되었는가 (누락)
2. subtitle이 SRT/대본 원문과 일치하는가
4. characters가 해당 씬의 실제 등장인물과 일치하는가

**[Group B — Reference integrity] (3 항목, read-only: scenes.csv/references.csv/timeline JSON)**
3. start_time/end_time이 timeline JSON과 일치하는가
5. scene_tag가 references.csv의 장소 name과 정확히 매칭되는가
7. 영문 프롬프트가 해당 장면의 분위기/행동을 정확히 묘사하는가

**[Group C — Timing structure] (4 항목, subagent가 Read로 scenes.csv 직접 점검)**

⚠ **Group C도 다른 그룹과 동일하게 subagent + Read 도구로 점검한다.** 6-2 끝에 있는 Python pre-check 스크립트(갭/커버리지/duration)는 별개의 자동 sanity check일 뿐, **본 QA 단계의 substitute가 아니다**. "스크립트가 통과 찍었으니 OK"는 금지 — subagent가 CSV를 직접 읽고 눈으로 대조하여 보고한다.

6. 한 씬이 15초를 넘지 않는가 (subagent가 모든 행의 duration 컬럼 직접 확인)
8. **타임라인 갭 검증**: 씬N의 `end_time` = 씬N+1의 `start_time`인가? 0.5초 이상 갭 = 오류 (subagent가 인접 행 쌍을 직접 대조)
9. **타임라인 커버리지 검증**: 첫 씬 `start_time`=0, 마지막 씬 `end_time`=오디오 총 길이와 일치 (subagent는 ffprobe 출력은 참고할 수 있으나 판정은 직접)
10. **duration 합산 검증**: 모든 씬의 duration 합산 = 오디오 총 길이 (subagent가 더하기 직접 수행하거나 합산 결과를 CSV와 대조)

**오케스트레이터는 3 subagent 병렬 호출** (한 메시지에 3개 `Agent` 호출):
- 각 그룹은 자기 review 파일만 씀 (06_review_group{A,B,C}.md)
- STATE.md / W_progress.json은 안 건드림 — 오케스트레이터가 모두 반환 후 합산
- 모든 그룹 0 이슈 → 6-3 통과
- 한 그룹이라도 5 라운드 초과 → 전체 wave escalation

**씬 CSV 생성 직후 필수 검증 (자동 실행):**

씬 CSV를 만든 직후 아래 검증을 **반드시** 실행한다. 하나라도 실패하면 씬 CSV를 수정한다.

```bash
# 1. 갭 검증
python3 -c "
import csv
with open('{제목}_scenes.csv') as f:
    scenes = list(csv.DictReader(f))
gaps = []
for i in range(len(scenes)-1):
    gap = float(scenes[i+1].get('start_time',0)) - float(scenes[i].get('end_time',0))
    if gap > 0.5:
        gaps.append((i+1, i+2, round(gap,2)))
if gaps:
    print(f'갭 {len(gaps)}개 발견!')
    for a,b,g in gaps: print(f'  씬{a}→{b}: {g}초')
else:
    print('갭 없음')
"

# 2. 커버리지 검증 (첫 씬=0, 마지막 씬=오디오 길이)
python3 -c "
import csv, subprocess
with open('{제목}_scenes.csv') as f:
    scenes = list(csv.DictReader(f))
first_start = float(scenes[0]['start_time'])
last_end = float(scenes[-1]['end_time'])
audio_dur = float(subprocess.check_output(
    ['ffprobe','-v','quiet','-show_entries','format=duration','-of','csv=p=0','media/final_full.mp3']
).strip())
print(f'첫 씬 시작: {first_start}초 (0이어야 함)')
print(f'마지막 씬 끝: {last_end:.1f}초')
print(f'오디오 길이: {audio_dur:.1f}초')
diff = abs(last_end - audio_dur)
print(f'커버리지 OK (차이 {diff:.1f}초)' if diff < 5 else f'커버리지 불일치! 차이 {diff:.1f}초')
"

# 3. duration 합산 검증
python3 -c "
import csv
with open('{제목}_scenes.csv') as f:
    scenes = list(csv.DictReader(f))
total = sum(float(s.get('end_time',0)) - float(s.get('start_time',0)) for s in scenes)
print(f'씬 합산: {total:.1f}초 ({total/60:.1f}분)')
"
```

**출력 파일**: `references.csv`, `{제목}_scenes.csv`

**리뷰 (서브스텝 6-3)** — 서브에이전트 자가검토 → 이슈 목록 → 수정. 최대 5회. 0 이슈 시 다음 Wave로 즉시 진행. 5회 초과 시 사용자에게 에스컬레이션.

---

## Wave 리뷰 요약
위 각 서브스텝은 최대 5회 리뷰(0 이슈 시 즉시 진행)를 강제한다. 마지막 서브스텝의 리뷰가 통과하면 Wave 6 완료. 어느 서브스텝이든 5회 초과 시 사용자에게 에스컬레이션.
