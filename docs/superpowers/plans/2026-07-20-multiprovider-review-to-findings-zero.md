# 멀티-프로바이더 리팩터 — 마일스톤별 findings-0 재리뷰 핸드오프

> **목적:** M0b~M6+M3 전체를 마일스톤별로 Codex(gpt-5.6-sol, xhigh) + Fable 5 로 재리뷰해 **각 마일스톤 within-scope findings 0** 을 검증·수정으로 닫는다. 이번 세션은 각 마일스톤 1라운드 리뷰의 confirmed 버그를 수정+뮤테이션 검증했으나, **M0b 외에는 "0 남았나" 확인 재리뷰를 안 돌렸고, 문서화-이연 findings 가 남아있다.** 이 문서로 fresh 세션이 그 루프를 완주한다.

## 0. 프로젝트/브랜치
- 레포: `~/workspace/AutoFlowCut-main`. 브랜치: `feature/multi-provider-genapi` (origin 트래킹, HEAD `3881ff3b`).
- 스펙: `docs/superpowers/specs/2026-07-18-multi-provider-genapi-design.md` (8R 리뷰 findings 0, 설계 권위).
- 진행 메모리: `autoflowcut-multiprovider-progress`.
- 현재 전체: **6747 tests 그린** (`npm run test:run`). `electron/api/providers/**` 가 provider 시스템, `src/**` 가 renderer/설정/배치.

## 1. 리뷰 워크플로우 (반드시)
1. **역할분담**: 리뷰는 Codex(gpt-5.6-sol, xhigh) + Fable 5(`Agent`, model:'fable') **독립 병렬**. 저작은 Codex. **Opus(너)는 검증 절대 안 놓는다** — 리뷰 findings 를 실코드로 재현(뮤테이션·raw diff), paper fix 머지 금지. [[role-split-codex-authors-fable-reviews]] [[reviewer-consensus-is-not-measurement]]
2. **findings-0 루프**: 마일스톤당 리뷰 → confirmed(load-bearing) finding 수정 → **재리뷰로 0 확인**. 스코프 안에서 안 줄면 3~5R 에서 끊고 스코프 신호로 해석. [[findings-zero-is-not-a-stop-condition]]
3. **뮤테이션 검증(핵심)**: 각 수정은 되돌리는 뮤테이션이 테스트를 **죽이는지** 실측. perl/python 로 소스 뮤테이트 → 해당 테스트 fail 확인 → 복원. 안 죽으면 테스트가 제품 경로를 안 지난 것. [[mutation-catches-untraveled-paths]]
4. **게이트**: `tests/electron/api/genai.test.js` **무수정 그린** = google adapter 무동작 불변 신호. 매 수정 후 `git diff --stat HEAD -- tests/electron/api/genai.test.js` 가 비어야 함.
5. **리뷰 응답도 리뷰 대상**: 수정 커밋도 다시 리뷰. [[post-merge-fixes-need-review-too]]
6. 커밋 메시지 영어. 마일스톤당 수정 커밋 후 push.

## 2. 마일스톤별 리뷰 유닛 (diff 범위 + focus + 알려진 open findings)

각 유닛: `git diff <parent>..<commit>` 로 그 마일스톤 delta 를 준다. Codex+Fable 에게 "이 diff + 최종 파일 상태 + 아래 open findings 를 검증/종결하라"고 지시. **PROVISIONAL(실 API 미확정) 부분은 finding 아님** — grok/fal/wavespeed/higgsfield 의 엔드포인트/페이로드/에러shape 는 실키 게이트에서 확정.

### M0b — 크로스-provider 기반 (`e91147ca..b30e15fb`)
- **상태: 이미 findings-0 검증됨(2R Codex+Fable).** 재리뷰 우선순위 낮음. 필요 시 dispatcher/handle/keyResolver/errorKind 계약만 스팟체크.

