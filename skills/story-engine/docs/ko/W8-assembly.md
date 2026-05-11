# W8: 어셈블리 (오디오 임포트 + CapCut + 영상)

이 문서는 story-engine 스킬의 W8(어셈블리) 단계 가이드입니다.

**W7(이미지 프로덕션)이 사용자 사인오프와 함께 완료된 후 실행한다.**

W7이 비싼 단계(Google Flow 크레딧)였다면, W8은 무료 / 저비용 어셈블리 단계 — 오디오 임포트, CapCut 내보내기, 선택적 영상 생성. 이 분리 덕에 이미지 검수 후 어셈블리 직전에 자연스러운 break point가 있고, 이미지 재생성 시 어셈블리 작업이 헛수고가 되지 않는다.

---

## 8-0. SFX 씬 매칭 검증 (W8-1 재임포트 / W8-2 CapCut export 전 필수)

W5-4는 scenes.csv (W6 산출물)에 의존할 수 없어 mechanic 검증(겹침/범위/오프셋)만 했다. 본 단계에서 scenes.csv 기반 씬 매칭 검증을 수행한다 — W8-1 idempotent 재임포트와 W8-2 CapCut export 직전이 가장 자연스러운 시점이다 (씬 매칭 실패 시 SFX 재생성이 필요하고, 그러면 재임포트가 새 산출물을 반영해야 함).

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

## 8-1. 오디오 임포트 — idempotent 재임포트 (W5-5의 안전망)

현재 파이프라인에서 **오디오는 W5-5 시점에 임포트된다** (W5-4 mechanic QA
통과 후). W5-5는 best-effort라서 — 앱이 꺼져 있었거나, 그 사이 사용자가
다른 에피소드로 전환했을 수 있다. **W8-1은 동일 POST를 idempotent하게
다시 호출**해서 CapCut export 직전에 앱이 반드시 이번 에피소드의 오디오를
바라보게 한다.

⚠ **`/api/audio-reviews` 확인으로 대체할 수 없는 이유**: 이 GET은 폴더와 무관하게 앱에 현재 로드된 리뷰만 반환한다. 응답이 비어 있지 않아도 직전 에피소드 잔재일 수 있다. 앱이 이번 에피소드 패키지를 바라본다고 보장하는 유일한 방법은 명시적 폴더 경로로 `/api/audio-import` 호출하는 것.

**W8-1 프로토콜:**

1. **전제조건** — `media/final_full.mp3`가 디스크에 존재해야 함. 없으면 → 에스컬레이션. W5 미완료 상태.
2. **voices 폴더 정리** (대사 존재 시, W5-5에서 이미 정리되지 않은 경우) — 캐릭터별 서브폴더 생성하는 idempotent 쉘 루프. 이미 정리된 voices/에 재실행하면 no-op.
3. **임포트 POST** — 에피소드 폴더 경로로 `/api/audio-import` 호출. 앱이 오디오 패키지를 로드 (또는 같은 경로면 재로드).
4. **Refresh + 플래그 처리** — `/api/audio-refresh` POST로 재스캔 + 재생성된 파일 자동 unflag. 남은 플래그 항목은 W8-1 리뷰 리포트에 surface.

3번 통과 후, 앱은 W5-5 성공 여부와 무관하게 반드시 이번 에피소드 오디오에 잠금된다.

**임포트 대상 (에피소드 폴더):**
```
ep{번호}/
└── media/
    ├── 영상.mp3              ← 전체 나레이션 오디오 (또는 final_full.mp3 — hook + 기 + 승 + 전 + 결 순서로 병합, hook이 t=0 에서 시작)
    ├── 영상.srt              ← 전체 자막 (또는 final_full.srt — 오프셋 적용; hook 자막이 첫 블록)
    ├── voices/               ← 인물별 대사 TTS (캐릭터별 서브폴더 필수)
    │   ├── 머슴/
    │   │   ├── 003_머슴_000109.mp3
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
TTS 생성 후 파일명에서 캐릭터명을 추출하여 서브폴더를 자동 생성한다.
```bash
shopt -s nullglob   # bash; zsh: setopt null_glob
cd ep{번호}/media/voices && for f in *.mp3; do
  [ -e "$f" ] || continue
  char=$(echo "$f" | sed 's/^[0-9]*_\([^_]*\)_.*/\1/')
  mkdir -p "$char"
  mv "$f" "$char/"
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

# 오디오 리뷰 새로고침 — 현재 로드된 패키지를 재스캔하고 재생성된 파일을 자동 언플래그.
# 엔드포인트는 앞선 `/api/audio-import`로 로드된 패키지에 대해 동작하므로
# body가 필요 없음 (서버가 무시함).
curl -s -X POST http://localhost:3210/api/audio-refresh
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
