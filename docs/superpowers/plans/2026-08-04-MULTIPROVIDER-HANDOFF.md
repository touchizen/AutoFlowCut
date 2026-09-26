# 세션 핸드오프 — 멀티 프로바이더 (2026-08-04)

> **새 세션은 이 문서부터.** 현재 체크아웃: `feature/multi-provider-genapi` @ `2365a3a7`. `origin/feature/multi-provider-genapi` 와 **동기**(2026-08-05 푸시 완료, ahead 0 / behind 0).
> 스위트 베이스라인: **740 files / 7987 tests 그린** (2026-08-04 세션 종료 시점 실측).

## 0. 왜 여기서 시작하나

직전 세션은 ChatGPT 웹 자동화(`feature/chatgpt-target-p1`)를 진행했다. **동작하는 상태까지 만든 뒤 사용하지 않기로 결정**했고, 그 브랜치는 푸시만 해두고(`origin/feature/chatgpt-target-p1`, 32커밋) 여기로 돌아왔다.

**그 브랜치를 무시해도 되는 이유(실측):** base 대비 순 증가 1358줄 중 **598줄(≈44%)이 존재하지 않는 두 번째 타깃을 위한 배관**이었고, "회귀 방지"라 정리했던 것 대부분이 **그 브랜치가 만든 버그를 그 브랜치가 고친 것**이었다. `flowTargetGate.js` 도 base 에 없던 파일이고, `flow:list-agent-models` 는 base 에서 이미 `flowActive()` 가드가 있었다. 독립적으로 값어치 있는 건 SceneTab 단계별 배지/가격 25줄 정도인데 타깃 인식과 얽혀 있어 그대로 체리픽은 안 된다.

→ **결론: 이 브랜치만 쓰면 된다.** chatgpt 브랜치는 지우지도 병합하지도 말고 보존만.

**ChatGPT 를 접은 근거(재논의 금지):** 정사각형 전용(이 앱은 9:16/16:9 도구), 레퍼런스 업로드 미측정으로 캐릭터 일관성 불가, 셀렉터 3개에 전부가 매달린 취약성. 상세는 `2026-08-04-SESSION-HANDOFF.md`.

## 1. 이 브랜치의 현재 상태 (코드로 확인)

main 대비 **61커밋**. 플랜 문서의 체크박스는 **신뢰하지 말 것** — M0b 플랜은 0/24 로 비어 있는데 커밋 로그엔 M1~M5 작업이 다 있다(구현자가 체크를 안 했다).

**구현된 provider 배관** — `electron/api/providers/`:
```
dispatcher.js  errorKind.js  keyResolver.js  handle.js  http.js  index.js
google/  image/  video/
falClient.js  gatewayClient.js  higgsfieldClient.js  wavespeedClient.js
```

**카탈로그 노출 상태** — `src/config/genModels.js`:
- 비-provisional(실제 노출): **google** 계열
- `provisional: true` (등록됐지만 UI 에서 숨김): **fal**(FLUX Pro 1.1, Kling 2.1), **grok**(Imagine video), **wavespeed**(WAN 2.1 T2V), **higgsfield**(DoP Turbo)
- 규칙: 모든 모델이 provisional 인 provider 는 registry 에 있어도 숨긴다(`genModels.js:88`)

즉 **배관은 있고 실키 smoke 가 안 끝나 잠겨 있는 상태**다.

## 1.5 이번 세션(2026-08-04 오후)에 한 일 — 요약

1. `origin/main` 30커밋 머지(App.jsx import 충돌 1건). **main 에서 물려온 red 테스트 1건 수정** — 3.2.2 릴리스가 `package.json` 만 올리고 `package-lock.json` 을 안 올려 버전 동기 불변식이 깨져 있었다(`origin/main` 자체에서 재현 확인).
2. **F2 통합 취소 완료** — 스펙 3라운드 + 구현 2단계 + 듀얼 리뷰 + 뮤테이션 16종.
3. **appliedInputs API 경로 완료** — 스펙 2라운드 + 뮤테이션 5종.
4. 신규 이연 등재: **F8**(fal 비디오 취소), **F9**(Stop 후 과금된 success 의 discard/salvage — 제품 결정), **F10**(Flow Agent ON 거짓 seed).

**남은 것은 전부 (a) 실앱 눈검증, (b) 실키 게이트, (c) 제품 결정이다 — 코드로 더 진행할 수 있는 항목은 F8/F10 둘 뿐이고 둘 다 Flow/비디오 실앱 검증 게이트를 달고 있다.**

## 2. 다음에 할 일 — 릴리스 블로커부터

전부 `2026-07-20-multiprovider-deferred-findings.md` 에 근거와 재개 조건이 적혀 있다. 그 문서가 **일순위 참고자료**다.

