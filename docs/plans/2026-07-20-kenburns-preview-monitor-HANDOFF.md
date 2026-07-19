# Ken Burns 프리뷰 모니터 — 새 세션 핸드오프

> **새 세션은 이 문서부터.** self-render 후속 작업. 브레인스토밍으로 방향 확정됨, 스펙부터 시작하면 됨.

## 목표

Timeline의 **Ken Burns 체크박스가 지금 플레이스홀더(Toast만)** 인 걸, 실제로 켜지게 + **프리뷰 모니터에서 줌/팬을 실시간으로 보이게** 한다. 핵심은 **self-render export와 100% 동일한 파라미터**를 써서 "Monitor에서 본 대로 self-render로 나온다"를 보장하는 것.

## 현재 상태 (플레이스홀더)

- `src/components/AudioTimeline/AudioTimeline.jsx:1023-1039` — Ken Burns 체크박스가 `checked={false} readOnly tabIndex={-1}`, `onClick`이 `e.preventDefault()` + `toast.info(t('audioTimeline.kenBurnsToast'))`. 실제 토글 X, 프리뷰 효과 X.
- `src/components/AudioTimeline/PreviewPanel.jsx:235` — `<img className="atl-preview-img">`가 현재 씬(`scene`, playhead 기반 `findRangeAt`)을 **정적**으로 표시. transform 없음.

## 설계 (확정)

**결정: (b) export 설정과 연동** — Timeline 토글이 `useExportSettings`의 kenBurns 설정을 읽고/쓰고, 그게 프리뷰 + export 양쪽에 반영(단일 진실).

1. **로직 공유 (이동 불필요)**: `electron/render/kenBurns.js`의 `computeKenBurns(scene, index, { mode, scaleMin, scaleMax })`를 **renderer에서 직접 import**. `src`가 이미 `electron/`을 import하는 관습 있음(`src/sentry-init.js` → `../electron/sentry-scrub.js`). 이게 self-render export(`buildRenderPlan`)가 쓰는 바로 그 함수 → 파라미터 100% 일치.
2. **프리뷰 렌더**: `PreviewPanel`의 `<img>`에 CSS `transform: scale()/translate()`를 씬 진행률로 보간해 적용. 진행률 `p = (playheadMs − sceneStartMs) / (sceneEndMs − sceneStartMs)` (sceneRanges에서 나옴). scale = lerp(startScale, endScale, p), anchor = lerp(startAnchor, endAnchor, p).
3. **상태 연동**: `useExportSettings`(kenBurns/kenBurnsMode/kenBurnsScaleMin·Max %)를 Timeline까지 공유. 체크박스 = kenBurns on/off. 켜면 프리뷰가 반영하고 export에도 그대로 감.

## 열린 질문 (스펙에서 확정)

1. **anchor → CSS transform 공식**: self-render zoompan은 `x=(iw-iw/z)*anchorX`(crop 좌상단). CSS는 `transform-origin` + `translate`/`scale`로 같은 좌표계를 재현해야 "본 대로 나옴". 이 매핑 공식이 핵심 — 스펙에서 수식 고정 + 골든 테스트. (픽셀 완벽일치는 불가, 시각 동일이 목표.)
2. **상태 소스 배선**: `useExportSettings`가 App→ExportModal에만 흐르는지, AudioTimeline까지 어떻게 내려줄지(prop drilling vs context). 기존 배선 확인 후 최소 침습.
3. **kenBurnsScale 단위**: useExportSettings는 %(100~130), computeKenBurns는 ratio(1.0~1.3). ExportModal `buildExportOptions`가 `/100` 변환(`:201-202`). 프리뷰도 같은 변환 필요.
4. **mode='random'**: 씬 인덱스 시드라 씬마다 방향 다름 — 프리뷰도 그 씬의 실제 방향을 보여줌(computeKenBurns가 index 받으니 자동). 씬 인덱스를 PreviewPanel이 알아야(sceneRanges 순서 = index?).
5. **비디오 오버레이 씬**: 프리뷰가 `<video>`로 재생 중인 씬엔 Ken Burns 미적용(정지 이미지에만). export도 동일.

## 절차

1. 짧은 스펙 → `docs/plans/2026-07-20-kenburns-preview-monitor-design.md`
2. Codex(gpt-5.6-sol) + Fable 5 크로스 리뷰 findings 0 ([[decisions-need-codex-and-fable]], [[role-split-codex-authors-fable-reviews]])
3. TDD 구현: computeKenBurns import + CSS transform 계산(순수 함수 `kenBurnsPreviewStyle(scene, index, p, settings)` → `{transform, transformOrigin}`, 골든 테스트) + 체크박스 실토글 + 상태 배선
4. **실앱 눈검증**(필수 게이트, [[reviewers-miss-ui-discoverability]]): 체크 on → 프리뷰에서 줌/팬 보임 + self-render export 결과와 눈으로 대조(같은 방향/느낌인지)

## 컨텍스트

- 브랜치: `feature/self-render` (동일 브랜치에 이어서). self-render 본체는 완료(크로스리뷰 4R + 품질 2R findings 0, 6498 통과) — [[autoflowcut-self-render]] / `docs/plans/2026-07-18-self-render-HANDOFF.md` 참고.
- self-render 자체의 남은 것(실앱 눈검증)과 이 Ken Burns 프리뷰는 별개 작업이나 같은 브랜치.
