# HANDOFF — M3 레퍼런스: 실기 게이트 G1~G7 전부 통과 (실기 결함 3건 수정·리뷰 종료)

작성: 2026-09-26 · 워크트리 `~/workspace/AutoFlowCut-bugfix` · 브랜치 **`feat/flow-m3-references`**(`fix/flow-batchexecute` `f00a2775` 위) · **전부 미푸시**
이전 문서: `docs/handoffs/2026-09-26-flow-M3-implemented-live-gate-pending-HANDOFF.md` · 증거: **`docs/handoffs/evidence/2026-09-26-m3-live-gate.md`** · 계획서(완료, 아카이브): `docs/plans-archive/2026-09-25-flow-M3-references-plan.md`

---

## 0. 한 줄 요약

M3(새 flow.google.com 의 레퍼런스 이미지 · @인라인 멘션 · 레퍼런스 영상)가 **실기 G1~G7 을 전부 통과**했다. 첫 G1 이 요청 0건이었던 원인은 M3 가 아니라 앱 프로젝트가 Flow 에 안 묶인 것(준비 가드의 fail-closed)과 폴링이 다른 프로젝트를 읽은 착시였다(증거 §0). 실기에서 결함 3건(클립보드 복원이 형식을 지어냄 · `load_csv` 병합이 모델명·영상 연결을 버림 · 에이전트 창 닫기가 입력창 지우기를 누름)이 나와 전부 TDD 로 고치고 Opus 독립 리뷰를 findings 0/NIT 까지 돌렸다. 크레딧 907 → 893(−14, G4·G7).

## 1. 이번 세션 커밋 (`git log --oneline fee14229..HEAD`)

| 묶음 | 커밋 |
|---|---|
| D1 클립보드 복원 | `b1f4062e` `3fc88288` `e185606c` `043499ab` `0faad7e6` |
| D2 CSV 재적용 보존 목록 | `95550d92` `cb44a563` `300c0e34` |
| D3 에이전트 창 닫기 | `d3b2d85f` `4a5a12c4` `9ade3af2` `ce2a2268` |
| 문서 | 이 핸드오프 · 증거 문서 · 계획서 아카이브 |

전체 스위트(HEAD `ce2a2268`, 문서 커밋 직전): **758 파일 / 8688 통과 / 54 스킵**(세션 시작 8649 → +39 테스트).

## 2. 무엇이 바뀌었나 (사람 말로)

- **클립보드:** 업로드가 잠깐 빌려 쓴 클립보드를 되돌릴 때, 원래 없던 형식(HTML)을 만들어 넣던 것을 막았다. macOS 는 원시 `public.html` 바이트로 판정하고, 크롬 HTML 의 meta 중복도 막았다. Windows·Linux 는 형식 목록으로 판정.
- **CSV 재적용:** 앱 CSV 가져오기와 MCP `load_csv` 가 **같은 보존 목록**(`src/utils/csvPreservedSceneFields.js`)을 쓴다. 모델명·seed·생성 시각, 완성 영상의 연결·선택·오류·다운로드 게이트, 스토리 연결이 이제 CSV 를 다시 넣어도 남는다. 옛 형식 CSV 의 회귀 두 개(전체 재생성, 옛 시간 우선)도 핀으로 막았다.
- **에이전트 창 닫기:** 에이전트 채팅 창 머리(`edit_square` 아이콘)라고 확인될 때만 닫기를 누른다. 전엔 화면의 유일한 'close' 버튼(입력창 지우기 등)을 눌러 사용자 칩을 지웠다.

## 3. 남은 것