### ✅ F2 — 통합 취소 **완료 (2026-08-04)**
커밋 `383b6232`(main 프로세스) + `2bb6d3e9`(렌더러) + `5b7c5ad3`(뮤테이션 잠금).
스펙: `docs/superpowers/specs/2026-08-04-unified-generation-cancel-design.md` (v2.1+, Codex/Fable 3라운드 findings-0).

- `genai:cancel` IPC + dispatcher 소유 scope 취소 레지스트리 + 세 이미지 어댑터 signal 관통.
- fal 은 `queue.cancel(endpointId,{requestId})` 로 **서버측 취소**(fresh controller + 5초 bound, exactly-once).
- 렌더러: run-per-batch scope(session nonce), **모든** terminal stop(사용자/auth/quota/consume-denied)이 정확히 1회 취소, queue 대기 task 는 첫 줄에서 abort, 생성 호출 직전 재검사.
- abort 결과는 실패로 안 보이고 항목을 pending 으로 복원(G4). 비-abort 실패는 불변(양성 대조군 있음).
- `cancelScope` 미전송 경로는 동작 불변(exact-shape 회귀 테스트 무수정 통과).
- **뮤테이션 16종 실측 kill**(orchestrator 직접 실행, `grep -c` 적용 확인).
- ✅ **실앱 눈검증 완료 (2026-08-05).** API 모드 실키로 확인:
  - `item5-stroller` 배치 중 Stop → **즉시 중단**, 씬 8개 중 `error` 0 / `generating` 잔여 0 / 전부 `pending` 복귀, **이미지 파일 8장 전부 온전**(취소가 기존 결과를 파괴하지 않음).
  - `test6` **Stop 직후 재시작 → 이미지 3장 정상 생성**(17:03, `mediaId:null`/`gemini-3.1-flash-image`/`seed:null`). **1라운드 BLOCKER(scope 재사용 → 취소한 적 없는 새 배치가 무증상으로 죽음)를 실앱에서 닫은 결정적 케이스** — 취소는 에러를 안 띄우므로(G4) 이게 깨졌다면 "에러 없이 아무것도 안 생김"으로 나타났을 것.
  - ⚠️ **눈검증은 google 한정이다 — "F2 완료"를 "전 provider 검증됨"으로 읽지 말 것.**
    - **provider-무관하게 이미 커버된 것**(google 테스트로 증명됨): 렌더러 절반 전체(scope 발급·유일성, run 컨텍스트, terminal stop 배선, D10 pending 복원, 토스트 없음, Stop 후 재시작), dispatcher+레지스트리, Electron fetch 가 실제로 abort 된다는 사실.
    - **openai(`gpt-image-1`)는 provisional 이 아니라 지금 UI 에서 선택 가능하다** — 그런데 취소 실앱 미측정. 위험은 낮다(어댑터 abort 판정이 `signal?.aborted` 기반이라 응답/예외 shape 무관: `image/openai.js:197,222`, retry 루프 없음). 그래도 **추론이지 측정이 아니다** — 키 생기면 같은 절차 2분.
    - **fal 은 취소 표면이 제일 넓고**(폴링 루프+per-await deadline+asset download+서버 `queue.cancel`) **어댑터 자체가 PROVISIONAL**(엔드포인트/payload/shape 추정값). 과금이 실제로 걸리는 게 fal 이므로 **승격 전 실키 smoke 필수** — F2 재개 조건 그대로, 여기에 F8 도 함께.
  - ⚠️ **서버측 중단은 Google API 로는 확인 불가**(취소 엔드포인트 없음 — abort 는 HTTP 연결만 끊고 서버가 완주·과금할 수 있다). 서버 취소가 실재하는 건 fal `queue.cancel` 뿐이고 fal 은 아직 provisional. §D7 상태표가 이미 이 한계를 명시.
- ⚠️ **F2 만으로 fal 승격은 여전히 불가** — F8(비디오) 이 남았다.

### F8 — fal 비디오 server-side 취소(별도 release blocker)
CSV/MCP/persisted provider로 fal video route에 도달할 수 있다(`sceneProviderResolution.js:9,15-16`, `parsers.js:31-43`, `videoTextStart.js:61-74`, `useGenAPI.js:252-265`); `provisional`은 SceneTab dropdown만 숨긴다. 이미지 F2의 AbortSignal registry가 아니라 `video/fal.js:79-92`의 `{model_id,request_id}` generation handle을 decode해 `useVideoAutomation`에서 fal `queue.cancel`로 연결해야 한다. **F2와 동일하게 fal provisional 해제 전 필수.**

