# W5: TTS/SFX + 타임코드 검증

이 문서는 story-engine 스킬의 W5(TTS/SFX 생성 + 타임코드 검증) 단계 가이드입니다.

W4에서 추출한 나레이션/대사/SFX 데이터로 오디오를 생성한다.

---

## TTS 제공자 옵션 (overview)

대본에서 추출한 나레이션과 인물별 대사를 TTS로 생성한다. 아래 표는 제공자 옵션 개요이며, 실제 실행 순서는 **5-0 → 5-1** 이다.

**TTS 제공자 옵션** (사용자가 선택):

| 제공자 | API | 인증 | 특징 |
|--------|-----|------|------|
| **ElevenLabs** | `https://api.elevenlabs.io/v1/text-to-speech` | `~/.elevenlabs/credentials` | 다국어, 커스텀 보이스, SRT 자동 생성 |
| **Typecast** | `https://api.typecast.ai/v1/text-to-speech` | `~/.typecast/credentials` | 한국어 전문, 감정 파라미터(normal/happy/sad/angry) |
| **Vrew** | 로컬 앱 (수동) | — | AI 자막+편집, 무료 크레딧 |
| **Google AI Studio** | `https://generativelanguage.googleapis.com/v1beta/models` | `~/.google-ai-studio/credentials` | Gemini TTS, 추후 연동 예정 |

> 현재 기본값: **ElevenLabs** (나레이션 + 캐릭터별 보이스 분리 가능)
> 제공자 변경은 사용자 요청 시 전환.

---

## 5-0. 캐릭터 성우(보이스) 지정 (TTS 생성 전 필수)

**대본에 등장인물 대사가 있으면 TTS 생성 전에 반드시 실행한다.**

1. **등장인물 추출**: `dialogs_{part}.json`(전체 파트 합산)에서 unique 캐릭터 이름 수집 + 중복 제거
2. **기존 매핑 로드**: 메모리(`tts_settings.md`)에서 기존 매핑을 읽고 두 그룹으로 분류:
   - **매핑 있음**: 보이스 ID 이미 지정됨
   - **매핑 없음**: 신규 캐릭터 — 보이스 ID 누락
3. **매핑 없는 캐릭터가 하나라도 있으면 → STOP, 사용자에게 질문.** `AskUserQuestion` 사용:
   - 캐릭터 이름 + 대본에서 뽑은 성격/연령/톤 힌트
   - ElevenLabs 보이스 라이브러리에서 캐릭터에 맞는 3~4개 추천(성별, 연령대, 스타일)
   - "직접 입력" 옵션 — 사용자가 voice ID 제공
4. **선택 적용**: `tts_settings.md`에 새 매핑을 다음 형식으로 기록:
   ```
   narrator: nucVFUFVgPmKHjgXNbJ7   # Aaron — 깊고 차분한 다큐멘터리
   곽주사:   oR4uPy4PQZyMPPPpXrX5   # 중년 남성, 진중
   연이:     EXAVITQu4vr4xnSDxMaL   # 젊은 여성
   ```
5. **사용자 확인**: 5-1로 진행하기 전에 전체 매핑 테이블을 다시 보여주고 확인 받기.

**나레이션 보이스 (단일 나레이터 스크립트에도 적용):**
- 야담: 묵직하고 느리며 약간 걸걸한 목소리, 발음 명확
- `tts_settings.md`에 `narrator` 항목이 없으면 위 AskUserQuestion에 함께 포함해 한 번에 선택 받기.

---

## 5-1. TTS 음성 생성

**mp3 + SRT 동시 생성 (필수):**

ElevenLabs TTS 생성 시 반드시 mp3와 SRT를 **동시에** 생성한다.

- **API 엔드포인트**: `https://api.elevenlabs.io/v1/text-to-speech/{voice_id}/with-timestamps`
- 응답에 오디오(base64) + 캐릭터/단어 단위 타임스탬프가 포함됨
- 타임스탬프로 세그먼트별 SRT 생성
- SRT는 SFX 타임코드 계산의 기준이 됨

**mp3만 생성하고 SRT를 빠뜨리면 안 된다.** SRT 없이는 SFX 타임코드를 정확히 계산할 수 없다.

**대안 (이미 mp3만 생성한 경우):**
- ffprobe로 각 세그먼트 mp3 길이를 측정하여 누적 타임코드 계산 → SRT 생성
- `ffprobe -v quiet -show_entries format=duration -of csv=p=0 {mp3}`

**자막 수동 분리 (필수):**

SRT 자막은 **반드시 사람이 눈으로 읽고 의미 단위로 분리**해야 한다. 코드로 자동 분리하면 의미 없는 지점에서 끊겨 품질이 떨어진다.

1. `subtitles_{파트}.txt` 파일을 수동 작성
2. 형식: `[세그먼트번호|타입:캐릭터] 자막1|자막2|자막3`
3. `|` 구분자로 의미 단위 분리, 한 자막 최대 **20자**
4. `generate_srt.py`가 이 파일 + 타임스탬프 JSON → SRT 생성

