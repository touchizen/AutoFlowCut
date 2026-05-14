# W8: 어셈블리 (오디오 임포트 + CapCut + 영상)

이 문서는 story-engine 스킬의 W8(어셈블리) 단계 가이드입니다.

**W7(이미지 프로덕션)이 사용자 사인오프와 함께 완료된 후 실행한다.**

W7이 비싼 단계(Google Flow 크레딧)였다면, W8은 무료 / 저비용 어셈블리 단계 — 오디오 임포트, CapCut 내보내기, 선택적 영상 생성. 이 분리 덕에 이미지 검수 후 어셈블리 직전에 자연스러운 break point가 있고, 이미지 재생성 시 어셈블리 작업이 헛수고가 되지 않는다.

---

## 8-0. SFX 씬 매칭 검증 (오디오 임포트 전 필수)

W5-4는 scenes.csv (W6 산출물)에 의존할 수 없어 mechanic 검증(겹침/범위/오프셋)만 했다. 본 단계에서 scenes.csv 기반 씬 매칭 검증을 수행한다 — 오디오 임포트 직전이 가장 자연스러운 시점.

```python
# 1. media/sfx/ 파일명의 타임코드(MMSS/HHMMSS) 파싱
# 2. scenes.csv에서 씬별 start_time / end_time 읽기
# 3. 각 SFX 타임코드가 scenes.csv의 어느 씬 구간 [start_time, end_time]에 속하는지 확인
#    → 어느 씬 구간에도 속하지 않으면 orphan SFX (fail)
# 4. (크로스체크) 08_sfx_목록.md의 앵커 나레이션 → media/final_full.srt 검색
#    → 그 SRT 구간이 속한 씬과 SFX 타임코드의 씬이 일치하는지 확인
# 5. 불일치 → 08_sfx_목록.md의 앵커/배치/오프셋 수정 후 W5-2 재실행
```

**검증 항목:**
- 각 SFX 타임코드 ∈ scenes.csv의 어느 씬 [start_time, end_time] (±0.5초 허용)
- orphan SFX 없음 (모든 `media/sfx/*.mp3`가 한 씬에 귀속)
- (크로스체크) 앵커 나레이션으로 역추적한 씬 ↔ 타임코드로 찾은 씬 일치

**STATE.md 업데이트:**
- step: `W08_sfx_scene_match_qa`
- 씬 매칭 검증 통과 후 기록

검증 통과 후에만 8-1 임포트 절차로 진행한다.

**리뷰 (서브스텝 8-0)** — 서브에이전트 자가검토 → 이슈 목록 → 수정. 최대 5회. 0 이슈 시 다음 서브스텝(8-1)으로 즉시 진행. 5회 초과 시 사용자에게 에스컬레이션.

---

## 8-1. 오디오 임포트 (나레이션 + SFX)

W5에서 생성한 오디오 파일을 AutoFlowCut에 임포트한다.
오디오 임포트 후 CapCut 내보내기 시 나레이션/SFX가 타임라인에 자동 배치된다.

**임포트 대상 (에피소드 폴더):**
```
ep{번호}/
└── media/
    ├── 영상.mp3              ← 전체 나레이션 오디오 (또는 final_full.mp3)
    ├── 영상.srt              ← 전체 자막 (또는 final_full.srt)
    ├── voices/               ← 인물별 대사 TTS (캐릭터별 서브폴더 필수)
    │   ├── 머슴/
    │   │   ├── 기_003_머슴_000109.mp3
    │   │   └── ...
    │   ├── 과부/
    │   │   └── ...
    │   └── 두목/
    │       └── ...
    └── sfx/                  ← SFX (파일명 타임코드로 자동 배치)
        ├── 01_주판/
        │   ├── click_01_0030.mp3
        │   └── ...
        └── ...
```

**voices/ 디렉토리 구조 생성:**
TTS 생성 후 flat mp3 들을 캐릭터별 서브폴더 (`ep{번호}/media/voices/<character>/`) 로 재배치한다. **canonical 위치는 `media/voices/`** (filesystem.js의 audio-import 가 그 layout 을 기대한다 — line 934 의 주석 참조). W5-1f는 편의상 `ep{번호}/voices/` flat 에 쓰므로 이 단계에서 `media/voices/<char>/` 로 옮긴다.

파일명은 `{파트}_{order:03d}_{캐릭터}_{HHMMSS}.mp3` (W5-1f 산출). 파트 prefix가 있는 새 형식과, 없던 이전 형식 모두 처리하도록 정규식이 optional prefix를 받는다.

