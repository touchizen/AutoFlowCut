# 눈검증 체크리스트 — Flow 도메인 이전 (빌드 3.2.2, 커밋 `6b3fca3e`)

목적: 코드로 못 닫은 findings 를 **실측으로 판정**한다. 각 항목 옆이 판정 대상 finding.
빌드: `npm run dist:mac:prod` → `dist/` 의 앱을 **터미널에서 실행**해야 로그가 보인다.

### 실행

빌드 산출물은 `dist/` 가 아니라 **`release/`** 다.

```bash
cd ~/workspace/AutoFlowCut-bugfix
./release/mac-arm64/AutoFlowCut.app/Contents/MacOS/AutoFlowCut 2>&1 | tee ~/afc-flow-check.log
```

- **arm64 네이티브**, 버전 3.2.2, 번들 ID `com.touchizen.flow2capcut` 그대로 →
  userData 가 기존 `~/Library/Application Support/autoflowcut` 라서 **Flow 로그인 세션이 유지된다.**
- 이 빌드는 **서명이 ad-hoc**(공증 403 우회). Finder 로 더블클릭하면 Gatekeeper 가 막을 수 있으니
  **위 터미널 명령으로 실행**할 것 — 로그를 봐야 하기도 하다.
- 서명된 x64 빌드도 있다(`release/mac/`, Rosetta). 둘 다 같은 수정을 담고 있다.

빌드에 수정이 들어간 것은 번들에서 확인함 —
`new Set(["https://labs.google", "https://flow.google.com"])`(A),
`isFlowPageUrl` 게이트(B), `/^\/fx(?:\/[a-z]{2})?\/tools\/flow(?=\/|$)/`(E).

> ⚠️ 공증 실패는 앱 결함이 아니다 — Apple 계약 미서명(403).
> **배포용 DMG 를 만들 때만** developer.apple.com 에서 약관을 풀면 된다.

---

## 1. 저장된 프로젝트 열기 — **원래 제보 증상** (0bc50ae5 / ab6808cc 검증)

Flow 탭 진입 → 저장된 프로젝트가 자동으로 열리는지.

- [ ] **한 번에** 열린다 (로그에 `[Flow Project] opening saved flow project:` 가 **1회**)
- [ ] `[Flow Project] open failed after retry` 가 **안 나온다**
- [ ] `open error — retry via home` 반복이 **없다**

🔴 이 셋이 통과하면 원래 버그는 닫힌 것. 하나라도 반복되면 로그 전체를 가져올 것.

> `[Flow] initial loadURL failed: ERR_ABORTED (-3)` 는 **정상**이다 — 리다이렉트가 원래 로드를
> 대체할 때 나는 신호. 이건 실패가 아니다.

## 2. 로그인 배지 — **finding C / M** (DOM 덤프 없이 증명된 것)

- [ ] 헤더 로그인 배지가 **로그인 상태로 보이는가**
- [ ] 로그에 `flow-status` 관련으로 `authenticated:true` 가 나오는가
- [ ] `loggedIn: false` 만 반복되는가

예측: `main.js:524` 가 `labs.google/fx` 를 요구해서 **배지가 안 켜진다**. 그대로면 C 확정.

## 3. 이미지 생성 → 결과 수집 — **finding A / F** (조용히 죽어 있던 것)

씬 하나 생성해서:

- [ ] 생성이 **끝나는가** (120초 타임아웃으로 안 매달리는가) ← A 검증
- [ ] 결과 이미지가 **앱에 들어오는가** (0건이 아닌가) ← F 검증
- [ ] 로그에 `unauthorized origin` 이 **안 나오는가** ← A 가 진짜 고쳐졌나

🔴 `unauthorized origin` 이 보이면 A 수정이 안 닿은 것 — 즉시 알려줄 것.

## 4. 토큰 파이프라인 — **finding J (HIGH, 미해결)**

가장 중요. 새 도메인에서 페이지 컨텍스트 fetch 가 cross-origin 이 돼 쿠키가 안 붙는다는 게
코드상 확정인데, **실제로 토큰이 나오는지**는 앱에서만 알 수 있다.

- [ ] 로그에 `flow-access-token-unavailable` 이 나오는가
- [ ] `Authorization: Bearer null` 류가 보이는가
- [ ] 캐릭터 페이지에서 **레퍼런스 업로드**가 되는가 (실패하면 J 확정)
- [ ] 영상 생성 후 **상태 확인**이 되는가

DevTools 를 열 수 있으면(`Cmd+Opt+I`) Network 탭에서 **로그인 직후 어떤 auth 엔드포인트를
치는지** 봐줄 것 — 새 Angular 앱의 진짜 토큰 경로를 알아야 J 를 추측 없이 고친다.

## 5. 캐릭터 페이지 진입

- [ ] 캐릭터 페이지가 열리는가
- [ ] 엉뚱한 페이지(컴포저·홈)로 가지 않는가

## 6. 미로그인 동작 — **finding D (미해결, 설계는 "상한 후 안내"로 결정됨)**

여유 있으면: Flow 에서 **로그아웃**하고 프로젝트 열기를 시도.

- [ ] 재시도가 **멈추는가**, 아니면 5초마다 무한히 도는가
- [ ] 뷰에서 **직접 로그인할 수 있는가** (재시도가 끌어내지 않는가)

예측: 5초마다 무한 재시도하며 로그인을 방해한다. 그러면 D 착수.

---

## 남은 findings 요약 (코드로 안 닫힌 것)

| # | 심각도 | 내용 | 판정 항목 |
|---|---|---|---|
| J | HIGH | 토큰 파이프라인 cross-origin 으로 끊김 | §4 |
| C | HIGH | `main.js:446/473/524` 부트스트랩 게이트 | §2 |
| D | HIGH | 무한 재시도 상한 없음 (설계: 상한 후 안내) | §6 |
| K | MED | `video.js:971` 주입 상대경로가 새 호스트로 해석 | §4 |
| F | MED | media-collect href 과/소매칭 | §3 |
| G | LOW | `onProjectComposerUrl` 이 hostname 만 봄 | — |

**닫힌 것**: A(origin) · B(paper fix) · E(로케일/공허테스트) · I(dead code) · L(테스트 약점) ·
N(로케일 위험 — 실측으로 무해 확정).
