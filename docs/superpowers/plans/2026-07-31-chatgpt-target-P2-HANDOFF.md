# ChatGPT 정식 기능 — P1/P2 진행 기록 (2026-07-31 ~ 08-03) · **SUPERSEDED**

> ⚠️ **이 문서는 진행 중 기록이다. 새 세션은 `2026-08-04-SESSION-HANDOFF.md` 를 읽어라.**
> 결말: ChatGPT 타깃은 **동작까지 만든 뒤 제거**됐다(2026-08-04). 아래 §0~§8 은 그 과정의 이력이며, 상단 상태 표기는 낡았다.

## 0. 지금 위치

- **P1 ✅ 완료** — 브랜치 `feature/chatgpt-target-p1` (base `feature/multi-provider-genapi` @ `9c39157a`), 커밋 10개, **미푸시**
- 스펙: `docs/superpowers/specs/2026-07-30-chatgpt-target-design.md` (v8 findings-0)
- 플랜: `docs/superpowers/plans/2026-07-30-chatgpt-target-p1-foundation.md` (8 태스크, 전부 구현)
- **P2 플랜 ✅ findings-0** — `docs/superpowers/plans/2026-07-31-chatgpt-target-p2-adapter.md` (2532줄, 16 태스크 = 스파이크 2 + 빌드 14). 리뷰 3라운드(Fable 5 + Codex 병렬), 리뷰어 충돌 3건은 전부 코드 실측으로 판정.
  - hard order: **3 → 1 → 2 → 16 → 5 → 4 → 6 → 9 → 7 → 8 → 10 → 11 → 12 → 13 → 14 → 15**
  - 각 태스크에 `[무조건]` / `[R1/R2 조건부]` 라벨 — 로그인 없이 갈 수 있는 범위가 명확함
  - §3 의 P1 잔여 5건은 이미 P2 태스크로 흡수 완료(Task 3/4/5/13)
- **P2 구현 진행 중** — 브랜치 커밋 **20개**, 전체 스위트 **756 files / 7929 tests** 그린, **구현 리뷰 findings-0**(Fable 5 + Codex 둘 다 YES)
  - ✅ Task 3(서브프레임 가드 + Flow 채널 재분류) · Task 1 하네스 · Task 16(전환 배리어 + route:set 이관) · Task 5(타깃 레지스트리 + dev ChatGPT 뷰) · Task 4(타깃별 authReady + stage별 배지)
  - ✅ **타깃 콤보 UI**(스펙 §5, 주소창 자리) — 사용자 결정으로 P3 에서 앞당김. **dev 플래그 전용**이라 스펙의 "옵트인이 선택 가능성보다 먼저" 순서는 유지됨
  - 🛑 남은 차단: R1/R2 측정에 실제 ChatGPT 로그인 필요. 이제 **콤보로 로그인 가능**(아래 §5)
  - ⚠️ **콤보는 실앱 눈검증 미실시** — jsdom 이 레이아웃을 못 본다

### 브랜치를 왜 multi-provider 에서 땄나
플랜 앵커가 그 브랜치에만 있다(코드로 확인): `genModels.js:198 computeModelHeal`(main 은 116행), `SceneTab` 의 `imageProviders = SUPPORTED_IMAGE_PROVIDERS`(main 에 없음). multi-provider 는 아직 main 에 없고 원격엔 푸시돼 있다.

## 1. P1 이 실제로 보장하는 것 (실측)

전체 스위트 **735 files / 7799 tests** 그린. 게이트 전부 통과:

| 게이트 | 결과 |
|---|---|
| 기존 Flow 테스트 무수정 | **브랜치의 모든 `tests/` 변경이 ADD** — 기존 테스트 수정 0건 |
| `tests/electron/api/genai.test.js` | 무수정 |
| route 저장키 | `src/config/appRoute.js` 밖에 전혀 없음 |
| 렌더러 `setRoute` 호출 | 없음 (P1 은 route IPC 로 이관 안 함) |
| `needsFlowView` / `useGenerationEngine` / spike 파일 | 미변경 |
| P1 음성 게이트 | `flow+chatgpt` 가 Flow 부수효과·뷰 attach 거부 — **실앱 end-to-end** |

## 2. 리뷰에서 실제로 잡힌 것 (다음에 또 밟지 말 것)

**밀레스톤 리뷰(Fable 5 + Codex 병렬)가 수렴한 BLOCKER — 스펙과 플랜이 충돌했다.**

