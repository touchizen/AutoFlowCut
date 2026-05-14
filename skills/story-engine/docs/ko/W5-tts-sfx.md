# W5: TTS/SFX + 타임코드 검증

이 문서는 story-engine 스킬의 W5(TTS/SFX 생성 + 타임코드 검증) 단계 가이드입니다.

W4에서 추출한 나레이션/대사/SFX 데이터로 오디오를 생성한다.

> **`production_scope` 게이트 (시작 시 필독).** W5 서브에이전트는 시작하자마자 `STATE.md` `## Decisions`의 `production_scope:` 블록을 읽는다 (자세한 내용은 `workflows/execute-pipeline.md` "STATE.md schema — production_scope block" 참조). 블록이 없으면 `{ dialogue: true, sfx: true }`로 fallback (현재 동작 보존). 두 플래그는 5-0-assign, 5-1f, 5-2, 5-3, 5-4의 분기 동작을 결정한다 — 각 서브스텝 앞에 명시된 스킵 조건 참조. **파일 부재(absent file)도 동등한 권위를 갖는다** — `dialogs_{파트}.json`이나 `08_sfx_*.md`가 디스크에 없으면 해당 서브스텝은 자동 스킵 (빈 파일 vs missing 파일을 구별하지 않음).

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

### 5-0-prep + 키 preflight (5-0-assign 진입 전 필수)

**제공자 선택이 끝난 직후 (그리고 W5 시작 시 읽은 `production_scope` 블록을 기준으로)** 서브에이전트는 **키 preflight 루프**를 실행한다. API 키가 없거나 만료됐을 때 W5 깊숙이 들어간 뒤가 아니라 **모든 비싼 작업 전에** 노출시켜 W1~W4 산출을 낭비하지 않게 한다.

> **v1 = 수동 보조 preflight.** 서브에이전트는 키를 읽고/검증하고 사용자에게 정확한 credentials 경로를 알려주지만, **credentials 파일을 직접 쓰지 않는다**. 사용자가 `~/.<provider>/credentials`에 직접 한 줄 (dotenv 형식) 붙여넣고 서브에이전트가 재검증한다. 자동 persist는 후속 follow-up.

**Step 1 — provider 선택 + `production_scope`로부터 필요-키 집합 산출.** 빈 집합에서 시작해 다음을 합산:

| 나레이션 선택 | 대사 선택 | `production_scope.sfx` | 필요 키 |
|------------|----------|------------------------|--------|
| ElevenLabs | Typecast | true | ElevenLabs + Typecast |
| Typecast | Typecast | true | Typecast + ElevenLabs (SFX용) |
| ElevenLabs | (대사 없음) | true | ElevenLabs |
| Vrew (외부) | Typecast | true | Typecast + ElevenLabs (SFX용) |
| Typecast | (대사 없음) | true | Typecast + ElevenLabs (SFX용) |
| Vrew (외부) | (대사 없음) | true | ElevenLabs (SFX 전용) |
| (어떤 나레이션) | (어떤 대사) | **false** | (ElevenLabs-for-SFX 항목 제거) |

**`production_scope.dialogue: false`** 일 때는 대사 측 Typecast 요구가 빠진다. 단, 나레이션이 Typecast면 Typecast는 여전히 필수 (나레이션은 mandatory). 마찬가지로 **`production_scope.sfx: false`** 일 때는 ElevenLabs-for-SFX 요구가 빠진다. 다른 슬롯에서도 ElevenLabs를 쓰지 않으면 ElevenLabs는 필요-키 집합에 아예 안 들어간다.

최종 규칙: **필요-키 집합 = {나레이션 제공자} ∪ {대사 제공자 (when `production_scope.dialogue: true`)} ∪ {ElevenLabs (when `production_scope.sfx: true`)}**. Vrew는 로컬 앱이라 키 없음 — 어떤 기여도 없음.

**Step 2 — 필요-키 집합의 각 제공자에 대해 검증.** 먼저 `readApiKey(provider)` 로드 시도 (env var → credentials 파일 fallback; `lib_afc.cjs`에 `elevenlabs`/`typecast`는 이미 구현됨). 그 다음 cheap GET을 날려 키가 실제로 인증되는지 확인:

| 제공자 | 메서드 | URL | 헤더 | 성공 | 실패 (bad key) | Signup URL (miss 시 표시) |
|--------|--------|-----|------|------|----------------|-------------------------|
| ElevenLabs | GET | `https://api.elevenlabs.io/v1/voices` | `xi-api-key: <key>` | 200 | 401 | `https://elevenlabs.io/app/speech-synthesis/api-keys` |
| Typecast | GET | `https://api.typecast.ai/v1/voices` | `x-api-key: <key>` | 200 | 401 | `https://app.typecast.ai/api-keys` |
| Google AI Studio (Gemini) | GET | `https://generativelanguage.googleapis.com/v1beta/models?key=<key>` | (URL에 key 포함) | 200 | 400 / 403 | `https://aistudio.google.com/app/apikey` |

> Gemini는 **forward-compat 목적의 문서화일 뿐** — 번들 `lib_afc.cjs` `readApiKey()`가 아직 `gemini`를 지원하지 않고, Gemini 키를 사용하는 번들 W5 스크립트도 없다. 향후 provider 선택이 Gemini를 가리키면 preflight 루프는 구조적으로 동일하지만 (같은 3-분기 classify-and-remediate), v1 번들은 거기서 blocking 된다. 아래 env-name / credentials-path는 forward-compatible placeholder로 보관.

세 검증 엔드포인트 모두 read-only + 무료 (`GET /voices`, `GET /models` 사용량 과금 없음). 호출당 < 1초. 5xx는 "검증 스킵, 경고만 출력 후 진행"으로 처리 — 일시적 인프라 문제로 파이프라인 막지 않음. 정말 잘못된 키면 실제 TTS 호출에서 더 구체적인 에러가 잡힌다.

**Step 3 — 결과를 분류하고 사용자 화면에 chat 라인 출력.** 사용자가 진행 heartbeat를 볼 수 있게 provider별 1줄씩 배너 출력:

```
▸ Validating ElevenLabs API key…
✅ ElevenLabs key OK
▸ Validating Typecast API key…
⚠ Typecast key missing (~/.typecast/credentials)
  [paste / open-file / switch-to-elevenlabs-for-dialogue]
```

3 버킷, 3 분기:

- **Found + validates (200)** → provider OK 표시, 다음 필요-키로.
- **Not found** (env var도 credentials 파일도 없음) → "최초 설정" remediation 메뉴 (Step 4).
- **Found but 401 / 403** → "stale/invalid" remediation 메뉴 (Step 4). chat 오프닝:
  `⚠ Typecast key at ~/.typecast/credentials returned 401. 만료 또는 잘못된 계정.`

**Step 4 — Remediation 메뉴 (AskUserQuestion).** miss/stale 모두 동일한 4 옵션, chat 오프닝만 다르다:

| 옵션 | 서브에이전트가 하는 일 |
|------|--------------------|
| **(a) "키가 있어요 — credentials 파일에 직접 붙여넣을게요"** | 정확한 경로 (`~/.<provider>/credentials`) + 정확한 줄 형식 (`<ENVNAME>=<value>`, mode 0600) 출력. 사용자 확인 대기. 해당 provider에 대해 Step 2 검증 재실행. **v1: 사용자가 직접 붙여넣음; 서브에이전트는 파일을 쓰지 않는다.** |
| **(b) "키 받는 방법 보여주세요"** | provider signup URL (위 표 verbatim) + dashboard에서 키가 어디에 있는지 한 줄 hint 출력. 사용자가 받으면 (a)로 루프. |
| **(c) "다른 제공자로 변경"** | W5-0-prep AskUserQuestion 재오픈 (narration / dialogue 중 막힌 슬롯). 새 선택으로 Step 1부터 필요-키 집합 재산출. Step 2부터 재검증. |
| **(d) "직접 설정할게요 — 나중에 재개"** | credentials 파일 경로 출력하고 파이프라인 일시정지. `/story-resume` 시 OK 안 된 provider들에 대해 Step 2부터 재실행. |

매 옵션 끝에 credentials 위치 1줄 reminder:

```
Credentials file: ~/.<provider>/credentials (dotenv 형식: <ENVNAME>=...; chmod 0600)
```

**Credentials 경로 + env-name 참고 (verbatim — miss 시 사용자에게 표시):**

| 제공자 | env var 이름 | credentials 파일 경로 |
|--------|-------------|---------------------|
| ElevenLabs | `ELEVENLABS_API_KEY` | `~/.elevenlabs/credentials` |
| Typecast | `TYPECAST_API_KEY` | `~/.typecast/credentials` |
| Google AI Studio (Gemini) | `GOOGLE_AI_STUDIO_API_KEY` (placeholder — `lib_afc.cjs`에서 아직 안 읽음) | `~/.google-ai-studio/credentials` (placeholder — `lib_afc.cjs`에서 아직 안 읽음) |