```
# 예시 (subtitles_기.txt)
[000|N] 오랜 세월 한결같이|섬긴 충신이 있었습니다.|주인이 잠든 밤이면
[001|D:아버지] 소은아,|아버지가 문제 하나 내마.
```

- N = 나레이션, D:캐릭터명 = 대사
- 세그먼트 번호는 `segments_{파트}/` 디렉토리의 파일 인덱스와 일치

**생성 파일:**
- `segments_{파트}/` — 세그먼트별 mp3 + JSON 타임스탬프
- `segments_{파트}.json` — 세그먼트 메타데이터
- `subtitles_{파트}.txt` — 수동 자막 분리 원본
- `timeline_{파트}.json` — 세그먼트별 시작/끝 시간 (누적)
- `final_{파트}.mp3` — ffmpeg concat 병합본
- `final_{파트}.srt` — 의미 단위 자막 (수동 분리 기반)

**출력:** `segments_{파트}/{idx:03d}_{캐릭터}.mp3` + `.json` + `final_{파트}.srt`

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

**타임코드 계산 방법:**
1. 각 파트(기/승/전/결)의 세그먼트 mp3 길이를 ffprobe로 측정
2. 누적 시간을 계산하여 SFX가 들어갈 위치의 타임코드 산출
3. 파일명 끝에 `_MMSS` 또는 `_HHMMSS` 형식으로 타임코드 부여

**SFX 디렉토리 (2단계):**

1. **`sfx/`** — 파트별 타임코드 원본 (generate_sfx.py가 생성)
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
# (번호, 파트, 파일명, 영문 프롬프트, 길이(초))
(1, "기", "01_주판_구슬_튕기기",
 "Wooden abacus beads clicking gently, traditional Korean counting", 3)
```

**출력:** `sfx/{파일명}_{파트별타임코드}.mp3` → 병합 후 `media/sfx/{파일명}_{전체타임코드}.mp3`

**리뷰 (서브스텝 5-2)** — 서브에이전트 자가검토 → 이슈 목록 → 수정. 최대 5회. 0 이슈 시 다음 서브스텝(5-3)으로 즉시 진행. 5회 초과 시 사용자에게 에스컬레이션.

---

## 5-3. 전체 오디오 병합 + SFX 타임코드 변환

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

**W5 단계에서 검증 가능한 것만 수행한다 — `scenes.csv` (W6 산출물)에 의존하는 "씬 매칭 검증"은 본 단계에서 제외하고 W7 7-2c (오디오 임포트) 도입부에서 실행한다.**

**W5-4에서 검증할 항목 (scenes.csv 불필요):**
1. **겹침 검증** — 같은 타임코드에 3개 이상 몰려있으면 실패 (CapCut에서 트랙 폭발)
2. **범위 검증** — 타임코드가 전체 오디오 길이(`final_full.mp3`)를 초과하지 않는지 확인
3. **파트별 오프셋 검증** — `sfx/` 원본의 파트별 타임코드 + 파트 오프셋 = `media/sfx/`의 전체 타임코드 (W5-3 변환의 정합성)

**검증 스크립트 (예시):**
```python
# media/sfx/ 파일명에서 타임코드 파싱 (마지막 _ 뒤의 MMSS / HHMMSS)
# 1. 겹침: 같은 타임코드 ±1s 내 3개 이상 → fail
# 2. 범위: ffprobe(media/final_full.mp3) 길이보다 큰 타임코드 → fail
# 3. 오프셋: 각 sfx/파일에 대해 (파트 오프셋 + 파트 내 타임코드) == media/sfx/ 타임코드
```

**검증 실패 시:**
- `fix_sfx_timecodes.py` 실행하여 mechanic 타임코드 재매핑
- 재매핑 후 다시 검증 → pass까지 반복

**W7로 이전된 항목 (참고):**
- **씬 매칭 검증** — 각 SFX 파일 타임코드가 `scenes.csv`의 해당 씬 `start_time`과 일치하는지 확인. `scenes.csv`는 W6 산출물이므로 W5에서는 불가능. → W7 doc `7-2c`의 "오디오 임포트 전 SFX 씬 매칭 검증" 참조.

**STATE.md 업데이트:**
- step: `W05_sfx_timecode_qa`
- mechanic 검증 통과 후 기록 (씬 매칭은 W7에서 별도 기록)

**리뷰 (서브스텝 5-4)** — 서브에이전트 자가검토 → 이슈 목록 → 수정. 최대 5회. 0 이슈 시 다음 Wave로 즉시 진행. 5회 초과 시 사용자에게 에스컬레이션.

---

## Wave 리뷰 요약
위 각 서브스텝은 최대 5회 리뷰(0 이슈 시 즉시 진행)를 강제한다. 마지막 서브스텝의 리뷰가 통과하면 Wave 5 완료. 어느 서브스텝이든 5회 초과 시 사용자에게 에스컬레이션.