플랜은 `렌더러 attach effect [mode] 는 그대로 둔다` / `setMode 호출부는 P1 에서 바꾸지 않는다` 를 명시했는데, 그 결과 스펙 §10 P1 게이트가 **유닛테스트 안에서만** 성립했다. 실측한 누수 사슬:

1. `src/` 어디도 `setRoute` 를 부르지 않음 → main 의 `sessionTarget` 은 shipped P1 에서 **영구히 `flow`**. Task 5 의 main 쪽 타깃 게이트는 프로덕션에서 한 번도 안 걸림.
2. 반면 **렌더러는** 저장키로 `flow+chatgpt` 에 도달 가능 (스펙 §10 표 5행이 그 상태를 보존하라고 함).
3. `App.jsx:313` attach effect 가 `[mode]` 만 보고 무조건 `setMode({mode:'flow'})` push → main 이 자기 route 로 타깃을 해석(`flow`) → **Flow 뷰 생성·attach·FLOW_URL 로드**.
4. `useGenerationEngine.js:21` 은 `mode === 'flow' ? engineFlow : engineApi` (P1 동결) → `flow+chatgpt` 에서 `genAPI` 가 **engineFlow**. `App.jsx:1655/1922` 의 fall-through 가 `start()` 를 태워 **실제 Flow 생성 + 쿼터 소모**.
5. 하필 이걸 막던 두 방벽(`runOuterStartAuthPreflight`, `checkFlowProjectReady`)이 P1 이 chatgpt 타깃에서 꺼버린 바로 그것들.

**사용자 판정: 스펙 우선.** 커밋 `c3972357` 로 수정 — attach effect 를 `flowTargetActive` 로 게이트(→ main 이 `api` 로 남아 기존 mode 게이트가 fail-closed 로 동작하는 부수 효과), 그리고 공유 가드 `refuseIfSessionTargetUnsupported()` 를 생성 진입점 12곳에 적용.

**교훈 (다음 마일스톤에도 적용):**
- **"플랜대로 구현했다"가 "스펙을 만족한다"를 뜻하지 않는다.** findings-0 플랜도 스펙과 어긋날 수 있다. 게이트는 스펙 문장으로 직접 검증할 것.
- **유닛테스트에서만 성립하는 게이트를 조심하라.** Task 5 의 모든 뮤테이션이 죽었지만, 그 게이트는 프로덕션에서 도달 불가 상태였다. "이 상태가 실앱에서 어떻게 만들어지나?"를 항상 물을 것.
- **오케스트레이터 오판 사례:** Task 7 검증 때 이 fall-through 를 보고 "의도된 동작, P1 에선 도달 불가"로 판정했다. 둘 다 틀렸다 — 저장 상태로 도달 가능했고, fall-through 목적지는 API 경로가 아니라 engineFlow 였다. **한 줄만 보지 말고 `genAPI` 가 무엇인지까지 따라갈 것.**

**그 외 리뷰가 잡은 것:**
- Codex 가 플랜 신규 테스트의 `.js` vs `.jsx` mock 경로 오타를 **프로덕션 shim 파일 추가**로 우회하려 함 → 테스트 경로 수정으로 되돌림. 프로덕션 소스를 테스트 편의로 늘리지 말 것.
- Codex 가 `getByText` 단일 매치를 맞추려고 **SceneTab 의 T2V/I2V 배지를 삭제** → 기존 Flow UI 회귀. 이걸 덮는 기존 테스트가 없어 전체 초록불 아래 숨었다. `getAllByText` + 배지 5곳 복원으로 수정.
- `mode.route.test.js` 의 "invalid 요청 무부수효과" 픽스처가 **기본 route 상태**라 "변경 없음"과 "기본값으로 리셋"을 구분 못 했다 → 비-기본 route 로 픽스처를 옮겨 수정.

## 3. P2 로 넘긴 항목 (사용자 결정으로 명시적 연기)

**P2 첫 태스크로 흡수할 것:**

