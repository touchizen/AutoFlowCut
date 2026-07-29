# 핸드오프 — 내보내기 타임라인 두 건 (2026-07-29)

> 새 세션은 **이 문서부터** 읽고, 그 다음 §7 의 스펙 두 개를 연다.
> 코드는 **아직 한 줄도 안 고쳤다.** 전부 스펙·조사 단계다.

레포: `~/workspace/AutoFlowCut-bugfix` (worktree)
브랜치: `fix/export-pending-scenes-modal` (base `main` @ `4b3742c8`), **working tree clean**
사용자 지시: **버그 수정은 이 worktree 에서** 한다(`~/workspace/AutoFlowCut` 은 `feature/inapp-agent`).

---

## 1. 한 줄 요약

`Untitled` 프로젝트(타인에게 받은 것, 519 씬)를 CapCut 으로 내보내니 **첫 씬만 나갔고**, 고친 뒤
다시 내보내니 **마지막 씬이 92 초로 늘어졌다.** 원인이 서로 **다른 버그 두 개**였고, 각각 스펙을
썼다. 스펙은 리뷰 루프(Fable 5 + Codex, findings 0 까지)를 돌고 있다.

| # | 버그 | 스펙 | 리뷰 상태 |
|---|---|---|---|
| A | 이미지가 있는데 `status:pending` 인 씬이 **조용히 제외** | `2026-07-28-export-pending-scenes-modal.md` | **v5 — 두 리뷰어 조건부 GO** (조건 반영 완료, 확인 라운드 미실시) |
| B | 씬 사이 **간격이 붕괴**해 drift + 마지막 씬 폭주 | `2026-07-28-export-scene-gap-absorption.md` | **v7 — 라운드 5 반영 완료**, 라운드 6(확인용) 대기 |

두 스펙은 `docs/superpowers/specs/` 에 있다. **그 디렉터리는 `.gitignore` 대상**이라 추적되지 않는다
(이 레포의 진행-중 스펙 관례). 완료 시 `docs/plans-archive/` 로 옮겨 커밋한다.

---

## 2. 이미 끝난 것 (건드리지 말 것)

### 2.1 whisk2premiere — 비디오 자체 오디오 (완료·배포됨)
별건이었고 **완결**했다. `~/workspace/whisk2premiere`, 브랜치 `feat/story-narration`, 커밋 8 개 푸시됨
(`4363bf82..9c5d55b3`). test·prod GCF 배포 완료, 실제 Premiere 눈검증 통과.
- 테스트 124 green, 뮤테이션 27/27 killed, Fable·Codex 각 라운드 2 에서 findings 0.
- 메모리 `premiere-video-audio-track` 갱신됨.

### 2.2 `Untitled` 프로젝트 데이터 응급 처치 (적용됨)
`~/Documents/AutoFlowCut/Untitled/project.json` 의 씬 **518 개를 `pending` → `done`** 으로 바꿨다.
- 백업: 같은 폴더의 `project.json.bak-20260728-220501`
- 519/519 전부 `imagePath` 가 실제 파일을 가리키는 것 확인 후 변경
- 이건 **이 프로젝트 한 건의 응급 처치**다. 버그 A 자체는 안 고쳐졌다.

### 2.3 Gemini TTS `no audio data` (원인 규명 완료, 코드 미수정)
무한야담ep03 `s187-2`(`"……마님. 저건."`) 실패. **실측으로 확정**:
- 실패는 **(텍스트 × seed) 조합의 결정적 함수**다. 같은 텍스트에 seed 만 `2089427080`(=`deriveVoiceSeed('Puck')`)
  → `12345` 로 바꾸면 **즉시 성공**. 응답은 `200 / finishReason: OTHER / parts 없음`.
- 어댑터가 `seed` 를 루프 **밖**에서 한 번 계산해(`electron/api/tts/gemini.js:187`) 재시도 2 회가
  프롬프트 문구만 바꾸고 seed 는 그대로 → 빠져나올 길이 없다. 재생성(↻)도 100% 동일 요청.
