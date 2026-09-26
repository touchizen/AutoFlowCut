# ChatGPT 정식 기능 — 세션 핸드오프 (2026-07-30)

> 새 세션은 **이 문서부터**. 스파이크는 끝났고, 정식 기능 스펙과 P1 구현 플랜까지 나와 있다.

## 0. 지금 위치
- **스파이크 ✅ 종료** — 실앱 `Cmd+Alt+Shift+G` 1회로 1254×1254 최종 이미지 저장. 브랜치 `spike/chatgpt-automation` **푸시됨**(커밋 4개). 상세: `2026-07-29-chatgpt-automation-HANDOFF.md`
- **스펙 ✅ v8 findings-0** — `docs/superpowers/specs/2026-07-30-chatgpt-target-design.md`
- **P1 플랜 ✅ 리뷰 반영 완료** — `docs/superpowers/plans/2026-07-30-chatgpt-target-p1-foundation.md` (8 태스크)
- **다음: P1 구현.** 플랜대로 TDD.

## 1. 사용자가 확정한 제품 결정 (재논의 금지)
| | 결정 |
|---|---|
| 모드 용어 | `flow` 모드 → UI 라벨 **"로그인 모드"**. **저장값 `'flow'` 는 안 바꾼다** |
| 타깃 전환 | 로그인 모드 안에서 **주소창 자리 콤보**로 Google Flow ⇄ ChatGPT UI 교체 |
| 비디오 | **ChatGPT 는 이미지 전용, 비디오는 설정된 API provider**(사용자 의도는 Grok). 비활성 아님, 모드 전환 없이 동작 |
| 레퍼런스 | v1 스코프에 포함하되 **P2 첫 태스크 업로드 스파이크**로 실측 후 확정 |
| 화면비 | 요청 + `w/h` 실측 검증 → **warning-success(±2%)**, 배치 중단 아님 |

## 2. 계획 분할 (§10)
- **P1 기반** — canonical route + additive `route:set` IPC, 단일 parse/serialize + 셀렉터, target-aware Flow 게이트 분류, 세션 뷰 컨트롤러 일반화 + 보안 불변식, 모드/타깃 라벨 분리. **ChatGPT 코드 없음.**
  - **게이트: 기존 Flow 테스트 무수정 통과** + `flow+chatgpt` 가 모든 Flow 부수효과·뷰 attach 를 거부하는 음성 테스트
- **P2 어댑터** — 백엔드 전용(아직 UI 에서 선택 불가). 업로드 스파이크 → 턴 상관 → 이식 → 코디네이터 → 계약 → 화면비
- **P3 선택 가능화** — 옵트인 고지가 **선행**, 그 다음 콤보·혼합 라우팅·Grok provisional 해제·킬스위치·MCP watchdog

## 3. 이 작업의 워크플로우 (실측으로 검증된 것)
- **어려운 저작 = Codex(gpt-5.6-sol, xhigh), 리뷰 = Fable 5, 검증 = 메인 루프.**
- **저자가 자기 수정을 반복하면 새 구멍을 판다** — 스펙이 7라운드에서 수렴 안 하다가 **저자를 Codex 로 바꾸자 즉시 findings-0**. 3라운드 넘게 BLOCKER 가 계속 나오면 라운드를 더 돌리지 말고 저자를 바꿀 것.
- **리뷰어가 엇갈리면 코드로 직접 측정해 판정한다.** 이번에만 3번 갈렸고 3번 다 실측이 판정했다(크레딧 게이트 판정식, 플랜의 테스트 경로 3건).
- 각 수정도 리뷰 대상. 커밋 메시지는 영어.

## 4. P1 구현 시 특히 주의 (리뷰가 실제로 잡은 함정)
- `useProjectData.js:575` 는 `mode` 를 **비교가 아니라 소비**한다(`genAPI?.mode || modeRef.current`) — `modeRef` 를 지우면 ReferenceError 이고 그 줄은 `try` 밖이라 삼켜지지도 않는다.
- App/Header 의 `sessionTarget` 구조분해에 **`= 'flow'` 기본값 필수** — 기존 테스트들이 `useMode` 를 `sessionTarget` 없이 mock 한다.
- Header 인증 버튼의 접근성 이름에는 **아이콘이 붙는다**(`{authActionIcon} {authActionLabel}`) → 정확 문자열 매칭 금지, 정규식.
- `LanguagePicker` 는 `languages[0].country` 를 읽는다 → Header 테스트의 `languages` mock 을 빈 배열로 두면 render 에서 죽는다.
- `layout.js` 테스트는 `vi.mock('electron')` 이 필요하다(`layout.modalFocus.test.js` 전례).

## 5. 검증 게이트
전체 스위트 그린 + `tests/electron/api/genai.test.js` 무수정 + **기존 Flow 테스트 무수정** + 뮤테이션 실측(플랜 말미 "오케스트레이터 검증" 목록).