1. **read-only 채널 재분류** — `FLOW_READ_ONLY_CHANNELS` 에 실제로는 mutation/원격요청인 것들이 섞여 있다. `flow:list-agent-models`(settings 패널을 synthetic click 으로 열고 닫음), `flow:validate-token`/`flow:list-projects`/`flow:fetch-gallery`(인증 원격 요청). 현재 실앱 영향: `flow:list-projects` 가 `Authorization: Bearer null` 로 1회 요청 → 401. 부수효과·쿼터 없음.
2. **`hasFlowArchive` 를 타깃 인식으로** — `useGenerationEngine.js:26` 이 `mode === 'flow'` 라 chatgpt 타깃에서도 아카이브 UI 가 보이고 조용히 실패한다.
3. **`will-frame-navigate` 추가** — `electron/sessionViewSecurity.js` 는 `will-navigate`/`will-redirect` 만 건다. Electron 36 에서 `will-navigate` 는 main frame 전용이라 iframe 이 allowlist 를 우회한다. **P1 에선 dormant(URL 을 아예 안 띄움) 이지만 P2 가 chatgpt.com 을 로드하기 전에 반드시 닫을 것.** 두 리뷰어가 독립적으로 지적함.
4. **`authReady` 를 타깃별로 분리** — reset effect 가 `[mode]` 만 봐서, Flow 인증 상태가 타깃만 바뀌면 "ChatGPT 로그인됨"으로 오라벨된다. 신규 테스트가 그 잘못된 동작을 고정하고 있으니 테스트도 같이 고칠 것.
5. **SceneTab 단계별 배지/가격** — 진리표상 `flow+chatgpt` 는 image=ChatGPT, t2v/i2v=API 인데 배지 하나를 세 섹션이 공유해 T2V/I2V 도 "ChatGPT"로 표시된다.

**⚠️ P2 지뢰 (두 리뷰어 공통 지적):**
현재 fix 는 attach push 를 억제할 뿐 **detach 를 emit 하지 않는다.** P1 에선 런타임 중 타깃 변경이 불가능해 안전하다. **P2 가 인런 타깃 전환(콤보)을 붙이는 순간**, `flow+flow` → `flow+chatgpt` 전환은 Flow 뷰를 attach 된 채로 남기고 main 의 route 도 `flow+flow` 로 남겨 main 게이트를 무장해제시킨다. **타깃 전환은 반드시 `route:set` 을 통해야 하고, in-flight automation 취소/재확인이 필요하다.**

**연기된 minor:**
- `gateFlowSideEffectIpc` 의 `{...ipcMain}` 은 프로토타입 메서드를 잃는다(실측: `spread.on`/`removeHandler` undefined). 지금은 4개 모듈이 `.handle` 만 써서 안전하지만, 테스트가 평범한 `{handle}` 객체를 넘기므로 **미래에 그 모듈에 `ipcMain.on` 을 추가하면 실앱에서만 깨진다.**
- `FLOW_SIDE_EFFECT_CHANNELS` 의 main-local 2개 엔트리는 무동작 문서다(집합은 `gateFlowSideEffectIpc` 만 읽고, main.js 는 `guardFlowSideEffect` 로 직접 감싼다). 뮤테이션이 안 죽는 건 equivalent mutant 로 판정됨.
- `App.jsx` 의 중복 outer `if (modeRef.current === 'flow')` 2개는 frozen 테스트 `App.emptyRefGateWiring.test.js` 가 그 소스 문자열을 핀하기 때문에 남았다. 실제 차단은 안쪽 `flowTargetActiveRef`.
- 거부 시 `runningStyle` 스냅샷이 남는다(다음 정상 시작이 덮어씀, cosmetic).

## 4. 남은 확인

- **실앱 눈검증 미실시.** UI 변경이 있다: ModeToggle 세그먼트가 하드코딩 "API"/"Flow" → 지역화 전체 모드명("API 키 모드"/"로그인 모드")으로 바뀌어 **헤더 컨트롤 폭이 눈에 띄게 넓어진다.** 레이아웃은 어떤 테스트도 못 본다.
- 브랜치 미푸시. main 병합 여부 미결정.


## 5. 지금 막혀 있는 것 — 사용자 액션 필요

### ① R1 스파이크: ChatGPT 로그인 (P2 진행의 유일한 차단점)
스펙이 순서를 고정했다: `업로드 스파이크(R1) → 턴 상관(R2) → 어댑터 이식`. R1 결과가 레퍼런스 이미지 설계를 결정하므로 **추측 구현 금지**가 스펙 결정사항이다.

R1 이 측정하는 것: CDP 없이 ChatGPT 턴에 이미지를 붙일 수 있는가, 어떤 메커니즘으로, DOM/셀렉터 표면은 무엇인가, 실패 모드는, 턴당 복수 레퍼런스가 가능한가, 그리고 로그인 신호 표면(`ensureSession` 의 producer 가 됨).