```bash
ep_dir="ep{번호}"
dest="$ep_dir/media/voices"
mkdir -p "$dest"
# 소스 후보: ep/voices/ (W5 기본 출력) 또는 ep/media/voices/ (이미 옮겨졌지만 flat 인 경우).
# 둘 다 있을 수 있으니 둘 다 훑는다 — 이미 <char>/ 서브폴더화된 파일은 건드리지 않음 (glob 이 *.mp3 만 매칭).
for src in "$ep_dir/voices" "$dest"; do
  [ -d "$src" ] || continue
  for f in "$src"/*.mp3; do
    [ -e "$f" ] || continue   # flat mp3 없으면 (이미 서브폴더화 됐을 때) skip
    base=$(basename "$f")
    # 파일명: [{part}_]{order:03d}_{character}_{HHMMSS}.mp3
    # 3자리 order 와 6자리 HHMMSS 를 anchor 로 character 추출.
    char=$(echo "$base" | sed -E 's/^(.*_)?[0-9]{3}_([^_]+)_[0-9]{6}\.mp3$/\2/')
    mkdir -p "$dest/$char"
    mv "$f" "$dest/$char/"
  done
done
```

**HTTP API로 임포트:**
```bash
curl -s -X POST http://localhost:3210/api/audio-import \
  -H "Content-Type: application/json" \
  -d '{"folderPath": "{작업폴더}/ep{번호}_{slug}"}'
```

**임포트 후 확인:**
```bash
# 오디오 리뷰 상태 조회
curl -s http://localhost:3210/api/audio-reviews

# 오디오 리뷰 새로고침 (폴더 재스캔 + 자동 언플래그)
curl -s -X POST http://localhost:3210/api/audio-refresh \
  -H "Content-Type: application/json" \
  -d '{"folderPath": "{작업폴더}/ep{번호}_{slug}"}'
```

**MCP 도구로 오디오 검수:**
- `list_audio_reviews({ folder_path })` — 부적합 마크 목록 조회
- `update_audio_review({ folder_path, relative_path, action: "flag"|"unflag", reason })` — 마크 추가/해제

**부적합 오디오 처리:**
1. 앱의 Audio 탭에서 각 파일을 재생하며 검수
2. 부적합 파일 발견 시 flag 마크 → 재생성 후 unflag
3. `.audio_review.json`으로 상태 추적

**리뷰 (서브스텝 8-1)** — 서브에이전트 자가검토 → 이슈 목록 → 수정. 최대 5회. 0 이슈 시 다음 서브스텝(8-2)으로 즉시 진행. 5회 초과 시 사용자에게 에스컬레이션.

---

## 8-2. CapCut 내보내기

이미지(W7)와 오디오(8-1)가 모두 임포트된 후, CapCut 프로젝트로 내보낸다.
씬 이미지 + 나레이션 오디오 + SRT 자막 + SFX가 타임라인에 자동 배치된다.

**HTTP API로 내보내기:**
```bash
curl -s -X POST http://localhost:3210/api/export-capcut \
  -H "Content-Type: application/json" \
  -d '{}'
```

**또는 앱에서 직접:**
- F→V 탭 또는 내보내기 버튼 클릭

**내보내기 확인:**
- CapCut에서 프로젝트 열어 타임라인 확인
- 이미지 배치, 오디오 싱크, 자막 위치 점검
- 문제 있으면 앱에서 수정 후 재내보내기

**리뷰 (서브스텝 8-2)** — 서브에이전트 자가검토 → 이슈 목록 → 수정. 최대 5회. 0 이슈 시 다음 서브스텝(8-3)으로 즉시 진행. 5회 초과 시 사용자에게 에스컬레이션.

---

## 8-3. 영상 생성 (선택사항 — 사용자 승인 필수)

씬 이미지에 모션을 넣어 비디오 클립으로 변환한다 (Image-to-Video, Google Flow API).

**선택사항이며, 비용이 추가로 발생하므로 반드시 유저에게 확인 후 실행한다.** CapCut에서 직접 편집하는 경우 이 단계를 건너뛸 수 있다.

```
🛑 AskUserQuestion: "씬별 영상 생성을 시작할까요? 약 {N}개 씬, 예상 비용: ..."
   - "Yes" → AutoFlowCut의 비디오 모드로 생성
   - "No / Skip" → 8-3 건너뛰고 W9로 진행 (CapCut에서 직접 편집)
```

- 유저가 승인하면 AutoFlowCut의 비디오 모드로 생성
- 유저가 직접 하겠다고 하면 넘긴다
- export도 마찬가지로 유저 확인 후 진행

**리뷰 (서브스텝 8-3)** — 영상 생성 시 서브에이전트 자가검토 → 이슈 목록 → 수정. 최대 5회. 0 이슈 시 다음 Wave(W9)로 즉시 진행. 5회 초과 시 사용자에게 에스컬레이션. 8-3을 스킵한 경우 별도 리뷰 없음.

---

## Wave 리뷰 요약
위 각 서브스텝(8-0 ~ 8-3)은 최대 5회 리뷰(0 이슈 시 즉시 진행)를 강제한다. 마지막 서브스텝의 리뷰가 통과하면 Wave 8 완료, W9(업로드 정보)로 넘김. 어느 서브스텝이든 5회 초과 시 사용자에게 에스컬레이션.

(과거 W7 7-2c/7-2d/7-3에서 분리되어 본 W8로 이전됨. SFX 씬 매칭 검증은 W5-4에서 이전됨.)
