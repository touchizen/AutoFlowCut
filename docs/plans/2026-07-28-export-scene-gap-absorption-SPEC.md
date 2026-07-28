# 스펙 — 내보내기: 씬 사이 간격을 앞 씬에 흡수 (2026-07-28)

상태: **v7 — 라운드 5 반영 완료, 라운드 6(확인용) 대기** (구현 착수 전)

> v7 변경 (라운드 5 — 두 리뷰어가 같은 두 건에 수렴 + Codex 1 건 추가):
> ① **누적 길이와 클램프 경계를 분리한다.** v6 은 `durationOf` 하나를 `rebaseSrtTrackToScenes` 의
> **누적과 경계 양쪽**에 썼는데(`srtTrack.js:153/:162/:179`), 그러면 경계가 `start_{i+1}` 이 되어
> 사용자가 duration 을 줄여도 자막이 안 잘린다 → **R13 보호(`srtTrack.rebaseClamp.test.js`)가
> 슬롯 경로에서 소실.** `boundaryOf`(씬 자기 span)를 따로 받는다.
> ② **`srcDur > slot − srcOff` 방어 누락** — 짧은-영상 분기가 오버레이를 슬롯 밖에 놓는다
> (slot 10 / source 50 / video 2 → 끝이 cum+50). `srcDur` 도 캡한다.
> ③ **§4.7 의 "불가피" 는 과장이었다**(Codex) — 검은 filler 세그먼트를 실제로 깔면 수동 duration 을
> 보존할 수 있다. "플랫폼 강제"가 아니라 **"명시적 filler 는 범위 밖이라 hold 를 택함"** 으로 정정.
> ④ `reason` 계약 테스트가 §7.1 에 실제로 없었다(약속만) → 추가.
> ⑤ 앵커·정합 정정: draft JSON 은 **6 개 파일**(2×draft_info + 2×template-2.tmp + 2×.bak),
> `capcut.test.js` 기대값은 `:178` 뿐 아니라 `:197` 에도, §11 이 stale(라운드 4/17 개).

> v6 변경 (실측 1건 — 문서가 아니라 **실험 결과**):
> **(a)"간격을 검은 화면으로" 는 CapCut 이 거부한다.** 실제 CapCut 드래프트에 씬 519 개를
> `startTime`/`duration` 그대로 배치해(구멍 217 개) 열어봤더니, CapCut 이 **구멍을 전부 없애고
> 세그먼트를 앞으로 당겨붙여 저장**했다. → §3 의 (a) 기각 사유가 "어렵다"에서
> **"플랫폼이 거부한다"** 로 바뀐다. §4.7 도 "사용자 결정"에서 **"불가피한 귀결"** 로 확정.

> v5 변경 요약 (라운드 4 — 두 리뷰어가 **다시 수렴**, 최상위 finding 일치):
> ① **긴 영상이 슬롯을 넘친다** — `source_offset` 만큼 시작을 밀면서 `Math.min(video, slot)` 은
> 그대로라 `start + clip > slot` 이 된다(슬롯 0–10 / offset 5 / video 12 → 5–15). **v4 가 스스로
> 만든 회귀** → 상한을 `slot − source_offset` 으로.
> ② **내 라운드 3 의 B3 기각이 틀렸다** — 사용자가 `SceneList` 에서 duration 을 줄이면
> `endTime = startTime + duration`(`SceneList.jsx:136-141`)이 되어 **연결 자막이 씬 끝을 넘는다.**
> 그 케이스의 **기존 회귀 테스트가 실재한다**(`tests/utils/srtTrack.rebaseClamp.test.js`).
> Fable 은 CSV 임포트 경로(`parsers.js:236-330`, 빈 자막 행)도 반례로 제시. → §4.5 재작성.
> ③ **뮤테이션 #17 이 안 죽는다** — 짝지은 7.4 가 함수를 직접 부르고 훅을 안 탄다 → 훅 레벨 단언.
> ④ #9 는 `video < slot` 픽스처 핀 + `src > 0` 용 0/음수 케이스 필요, `source_offset` 방어는
> 테스트·뮤테이션이 아예 없었다.
> ⑤ §8 에 `source_offset` emit / `initialCumulative` 게이트 누락, §9 의 `console.warn` 은 paper claim.
> ⑥ **새로 드러난 결과(사용자 확인 필요)** — §4.7 참고: 슬롯은 **수동 duration 조절을 덮어쓴다.**

