# 세션 핸드오프 (2026-08-04)

> **새 세션은 이 문서만 읽으면 된다.** 이전 문서(`2026-07-31-chatgpt-target-P2-HANDOFF.md`)는 진행 중 기록이라 상단이 낡았다 — 이력이 필요할 때만 참고.

## 0. 한 줄

ChatGPT 웹 자동화를 **동작하는 상태까지 만든 뒤 쓰지 않기로 결정**하고 제거했다. 타깃 무관 기반과 회귀 방지 장치만 남겼다. **브랜치 `feature/chatgpt-target-p1` 푸시 완료(32커밋), 749 files / 7862 tests 그린.**

- base: `feature/multi-provider-genapi` @ `9c39157a` (main 아님 — 플랜 앵커가 거기만 있었다)
- 원격: `origin/feature/chatgpt-target-p1` · **main 병합 미결정**
- `docs/superpowers/**` 는 gitignore — 이 문서는 디스크에만 있다

## 1. ChatGPT 를 왜 뺐나 (재논의 금지)

동작은 했다. 실앱에서 콤보로 선택 → 로그인 → 이미지 생성 → 결과 표기까지 사용자가 확인했다. 그럼에도 뺀 이유:

| 이유 | 내용 |
|---|---|
| **화면비** | 스파이크가 실측한 건 정사각형뿐. 이 앱은 숏츠(9:16)·롱폼(16:9) 도구다. 이거 하나로 주력 실격 |
| **레퍼런스 이미지** | 캐릭터 일관성의 메커니즘인데 업로드가 미측정. R1 을 돌려도 "불가" 판정 가능성이 있었다(플랜 R1-D 분기) |
| **취약성** | 셀렉터 3개(`#prompt-textarea`, `#composer-submit-button`, estuary URL)에 전부가 매달림. ChatGPT UI 가 바뀌면 조용히 깨진다 |
| 연속 생성 | 스파이크는 1장만 생성했다. 제품 어댑터엔 잡 사이 대화 초기화가 없어 씬이 쌓일수록 느려졌다(사용자가 실제로 겪음) |
| 부수 | 시드 없음, 배치 1장, 레이트리밋 미측정, 계정 정지 리스크 |

**이 판단은 동작하는 물건을 손에 쥔 뒤에 나왔다.** 스펙만 보고는 안 나왔을 결론이다.

되살리고 싶다면: 코드는 `origin/spike/chatgpt-automation`(원 스파이크)과 이 브랜치의 `76434fb1` 이전 커밋들에 있다.

## 2. 남긴 것 — live 와 shelf 를 구분해서

두 리뷰어가 독립적으로 이 구분을 요구했다. 숨기지 않고 적는다.

| 항목 | 상태 |
|---|---|
| canonical route + 전환 배리어 (`electron/ipc/mode.js`) | **live** — `api↔flow` 모드 전환이 실제로 `route:set`→`performRouteTransition` 을 타고 quiesce→cancel→detach→commit→attach 를 실행. quiesce 테스트도 `flow→api` 로 이관해 프로덕션 도달 경로를 덮는다 |
| `flowTargetGate.js` (read-only 채널 재분류 포함) | **live** — main + 4개 IPC 모듈이 import |
| `useTargetAuthReady` | **live** — Flow auth 오라벨 버그를 고친 것. 단 IPC 구독 arm 은 레지스트리가 비어 발화하지 않는다 |
| `src/services/startOptions.js` + 실제-기본값 펜스 | **live** — 앱 전역 회귀 방지(§4 참조) |
| SceneTab 단계별 배지/가격 | **live** |
| `electron/sessionViewSecurity.js` | ⚠️ **shelf** — 프로덕션 import 0개. 테스트는 되지만 도달 불가 |
| 타깃 레지스트리 (`electron/webtargets/index.js`) | ⚠️ **shelf** — `createTargetRegistry({})` 로 비어 있어 모든 분기 dormant |

두 번째 세션 타깃(또는 멀티프로바이더 확장)이 생기면 shelf 항목이 살아난다. 그전까진 재고다.

## 3. 열려 있는 것

