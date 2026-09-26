# 멀티-프로바이더 리팩터 — 이연(keep-deferred) findings 명시 종결

> 2026-07-20 findings-0 재리뷰 세션 산출물. 각 마일스톤을 Codex(gpt-5.6-sol, xhigh) + 2nd 독립 리뷰어(Fable 5 → 토큰 소진 후 Opus)로 재리뷰해 **within-scope findings 0** 을 수정으로 닫았고, 아래 항목은 스코프 밖/실키 필요/YAGNI 근거로 **명시적으로 keep-deferred** 한다. 애매하게 남기지 않는다.

## 종결 규칙
- keep-deferred = 재리뷰에서 확인했으나 (a) 현 마일스톤 스코프 밖이거나 (b) 실키/실앱 게이트(사용자)거나 (c) 도달 불가/YAGNI 인 항목. 각 항목에 근거 + 재개 조건을 남긴다.
- PROVISIONAL(실 API 미확정: grok/fal/wavespeed/higgsfield 엔드포인트·페이로드·에러shape·정확 origin) 은 finding 이 아니다 — 실키 smoke 게이트에서 확정.

## M4 (fal.ai) — 릴리스 블로커(사용자 게이트)
- **F2 — fal 이미지 배치-stop 이 IPC 취소 미배선.** 동기 `generateImage` IPC 경로에 AbortSignal 이 렌더러→main 으로 전달되지 않아, Stop 후 in-flight fal 이미지가 완주(과금)한다. 실 취소는 `genai:cancel` IPC + main AbortController 레지스트리 + fal SDK `queue.cancel(endpointId,{requestId})` 가 필요(레지스트리만으론 서버측 과금 못 막음). google/openai 이미지도 동일 IPC-취소 부재라 fal 만 급히 고치면 stop 의미가 provider별로 달라진다.
  - **재개 조건**: fal 을 provisional 에서 승격(카탈로그 노출)하기 **전** 통합 취소 설계로 구현. §5.13(h) "배치 stop→AbortSignal 전달" 는 이 시점까지 미충족 상태(엔드-투-엔드)임을 명시. 어댑터는 signal 을 존중하나 dispatcher.generateImage 가 signal 을 만들지/받지 않음.
  - 완화 완료: 어댑터 wall-clock deadline(300s)+outer 배치 budget(315s), per-await `withFalDeadline`, non-finite clamp 로 "Stop 후 무한 대기"·"stuck await"·"과금 이미지 timeout 폐기" 는 이번 세션에 이미 닫음. 남은 건 **의도적 조기 취소**뿐.
  - abort-during-download 이 success 반환하는 케이스는 프로덕션 미도달(어댑터에 signal 미배선) → F2 취소 인프라와 함께 닫는다.
- **F8 — fal 비디오 server-side Stop 미배선.** 번호가 F4~F7을 건너뛴 이유: 그 ID들은 아래 “이번 세션에 수정한 findings”의 종결된 M3 항목(`:40-43`)에 이미 쓰였다. 이 finding은 신규·미해결이라 충돌하지 않는 F8을 쓴다.
  - **도달성 증거:** `VIDEO_PROVIDER_IDS`는 provisional filter 없이 전체 `VIDEO_MODELS`로 만들어진다(`src/utils/sceneProviderResolution.js:9,15-16`). CSV parser는 `isKnownVideoProvider('fal')`을 통과시켜 `generation.video.t2v/i2v.provider`에 넣는다(`src/utils/parsers.js:31-43`). `src/services/videoTextStart.js:61-74`와 `src/services/videoI2VStart.js:15-23`가 persisted/CSV provider를 start options에 싣고, `src/hooks/useVideoAutomation.js:109-125,304-311,615-620`이 item provider를 generation call로 전달하며, `src/hooks/useGenAPI.js:252-265,274-289`가 `genaiGenerateVideo` IPC를 호출한다. 따라서 `provisional`은 SceneTab dropdown만 숨길 뿐 production route를 닫지 않는다.
  - **과금 job/취소 키:** fal adapter는 I2V start image가 있으면 SDK `queue.submit`을 하고 `{model_id,request_id}` raw handle을 반환한다(`electron/api/providers/video/fal.js:61-92`); dispatcher가 versioned handle로 인코딩한다(`electron/api/providers/dispatcher.js:120-125`, `electron/api/providers/handle.js:29-35,64-87`). Stop은 이 handle을 decode해 `useVideoAutomation`에서 `queue.cancel(model_id,{requestId})`로 연결해야 한다. 이미지 F2의 renderer→main AbortSignal registry와 공유할 수 없는 별도 handle-cancel 메커니즘이다.
  - **재개/릴리스 gate(F2와 동일):** fal을 provisional에서 승격하기 **전에 반드시** 구현·real-key smoke로 검증한다. **F2만 닫아서는 fal 승격 불가**다.