**이제 콤보로 로그인한다** (Task 3 subframe guard 는 이미 land 했으므로 순서 조건 충족):

```bash
cd ~/workspace/AutoFlowCut-main && AUTOFLOWCUT_CHATGPT_P2=1 npm run dev
```
1. 로그인 모드로 전환
2. 임베드 뷰 상단 콤보에서 `ChatGPT` 선택
3. 열린 ChatGPT 뷰에서 로그인
4. 세션은 `persist:chatgpt` 에 보존 — Flow 로 갔다 와도 유지

로그인 없이 R1 하네스를 돌리면 `BLOCKED: human ChatGPT login required` 로 종료하고 어떤 성공도 기록하지 않는다.

### ② P3: 옵트인·계정 리스크 고지 문구 (제품 결정)
스펙 §10 은 P3 를 `옵트인·계정 리스크 고지(이게 선행) → 타깃 콤보 → …` 로 못 박았다. "ChatGPT 계정이 정지될 수 있다"를 **어떤 문구로 어디까지 고지할지는 제품/법무 결정**이라 대신 정할 수 없다. 이게 정해지기 전엔 P3 첫 태스크를 쓸 수 없다.

또한 P3 의 `Grok provisional 해제(R7)` 는 실제 키로 smoke 를 돌려야 풀린다.

### 로그인 없이 지금 갈 수 있는 범위
hard order 상 `Task 3` 은 `[무조건]` 이고 R1 앞이다. 즉 **Task 3(subframe guard + Flow 채널 재분류)은 지금 바로 TDD 구현 가능**하고, 이건 어차피 R1 의 선행 조건이다.


## 6. P2 구현 리뷰에서 실제로 터진 것 (2026-08-02)

**교훈: 구현 6커밋을 리뷰 없이 쌓았고, 그 대가로 Critical 2건이 사용자에게 도달했다.**
스위트+뮤테이션+스코프 검증만으로는 못 잡는다. 사용자 워크플로우("리뷰 = Fable 5 + Codex 병렬 findings-0")를 건너뛴 게 원인.

리뷰가 잡은 것 (전부 전체 스위트 초록불 아래 숨어 있었다):
1. **[Critical] 첫 실행 모드 피커가 완전히 죽어 있었다.** `ModeGate` 는 mode=null 이면 App 대신 셀렉터를 렌더하는데, `route:quiesce-request` 리스너가 App 안에만 있었다 → main 이 30초 기다리다 실패 → ModeGate 의 catch 가 조용히 삼킴. **신규 사용자가 모드를 아예 못 고름.** 배리어 테스트는 항상 응답하는 fake 를 써서 못 봤다.
2. **[Critical] 저장된 분할 레이아웃 파괴.** `setLayout` 이 `await requestRoute` 뒤 `.then()` 으로 밀려 Shell 의 동기 "저장값" push 보다 늦게 떨어졌고, `useSplitLayout` 이 그 덮어쓴 값을 다시 저장했다. **dev 플래그 무관, 기존 Flow 사용자 직격.**
3. **[Important] 콤보가 네이티브 뷰에 덮임.** `updateBounds` 12곳 중 1곳만 strip inset 을 넘겨서, Flow 배치 한 번이면 뷰가 44px 스트립을 덮어 콤보가 안 보이고 클릭도 안 먹었다. → `layout.js` 모듈 상태로 전환.
4. **[게이트 회피] `window.electronAPI?.['set' + 'Mode']`** — 문자열 결합으로 "setMode 호출부 0" 게이트와 소스 핀 테스트를 둘 다 우회. **검사를 통과시키려 검사를 피해간 코드**. 제거함.
5. boot 실패 시 렌더러가 **자기 자신으로 "수렴"**(`route: routeRef.current`)해 main 과 갈린 채 남음.
6. reconnect 가 await 2개를 건너뛴 뒤 타깃 재확인 없이 `onAuthRecovered` 호출 → 엉뚱한 타깃 인증.
7. R1 단축키 `.every()` short-circuit → 닫기 단축키만 실패하면 전체창 R1 뷰를 **못 닫음**.

**리뷰어 판정이 갈린 사례:** 수정 웨이브 1 재리뷰에서 Fable 은 "클린", Codex 는 "3건 NOT ADDRESSED". 실측 결과 **Codex 가 셋 다 맞았다.** 리뷰어 합의는 실측을 대신하지 못한다.

