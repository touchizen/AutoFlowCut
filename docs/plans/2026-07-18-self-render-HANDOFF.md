# Self-Render Export — 새 세션 핸드오프

> **새 세션은 이 문서부터 읽어라.** 이어서 작업할 것과 현재 상태를 담는다.

## 무엇

AutoFlowCut에 **4번째 내보내기 타입 `render`(자체 렌더링)** 추가 — 프로젝트를 로컬 ffmpeg로 MP4 렌더(Ken Burns pan/zoom + 자막 번인 + 나레이션/SFX 믹스, preview/final 2모드). GCF 미사용(완전 로컬), 무과금.

- **worktree**: `/Users/tuxxon/workspace/AutoFlowCut-selfrender`, 브랜치 `feature/self-render` (base main `c0479c6b`, 미푸시)
- **스펙**: [docs/plans/2026-07-18-self-render-export-design.md](2026-07-18-self-render-export-design.md) (rev.7, Fable+Codex 6R findings 0)
- **플랜**: [docs/plans/2026-07-18-self-render-export-plan.md](2026-07-18-self-render-export-plan.md) (12 TDD 태스크)

## 완료 (커밋됨)

Task 1~11 코드 전부 + 크로스 리뷰 2라운드 + 배포 인프라(B). 전체 스위트 **6477 통과**(ffmpeg 있을 때, 실 스모크 3 포함 / 없으면 3 skip).

**핵심 모듈** (`electron/render/`):
- `kenBurns.js` 결정론 zoompan 파라미터 · `subtitleAss.js` .ass(폰트=NanumGothic) · `validateRequest.js` IPC 검증 · `resolveInputs.js` 경로해석+base64 decode · `audioAdapter.js` 4형태 오디오 · `buildRenderPlan.js` 순수 플랜(스테이징 트리) · `ffmpegRunner.js` 스테이지 실행+취소+디스크preflight · `ffmpegPath.js`
- `electron/ipc/render.js` IPC(jobId 레지스트리+AbortController 취소+before-quit 배리어)
- `src/exporters/render.js` · `src/hooks/useExport.js` handleExportRender(Premiere 미러) · `src/components/ExportModal.jsx` render 탭
- `scripts/install-platform-binaries.cjs` 정적 ffmpeg 스테이징 · `scripts/verifyBinaryArch.cjs` PE/ELF/Mach-O arch · `scripts/afterPack.cjs`

**검증 방식** ([[role-split-codex-authors-fable-reviews]]): 어려운 건 Codex(gpt-5.6-sol) 작성 → Fable 5 리뷰 → **내가 뮤테이션+실측 검증**. 순수 모듈은 내가 직접. 실측 사례: ffmpeg 필터 이스케이프 2패스([[ffmpeg-filter-escape-two-pass]]), 진행바 jobId 버그(내 뮤테이션이 놓친 걸 크로스 리뷰가 잡음).

## 남은 것 (TODO)

1. **ffmpeg static SHA 채우기 — mac/win/linux 다** (진행 중):
   - ✅ `darwin-arm64`: osxexperts, SHA `563111a2…27f2` pin, vendor 배치+self-contained 확인(otool 깨끗, zoompan/subtitles/ass/libx264/aac ✓), ffmpeg 7.0
   - ⏳ `darwin-x64`(evermeet 7.1.1), `win32-x64`(BtbN), `linux-x64`(johnvansickle) — 다운로드해서 SHA pin 필요. **`scripts/install-platform-binaries.cjs`의 `TODO_FILL_SHA` 교체.**
   - ⚠️ **rolling URL 주의**: BtbN `latest`, johnvansickle `release`는 매번 바뀜 → SHA pin이 곧 무효. **고정 버전 태그 URL로 교체 권장**(BtbN autobuild 태그, johnvansickle 버전 tar).
2. **round-3 크로스 재리뷰**: A(코드 버그) findings 0 확인. Fable(agent a1cf422d), Codex(thread 019f744f) 이어서. 리뷰 패키지 `.superpowers/sdd/review-c0479c6b..<HEAD>.diff`.
3. **실앱 눈검증** (필수 게이트, [[reviewers-miss-ui-discoverability]]): `npm run dev` → render 탭 → 3~5씬 프로젝트를 **preview/final × 16:9/9:16 × 자막 on/off**로 렌더. 눈으로: Ken Burns 떨림 없음 · **한글 자막 tofu 없음** · 오디오 싱크 · 취소 확인 다이얼로그 · 진행바 동작. dev는 vendor/ffmpeg/darwin-arm64 사용(배치됨).
4. **PR/머지**: 눈검증 후. `.planning`/`.superpowers` 제외.

## 함정/교훈

- **vendor/ffmpeg는 gitignore** — 스크립트가 스테이징. dev는 `npm run install:platform-binaries` 필요(predev 미연결, TODO).
- **진행바 jobId**: jobCtx.jobId + relay `{...p, jobId}` (스프레드 뒤). runner가 jobId:undefined 흘려도 안전.
- **취소**: ipc AbortController → jobCtx.signal → runner SIGKILL. before-quit는 await 배리어.
- **폰트**: ASS Style은 번들 TTC 실제 패밀리명 `NanumGothic`(공백 있는 'Nanum Gothic'은 시스템 폴백 — 쓰지 말 것).
- **디스크 preflight**: 0.02 B/px/frame(과대추정 금물 — 0.08은 정상 렌더 오차단).
- **테스트**: `npx vitest run tests/electron/render/ tests/electron/ipc/render.test.js tests/integration/render.smoke.test.js`. 실 스모크는 ffmpeg 있어야 실행(없으면 skip).

## 커밋 이력 (feature/self-render)

`830ff799`(kenBurns) → … → `bcabddc6`(buildRenderPlan) → `42a1bc65`(runner) → `37d1455e`(IPC) → `424df200`(exporter) → `c92b6d67`(UI) → `4eda7d33`(크로스리뷰 R1) → `a9d1f983`(크로스리뷰 R2) → (B: 정적ffmpeg+실스모크, 커밋 예정)