- **main 병합 미결정.** base 인 `feature/multi-provider-genapi` 도 아직 main 에 없다 — 병합 순서를 정해야 한다
- 설정 → 장면 탭의 provider 배지가 `Google Flow` / `API 키 모드` 로 길다(원래는 `Flow`/`API`). 단계별 provider·가격 분리와 함께 들어온 것이라 일단 뒀다. 짧게 되돌릴지는 판단 필요
- P2 플랜(`2026-07-31-chatgpt-target-p2-adapter.md`, 16태스크 findings-0)은 ChatGPT 전제라 **이제 무효**다. 다른 타깃에 재사용하려면 다시 써야 한다

## 4. 이 세션에서 실제로 값어치가 있었던 것

기능은 지웠지만 아래는 앱에 남았고, 전부 **전체 스위트가 초록불인 채로 숨어 있던 결함**이다.

**고친 사용자 대면 버그**
1. **첫 실행 모드 피커가 완전히 죽어 있었다** — `ModeGate` 는 mode=null 이면 App 대신 셀렉터를 렌더하는데 quiesce 리스너가 App 안에만 있어, main 이 30초 기다리다 실패하고 catch 가 조용히 삼켰다. 신규 사용자가 모드를 아예 못 골랐다
2. **저장된 분할 레이아웃 파괴** — 앱을 켜기만 해도 `split-right/0.7` 이 `split-left/0.5` 로 덮이고 그 값이 저장됐다. 기존 Flow 사용자 직격
3. Flow auth 상태가 타깃 전환 후 오라벨되던 것, 레퍼런스 경로가 ChatGPT 이미지를 "Flow"로 찍던 것

**남긴 회귀 방지 장치**
- `will-frame-navigate` 서브프레임 가드 (Electron 36 에서 `will-navigate` 는 메인프레임 전용이라 iframe 이 allowlist 를 우회했다)
- Flow read-only 채널 재분류 (`flow:list-agent-models` 등 4개가 실제로는 mutation/원격요청이었다)
- **실제-기본값 펜스** — `startOptions.js` + `tests/integration/realDefaultsCallShape.test.jsx`. 실제 settings 훅 → 실제 파생 → 실제 useAutomation → 실제 엔진을 통과한다

## 5. 다음 세션이 알아야 할 함정 (전부 이번에 실제로 밟았다)

1. **"플랜대로 구현" ≠ "스펙 만족".** findings-0 플랜이 스펙 게이트와 충돌했다. 완료 판정은 체크박스가 아니라 스펙 문장으로.
2. **가드를 `!= null` 로 쓰기 전에 앱 기본값과 대조하라.** `aspectRatio`(기본 `'16:9'`)와 `seed`(기본 잠김+랜덤)에서 연속 두 번, 기능 전체가 IPC 전에 죽는데 스위트는 초록이었다. 전수 대조표를 만들 것.
3. **손으로 만든 fixture 로 통합 테스트를 쓰지 마라.** 중간을 shim 으로 이으면 그 레이어의 가드는 영원히 안 잡힌다.
4. **기능을 지울 때 그 테스트 파일에 남의 회귀 커버리지가 얹혀 있는지 확인하라.** 저장 레이아웃 Critical 의 유일한 커버리지가 삭제된 ChatGPT 테스트 파일에 있었다(Codex 가 잡음, Fable 은 놓침).
5. **Codex MCP 타임아웃은 작업 종료가 아니다.** 프로세스가 계속 쓴다. 커밋 전 `find -newermt` 대신 mtime 스냅샷 2회 비교로 쓰기 정지를 확인할 것. 중간 상태를 커밋하면 이후 뮤테이션 결과가 전부 무효다.
6. **뮤테이션은 적용됐는지 `grep -c` 로 확인하라.** 코드가 바뀌어 패턴이 안 맞으면 "3개 살아남음"으로 거짓 판독한다.
7. **리뷰어 합의는 실측을 대신 못 한다.** 이번에 6번 갈렸고 6번 다 코드 측정이 판정했다. 양쪽이 각각 맞은 적이 있다.

## 6. 워크플로우 (효과 확인됨)

- 어려운 저작 = Codex(gpt-5.6-sol, xhigh) / 리뷰 = **Fable 5 + Codex 병렬 findings-0 까지** / 검증 = 오케스트레이터
- **리뷰를 건너뛰면 대가를 치른다** — 구현 6커밋을 리뷰 없이 쌓았다가 Critical 2건이 사용자에게 도달했다
- Codex 가 이 레포에서 6연속 타임아웃 — 긴 작업은 결과를 파일에 증분 저장시키고, 안 끝나면 저자를 Fable 로 교체
- 커밋 메시지는 영어