### F3 — fal `validateKey` no-op
SDK v1.10.1 에 non-billable 검증 엔드포인트가 없어 임의 문자열도 `{valid:true}`. UI 오표기는 이미 수정됨(fal 전용 "저장됨(미검증)" 토스트). billable "cheapest submit" 검증은 **사용자 크레딧을 동의 없이 소모하므로 no-op 보다 나쁘다** → keep-deferred 유지. SDK 가 자격 엔드포인트를 추가하면 재검토.

### provisional 해제 (사용자 게이트)
grok/fal/wavespeed/higgsfield 의 엔드포인트·페이로드·에러 shape·정확 origin 은 **실키 smoke 로만 확정**된다. 이건 finding 이 아니라 게이트다 — 실제 키가 있어야 진행 가능하다.

### ✅ appliedInputs 공용 계약 — **API 경로 완료 / Flow 절반 남음 (2026-08-04)**
커밋 `5ecf6a42`. 스펙: `docs/superpowers/specs/2026-08-04-image-applied-inputs-design.md` (v2, Codex 2라운드 findings-0).

- `useGenAPI.generateImage` 가 `appliedInputs: {}` 를 선언(= "seed 적용 안 함") → `imageFinalize` 가 **선언된 것만** 기록 → API 이미지는 `seed: null`.
- 3-상태 계약: **미선언 ≠ `{}`**. 미선언은 레거시 폴백(회귀 0), `{}` 는 "적용 안 됨".
- **Flow 는 한 줄도 안 건드렸다.** 단 ⚠️ Flow 도 같은 `finalizeGeneratedImage` 를 통과하므로, 회귀를 막는 건 "Flow 코드 0줄"이 아니라 **미선언 분기가 옛 `seed ?? null` 을 그대로 실행**한다는 사실이다. absent 와 `{}` 를 합치면 Flow 도 죽는다 → Flow 대칭 테스트가 그 게이트다.
- echo 우선(`firstImage.seed`/`result.seed`) 유지, seed `0` 생존(`??`, `||` 아님). 뮤테이션 5종 실측 kill.
- ✅ **실앱 눈검증 완료 (2026-08-05).** 같은 프로젝트(`item5-stroller`)·같은 프롬프트로 A/B 대조:
  - 16:50:49 **Flow** → `mediaId` UUID, model `Nano Banana 2`, **seed 130204**(설정 seed, 폴백 유지 = 회귀 없음)
  - 16:55:19 **API** → `mediaId null`, model `gemini-3.1-flash-image`, **seed null**(수정 적용)
  - scene state 와 `scenes/history/*.json` sidecar 양쪽 일치. **API 의 `seed:null` 은 이 수정 없이는 나올 수 없는 값이라, 실행 앱이 최신 빌드임도 동시에 증명됐다**(그 덕에 Flow 관측도 소급 유효).
  - ⚠️ 판별 팁: `Nano Banana 2`(라벨)와 `gemini-3.1-flash-image`(id)는 **모드 구분자가 아니다** — 라벨이 API/Flow 양쪽에 쓰인다. 확실한 구분자는 **`mediaId`**(API 는 `useGenAPI.js:173` 에서 항상 null).
- ⚠️ **남은 절반 = F10**: Flow **Agent ON** 은 seed 를 실제로 안 보내는데(주입이 `batchGenerateImages` URL 게이트에 걸림, `flow-page-injection.js:198`) 폴백이 기록한다 → 같은 거짓 metadata. Flow submit→collect 운반 계약 + 실앱 검증 필요.

### 명시적으로 안 할 것 (근거 있음)
- `genai:list-providers` 를 `{id,label}` 로 확장 — 렌더러 소비자 0, label authority 부재. label 을 실제 읽는 소비자가 생길 때 하면 된다
- `SettingsModal` appMode flow-branch 테스트 갭 — 프로덕션 결함 아님. 그 분기가 지키는 경로는 누출을 만들 수 없다(SceneTab 이 flow 시 `imageProvider='google'` 강제)

## 3. 참고 문서

| 문서 | 용도 |
|---|---|
| `2026-07-20-multiprovider-deferred-findings.md` | **일순위.** 미해결 항목의 근거와 재개 조건 |
| `2026-07-20-multiprovider-review-to-findings-zero.md` | findings-0 리뷰 이력 |
| `2026-07-18-m0b-cross-provider-foundation.md` | 기반 설계 (체크박스는 무시) |
| `2026-07-18-m1-openai-image-provider.md` | OpenAI 이미지 |
| `2026-08-04-SESSION-HANDOFF.md` | ChatGPT 를 접은 경위 |

## 4. 이 프로젝트에서 반복해서 물린 것 (직전 세션에서 전부 실제로 밟음)

