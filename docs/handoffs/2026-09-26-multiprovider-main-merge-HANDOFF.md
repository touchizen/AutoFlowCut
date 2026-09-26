# main → feature/multi-provider-genapi 병합 — HANDOFF (2026-09-26)

> **새 세션 시작 문구:** `AutoFlowCut-main/docs/handoffs/2026-09-26-multiprovider-main-merge-HANDOFF.md 읽고 §5 부터 진행해줘.`

## 1. 상태

- 워크트리 `~/workspace/AutoFlowCut-main`, 브랜치 **`feature/multi-provider-genapi`**, HEAD **`59dfebac`** — **origin 미푸시**(origin 은 병합 전 `2365a3a7`).
- 사용자 지시: "AutoFlowCut-bugfix 의 앞선 커밋들(=main)을 병합하고, **findings 0 이 될 때까지 루프**. findings 는 **Opus 5.5 서브에이전트**로. 테스트는 알아서."
  사용자 규칙(메모리): **병합을 시키면 푸시까지** — findings 0 확인 뒤 `git push origin feature/multi-provider-genapi`(fast-forward 확인 후, 따로 묻지 않는다).
- 전체 스위트 **9454 passed / 54 skipped**(병합 전 브랜치 7987 · main 8741), `npm run build` 통과.

| 커밋 | 내용 |
|---|---|
| `34b5ca96` | Merge main(118 커밋, `7ea5c346`까지) — 충돌 9파일 33덩어리 + 텍스트 병합이 깨뜨린 4곳 수정 |
| `3671efcb` | 리뷰 A R1: F1 Flow 모드는 씬 override 무시 · F2 API 인증 문구 보존 · F3 MCP 모델↔provider 정렬 |
| `57c3237e` | 리뷰 A R2: 시험 단계 provider 모델 MCP 거부(400) · Flow 모드 정렬 안 함 · API 영상 복구 인증 문구 |
| `2477d252` | 리뷰 B R1: 되돌려도 안 잡히던 해결 5곳 테스트로 고정(테스트만) |
| `59dfebac` | 리뷰 A R3: MCP 카탈로그 밖 모델 이름은 google 로 본다 · api-docs 규칙 |

## 2. 충돌 해결 원칙

브랜치(멀티 프로바이더: provider 라우팅·취소 스코프·추출된 순수 빌더·§5.11 quota/auth 분류)를 뼈대로 두고, main(flow.google.com batchexecute 재작업 M1–M3,
내보내기 수정, Flow 이미지 모델 선택 등)의 변경을 그 안으로 옮겼다. 자동 병합 대비 해결 내역: `git show --remerge-diff 34b5ca96`.
- `useScenes`·`useMcpServer`: 브랜치의 `generation` 병합 + main 의 공용 보존 목록 `pickPreservedSceneFields`(브랜치 필드 `videoT2VProvider`·`videoT2VAppliedInputs` 를 목록에 추가).
- `src/services/videoResultPatch.js` 빌더(브랜치가 App 인라인 패치를 뽑아낸 것)에 main 의 인라인 변경(id presence 검사 H3/K1, errorParams·거부 id·downloadGated)을 옮김.
- `useVideoAutomation`: 브랜치의 provider 해석 항목 + main 의 Flow 출처 분류·다운로드 게이트·클릭 전 거부 종결·읽기 결과 quota 미발화. main 이 퇴역시킨 segments 경로는 뺐다.

## 3. 텍스트 병합이 조용히 만든 결함(전부 수정·테스트)

1. **Flow quota 중단 꺼짐** — 브랜치는 errorKind 를 판정 권위로 보는데 Flow 는 quota 를 `{errorKind:'flow-rpc-error', error:'RESOURCE_EXHAUSTED'}` 로 싣는다 → `quotaStop` 에서 'flow-rpc-error' 는 권위 아님.
2. `useAutomation` 의 main 타임아웃 검사가 브랜치가 지운 `ITEM_TIMEOUT` 참조 → `imageGenerationItemTimeoutMs(item.provider)`.
3. `useReferenceGeneration` 의 main 백스톱이 브랜치가 이름 바꾼 `succeeded` 참조 → `consumed`.
4. 로케일 `errorSection.kind.aborted`(브랜치의 취소 결과) 추가.
5. (리뷰에서) Flow 모드 + 씬 override 가 main 의 정확 일치 모델 드라이버와 충돌(영상은 배치 전체 거부로 번짐) → `resolveScene{Image,Video}Provider(..., { appMode })` 가 Flow 면 google + 설정 모델.
6. (리뷰에서) main 의 `authFailureText` 가 브랜치의 API `errorKind:'auth'` 메시지까지 일반 문구로 덮음 → 공용 술어 `authErrorIsMachineToken`(kind 있고 'auth' 아님) 5곳.
7. (리뷰에서) MCP `update-settings` 모델 키 ↔ provider 불일치 → `src/utils/mcpModelProviderAlign.js`(API 모드: 카탈로그 모델이면 그 provider 로 전환, 카탈로그 밖은 google, Flow 모드는 정렬 안 함) +
   화이트리스트가 시험 단계(provisional) provider 의 카탈로그 id 를 400 으로 거부(`src/utils/mcpSettingsWhitelist.js` — main 번들이 `genModels` 를 import, 순수 Node 안전 확인됨).
   `computeVideoProviderSwitch` 는 SceneTab 에서 `src/utils/videoProviderSwitch.js` 로 그대로 옮겨 공유.