### M1 — OpenAI 이미지 + 전역 선택 (`820df071^..32fe084c`, 즉 `b30e15fb..32fe084c`)
- 파일: `image/openai.js`, `dispatcher.js`(validateKey/actualAspectRatio), `genModels.js`(catalog/heal/imageModelsForProvider/switch/facade), `useAppSettings/useApiKey/useGenAPI/useAutomation/useReferenceGeneration/useSceneGeneration/useStyleGuards`, `SceneTab/ApiKeyTab/SettingsModal`, `providerKeys.js`, `getAccessToken` 게이트.
- **Open/이연 확인**: (a) list-providers `{id,label}` 라벨 join(§5.7) — 현재 `{id}`만. (b) openai seed→`ignoredInputs`(§5.4) 미구현. (c) SettingsModal appMode flow-branch 테스트 갭. → 각각 fix vs keep-deferred 판단.
- **focus**: openai 선택이 모든 생성 경로(배치/씬/레퍼런스/썸네일/단일재생성)에 도달하나(google 오라우팅 0), Flow 모드 gpt-image 누출 0, F1 게이트가 openai-only 사용자 배치 시작 허용.

### M2-선행 — 비디오 경로 provider-aware (`f5994b5c^..72656dc7`, 즉 `32fe084c..72656dc7`)
- 파일: `useVideoAutomation.js`(isGoogleProvider gating), `useGenAPI.js`(video), `video/google.js`(appliedInputs non-enumerable), `dispatcher.js`(rawId 복사), `useAppSettings`(video 스키마), `SceneTab`(video 토글), `videoTextStart.js`.
- **Open(이연 = 실제 미해결 테스트 갭)**: **F2** App.jsx I2V/F2V provider threading 회귀 테스트 없음(App:1730 `videoProvider` 하드코드 뮤턴트 생존). **F3** appliedInputs 영속 patch(App.jsx:1249/1284/1630/1752) 테스트 없음. → **fix 권장**(App-레벨 테스트 추가).
- **focus**: grok 모델이 IPC payload 까지 byte-for-byte 생존(google 무변경), google 페이로드 byte-identical.

### M2 — Grok 비디오 (`72656dc7..f5994b5c`)
- 파일: `video/grok.js`, `index.js`(등록), `dispatcher.js`(rawId vs operationName), `genModels.js`(provisional + videoModelsForProvider/defaultVideoModelForProvider/listSupportedVideoProviders), `SceneTab/ApiKeyTab`.
- **focus**: feature-flag(등록됐지만 UI 숨김), errorKind 403→forbidden 우선, downloadPolicy origin 게이트(이중 독립), 키 xai 슬롯. 알려진 open 없음(Fable 4 findings 전부 fix/equivalent).

### M4 — fal.ai (image+video, SDK) (`f5994b5c..1ed64205`)
- 파일: `falClient.js`, `image/fal.js`, `video/fal.js`, 등록/catalog/UI.
- **Open(이연)**: **F2** fal image AbortSignal 이 IPC 경계 미배선(AbortSignal 비-cloneable) → 배치-stop 이 cap-bounded 만. **fix 옵션**: `genai:cancel` IPC + main AbortController 레지스트리(큼). **F3** validateKey 는 SDK v1.10.1 에 non-billable 검증 없어 no-op(실키 smoke 가 유일 게이트) — keep-deferred 타당.
- **focus**: run-to-completion(이미지 동기 계약), object rawId{model_id,request_id} handle 왕복, authMode:'none'(fal.media 키 미부착), per-op `createFalClient`(싱글톤 변조 0), credit-exhausted→quota(§5.11 G3).

### M5 — WaveSpeed (`1ed64205..9c145f3f`)
- 파일: `wavespeedClient.js`, `video/wavespeed.js`, 등록/catalog/UI. (M6 에서 `gatewayClient.js` 로 리팩터됨 — M6 유닛에서 함께 검증.)
- **focus**: 402→quota(무조건), auth-vs-credit 경계(top-up 전 무동작), HTTP-200 내부실패 분류, model-path '/'-세그먼트 인코딩(G4)+traversal 가드, origin 게이트 이중 독립. 알려진 open 없음(Fable 3 findings fix).