- **F3 — fal validateKey no-op.** SDK v1.10.1 에 non-billable 키 검증 엔드포인트가 없어 임의 문자열도 `{valid:true}`. 실 검증은 real-key submit smoke 가 유일 게이트.
  - **UI 오표기는 이번 세션에 수정**(fal 전용 "저장됨(미검증)" 토스트, verified 문구 제거). no-op 자체는 안전(빈 키만 invalid; 잘못된 키는 첫 생성 시 401→errorKind:'auth'→키 모달 복구). billable "cheapest submit" 검증은 사용자 크레딧을 동의 없이 소모하므로 no-op 보다 나쁨 → keep-deferred 유지.
  - **재개 조건**: SDK 가 non-billable 자격 엔드포인트를 추가하면 재검토.

## 공용 생성 Stop 의미론 — 제품 결정 대기

- **F9 — Stop 뒤 이미 과금된 `success:true` 결과를 discard할지 salvage할지 미결정.** F8 다음 신규 ID를 쓴다. direct-call path에서 Stop이 도착했을 때 provider 생성과 과금은 이미 끝났을 수 있다. publish를 막으면 사용자가 지불한 결과를 폐기하고, 허용하면 Stop 뒤 새 결과가 나타난다. 이는 in-flight work를 AbortSignal로 중단하는 F2와 직교하는 제품 정책이다.
  - **현재 불일치:** Automation의 미수집 항목은 Stop 시 pending으로 복원한다(`src/hooks/useAutomation.js:450-458`). 반면 Style direct는 늦은 success를 저장한다(`src/hooks/useStyleThumbnails.js:169-184,235-240`)고 single Reference도 처리·저장한다(`src/hooks/useReferenceGeneration.js:452-466`). “현재 동작 유지” 자체도 하나의 통일된 의미론이 아니다.
  - **F2 경계:** F2의 D10 gate는 구조화 `aborted:true` 결과에만 적용한다. `run.cancelSent`/`stopRequestedRef.current`로 success publish를 막지 않는다.
  - **재개 조건:** 제품이 billed result를 **discard**할지 **salvage**할지 결정하고, Automation/Style/Reference 세 sink를 하나의 정책으로 통일할 때. 비용·사용자 기대를 확인하는 UX 결정 없이는 구현하지 않는다.

## M1 (OpenAI 이미지 + 전역 선택) — 리뷰어 판정 분기, 조정 결과 keep-deferred
> Codex 는 세 건 FIX-NOW, Opus 는 세 건 KEEP-DEFERRED 로 갈렸다(충돌=실측 신호). 두 리뷰어가 **공통으로 확인한 사실**: 세 건 모두 openai 가 새로 만든 도달가능 결함이 아니다(google 과 동일·미사용·도달불가). 조정 결과 아래 근거로 keep-deferred. 대신 openai-특정 실결함 2건(base64 공백/게이트)은 이번 세션에 **수정 완료**(커밋 db3a67d2 P1 외).

- **(a) `genai:list-providers` shape 가 `{id}` (스펙 §5.7 은 `{id,label}`).** 렌더러 소비자 0 — provider 선택 UI 는 카탈로그(`listSupportedImageProviders/VideoProviders`) 기반이고 이 IPC 는 preload+테스트만 호출. 기능 표면 0. label authority 도 현재 없어 지금 추가하면 미사용 필드를 위한 추정 코드.
  - **재개 조건**: label 을 실제 읽는 소비자가 생길 때(자연스러운 자리 = appliedInputs 계약 정리).