8. (리뷰에서) API 모드 영상 복구의 키 거부가 "re-login to Flow" 로 보임 → `videoRecovery` 가 `error || authText || DEFAULT`.

미정의 식별자 탐지(ESLint no-undef 를 병합본·main·브랜치 판에 각각 돌려 병합본에만 새로 생긴 것)로 75개 파일 재검사 — 2·3 외 없음.
⚠️ 탐지기 함정: ESLint 는 작업 폴더 밖 파일을 "outside of base path" 경고로 **조용히 건너뛴다** → cwd 를 임시 폴더로 두고, "ignored" 메시지는 오류로 취급. 알려진 버그(2·3)를 되살려 잡히는지부터 확인할 것.

## 4. 리뷰 루프 현황 — **findings 0 아직 미확인**

리뷰어 2명(Opus 5.5 서브에이전트, 각자 전용 사본):
- **A — 의미 정합성**: R1 3건(F1 major, F2·F3 minor) → R2 3건(R2-1..3 minor) → R3 1건(R3-1 minor) + nit(api-docs). 모두 수정. **R4(`59dfebac` 검증)는 돌던 중 세션 이동으로 중단.**
- **B — 테스트 적정성·뮤테이션**: R1(89 뮤턴트): F1·F8 은 A 와 중복(이미 수정), F2–F5 테스트 공백 + 이미지 Flow quota 훅 테스트 → `2477d252` 로 고정. **R2 는 돌던 중 중단.**
- 사본: `~/workspace/AutoFlowCut-mpmerge-rA`, `-rB` (둘 다 detached `59dfebac`, 깨끗, node_modules 는 `AutoFlowCut-main/node_modules` 심볼릭 링크).

남긴 nit(사유): B F7 `mergeLikeApp` 손 사본 4벌(main 에서 K1 이후부터 어긋나 있던 것 — 병합 무관) · `tests/electron/story/stepMachine.scenesExperiment.test.js` 부하 시 간헐 실패(병합 전부터) ·
A 의 `useReferenceGeneration` maxWait provider nit(fal 전역 provider 는 이제 UI·MCP 로 도달 불가 — A 동의).

## 5. 다음 일

1. `59dfebac` 기준으로 **A R4 · B R2 를 다시** 돌린다(Opus 5.5 서브에이전트 `model: "opus"`, 백그라운드, 각자 사본). 프롬프트 요점:
   - 저자 설명 불신 · VERIFIED/INFERRED 구분 · 사본에서만 뮤테이션 후 `git checkout -- .` 복원 · 커밋/푸시 금지.
   - A: R3-1 수정(카탈로그 밖 → google) 검증 + 회귀(openai 사용자가 정적 카탈로그 밖의 동적 google id 를 보낼 때 등) + 전체 의미 재점검.
   - B: 자기 R1 생존 뮤턴트(R5 R6 V4 V9 C3 C4 M3 Q1) 재실행 + `3671efcb`·`57c3237e`·`59dfebac` 새 코드 뮤테이션(저자 주장: 표적 뮤턴트 22개 전부 죽음 — 독립 검증).
   - zsh 는 따옴표 없는 `$VAR` 를 쪼개지 않는다 — 테스트 파일은 직접 나열하고 `Tests ` 요약 줄이 있는지 먼저 본다.
2. findings 가 나오면 TDD(실패 테스트 먼저)로 고치고 뮤턴트 확인 → 전체 스위트·빌드 → 커밋(영어) → 두 리뷰어 다음 라운드. **둘 다 findings 0** 까지.
3. findings 0 이면 `git fetch` → fast-forward 확인 → `git push origin feature/multi-provider-genapi`. 리뷰 사본 두 워크트리 제거(`node_modules` 링크 먼저 삭제 후 `git worktree remove`).
4. 이 문서를 결과로 갱신·커밋.

## 6. 참고

- 같은 날 main 에 들어간 Flow 이미지 모델 선택(`b54bab20`, 푸시 `7ea5c346`)이 이 병합에 포함됐다 — 그 핸드오프: `docs/handoffs/2026-09-26-flow-image-model-select-HANDOFF.md`.
- 메모리: `autoflowcut-multiprovider-progress`(브랜치 전체 이력) · `autoflowcut-flow-image-model-select`.