### M6 — Higgsfield + gatewayClient 추출 (`9c145f3f..ad2b525e`)
- 파일: `gatewayClient.js`(신규 공용), `higgsfieldClient.js`, `video/higgsfield.js`, `wavespeedClient.js`(리팩터=no-op), 등록/catalog/UI.
- **핵심 검증**: **gatewayClient 추출이 WaveSpeed 에 char-identical no-op** 인지(wavespeed 테스트 무수정+그린 = 게이트). basic-pair(key:secret→base64 Basic, 첫 콜론 split, empty 가드). 알려진 open 없음(Fable 2 findings fix, F1 은 equivalent-mutant).

### M3 — 씬별 override (`ad2b525e..3881ff3b`)
- 파일: `sceneProviderResolution.js`, `sceneGenerationMerge.js`, `parsers.js`, `useAutomation/useSceneGeneration/useVideoAutomation/useMcpServer/useScenes/useVideoScenes`, `App.jsx`, `startGuard.js`, `mcp-server/**`, `docs/csv-scenes-schema*`.
- **Open(이연 = 미해결, 낮은 우선순위)**: **F4** MCP provider-id 스키마가 카탈로그 미파생(3곳 하드코드) — 새 provider 추가 시 조용히 stale(스펙 §9 체크리스트로 완화). **F5** CSV-임포트 신규씬 generation 검증 스킵(해석 시 fail-safe). **F6** canonicalVideoModel 복구 fallback 이 effective global 아닌 DEFAULT. **F7** `serializeScenesToCSV` 프로덕션 caller 없음(테스트 전용; mcp-server saveCSV 가 실writer). → fix vs keep-deferred 판단.
- **focus**: 씬 override→전역→google 우선순위(모든 생성 경로 배선), CSV 왕복 **count-assert**(golden-test 교훈 — N개 override 정확히 N 생존), MCP deep-merge(§5.8: 누락 보존/null 삭제/provider-only→model null/unknown 거부), 하위호환(generation 없는 씬 = pre-M3 동일).

## 3. 검증 프로토콜 (매 마일스톤)
```bash
# 1) 그 마일스톤 delta 파악
git diff <parent>..<commit> --stat
# 2) 리뷰 findings 재현: 각 confirmed finding 을 뮤테이션으로 실측
cp <src> /tmp/x.bak; perl -0pi -e 's/<원본>/<뮤턴트>/' <src>
npx vitest run <해당 test> 2>&1 | grep -E "^ +Tests"   # fail 나야 = 테스트가 잡음
cp /tmp/x.bak <src>
# 3) 게이트
git diff --stat HEAD -- tests/electron/api/genai.test.js   # 비어야(무수정)
npm run test:run 2>&1 | grep -E "Test Files|Tests "        # 전부 그린
```
- **run 러너**: `npx vitest run <path>`, 전체 `npm run test:run`. vitest "Tests N passed" 출력은 `grep -E "^ +Tests"`.
- 뮤테이션 시 stray 파일 복원 확인(untracked 파일은 `git checkout` 무효 — `.bak` 로 복원).

## 4. 최종 목표 & 종료 조건
- **각 마일스톤 within-scope findings 0** 을 재리뷰로 확인. 이연 findings 는 (a) fix 하거나 (b) "keep-deferred + 근거" 로 명시적 종결(스코프 밖/실키 필요/YAGNI). 애매하게 남기지 말 것.
- 실키·실앱 검증(M1 T6, 게이트웨이 승격, UI 눈검증)은 이 리뷰 스코프 밖(사용자 게이트) — findings 아님.
- 완료 시 메모리 `autoflowcut-multiprovider-progress` 갱신 + push.
