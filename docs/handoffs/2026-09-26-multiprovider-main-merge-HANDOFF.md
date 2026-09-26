# main → feature/multi-provider-genapi 병합 — HANDOFF (2026-09-26)

> ✅ **완료(2026-09-26 밤 세션).** 두 리뷰어 findings 0 → `feature/multi-provider-genapi` origin 푸시(fast-forward, 이 문서 커밋까지). 리뷰 사본 두 워크트리 제거. 남은 일 없음(§5).

## 1. 상태

- 워크트리 `~/workspace/AutoFlowCut-main`, 브랜치 **`feature/multi-provider-genapi`** — **origin 푸시 완료**(병합 전 origin `2365a3a7` 에서 fast-forward).
- 사용자 지시: "AutoFlowCut-bugfix 의 앞선 커밋들(=main)을 병합하고, **findings 0 이 될 때까지 루프**. findings 는 **Opus 5.5 서브에이전트**로. 테스트는 알아서."
  사용자 규칙(메모리): **병합을 시키면 푸시까지** — findings 0 확인 뒤 `git push origin feature/multi-provider-genapi`(fast-forward 확인 후, 따로 묻지 않는다).
- 전체 스위트 **9460 passed / 54 skipped**(병합 전 브랜치 7987 · main 8741), `npm run build` 통과. 코드(src·electron)는 `59dfebac` 이후 안 바뀌었다 — 뒤 커밋은 테스트·문서뿐.

| 커밋 | 내용 |
|---|---|
| `34b5ca96` | Merge main(118 커밋, `7ea5c346`까지) — 충돌 9파일 33덩어리 + 텍스트 병합이 깨뜨린 4곳 수정 |
| `3671efcb` | 리뷰 A R1: F1 Flow 모드는 씬 override 무시 · F2 API 인증 문구 보존 · F3 MCP 모델↔provider 정렬 |
| `57c3237e` | 리뷰 A R2: 시험 단계 provider 모델 MCP 거부(400) · Flow 모드 정렬 안 함 · API 영상 복구 인증 문구 |
| `2477d252` | 리뷰 B R1: 되돌려도 안 잡히던 해결 5곳 테스트로 고정(테스트만) |
| `59dfebac` | 리뷰 A R3: MCP 카탈로그 밖 모델 이름은 google 로 본다 · api-docs 규칙 |
| `bbb5a196` | 리뷰 B R2(테스트만): MCP 모드 전환 뒤 정렬(modeRef) · update-scene 일부 stage 병합 · Flow 목이 실제 드라이버처럼 거부 · 영상 provider 전환 기억 |
| `c755a084` | 리뷰 B R3(테스트만): update-scene stage-pair 병합(i2v 보존) · `computeVideoProviderSwitch` 의 spread 전부 |

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

## 4. 리뷰 루프 — ✅ **둘 다 findings 0**

리뷰어 2명(Opus 5.5 서브에이전트, 각자 전용 사본):
- **A — 의미 정합성**: R1 3건(F1 major, F2·F3 minor) → R2 3건(R2-1..3 minor) → R3 1건(R3-1 minor) + nit(api-docs) → **R4 findings 0**(`59dfebac`).
  R4: 이전 프로브 A–I 재실행 + 새 프로브 J 9케이스(openai 에서 정적 카탈로그 밖 동적 google id → google 전환·openai 슬롯 기억·heal 유지·SceneTab 왕복, 영상 stage, Flow 불변, provisional 400) ·
  R3-1 원복 뮤턴트는 `mcpModelProviderAlign.test.js` 가 죽임 · 병합 핫스팟 15파일 중복 키 0(검사기 픽스처로 먼저 검증) · 스위트·빌드 통과.
- **B — 테스트 적정성·뮤테이션**: R1(89 뮤턴트) → `2477d252` · R2(92 뮤턴트, minor 2 + nit 3) → `bbb5a196` · R3(nit 1: update-scene 얕은 병합 M7 생존) → `c755a084` · **R4 findings 0**(`c755a084`).
  R1 생존 R5 R6 V4 V9 C3 C4 M3 Q1 은 R2 에서 전부 죽음. R2 에서 살아남은 뮤턴트 중 실제 공백은 G9·G28(마운트 뒤 모드 전환)·M5(update-scene)였고, 이제 전부 죽는다.
  B 가 **등가로 판정**한 생존: W10(imageModel fallback 순서 — 호출부가 항상 같은 값), W12(전역 site appMode — Flow 에선 provider 를 안 씀), B12·B13(videoRecovery `||`·DEFAULT 꼬리 — 호출부가 항상 문구를 넘김),
  G14·G33(화이트리스트 video 목록 ↔ image 목록 — VIDEO_MODELS 에 openai 없음), G45(`...generation.video[stage]` — stage 객체엔 provider 뿐).
- ⚠️ **저자 주장 정정**: "표적 뮤턴트 22개 전부 죽음"은 틀렸다 — `mutations_r2.py` 중 W10·W12·G9·G14·G16 이 전체 스위트에서 살았다(B R2). 실제 공백은 G9(→`bbb5a196`), G16 은 새 테스트로 죽음, 나머지 셋은 등가.

남긴 nit(사유): B F7 `mergeLikeApp` 손 사본 4벌(main 에서 K1 이후부터 어긋나 있던 것 — 병합 무관) · `tests/electron/story/stepMachine.scenesExperiment.test.js` 부하 시 간헐 실패(병합 전부터, 이번 라운드들엔 안 뜸) ·
A 의 `useReferenceGeneration` maxWait provider nit(fal 전역 provider 는 이제 UI·MCP 로 도달 불가 — A 동의) · B F5 api-docs 새 문장은 테스트로 안 묶음(문서 문장 — B 동의) ·
A 참고: `SceneGeneration` 스키마·MCP README 에 "Flow 모드는 씬 override 무시"가 안 적혀 있다(병합 전 브랜치도 동일).
영상 provider 가 provisional 을 벗어나는 날엔 `computeVideoProviderSwitch` 경로가 UI 로 도달 가능해진다 — 지금 테스트가 spread 전부를 묶어 두었다.

## 5. 다음 일 — 이 병합에 남은 일 없음

- 1~4 전부 끝(리뷰 A R4·B R2–R4 → findings 0 → 리뷰 사본 제거 → 이 문서 갱신 → fetch·fast-forward 확인 → 푸시).
- 브랜치 자체의 남은 일(실키 smoke·provisional 승격·실앱 눈검증·F8/F9 제품 결정)은 이 병합과 무관 — 메모리 `autoflowcut-multiprovider-progress` 참고.
- 리뷰 프롬프트·뮤턴트 하네스를 다시 쓰려면: 이전 세션 스크래치패드(`/private/tmp/claude-501/-Users-tuxxon-workspace/<세션>/scratchpad/{prev,rB,mut}`) — 임시 폴더라 재부팅하면 사라진다.

## 6. 참고

- 같은 날 main 에 들어간 Flow 이미지 모델 선택(`b54bab20`, 푸시 `7ea5c346`)이 이 병합에 포함됐다 — 그 핸드오프: `docs/handoffs/2026-09-26-flow-image-model-select-HANDOFF.md`.
- 메모리: `autoflowcut-multiprovider-progress`(브랜치 전체 이력) · `autoflowcut-flow-image-model-select`.