- `finishReason` 을 안 읽어서(`:228-236`) 에러 메시지가 맹탕이 된다.
- **오디오는 이미 생성해 넣어뒀다** — `무한야담ep03/story/audio/segments/s187-2.wav`
  (seed 12345, 1.851 s), `scenes.json`/`story.json` 도 done 으로 패치(백업 `.bak` 있음).
- ⚠️ **진단 중 사용자의 Gemini 일일 할당량(100/day)을 소진시켰다.** 다음에 실험할 땐 비용을 먼저 알릴 것.
- 고칠 방향(미착수): 재시도마다 seed 를 파생 변형하고 **성공한 seed 를 세그먼트에 저장**.

---

## 3. 버그 A — pending 씬이 조용히 제외됨

### 증상
519 씬 프로젝트를 CapCut 으로 내보냈는데 **scene_1 하나만** 나갔다. 프리미어도 동일.

### 근본 원인 (전부 실측)
1. 프로젝트 로드 시 `src/hooks/useProjectData.js:112-166` 이 디스크에서 `scenes/<sceneId>.png` 를 찾아
   **`imagePath` 는 채우고**(`:132`) **`status: 'pending'` 은 유지한다**(`:127-128`).
2. UI 썸네일은 `imagePath` 기반(`SceneList.jsx:58`), 상태 배지는 별개(`:45-50`) → **다 있어 보인다**.
3. 내보내기는 `isExportableScene = isSceneGenerationDone && hasExportableMedia`
   (`useExport.js:20-22`) → pending 은 탈락.
4. **0 개일 때만 경고**한다(`useExport.js:191-195`) → 519 중 1 개가 통과하면 무음으로 진행.

### 왜 pending 이었나
프로젝트를 **타인(Windows)에게서 받았고**, 도착 시점 스냅샷(`Untitled.zip` 안의 `project.json`,
`imagePath` 가 `C:\Users\ADMIN\...`)이 **이미 done 1 / pending 518** 이었다. 전송 문제가 아니다.

### 설계 (스펙 v5)
사용자 선택: 내보내기 직전 **3 버튼 모달**(포함 / 배제 / 취소).
- 소유자는 **`ExportModal`**. `useExport` 핸들러는 **절대 사용자 입력을 기다리면 안 된다**
  (MCP `/api/export-capcut` 이 같은 핸들러를 부른다 → 데드락).
- `attemptRef` / `phaseRef` / `isOpenRef` 로 exactly-once, 전체 try-finally, `isOpen=false` 에 `++attemptRef`.
- **접근 게이트도 같이 고쳐야 한다** — 전부-pending 프로젝트는 `App.jsx:2146` → `Header.jsx:381`
  때문에 **버튼이 비활성**이라 모달에 도달조차 못 한다.
- `includePending` 이 MCP 로 도달하려면 3 곳(스키마·바디·화이트리스트)을 고쳐야 한다.

### 남은 일
- 라운드 5(확인용) 리뷰 → 구현(TDD) → 뮤테이션 → 눈검증.
- 두 리뷰어 모두 "조건부 GO" 를 줬고 그 조건은 v5 에 이미 반영했다.

---

## 4. 버그 B — 씬 간격 붕괴

### 증상
버그 A 를 응급 처치한 뒤 다시 내보내니 **마지막 씬이 92 초**(앱 프리뷰는 8.2 초).

### 실측
| 항목 | 값 |
|---|---|
| 씬 `duration` 합 | 3083.1 s |
| 실제 콘텐츠 끝(= SRT 끝) | 3166.4 s |
| **버려지는 간격** | **83.3 s** (216 경계, 평균 0.39 s, 최대 1.63 s) |
| 오디오 `1h normal.wav` | 3167.0 s |
| drift | scene_300 −51.3 s / scene_500 −80.8 s |