**Step 5 — 게이트.** 필요-키 집합의 **모든 provider가 OK로 검증된 뒤에만** 5-0-assign으로 진행 (어느 provider도 {miss, 401, transient-5xx} 버킷에 남으면 안 됨). 사용자가 (d)를 선택해 파이프라인이 일시정지되면, `/story-resume` 시 W5 서브에이전트는 아직 OK 아닌 provider에 대해 Step 2부터 preflight 루프에 재진입한다.

**`production_scope` 상호작용 (명시):**
- **`production_scope.dialogue: false`** — 대사 측 Typecast를 필요-키 집합에서 제거. 나레이션이 Typecast라면 나레이션 측 Typecast는 여전히 카운트.
- **`production_scope.sfx: false`** — ElevenLabs-for-SFX 요구 제거. 다른 슬롯에서도 ElevenLabs 미사용이면 ElevenLabs는 필요-키 집합에 **아예 안 들어감** (검증 자체 skip).
- 둘 다 off → 필요-키 집합이 {Typecast} (TC 나레이션) 또는 {ElevenLabs} (EL 나레이션) 1개로 줄 수 있음. preflight는 여전히 실행, 단 루프가 1회만 돌 뿐.

**왜 W5-0-prep이고 더 빠르지 않나:** 필요-키 집합은 여기서 결정된 provider 선택에 의존한다. `/story-new` 시 묻는다면 이번 에피소드에 실제로는 쓰지 않을 provider 키까지 요구하게 됨. 더 늦게 (5-1a 중간) 묻는다면 W1~W4 작업이 이미 낭비됨. W5-0-prep이 골디락스 포인트.

### 5-0-assign. 캐릭터별 voice 할당

> **`production_scope.dialogue: false` 일 때**: 본 단계에서 캐릭터 voice 할당은 **전체 스킵**한다. `tts_settings.md`에 `narrator` 행만 필수이며, `dialogs_{파트}.json`이 부재하므로 character 추출 자체가 불가능 — `AskUserQuestion`을 캐릭터에 대해 호출하지 않는다. (narrator 매핑이 없으면 narrator만 5-0-prep과 함께 묻기.)

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

> **`production_scope.dialogue: false` 또는 `dialogs_{파트}.json` 부재 → 본 단계 전체 스킵**. `voices/` 디렉토리를 생성하지 않는다. 어느 한 조건이라도 만족하면 스킵 (둘 다 권위적). 5-1e 완료 후 즉시 5-2로 진행.

```bash
node "$SCRIPT_DIR/generate_tts_typecast.cjs" dialogue ep{N}/dialogs_{파트}.json ep{N}/voices/ ep{N}/tts_settings.md ep{N}/segments_{파트}/
```
**4번째 인자 `ep{N}/segments_{파트}/`** — 5-1a 산출 segments dir. 이게 있어야 `after_paragraph`로 대사 start 자동 도출. 없으면 `dialogs.json`의 명시적 `start` 필드 필수.
**산출:** `voices/{파트}_{order:03d}_{캐릭터}_{HHMMSS}.mp3` + `voices/result_{파트}.json`
- 파일명 앞의 `{파트}` 토큰 (예: `setup_`, `기_`, `part1_setup_`) 은 `dialogs_{파트}.json` 의 basename 에서 자동 도출됨 (`derivePartFromDialogsPath`). 4개 파트를 같은 `voices/` 에 순차 실행해도 파일명 충돌 없음 — 같은 character가 두 파트에서 같은 per-part order + HHMMSS 로 발화해도 별도 파일로 보존되어 W6 화자 split timing 과 W8 오디오 임포트 모두 정확.
- `result_{파트}.json` 도 파트별로 분리 저장되므로 각 파트의 dialogue 메타데이터 (start/duration/character) 가 독립 보존된다.
- **이전 버전 (collision 가능):** fname 이 `{order}_{character}_{HHMMSS}.mp3` 였고 단일 `result.json` 만 썼음 → 두 번째 파트가 첫 번째 파트의 mp3 를 silently 재사용 + 마지막 파트의 result.json만 살아남음.
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

