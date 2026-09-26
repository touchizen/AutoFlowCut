# M7b 실앱 눈검증 체크리스트 (2026-07-19)

브랜치 `feature/inapp-agent` HEAD `77838a82`. 자동 테스트로 못 잡는 것만 여기서 손으로 확인한다.
각 항목: **동작 → 기대결과 → [ ] Pass / 메모**. 어긋나면 그게 고칠 거리(TDD로 재현 테스트 먼저 → 수정 → 리뷰).

## 0. 사전 준비
- [ ] 앱 실행 (`npm run dev` 또는 패키징 앱)
- [ ] Codex 로그인됨 (ChatGPT 구독) — codex 모델·실제 턴 확인용
- [ ] Claude 로그인됨 (로컬 CLI 구독) — claude 모델 선택·실제 턴 확인용
- [ ] 프로젝트 하나 열어둠, 에이전트 패널 열기

## 🟡 먼저 알아둘 것 (버그 아님, 정상)
- **"기본"이 claude가 아니라 GPT-5.5 fallback으로 뜨는 건 정상.** D1 setModel 스파이크 전이라 claude default 미승격(`CLAUDE_AGENT_DEFAULT_SDK_MODEL=null`). "기본"은 codex gpt-5.5로 pin됨.
- 그래서 D4 경고("Claude Opus 4.8 사용 불가")가 뜨는 게 **의도된 상태**. claude를 쓰려면 selector에서 claude 모델을 **명시적으로** 골라야 함.

---

## A. Selector — provider grouping + Claude 활성화
- [ ] **A1** selector 열기 → 맨 위 "기본"(header 없음), 그다음 **Codex** header + codex 모델들, 그다음 **Claude** header + claude 모델들. 순서/그룹 맞는지.
- [ ] **A2** 예전 "구현 예정(coming soon)" 회색 비활성 row가 **없어야** 함. claude 모델이 실제 선택 가능(회색 아님).
- [ ] **A3** claude 모델 클릭 → 버튼에 그 모델 이름 표시됨.
- [ ] **A4** 키보드: combobox focus → ↓/↑로 Codex·Claude 그룹 가로질러 이동, Enter로 선택. Esc는 안 바꾸고 닫힘.
- [ ] **A5** dropdown이 패널 밖으로 안 잘림(좁은 패널/도킹에서도). 아래 공간 없으면 위로 뜸.

## B. D4 fallback 표시 (미승격 상태)
- [ ] **B1** 앱 켜고 send 전: selector "기본" 라벨이 **"기본 · GPT-5.5 (Claude Opus 4.8 사용 불가)"** 로 보임(pre-session catalog 신호).
- [ ] **B2** "기본"으로 send → 대화창에 시스템 상태로그 **"기본 모델 Claude Opus 4.8을(를) 사용할 수 없어 GPT-5.5로 대체합니다."** 가 **딱 1번** 뜸.
- [ ] **B3** 같은 세션에서 또 send → 상태로그 **재출현 안 함**(세션당 1회).

## C. D2 provider-switch 경고 (핵심)
> codex 세션을 먼저 연다: Default 또는 codex 모델로 한 번 send(턴 끝날 때까지 기다림).
- [ ] **C1** 그 상태에서 selector로 **claude 모델** 선택 → **인라인 경고 배너** "프로바이더를 바꾸면 현재 대화 맥락이 사라집니다." + [전환][취소]. **팝업 모달 아니고 패널 안 인라인**인지 확인.
- [ ] **C2** [취소] → 배너 사라지고 세션·선택 그대로. close/reopen 안 일어남.
- [ ] **C3** 다시 claude 선택 → 배너 → [전환] → 대화 비워지고 세션 닫힘→claude로 새로 열림. 다음 send가 claude로 감.
- [ ] **C4** (stale 방지) claude 선택해 배너 뜬 상태에서 **다시 codex 모델** 선택 → 배너 **사라짐**, 전환 안 됨(화면에 보이는 모델로 정상 동작).
- [ ] **C5** (Default=codex) **claude 세션**에서 "기본" 선택 → 배너 **뜸**(Default가 codex fallback이라 cross-provider). [전환]하면 codex로.
- [ ] **C6** 배너 열린 동안 **Send 눌러도 안 나감**(전환/취소로 먼저 결정해야).
- [ ] **C7** **턴 진행 중**에 cross-provider 모델 선택 → 아무 일 없음(배너 안 뜸). Stop/완료 후에만 전환됨.

## D. 실제 claude 턴 (D1 없이도 됨)
- [ ] **D1** claude 모델(예 sonnet) **명시 선택** → send → **실제 claude 응답** 스트리밍됨.
- [ ] **D2** 그 턴에 Steer 넣기 → 반영됨. Stop 누르기 → 멈춤(조용한 중단).
- [ ] **D3** 툴 호출 필요한 요청(예 "배치 상태 확인") → 승인 흐름·툴 실행 정상.

## E. remount / hydration (수동 트리거 어려움 — 되는 만큼)
- [ ] **E1** codex 세션 중 **프로젝트 전환** → 옛 세션 정리되고 새 프로젝트 빈 상태. 이전 대화 안 새어나옴.
- [ ] **E2** (가능하면) 턴 진행 중 패널 remount 상황 만들기 → **Stop 버튼 여전히 보임**(running 복원). *트리거 어려우면 스킵하고 메모.*

## F. 회귀 sanity
- [ ] **F1** 기존 에이전트 기능(툴콜, 승인 다이얼로그, usage "Turns/Tools" 표시) 그대로 작동.
- [ ] **F2** 패널 도킹/플로팅 전환, FAB, 드래그 등 M7b 이전 UI 정상.

---

## 결과 요약
- 통과: ___ / 어긋남: ___
- 어긋난 항목 번호 + 증상 메모:
  -
  -

어긋난 거 여기 적어서 알려주면, 항목별로 재현 테스트 → 수정 → Codex/Fable 리뷰 루프로 간다.