### 근본 원인
`buildExportProject`(`useExport.js:136-161`)가 **`startTime` 을 안 보낸다.** `prepareCloudRequest.js:202`
가 duration 을 순차 누적 → 간격이 붕괴 → GCF(`whisk2capcut/functions/index.suffixed.js:1108`,
`:1124-1134`)가 부족분 83.9 s 를 **마지막 씬 하나에** 얹는다.
자막은 **원본 절대 시각**으로 나가므로(`prepareCloudRequest.js:387-389`) 이미지만 앞당겨진다.

### ⚠️ (a) 는 실측으로 폐기됨 — 다시 제안하지 말 것
"간격을 검은 화면으로 두기"를 **실제 CapCut 드래프트로 검증했다**:
519 세그먼트를 실제 `startTime`/`duration` 으로 배치(구멍 217 개) → CapCut 이 **구멍을 전부 없애고
앞으로 당겨붙여 저장**했다(비디오 트랙이 3083.1 s 에서 끝나고 꼬리 83.3 s 공백).
마지막 씬 길이 8.2 s 는 보존됐으므로 **CapCut 이 그 파일을 읽은 것이 맞다**(안 읽었으면 91.5 s 가 남음).
→ **CapCut 은 비디오 트랙의 구멍을 허용하지 않는다.** 스펙 §3.1 에 수치까지 기록돼 있다.

부산물: **CapCut 드래프트는 같은 JSON 을 6 개 파일에 들고 있다**
(`draft_info.json` ×2, `Timelines/<UUID>/template-2.tmp` ×2, `.bak` ×2). 첫 실험이 무효였던 이유다.

### 채택안 (b) — 간격을 앞 씬에 흡수
`slot_i = start_{i+1} − start_i` (첫 씬은 선두 오프셋 흡수) → `cum(i) == start_i` → **drift 0**.
GCF 무수정. 세 포맷(CapCut/프리미어/Vrew)이 `prepareCloudRequest` 를 공유해 한 번에 적용된다.

**받아들인 귀결**: 수동 duration 조절이 덮어써진다(씬 A 를 5 s→3 s 로 줄여도 슬롯은 5 s).
CapCut 이 구간을 비워둘 수 없으므로, 이번 범위에서 채울 수 있는 건 앞 이미지뿐이다.
(엄밀히는 검은 filler 세그먼트를 실제로 깔면 보존 가능하지만 **범위 밖** — `gapFill='black'` 미래 옵션.)

### 스펙이 특히 조심하는 것 (리뷰 5 라운드에서 나온 것들)
- **사이드카 SRT 가 두 갈래다** — GCF 로 가는 `rawSrtTrack`(원본 시각)과
  `rebaseSrtTrackToScenes` 가 재작성해 `_subtitle_ko.srt` 파일이 되는 `project.srtTrack`(붕괴).
  후자도 같이 고쳐야 한다.
- **누적 길이와 클램프 경계를 분리**해야 한다(`durationOf` / `boundaryOf`). 안 그러면 R13 보호
  (`tests/utils/srtTrack.rebaseClamp.test.js`)가 프로덕션 경로에서만 사라진다.
- **`source_duration` / `source_offset`** 을 따로 보내야 영상 오버레이가 안 깨진다. 첫 씬은
  선두 오프셋 때문에 `source_offset` 이 필요하고, 클립 상한은 `slot − source_offset` 이다.
- **전체 폴백은 all-or-nothing** (씬 단위면 망원합이 깨져 drift ≠ 0).

### 남은 일
라운드 6(확인용) → 구현(TDD) → 뮤테이션 23 개 → 눈검증.

---

## 5. 리뷰 루프 규칙 (사용자 지시 — 반드시 지킬 것)