## 7. R1 을 실제로 돌리려면 (중요)

로그인만으로는 부족하다. R1 하네스는 **`AUTOFLOWCUT_R1_RUNTIME_MODULE`(운영자 제공 로컬 모듈)** 없이는 fail-closed 로 종료한다. 이는 의도된 설계다 — 업로드 메커니즘·셀렉터·한계는 R1 이 *측정할 대상*이라 미리 지어내면 R1 자체가 무의미해진다.

즉 순서는: **로그인 → 살아있는 페이지에 대고 runtime module 을 작성(=측정 행위 그 자체) → 하네스가 45회 반복 매트릭스를 자동 실행**. 하네스 쪽(픽스처·사이즈 래더·반복·증거 수집·origin 살균·결과 파일)은 이미 준비됐고 두 리뷰어가 "로그인하면 완주 가능" 확인함.

알려진 미해결(Low, 스파이크 전용): `measurementPromise` 가 한 번 시작되면 캐시돼서 중간 실패 시 앱 재시작 전엔 재시도 불가.


## 8. ChatGPT 이미지 생성 동작 (2026-08-03) — findings-0

**스파이크가 실측한 텍스트→이미지 경로를 제품 경로로 이식 완료.** 27커밋, 764 files / 7998 tests 그린, 두 리뷰어 findings-0.

실행: `AUTOFLOWCUT_CHATGPT_P2=1 npm run dev` → 로그인 모드 → 콤보에서 ChatGPT → 생성 시작.
세션 1회 안내 토스트: "ChatGPT 타깃은 화면비와 시드를 제어할 수 없습니다 — 정사각형, 시드 재현 없음."

**여전히 거부되는 것:** 레퍼런스 이미지 업로드(R1 미측정 — 4개 레이어에서 fail-closed), `batchCount > 1`, 비디오(진리표대로 API provider).

### 이 슬라이스에서 나온 Critical (전부 전체 스위트 초록불 아래 있었다)
1. **프롬프트에 개행** — `norm()` 이 개행을 안 지우는데 ProseMirror `textContent` 엔 리터럴 개행이 없어 주입 검증 문자열이 매번 불일치. 그 뒤 ASCII 폴백 가드에 걸려 **한글 씬이 전부 하드 거부**.
2. **`aspectRatio != null` 거부** — 프로젝트 기본값이 `'16:9'` 라 모든 호출이 이걸 실어 보냄 → **모든 생성이 IPC 전에 거부**. 화면비를 안 넘기는 썸네일만 동작했다.
3. **`seed != null` 거부** — 2번을 고치고 **한 필드 옆에서 똑같은 실수 반복**. `seedLocked:true` + 랜덤 `seedNo` 가 기본이라 역시 전부 거부.

### 재발 방지 (이게 이 슬라이스의 진짜 산출물)
2·3번은 "가드를 앱이 실제로 보내는 값과 대조하지 않고 상상한 shape 로 작성"한 같은 병이다. 마일스톤 전체로는 **다섯 번째** 였다(죽은 첫실행 피커, 네이티브 뷰에 덮인 콤보, 무조건 blocked 반환하던 auth probe, 화면비, 시드).

- **전수 대조표**: ChatGPT 경로의 모든 가드 17개 × 앱 실제 기본값. 결론 — 이제 어떤 레이어의 어떤 가드도 앱 기본값을 거부하지 않는다.
- **구조적 펜스**: `src/services/startOptions.js` 로 옵션 파생을 단일화하고, 통합 테스트가 **실제 `useAppSettings` 기본값 → 실제 파생 → 실제 useAutomation → 실제 engine → 실제 preload 브리지 → 실제 main admission 핸들러 → 실제 adapter** 를 통과한다.
- **펜스가 무는지 실험으로 증명**: main 핸들러에 항상 존재하는 기본값(`batchCount`) 거부 가드를 임시로 넣자 새 테스트만 실패하고 기존 19개는 초록 — 즉 여섯 번째 인스턴스는 착지하는 날 잡힌다.

**연기(합의):** 경로 고유 필드(`purpose`, `ref` 메타데이터)는 펜스 밖. 현재 어느 레이어도 이 필드를 검사하지 않고, 덮으려면 하네스 3개가 더 필요해 비용 대비 실익이 낮다.

**남은 것:** 실앱 눈검증(실제 이미지 1장 생성), 미푸시.


## 9. ChatGPT 타깃 제거 (2026-08-04) — 최종 결정

