# 스펙 — 내보내기: 이미지가 있는 pending 씬 포함/배제 선택 (2026-07-28)

상태: **v9 — 라운드 8 반영 + 스코프 컷 완료. 구현 착수** (라운드 9 없음)

> v9 변경 (라운드 8 — **두 리뷰어가 독립적으로 "스코프를 줄여라"에 도달**. 8 라운드 만에
> findings 가 아니라 *방향* 에 대한 합의가 나왔다):
> ① ⚠️ **Vrew 를 이번 범위에서 제외**(§3.4, 사용자 결정). `isRealPath` 는 **오직 Vrew 때문에
> 존재**하고 라운드 4→5→7→8 **네 라운드 연속으로 구멍이 나온 유일한 규칙**이다
> (raw base64 → `file://` → JPEG `/9j/` → forward-slash UNC). 모양 검사로는 끝이 나지 않는다.
> 컷으로 사라진 것: `isRealPath`/`requirePath`/`pathOnly`/경로 행렬/await 사이트 2 곳/뮤테이션 5 행.
> **Vrew 는 현행 유지** — 오늘과 동일 동작이므로 악화 없음(§9 0-b).
> ② **모달 상태기계는 자르지 않는다.** Codex 는 미루자고 했지만 Fable 이 옳다 — 모달 없이는
> `includePending` 이 UI 에서 도달 불가라 헤더 버튼만 켜지고 518 개는 여전히 무음 탈락한다.
> Codex 자신도 "배선만 배포하는 건 사용자 문제 해결이 아니다"라고 썼다. 기계 설계는 3 라운드째 안정.
> ③ **stale 가드를 사이트별 전수 테이블로**(라운드 8 F1). 라운드 6·7·8 이 매번 사이트를 하나씩
> 찾아낸 이유가 **스펙이 그물을 산문으로 열거**해서다 → `describe.each([P1, P2, C1])` 로 클래스를
> 구조적으로 닫는다. `#15` 도 닫기 경로 둘 다 픽스처로.
> ④ **fail-open catch 뒤에도 stale 가드 필요**(Codex). CapCut 설치확인 reject 는
> `ExportModal.jsx:319-322` 가 삼키고 진행하므로 `닫기→재오픈→reject` 에서 stale dispatch 가 된다.
> ⑤ **문구 픽스처에 `readyCount = 2` 를 못 박는다**(Fable F2). 4 로 잡으면 금지식
> `ready + pending` 도 7 을 내놓아 **#24 가 공허하게 통과**한다.
> ⑥ **`persistOptions()` 위치 확정 + 그물**(Fable F4) — 기존 `ExportModal.test.jsx` 23 개 중
> `saveSettings` 단언이 0 개라 리팩터가 조용히 떨어뜨린다.
> ⑦ 원장 **26 행**(ID 는 8·10·22·23 결번, 재번호 안 함). 계수를 네 번 틀렸으므로 **행을 센다.**
>
> **라운드 9 는 돌리지 않는다.** 두 리뷰어 모두 "남은 검증은 코드-후 뮤테이션 실측이 진짜 심판"
> 이라는 데 동의했고, 설계 구멍은 라운드 5 가 마지막이었다.

> v8 변경 (라운드 7 — Fable CONDITIONAL GO(필수 1건) / Codex **NO-GO**(6건).
> Codex 가 Fable 이 못 본 걸 셋 더 찾았고 **그중 하나는 테스트 그물이 아니라 설계 규칙의 구멍**이다):
> ① **BLOCKER — JPEG base64 가 화이트리스트를 통과한다.** JPEG base64 는 `/9j/4AAQSkZJRg…` 로
> 시작해서 **POSIX 절대경로 arm 을 그대로 통과**한다 → `vrew.js:72` 의 `fs.readFile` 에서 ENOENT →
> **Vrew 전체 중단**. v7 의 음성 픽스처가 PNG(`iVB…`) 하나뿐이라 안 보였다(PNG 는 `/` 로 시작 안 함).
> 해법은 새 규칙이 아니라 **기존 detector 재사용** — `isRawBase64Media`(`mediaSignatures.js:63`)를
> 선검사로. 실측: `/9j/…` → true, `/Users/a/x.png` → false. 뮤테이션 #23 + 경로 행렬에 케이스 추가.
> ② **MAJOR — §7.3-a 가 자기모순이었다.** "`ExportModal` 을 mock" 해놓고 그 안의 게이트를
> 검증하라고 했다 — stub mock 이면 게이트 코드가 실행조차 안 된다. **(a) App 배선(stub mock) /
> (b) 게이트·문구(실제 렌더)** 두 테스트로 분리.
> ③ **MAJOR — 문구(copy)에 그물이 없었다**(두 리뷰어 일치). §4.2 는 "게이트·문구·실행 필터가
> 전부 같은 값"이라는데 문구만 아무도 안 봤다 → 구별 리터럴(total 7 / default 3 / pathOnly 1)로
> 단언 + 로케일 키 노출 검사. 뮤테이션 #24·#25.
> ④ **MAJOR — step 3 "모든 await 직후" 중 두 번째 await 가 무방비.** 프리미어/Vrew 는
> `checkFolderExists`(`ExportModal.jsx:242`/`:278`)를 한 번 더 await 하는데 §7.4 는 설치확인만
> 붙잡았다 → 두 번째 await 픽스처 추가, 뮤테이션 #26.
> ⑤ **MINOR — `dispatching` 중 잠금과 백드롭 `loading` 가드가 미검증** → 뮤테이션 #27·#28.
> ⑥ **계수를 세 번 연달아 틀렸다** (v5 13 / v6 19 / v7 22). v7 은 v6 의 틀린 19 에 3 을 더했다.
> **행을 기계적으로 세어 29** 로 확정하고, 알려진 등가 뮤턴트도 명시적으로 기록한다.
> ⑦ 앵커 nit: `:154-177` → map `:154-189`, `sourceOffsets` 읽기 `:179`.