1. 모든 code anchor 를 **직접 열어 대조**한다. 드리프트된 앵커 자체가 finding.
2. **paper fix 사냥** — 사실은 맞는데 조립이 안 되는 것.
3. **findings 0 이면 실패한 리뷰.** 단 없는 걸 지어내는 건 더 나쁘다.
4. **직전 라운드 findings 를 통째로 프롬프트에 붙인다.**
5. **findings 0 까지 loop.**

리뷰어: **Fable 5**(Agent, `model: 'fable'`) + **Codex**(`mcp__codex__codex`,
`model: gpt-5.6-sol`, `model_reasoning_effort: xhigh`, `sandbox: read-only`).

### 이 세션에서 실제로 일어난 일 (같은 함정을 피하도록)
- 라운드마다 **진짜 결함**이 나왔다. 특히 **두 리뷰어가 독립적으로 같은 급소를 짚은 경우가 여러 번**.
- **라운드 3 에서 두 리뷰어가 정면으로 갈렸다**(Fable GO / Codex BLOCKER 3). 합의로 정하지 말고
  **코드로 판정**했다 — 결과: Codex 2 건 채택, 1 건 기각. 그런데 **그 기각이 라운드 4 에서 틀린 것으로
  드러났다**(사용자가 `SceneList` 에서 duration 을 줄이는 경로가 실재, 기존 회귀 테스트까지 있었음).
  → **"만들 수 없다" 류의 단정은 하지 말 것.**
- 내가 스펙에 쓴 **거짓 주장이 여러 번 나왔다**: "사이드카가 identity 가 된다"(첫 씬에서 거짓),
  "겹침은 전체 폴백된다"(술어에 항이 없었음), "SFX 가 자동 개선된다"(DTO 에 실리지도 않음),
  "App 에 테스트 하네스가 없다"(6 개 있었음). **앵커를 열어보지 않고 쓰면 이렇게 된다.**

---

## 6. 정리할 것 / 주의

- **실험용 CapCut 드래프트 `1399` 가 남아 있다.**
  `~/Movies/CapCut/User Data/Projects/com.lveditor.draft/1399`
  레지스트리에도 등록돼 있다(`root_meta_info.json` 의 `all_draft_store`).
  지우려면 폴더 삭제 + 레지스트리 항목 제거. 백업: `root_meta_info.json.bak-*`.
  ⚠️ CapCut 을 **닫고** 작업해야 한다(열려 있으면 되써버린다).
- `1306` 은 사용자의 실제 내보내기 결과다. 건드리지 말 것.
- 스크래치 스크립트는 세션 스크래치패드에 있었고 레포에는 없다.

---

## 7. 새 세션이 할 일 (순서)

1. 이 문서 → `docs/superpowers/specs/2026-07-28-export-scene-gap-absorption.md`(v7)
   → `.../2026-07-28-export-pending-scenes-modal.md`(v5) 를 읽는다.
2. **버그 B 를 먼저** 구현한다(더 작고, 버그 A 의 테스트가 이 동작 위에 얹힌다 — 스펙 §6).
3. 각 스펙의 라운드 규칙대로 확인 리뷰 1 회 → findings 0 → **TDD 구현**
   (실패 테스트 먼저 → 구현 → 전체 스위트 → **커밋** → 뮤테이션).
   ⚠️ **뮤테이션 전 반드시 커밋**한다(checkout 이 미커밋 수정을 파괴한다).
4. 눈검증: 실제 CapCut/프리미어에서 열어 확인. 특히
   - 사이드카 `_subtitle_ko.srt` 가 정상 길이인가(사건 당시 225 B = 3 줄뿐이었다)
   - 마지막 씬이 8.2 초인가
   - 후반부에서 이미지와 자막이 맞는가
5. 완료되면 스펙을 `docs/plans-archive/` 로 옮겨 커밋한다.

### 성능 주의
518 씬에 `image_size` 가 없어 `prepareCloudRequest.js:125-137` 이 이미지를 하나씩 디코드한다.
내보내기가 느릴 수 있다. 기능은 동작하므로 이번 범위 밖 — 느리면 별건으로.