- **(b) openai seed→`ignoredInputs`(§5.4).** 이미지 경로는 seed 를 **어떤 이미지 어댑터에도** 전달하지 않는다(useGenAPI/dispatcher 가 drop, google image 도 seed 없음). 그러나 `imageFinalize.js` 가 provider 무관하게 설정 seed 를 씬/파일 metadata 에 기록 → 실제로는 잠긴-seed 사용자가 openai(및 google) 이미지에서 "적용 안 된 seed" 를 저장(§5.4 가 경계하는 거짓 metadata). **이는 provider-무관·M1 이전부터 존재**(openai 는 google 대비 신규 회귀 0).
  - 근거: 올바른 수정은 openai 전용 조건문이 아니라 **공용 이미지-결과 계약**(어댑터가 applied/ignored 입력 반환 + finalize 가 실제 적용된 seed 만 기록) 이며 google + Flow 를 함께 건드린다. Flow 는 요청 seed 를 echo 안 할 때 설정-seed 폴백에 의존 → 제거 시 Flow 회귀 위험(실앱 검증 필요, 스코프 밖). 따라서 **M2-pre appliedInputs 계약**에 속하지 M1 openai 스코프가 아님.
  - **재개 조건**: 이미지 appliedInputs/ignoredInputs 공용 계약 작업(별도) + Flow 실앱 검증.
  - ✅ **API 경로는 2026-08-04 종결**(커밋 `5ecf6a42`). `useGenAPI.generateImage` 가 `appliedInputs: {}` 를 선언하고 `imageFinalize` 가 선언된 것만 기록 → API 이미지는 `seed: null`. 스펙 `2026-08-04-image-applied-inputs-design.md`(v2, Codex 2라운드 findings-0), 뮤테이션 5종 실측 kill. **Flow 는 한 줄도 안 건드렸다** — 미선언 → 레거시 폴백 유지. 남은 Flow 절반은 아래 F10.

## 이미지 metadata 정확성 — Flow 잔여 (2026-08-04 신규)

- **F10 — Flow Agent ON 이 적용하지 않은 seed 를 metadata 에 기록한다.** F9 다음 신규 ID.
  - **증거:** seed 는 페이지 monkey-patch 로 주입되는데 그 주입이 **URL 게이트**에 걸려 있다 — `electron/flow-page-injection.js:198` 의 `url.includes(URL_BATCH_IMG)` (`URL_BATCH_IMG = 'batchGenerateImages'`, `:77`). Agent **OFF** 는 `batchGenerateImages` 로 가서 주입되지만, Agent **ON** 은 `streamChat`(SSE, `electron/ipc/flow-api.js:428,449`)으로 가므로 **주입되지 않는다**. 그런데 `imageFinalize` 의 미선언-레거시 폴백이 설정 seed 를 기록한다 ⇒ API 경로와 같은 종류의 거짓 metadata.
  - **왜 이번에 안 고쳤나:** 고치려면 Flow 가 `appliedInputs` 를 선언해야 하는데, Flow 배치는 submit 반환이 아니라 **collect 결과**가 finalize 로 가고(`useAutomation.js:236→270`) `engineFlow.collectGeneration`(`:494-498,:533-538`)은 제출 시점 seed 를 모른다 → submit→collect 운반 계약을 새로 만들어야 한다. Flow 는 실앱 검증 없이 만질 수 없다(M1 (b) 가 경고한 G3 위험).
  - **재개 조건**: Flow submit→collect appliedInputs 운반 설계 + **실앱 눈검증**(Agent ON/OFF 양쪽).
- **(c) SettingsModal appMode flow-branch 테스트 갭.** 프로덕션 코드 결함 아님(테스트 커버리지만). "Flow 모드에서 gpt-image 누출 금지" 불변식은 SceneTab 레벨에서 이미 테스트됨(`SceneTab.test.jsx`), 그리고 `SettingsModal.jsx` 의 해당 분기는 **잉여**(SceneTab 이 flow 시 `imageProvider='google'` 강제+재필터 → 잠긴 openai 는 빈 목록이지 gpt-image 아님). 즉 미테스트 분기가 지키는 경로는 누출을 만들 수 없음.
  - **재개 조건**: 저비용이면 `SettingsModal appMode="flow"` + persisted `provider:'openai'` 렌더 테스트 추가(낮은 가치).

## 이번 세션에 수정한 verify-라운드 findings (참고 — 종결됨, 이연 아님)
- M2-pre: F2/F3(App 결과 patch·I2V start 추출) + 5결함(provider-aware 다운로드 라우팅, errorKind 관통, per-item provider 영속, appliedInputs 왕복, stale clear).
- M3: F4~F7 + G1~G5 + H1~H4 + I1/I2 + J1 (카탈로그 핀, CSV unknown-provider 거부, 모델-only merge, recovery 모델 provider, 경고 표면화, sparse re-nest 병합, null-stage 직렬화, provider-변경 모델 리셋).
- M4: K1~K6 + L1~L4 + M1 + N1 (엔드포인트-id 게이트, 402/credit 분류, quota 소비자 객체 전달, provider-aware timeout, deadline 강제, non-finite clamp).
- M1/M2/M5: P1(openai base64 공백 정규화 = google 패리티), P2(grok adapter-side origin 게이트 = §5.6 이중독립), P3(gatewayClient 402→quota 무조건 = §5.11).
- 전부 뮤테이션 검증 + `genai.test.js` 무수정 게이트 + 전체 6872 그린.
