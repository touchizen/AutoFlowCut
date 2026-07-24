# 세션 핸드오프 — 2026-07-23 (스타일 통일 미해결)

워크트리 `~/workspace/AutoFlowCut-bugfix` (브랜치 **main**). ⚠️ 다른 `-*` 워크트리 건드리지 말 것.
`origin/main = 1fbb4177`. **미push 0.** 아래 "미커밋" 하나만 워킹트리에 있음.

## 이번 세션 방식 (확립 루프)
구현 Codex(gpt-5.6-sol, xhigh, 스레드 019f8cb9), 리뷰 Codex(019f8dc1)+Fable(subagent model:fable), 검증(스위트+뮤테이션 실측) Opus. 커밋마다: 구현→전체 스위트→커밋→뮤테이션(되돌리는 뮤턴트 kill 실측)→findings 0→push. **리뷰어 충돌=실측 신호, Opus가 코드로 판정.**

## ✅ 완료·push (findings 0 수렴, 뮤테이션 통과)
- **거터 가운데 정렬**(9d303c09) — 눈검증 OK.
- **버그3/1**(4e61ee06? 아님 — 이 세션은 e9fec5a1·0dd72656·95dfe985·b77fafdb): 이미지 제거 status:'pending' 리셋 + 생성 캐릭터 항상 refresh(composerRefreshNeeded=entityId) + 배치는 character phase 끝 **1회** refresh(N회 아님) + batchFlowAuthority scope 권위 + clearedImageFields(status 포함, MCP/UI 공유) + folder 제거 tombstone. **사용자 눈검증: "Refresh 문제 해결됐어" + "다른 건 다 괜찮아". ✅**
- **버그2 스타일 파생 1차**(2ce971d6·27b2eaba·1fbb4177): resolveEffectiveStyleIdForRef 에 씬 style_tag→preset/ref 파생(findSceneTagStyle, 씬 경로와 동일 순서: custom style ref > preset), scenesRef live, 모달 라벨 배선. **BUT 사용자 눈검증 실패 — 아래.**

## 🔴 미해결 (새 세션 핵심): 스타일 일관성 = "StylePicker 하나 선택 → 씬/Ref 전체 통일"

**사용자 반복 요구**: "Ref 탭에서 고르든 씬 배치생성 버튼에서 고르든, **스타일피커가 전체에 영향**을 끼쳐야 한다. **하나로 통일하라고.**" 씬 배치생성 버튼에도 표시되어야. custom style 도 고려.

**실측으로 확정한 것**(테스트 임시 스크립트로):
- A. `findPresetForStyleTag('Korean Anime')` → `korean-ani` ✅ (style_tag 공백 vs id 하이픈, name_en='Korean Anime' 매칭 OK).
- B. `selectedStyleRefId='preset:korean-ani'` → `resolveEffectiveStyleIdForRef(undefined)` = `preset:korean-ani` ✅.
- **C. `selectedStyleRefId=null` + 씬 전부 style_tag 'Korean Anime' → 파생 = `null` ❌** (파생 안 됨).
- 원인: 부자/빈자 카드가 **`styleId:null`**(이전에 스타일 없이 실사 생성된 기억). `resolveEffectiveStyleIdForRef` 우선순위 `override→selectedStyleRefId→inheritStyleIdFromCards(null 반환)→씬파생→findAutoStyle` 에서 **카드의 null 무스타일 기억이 씬 파생을 가림**. Fable 이 정확히 경고했던 한계("배치 한 번 돌린 프로젝트는 styleId:null 스탬프 → null 기억 > 파생 → fix 안 문다").

**⚠️ 미커밋 (styleResolver.js + test)**: 사용자가 "**씬 파생 > null 카드기억**" 선택(AskUserQuestion). Codex 가 우선순위를 `override→selectedStyleRefId→non-null 카드기억→씬파생→null 카드기억→findAutoStyle` 로 조정. **touched 테스트만 green, 전체 스위트·뮤테이션 미실행, 미커밋.** 새 세션: 검증(전체 스위트+뮤테이션)하고 커밋·리뷰 or, 사용자 방향(아래) 보고 재고.

**BUT 사용자는 이 fix 후에도 "두 피커 통일 안 됨"을 반복** — 이게 파생(자동상속)이 아니라 **명시 선택 통일**의 문제일 수 있다. 코드 확인 결과:
- 씬 picker(App.jsx:3105)와 Ref 위저드 picker(ReferencePanel.jsx:374)는 **둘 다 `selectedId={selectedStyleRefId}` + `onSelect→setSelectedStyleRefId`**(App.jsx:2264-2265 `onStyleRefChange={setSelectedStyleRefId}`). **즉 이미 같은 전역 state + 같은 setter 공유. "두 개라서 따로 논다"는 코드상 아님.**
- StylePicker(StylePicker.jsx)는 **preset 선택 가능**(:155 `preset:${style.id}` 카드), "스타일 없음" 카드(:137 `onSelect(null)`).

**→ 새 세션 첫 할 일**: 사용자와 **정확한 재현 스텝** 확정. "어느 탭 어느 picker에서 무엇을 골랐고, 어디서(생성 결과/씬 배치버튼 라벨/Ref 위저드 표시) 통일이 안 보였나." 후보:
1. 씬 배치생성(Start) 버튼이 selectedStyleRefId 를 **라벨로 상시 표시 안 함**(App.jsx:2558 runningStyle 은 Start 누른 뒤 실행 표시). → 표시 통일 필요?
2. Ref 캐릭터 생성이 selectedStyleRefId 반영 — B 실측은 반영됨. 사용자 실사는 **생성 시점 selectedStyleRefId=null**(StylePicker 명시 선택을 안 했거나 못 함) + 카드 null 기억. → 미커밋 파생 fix 로 해결되는지 실앱 재검증.
3. 사용자가 "UI 를 물리적으로 하나로" 원하는지(씬/Ref 각각 picker 대신 프로젝트 스타일 1곳)? 이전 토론선 "2번=결과 일관 반영" 골랐으나 지금 "하나로 통일" 강조.

**주의**: 이 세션 내내 스타일을 파생-at-read(자동상속)로 오버엔지니어링했을 가능성. 사용자 실제 니즈는 **명시 선택 하나가 전체 지배 + UI 표시 일치**일 수 있다. 파생은 "picker 안 고르고 스크립트 style_tag만" 보조. 새 세션은 이 둘을 분리해 사용자에게 확인부터.

## 남은 버그2 후속 (별건)
- #4 혼합 style_tag 프로젝트 "명시 선택 요구"(위저드 라벨+toast), #5 custom style Flow mediaId preflight fail-fast(조용한 실사 방지), #1 이미지-only style ref composite(씬은 이미지+preset prompt, scalar styleId 파생 재현 못함 — 계약 변경 필요, 별건).

## 참고
- 메모리: [[autoflowcut-ref-style-derivation]], [[autoflowcut-batch-composer-refresh]] 저장됨.
- 버그2 리뷰가 3라운드 findings 안 줄던 신호(findings-zero) — 스타일 우선순위가 미묘. 실데이터(부자와_빈자, 무한야담_ep10)로 검증 권장.
