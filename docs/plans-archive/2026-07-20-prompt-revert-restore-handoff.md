> ✅ **RESOLVED (2026-07-20, commit a6bf5f47).** 이 문서의 가설(1~4, updateScene line 442)은 **전부 헛다리**였다.
> 실제 편집 UI("대본"/text 탭 PromptInput)는 `updateScene` 을 아예 안 타고 `handleTextChange → mergeTextIntoScenes`(parsers.js)로
> 흐른다. 진단 결정타: 계측한 `updateScene CALLED` 가 편집해도 안 찍힘 = 이 UI 가 그 함수를 안 거친다는 확정 증거.
> 그 벌크 경로의 `mergeField` 에 `updateScene` 의 donePrompt 기반 done 복원 분기가 통째로 없었다("직전 값과 다르면 무조건 pending").
> Fix: `mergeField` 에 동일 복원 규칙 이식(baseline 캡처 → 원복이면 done + error 클리어 → generating 스킵). hasImageData fix(6e12fce5)가
> 재현된 이유도 이것 — 그 fix 는 이 UI 가 부르지 않는 `updateScene` 만 고쳤다. 실앱 눈검증 OK.

# 핸드오프 — 프롬프트 원복 시 done 복원 안 됨 (still failing)

작성: 2026-07-20 / 브랜치: `fix/scene-hasimage-detection` (off `main`)
최신 커밋: `6e12fce5 Fix prompt pending/revert-restore for scenes whose image is in filePath/data`

## 증상 (사용자 실측, 방금 재현)

> "done 상태에서 프롬프트 수정 후, 원복하면 done 으로 원복 안 됨, pending"

즉:
1. 씬이 `done` (이미지 있음, 프롬프트 = P0)
2. 프롬프트를 P1 으로 편집 → `pending` (여기까진 맞음)
3. 프롬프트를 **정확히 P0 로 되돌림** → **`done` 으로 복원돼야 하는데 `pending` 유지** ← 버그

## 지금까지 한 것

- 1차 원인으로 지목했던 것: `updateScene` 의 `hasImage` 가 좁은 가드(`image||imagePath`)라
  이미지가 `filePath`/`data` 에만 있는 씬을 "이미지 없음" 판정 → pending 전환·원복 복원 통째 스킵.
  → `hasImageData(scene)` (썸네일 렌더 기준: `imagePath|filePath|image|data`) 로 교체. **커밋 6e12fce5.**
  - TDD: `tests/hooks/useScenes.updateScenePromptStatusReset.test.js` 에 filePath-only / data-only 케이스 추가, 뮤테이션 확인, 전체 스위트 그린(6634).
- **그런데 이 fix(HMR 라이브) 이후에도 사용자가 재현** → 원인이 hasImage 가 아니거나, 추가 원인 존재.

## 코드 위치 (정확히)