> v7 변경 (라운드 6 — 두 리뷰어 모두 CONDITIONAL GO. **설계 자체는 다섯 라운드 만에 처음으로
> 손추적에서 구멍이 안 나왔다** — 남은 건 전부 "테스트 그물이 없어 뮤턴트가 산다" 류다):
> ① **BLOCKER — App→ExportModal 카운트 배선에 테스트가 없다.** 구현자가 카운트 prop 을
> 통째로 빠뜨려도 기본값 0 때문에 **모든 컴포넌트 테스트가 초록이고 3버튼 모달은 영원히 안 뜬다.**
> → §7.3-a 신설(prop 캡처 + Vrew `pathOnly` 게이트), 뮤테이션 #20·#21.
> ② **MAJOR — 기존 테스트가 새 게이트와 정면 충돌한다.** `useExport.refresh.test.jsx:224` 가
> `pending + imagePath` 에 대해 "모달이 안 열린다"를 단언한다(실측 확인). §8 에 추가하고
> 기대값을 뒤집는다.
> ③ **MAJOR — #19 에 변형 B 가 있어 원장이 거짓이었다**(Fable F2). `phase` 전이 없이 콜백을
> 직접 부르면 바깥 preflight finally 가 대신 풀어줘 #19 짝 테스트를 통과한다. 그걸 죽이는 건
> **#15 짝의 픽스처를 `pendingWithImageCount === 0` 으로 못 박는 것**뿐이고, 안 박으면
> **pending 0 프로젝트에서 이중 내보내기**가 실제로 가능하다.
> ④ **MAJOR — `isRealPath` 경로 행렬과 분류기-선택기 parity 테스트가 §7 에 없었다**(약속만 있었다).
> `file://` 재허용 뮤턴트(#22)와 selector ready-arm 약화 뮤턴트가 살아 있었다 → §7.1 에 표로 명시.
> ⑤ **계수 재정정: 19 → 22.** `#1~#15` 는 `#6` 분리로 16 행이다. v5(13)·v6(19) 둘 다 착오였다.
> ⑥ `#17` 의 oracle 이 틀렸다("프리미어가 발사되지 않는다"는 정답 동작이 아니다) → 탭 disabled +
> resolve 후 `onExportPremiere` 호출로 정정.
> ⑦ `source_offset[0] === 0` 단언이 **공허**했다(A 의 startTime 이 0) → 선두 pending 픽스처 추가.
> ⑧ dispatch 스니펫에 `catch` 추가(세 핸들러의 `ensurePermission()` await 가 try 바깥이라
> 콜백이 실제로 reject 한다 → unhandled rejection).
> ⑨ v6 이 "전부 재앵커"라 했지만 **4 곳이 남아 있었다**(`:389→:398`, `:56→:59`, `:129-133→:141-151`,
> `:149/:148→:172/:171`) + `vrewPacker.js` 주석 nit. §9 에 "모양 검사 ≠ 실존 검사" 잔여 리스크.


> v6 변경 (라운드 5 — Codex NO-GO(BLOCKER 2 + MAJOR 4) / Fable CONDITIONAL GO(MAJOR 3).
> **두 리뷰어가 독립적으로 같은 급소 둘에 수렴**했다):
> ① **BLOCKER — `file://` 를 화이트리스트에서 뺀다.** `isRealPath` 가 `file://` 를 통과시키면
> 그 씬이 Vrew 선택을 통과한 뒤 `vrewPacker.js:121` → `electron/ipc/vrew.js:72` 의
> `fs.readFile(경로문자열)` 에서 죽어 **Vrew 내보내기 전체가 중단**된다.
> 실측: `fs.readFile('file:///etc/hosts')` → **ENOENT**. §3.2 가 vrewPacker 수정을 비목표로
> 두었으므로 **회피(화이트리스트 축소)** 가 맞다.
> ② **BLOCKER — dispatch 쪽 finally 가 미지정이라 소프트락이 생긴다**(Codex #2 = Fable F4).
> step 4(`pendingWithImageCount === 0`)는 `phase='dispatching'` 으로 가는데 **finally 를 아무도
> 안 갖는다**(step 7 의 포함/배제 경로만 있다). 게다가 강조된 attempt-가드 패턴을 dispatch
> finally 에 복사하면 "dispatch 중 닫기 → settle" 에서 `my !== attemptRef.current` 라 리셋이
> 스킵돼 **`dispatching` 에 영구 잠금**된다. → **공통 dispatch 헬퍼 + 무가드 finally** 로 확정(§4.3).
> ③ **MAJOR — 포맷 탭이 preflight 동안 열려 있다.** 프리미어 preflight 중 Vrew 로 바꾸면
> 저장된 `kind:'premiere'` 가 발사된다 → 잠금 범위를 `preflight`~`dispatching` 으로 확대.
> ④ **MAJOR — 버그 B(슬롯)와의 상호작용이 스펙에 한 번도 안 나온다**(Codex #2 = Fable F1).
> `buildExportProject` 는 이제 `computeSceneSlots(validScenes)` 를 **인덱스로** 읽는다 → §4.4 에
> "슬롯은 `selectExportScenes` 결과 기준으로 재계산된다" 명시, §7.2 픽스처에 유효 시각 필수,
> §9 에 "pending 씬 시각 불량 → 전체 legacy 폴백 → 버그 B 무음 부활" 리스크 신설.
> ⑤ **MAJOR — ready 술어가 두 곳에서 재조합된다**(`classifyExportScenes` / `selectExportScenes`)
> → 모듈 안에 `isReadyExportEligible` 하나를 두고 둘 다 호출.
> ⑥ **MAJOR — 뮤테이션 원장이 부정확하다.** 개수는 13 이 아니라 **16**(#1~#15 + #6a/#6b 분리),
> #14 짝 시나리오가 §7.4 에 **없고**, #6b 짝 라벨이 틀렸다. → 원장 재작성 + #16·#17 신설.
> ⑦ **MINOR — `useExport.js` 앵커가 gap fix 로 일괄 드리프트**(+1~+13 줄). 전부 재앵커.
> ⑧ dead import 제거(`hasExportableMedia`/`isSceneGenerationDone`)와
> `tests/hooks/useExport.gap.test.jsx`(기존 유지 회귀 그물)를 §8 에 추가.

브랜치: `fix/export-pending-scenes-modal` (base `main` @ 4b3742c8)

> v2 변경 요약: 리뷰 라운드 1(Fable 5 / Codex 독립 2건)에서 MAJOR 3건이 나왔고 전부 실측 확인됐다.
> ① 전부-pending 프로젝트는 **내보내기 버튼 자체가 비활성/미렌더**라 §5.1이 paper fix 였음 → §3.3 신설.
> ② 모달의 **소유자·삽입 지점**이 안 정해져 있어 구현자가 `handleExportConfirm` 안에 넣으면 자동화가
> 데드락 → §4.3 에서 소유자를 `ExportModal` 로 못 박고 상태기계를 명시.
> ③ `includePending` 이 MCP 로 **도달 불가**(스키마·바디·화이트리스트 3중 차단) → §4.5 신설.
> 그 외: 실행 경로는 4개가 아니라 **3개**(:56은 preflight), Vrew base64 취급, 테스트 반증력 보강, 앵커 정정.
>
> v3 변경 요약: 라운드 2(두 리뷰어 독립)에서 MAJOR 3건이 또 일치했다.
> ① **Vrew `requirePath` 가 카운트에만 걸려 실행 필터엔 없다** → 여전히 paper fix (§4.4·§5.4 배선).
> ② **`ExportModal` 은 항상 마운트라 `pendingChoice` 가 닫기/재오픈을 살아남는다**(`:185` 는 `return null`
> 일 뿐) + 비동기 preflight 가 닫힌 뒤 resolve → §4.3 에 리셋·attempt 토큰 추가.
> ③ **Header 테스트로는 `App.jsx:2146` 뮤테이션을 못 죽인다**(prop 이 불리언) → 순수 술어
> `hasExportAccess` 추출, 못 무는 뮤테이션은 정직하게 격하(§7.3·§7.6).
> 그 외: §8 에 로케일·CSS·기존 테스트 누락, MCP 테스트 비대칭, SRT 단언이 `preserveUnlinked` 로
> 헐거움, 관찰 지점(exporter mock) 미지정, 앵커 재정정.
>
> v4 변경 요약: 라운드 3 에서 상태기계 구멍 2 건이 또 일치했다.
> ① **외부 닫힘**(`App.jsx:3019` 업그레이드 클릭이 `setShowExportModal(false)`)에서 `attemptRef` 가
> 무효화되지 않고 step 3 의 `!isOpen` 은 closure 라 항상 true → **paywall 뒤에서 유령 내보내기**.
> ② preflight 의 reject·정상 조기 return 이 `phase` 를 `'preflight'` 에 **영구 잠금**.
> ③ `phase` 를 React state 로 두면 동기 latch 가 아니다 → **`phaseRef`** 로.
> ④ `eligible` 이 export 되지 않아 분류기·실행 필터가 **여전히 재조합**될 수 있었다 → export 강제.
> ⑤ `ready + pendingWithImage` **단순 연결이 씬 순서를 뒤집는다** → 원본 순서 보존 필수.
> ⑥ **App 테스트 하네스는 실재한다**(`tests/components/App.*.test.jsx` 7 개,
> `App.promptBusyLines.test.jsx:360` 이 Header 를 mock, `:416` 에서 import, `:453` 에서 첫 렌더) —
> v3 의 "App 은 하네스가 없다" 는 **사실 오류**였다. `App.jsx:2146` 도 뮤테이션으로 잡는다.

---

## 1. 사건

사용자가 `Untitled` 프로젝트를 CapCut 으로 내보냈는데 **첫 씬 하나만** 내보내지고 나머지 518 개가
조용히 빠졌다. 프리미어도 동일(사용자가 처음엔 "프리미어는 된다"고 했다가 착각이었다고 정정).

### 실측 데이터 (`~/Documents/AutoFlowCut/Untitled/project.json`)

| 항목 | 값 |
|---|---|
| 씬 수 | 519 |
| `status` | **done 1 (scene_1) / pending 518** |
| `imagePath` 보유 | 519 / 519 |
| 실제 PNG 파일 | 519 / 519 (`Untitled/scenes/`) 존재 |
| `donePrompt` | 1 / 519 |
| `image_size` | 1 / 519 |
| `mediaId` | 2 / 519 |
| `generatingStartedAt` | 3 / 519 (2026-07-28 04:16~04:17) |
| `error` | 0 / 519 |
| PNG mtime | 2026-07-24 |

- **이 프로젝트는 타인(Windows)에게서 받은 것.** `~/Documents/AutoFlowCut/Untitled.zip` 안의
  도착 시점 스냅샷 `project.json` 의 `imagePath` 가 `C:\Users\ADMIN\Documents\AutoFlowCut\Untitled\scenes\scene_2.png`
  형태이고, **그 스냅샷이 이미 done 1 / pending 518** 이었다. 전송 과정에서 깨진 게 아니다.
- 내보내진 `Untitled_subtitle_ko.srt` 는 225 B — scene_1 의 자막 3 줄뿐. `project.srtTrack` 은 1304 개.
- 같은 머신의 정상 프로젝트는 잘 나간다: `무한야담ep03` 186/186 done, `야담02` 152/152 done.

**"왜 518 개가 pending 인가"는 이 스펙의 범위가 아니다** (보낸 사람 쪽 이력이라 확인 불가).
이 스펙은 **그 상태의 프로젝트를 받았을 때 앱이 어떻게 행동해야 하는가**만 다룬다.

---

## 2. 근본 원인 (앵커 전부 실측 확인)

1. 로드 시 `src/hooks/useProjectData.js:112-166` 이 씬마다
   `fileSystemAPI.getResourcePath(projectName, 'scenes', scene.id)` 로 파일을 찾는다.
2. 찾으면 `imagePath: pathResult.path` 를 **무조건** 채우고(`:132`),
   `preservePending = scene.status === 'pending'`(`:127`),
   `restoredStatus = preserveError ? 'error' : (preservePending ? 'pending' : 'done')`(`:128`) —
   **pending 은 pending 으로 남고 imagePath 만 로컬 경로로 갱신**된다.
   (참고: `image-missing` 에러는 파일이 돌아오면 자동으로 done 으로 치유된다 — `:121-122`.)
3. UI 썸네일은 `imagePath` 기반(`src/components/SceneList.jsx:58` `resolveImageSrc(scene)`),
   상태 배지는 별개(`:45-50` `statusIcon`). → **519 개가 전부 그림이 보이고 배지만 ⏳**.
4. 내보내기는 `isExportableScene = isSceneGenerationDone(scene) && hasExportableMedia(scene)`
   (`src/hooks/useExport.js:21-23`). `isSceneGenerationDone`(`src/services/generationStatus.js:17-24`)은
   status 가 `pending`/`generating`/`error` 면 **false**. → 518 개 탈락.
   `hasExportableMedia`(`src/utils/sceneMedia.js:50-53`)는 `image || imagePath` 라 519 개 모두 true.
5. 필터를 쓰는 곳은 4 군데지만 **성격이 다르다**:
   - `useExport.js:59` — `handleExportClick` 의 **preflight 가드** (사용자가 아직 아무것도 안 골랐다)
   - `useExport.js:199` (CapCut) / `:306` (프리미어) / `:398` (Vrew) — **실제 실행 경로 3 개**
6. 걸러진 씬 배열이 그대로 DTO 가 된다: `buildExportProject(validScenes)` 호출은
   `useExport.js:227`(CapCut), `:329`(프리미어), `:420`(Vrew). `buildExportProject`(`:123-195`)는
   1:1 매핑만 하고 추가 필터가 없다.
7. 하류에도 씬을 떨구는 곳이 하나 있지만 이번 건과 무관하다:
   `src/exporters/prepareCloudRequest.js:120` 이 `!imagePath && !fallback` 이면 skip —
   pending+이미지 씬은 여기를 통과한다. `capcut.js` / `capcutCloud.js` / `premiereCloud.js` /
   `vrewCloud.js` / `vrewPacker.js` 어디에도 `status` 재필터는 없다(리뷰 2 인이 각각 확인).
8. **탈락이 조용하다**: `handleExportConfirm` 은 `validScenes.length === 0` 일 때만 경고
   (`useExport.js:200-204`). 519 개 중 1 개가 통과하면 그 가드를 지나간다. `:59-62` 도 동일.
9. 2 의 pending 보존은 **의도된 것**이다. `useProjectData.js:123-126` 주석: 프롬프트를 바꿔
   재생성 대기 중인 씬을 디스크의 옛 이미지로 done 처리하면 "새 프롬프트 + 옛 이미지"가
   done 으로 보이는 거짓말이 된다(실측 버그였음).

→ **내보내기 코드는 데이터대로 동작했다.** 결함은 (a) 화면(=imagePath)과 내보내기(=status)의
판정 기준이 갈리는데 그 사실이 사용자에게 안 드러나는 것, (b) 대량 탈락이 무음인 것.

---

## 3. 목표 / 비목표 / 접근 차단 (신설)

### 3.1 목표
- 이미지 파일이 있는 pending 씬이 있으면 **내보내기 전에 알리고 고르게 한다**.
- 사용자가 그 씬들을 **포함해서 내보낼 수 있게** 한다.
- 자동화(MCP/HTTP) 경로가 모달에 걸려 멈추지 않게 한다.

### 3.2 비목표
- 로드 시 `status` 자동 승격(= §2.9 의 false-done 버그 재발).
- "왜 pending 이 되었나" 규명, 발신자 측 수정.
- 크로스머신 프로젝트 import 기능 신설.
- `image_size` 부재로 인한 내보내기 속도 개선(§9 리스크에만 기록).
- `vrewPacker` 의 base64 미지원 해소 — §5.4 에서 **회피**만 한다(후속 권고는 §5.4 말미).
- ⚠️ **Vrew 의 `includePending` 자체** (v9 에서 스코프 컷, 아래 §3.4).

### 3.3 ⚠️ 접근 차단 — 이걸 같이 안 고치면 전체가 무의미하다

전부-pending 프로젝트는 **내보내기 버튼에 도달조차 못 한다.** 라운드 1 에서 두 리뷰어가 각각 발견.

- `src/App.jsx:2146` — `hasImages={scenes.some(isSceneGenerationDone)}` →
  `src/components/Header.jsx:381` — `disabled={!hasImages}`.
  ready 0 이면 헤더 `ExportSplitButton` 이 **비활성**. 클릭 자체가 안 된다.
- `src/App.jsx:2448-2456` — 하단 버튼은 `canExport = hasScenes && hasRun && !anyRunning &&
  doneCount >= requiredCount` 이고 `hasRun = scenes.some(s => s.status === 'done' || s.status === 'error')`.
  전부 pending 이면 `hasRun` false + `doneCount` 0 → `:2539` 의 조건부 렌더에서 **아예 안 그려진다**.

**변경**
- `App.jsx:2146` 의 `hasImages` 를 **순수 술어 `hasExportAccess(scenes)`**(§4.1) 호출로 바꾼다.
  식을 App 안에 인라인하지 않는 이유: `Header` 는 불리언 prop 만 받으므로(`Header.jsx:24`)
  Header 테스트로는 이 식을 검증할 수 없고, App 은 테스트 하네스가 없다. 술어를 밖으로 빼야
  단위 테스트가 실제로 문다(라운드 2 지적).
- **하단 `canExport` 바는 건드리지 않는다.** 그건 "생성 진척도"를 뜻하는 별개 UI 이고,
  헤더 진입점 하나면 접근이 확보된다. 손대면 진척 표시 의미가 흐려진다.
- **다른 `isSceneGenerationDone` 소비처는 절대 건드리지 않는다** — `src/components/StatusBar.jsx:13`,
  `src/hooks/useMcpServer.js:570`, `src/App.jsx:2448` 은 카운트/진척이지 게이트가 아니다.

### 3.4 ⚠️ Vrew 는 이번 범위 밖 (v9 스코프 컷 — 사용자 결정)

**Vrew 는 현행 동작을 그대로 유지한다**: 항상 ready 만 내보내고, Vrew 탭에서는 3버튼 모달이
뜨지 않는다. `includePending` 은 **CapCut / 프리미어 두 경로만** 지원한다.

**근거 — 라운드 8 에서 두 리뷰어가 독립적으로 같은 결론에 도달했다.**
`isRealPath` 는 **오직 Vrew 때문에 존재한다**(CapCut/프리미어는 base64 를 `prepareCloudRequest`
가 소화한다). 그리고 그건 **네 라운드 연속으로 구멍이 나온 유일한 규칙**이다:

| 라운드 | 뚫린 입력 |
|---|---|
| 4 | raw base64 가 스킴 블랙리스트를 통과 |
| 5 | `file://` 가 `fs.readFile` 에서 ENOENT |
| 7 | **JPEG base64 `/9j/…` 가 POSIX 절대경로 arm 을 통과** |
| 8 | forward-slash UNC `//server/share/…` 가 같은 arm 을 통과 |

원 사건은 CapCut/프리미어이고, Vrew 는 `isRealPath` 로는 닫을 수 없는 문제
(파일 가독성 검증, `vrewPacker` 의 base64 미지원)를 끌고 들어온다. **모양 검사로는 끝이 없다** —
진짜 해법은 실존/가독성 검증인데 그건 §3.2 의 비목표다.

**이 컷으로 사라지는 것**: `isRealPath` 전체, `requirePath` 옵션, `pathOnly` 카운트/게이트/문구,
§7.1 경로 행렬, stale await 사이트 5 곳 중 **V1·V2 두 곳**, 뮤테이션 **#8·#10·#21·#22·#23·#25 여섯 종**.

**받아들이는 귀결**: Vrew 사용자에게는 pending 씬의 무음 탈락이 **그대로 남는다**.
그건 **오늘과 동일한 동작**이므로 이번 변경이 무엇을 악화시키지는 않는다.
후속으로 별건 처리한다(§9).

---

## 4. 설계

### 4.1 씬 분류 (순수 함수, 신규 모듈)

`src/services/exportSelection.js`

```js
// ── 단일 술어. 분류기와 실행 필터가 **반드시 이 함수를 호출**한다(재조합 금지) ──
// ⚠️ v9 스코프 컷(§3.4): `isRealPath` / `requirePath` 는 **삭제**됐다.
//    Vrew 가 유일한 소비자였고, 그 규칙은 네 라운드 연속 뚫렸다.
//    Vrew 는 현행 유지(ready-only) — 분류기·선택기 어디에도 포맷 분기가 없다.

// ── ready 술어도 단일 지점이다 (라운드 5 MAJOR — 두 곳에서 재조합되고 있었다) ──
isReadyExportEligible(scene) → boolean
  // isSceneGenerationDone(scene) && hasExportableMedia(scene)

isPendingExportEligible(scene) → boolean
  // scene.status === 'pending' && hasExportableMedia(scene)

classifyExportScenes(scenes) → {
  ready:            Scene[],  // isReadyExportEligible(scene)
  pendingWithImage: Scene[],  // isPendingExportEligible(scene)
  unusable:         Scene[],  // 나머지
}

// 실행 선택도 같은 모듈이 소유한다 — useExport 가 술어를 재조합하지 않게.
selectExportScenes(scenes, { includePending = false }) → Scene[]
  // scenes.filter(s => isReadyExportEligible(s)
  //                 || (includePending && isPendingExportEligible(s)))
  // ⚠️ 두 함수가 **같은 두 술어 함수를 호출**해야 한다. 식을 각자 인라인하면
  //    "분류기가 센 숫자"와 "실행이 고른 집합"이 갈리는 이번 사건의 병이 재발한다.
  //    §7.1 에 분류기-선택기 **parity 테스트**를 둔다.

// 게이트 전용 순수 술어 — App.jsx:2146 이 이걸 호출한다(§3.3)
hasExportAccess(scenes) → boolean   // ready.length + pendingWithImage.length > 0
```

- **`pending` 만 대상.** `error` 는 생성 실패라 디스크 이미지를 신뢰할 수 없고(`image-missing` 은
  §2.2 처럼 이미 자동 치유되므로 남은 error 는 진짜 실패), `generating` 은 산출물 미확정.
- **"이미지 있음" = `hasExportableMedia` 재사용.** 파일 실존을 다시 확인하지 않는다 — 로드 시
  `useProjectData` 가 확인했고(없으면 `errorKind:'image-missing'` + `imagePath:null`),
  518 회 IPC 재확인은 비용만 크다.
- 세 배열은 **상호배타 + 합집합 = 입력 전체** (테스트로 고정, 개수 + 원소 동일성).
- ⚠️ **원본 순서 보존.** `selectExportScenes` 는 **원본 배열을 `filter` 한다.**
  `ready.concat(pendingWithImage)` 로 만들면 `[pending A, done B]` 가 `[B, A]` 로 뒤집혀
  영상 순서와 `rebaseSrtTrackToScenes`(`src/utils/srtTrack.js:149`)의 자막 재배치가 어긋난다
  (라운드 3 지적). 길이·ID 포함 단언만으로는 이 오류가 통과한다 → **순서 단언 필수**(§7.1).

### 4.2 모달 (3 버튼)

`pendingWithImageCount > 0` 일 때만 뜬다. 0 이면 종전과 **완전히 동일한 흐름**.

⚠️ **Vrew 탭에서는 뜨지 않는다**(§3.4). 카운트는 하나(`pendingWithImageCount`)뿐이고
**게이트·문구·실행 필터가 전부 그 하나를 본다** — v8 까지의 `default`/`pathOnly` 이원화는
Vrew 컷과 함께 사라졌다. 값이 갈릴 여지 자체를 없앤 것이 이 컷의 핵심 이득이다.

문구 — 라운드 1 지적 반영: "아직 생성되지 않은" 은 프롬프트를 고쳐 재생성 대기 중인 씬에는
거짓말이다. 상태와 위험을 같이 말한다.

```
전체 519개 씬 중 518개가 미생성(pending) 상태입니다. 이미지 파일은 있지만,
프롬프트를 수정한 뒤 아직 재생성하지 않은 옛 이미지일 수 있습니다.

[포함]  [배제]  [취소]
```

"전체 N" 은 **`totalSceneCount` prop** 으로 받는다. `readyCount + pendingWithImageCount` 로는
`unusable` 이 빠져 숫자가 틀리다(라운드 2 지적).

| 버튼 | 동작 |
|---|---|
| **포함** | `ready + pendingWithImage` 로 내보낸다 (`includePending: true`) |
| **배제** | `ready` 만 내보낸다 (`includePending: false` = 현행) |
| **취소** | 내보내기를 시작하지 않는다. **`ExportModal` 은 열린 채로 남는다**(옵션을 고치고 다시 시도할 수 있게). 어떤 파일도 쓰지 않고 토스트도 안 띄운다 |

- **매번 묻는다.** localStorage 에 기억시키지 않는다 — 기억시키면 다음 프로젝트에서 낡은
  이미지가 조용히 섞여 이 사건과 같은 무음 사고가 된다.

### 4.3 모달의 소유자와 상태기계 (v3 보강 — 가장 중요)

> **하드 제약: `useExport` 의 어떤 핸들러도 사용자 입력을 기다려선 안 된다.**
> `handleExportConfirm` 은 MCP 진입점이기도 하다(`src/hooks/useMcpServer.js:232` CapCut,
> `:273` 프리미어 — `:273` 은 `handleExportPremiere` 호출이다). 거기서 모달을 await 하면
> `/api/export-capcut` 이 영원히 응답하지 않는다(레포 금지사항: 자동화 중 모달).
> 따라서 **분류와 모달은 `ExportModal` 컴포넌트가 소유**하고, `includePending` 은 오직
> **데이터로만** 핸들러에 전달된다. 이 배치가 §3.1 의 자동화 안전을 *구조적으로* 보장한다.

`ExportModal`(`src/components/ExportModal.jsx`)의 현실:
- props 에 `scenes` 가 **없다**(`:42`). → **신규 prop 필요**.
- 내부 `format` state 를 갖고 사용자가 모달 안에서 포맷을 **바꿀 수 있다**(`:53`).
  따라서 바깥 `exportFormat` 을 신뢰하면 안 된다.
- 실행 콜백이 **3 개**다: `onExport`(CapCut, `:328`), `onExportPremiere`(`:247`),
  `onExportVrew`(`:283`). App 이 그대로 세 핸들러에 배선한다(`src/App.jsx:3004-3006`).
- 프리미어/Vrew 는 콜백 전에 **설치 확인 + 덮어쓰기 `window.confirm`** 을 먼저 한다(`:222-287`).

**상태기계** (ExportModal 내부, UI 전용)

`ExportModal` 은 **항상 마운트**돼 있고(`src/App.jsx:3001`) 닫히면 `if (!isOpen) return null`
(`:185`)일 뿐이다 — **state 가 살아남는다**. 이미 같은 이유로 `format` 을
`useLayoutEffect([isOpen])`(`:96-97`)에서 재초기화하고 있다. `pendingChoice` 도 같은 취급이 필요하다.

```
attemptRef: useRef(0)         // 동기 latch. 매 Export 클릭마다 ++
phaseRef:   useRef('idle')    // 'idle'|'preflight'|'choosing'|'dispatching'  ← ref 다
isOpenRef:  useRef(isOpen)    // ⚠️ 렌더마다 `isOpenRef.current = isOpen` 동기화 필수.
                              //    useRef(isOpen) 은 최초값만 잡는다(라운드 4 지적).
pendingChoice: null | { attempt, kind: 'capcut'|'premiere'|'vrew', options }   // 렌더용 state
```

> **`phase` 는 반드시 ref 다.** React state 는 동기 latch 가 아니라 같은 flush 안의 두 클릭이
> 둘 다 통과한다(라운드 3 지적). 렌더가 필요하면 ref 와 state 를 함께 갱신하되 **판정은 ref 로** 한다.
> `isOpen` 도 마찬가지 — async handler 가 캡처한 closure 값은 모달이 열려 있던 시점의 것이라
> **항상 true** 여서 닫힘 감지에 쓸 수 없다.

1. Export 클릭 → `phase !== 'idle'` 이면 **즉시 무시**(동기 latch). 아니면 `const my = ++attemptRef`,
   `phase='preflight'`.
2. 기존 검증·설치확인·덮어쓰기 `window.confirm` 을 **먼저** 통과시킨다.
   (프리미어 `:230` / Vrew `:255` / CapCut `:306` 이 전부 **비동기**다.)
   "포함"을 고른 뒤 덮어쓰기에서 거절당하면 취소 의미가 꼬이므로 순서는 이것으로 고정.
3. **모든 await 직후** `if (my !== attemptRef.current || !isOpenRef.current) return` —
   닫힌 뒤 resolve 한 stale attempt 를 버린다.
   (v3 는 `!isOpen` 을 썼는데 그건 **closure 라 절대 안 걸리는 죽은 코드**였다 — 라운드 3.)
4. `pendingWithImageCount === 0` → **`dispatch(kind, options, includePending=false)`** 를 호출한다.
   ⚠️ 콜백을 여기서 직접 부르지 않는다 — step 7 과 **같은 헬퍼**를 타야 phase 해제가 한 곳에서 일어난다
   (라운드 5 BLOCKER: v5 는 step 4 에 finally 를 아무도 안 줘서, pending 이 없는 **평범한 내보내기가
   한 번 성공한 뒤 재오픈하면 `dispatching` 에 잠긴 채**였다).
5. `> 0` → `setPendingChoice({ attempt: my, kind, options })`, `phase='choosing'`.
   콜백은 **아직 부르지 않는다**.
6. **`phaseRef !== 'idle'` 인 동안** Export 버튼과 포맷 전환 탭을 **비활성화**한다.
   (현재 Export 버튼은 `disabled={loading || ((format==='premiere'||format==='vrew') && !premiereWorkFolder)}`
   (`:728`)라 phase 를 모른다 → 그대로 두면 뒤에서 또 눌린다.)
   ⚠️ **잠금 범위는 `choosing` 이 아니라 `preflight`~`dispatching` 전체다**(라운드 5 MAJOR).
   세 preflight 가 전부 await 하는데(`:230`/`:255`/`:306`) 그동안 탭이 열려 있으면
   **프리미어 preflight 중 Vrew 로 바꿔도 저장된 `kind:'premiere'` 가 발사된다** —
   사용자가 보는 포맷과 실제 산출물이 갈린다. 판정은 `phaseRef` 로 하되 렌더용 state 를 함께 갱신한다.
7. 포함/배제 → **`dispatch(pendingChoice.kind, pendingChoice.options, includePending)`** 를 호출한다
   (아래 공통 헬퍼). phase 전이·`pendingChoice` 비우기·finally 가 전부 그 안에 있다.

   ⚠️ **핸들러 전체를 try/finally 로 감싼다.** `dispatching`/`choosing` 으로 **전이하지 못한
   모든 종료**는 `phaseRef='idle'` 로 복귀해야 한다.
   단 **finally 는 attempt 토큰으로 가드한다**: `if (my === attemptRef.current && phaseRef.current === 'preflight')`
   일 때만 리셋. 안 그러면 `A preflight → 닫기 → 재오픈 → B preflight → A resolve` 순서에서
   **A 의 finally 가 B 의 latch 를 풀어버린다**(라운드 4 지적). 실제 코드의 조기 return 이 여럿이다:
   경로 비어있음(`ExportModal.jsx:300`), 미설치, 덮어쓰기 거절(`:243`), 그리고 **reject 가능한**
   설치확인(`:231`). v3 는 finally 를 콜백에만 걸어서 이 경로들이 `phase` 를 `'preflight'` 에
   **영구 잠금**했다 — 모달을 닫았다 열어야만 풀리는 소프트락(라운드 3 지적).
**공통 dispatch 헬퍼 (라운드 5 BLOCKER — step 4 와 step 7 이 반드시 이걸 쓴다)**

```js
async function dispatch(kind, options, includePending) {
  phaseRef.current = 'dispatching'; setPhase('dispatching')
  setPendingChoice(null)
  try {
    await callbackFor(kind)({ ...options, includePending })
  } catch (e) {
    // 콜백은 실제로 reject 할 수 있다 — 세 핸들러의 `ensurePermission()` await 는
    // 각자의 try 바깥이다(useExport.js:211/:316/:407 vs try 시작 :222/:327/:418).
    // 삼키지 않으면 unhandled rejection 이 된다(vitest 는 이걸 에러로 띄운다).
    console.warn('[ExportModal] export dispatch failed:', e)
  } finally {
    // ⚠️ **attempt 가드를 걸지 않는다.** step 11 이 dispatch 중 닫기에서 ++attemptRef 를
    //    수행하므로, 여기에 `my === attemptRef.current` 를 붙이면 그 경우 리셋이 스킵돼
    //    phaseRef 가 'dispatching' 에 **영구 잠금**된다(앱 재시작 전까지 내보내기 사망).
    //    preflight finally 의 가드 패턴을 여기 복사하면 안 된다 — 의미가 반대다.
    phaseRef.current = 'idle'; setPhase('idle')
  }
}
```

`dispatch` 는 **phase 를 여는 유일한 지점이자 닫는 유일한 지점**이다. 콜백이 throw/reject 해도
`idle` 로 돌아온다. step 4(pending 0)와 step 7(포함/배제)이 같은 함수를 부르므로 두 경로의
잠금 해제가 구조적으로 같아진다.

8. 취소 → `setPendingChoice(null)`, `phase='idle'`. 콜백 호출 없음. `ExportModal` 은 열린 채.
9. **닫기 일원화** — 백드롭(`ExportModal.jsx:335`, `onClick={loading ? undefined : onClose}`),
   X(`:385`), footer 취소(`:722`)가 지금은 `onClose` 를 직접 부른다. `handleClose()` 하나로 모아
   `++attemptRef`, `pendingChoice=null`, `phaseRef='idle'` 후 `onClose()`.
   **백드롭의 `loading` 가드는 보존한다.** (v3 가 백드롭을 `:735` 라 적었는데 그건 닫는 `</div>` —
   앵커 정정.)
10. **`isOpen` 이 false 가 되면** `:96-97` 자리의 effect(**`useLayoutEffect` 여야 한다** — 기존
    `format` 재초기화와 같은 훅. passive effect 면 이론상 창이 생긴다, 라운드 5)에서 **`++attemptRef`** 와 함께
    `pendingChoice=null`, `phaseRef='idle'` 로 리셋한다.
    ⚠️ **attemptRef 증가가 핵심이다.** 외부 닫힘이 실재한다 — `src/App.jsx:3019` 의
    `onUpgradeClick` 이 `setShowExportModal(false)` 를 직접 부르고, 업그레이드 버튼은 preflight
    중에도 눌린다(step 6 은 Export 버튼·포맷 탭만 막는다). v3 는 여기서 attempt 를 안 올려서
    **paywall 이 뜬 뒤에 내보내기가 발사**될 수 있었다(라운드 3, 두 리뷰어 일치).
    (Esc 닫기는 현재 없다. 추가하면 반드시 `handleClose` 를 타야 한다.)
11. **`dispatching` 중 닫기** — 이미 발사된 콜백은 취소하지 않는다. 이후 모달 닫기 소유권은
    `useExport`(`:277`/`:373`/`:462`)에 있다.
    ⚠️ **step 9·10 과의 우선순위**: 닫기 시 `phaseRef` 를 무조건 `'idle'` 로 만들면 step 11 과
    모순된다(라운드 4 지적). **`phaseRef.current === 'dispatching'` 이면 닫기는 phase 를 건드리지
    않는다** — `pendingChoice` 만 비우고 `++attemptRef` 는 그대로 수행한다. phase 해제는 오직
    dispatch 콜백의 finally 가 한다. 이래야 재진입 방지와 닫기 리셋이 양립한다.

"소비-후-호출"(7)만으로는 부족하다는 것이 라운드 2 의 결론이다 — React 상태 갱신은 동기 latch 가
아니므로 `attemptRef` 와 `phase` 가 실제 exactly-once 를 보장한다.

**신규 prop**: `readyCount = 0`, `totalSceneCount = 0`, `pendingWithImageCount = 0`.
⚠️ **기본값을 반드시 준다** — 기존 `tests/components/ExportModal.test.jsx` 는 새 prop 을 안 넘긴다.
`undefined > 0` 이 false 라 우연히 살지만, 명시적 기본값이 없으면 구조분해에서 터진다(라운드 3).
씬 배열 519 개를 모달에 통째로 넘기지 않는다 — 모달은 표시만 하고 분류는 App 이 한 번 수행한다.
`totalSceneCount` 는 §4.2 문구의 "전체 N" 용. (v8 까지 있던 `pathOnly` 는 §3.4 컷으로 삭제.)

### 4.4 `includePending` 배선 (실행 경로 3 개)

- **`useExport` 는 술어를 재조합하지 않는다.** 로컬 `isExportableScene` 을 없애고
  `selectExportScenes(scenes, { includePending })`(§4.1)를 **호출**한다.
  v3 는 "같은 것을 쓴다"고 문장으로만 말하고 `eligible` 을 export 하지 않아, 구현자가 동일 논리를
  두 번 쓰는 게 자연스러웠다 — 그게 라운드 2 MAJOR 1 의 재발 경로다(라운드 3 지적).
- **실행 경로 3 개**: `useExport.js:199`(CapCut) / `:306`(프리미어) / `:398`(Vrew).
  (gap fix 머지로 앵커가 밀렸다 — 라운드 5. 아래 §4.4-a 참고.)

### 4.4-a ⚠️ 버그 B(슬롯)와의 상호작용 — v6 신설

같은 브랜치에 **먼저 머지된** `2026-07-28-export-scene-gap-absorption` 이 `buildExportProject` 를
바꿔놨다. v5 는 이 상호작용을 **한 번도 언급하지 않았다**(라운드 5, 두 리뷰어 일치).

`buildExportProject`(`useExport.js:123-195`)는 이제:
- `computeSceneSlots(validScenes, settings)` 로 슬롯을 구하고(`:130`),
- `validScenes.map((s, i) => ...)` 안에서 `slots.imageSlots[i]` / `sourceDurations[i]` /
  `sourceOffsets[i]` 를 **인덱스로** 읽고(map 은 `:154-189`, `sourceOffsets` 읽기는 `:179`),
- `rebaseSrtTrackToScenes` 에 `durationOf: (_scene, i) => slots.srtSlots[i]` 와
  `initialCumulative: Number(validScenes[0].startTime) || 0` 을 넘긴다(`:141-151`).

**따라서 이 스펙이 지켜야 할 불변식 두 개**:

1. **슬롯은 `selectExportScenes` 의 결과 배열을 기준으로 계산된다.** 분류를 다른 배열
   (전체 `scenes`, 또는 ready-only)로 해놓고 그 결과를 인덱스로 쓰면 **모든 후속 씬의
   `image_duration`·`source_offset`·자막 시각이 밀린다.** 이건 가설이 아니다 —
   `computeSceneSlots(validScenes)` 를 `computeSceneSlots(scenes)` 로 바꾼 뮤턴트가
   **405 개 테스트를 통과**한 실측 기록이 있다(`tests/hooks/useExport.gap.test.jsx:130-146` 주석).
   §4.1 의 "원본 배열 filter + 순서 보존"이 이 정합을 지키는 유일한 근거다.
2. **`includePending` 은 슬롯 술어의 모집단을 바꾼다.** `computeSceneSlots` 는
   **all-or-nothing** 이다(`sceneSlots.js:34-47`): 포함된 pending 씬 중 하나라도
   `startTime`/`endTime` 이 비유한·역전·겹침이면 **프로젝트 전체가 legacy 폴백**된다 →
   `console.warn` 뿐이고 사용자에게는 무음, 그리고 **버그 B(drift + 마지막 씬 폭주)가 부활**한다.
   사건 프로젝트(Untitled 519 씬)는 519/519 시각이 유효·단조·비겹침이라 안전함을 확인했지만,
   **일반 보장은 아니다** → §9 리스크로 기록하고 §7.2 가 테스트로 고정한다.
- **Vrew(`:398`) 는 옵션을 받지 않는다** — 항상 ready-only(§3.4). 실행 경로는 **CapCut(`:199`)과
  프리미어(`:306`) 둘**만 `includePending` 을 수용한다.
- `useExport.js:59`(`handleExportClick`)은 **옵션을 받지 않는다.** 사용자가 아직 아무것도 안 골랐다.
  여기서 바뀌는 것은 **가드의 기준**뿐: `ready` → `ready + pendingWithImage`.
  (라운드 1 지적: "네 경로 모두 옵션을 존중한다"는 이 경로에 대해 반증 불가능한 문장이었다.)

### 4.5 자동화(MCP/HTTP) 경로 — 3 중 차단 해소 (v2 신설)

현재 `includePending` 은 **어디로도 도달하지 못한다.** 세 곳 전부 고쳐야 한다.

| # | 파일 | 현재 | 변경 |
|---|---|---|---|
| 1 | `mcp-server/index.js:584-601` | `export_capcut`/`export_premiere` inputSchema 가 `port` 만 받음 | `includePending: boolean` 추가 |
| 2 | `mcp-server/lib/toolResponses.js:24-28`, `:43-47` | `fetcher(port,'POST',path)` — **바디 없음** | 바디로 `{ includePending }` 전달 |
| 3 | `src/hooks/useMcpServer.js:220-230`, `:261-271` | `exportOptions` 를 **화이트리스트로 재구성**해 `options.includePending` 이 버려짐 | `includePending: options.includePending === true` 추가 |

- **기본값 `false`** — 현행 동작 유지. 자동화의 의미가 조용히 바뀌면 안 된다.
- HTTP 바디는 `electron/main.js:1258-1260`(CapCut) / `:1279-1281`(프리미어) 에서
  `JSON.parse(body)` → `executeJavaScript` 로 그대로 전달되므로 **추가 변경이 없다**.
  (`:1257` / `:1277` 은 `if (mainWindow)` 줄이다 — v2 앵커 재정정.)
- `mcp-server/lib/appClient.js:15` 의 `appFetch(port, method, pathname, body = null)` 는
  **이미 바디를 받는다**. appClient 는 건드릴 필요 없다(구현자 과잉 방지).
- **MCP 경로는 모달을 절대 띄우지 않는다.** §4.3 의 소유자 배치로 구조적으로 보장된다.

### 4.6 동작 표

| pendingWithImage | ready | 경로 | 결과 |
|---|---|---|---|
| 0 | ≥1 | UI | 모달 없음, 종전대로 |
| ≥1 | ≥1 | UI | 3버튼 모달 → 포함/배제/취소 |
| ≥1 | **0** | UI | 헤더 버튼이 **활성**(§3.3) → 3버튼 모달. **"배제" 선택 시 내보낼 게 0** → 기존 "생성된 이미지 없음" 경고 |
| 0 | 0 | UI | 헤더 버튼 비활성 (종전) |
| 임의 | 임의 | MCP/HTTP | 모달 없음, `includePending` 옵션대로(기본 false) |

---

## 5. 엣지 케이스

1. **ready 0 / pendingWithImage ≥1** — §3.3 의 `hasImages` 변경 + `useExport.js:59` 가드 기준
   변경이 **둘 다** 있어야 도달 가능. 하나만 하면 paper fix.
2. **취소 반환값** — UI 레이어에서 취소하면 **어떤 핸들러도 호출되지 않으므로 반환값이라는
   개념 자체가 없다**. (v1 의 `{ success:false, cancelled:true }` 문장은 삭제 — 소비자가 없다.
   `ExportModal` 은 콜백 반환값을 쓰지 않는다.)
3. **포함 시 자막** — pendingWithImage 씬도 `subtitle` 을 가지므로 SRT rebase
   (`rebaseSrtTrackToScenes`, `useExport.js:141-151`)에 함께 들어간다. 이번 사건의 225 B SRT 가
   정상 길이로 회복되는지가 검증 포인트(§7 에서 **SRT 내용**을 단언한다).
4. **Vrew + base64 전용 이미지** — `hasExportableMedia` 는 `image`(base64)도 통과시키지만,
   Vrew 경로는 base64 를 파일 경로로 취급해 **내보내기 전체가 죽는다**:
   `buildExportProject` 가 base64 를 `image_path` 에 넣고(`useExport.js:172`; `:171` 은 `media_path`) →
   `prepareCloudRequest.js:117`·`:159` 가 그대로 `mediaFiles[].path` 로 옮기고 →
   `src/exporters/vrewPacker.js:121` 의 `sourceForItem` 이 `item?.path ? { filePath: item.path } : null`
   로 **data URI 를 filePath 로 만들고** → `electron/ipc/vrew.js:67` 의 `filePath` 분기가
   `:72` 에서 `fs.readFile(dataURI)` 로 하드 실패한다(ENAMETOOLONG/ENOENT).
   `vrewPacker.js:119-120` 주석은 "인라인 base64 는 발생하지 않음"이라고 **가정**하고 있다 —
   포함 기능은 그 가정을 깰 수 있다.
   → **v9 스코프 컷(§3.4): Vrew 는 `includePending` 을 지원하지 않는다.** 항상 ready-only 라
     이 경로에 base64 pending 이 들어갈 일이 없다. 근본 해소는 후속 별건.
   `imagePath` truthy 검사만으로는 부족하다 — `imagePath` 자체가 data URI 일 수 있다.

   **후속 권고(이번 범위 밖)**: `electron/ipc/vrew.js:75` 는 이미 `{data}` 분기를 갖고 있으므로,
   `sourceForItem` 이 data URI 를 `{data}` 로 넘기게 고치면 이 회피 자체가 불필요해진다.
   done 씬에도 있는 **선존 제약**이라 이번 버그 수정과 분리한다.
5. **영상만 있고 이미지 없는 pending 씬** — `hasExportableMedia` false → `unusable`. 종전과 동일
   (의도적, `sceneMedia.js:36-47` 주석 참고. 단 그 주석이 가리키는 "capcutCloud line 135" 는
   드리프트됐고 실제 skip 은 `prepareCloudRequest.js:120` 이다 — 주석 정정은 별건).

---

## 6. 명시적으로 하지 않는 것과 그 이유

| 안 | 왜 안 하나 |
|---|---|
| 로드 시 pending+이미지를 done 으로 승격 | `useProjectData.js:123-126` 이 막으려던 false-done 버그 재발 |
| pending 일 때 `imagePath` 를 안 붙이기 | UI 와 내보내기는 일치하지만 "디스크에 이미지가 있다"는 정보가 사라진다. 이번 사건에서 그 썸네일이 유일한 단서였다 |
| `donePrompt` 로 "외부 유입" 자동 판별 | **두 리뷰어가 독립적으로 반대.** `donePrompt` 는 프로비넌스 표지가 아니다 — 로컬 강제 재생성 중에도 보존되고(`:125-126`), 구버전 프로젝트엔 아예 없다. 부재 ⇒ 외부도 아니고 안전도 아니다. **행동 결정에 쓰지 않는다.** 모달 문구를 풍부하게 하는 용도로만 검토 가능(이번 범위 밖) |
| 선택 기억(localStorage) | 다음 프로젝트에서 낡은 이미지가 무음으로 섞인다 |
| 하단 `canExport` 바 완화 | 진척 표시 의미가 흐려진다. 헤더 진입점 하나로 접근 확보 충분(§3.3) |

---

## 7. 테스트 계획 (TDD — 실패 테스트 먼저)

> ⚠️ 기존 `tests/hooks/useExport.test.js` 는 **`useExport` 를 import 조차 하지 않고**(`:8`)
> 필터링을 테스트 안에서 재구현한다(`:31`). **그 파일 스타일로 확장하면 제품이 깨진 채 초록불이 뜬다.**
> 신규 훅 테스트는 `renderHook(useExport)` 로 실제 훅을 돌린다 — 참고: `tests/hooks/useExport.refresh.test.jsx:53`.
>
> ⚠️ **관찰 지점을 명시한다.** `buildExportProject` 는 훅 내부 함수라 직접 못 본다.
> `vi.mock('../../src/exporters/capcut.js')` 등으로 exporter 를 mock 하고
> **`exportCapcut` 이 받은 `project.scenes` / `project.srtTrack`** 을 단언한다.

### 7.1 단위 — `tests/services/exportSelection.test.js` (신규)

⚠️ **분류기-선택기 parity**(라운드 6 — §4.1 이 약속만 하고 §7.1 에 없었다):
- `selectExportScenes(scenes, { includePending: false })` **=== `classifyExportScenes(scenes).ready`**
- `selectExportScenes(scenes, { includePending: true })` **=== `ready ∪ pendingWithImage`, 원본 순서**
- 동일성은 **원소 identity(`toBe`)** 로 본다. 선택기의 ready 항만 `hasExportableMedia` 로 약화한
  뮤턴트는 분류기만 검사하면 안 죽는다 — `generating`/`error` + 이미지 씬이 실행에 섞여 들어간다.
- done / pending+이미지 / 미디어없음 3 분할이 정확하다
- 세 배열이 상호배타·합집합=입력 전체 — **개수 + 원소 동일성(identity)** 단언
- `generating`·`error` 는 이미지가 있어도 `pendingWithImage` 에 안 들어간다
- 이미지 없는 `pending` 은 `unusable`
- `hasExportAccess(scenes)`: ready 0 + pendingWithImage ≥1 → **true**, 둘 다 0 → false

### 7.2 훅 — `tests/hooks/useExport.pending.test.jsx` (신규, renderHook)
- **회귀 재현**: pending+이미지 518 + done 1 → `includePending:false` 면 exporter 가 받은
  `project.scenes.length === 1`
- `includePending:true` → `=== 519`
- **실행 경로 3 개 각각** 옵션을 존중한다(CapCut/프리미어/Vrew) — 한 경로만 고치는 회귀를 잡는다
- **Vrew 는 옵션을 무시한다**(§3.4): `includePending:true` 를 줘도 Vrew 산출물은 ready-only 다
- **원본 순서 보존**: `[pending A, done B]` 입력 → exporter 가 받은 `project.scenes` 가 `[A, B]`
  (`ready.concat(pending)` 이면 `[B, A]` 가 된다)
- `handleExportClick` 이 ready 0 / pendingWithImage ≥1 에서 **조기 반환하지 않는다**
- **옵션 생략 호출**: `selectExportScenes(scenes, {})` — `includePending` 을 **아예 안 넘겼을 때**
  ready 만 반환한다. MCP 는 `includePending: false` 를 명시 전달하므로 이 단위 테스트가 없으면
  기본 파라미터 뮤테이션(#1)이 산다(라운드 4 지적)
- **`includePending:false` + ready 0** → `{ success:false }` + `toast.warning` (§4.6 표 3행의 훅쪽 절반)
- **SRT 정확 단언**: `includePending:true` 일 때 exporter 가 받은 `project.srtTrack` 에
  pending 씬들의 **subtitle id 가 실제로 포함**된다. "1 개 씬 분량이 아니다" 식의 느슨한 단언은
  `pruneSrtTrackToScenes(..., { preserveUnlinked: true })`(`useExport.js:141-151`) 때문에
  unlinked 라인만으로도 통과할 수 있다.
- ⚠️ **모든 픽스처는 유효한 `startTime`/`endTime` 을 실어야 한다**(§4.4-a, 라운드 5).
  안 그러면 `computeSceneSlots` 가 전체 legacy 폴백해 **모든 pending 테스트가 슬롯 경로를
  안 타고** 돈다 — 핸드오프의 수용 기준(마지막 씬이 안 늘어남, 사이드카 정상)은 슬롯 경로에서만
  성립하므로 그 상태로는 아무것도 보장 못 한다.
- ⚠️ **슬롯 정합 단언(신설)**: 혼합 픽스처 `[done A(0–5), pending B(6–9), done C(10–15)]` 에서
  - `includePending:false` → `image_duration` **`[10, 5]`** (B 구간을 A 가 흡수)
  - `includePending:true`  → `image_duration` **`[6, 4, 5]`** 이고 `source_offset[0] === 0`
  둘 다 **리터럴로** 박는다.
  ⚠️ `source_offset[0] === 0` 은 위 픽스처에서 **공허하다**(A 의 `startTime` 이 0 이라 뭘 해도 0).
  선두를 pending 으로 두는 픽스처를 하나 더 둔다: `[pending A(6–9), done B(10–15)]` →
  `includePending:false` 면 첫 선택 씬이 B 라 **`source_offset[0] === 10`**,
  `true` 면 A 라 **`=== 6`**. 이래야 `sourceOffsets` 배선이 실제로 물린다(라운드 6 Codex). 개수·ID 단언만으로는 "슬롯을 선택 전 배열로 계산" 뮤턴트가
  통과한다(#18). 사이드카 시각도 같은 픽스처로 단언한다.
- ⚠️ **`useSlots` 유지 단언**: `includePending:true` 픽스처에서 `console.warn` 이
  `'falling back to legacy durations'` 로 **호출되지 않는다**. 포함이 폴백을 유발하면
  버그 B 가 무음으로 부활한다(§9).

### 7.3-a ⚠️ App → ExportModal 카운트 배선 (라운드 6 BLOCKER — v6 에 테스트가 없었다)

⚠️ **두 테스트로 나눈다**(라운드 7 Codex — v7 은 "ExportModal 을 mock" 해놓고 그 안의 게이트를
검증하라고 해서 **자기모순**이었다. stub mock 이면 게이트 코드가 실행조차 안 된다):

- **(a) 배선** — `tests/components/App.exportAccess.test.jsx`: `ExportModal` 을 **stub mock** 해서
  받은 prop 만 캡처한다. App 이 무엇을 넘기는지가 관심사다.
- **(b) 게이트** — `tests/components/ExportModal.pendingChoice.test.jsx`: **실제 컴포넌트를 렌더**하고
  prop 을 직접 준다. 게이트와 문구가 카운트를 어떻게 쓰는지가 관심사다.

(a) 로 검증하는 것:

- `totalSceneCount` / `readyCount` / `pendingWithImageCount` 가 **분류 결과와 일치**한다 (리터럴 단언).
- **이게 없으면 구현자가 카운트 prop 을 통째로 빠뜨려도 전부 초록이다** — §4.3 이 기본값 0 을
  요구하므로 `undefined > 0` 이 아니라 `0 > 0` 이 되어 **3버튼 모달이 영원히 안 뜬다.**
  ExportModal 자체 테스트는 prop 을 직접 주므로 이 누락을 못 문다(뮤테이션 #20).
(b) 로 검증하는 것 — **실제 `ExportModal` 렌더**:
- **Vrew 탭에서는 3버튼 모달이 뜨지 않는다**(§3.4). 같은 pending 카운트에서 CapCut 은 뜬다.
- ⚠️ **문구(copy) 단언**(라운드 7 두 리뷰어 일치 — §4.2 는 "게이트·문구·실행 필터가 전부 같은 값을
  본다"고 하는데 **문구만 그물이 없었다**). 서로 구별되는 리터럴로 픽스처를 잡는다:
  **`totalSceneCount = 7`, `readyCount = 2`, `pendingWithImageCount = 3`** →
  모달 텍스트에 **"7"** 과 **"3"** 이 나온다.
  ⚠️ **`readyCount` 를 반드시 2 로 박는다**(라운드 8 Fable F2). 4 로 잡으면 §4.2 가 금지한 식
  `readyCount + pendingWithImageCount` 도 **7** 을 내놓아 **#24 가 공허하게 통과**한다.
  2 면 `2+3=5 ≠ 7` 이라 갈린다.
  ⚠️ 맨 숫자 substring 단언은 모달의 다른 숫자와 충돌하므로 **보간 구문째로**(예: "중 3개") 단언한다.
- **로케일 키 실재**: 렌더된 텍스트에 `raw i18n key`(예: `export.pendingChoice.`)가 **나타나지 않는다**.
  키를 빠뜨리면 화면에 키가 그대로 노출된다(§8 이 이미 지목한 위험인데 그물이 없었다).

### 7.3 접근 게이트 (§3.3)
- `tests/services/exportSelection.test.js` 의 `hasExportAccess` 케이스(7.1) — 술어 자체.
- `tests/components/Header/…` — `hasImages` prop → 버튼 활성/비활성 계약.
- **`tests/components/App.exportAccess.test.jsx` (신규)** — **App 배선을 실제로 문다.**
  v3 는 "App 에 하네스가 없다"며 눈검증으로 격하했는데 **사실 오류였다**:
  `tests/components/App.*.test.jsx` 가 **6 개**(+`AppFlowSplitLayout.test.jsx`) 있고,
  `App.promptBusyLines.test.jsx:360` 이
  `vi.mock('../../src/components/Header', () => ({ default: () => null }))` 로 Header 를 mock 한 뒤
  `:416` 에서 App 을 import 하고 `:453` 에서 처음 렌더한다. 같은 패턴으로 **Header mock 이 받은 props 를 캡처**하고,
  `status:'pending'` + `imagePath` 씬만 주입해 `hasImages === true` 를 단언하면
  `App.jsx:2146` 원복 뮤테이션이 죽는다.

### 7.4 통합 — `tests/components/ExportModal.pendingChoice.test.jsx` (기존 `ExportModal.test.jsx` 와 별도)
- pendingWithImage > 0 → 3버튼 모달이 뜬다 / 0 → **안 뜬다**(잔소리 금지)
- **포함** → 해당 콜백이 `includePending:true` 로 호출 / **배제** → `false`
- **취소** → **어떤 콜백도 호출 안 됨**, `ExportModal` 은 열린 채
- **포맷 전환**: CapCut 으로 열어 모달 안에서 프리미어로 바꾼 뒤 포함 → **프리미어 콜백**이 불린다
- **이중 발화**: `choosing` 중 Export 버튼과 포맷 탭이 **disabled** 다(속성 단언) + 클릭해도
  설치확인/덮어쓰기 검사가 **재실행되지 않는다**(호출 횟수 단언)
- **닫기 리셋**: 3버튼 모달 중 백드롭/X/footer 취소로 닫고 재오픈 → 3버튼 모달이 **떠 있지 않다**
- **A/B 인터리브(뮤테이션 #14)**: `A preflight → 닫기 → 재오픈 → B preflight → A resolve` 후
  **세 번째 Export 클릭에서 preflight 가 시작되지 않는다**(= B 의 latch 가 살아있다).
  ⚠️ "B 가 생존한다"만 단언하면 **안 죽는다** — 가드가 없어도 B 는 결국 dispatch 하기 때문이다
  (라운드 5). 관찰 가능한 것은 *세 번째 클릭이 막히는가* 뿐이다.
- **stale attempt**: **`pendingWithImageCount === 0` 픽스처**(= 즉시 dispatch 경로)로
  설치확인 promise 를 붙잡아 둔 채 모달을 닫고 그 뒤 resolve → **콜백 미호출**.
  (pending>0 픽스처면 resolve 가 콜백이 아니라 `setPendingChoice` 로 가서 단언이 **공허하게
  통과**한다 — 라운드 3 지적)
- **외부 닫힘(prop-driven)**: `isOpen` 을 false 로 **rerender** 해서 닫는다(백드롭/X 를 안 탄다).
  `App.jsx:3019` 업그레이드 경로가 이 모양이다.
  ⚠️ **순서를 반드시 `닫기 → 재오픈 → preflight resolve` 로 한다.**
  `닫기 → resolve → 재오픈` 순서면 `isOpenRef` 가 대신 막아줘서 **`++attemptRef` 를 제거한
  뮤턴트(#7)가 살아남는다**(두 리뷰어 모두 지적). 재오픈 후에는 `isOpenRef` 가 다시 true 라
  **attempt 토큰만이** stale 을 가른다 → resolve 후 콜백 미호출 + 3버튼 모달 없음을 단언.
- ⚠️ **stale 가드는 사이트별로 전수 테이블화한다**(라운드 8 F1 — 이게 라운드 6·7·8 이 매번
  하나씩 찾아낸 그 클래스를 **구조적으로** 닫는 방법이다. 인스턴스를 하나씩 추가하면
  사이트 하나당 라운드 하나가 계속 든다).
  §4.3 step 3 은 "**모든** await 직후"인데 실제 suspension point 는 **세 곳**이다(Vrew 컷 후):
  | # | 사이트 | 앵커 |
  |---|---|---|
  | P1 | 프리미어 설치확인 | `ExportModal.jsx:231` |
  | P2 | 프리미어 폴더확인 | `ExportModal.jsx:242` |
  | C1 | CapCut 설치확인 | `ExportModal.jsx:308` |
  (Vrew 의 V1 `:257` / V2 `:278` 은 §3.4 컷으로 이번 범위 밖. `:291`/`:295` 는 하위 핸들러 래퍼라
  별도 지점이 아니고, `window.confirm` 은 동기다.)
  → **`describe.each([P1, P2, C1])`** 로 "붙잡기 → 닫기 → 재오픈 → resolve" 를 **세 번** 돌린다.
  단언: 콜백 미호출 + 3버튼 모달 없음 (뮤테이션 #26 — 짝 설명에 **"3 사이트 전수"** 를 명기한다).
- ⚠️ **`#15` 도 닫기 경로가 둘이다** — `handleClose`(백드롭/X/footer)와 `isOpen=false` effect.
  픽스처를 **둘 다** 돌린다. 하나만 쓰면 뮤턴트가 어느 쪽 가드를 지우느냐에 따라 산다(라운드 8 F1).
- ⚠️ **`dispatching` 중 잠금**(라운드 7 Codex): §4.3 step 6 은 `phaseRef !== 'idle'` 전 구간을
  잠그라는데 §7.4 는 `choosing` 과 preflight 만 본다. **dispatch 중에 Export 버튼·포맷 탭이
  여전히 disabled** 임을 단언한다 — 안 그러면 진행 중인 프리미어 내보내기를 Vrew 로 표시하는
  변형이 산다 (뮤테이션 #27).
- ⚠️ **백드롭의 `loading` 가드 보존**(라운드 7 Fable F3): §4.3 step 9 가 `handleClose` 일원화를
  요구하는데, 그 리팩터가 정확히 `ExportModal.jsx:335` 의 `onClick={loading ? undefined : onClose}`
  를 날리기 쉽다. **dispatch(loading) 중 백드롭 클릭 → 모달이 그대로 열려 있고 리셋도 없다**
  (뮤테이션 #28).
- ⚠️ **fail-open catch 뒤에도 stale 가드가 필요하다**(라운드 8 Codex): CapCut 설치확인의 reject 는
  `ExportModal.jsx:319-322` 가 **삼키고 그대로 진행**한다. 그래서 `닫기 → 재오픈 → 설치확인 reject`
  순서면 await 다음 줄의 가드를 **건너뛰고** stale attempt 가 dispatch 할 수 있다.
  → 그 순서의 픽스처를 두고 **콜백 미호출**을 단언한다 (뮤테이션 #25).
- **preflight reject**: 설치확인이 reject → 다시 Export 를 눌렀을 때 **설치확인이 2 회째 호출**된다
  (버튼은 preflight 중에도 원래 enabled 라 "누를 수 있다"만으론 뮤테이션 #13 이 산다 — 라운드 4)
- **조기 return 후 재시도**: 미설치 / 덮어쓰기 거절 후 재클릭 시에도 **2 회째 호출**을 단언
- **dispatch 중 닫기**: 콜백이 pending 인 채 모달을 닫아도 **재진입이 안 된다**(§4.3 step 11).
  ⚠️ **픽스처를 `pendingWithImageCount === 0` 으로 못 박는다**(라운드 6 F2).
  include 경로(pending>0)로 쓰면 **step 4 를 아예 안 타서** #19 의 변형 B(= phase 전이 없이
  콜백 직접 호출)가 살아남는다 — 그 변형은 콜백 settle 후 바깥 preflight finally 가
  `preflight→idle` 로 풀어줘 #19 짝 테스트도 통과한다. 그리고 그건 문서상 구멍이 아니라
  **실제 제품 구멍**이다: pending 0 인 평범한 프로젝트에서 내보내기 중 닫기 → 재오픈 → 클릭 =
  **이중 내보내기**. 두 픽스처(pending 0 / pending>0)를 모두 돌리면 더 좋다.
- **dispatch 중 닫기 → settle → 재오픈 → Export 가능**(라운드 5, 뮤테이션 #16).
  위 항목만으로는 "잠긴 것"과 "올바르게 막힌 것"을 구분 못 한다. 콜백을 resolve 시킨 뒤
  재오픈해서 Export 를 누르면 **설치확인이 다시 호출**돼야 한다.
- **pending 0 경로의 잠금 해제**(라운드 5, 뮤테이션 #19): `pendingWithImageCount === 0` 픽스처로
  내보내기를 **성공**시킨 뒤 재오픈 → Export 클릭 → **2 회째 dispatch 가 일어난다.**
  v5 대로 step 4 가 콜백을 직접 부르면 phase 가 `dispatching` 에 남아 여기서 막힌다.
- **preflight 중 포맷 전환**(라운드 5, 뮤테이션 #17): 프리미어로 Export → 설치확인 promise 를
  붙잡은 채 Vrew 탭 클릭 → 탭이 **disabled** 이고(속성 단언), resolve 후 불리는 콜백은
  **`onExportPremiere`** 다.
- **동기 이중 클릭**: `idle` 에서 같은 act 안에 Export 를 2 회 → preflight 가 **1 회만** 시작된다
- ⚠️ **`persistOptions()` 위치**(라운드 8 Fable F4): 현재 `ExportModal.jsx:246`/`:282`/`:326` 에서
  **발사 직전에만** 저장한다. §4.3 이 그 자리를 재작성하므로 위치를 못 박는다 —
  **공통 `dispatch` 안, 콜백 호출 직전**. 단언: 포함/배제 → `saveSettings` 호출 /
  **취소 → 미호출**. 기존 `ExportModal.test.jsx` 는 23 개 테스트 중 `saveSettings` 단언이 **0 개**라
  이 리팩터가 조용히 떨어뜨리기 쉽다 (뮤테이션 #29).
- **콜백 throw**: 포함 후 콜백이 reject 해도 `phase` 가 풀려 다시 Export 를 누를 수 있다
- 프리미어/Vrew 의 덮어쓰기 `window.confirm` 이 3버튼 모달보다 **먼저** 뜬다

### 7.5 자동화 (§4.5) — 대칭으로
> ⚠️ **하네스 지정**: 기존 `tests/hooks/useMcpServer.test.js` 는 `handleExportConfirm` 을
> **mock 으로 주입**한다 — 그 스타일로는 "exporter 가 받은 개수"를 볼 수 없어 뮤테이션 #1 이 산다.
> `tests/hooks/useMcpServer.export.test.jsx` (신규)에서 **real `useExport` 를 주입**하고
> exporter 를 mock 해 결과 개수를 관찰한다.
- `window.__mcpExportCapcut()` / `__mcpExportPremiere()` 둘 다 pendingWithImage 가 있어도
  **모달 없이** 진행하고, exporter 가 받은 씬 수가 **ready 개수와 정확히 같다**
  (단순히 "옵션이 false 로 전달됐다" 가 아니라 **결과 개수**를 봐야 기본값 뮤테이션이 죽는다)
- `__mcpExportCapcut({ includePending:true })` / `__mcpExportPremiere({ includePending:true })`
  둘 다 실제로 포함해서 진행한다 — **화이트리스트 재구성**(`useMcpServer.js:220`,`:261`)을 무는 테스트
- `tests/mcp-server/toolResponses.test.js` (기존): `handleExportCapcutTool` /
  `handleExportPremiereTool` 이 바디에 `includePending` 을 실어 보낸다
  (⚠️ 기존 3-인자 기대값이 깨지므로 **같이 고쳐야 한다**)
- `mcp-server/index.js` 의 `export_capcut` / `export_premiere` **스키마 두 개 모두**
  `includePending` 을 노출한다

### 7.6 뮤테이션 (커밋 후 실측)
| # | 뮤테이션 (정확한 지점) | 죽어야 하는 테스트 |
|---|---|---|
| 1 | `selectExportScenes` 의 `includePending` **기본 파라미터**를 `true` 로 | **7.2 옵션 생략 호출** (7.5 는 MCP 가 false 를 명시 전달해 못 문다) |
| 2 | 모달 게이트 `> 0` → `>= 0` | 7.4 잔소리 금지 |
| 3 | 실행 경로 3 개 중 하나만 `includePending` 전달 제거 | 7.2 경로별 |
| 4 | 취소 분기를 배제와 동일하게 | 7.4 취소 |
| 5 | `pendingChoice.kind` → 바깥 `exportFormat` | 7.4 포맷 전환 |
| 6a | `phaseRef` → React state 로 환원 | 7.4 동기 이중 클릭 (preflight 호출 **1 회** 단언) |
| 6b | `attemptRef` → React state 로 환원 | 7.4 **외부 닫힘(prop-driven)** 의 `닫기 → 재오픈 → resolve` 순서. ⚠️ v5 는 "stale attempt" 불릿에 짝지었는데 그 픽스처엔 **재오픈이 없어** `isOpenRef` 가 대신 막아 뮤턴트가 산다(라운드 5) |
| 7 | `isOpen=false` effect 의 `++attemptRef` 제거 | 7.4 **외부 닫힘(prop-driven)** |
| 9 | `hasExportAccess` 를 `ready.length > 0` 로 원복 | 7.1 술어 |
| 11 | `App.jsx:2146` 을 `scenes.some(isSceneGenerationDone)` 로 원복 | **7.3 App 배선 테스트** |
| 12 | `selectExportScenes` 를 `ready.concat(pendingWithImage)` 로 | 7.2 원본 순서 보존 |
| 13 | preflight 조기 return/ reject 경로의 `finally` 제거 | 7.4 reject·조기 return 후 **설치확인 2 회째 호출** |
| 14 | **preflight** finally 의 attempt-토큰 가드 제거 | 7.4 `A preflight → 닫기 → 재오픈 → B preflight → A resolve` **후 세 번째 클릭에서 preflight 가 시작되지 않음**. ⚠️ "B 생존"만 단언하면 안 죽는다 — 가드가 없어도 B 는 결국 dispatch 하므로(라운드 5) |
| 15 | 닫기 시 `dispatching` 에서도 `phaseRef='idle'` 로 | 7.4 dispatch 중 닫기 → **원래 콜백이 아직 pending 인 상태에서** 재오픈 → 클릭 → 재진입 불가 |
| 16 | **dispatch finally 에 attempt 가드 추가**(preflight 패턴 복사) | 7.4 **dispatch 중 닫기 → settle → 재오픈 → Export 가 다시 눌린다**. 가드가 있으면 `dispatching` 영구 잠금 (라운드 5 BLOCKER) |
| 17 | 포맷 탭 잠금을 `choosing` 으로만 축소 | 7.4 **preflight 중 포맷 전환** — ⚠️ oracle 은 "프리미어가 발사되지 않는다"가 **아니다**(그건 정답 동작이 아니다). 탭이 **disabled** 이고, resolve 후 **`onExportPremiere` 가 불린다** 두 가지다(라운드 6) |
| 18 | `computeSceneSlots(selectExportScenes(...))` → `computeSceneSlots(scenes)` | 7.2 **슬롯 정합 리터럴**(혼합 픽스처). 개수·ID 단언만으로는 통과한다 |
| 19 | step 4(pending 0)가 공통 `dispatch` 대신 콜백 직접 호출 | 7.4 **pending 없는 평범한 내보내기 → 성공 → 재오픈 → 다시 내보내기 가능** (v5 는 여기서 `dispatching` 에 잠겼다). ⚠️ **변형 B**(phase 전이 없이 직접 호출)는 이 테스트를 통과한다 — 그건 **#15 의 pending-0 픽스처**가 죽인다(라운드 6 F2) |
| 20 | App 이 `ExportModal` 에 카운트 prop 을 안 넘김 | **7.3-a** prop 캡처 리터럴 (기본값 0 이라 다른 테스트는 전부 초록이다) |
| 21 | Vrew 탭에서도 3버튼 모달을 띄움 | **7.3-a(b)** Vrew 는 안 뜬다 (§3.4) |
| 24 | 모달 문구가 `totalSceneCount` 대신 `readyCount + pendingWithImageCount` | **7.3-a(b) 문구 단언** (total=7 / **ready=2** / pending=3 픽스처 — ready 를 4 로 잡으면 공허) |
| 25 | **CapCut 설치확인 fail-open catch(`ExportModal.jsx:319-322`) 뒤의 stale 가드 제거** | 7.4 `닫기 → 재오픈 → 설치확인 **reject**` 순서 (라운드 8 Codex — reject 는 삼켜지고 진행하므로 catch 뒤에도 가드가 필요하다) |
| 26 | **두 번째 await**(`checkFolderExists`) 뒤의 stale 가드 제거 | 7.4 두 번째 await 붙잡고 닫기→재오픈→resolve |
| 27 | 잠금 범위에서 `dispatching` 제외 | 7.4 dispatch 중 버튼·탭 disabled 단언 |
| 28 | 백드롭의 `loading` 가드 제거 | 7.4 dispatch 중 백드롭 클릭 |
| 29 | `persistOptions()` 를 dispatch 밖으로/취소 경로로 이동 | 7.4 포함·배제 → `saveSettings` 호출 / 취소 → 미호출 (라운드 8 Fable F4) |

**개수 정직하게 — 26 종** (v9 기준): Vrew 컷으로 **5 행이 삭제**(구 #8·#10·#22·#25 + 구 #21 대체)되고
라운드 8 에서 **2 행이 추가**(#25 reject-후-가드, #29 persistOptions)됐다.
ID 는 **연속이 아니다** — `#8`·`#10`·`#22`·`#23` 은 Vrew 컷으로 삭제됐다(ID 는 교차 참조가 많아
재번호하지 않는다). 행을 세면 **26**, ID 최댓값은 29 다. 헷갈리면 **행을 센다.**
⚠️ **구현 직전에 표의 `^| ` 행을 기계 계수**해서 이 숫자를 갱신할 것 —
⚠️ **계수를 세 번 연달아 틀렸다** — v5 "13", v6 "19", v7 "22". v7 은 v6 의 틀린 19 에 3 을 더했다.
**행을 기계적으로 세어서** 쓴다. 이 숫자가 뮤테이션 보고서의 **수용 기준**이므로,
틀리면 한둘을 안 돌리고 "전부 killed" 라고 보고하게 된다 — 그게 이 기준이 존재하는 이유다.

**알려진 등가 뮤턴트(의도적으로 원장에서 제외, 라운드 6·7 확인)**:
- `#5` 의 자매 — dispatch 가 `pendingChoice.kind` 대신 모달의 live `format` 을 읽는 변형.
  `#17` 의 잠금이 preflight 부터 format 을 얼려서 **관찰상 등가**다. (`#5` 자체 = 바깥
  `exportFormat` prop 을 읽는 변형은 포맷 전환 테스트로 죽는다.)
- `#19` 변형 B 는 등가가 **아니다** — `#15` 의 pending-0 픽스처가 죽인다(§7.4).

**의도적으로 뺀 것**: "`setPendingChoice(null)` 을 콜백 뒤로 이동" — 동기 flush 하에서 관찰상
동등해 짝지을 테스트가 없다(라운드 2). #6·#13 이 그 자리를 대신한다.

**v4 에서 해소**: v3 가 "뮤테이션으로 못 잡는다"고 선언했던 `App.jsx:2146` 은 App 하네스가
실재하므로 #11 로 **잡는다**(라운드 3).

---

## 8. 변경 파일 목록 (구현 범위 확정)

| 파일 | 변경 |
|---|---|
| `src/services/exportSelection.js` | **신규** — `isReadyExportEligible` / `isPendingExportEligible` / `classifyExportScenes` / **`selectExportScenes`** / `hasExportAccess`. ⚠️ `isRealPath`/`requirePath` 는 **없다**(§3.4 Vrew 컷) |
| `src/hooks/useExport.js` | **로컬 `isExportableScene`(`:21-23`) 삭제** 후 `selectExportScenes` 호출로 대체(재조합 금지). 실행 3 경로(`:199`,`:306`,`:398`)가 `includePending` 수용, Vrew 는 `requirePath:true`; `:59` 가드는 `hasExportAccess` 기준. **dead import 제거**: `hasExportableMedia`(`:14`)·`isSceneGenerationDone`(`:17`) 은 삭제된 술어에서만 쓰였다(`resolveExportVideos`/`getExportFilePaths` 는 유지) — 안 지우면 재조합 재료가 남는다(라운드 5) |
| `src/App.jsx` | `:2146` → `hasExportAccess(scenes)`; `ExportModal` 에 카운트 prop 3 종 전달 |
| `src/components/ExportModal.jsx` | `attemptRef`/`phase`/`pendingChoice` 상태기계, 3버튼 모달, 액션 비활성화, `handleClose` 일원화, `isOpen` 리셋 |
| `src/components/ExportModal.css` | 3버튼 모달 스타일 |
| `src/locales/ko.js`, `src/locales/en.js` | 모달 문구 i18n 키 (없으면 raw key 가 화면에 노출된다) |
| `src/hooks/useMcpServer.js` | `:220-230`, `:261-271` 에 `includePending` 통과 |
| `mcp-server/index.js` | `:584-601` 스키마 2 개에 `includePending` |
| `mcp-server/lib/toolResponses.js` | `:24-28`, `:43-47` 바디 전달 |
| `tests/mcp-server/toolResponses.test.js` | **기존 수정** — 3-인자 기대값이 바디 추가로 깨진다 |
| `tests/hooks/useExport.refresh.test.jsx` | **기존 수정(필수)** — `:224` "pending 상태의 stale imagePath 만 있으면 export 모달을 열지 않는다" 가 `showExportModal === false` + `toast.warning('toast.noGeneratedImages')` 를 단언한다. `staleScene` 은 `status:'pending'` + `imagePath:'/tmp/old.png'` → **새 접근 게이트와 정반대**라 구현 즉시 깨진다. 기대값을 "**모달이 열리고 경고가 없다**"로 바꾼다. 같은 파일의 "confirm 기본 배제" 테스트는 **유지**한다(라운드 6 Codex) |
| `tests/services/exportSelection.test.js` | **신규** |
| `tests/hooks/useExport.pending.test.jsx` | **신규** (renderHook + exporter mock) |
| `tests/components/ExportModal.pendingChoice.test.jsx` | **신규** |
| `tests/components/App.exportAccess.test.jsx` | **신규** — Header mock 이 받은 `hasImages` 단언 |
| `tests/hooks/useMcpServer.export.test.jsx` | **신규** — real `useExport` 주입 + exporter mock |
| `tests/mcp-server/index.schema.test.js` | **신규** — `export_capcut`/`export_premiere` 스키마에 `includePending` |
| `tests/components/Header/ExportButton.gate.test.jsx` | **신규** — `hasImages` prop → 버튼 활성/비활성 계약 (`tests/components/Header/` 디렉터리 실재) |
| `tests/hooks/useExport.gap.test.jsx` | **기존 유지(회귀 그물)** — 버그 B 의 슬롯 배선을 무는 파일이고 `selectExportScenes` 교체가 이걸 깨면 안 된다. done-전용·무미디어 pending 픽스처라 기본값 하에서 green 이 유지돼야 한다(§4.4-a) |

**건드리지 않는다**: `src/hooks/useProjectData.js`(로드 의미론 불변), `src/services/generationStatus.js`,
`src/components/StatusBar.jsx`, `src/exporters/*`(vrewPacker 후속 권고는 §5.4), `electron/main.js`,
`mcp-server/lib/appClient.js`(이미 바디를 받는다).

---

## 9. 리스크

0-b. ⚠️ **Vrew 사용자는 pending 무음 탈락이 그대로 남는다**(§3.4 컷). **오늘과 동일한 동작**이라
   이번 변경이 악화시키는 건 없지만, 후속 별건으로 처리해야 한다. 근본 해소는 `vrewPacker` 의
   base64 지원 또는 실존/가독성 검증이고, **모양 검사(`isRealPath`)로는 닫히지 않는다** —
   네 라운드 연속으로 뚫린 것이 그 증거다.

0-a. ⚠️ **(v9 에서 삭제됨 — `isRealPath` 자체가 사라졌다)** 아래는 기록용.
   ~~`isRealPath` 는 모양 검사이지 실존 검사가 아니다~~(라운드 6).
   `C:\…` / UNC 는 macOS 에서 열리지 않고, 퍼센트 인코딩된 절대경로도 리터럴로 취급돼 ENOENT 다.
   보통은 도달하지 않는다 — `useProjectData.js:117-136` 이 로드 때 `imagePath` 를 로컬 실경로로
   재작성하거나 `null` 로 만든다. **단 하나의 구멍**: `:115` `if (scene.id)` 때문에 **id 없는 씬은
   재작성을 통째로 건너뛴다** → 외래 `project.json` 의 id 없는 pending 씬이 `C:\…` 를 들고
   화이트리스트를 통과하면 mac 에서 Vrew 가 죽는다. 앱이 만든 프로젝트는 항상 id 가 있어
   실현 가능성은 낮다. TOCTOU(검사 후 파일 삭제)도 같은 범주 — **이번 범위 밖**으로 기록만 한다.

0. ⚠️ **포함된 pending 씬의 시각이 불량하면 버그 B 가 무음으로 부활한다**(v6 신설, §4.4-a).
   `computeSceneSlots` 는 all-or-nothing 이라(`sceneSlots.js:34-47`) 포함된 씬 중 하나라도
   `startTime`/`endTime` 이 비유한·역전·겹침이면 **프로젝트 전체가 legacy 폴백**된다 →
   `console.warn` 뿐이라 사용자에게는 무음이고, drift + 마지막 씬 폭주가 되돌아온다.
   사건 프로젝트는 519/519 가 유효해 안전하지만 일반 보장이 아니다.
   **이번 범위에서는 테스트로 고정만 한다**(§7.2 `useSlots` 유지 단언). 사용자에게 알리는
   UI 는 별건 — 다만 그 결정을 기록해 둔다.

1. **속도** — 518 개 씬에 `image_size` 가 없어 `prepareCloudRequest.js:125-137` 이 이미지를 하나씩
   디코드하고 실패 시 1024×1024 폴백(`:145-146`). 눈에 띄게 느려질 수 있다. 기능은 동작하므로
   이번 범위에서 고치지 않고 실측 후 별건.
2. **모달 피로** — 조건을 잘못 잡으면 정상 프로젝트에서도 뜬다. `> 0` + 잔소리 금지 테스트로 방어.
3. **자동화 파손** — MCP 경로에 모달이 새면 `/api/export-capcut` 이 응답을 못 한다.
   §4.3 소유자 배치(구조) + §7.5 전용 테스트로 이중 방어.
4. **포함이 만드는 잘못된 결과물** — 프롬프트를 고쳐 재생성 대기 중인 씬을 "포함"하면 옛 이미지가
   나간다. 모달 문구(§4.2)가 유일한 방어다.
5. **App 게이트 회귀** — `App.jsx:2146` 배선. v3 는 "뮤테이션으로 못 잡는다"고 했으나 **오류였고**,
   §7.3 의 App 배선 테스트 + 뮤테이션 #11 로 **잡는다**. 눈검증은 보조 수단이다.

---

## 10. 리뷰 findings 처리 내역

### 라운드 1
| # | 심각도 | 내용 | 처리 |
|---|---|---|---|
| 1 | MAJOR | 전부-pending 이면 내보내기 버튼이 비활성/미렌더 → §5.1 이 paper fix | §3.3 신설 |
| 2 | MAJOR | 모달 소유자·삽입 지점 미지정 → 자동화 데드락 위험, 포맷 전환/이중 발화/취소 반환값/prop 부재 | §4.3 신설 |
| 3 | MAJOR | `includePending` 이 MCP 로 도달 불가(3중 차단) | §4.5 신설 |
| 4 | MINOR | "네 호출부" 부정확 — `:56` 은 preflight | §2.5 / §4.4 정정 |
| 5 | P2 | Vrew 가 base64 를 파일 경로로 취급 | §5.4 + `requirePath` |
| 6 | P2 | 기존 `useExport.test.js` 가 훅을 import 안 함 → vacuous | §7 서두 경고 |
| 7 | P3 | 앵커 드리프트 | 정정 |

### 라운드 2 (두 리뷰어 독립, MAJOR 3 건 일치)
| # | 심각도 | 내용 | 처리 |
|---|---|---|---|
| 1 | MAJOR | `requirePath` 가 **카운트에만** 걸려 실행 필터엔 없음 → 여전히 paper fix. 게다가 `imagePath` 자체가 data URI 일 수 있어 truthy 검사로는 부족 | §4.1 `isRealPath`, §4.4 Vrew 배선, §5.4 재작성, 뮤테이션 #8·#10 |
| 2 | MAJOR | `ExportModal` 이 항상 마운트라 `pendingChoice` 가 닫기/재오픈을 살아남음(`:185` 는 `return null`). 비동기 preflight(`:230`/`:255`/`:306`)가 닫힌 뒤 resolve 하면 유령 내보내기 | §4.3 `attemptRef`/`phase`/`handleClose`/`isOpen` 리셋, 7.4 닫기·stale·throw 테스트, 뮤테이션 #6·#7 |
| 3 | MAJOR | Header 테스트는 불리언 prop 만 받아 `App.jsx:2146` 뮤테이션을 못 죽임 | 순수 술어 `hasExportAccess` 추출(§4.1·§3.3), 7.1 로 이동, **못 잡는 것은 §7.6·§11 에 정직하게 명시** |
| 4 | P2 | §8 에 로케일·CSS·기존 `toolResponses.test.js` 누락 | §8 보강 |
| 5 | P2 | MCP 테스트 비대칭(프리미어 없음), 기본값 뮤테이션은 **결과 개수**를 봐야 죽음 | §7.5 재작성 |
| 6 | P2 | SRT 단언이 `preserveUnlinked` 로 헐거움 / 관찰 지점(exporter mock) 미지정 | §7 서두 + §7.2 |
| 7 | P2 | "`setPendingChoice` 순서 이동" 뮤테이션은 관찰 불가 | 목록에서 제거, #6 으로 대체 + throw 테스트 |
| 8 | P3 | `main.js:1257/:1277` 은 `if (mainWindow)` 줄, 바디 전달은 `:1258-1260`/`:1279-1281`. `vrew.js:67` 은 조건, `readFile` 은 `:72` | §4.5 · §5.4 정정 |
| 9 | NIT | Export 버튼 disabled 조건은 `loading` 단독이 아님 | §4.3 정정 |
| 10 | NIT | `appClient.js:15` 는 이미 바디를 받음 | §4.5 · §8 명시 |

### 라운드 3 (두 리뷰어 독립, 상태기계 구멍 일치)
| # | 심각도 | 내용 | 처리 |
|---|---|---|---|
| 1 | MAJOR | 외부 닫힘(`App.jsx:3019` 업그레이드)에서 `attemptRef` 미무효화 + step 3 의 `!isOpen` 은 closure 라 죽은 코드 → **paywall 뒤 유령 내보내기** | §4.3 step 3 `isOpenRef`/`attemptRef.current`, step 10 `++attemptRef`, 7.4 prop-driven 닫힘 테스트, 뮤테이션 #7 |
| 2 | MAJOR | preflight 의 reject·조기 return 이 `phase` 를 영구 잠금(`:231` reject, `:243` 거절, `:300` 빈 경로) | §4.3 step 7 전체 try/finally, 7.4 reject·조기 return 재시도, 뮤테이션 #13 |
| 3 | MAJOR | `phase` 가 React state 면 동기 latch 가 아니다 | `phaseRef` 로 전환, 7.4 동기 이중 클릭, 뮤테이션 #6 |
| 4 | MAJOR | `eligible` 미export → 분류기·실행 필터 재조합 여지 | `isPendingExportEligible`/`selectExportScenes` export(§4.1), §4.4 재작성 |
| 5 | MAJOR | **App 하네스는 실재한다** — v3 의 "없다"는 사실 오류(`App.promptBusyLines.test.jsx:360/:416`) | §7.3 App 배선 테스트 신설, 뮤테이션 #11 로 승격 |
| 6 | P2 | `ready.concat(pendingWithImage)` 가 씬 **순서를 뒤집는다** → 자막 rebase 어긋남 | §4.1 filter 강제, 7.2 순서 단언, 뮤테이션 #12 |
| 7 | P2 | `isRealPath` 가 boolean 아님 + http/raw base64 통과 | §4.1 계약 강화, 7.2 (b) data-URI 픽스처, 뮤테이션 #10 |
| 8 | P2 | Vrew 게이트/문구가 default vs pathOnly 미지정 | §4.2 에 `format==='vrew' → pathOnly` 명시 |
| 9 | P2 | stale 테스트가 pending>0 픽스처면 공허 통과 / #7 짝이 handleClose 만 탐 | 7.4 픽스처 고정 + prop-driven 테스트 |
| 10 | P2 | §7.5 하네스가 handler mock 이라 결과 개수 관찰 불가 | 7.5 서두에 real `useExport` 주입 명시 |
| 11 | P3 | 신규 prop 기본값 미지정 → 기존 `ExportModal.test.jsx` 영향 | §4.3 기본값 명시 |
| 12 | P3 | 앵커: 백드롭은 `:335`(`:735` 는 닫는 div, `loading` 가드 있음), base64→`image_path` 는 `:149` | §4.3 · §5.4 정정 |

**두 리뷰어가 일치한 판단**: `donePrompt` 자동 판별 반대, `pending` 만 대상 유지 찬성,
하단 `canExport` 바 비변경 찬성, 자동화 진입점은 CapCut/프리미어 MCP·HTTP 둘뿐,
§2 근본 원인 체인은 흠 없음, §4.5 자동화 절은 라운드 2 기준 완전.

---

## 11. 구현 노트 (라운드 9 대신)

라운드 8 에서 두 리뷰어 모두 **"라운드 9 없이 구현 착수"** 를 권고했다. 근거:
- **설계 구멍은 라운드 5 가 마지막**이었다. 6~8 은 전부 "규칙은 맞는데 그물이 없다"였고,
  그 클래스는 v9 ③ 의 전수 테이블이 구조적으로 닫는다.
- 남은 검증은 **코드-후 뮤테이션 실측**이 진짜 심판이다.

**구현 순서**
1. `src/services/exportSelection.js` + `tests/services/exportSelection.test.js` (§7.1)
2. `useExport` 교체 (§4.4) + `tests/hooks/useExport.pending.test.jsx` (§7.2)
   — ⚠️ 슬롯 정합 리터럴(§4.4-a)과 `useSlots` 유지 단언을 여기서 같이
3. 접근 게이트 (§3.3) + §7.3 / §7.3-a(a)
4. `ExportModal` 상태기계 (§4.3) + §7.3-a(b) / §7.4 — **stale 가드는 `describe.each`**
5. MCP 3 곳 (§4.5) + §7.5
6. 전체 스위트 → **커밋** → 뮤테이션 26 행 실측 → 구현 리뷰 loop

**착수 전 마지막 확인**: §7.6 표의 `^| ` 행을 기계 계수해 26 이 맞는지 본다(네 번 틀렸다).