> **`production_scope.sfx: false` 또는 `08_sfx_목록.md` 부재 → 본 단계 전체 스킵**. `sfx/` / `media/sfx/` 둘 다 생성하지 않는다. 어느 한 조건이라도 만족하면 스킵 (둘 다 권위적). 5-1f 완료 후 (또는 dialogue도 스킵 시 5-1e 완료 후) 즉시 5-3으로 진행.

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

## 5-3. 전체 오디오 병합 + SFX 타임코드 변환

> **`production_scope.sfx: false` 일 때**: 나레이션 mp3/SRT 병합은 그대로 실행 (항상 실행). **SFX 타임코드 변환 부분은 no-op** (변환할 `sfx/*.mp3`가 없음). `media/sfx/`는 생성되지 않고, AutoFlowCut import 시 SFX 트랙도 없음. 다운스트림 (W6 / W8) 모두 `media/sfx/` 부재를 정상 상태로 받아들임.

4파트의 `final_{파트}.mp3`와 `final_{파트}.srt`를 하나로 병합하여 `media/`에 저장한다.
SFX 파일은 파트별 타임코드에서 전체 타임라인 기준으로 변환하여 `media/sfx/`에 저장한다.

**mp3 병합:**
```bash
# merge_all.txt
file 'final_기.mp3'
file 'final_승.mp3'
file 'final_전.mp3'
file 'final_결.mp3'

ffmpeg -y -f concat -safe 0 -i merge_all.txt -c copy media/final_full.mp3
```

**SRT 병합:**
- 각 파트의 SRT 타임코드에 앞 파트들의 누적 길이를 오프셋으로 더한다
- `ffprobe`로 각 `final_{파트}.mp3` 길이를 측정하여 오프셋 계산
- 자막 번호를 1부터 연속으로 재부여

**SFX 전체 타임코드 변환:**
- 각 파트의 `final_{파트}.mp3` 길이를 ffprobe로 측정 → 파트별 오프셋 계산
- `sfx/` 원본 파일의 파트별 타임코드를 전체 타임라인 기준으로 변환
- 변환된 파일을 `media/sfx/`에 저장

```bash
# 파트 오프셋 예시 (ep10)
# 기: 0초, 승: 395초(6:35), 전: 776초(12:56), 결: 1379초(22:59)
# sfx/13_시장_소리_0201.mp3 (승 2:01 = 121초)
# → media/sfx/13_시장_소리_0836.mp3 (395 + 121 = 516초 = 8:36)
```

**최종 출력:**
- `media/final_full.mp3` — 전체 오디오 (기+승+전+결 연속)
- `media/final_full.srt` — 전체 자막 (오프셋 적용된 타임코드)
- `media/sfx/*.mp3` — SFX (전체 타임라인 기준 MMSS 타임코드)

**리뷰 (서브스텝 5-3)** — 서브에이전트 자가검토 → 이슈 목록 → 수정. 최대 5회. 0 이슈 시 다음 서브스텝(5-4)으로 즉시 진행. 5회 초과 시 사용자에게 에스컬레이션.

---

## 5-4. SFX 타임코드 mechanic 검증 (W5 내부 일관성)

> **`production_scope.sfx: false` 일 때**: SFX 큐 목록이 비어있음 (`08_sfx_목록.md` 부재 + `media/sfx/` 부재). 따라서 아래 4개 검사 항목 (겹침/파트 내 범위/전체 범위/파트별 오프셋)이 **모두 vacuous** 하다. **early-return success** — 빈 cue 리스트는 자동으로 pass. mechanic QA 자체는 여전히 실행되어 (서브에이전트 자가검토 루프) 나레이션 타이밍 관련 일관성을 검증한다. SFX 항목만 0/0으로 트리비얼 통과.

**W5 단계에서 검증 가능한 것만 수행한다 — `scenes.csv` (W6 산출물)에 의존하는 "씬 매칭 검증"은 본 단계에서 제외하고 W8 8-0 (오디오 임포트 전) 도입부에서 실행한다 (`docs/{lang}/W8-assembly.md`).**

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

**리뷰 (서브스텝 5-4)** — 서브에이전트 자가검토 → 이슈 목록 → 수정. 최대 5회. 0 이슈 시 다음 Wave로 즉시 진행. 5회 초과 시 사용자에게 에스컬레이션.

---

## Wave 리뷰 요약
위 각 서브스텝은 최대 5회 리뷰(0 이슈 시 즉시 진행)를 강제한다. 마지막 서브스텝의 리뷰가 통과하면 Wave 5 완료. 어느 서브스텝이든 5회 초과 시 사용자에게 에스컬레이션.
