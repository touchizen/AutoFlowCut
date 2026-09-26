# 브리프 — M3 구현 (저자: Opus 5.5 — 묶음별 새 인스턴스)

워크트리 `~/workspace/AutoFlowCut-bugfix`, 브랜치 `feat/flow-m3-references`. **정본 = 계획서 `docs/plans/2026-09-25-flow-M3-references-plan.md` R3**(리뷰 종료, findings 0). 계획서 §4 머리 "구현자 공통 규칙"과 M2 계획서 `docs/plans/2026-09-24-flow-batchexecute-rework-plan.md` §3 머리 공통 규칙을 그대로 따른다. 증거: `docs/handoffs/evidence/2026-09-25-m3-references-capture.md`, `…-m3-probes.md`(§4 포함), 샘플 `…-m3-samples.masked.jsonl`(행 1–20).

## 이 묶음의 범위
오케스트레이터가 프롬프트에서 지정한 작업(M3-n …)만 한다. 다른 작업의 코드를 미리 만들지 않는다(뒤 묶음의 인터페이스가 필요하면 계획서에 적힌 이름·모양 그대로 최소한만).

## 절대 규칙(위반 = BLOCKER)
- **CDP 금지**(`webContents.debugger`·`Page.*`·`Fetch.*`·`Input.*`·파일 선택 가로채기). 앱은 `maseQ`·`ogiZ0b`·`YhhmEf`·`MZZa6b` 를 만들지 않고 reCAPTCHA 를 부르지 않는다. **요청 본문 변조 금지**. 제출은 신뢰 클릭(`sendInputEvent` 마우스)만. **Flow 뷰에 키 `sendInputEvent` 를 보내지 않는다**(`@` 는 `execCommand('insertText','@')`).
- **돈 규칙**: `generationId` 있고 `videoPath` 없으면 상태 무관 재제출 금지. `MZZa6b` 200 = 과금. 클릭 뒤 불일치는 `postClick:true` + `rejectedMediaId`, `generationId`/`mediaId` 키 없음.
- **fail-closed**: 모르는 모양·불일치는 클릭 전 거부(0크레딧).
- **로그·Sentry 에 내용 금지**(프롬프트·파일 경로·파일명·`image.png` 같은 애셋 이름·URL·본문·토큰·base64·클립보드 내용·멘션 라벨) — 길이·id 앞 8자·개수·불리언·상태어만.
- 주입 문자열은 자기완결·멱등·minified 평가 테스트.

## TDD 절차(작업마다)
1. 계획서의 테스트를 **먼저** 쓰고 돌려 **빨강을 확인**한다(어떤 단언이 어떤 메시지로 빨갰는지 기록).
2. 최소 구현 → 그 파일 초록.
3. 계획서가 적은 **뮤테이션을 실제로 적용해 빨강 확인** 후 원복(`git diff` 로 원복 확인).
4. 관련 테스트 파일들 초록.
5. 묶음 끝에 전체 스위트를 한 번 돌려 결과(파일/테스트 통과·실패·스킵 수)를 보고한다: `cd ~/workspace/AutoFlowCut-bugfix && env -u ELECTRON_RUN_AS_NODE npx vitest run`. 실패가 있으면 원인을 고치고(기존 테스트를 약하게 만들지 말 것) 다시.

## 하지 말 것
- **커밋·푸시 금지**(오케스트레이터가 전체 스위트를 다시 판정하고 커밋한다).
- 요청과 무관한 코드 "개선" 금지, 추측성 기능 금지, 단일 용도 추상화 금지. 기존 스타일·주석 밀도를 따른다.
- 기존 테스트를 지우거나 약화하지 않는다(계획서가 교체하라고 한 것만).
- 앱 실행 금지(실기는 오케스트레이터).

## 보고(최종 메시지)
작업별: 새/바뀐 파일 · 먼저 빨갰던 단언 · 적용한 뮤테이션과 빨강 확인 · 계획서와 다르게 한 것(이유) · 계획서가 틀렸거나 모호했던 곳. 마지막에 전체 스위트 수치.