1. **푸시·머지(사용자 결정)** — M2 `fix/flow-batchexecute` 44커밋 + M3 이 브랜치 전부 미푸시, main 도 미푸시 10커밋. 이 세션 중 사용자가 "완료했으면 base 에 병합"이라고 했다가 "여기선 하면 안 되는데… 내가 착각했어"로 정정 — **병합 여부·대상은 다시 물어서 확정**할 것(base 는 `fix/flow-batchexecute` 로 이해하고 있었다).
2. `probe/m3-0` 브랜치 삭제(계획서대로 M3 끝나면 삭제 — 사용자 확인 후).
3. 옛 코드 정리(계획서 §7·D15): `sceneMentions` 엔티티 경로 · `flow-compose-mention` · `cdp-image-inject` · 동기화 게이트 UI.
4. 증거 §3 의 관찰 8건(결함 아님) — 특히 채택 모달 경고, MCP 단일 생성의 실패 무신호, 영상 프롬프트 변경 시 옛 영상 `complete` 유지.
5. Flow 프로젝트 잔여물: `8e463fb2`(프로브·캡처 잔여), `048857b2`(m3-live-gate 실기) — 사용자가 원하면 손으로 정리.

## 4. 이번 세션에 배운 것

- **폴링은 프로젝트 이름과 같이 확인해라.** `/api/scenes` 는 "현재 프로젝트"의 씬이다 — 사용자가 프로젝트를 바꾸면 다른 프로젝트의 done 을 읽는다(첫 G1 의 착시).
- **실기 도우미를 사람에게 맡길 땐 "어디에 무엇을"을 정확히.** 센티널을 씬 프롬프트 칸에 써서 씬이 바뀌었고, 칩 붙이기 지시에서 생성 버튼까지 눌려 칩이 소진됐다 — "글자·생성 버튼은 누르지 마"를 명시.
- **테스트의 가짜 클립보드가 Electron 과 다르면 결함을 못 문다.** macOS Chromium 은 HTML 을 두 겹으로 지어낸다(목록에 올림 + 읽기 폴백) — 가짜를 그대로 흉내 내고 나서야 빨개졌다.
- **보존을 '통째로'로 고치면 다른 회귀가 생긴다.** 명시 목록 + 실제 행 모양(`loadCSV → bundleSceneCSVRows`)으로 테스트해야 리뷰가 잡은 두 회귀가 보인다.
- **'하나뿐이면 그걸 누른다'는 셀렉터는 화면이 바뀌면 다른 버튼을 누른다.** 새 화면의 유일한 'close' 는 입력창 지우기였다 — 긍정 확인(구조 앵커) 없으면 누르지 않는다.
- 리뷰어는 **Opus 서브에이전트**(사용자: Sonnet 은 코드 리뷰에 약하다). 라이브 앱 옆에서 `electron/` 을 건드리면 앱이 재시작되니 리뷰·뮤테이션은 분리 사본에서.

## 5. 실기 재현 정보

- 앱 프로젝트 `m3-live-gate`(`~/Documents/AutoFlowCut/m3-live-gate`) — 씬 `scene_1`(king 태그) · `scene_4`(queen 태그) · `scene_5`(멘션 3 + 영상 `@king`, 영상 선택 해제) · `scene_7`(레퍼런스 없음 + 레퍼런스 없는 영상). 레퍼런스 king·queen(`~/Documents/AutoFlowCut/test/references/`).
- 영상 배치는 **씬의 `videoT2VSelected` 가 true 여야** 돈다(기본 false — 안 켜면 "선택 없음"으로 조용히 끝).

## 6. 새 세션 시작 문구

```
AutoFlowCut-bugfix 워크트리(~/workspace/AutoFlowCut-bugfix, 브랜치 feat/flow-m3-references)에서 이어서 해.
docs/handoffs/2026-09-26-flow-M3-live-gates-passed-HANDOFF.md 를 끝까지 읽어. M3 는 실기 G1~G7 까지 끝났고 전부 미푸시다.
첫 일: 푸시·머지 대상을 나한테 물어서 확정(§3-1). 그다음 probe/m3-0 삭제 확인, 옛 코드 정리(§3-3)는 별도 계획으로.
커밋은 영어, 푸시는 나한테 물어봐. 리뷰어는 Opus 서브에이전트(Sonnet 금지).
```