> v4 변경 요약 (라운드 3 — **두 리뷰어가 처음으로 갈렸고, 코드로 판정했다**):
> Fable = "GO(문장 3건만)", Codex = "BLOCKER 3건, 착수 불가". 각각을 실코드로 검증한 결과:
> - **Codex B2 채택(진짜 결함)** — 첫 씬은 슬롯이 선두 오프셋을 흡수하는데
>   `videoStartMs = cumulativeTime + (source − video)`(`prepareCloudRequest.js:179-180`)는
>   `cumulativeTime = 0` 에서 계산해 **영상이 `start_0` 만큼 앞으로 밀린다** → §4.2 `source_offset` 신설.
> - **Codex B1(a) 채택(진짜 구멍)** — rebase 옵션 전달을 `useSlots` 로 게이트한다는 명세가 없어
>   폴백 프로젝트에서 `initialCumulative` 가 사이드카를 밀 수 있다 → §4.5 게이트 명시.
> - **Codex B3 기각(도달 불가)** — "자막 줄이 씬 끝을 넘는" 픽스처는 만들어질 수 없다.
>   `useScenes.js:302-306` 이 `endTime = lastLine.endTime` 으로 쓴다. Fable 판정이 옳다.
>   대신 그 **데이터 불변식을 문서화**한다(§4.5).
> - **Codex B1(b) 는 범위 문장 문제**(Fable F5 가 옳다) — `generateSRT` 수정은 의도된 별개 버그픽스라
>   `useSlots` 로 게이트하면 안 된다. "바이트 동일" 주장의 범위를 좁힌다.
> - Fable F1~F4(뮤테이션 #9 등가 뮤턴트, #5 오배치, #10 픽스처, 7.2 누락 단언) 전부 채택.

> v3 변경 요약 (라운드 2, Fable 5 + Codex 독립 — 또 같은 급소 3 건 일치):
> ① **v2 의 "사이드카가 identity 가 된다"는 주장이 첫 씬에서 거짓.** `rebaseSrtTrackToScenes` 는
> `cumulative = 0`(`srtTrack.js:149`)에서 시작하고 씬의 `startTime` 이 아니라 **첫 자막 줄**에
> 앵커한다(`:158`). 첫 씬 자막이 `startTime_0` 만큼 앞당겨진다 → §4.5 를 **이미지용/자막용 슬롯 맵
> 분리**로 재설계.
> ② **`useSlots` 가 겹침을 못 잡는다** — `startTime` 단조증가만 봐서 `end_i > start_{i+1}` 이 통과.
> v2 의 엣지 6("전체 폴백된다")은 거짓이었다 → 술어에 `end_i <= start_{i+1}` 추가.
> ③ **`source_duration` 을 `useSlots` 로 게이트하지 않아** 폴백 프로젝트가 새 배치 경로를 타
> "현행과 바이트 동일" 보장을 깬다.
> ④ **v2 의 `moveScene` 근거가 사실 오류** — `moveScene` 은 `recalculateTimesArr`(`useScenes.js:552`)
> 로 시각을 순차 재작성해 오히려 gapless 가 된다. 가드는 필요하되 진짜 벡터는
> **재배열 후 SRT 재임포트**(`useScenes.js:304-306`).
> ⑤ **CapCut GCF 가 씬을 숫자 ID 로 재정렬한다**(`index.suffixed.js:1004-1009`) → 재배열 프로젝트에
> 대한 폴백 "보장"이 CapCut 에선 성립하지 않는다. 명시적으로 범위 밖 선언.
> ⑥ 레거시 폴백이 `settings.defaultDuration` 을 잃으면 안 된다. 기존 `capcut.test.js` 기대값이 깨진다.
> ⑦ SFX 자동 개선은 **paper claim** 이었다(씬 SFX 는 DTO 에 실리지 않는다). 뮤테이션 #3·#7·#8 보정.

> v2 변경 요약 (라운드 1, Fable 5):
> ① **자막이 두 갈래로 나간다** — GCF 로 가는 `rawSrtTrack`(원본 시각, 정상)과
> `rebaseSrtTrackToScenes` 가 **duration 누적으로 재작성**해 사이드카 `_subtitle_ko.srt` 파일이
> 되는 `project.srtTrack`(붕괴). v1 의 "자막은 안 건드림"은 **후자를 놓친 오판**이었다 → §4.5 신설.
> ② **재배열(`moveScene`) 프로젝트가 회귀한다** — `next.startTime - cur.startTime` 이 큰 **양수**라
> `<= 0` 폴백을 통과해 100 초 정지화면이 된다 → §4.1 단조성 사전검사.
> ③ **씬 단위 폴백이 망원합을 깨서 drift ≠ 0** → 프로젝트 단위 all-or-nothing 폴백.
> ④ `source_duration` 의 NaN / 영상 폴백 체인 미명세 → §4.2 정밀화.
> ⑤ `generateSRT` 폴백(`capcut.js:79-90`)도 어긋난다 → §4.5.
> ⑥ §4.2 와 엣지 7 이 자기모순(자르기 기준) → 줄 단위로 명시.
> ⑦ 산술·앵커·테스트 반증력 정정.
브랜치: `fix/export-pending-scenes-modal` (base `main` @ 4b3742c8)
※ 앞선 스펙(`2026-07-28-export-pending-scenes-modal.md`)과 **별개 버그**다. 파일도 겹치지 않는다
(그쪽은 씬 *선택*, 이쪽은 씬 *배치*). 다만 `useExport.js` 를 둘 다 건드리므로 구현 순서는 조율한다.

---

## 1. 사건

`Untitled` 프로젝트를 CapCut 으로 내보내니 **마지막 씬(`scene_519`)이 타임라인 끝을 통째로 차지**했다.
앱 프리뷰에서 같은 씬은 자막 3 개(8.2 초)뿐이다.

### 실측 (`~/Documents/AutoFlowCut/Untitled/project.json`)

| 항목 | 값 |
|---|---|
| 씬 수 | 519 |
| 씬 `duration` 합계 | **3083.1 s** |
| 실제 콘텐츠 끝(마지막 씬 `endTime` = SRT 끝) | **3166.4 s** |
| **버려지는 간격 총합** | **83.3 s** |
| 오디오 `audio/media/1h normal.wav` | **3167.0 s** (ffprobe) |
| `scene_519` 실제 | start 3158.2 / end 3166.4 / duration **8.2 s** |
| `scene_519` CapCut 결과 | **≈ 92.1 s** (평균 씬 5.9 s 의 16 배) |

이 프로젝트의 씬들은 자막 그룹 사이에 **무음 간격**이 있다. 즉 `sum(duration) ≠ span`.

### 간격 분포 (실측 — 설계 결정의 근거)

| 항목 | 값 |
|---|---|
| 간격 있는 경계 | 216 / 518 |
| 총합 | 83.2 s |
| 평균 | **0.39 s** |
| **최대** | **1.63 s** (2 s 초과 0 건) |
| 분포 | <0.5 s 126 건 / 0.5~1 s 79 건 / 1~2 s 11 건 |

문장 사이 호흡 구간이다. **(b) 로 앞 이미지가 평균 0.39 s 더 머무는 것은 사실상 안 보인다.**

⚠️ 공정하게 적어둔다: **간격에 검은 화면을 두는 것도 유효한 연출 선택이다**(사용자 지적).
문장 사이 짧은 암전을 의도적으로 쓰는 편집 스타일이 있다. 이번에는 (b) 로 결정했지만
**둘 중 하나가 객관적으로 옳은 게 아니라 취향의 문제**이므로, 나중에 설정으로 열 수 있게
남겨둔다 — 예: `settings.gapFill = 'hold' | 'black'`. **이번 범위 밖.**

---

## 2. 근본 원인 (앵커 전부 실측 확인)

1. `buildExportProject`(`src/hooks/useExport.js:136-161`)가 만드는 씬 DTO 에는
   **`startTime` 이 없다.** `image_duration: sceneDuration` 만 보내고
   `sceneDuration = s.duration || settings.defaultDuration || 3`(`:137`).
   → 하류는 간격의 존재 자체를 모른다.
2. `prepareCloudRequest.js` 는 씬을 **연달아 쌓는다**: `cumulativeTime += sceneDuration * 1000`(`:202`).
   `scene.startTime` 은 이 파일 어디에도 쓰이지 않는다.
   → 519 개의 간격이 전부 붕괴해 타임라인이 83.3 s 짧아진다.
3. 자막은 **두 갈래**로 나간다 — v1 이 놓친 지점이다.
   - **(가) CapCut 에 구워지는 자막**: `srtEntries: srtTrackToEntries(project.rawSrtTrack || project.srtTrack)`
     (`prepareCloudRequest.js:387-389`). **원본 절대 시각.** 주석: "SRT/MP3 가 source of truth".
   - **(나) 사이드카 `_subtitle_ko.srt` 파일**: `buildExportProject` 가
     `srtTrack: rebaseSrtTrackToScenes(...)`(`useExport.js:129-133`)로 실은 트랙을
     `generateSRT`(`capcut.js:37-51`)가 읽고 `capcutCloud.js:108-129` 가 파일로 쓴다.
     `rebaseSrtTrackToScenes`(`src/utils/srtTrack.js:135-186`)는 `cumulative += Number(scene.duration)`
     로 **붕괴된 타임라인을 그대로 따라간다** — 함수 주석이 존재 이유를 명시한다:
     *"capcutCloud visual track 은 sequential cumulativeTime 누적으로 만들어지는데 srtTrack 은
     절대 시간을 보존해서 … 자막이 이미지와 어긋남 → export 직전 재작성"*.
   → 이미지 배치를 고치면 **(가)는 맞아떨어지지만 (나)는 홀로 어긋난 채 남는다**(§4.5).
4. GCF 가 부족분을 **마지막 씬 하나에** 얹는다 —
   `whisk2capcut/functions/index.suffixed.js:1108`(`currentTimeUs2 += durationUs`; `:1109` 는
   `totalDuration += durationUs`) 후
   `:1124-1134`:
   `totalDuration = max(sceneSum, srtEnd, audioDuration)` 후
   `if (totalDuration > sceneDurationUs) lastSeg.target_timerange.duration += gap`.
   여기선 `max(3083.1, 3166.4, 3167.0) = 3167.0` → **gap 83.9 s 가 `scene_519` 에**.

### 어긋남 프로파일 (실측)

| 씬 | 앱 시작 | 내보내기 시작 | 어긋남 |
|---|---|---|---|
| scene_50 | 294.2 s | 284.8 s | −9.4 s |
| scene_100 | 621.2 s | 605.8 s | −15.4 s |
| scene_300 | 1837.3 s | 1786.0 s | −51.3 s |
| scene_500 | 3021.2 s | 2940.3 s | −80.8 s |

**긴 마지막 씬은 증상이고, 진짜 문제는 후반부 전체가 내레이션보다 최대 1 분 넘게 앞선다는 것이다.**

### 왜 지금까지 안 드러났나
씬이 빈틈없이 이어진 프로젝트(`무한야담ep03` 186 씬, `야담02` 152 씬)는
`sum(duration) == span` 이라 이 경로가 무해하게 동작한다. 이번 프로젝트만 간격이 크다.

---

## 3. 결정 — (b) 간격을 앞 씬에 흡수

사용자 선택. 대안과 기각 사유:

| 안 | 판정 |
|---|---|
| (a) 씬을 `startTime` 기준으로 배치, 간격은 빈 화면 | **실측 기각 — CapCut 이 트랙 구멍을 허용하지 않는다**(§3.1). GCF 수정 여부와 무관하게 불가능 |
| **(b) 앞 씬 길이가 다음 씬 시작까지 늘어난다** | **채택.** 앱 한 곳 수정, **GCF 무수정**. 무음 구간은 앞 이미지가 유지 |
| (c) 마지막 씬 연장에 상한 | 증상만 가림. 어긋남 그대로. 기각 |

### 3.1 (a) 기각 근거 — CapCut 실측 (2026-07-29)

추측이 아니라 **실제 CapCut 드래프트로 실험**했다.

- 버그 산출물 드래프트(씬 519 개가 0 부터 빈틈없이 붙고 마지막 씬이 91.5 s 로 부푼 것)를 복사해,
  비디오 세그먼트 519 개를 전부 **실제 `startTime` / `duration`** 으로 재배치했다
  (구멍 217 개, 총 83.3 s, 최대 1.63 s, 마지막 씬 8.2 s).
- CapCut 에서 열었더니 **구멍이 하나도 남지 않았다.** CapCut 이 저장한 파일:

| | 넣은 값 | CapCut 이 저장한 값 |
|---|---|---|
| 앞 3 개 | 0.10~5.80 / 5.83~11.87 / 11.87~16.63 | **0.00~5.70 / 5.70~11.73 / 11.73~16.50** |
| 구멍 | 217 개 (83.3 s) | **0 개** |
| 마지막 씬 | 3158.2~3166.4 | **3074.9~3083.1** |
| 비디오 트랙 끝 | 3166.4 s | **3083.1 s** (꼬리 83.3 s 공백) |

- 마지막 씬 **길이 8.2 s 는 보존**됐다 → CapCut 이 이 파일을 **읽은 것이 맞다**(읽지 않았다면
  원래의 91.5 s 가 남았을 것). 즉 실험은 유효했고, 결론은 **CapCut 이 구멍을 당겨붙인다** 이다.

**따라서 간격을 "무엇으로 채울지"는 선택이 아니라 강제다.** 채우지 않으면 CapCut 이 스스로
당겨붙이고, 그 누적이 정확히 이번 사건의 drift 다. 현행 버그는 "간격을 잘못 처리한 것"이 아니라
**"간격을 처리하지 않은 것"** 이다.

**실험 부산물(구현 시 유의)**: CapCut 드래프트는 같은 JSON 을 **네 곳**에 들고 있다 —
`draft_info.json`, `Timelines/<UUID>/draft_info.json`, `.../template-2.tmp`, `.../draft_info.json.bak`.
정확히는 **6 개 파일**이다 — 위 넷에 더해 `.bak` 이 두 벌(root/timeline). 내용이 동일한 짝은
`draft_info.json` ×2, `template-2.tmp` ×2, `.bak` ×2 이다.
첫 시도에서 위쪽 하나만 고쳐 실험이 무효가 됐다. 이 스펙은 **요청(request)** 을 고치므로 해당
없지만, 나중에 드래프트 후처리를 검토한다면 반드시 네 곳을 맞춰야 한다.

**프리미어는 구멍을 지원한다** — 이론상 프리미어만 (a) 가 가능하지만, 같은 프로젝트가 포맷마다
다른 타임라인이 되고 작업량이 두 배다. 평균 간격 0.39 s 대비 **일관성이 더 값지다** → 세 포맷 모두 (b).

**핵심 성질 1 — 배치는 (a) 와 완전히 동일하다.** `slot_i = start_{i+1} - start_i` 를 누적하면
`cum(i) = start_i` 가 되어 **모든 씬이 자기 `startTime` 에 정확히 시작한다. drift = 0.**
(a) 와 (b) 는 씬 시작 시각이 한 프레임도 다르지 않다 — 차이는 **간격에 무엇이 보이는가** 뿐이다.
(a) 가 추가로 어려운 이유는 오직 하나: GCF 에 **씬별 시작 시각 입력이 없다**
(`whisk2capcut/functions/index.suffixed.js:1109` 이 `currentTimeUs2 += durationUs` 로 누적만 한다)
→ 두 GCF 에 필드와 배치 로직을 새로 넣어야 한다. (b) 는 앱 한 곳으로 같은 결과를 얻는다.

**핵심 성질 2 — 간격 없는 프로젝트에선 no-op.** `next.startTime - startTime === duration` 이므로
산출물이 바뀌지 않는다. 기존 정상 프로젝트 무영향의 근거이고, 테스트로 고정한다.

---

## 4. 설계

### 4.1 슬롯 길이 계산 (`buildExportProject` 내부)

`validScenes` 는 이미 시간순이라고 가정하지 **않는다** — `startTime` 으로 판단한다.

```
slotDuration(i) =
  i < n-1 ?  next.startTime - cur.startTime          // 다음 씬 시작까지 늘린다
          :  cur.endTime - cur.startTime             // 마지막 씬은 자기 끝까지

첫 씬은 예외: cur.startTime 을 0 으로 간주한다(선두 오프셋 흡수).
  → slotDuration(0) = next.startTime - 0
```

**폴백 — 반드시 프로젝트 단위 all-or-nothing 이다 (씬 단위 아님).**

```
useSlots(validScenes) =
  ∀ 씬: startTime/endTime 이 유한하고, startTime >= 0, endTime > startTime
  && ∀ 인접쌍: startTime_i < startTime_{i+1}          (단조증가)
  && ∀ 인접쌍: endTime_i <= startTime_{i+1}           (겹침 금지 — v2 누락)
  && ∀ slotDuration: 유한하고 > 0
  → true (슬롯 사용)
  아니면 → false (전 씬이 레거시 값, 현행과 바이트 단위로 동일)

레거시 값 = `s.duration || settings.defaultDuration || 3`  (useExport.js:137 의 식 그대로.
  raw `s.duration` 만 쓰면 duration 없는 씬에서 undefined 가 되어 현행과 달라진다 — 라운드 2)
```

**겹침 금지 항이 왜 필요한가**: 단조증가만으로는 `A(0–10), B(5–8)` 이 통과한다.
그러면 `slot(A) = 5` 인데 `source_duration(A) = 10` 이라 `source > slot` 이 되고,
`prepareCloudRequest.js:180` 이 2 초 영상을 `cum + (10−2) = 8s` 에 놓아 **A 의 슬롯(5s)을 벗어나
다음 씬 화면을 덮는다**. `rebase` 의 `sceneBoundary` 클램프도 어긋난다.

왜 씬 단위면 안 되나:
- **① 큰 양수 슬롯이 가드를 통과한다.** `<= 0` 만 막으면 `[A(0–5), C(100–105), B(5–10)]` 같은
  배열에서 `slot(A) = 100 s` 가 되어 **100 초 정지화면**이 된다.
  ⚠️ **v2 는 이 벡터를 `moveScene` 이라고 썼는데 사실 오류다**(라운드 2). `moveScene`
  (`src/hooks/useScenes.js:545-553`)은 `recalculateTimesArr` 를 호출해 시각을 **순차 재작성**하므로
  오히려 gapless·단조가 된다. 진짜 벡터는 **재배열된 배열에 SRT 를 재임포트**하는 경로다 —
  `useScenes.js:300-307` 이 `firstLine.startTime` / `lastLine.endTime` 을 그대로 써넣고
  순차 재계산을 하지 않는다. 테스트 픽스처도 이 모양이어야 한다.
- **② 씬 단위 폴백은 망원합을 깬다.** 씬 k 가 폴백하면
  `cum(k+1) = start_k + duration_k ≠ start_{k+1}` 이 되고, 이후 슬롯은 여전히
  `start_{i+1} − start_i` 라 **흡수 못 한 간격만큼 이후 전 씬이 영구히 이르다**.
  즉 "drift = 0" 이 성립하지 않는다. §7.1 의 불변식(합 = 마지막 `endTime`)도 조용히 깨진다.

**따라서 `drift = 0` 은 `useSlots === true` 일 때의 성질이다.** false 면 현행 동작(= 기존 버그)이
그대로이며, 그건 의도된 안전한 후퇴다.

### 4.2 ⚠️ 부작용 둘 — 영상 오버레이

`sceneDuration` 을 그대로 늘리면 **영상 오버레이가 망가진다.** 두 곳이 이 값을 쓴다:

1. `useExport.js:141` — `duration: v.duration || sceneDuration || 0`
   → 자체 길이가 없는 영상이 **무음 구간까지 늘어난다**.
2. `prepareCloudRequest.js:178-181` — 영상이 씬보다 짧으면 **씬 뒤쪽**에 배치:
   `videoStartMs = cumulativeTime + (sceneDuration - videoDuration) * 1000`
   → 슬롯이 늘어나면 짧은 영상이 **무음 구간으로 밀려난다**(발화 구간에 있어야 하는데).

**해결**: 두 값을 분리해서 보낸다.

| 필드 | 의미 | 쓰는 곳 |
|---|---|---|
| `image_duration` | **슬롯** 길이(간격 흡수) | 이미지 세그먼트, `cumulativeTime` 누적 |
| `source_duration` (신규) | 씬 **자기** 길이(`endTime - startTime`) | 영상 오버레이 길이·배치 |
| `source_offset` (신규) | 슬롯 시작부터 **발화 구간 시작까지의 거리** | 영상 오버레이 배치 |

**`source_offset` 이 왜 필요한가 (라운드 3 Codex BLOCKER)**: 첫 씬만 슬롯이 선두 오프셋을
흡수하므로(§4.1), 슬롯 안에서 발화 구간이 `start_0` 만큼 뒤에서 시작한다.
`source_offset(i) = (i === 0 ? start_0 : 0)`.
없으면 첫 씬 영상이 `start_0` 만큼 앞으로 밀린다 — 앞 씬들이 필터로 빠지면 오차가 커진다.

**emit 규칙(중요)**: `source_duration` 은 **`useSlots === true` 이고** 유한하고 > 0 일 때만
내보낸다. 아니면 **필드를 생략**한다.
⚠️ `useSlots` 게이트가 없으면, 폴백 프로젝트(전체 폴백)인데도 시각이 멀쩡한 씬들이
`source_duration` 을 달고 나가 `:179-180` 이 새 배치 경로를 타 **"현행과 바이트 단위로 동일"
보장이 깨진다**(`s.duration ≠ endTime−startTime` 인 사용자 편집 프로젝트에서 실제로 갈린다).
소비자 쪽도 방어한다: `prepareCloudRequest` 는 `Number.isFinite(src) && src > 0` 일 때만 쓰고
아니면 슬롯으로 폴백한다(`??` 만으로는 `NaN`/`Infinity` 를 못 막는다 — 라운드 2).
`s.endTime - s.startTime` 을 무조건 넣으면 비-SRT 프로젝트에서 **NaN** 이 되는데,
NaN 은 nullish 가 아니라 `?? image_duration` 이 **폴백하지 않고** 그대로 하류로 흘러
capcut GCF 의 `Math.round(overlay.durationMs * 1000)`(`index.suffixed.js:1160`, `:1197`)에서
**깨진 draft** 를 만든다(라운드 1 지적).

**`prepareCloudRequest.js:178-181` — 줄 단위로 못 박는다** (v1 은 §4.2 와 엣지 7 이 모순이었다):

| 줄 | 표현식 | 쓰는 값 | 이유 |
|---|---|---|---|
| `:178` | `Math.min(videoDuration, ???)` | **`slot − source_offset`** | 영상이 슬롯을 넘으면 안 된다. **`slot` 만 쓰면 offset 만큼 다음 씬을 덮는다** — v4 가 만든 회귀(라운드 4 두 리뷰어 일치) |
| `:179` | `videoDuration < ???` | **`source_duration`** | "짧은가"의 기준은 발화 구간 |
| `:180` | `cumulativeTime + ??? + (??? - videoDuration)` | **`source_offset`** + **`source_duration`** | 뒤쪽 배치가 무음으로 밀리면 안 되고, 첫 씬은 발화 구간 시작부터 재야 한다 |
| `:181` | `else cumulativeTime` (영상이 길면 처음부터) | **`cumulativeTime + source_offset`** | 같은 이유 |

- **불변식**: `startMs + clipDuration <= cumulativeTime + slot`.
  `clip = Math.min(video, slot − srcOff)` 만으로는 **부족하다** — 짧은-영상 분기의 시작이
  `cum + srcOff + (srcDur − video)` 라서 `srcDur` 가 크면 슬롯을 벗어난다
  (예: slot 10 / srcOff 0 / **srcDur 50** / video 2 → 끝이 `cum + 50`. 라운드 5 두 리뷰어 일치).
  → **`srcDur` 도 캡한다**: `srcDur = Math.min(srcDur, slot − srcOff)`.
  `srcOff >= slot` 인 요청은 `srcOff = 0` 으로 강등한다.
  앱이 emit 하는 값은 `useSlots` 술어(`end_i <= start_{i+1}`)가 이미 `srcOff + srcDur <= slot` 을
  보장하므로 이 캡은 **구형·잘못된 요청 방어용**이다.
- 구형 요청 하위호환 + 방어:
  `const srcDur = Number.isFinite(scene.source_duration) && scene.source_duration > 0 ? scene.source_duration : sceneDuration`
  `const srcOff = Number.isFinite(scene.source_offset) && scene.source_offset >= 0 ? scene.source_offset : 0`
  (`??` 만으로는 `NaN`/`Infinity` 를 못 막는다.)
- **`useExport.js:141` 영상 길이 폴백 체인**: `v.duration || sourceDuration || slotDuration`.
  v1 처럼 `v.duration || source_duration || 0` 로 두면 폴백 씬(startTime 없음 → source 없음)의
  자체 길이 없는 영상이 **0** 이 되어 `prepareCloudRequest.js:174` 의 `videoDuration <= 0 continue`
  에서 **오버레이가 통째로 사라진다**(현행은 3 s 를 받는다).
- GCF 로 가는 `cloudScenes[].duration` 은 **슬롯 길이**다.

### 4.3 효과

- 씬 합계: 3083.1 s → **3166.4 s** (= 마지막 `endTime`. 첫 씬 0.1 s 흡수 포함)
- GCF 의 `totalDuration = max(3166.4, 3166.4, 3167.0) = 3167.0` → 마지막 씬 연장분 **0.6 s**
  (기존 83.9 s). 마지막 씬 8.2 s → 8.8 s.
- 어긋남: 모든 씬에서 **0**.
- **GCF 는 손대지 않는다.** 연장 로직은 그대로 두되 실질적으로 발동하지 않는다.

### 4.4 적용 범위

`buildExportProject` 는 CapCut(`:218`) / 프리미어(`:320`) / Vrew(`:411`) **셋 다** 쓴다.
→ 세 경로 모두 자동 적용. 이게 의도다(같은 프로젝트가 포맷마다 다르게 나가면 안 된다).
GCF 쪽도 셋 다 같은 누적 패턴이라 슬롯이 그대로 흐른다 (라운드 1 실측 확인):
`whisk2premiere/functions/src/premiereExport.js:1035-1087`,
`exportToVrew/functions/src/vrewExport.js:83-88, 178-182`.

### 4.5 ⚠️ 사이드카 SRT (v3 재설계 — 라운드 2 BLOCKER)

§2.3 의 **(나)** 갈래. 이미지 배치만 고치면 사이드카 SRT 만 홀로 어긋난다.

**v2 의 설계는 틀렸다.** "슬롯 맵 하나를 `durationOf` 로 넘기면 identity 가 된다"고 썼는데,
`rebaseSrtTrackToScenes` 의 실제 동작이 다르다 (두 리뷰어가 각각 실측):

- `srtTrack.js:149` — `let cumulative = 0` 에서 시작한다.
- `srtTrack.js:158` — `originalStart = Number(sceneLines[0].startTime)` — 씬의 `startTime` 이 아니라
  **그 씬의 첫 자막 줄 시각**에 앵커한다.

그래서 이미지용 슬롯 맵(첫 씬 선두 오프셋을 흡수하는 것)을 그대로 먹이면
`absStart(첫 줄) = 0 + (line.start − start_0) = line.start − start_0` —
**첫 씬 자막 전체가 `start_0` 만큼 앞당겨진다.** 이번 프로젝트는 0.1 s 지만, 인트로 무음이 긴
프로젝트에서는 수 초까지 커지고 상한이 없다. 오디오와 (가) 갈래 자막은 원본 시각이므로 어긋난다.

**v3 설계 — 슬롯 맵을 두 벌 만든다.**

| 맵 | 첫 씬 | i ≥ 1 | 쓰는 곳 |
|---|---|---|---|
| `imageSlots` | `start_1 − 0` (**선두 흡수**) | `start_{i+1} − start_i` | `image_duration`, `cumulativeTime` |
| `srtSlots` | `start_1 − start_0` (**흡수 안 함**) | 동일 | `rebaseSrtTrackToScenes` |

그리고 rebase 에 **`initialCumulative = start_0`** 를 넘긴다.

```
rebaseSrtTrackToScenes(srtTrack, scenes,
    { preserveUnlinked, durationOf, boundaryOf, initialCumulative })

  // :149  let cumulative = 0
  //   →   let cumulative = Number(initialCumulative) || 0
  //
  // 누적용 길이 (:153 의 sceneDuration 이 :178-183 누적에 쓰이는 자리)
  //   advance = Number(durationOf ? durationOf(scene) : scene?.duration) || 0
  //
  // ⚠️ 클램프 경계는 **별도 값** (:162-164)
  //   span    = Number(boundaryOf ? boundaryOf(scene) : scene?.duration) || 0
  //   sceneBoundary = span > 0 ? cumulative + span : Infinity
```

⚠️ **v6 은 이 둘을 한 값으로 묶어 R13 보호를 잃었다**(라운드 5, 두 리뷰어 일치).
슬롯을 경계에도 쓰면 경계가 `start_{i+1}` 이 되어, 사용자가 duration 을 줄여도(`endTime` 만 앞당겨짐)
자막이 안 잘린다 — `tests/utils/srtTrack.rebaseClamp.test.js` 가 요구하는 동작이 **프로덕션 경로에서만
사라진다**(그 테스트는 옵션 없이 직접 호출하므로 계속 초록 = paper fix).

**호출부가 넘기는 값**:
- `durationOf` → `srtSlots[i]` (누적: `cumulative` 가 `start_i` 로 텔레스코핑)
- `boundaryOf` → `endTime_i − startTime_i` (경계: 씬 **자기** span. 수동으로 줄이면 그만큼 줄어든다)

identity 는 그대로다 — 불변식을 만족하는 씬은 `lastLine.endTime === endTime_i` 라
`absEnd ≤ cumulative + span` 이 되어 클램프가 no-op 이다.

이러면 `cumulative` 가 `start_0` 에서 시작해 `start_i` 로 텔레스코핑하고,
`absStart = start_i + (line.start − originalStart) = line.start` → **모든 씬에서 정확히 identity**.

**왜 "슬롯일 땐 rebase 를 건너뛰기"로 하면 안 되나**: 재배열 후 `recalculateTimesArr` 를 거친
프로젝트는 씬 시각이 **합성 순차값**인데 `srtTrack` 은 원본 절대 시각을 유지한다 — 그 경우
rebase 가 실제로 일을 한다. 건너뛰면 그쪽이 깨진다(라운드 2 지적).

⚠️ **`useSlots === false` 면 두 옵션을 아예 넘기지 않는다**(라운드 3 Codex BLOCKER).
게이트가 없으면 폴백 프로젝트(예: 재임포트로 `[C(100–105), A(0–5)]`)에서 `initialCumulative = 100`
이 전달돼 **현행 0 초에서 시작하던 사이드카가 100 초에서 시작한다** — "현행과 바이트 동일" 위반.
`durationOf` / `initialCumulative` 미전달 시 현행과 동일. **프로덕션 호출부는
`useExport.js:129` 하나뿐**이다.

⚠️ **identity 는 조건부다 — 라운드 3 의 "만들 수 없다"는 오판이었다(라운드 4 정정).**

identity 가 성립하려면 `scene.startTime === 첫 연결 자막 줄 startTime` 이고
`scene.endTime === 마지막 연결 자막 줄 endTime` 이며,
**연결된 모든 줄이 `[startTime, endTime]` 안에 있어야** 한다.
(첫/마지막 조건만으로는 부족하다 — CSV 의 순서 뒤섞인 행 `[0–10, 2–5]` 이 씬 `0–5` 를 만들면
첫·마지막 조건은 만족하지만 첫 줄이 클램프된다. 라운드 5 지적.)
SRT 임포트/재임포트 경로는 이걸 세우지만(`useScenes.js:302-306`), **위반 경로가 최소 둘 실재한다**:

1. **사용자의 duration 조절** — `SceneList.jsx:136-141` 이 `endTime = startTime + duration` 으로
   덮어쓴다. 자막 줄 시각은 그대로라 **연결 자막이 씬 끝을 넘는다.**
   이 케이스의 **기존 회귀 테스트가 실재한다**: `tests/utils/srtTrack.rebaseClamp.test.js`
   ("사용자가 3 s 로 줄임" → 5 s 자막을 클램프). 이 보호는 **깨면 안 된다.**
2. **CSV 임포트** — `src/utils/parsers.js:236-330`. 빈 자막 행이 그룹 경계는 만들지만 자막 줄은
   안 만들어 `scene.startTime ≠ firstLine.startTime` 이 될 수 있고, 행이 시간순이 아니면
   `scene.endTime < lastLine.endTime` 이 된다. `parseFromCSV` 는 순차 재계산을 건너뛴다
   (`useScenes.js:231-234`).

**결정**: `useSlots` 를 확장해 전체 폴백시키지 **않는다**(과잉 — 이미지 타임라인은 멀쩡하고 피해가
해당 씬 사이드카로 한정된다). 대신:
- **identity 는 "위 불변식이 성립하는 씬에 한해" 성립한다**고 범위를 좁혀 명시한다.
- 불변식이 깨진 씬에서는 **기존 `sceneBoundary` 클램프 동작이 그대로 유지된다**
  (`srtTrack.js:175`). 슬롯 하에서 경계는 `start_i + srtSlot_i = start_{i+1}` 이므로
  **"다음 씬 이미지 위로 자막이 넘지 않는다"는 R13 의 원래 목적은 계속 달성된다.**
- §7.4 는 identity 테스트와 **클램프 유지 테스트를 분리**한다.

**`generateSRT` 폴백도 같은 병** — `src/exporters/capcut.js:79-90` 은 `image_duration` 을 누적하되
**영상이 있는 씬은 `video.duration || 5` 로 대체**한다 → 영상 씬을 지날 때마다 다시 어긋난다.
누적은 **항상 슬롯**으로 한다.
- 부수 효과(라운드 2): **EN 사이드카는 항상 이 폴백 경로를 탄다**(`capcut.js:37` 의 srtTrack 분기는
  ko 전용, `capcutCloud.js:129`) → 이 수정이 `_subtitle_en.srt` 도 같이 고친다.
- 기존 `tests/exporters/capcut.test.js:178` 이 "영상 길이/기본 5 s" 를 기대하므로 **같이 고쳐야 한다**.

**ko 사이드카는 조건부다**(라운드 2): `capcutCloud.js:117` 이 `audioPackage.srtContent` 를 우선한다.
그 경로에서는 rebase 결과가 안 쓰이므로 이 수정의 영향도 없다. 테스트 픽스처는 `audioPackage` 없는
경로로 잡는다.

⚠️ **`generateSRT` 수정은 `useSlots` 로 게이트하지 않는다**(라운드 3 판정). 영상 씬에서
`video.duration` 을 누적하는 건 슬롯과 무관하게 **그 자체로 버그**다. 따라서 이 수정은
gapless·폴백 프로젝트의 사이드카 출력도 바꾼다 — **의도된 별개 버그픽스**이며
§4.1 의 "바이트 동일" 보장 범위는 **슬롯/cloudRequest 경로에 한정**된다.
(기존 `tests/exporters/capcut.test.js:177+` 기대값이 깨지는 게 그 증거다.)

**결정 정정(v2 오류)**: v2 는 "자막 end 가 `start + 슬롯`까지 늘어나 간격 동안 유지된다"고 썼는데,
srtTrack 경로는 `Math.min` 클램프만 하고 **늘리지 않는다**(`:175`). identity 와 양립 불가다.
→ **srtTrack 경로: 자막은 원본 길이 그대로**(간격 동안 자막 없음, (가) 갈래와 일치).
   **generateSRT 폴백 경로: 자막이 슬롯 전체를 덮는다**(그 함수의 기존 성질).

### 4.7 확정 — 슬롯이 **수동 duration 조절을 덮어쓴다** (v5 신설 / v6 확정)

라운드 4 조사 중 드러났고 **두 리뷰어 모두 명시하지 않은** 결과다.
**v6 에서 "불가피한 귀결"로 확정**했다(§3.1 실측) — 사용자 결정 사항이 아니다.

`SceneList` 의 duration 입력(`SceneList.jsx:134-146`)은 `duration` 과 `endTime` 만 바꾸고
**다음 씬의 `startTime` 은 건드리지 않는다.** 그런데 슬롯은 `next.startTime − cur.startTime` 이므로,
사용자가 어떤 씬을 5 s → 3 s 로 줄여도 **슬롯은 여전히 5 s** 다.

| | 현행 | 슬롯 적용 후 |
|---|---|---|
| 씬 A 를 5 s → 3 s 로 줄임 | 타임라인이 2 s 짧아지고 **뒤 씬이 전부 당겨진다** | 타임라인 불변. **A 가 여전히 5 s 구간을 차지**한다(뒤 2 s 는 A 이미지 유지) |

이건 (b) 의 정의상 **불가피하다** — "씬 시작이 `startTime` 에 정확히 맞는다"와 "수동 duration 이
타임라인을 줄인다"는 동시에 성립할 수 없다. SRT 가 타임라인의 source of truth 가 되기 때문이다.

**해석**: 수동 duration 은 이제 "이미지가 몇 초 보이나"가 아니라 "발화 구간이 어디까지인가"
(=`source_duration`, 영상 오버레이 배치 기준)를 뜻하게 된다.

**근거(§3.1) — 단, "불가피"는 과장이었다(라운드 5 정정)**:
씬 A 를 5 s → 3 s 로 줄이면 2 s 가 비는데 **CapCut 에서 그 구간은 빌 수 없다**(§3.1 실측).
무언가로 채워야 하고, 이번 범위에서 쓸 수 있는 수단은 앞 이미지(=A)뿐이다.
현행은 그 2 s 를 **삭제**해 뒤 씬을 전부 당기고(= drift 유발), (b) 는 A 로 채운다.

⚠️ 엄밀히 말하면 **검은 이미지 filler 세그먼트를 실제로 깔면** 수동 duration 과 다음 `startTime` 을
둘 다 보존할 수 있다(구멍이 아니라 실제 세그먼트이므로 CapCut 이 압축하지 않는다).
그건 §1 이 미래 옵션으로 남긴 `gapFill='black'` 이고 **이번 범위 밖**이다
(검은 PNG 에셋을 217 구간에 깔아야 하고 미디어 관리·용량이 붙는다. 평균 간격 0.39 s 대비 과하다).
→ 따라서 이건 **"플랫폼이 강제한 불가피"가 아니라 "명시적 filler 를 범위 밖으로 두어 hold 를 택한
결정"** 이다. 사용자 승인 완료.

### 4.6 범위 밖 — CapCut GCF 의 씬 재정렬 (v3 신설)

`whisk2capcut/functions/index.suffixed.js:1004-1009` 이 씬을 **숫자 ID 로 재정렬**한 뒤 누적한다:

```js
const sortedScenes = [...scenes].sort((a, b) =>
  parseInt(String(a.id).replace('scene_','')) - parseInt(String(b.id).replace('scene_','')))
```

따라서 **사용자가 씬 순서를 바꾼 프로젝트는 CapCut 에서 어차피 ID 순으로 되돌아간다.**
이건 이 스펙 이전부터 있던 동작이고 이번 변경과 무관하다.
→ §4.1 의 전체 폴백은 "현행 동작 유지"를 보장하지만, **CapCut 의 순서 자체를 보장하지는 않는다.**
재배열 프로젝트의 CapCut 순서 문제는 **명시적으로 범위 밖**으로 선언한다(별건).
훅 테스트가 exporter 에 `[1,3,2]` 가 전달됐음을 단언해도 CapCut 최종 순서는 검증하지 못한다.

---

## 5. 엣지 케이스

1. **간격 없는 프로젝트** — `next.startTime - startTime === duration` → 산출물이 현행과 동일해야 한다(회귀 테스트).
2. **`startTime` 없는 프로젝트** — 전부 폴백 → 현행과 동일.
3. **씬 하나뿐** — 마지막-씬 규칙과 선두 흡수가 충돌한다(라운드 2 지적).
   **선두 흡수가 이긴다**: `imageSlot(0) = endTime_0 − 0`(= `endTime_0`), `srtSlot(0) = endTime_0 − start_0`.
   그래야 §7.1 의 불변식(이미지 슬롯 합 = 마지막 `endTime`)이 성립한다.
4. **첫 씬 `startTime > 0`** (여기선 0.1 s) — 0 으로 간주해 흡수. 안 그러면 전체가 0.1 s 어긋난다.
5. **필터로 빠진 씬** — `validScenes` 기준으로 "다음 씬"을 잡는다. 빠진 씬 구간까지 앞 이미지가
   유지되는 게 맞다(빈 화면 방지). §6 의 pending 스펙과 상호작용하는 지점이라 테스트로 고정한다.
6. **`endTime` 이 다음 씬 `startTime` 보다 큼**(겹침) — `end_i <= start_{i+1}` 항 위반 →
   **프로젝트 전체 폴백**. (v2 는 이 항이 술어에 없어 실제로는 통과했다 — 라운드 2 BLOCKER.)
7. **영상 오버레이가 슬롯보다 길다** — 슬롯 길이에서 잘린다(`Math.min`, §4.2 `:178`).
8. **재배열 후 SRT 재임포트된 프로젝트** — `startTime` 이 배열 순서와 어긋남 → **전체 폴백**(§4.1).
   현행 동작 유지. (`moveScene` 단독은 `recalculateTimesArr` 로 순차 재작성되어 오히려 gapless 다.)
   단 CapCut 최종 순서는 §4.6 참고 — GCF 가 ID 로 재정렬한다.
9. **제외된 씬의 자막·오디오** — 엣지 5 로 앞 이미지가 유지되는 동안, 그 씬의 자막((가) 갈래,
   `rawSrtTrack`)과 오디오는 **계속 재생된다**. (b) 철학과 일관되지만 명시적 결정으로 기록한다.

---

## 6. 다른 스펙과의 관계

`2026-07-28-export-pending-scenes-modal.md` 와 **같은 함수(`buildExportProject`)를 건드린다**.
- 그쪽: 어떤 씬이 `validScenes` 에 들어가는가 (선택)
- 이쪽: `validScenes` 안에서 각 씬이 얼마나 차지하는가 (배치)
충돌하지 않지만 **엣지 5**(필터로 빠진 씬의 간격 처리)에서 만난다. 구현은 **이 스펙을 먼저**
하는 편이 낫다 — 더 작고, pending 스펙의 테스트가 이 동작 위에 얹히기 때문.

---

## 7. 테스트 계획 (TDD — 실패 테스트 먼저)

> 관찰 지점: exporter 를 `vi.mock` 하고 **`exportCapcut` 이 받은 `project.scenes[]`** 를 단언한다.
> `buildExportProject` 는 훅 내부 함수라 직접 못 본다.
> 훅은 `renderHook(useExport)` 로 실제로 돌린다 (참고: `tests/hooks/useExport.refresh.test.jsx:53`).
> ⚠️ 기존 `tests/hooks/useExport.test.js` 는 훅을 import 조차 하지 않는다(`:8`) — 그 스타일 금지.
> ⚠️ **기대값은 리터럴로 박는다.** 새 코드를 두 번 돌려 비교하면 공허하게 통과한다(라운드 1 지적).
> ⚠️ **합계(sum)만 보지 않는다.** 간격을 전부 한 씬에 몰아넣는 오구현도 합계는 맞다 → **배열 전체 비교**.

### 7.1 단위 — `tests/services/sceneSlots.test.js` (신규)
`src/services/sceneSlots.js` 로 분리한 순수 함수를 문다.
- 간격 있는 3 씬 → 슬롯 배열이 **리터럴 기대값과 정확히 일치**
- **간격 없는 3 씬 → 슬롯 == 원래 duration** (no-op 성질, 리터럴 비교)
- 마지막 씬 → `endTime - startTime`
- 첫 씬 `startTime=0.1` → 슬롯이 `next.startTime - 0`
- **불변식: 이미지 슬롯 합계 == 마지막 `endTime`**
- **`srtSlots` 는 첫 씬만 다르다**: `imageSlots[0] − srtSlots[0] === startTime_0`
- `useSlots` 가 false 를 반환하는 경우 (전체 폴백):
  - `startTime`/`endTime` 없음 (비-SRT 프로젝트)
  - **배열 순서와 `startTime` 이 어긋남** (재배열 후 SRT 재임포트 모양의 픽스처, §4.1 ①)
  - **겹침** `end_i > start_{i+1}` — 단조증가는 만족하는데 겹치는 픽스처(`A(0–10), B(5–8)`)
  - 중복 `startTime` (슬롯 `<= 0`)
  - `endTime <= startTime` (자기 span 이 0/음수)
- **레거시 폴백 값**: duration 없는 씬 + `settings.defaultDuration = 7` → 슬롯이 **7** 이다
  (raw `s.duration` 만 쓰면 undefined — 라운드 2)
- **전체 폴백 시 슬롯 배열 == `s.duration || settings.defaultDuration || 3` 배열**
  (raw `s.duration` 배열이 아니다 — 라운드 3 지적)
- **`reason` 계약**: 각 폴백 케이스가 지정된 `reason` 리터럴을 반환한다
  (`'non-finite-times'` / `'not-monotonic'` / `'overlap'` / `'non-positive-slot'`).
  §9.2 가 이 계약을 약속만 하고 테스트를 안 걸어둬 **그 자체가 paper claim** 이었다(라운드 5)
- **`boundaryOf` 분리**: 씬 자기 span 을 반환한다 — `srtSlot` 과 **다른 값**인 픽스처로 고정

### 7.2 훅 — `tests/hooks/useExport.gap.test.jsx` (신규)
- **회귀 재현**: 간격 픽스처 → exporter 가 받은 `image_duration` **배열 전체**가 기대값과 일치
  (수정 전에는 마지막 씬이 짧고 합계가 부족)
- **no-op 회귀**: 간격 없는 픽스처 → `image_duration` 배열이 **리터럴 기대값**과 동일
- **재배열 픽스처** → 전체 폴백, 산출물이 현행과 동일 (100 초 슬롯이 안 나온다)
- `source_duration` 이 씬 자기 길이로 나간다 — 픽스처는 **슬롯 ≠ source** 여야 한다(뮤테이션 #5)
- **`source_offset`**: 첫 씬은 `start_0`, 나머지는 0 (뮤테이션 #16)
- **폴백 프로젝트에는 `source_duration`/`source_offset` 필드가 아예 없다**
  (픽스처는 겹침/재배열처럼 **각 씬 span 은 유효하고 프로젝트만 폴백**되는 모양 — 시각 없는
  비-SRT 픽스처는 finite 검사가 대신 막아 뮤테이션 #13 을 못 죽인다. 라운드 3 지적)
- **영상 길이 폴백(훅 레벨)**: `project.scenes[].videos[].duration` 단언 —
  ① 폴백 프로젝트 + 자체 길이 없는 영상 → **레거시 값(3)**  ② 슬롯 프로젝트 + 자체 길이 없는 영상
  → **`source_duration`** (뮤테이션 #8)
- 세 경로(CapCut/프리미어/Vrew) 모두 같은 슬롯을 받는다

### 7.3 영상 오버레이 (§4.2)
`tests/exporters/prepareCloudRequest.gap.test.js` (신규)
- 슬롯 10 s / source 4 s / 영상 2 s → `startMs` = 슬롯시작 **+2 s** (source 기준),
  **+8 s 아님**(슬롯 기준으로 밀리면 실패)
- 영상 12 s / 슬롯 10 s → `durationMs` 가 **10 s 로 잘린다**(엣지 7)
- 자체 길이 없는 영상 + `source_duration` 있음 → source 길이를 받는다
- 자체 길이 없는 영상 + **`source_duration` 없음(폴백 씬)** → **슬롯**을 받는다(0 이 아니다 → 증발 금지)
- `source_duration` 없는 **구형 요청** → 현행 동작(슬롯 기준)
- **`source_duration: NaN` / `Infinity` / **`0`** / **음수** 인 요청 → 슬롯으로 폴백**
  (소비자 방어, 뮤테이션 #9). ⚠️ NaN 픽스처는 **`video < slot`** 이어야 한다 —
  아니면 healthy 경로도 else 분기로 가 같은 결과라 뮤턴트가 산다(라운드 4)
- **`source_offset: NaN` / `Infinity` / 음수 / `>= slot` → `0` 으로 강등**(뮤테이션 #18)
- **`source_duration` 이 슬롯보다 큰 잘못된 요청**: slot 10 / srcOff 0 / **source 50** / video 2 →
  `startMs + durationMs <= 슬롯 끝`. 캡이 없으면 끝이 `cum + 50` 이 된다(뮤테이션 #22)
- **긴 영상 + offset**: 슬롯 0–10 / offset 5 / source 4 / **영상 12** →
  `startMs = 5 s`, `durationMs = **5 s**`(= `slot − offset`), 즉 **끝이 슬롯 끝(10 s)을 안 넘는다**.
  `Math.min(video, slot)` 이면 15 s 까지 뻗어 다음 씬을 덮는다 (뮤테이션 #19)
- **`source_offset` 이 있는 첫 씬**: 슬롯 0–10 / offset 5 / source 4 / 영상 2 →
  `startMs` = **7 s** (offset 무시하면 2 s — 뮤테이션 #16)

### 7.4 사이드카 SRT (§4.5) — `tests/utils/srtTrack.slots.test.js` + `tests/exporters/capcut.srt.test.js` (신규)
- `rebaseSrtTrackToScenes(track, scenes, { durationOf: srtSlotOf, initialCumulative: start_0 })`
  → **결과가 원본 절대 시각과 동일**(identity).
  ⚠️ 픽스처 조건 **둘 다** 필요하다:
  ① **`start_0 ≠ 0`**(예: 0.1) — 0 이면 v2 의 깨진 설계로도 통과해 **뮤테이션 #14** 가 산다.
  ② **간격이 있는 비-마지막 씬이 최소 하나**(즉 `scene.duration ≠ srtSlot`) — gapless 면
  `durationOf` 를 무시해도 값이 같아 **뮤테이션 #10** 이 산다(라운드 3).
- `initialCumulative` 만 빼면 첫 씬 자막이 `start_0` 만큼 앞당겨진다(회귀 재현)
- **클램프 유지(§4.5 결정)** — ⚠️ 픽스처를 정확히 골라야 한다(라운드 5: v6 문구로는 클램프가
  **아예 발동하지 않아** 뮤테이션 #20 이 산다). 비-마지막 씬은 SRT 임포트상
  `lastLine.endTime <= start_{i+1}` 이라 경계가 `start_{i+1}` 이면 `Math.min` 이 no-op 이다.
  **둘 중 하나로 고정**:
  ① **마지막 씬 shrink** — `boundaryOf` 가 줄어든 span 이라 라인(10–15)이 줄어든 `endTime`(13)으로 클램프
  ② **CSV 교차 라인** — 씬 A(0–5)/B(10–15), A 연결 라인 0–12 → 5 로 클램프
  ①이 `srtTrack.rebaseClamp.test.js` 의 의도와 직결되므로 ①을 필수, ②를 추가로 둔다
- **폴백 사이드카(훅 레벨)**: `useSlots=false` 픽스처(**첫 원소 `startTime ≠ 0`**, 예 `[C(100–105), A(0–5)]`,
  SRT linkage 있음, `audioPackage` 없음) → exporter 가 받은 `project.srtTrack` 이 **현행 리터럴과 동일**
  (뮤테이션 #17 — 7.4 의 다른 항목들은 함수를 직접 불러 훅의 게이트를 못 문다. 라운드 4)
- `durationOf` 미전달 → **현행 동작 그대로**(다른 호출부 무영향)
- `sceneBoundary` 클램프가 여전히 동작한다(자막이 다음 씬 시작을 넘지 않는다)
- `generateSRT` 가 **영상 있는 씬에서도 슬롯을 누적**한다(`video.duration` 로 대체하지 않는다).
  픽스처는 **영상 길이 ≠ 슬롯**이어야 뮤테이션 #11 이 죽는다
- **EN 사이드카**도 같이 고쳐진다(항상 이 폴백 경로) — `_subtitle_en.srt` 시각 단언
- **기존 `tests/exporters/capcut.test.js:178`** 의 "영상 길이/기본 5 s" 기대값을 새 동작으로 갱신
- **통합**: 간격 픽스처로 내보내면 사이드카 SRT 의 마지막 자막 시각이 **원본과 같다**
  (수정 전에는 80 초 이르다)

### 7.5 뮤테이션 (커밋 후 실측)
| # | 뮤테이션 | 죽어야 하는 테스트 |
|---|---|---|
| 1 | 마지막 씬도 `next.startTime - startTime` 로 | 7.1 마지막 씬 |
| 2 | 첫 씬 오프셋 흡수 제거 | 7.1 첫 씬 / 불변식 |
| 3 | **겹침 항(`end_i <= start_{i+1}`) 제거** | 7.1 겹침 픽스처 `A(0–10),B(5–8)` (단조 항만으로는 통과하므로 이 뮤테이션이 죽는다. v2 의 "단조성 제거"는 슬롯>0 검사와 중복이라 살아남았다 — 라운드 2) |
| 4 | 전체 폴백 → 씬 단위 폴백 | 7.1 전체 폴백 배열 비교 |
| 5 | `source_duration` 을 슬롯과 같은 값으로 (**emit 지점**) | **7.2** `source_duration` 단언(슬롯 ≠ source 픽스처). 7.3 은 DTO 를 손으로 만들어 훅을 안 타므로 이 뮤테이션을 못 문다 — 라운드 3 |
| 6 | `:180` 오프셋이 슬롯을 쓰게 | 7.3 `+2 s` 단언 |
| 7 | `:178` `Math.min` 이 source 를 쓰게 | 7.3 자르기 — 픽스처를 **슬롯 10 / source 6 / 영상 12** 로. source==slot 이면 뮤턴트가 산다(라운드 2) |
| 8 | 영상 폴백 체인에서 마지막 항 제거 (`\|\| slotDuration`) | **7.2 훅 레벨**에서 `project.scenes[].videos[].duration` 단언. (7.3 은 `prepareCloudRequest` 를 직접 부르므로 `useExport` 안의 이 뮤테이션을 못 문다 — 라운드 2) |
| 9 | **소비자**의 `Number.isFinite(src) && src > 0` 방어 제거 | 7.3 `NaN` 요청 → 슬롯 폴백. (emit 쪽 `유한 && >0` 검사는 `useSlots` 술어가 이미 보장해 **등가 뮤턴트**다 — 라운드 3 지적으로 소비자 쪽으로 이동) |
| 10 | `durationOf` 를 무시하고 `scene.duration` 사용 | 7.4 identity |
| 11 | `generateSRT` 가 영상 씬에서 `video.duration` 누적 | 7.4 generateSRT |
| 12 | 슬롯 계산 통째로 `s.duration` 원복 | 7.2 회귀 재현 배열 비교 |
| 13 | `source_duration`/`source_offset` 의 `useSlots` 게이트 제거 | 7.2 **겹침/재배열 폴백** 픽스처에서 필드 부재 |
| 14 | `initialCumulative` 무시 | 7.4 identity (`start_0 = 0.1` 픽스처) |
| 15 | 레거시 폴백을 raw `s.duration` 으로 | 7.1 `defaultDuration = 7` 케이스 |
| 16 | `source_offset` 을 항상 0 으로 | 7.3 첫 씬 `startMs = 7 s` |
| 17 | rebase 옵션 전달의 `useSlots` 게이트 제거 | 7.4 **훅 레벨** 폴백 사이드카 리터럴 비교 |
| 18 | `source_offset` 소비자 방어 제거 | 7.3 NaN/음수/`>= slot` offset |
| 19 | 클립 상한을 `slot − offset` → `slot` 으로 | 7.3 긴 영상 + offset (끝이 슬롯을 넘는다) |
| 20 | 클램프 유지 로직 제거(슬롯일 때 경계 무한대) | 7.4 클램프 유지 **①마지막 씬 shrink** 픽스처 |
| 21 | `boundaryOf` 를 무시하고 `durationOf`(슬롯)를 경계에도 사용 | 7.4 클램프 유지 (v6 의 실제 결함) |
| 22 | 소비자의 `srcDur` 캡 제거 | 7.3 `source_duration: 50` / slot 10 / video 2 → 오버레이가 슬롯을 안 넘는다 |
| 23 | `reason` 을 항상 같은 문자열로 | 7.1 reason 리터럴 |

---

## 8. 변경 파일 목록

| 파일 | 변경 |
|---|---|
| `src/services/sceneSlots.js` | **신규** — `useSlots` 판정 + **`imageSlots` / `srtSlots` / `sourceOffsets`** 산출 |
| `src/hooks/useExport.js` | `:137` 슬롯 사용, `:141` 영상 폴백 체인, `:151` 부근 **`source_duration` + `source_offset`**(둘 다 `useSlots` 게이트), `:129-133` rebase 에 **`durationOf` + `initialCumulative`(useSlots 게이트)** 전달 |
| `src/utils/srtTrack.js` | `rebaseSrtTrackToScenes` 에 `durationOf` + **`boundaryOf`** + `initialCumulative` 옵션 (`:149` 시드, `:153` 길이, `:162-164` 경계, `:168` absStart, `:178-183` 누적) |
| `src/exporters/prepareCloudRequest.js` | `:178-181` 줄 단위로 슬롯/source/offset 분리 + **offset 검증** + **클립 상한 `slot − offset`** |
| `src/exporters/capcut.js` | `generateSRT`(`:79-90`) 누적을 항상 슬롯으로 |
| `tests/services/sceneSlots.test.js` | **신규** |
| `tests/hooks/useExport.gap.test.jsx` | **신규** |
| `tests/exporters/prepareCloudRequest.gap.test.js` | **신규** |
| `tests/utils/srtTrack.slots.test.js` | **신규** |
| `tests/exporters/capcut.srt.test.js` | **신규** |
| `tests/exporters/capcut.test.js` | **기존 수정** — "영상 길이/기본 5 s" 기대값이 §4.5 수정으로 깨진다. `:178` **과 `:197`** 두 곳 |

**건드리지 않는다**: `whisk2capcut` / `whisk2premiere` / `exportToVrew` GCF (셋 다 무수정).
GCF 의 마지막-씬 연장은 **여전히 발동한다 — 다만 83.9 s 가 아니라 0.6 s** 다(§4.3).
v4 의 "실질적으로 발동하지 않는다"는 부정확했다.

⚠️ **v2 의 SFX 주장은 paper claim 이었다**(라운드 2 정정). 씬 SFX 는 `buildExportProject` 의 DTO 에
실리지 않으므로(`useExport.js:144-160` 에 `sfx_*` 없음) 일반 내보내기는 GCF 의 `mediaPositions`
SFX 경로에 **도달조차 하지 않는다**. audioPackage/story 의 timed SFX 는 절대 시각이라 무영향.
→ "SFX 자동 개선"은 **주장에서 삭제**한다.

---

## 9. 리스크

1. **무음 구간에 앞 이미지가 계속 보인다** — (b) 의 정의상 의도된 동작. 사용자 승인 완료.
   이번 프로젝트는 최대 1.63 s / 평균 0.39 s 라 무해(§1). 간격이 수 초인 프로젝트가 오면 재검토.
   상한 도입은 **범위 밖**(라운드 1 동의). 단 §4.1 의 단조성 가드는 상한이 아니라 **정합성** 문제라
   범위 안이다.
2. **전체 폴백이 걸리면 버그가 그대로 남는다** — 의도된 안전한 후퇴.
   `computeSceneSlots` 가 `{ useSlots: false, reason: '...' }` 를 반환하고 호출부가 `console.warn`
   한다. **`reason` 문자열 계약과 그 단위 테스트를 §7.1 에 포함한다**(v4 는 계약도 테스트도 없는
   paper claim 이었다 — 라운드 4).
3. **자막 길이** — srtTrack 경로는 **원본 길이 유지**(간격 동안 자막 없음), `generateSRT` 폴백
   경로만 슬롯 전체를 덮는다(§4.5). v4 의 "간격 동안 유지" 단정은 전자에 대해 틀렸다.
4. **pending 스펙과의 순서** — §6. 이 스펙을 먼저 구현한다.

---

## 10. 라운드 1 findings 처리 내역

| # | 심각도 | 내용 | 처리 |
|---|---|---|---|
| F1 | 최심각 | 사이드카 SRT 가 rebase 로 붕괴 타임라인을 따라감. v1 §8 의 "자막 안 건드림"은 `rawSrtTrack`(원본)과 rebased `project.srtTrack`(붕괴)을 혼동한 오판 | §2.3 갈래 분리, **§4.5 신설**, §7.4, §8 에 `srtTrack.js` 추가 |
| F2 | 심각 | `moveScene` 재배열 시 큰 **양수** 슬롯이 `<= 0` 가드를 통과 → 100 초 정지화면(회귀) | §4.1 단조성 사전검사 + 전체 폴백, 뮤테이션 #3 |
| F3 | 심각 | 씬 단위 폴백이 망원합을 깨서 drift ≠ 0 | §4.1 all-or-nothing, 뮤테이션 #4 |
| F4 | 중상 | `source_duration` NaN 이 `??` 를 통과 / 영상 폴백 체인이 0 이 되어 오버레이 증발 | §4.2 emit 규칙 + 폴백 체인, 뮤테이션 #8·#9 |
| F5 | 중 | `generateSRT` 가 영상 씬에서 `video.duration` 을 누적 → 영상 씬마다 재어긋남 | §4.5, §8 에 `capcut.js` 추가, 뮤테이션 #11 |
| F6 | 중 | §4.2 와 엣지 7 이 자기모순(자르기 기준) | §4.2 줄 단위 표, 뮤테이션 #6·#7 |
| F7 | 경미 | 산술(3166.4 / 0.6 s), 앵커(`:1108`), 테스트 반증력(리터럴·배열 비교) | §4.3 · §2.4 · §7 서두 |

### 라운드 2 (Fable 5 + Codex 독립, BLOCKER 3 건 일치)
| # | 심각도 | 내용 | 처리 |
|---|---|---|---|
| N1 | BLOCKER | v2 의 "사이드카 identity" 가 **첫 씬에서 거짓**. `cumulative=0`(`srtTrack.js:149`) + `originalStart` 가 첫 자막 줄(`:158`) → 첫 씬 자막이 `start_0` 만큼 앞당겨짐. `start_0=0` 픽스처면 테스트가 초록불로 버그 출하 | §4.5 **재설계**(이미지용/자막용 슬롯 맵 분리 + `initialCumulative`), 7.4 픽스처 `start_0≠0` 강제, 뮤테이션 #14 |
| N2 | BLOCKER | `useSlots` 가 **겹침을 못 잡음**. v2 엣지 6("전체 폴백")은 거짓 | 술어에 `end_i <= start_{i+1}` + `end>start` + `start>=0`, 엣지 6 정정, 뮤테이션 #3 교체 |
| N3 | 중 | `source_duration` 이 `useSlots` 로 게이트되지 않아 폴백 프로젝트가 새 경로를 탐 → "바이트 동일" 보장 위반 | §4.2 게이트 + 소비자 `isFinite && >0` 방어, 뮤테이션 #13 |
| N4 | 중 | v2 의 `moveScene` 근거가 **사실 오류**(`recalculateTimesArr` 로 순차 재작성) | §4.1 근거를 "재배열 후 SRT 재임포트"로 정정, 픽스처 모양 변경 |
| N5 | 중 | **CapCut GCF 가 씬을 숫자 ID 로 재정렬**(`index.suffixed.js:1004-1009`) → 재배열 프로젝트 폴백 "보장"이 CapCut 에선 무의미 | **§4.6 신설** — 명시적 범위 밖 선언 |
| N6 | 중 | 레거시 폴백이 `settings.defaultDuration` 을 잃으면 현행과 달라짐 | §4.1 레거시 값 명시, 7.1 케이스, 뮤테이션 #15 |
| N7 | 중 | v2 의 "자막이 간격 동안 유지" 가 identity 와 **양립 불가**(`:175` 는 `Math.min` 만) | §4.5 결정 정정 — srtTrack 경로는 원본 길이 유지, generateSRT 폴백만 슬롯 전체 |
| N8 | 중 | **SFX 자동 개선은 paper claim** (씬 SFX 가 DTO 에 없음) / ko 사이드카는 `audioPackage.srtContent` 조건부 | §8 주장 삭제, §4.5 에 조건부 명시 |
| N9 | 중 | 뮤테이션 #3 생존(단조성이 슬롯>0 과 중복), #8 생존(훅 뮤테이션을 prepare 테스트가 못 뭄), #7 픽스처 의존 | 표 교체 + 훅 레벨 단언 |
| N10 | 경미 | 기존 `capcut.test.js:178` 기대값이 깨짐 / `rebase` 호출부는 하나뿐 / 앵커 드리프트(`:149/:153/:158/:162/:168`) | §8 추가, §4.5 정정 |
| — | 보너스 | `generateSRT` 수정이 **EN 사이드카도 고친다**(항상 폴백 경로) | §4.5 기록, 7.4 단언 |

**라운드 1 이 건전하다고 확인한 것**: §2 인과 사슬(클라우드 경로), §4.1 산술(telescoping),
첫 씬 흡수 결정, 엣지 5 선택, 세 경로 자동 적용, SFX 무수정 자동 개선,
`prepareCloudRequest.js:120`(이미지 없는 씬 skip)의 슬롯 정합성.
⚠️ 단 라운드 1 이 "건전"으로 분류한 **SFX 자동 개선은 라운드 2 에서 paper claim 으로 뒤집혔다**
(§8 참고) — 이 목록에서 제외한다.

---

## 11. 라운드 6 (확인용) 에 묻고 싶은 것

라운드 5 의 지적을 전부 반영했다. **설계 변경은 ①(경계 분리) 하나**이고 나머지는 방어·테스트·문장이다.

1. **§4.5 의 `durationOf` / `boundaryOf` 분리**가 R13 클램프를 정말 보존하나?
   identity(불변식 만족 씬)와 클램프(수동 shrink 씬)가 **동시에** 성립하는지 픽스처로 확인해줘.
2. **§4.2 의 `srcDur` 캡**으로 오버레이가 슬롯을 벗어나는 모든 경우가 닫혔나?
   두 분기(`:180` 짧은 영상 / `:181` 긴 영상) 각각에서.
3. **§4.7 의 정정**("불가피" → "filler 를 범위 밖으로 둔 결정")이 이제 정확한가?
4. **§7 의 23 개 뮤테이션**이 각각 짝지은 테스트로 실제로 죽나? 특히 #20·#21·#22·#23.
5. **§8** 이 `boundaryOf` 까지 포함해 완전한가?
6. **구현 착수해도 되나?** 아직이면 **코드 전에 반드시 고칠 것만** 골라줘.