1. **"플랜대로 구현" ≠ "스펙 만족".** findings-0 플랜이 스펙 게이트와 충돌한 적이 있다. 완료 판정은 체크박스가 아니라 스펙 문장으로.
2. **가드를 `!= null` 로 쓰기 전에 앱 기본값과 대조하라.** `aspectRatio`(기본 `'16:9'`)와 `seed`(기본 잠김+랜덤)에서 연속 두 번, 기능 전체가 IPC 전에 죽는데 스위트는 초록이었다. 거부 조건마다 "앱이 기본값으로 뭘 보내는가" 전수 대조표를 만들 것.
3. **손으로 만든 fixture 로 통합 테스트를 쓰지 마라.** 실제 settings 훅 → 실제 파생 → 실제 호출부를 통과시켜라. 중간을 shim 으로 이으면 그 레이어의 가드는 영원히 안 잡힌다.
4. **게이트의 전제 상태가 실앱에서 어떻게 만들어지는지 물어라.** 뮤테이션이 전부 죽고 스위트가 초록이어도 프로덕션에서 한 번도 안 걸릴 수 있다.
5. **기능을 지울 때 그 테스트 파일에 남의 회귀 커버리지가 얹혀 있는지 확인하라.**
6. **Codex MCP 타임아웃 ≠ 작업 종료.** 프로세스가 계속 쓴다. mtime 스냅샷 2회 비교로 쓰기 정지를 확인한 뒤 커밋할 것. 중간 상태를 커밋하면 이후 뮤테이션 결과가 전부 무효다.
7. **뮤테이션은 `grep -c` 로 적용을 확인하라.** 패턴이 안 맞으면 "살아남음"으로 거짓 판독한다.
8. **리뷰어 합의는 실측을 대신 못 한다.** 직전 세션에서 6번 갈렸고 6번 다 코드 측정이 판정했다. 양쪽이 각각 맞은 적이 있다.
9. **(2026-08-04 신규) 리뷰어가 갈리면 "누가 더 그럴듯한가"가 아니라 술어를 직접 열어라.** 이번 세션에 두 번 갈렸고 **두 번 다 Codex 가 맞았다** — 둘 다 Fable 이 *무장(arming)* 코드만 보고 *적용을 결정하는 술어*를 안 열어서 생긴 오판이었다:
   - fal 비디오 도달성: Fable 은 SceneTab 드롭다운만 보고 "provisional 이라 unreachable" → 실제로는 `isKnownVideoProvider` 가 provisional 필터 없이 전체 `VIDEO_MODELS` 로 만들어져 **CSV `t2v_provider=fal` 이 통과**한다.
   - Flow seed 적용: Fable 은 `flow-api.js:391`(주입 무장)만 보고 "Flow 는 seed 를 보낸다" → 실제 주입은 `flow-page-injection.js:198` 의 `url.includes('batchGenerateImages')` 게이트라 **Agent ON(streamChat)은 안 보낸다**.
10. **(2026-08-04 신규) 내가 만든 도달-불가 finding 을 조심하라.** 이연 항목을 쓸 때 "국소 사실 A(어댑터가 model 을 echo 안 함) + 국소 사실 B(기본값이 `'flow'`)" 를 이어 붙여 **실제로는 도달하지 않는** 결함(F11)을 등재할 뻔했다. 두 사실 사이를 **프로덕션 호출부로 연결해 보기 전엔** finding 이 아니다. 리뷰어가 잡았다.
11. **(2026-08-04 신규) 공용 sink 를 바꾸면 "그 기능 코드를 안 건드렸다"는 회귀 부재의 근거가 못 된다.** appliedInputs 는 Flow 파일을 0줄 건드렸지만 Flow 도 같은 `finalizeGeneratedImage` 를 지난다 — 실제 보호는 **미선언 분기가 옛 식을 그대로 실행**하는 것이고, 그래서 Flow 대칭 테스트가 필수다.

## 5. 워크플로우

- 어려운 저작 = Codex(gpt-5.6-sol, xhigh) / 리뷰 = **Fable 5 + Codex 병렬 findings-0 까지** / 검증 = 오케스트레이터(뮤테이션 실측, raw diff 스코프 확인)
- **리뷰를 건너뛰면 대가를 치른다** — 직전 세션에 구현 6커밋을 리뷰 없이 쌓았다가 Critical 2건이 사용자에게 도달했다
- Codex 가 이 레포에서 6연속 타임아웃 — 긴 작업은 결과를 파일에 증분 저장시키고, 안 끝나면 저자를 Fable 로 교체
- 커밋 메시지는 영어
- `docs/superpowers/**` 는 gitignore — 이 문서들은 디스크에만 있다