- 복원 로직: [src/hooks/useScenes.js:416-453](src/hooks/useScenes.js#L416) `updateScene` 내부 `setScenes` 콜백.
  - line 424 `promptChanged = has('prompt') && updates.prompt !== scene.prompt`
  - line 428 `hasImage = hasImageData(scene)`
  - line 429 `callerChangesStatus = has('status') && updates.status !== scene.status`
  - line 432 게이트: `promptChanged && hasImage && !callerChangesStatus && status!=='generating'`
  - line 433-441 baseline: `scene.donePrompt` (string) 우선, 없고 `status==='done'` 이면 첫 편집 때 `scene.prompt` 를 캡처해 `next.donePrompt` 에 저장
  - line 442 **`if (hasBaseline && updates.prompt === baseline)` → `next.status='done'`** (여기가 복원 분기), else `pending`
- 인라인 프롬프트 편집 호출부: [src/App.jsx:2246](src/App.jsx#L2246)
  `onScenePromptUpdate={(sceneId, newPrompt) => scenesHook.updateScene(sceneId, { prompt: newPrompt })}`
  → `{ prompt }` 만 넘김. 모달(SceneDetailModal)은 `editData={...scene}` 통째(status/donePrompt 포함) 넘김.

## 논리상으론 되어야 함 (그래서 실데이터 로깅 필수)

첫 편집에서 baseline=P0 캡처(donePrompt 없던 경우) 또는 기존 donePrompt=P0 사용 → 상태 pending.
되돌림에서 `updates.prompt(P0) === baseline(P0)` → done. **종이 위에선 통과.** 실제로 안 되니 아래 가설을 실측으로 잘라야 함.

## 가설 (실측으로 배제할 순서)

1. **정확 일치 실패 (whitespace/개행/유니코드).** line 442 는 strict `===`. 인라인 에디터가
   trailing newline·공백을 넣거나, donePrompt 캡처 값과 표시 값의 정규화가 다르면 P0 ≠ baseline.
   → **가장 유력.** 로그로 `JSON.stringify(baseline)` vs `JSON.stringify(updates.prompt)` 를 char 단위로 대조.
2. **donePrompt 가 표시 프롬프트와 애초에 다름.** 생성 시 imageFinalize 가 `donePrompt = 생성프롬프트 G`
   를 박는데, 생성 후 표시 P0 가 G 와 다르면(예: 생성 프롬프트에 스타일 태그 append) 되돌림 대상 P0 ≠ G.
   → 실제 씬의 `scene.donePrompt` 원시값을 찍어 P0 와 비교.
3. **모달 stale editData 경로.** 모달 저장이 `status`/`donePrompt` 를 통째로 실어 보내
   `callerChangesStatus` 나 baseline 이 의도와 다르게 잡힘. (인라인이면 해당 없음 — 사용자가 어느 경로로
   편집했는지부터 확인.)
4. **중간 patch 가 donePrompt 덮어씀.** 인라인 편집이 키 입력마다 patch 를 보내며 어느 순간
   `{prompt:''}` 같은 중간값이 legacy 캡처를 오염. (App.jsx:2246 는 최종값만 보내는지 확인.)

## 다음 세션의 첫 행동 (딱 이대로)

1. `updateScene` line 442 직전에 임시 계측 삽입 후 실앱 재현:
   ```js
   console.log('[revert-debug]', sceneId, {
     scenePrompt: JSON.stringify(scene.prompt),
     updatesPrompt: JSON.stringify(updates.prompt),
     donePrompt: JSON.stringify(scene.donePrompt),
     baseline: JSON.stringify(baseline),
     hasBaseline, hasImage, promptChanged, callerChangesStatus,
     sceneStatus: scene.status, updatesStatus: updates.status,
     eq: updates.prompt === baseline,
   })
   ```
   (dev 는 HMR 라이브. 커밋 전에 계측 → 사용자에게 "P0→P1→P0" 재현 요청 → 콘솔 로그 받기.)
2. 로그로 가설 1~4 중 어느 것인지 확정. `eq:false` 면 두 문자열의 어디가 다른지(길이·마지막 char) 대조.
3. 원인에 맞는 실패 재현 테스트 먼저(TDD) → 최소 수정 → 전체 스위트(`npm run test:run`) 그린 → 계측 제거 → 커밋.
4. **주의(자책 사례): 뮤테이션 테스트 전에 반드시 커밋. `git checkout <file>` 이 이번 세션에 미커밋 fix 를 두 번 날림.**

## 이 fix 후 대기 중이던 다른 것들 (원래 로드맵, 건드리지 말 것)

- 실앱 눈검증 잔여(item 1): bandit 씬 ref 주입(Agent OFF), 인라인 멘션 배치, scenes ghost/shimmer/🧠토큰카운터,
  이미지없는 모달 '✨생성', audio # 컬럼, 나레이터 정렬, 검수 shimmer+scroll.
- 눈검증 다 OK 되면: `fix/scene-hasimage-detection` → main PR·머지 (확립된 "push & pr merge to main" 패턴).
- **사용자가 명시적으로 보류(시작 금지):** item 2 (feature/inapp-agent 의 effort cap), item 3 (A/B 측정 → M3/M5/M6).

## 영속성 질문 (직전 미답)

사용자가 물었던 "수정 후 다른 프로젝트 전환·복귀하면 그대로 pending?" — 답:
- `donePrompt`·`status` 는 project.json 에 영속(projectPersist 는 image/videoT2V/videoI2V base64 만 strip).
- fix 후 정상 복원된 `done` 은 전환·복귀에도 유지됨.
- 단, **fix 이전에 이미 `pending` + `prompt===donePrompt` 로 굳어버린 씬**은 자가 치유 안 됨
  (되돌릴 때 `promptChanged=false` 라 복원 분기 자체가 안 돎). 재생성 또는 실제 프롬프트 변경+원복 필요.
- 로드 시 재유도: [src/hooks/useProjectData.js](src/hooks/useProjectData.js) 는 `status==='done' && !image`
  같은 손상만 정상화하지, 정상 done 을 pending 으로 되돌리진 않음.