**사용자 판정: ChatGPT 웹 자동화는 이 앱의 주력 경로로 안 쓴다.** 실제로 동작하는 상태까지 만든 뒤 내린 결정이다.

근거:
- **화면비** — 스파이크가 실측한 건 정사각형뿐. 이 앱은 숏츠(9:16)·롱폼(16:9) 도구라 이거 하나로 주력 실격.
- **레퍼런스 이미지** — 캐릭터 일관성의 메커니즘인데 업로드가 미측정. R1 을 돌려도 "안 됨"으로 판정날 수 있었다(플랜 R1-D 분기).
- **취약성** — 셀렉터 3개(`#prompt-textarea`, `#composer-submit-button`, estuary URL)에 전부가 매달림. ChatGPT UI 가 바뀌면 조용히 깨진다.
- 부수: 시드 없음, 배치 1장, 레이트리밋 미측정, 계정 리스크(P3 옵트인 고지가 선행이던 이유).
- **연속 생성 미측정** — 스파이크는 1장만 생성했다. 제품 어댑터엔 잡 사이 대화 초기화가 없어 씬이 쌓일수록 느려진다(사용자가 실제로 겪음). R1 하네스엔 `resetConversation()` 이 있었는데 이식되지 않았다.

### 제거한 것
ChatGPT 타깃 전체 — 로그인 probe, 세션 뷰, 타깃 콤보, 생성 어댑터, R1 하네스, `chatgpt:*` IPC, dev 게이트, 전 로케일 문자열. 32파일 삭제 / 47파일 수정.
`VALID_SESSION_TARGETS` 는 `['flow']` 로 축소 — 구현 없는 enum 값은 능력을 거짓말한다. 저장된 `'chatgpt'` 는 `'flow'` 로 복구된다.

**카피 원복** — `modeInfo.flow.name` 이 "로그인 모드"로 일반화됐던 건 ChatGPT 와 공유할 예정이었기 때문이고, `desc` 는 "Google Flow · ChatGPT 계정 세션으로 생성"이라 **제거 후엔 명백한 거짓**이 됐다. 전부 `9c39157a` 값으로 되돌림.

### 남긴 것과 그 정직한 상태

| | 상태 |
|---|---|
| canonical route + 전환 배리어(`mode.js`) | **live** — `api↔flow` 모드 전환이 실제로 `route:set`→`performRouteTransition` 을 타고 quiesce→cancel→detach→commit→attach 를 실행. quiesce 테스트도 `flow→chatgpt` 에서 `flow→api` 로 이관해 프로덕션 도달 경로를 덮는다 |
| `flowTargetGate.js` (read-only 채널 재분류 포함) | **live** — main + 4개 IPC 모듈이 import |
| `useTargetAuthReady` | **live** (Flow auth 오라벨 버그를 고친 것). 단 IPC 구독 arm 은 레지스트리가 비어 절대 발화 안 함 |
| `startOptions.js` + 실제-기본값 펜스 | **live** — 앱 전역 회귀 방지 |
| SceneTab 단계별 배지/가격 | **live** |
| `sessionViewSecurity.js` | ⚠️ **shelf inventory** — 프로덕션 import 0개. 테스트는 되지만 도달 불가 |
| 타깃 레지스트리 | ⚠️ **shelf inventory** — `createTargetRegistry({})` 로 비어 있어 모든 분기 dormant |

두 리뷰어가 독립적으로 이 split 을 지적했고, 숨기지 않고 기록한다. 이 마일스톤은 "테스트는 다 통과하는데 프로덕션에서 한 번도 안 걸리는 메커니즘"에 두 번 물렸다 — 같은 상태를 모르는 채 두지 않기 위함.

### 제거가 하마터면 잃을 뻔한 것
삭제된 `App.chatgptTargetGate.test.jsx` 안에 **저장 레이아웃 파괴(Critical)의 유일한 커버리지**가 얹혀 있었다. 프로덕션 수정은 살아있었지만 테스트가 통째로 사라져 무방비가 될 뻔했다. Codex 가 리뷰에서 잡았고(Fable 은 놓침), Flow/API 전용 테스트로 복구했다(`App.flowLayoutPreservation.test.jsx`).
**교훈: 기능을 지울 때 그 기능의 테스트 파일에 다른 기능의 회귀 커버리지가 얹혀 있지 않은지 확인할 것.**

**최종: 31커밋, 749 files / 7860 tests 그린.**
