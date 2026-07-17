# Story 토큰 사용량 표시 — 핸드오프 (2026-07-18)

**브랜치**: main (푸시됨, `49af0d3f` 까지). **커밋 안 된 WIP 2파일 있음 — 아래 참고.**
**한 줄 요약**: 코드·테스트(6318)·리뷰(4라운드 findings 0)는 끝났는데, **실앱 눈검증에서 UX 두 개가 걸렸다** — 실시간 증가 안 됨 + 위치. 이 둘이 남은 일이다.

---

## ⚠️ 이번 세션의 뼈아픈 교훈

**리뷰 4라운드를 돌리는 동안 실앱을 한 번도 안 띄웠다.** "findings 0"은 코드 리뷰 기준이었지 실앱이 아니었다.
정작 사용자가 앱을 열자 두 가지가 바로 드러났다(아래 UX 이슈). 그리고 초반엔 **오늘 변경 전에 빌드된
옛 `.app`을 실행 중**이라 배선이 통째로 없어 아무것도 안 떴다 — 코드는 다 맞았는데.

→ **UI/실행 흐름은 코드가 맞아도 실앱에서 눈으로 봐야 끝난다.** 다음 사람은 착수 전에 실앱부터 띄워라.

---

## 🚧 남은 일 (우선순위 순)

### 1. dev 가 안 뜬다 — 이걸 먼저 고쳐야 반복이 빠르다 (사용자가 이걸 택함)

**증상**: `npm run dev` 도, `npx electron .` 도 electron main 로딩에서 죽는다:
```
TypeError: Cannot read properties of undefined (reading 'exports')
  at cjsPreparseModuleExports (node:internal/modules/esm/translators:297:81)
Node.js v22.19.0
```

**원인 (확인됨)**: `music-metadata`(오디오 파서, MpegParser/FlacParser/MatroskaParser 등)가 **CJS 모듈**인데
electron main 번들(`dist-electron/main-*.js`, 3.3MB, ESM)에 섞여 들어가 Node 22 의 ESM/CJS interop 에 걸린다.
- `music-metadata` 사용처: `electron/story/audioProbe.js:8` — `(await import('music-metadata')).parseFile`
- vite.config 의 main build `rollupOptions.external` 은 현재 `['electron']` 뿐 (vite.config.js ~54).

**해결 방향 (미착수)**: main 번들의 `rollupOptions.external` 에 `music-metadata`(및 그 전이 CJS 의존성)를
추가해 번들에서 빼고 런타임 require 로 돌린다. 패키징 시 node_modules 포함(asar unpack) 확인 필요.
- ⚠️ **왜 `.app`(electron-builder)은 되는데 dev/직접실행은 안 되나**는 아직 정확히 안 팠다.
  electron-builder 로 만든 `.app` 은 잘 뜬다(실측). dev 의 vite-plugin-electron 이 main 을 실행하는 방식
  차이일 수 있다 — 에러가 `Node.js v22.19.0` 을 찍는 걸 보면 **electron 이 아니라 node 로** main 이 로드되는
  정황. 여기부터 파라.

**이게 병목인 이유**: dev 가 안 되니 UI/기능 변경마다 `npm run build && electron-builder --dir`(몇 분) 재빌드해야
사용자가 확인한다. 실시간 usage·UI 위치를 반복 조정하려면 dev(HMR) 가 필수다.

### 2. 실시간 증가 — 완료 시점에만 뜨고, 생성 중엔 안 오른다 (사용자 지적, 정당함)

**증상**: 대본/씬 생성 **중**엔 토큰이 안 오르고, **완료 순간**에만 한 번 뜬다.

**원인**: 현재 tap 은 `type === 'result'`(응답 완료 메시지)에만 발화한다
(`electron/api/llm/usageTokens.js` `claudeResultToUsage`, `llmClaude.js` `tapQuery`). claude 는 스트리밍 중엔
텍스트 델타(`stream_event`)만 보내고 usage 는 result 에 한 번 싣는다.

**해결 방향 (가능 확인됨 — 미착수)**: claude API `message_delta` 이벤트에 `usage: BetaMessageDeltaUsage` 가 있다
(`@anthropic-ai/sdk/.../messages.d.ts:1712`). SDK 도 `SDKPartialAssistantMessage`(type: `'stream_event'`,
sdk.d.ts:3869)로 스트리밍 이벤트를 노출한다(`includePartialMessages: true` — 시놉시스 경로가 이미 켬,
llmClaude.js:198). **Claude Code 자신이 thinking 중 실시간 증가시키는 것과 같은 방식이다** — 사용자가 정확히 짚었다.

- ⚠️ **주의**: `message_delta.usage.output_tokens` 는 그 응답 내 **누적치**(스트리밍 중 증가)다. 매번 addDelta 하면
  중복 합산된다. codex 의 cumulative 처리처럼 **"진행 중 응답의 임시 usage"** 개념이 필요하다:
  응답 단위로 교체(pending) → result 에서 확정(commit). 응답 경계는 message_start 의 `message.id` 로 구분.
- 즉 tracker 에 pending/committed 2단이 필요할 수 있다. 설계 다시 볼 것.

### 3. UI 위치 — 별도 영역 말고 스텝별 기존 UI 에 인라인 (사용자 요구)

사용자 요구(실앱 보며 준 것):
- **별도 영역/줄 만들지 말 것.**
- 시놉시스·대본 → **편집 창(textarea) 밑**
- 씬 분리 → **소요시간(진행 표시 StoryRunning) 옆/밑**
- 프롬프트 → **lines/words 줄에 같이** (프롬프트 스텝의 라인수 카운트 표시 근처)

**진행 상황 (커밋 안 됨)**: 씬분리 쪽은 착수함 — `StoryRunning`(진행 표시)에 usage 인라인 추가하고 별도
하단 바(`StoryTokenUsage` 렌더)를 제거했다. **미검증(실앱 확인 못 함).** 나머지 위치(편집창 밑, lines/words)는 미착수.

---

## 📌 커밋 안 된 WIP (git status: M 2파일)

```
M src/components/story/StoryView.jsx
M src/components/story/StoryView.css
```

내용 (씬분리 인라인 작업, **미검증**):
- `StoryView.jsx`:
  - import 를 `StoryTokenUsage`(default) → `{ formatTokens }`(named) 로 변경 (:21)
  - `StoryRunning` 컴포넌트에 `usage` prop + 경과시간 옆 `.story-running-tokens` 인라인 렌더
  - `<StoryRunning>` 5곳에 `usage={usage}` 주입
  - story-view 하단의 `<StoryTokenUsage usage={usage} />` 제거 (별도 영역 없앰)
- `StoryView.css`:
  - `.story-token-usage` 하단바 블록 제거 → `.story-running-tokens` 인라인 스타일 추가

**판단 필요**: 이 WIP 를 살릴지(씬분리 인라인 방향 유지) 되돌릴지(`git checkout src/components/story/`).
빌드는 통과(EXIT 0)하나 실앱 확인은 안 됐다. `StoryTokenUsage.jsx`(하단바 컴포넌트)는 아직 파일로 남아있고
`formatTokens` 만 쓰인다 — 인라인 방향으로 확정되면 컴포넌트 자체는 지워도 된다.

---

## ✅ 완료된 것 (main 에 푸시됨)

수집·표시 계층 전부. 조용히 틀린 합계를 막는 3겹(엔진별 정규화 / 배선 / sink 핸드오프 격리) 뮤테이션 검증됨.

| 커밋 | 내용 |
|---|---|
| e40b39a2 | generateTitle abort 대칭 (기존 버그 수정 + 토큰 누수 차단) |
| e6fdd21f | 수집→표시 배선 (machine tracker + 4채널 usage) |
| 9ee56616 | 1R findings (배선 테스트 무가치 → 뮤테이션으로 죽는 테스트, sink 캡처, epoch 제거) |
| 5bacee01 | 2R Codex (sink import-전 캡처, aborted toast, codex 통합 테스트) |
| e6a2e127 | 2R Fable (거짓 커버리지 주장 정정, 문서 모순) |
| 3951af8f | 3R Codex (실패 side action `story:usage` 이벤트, aborted resolve 경로) |
| d1fc69ab | 3R Fable (import 레이스 회귀 테스트, 문서) |
| 49af0d3f | 하단 고정 바로 위치 이동 (← WIP 가 이걸 다시 인라인으로 바꾸는 중) |

**설계·구현 근거**: `docs/plans/2026-07-17-story-token-usage-design.md`,
`docs/plans/2026-07-17-story-token-usage-plan.md`.

핵심 사실 (다시 파지 말 것):
- codex payload 는 **중첩**: `params.tokenUsage.total`(누적) 을 읽고 threadId 별 교체. 스키마는
  `codex app-server generate-ts --experimental` 로 실측 확정 (0.144.5).
- claude in = `input_tokens + cache_creation + cache_read`(캐시 제외돼 있어 다 더함), out 은 thinking 포함.
- 라우터 우회는 factCheck 하나뿐. gemini 는 프로덕션 미배선(범위 밖).
- tap 은 파서가 아니라 `llmClaude.js` `defaultQuery`(제너레이터 레벨) — 그 위 query 루프가 11개라.

---

## ⚠️ 함정 (다음 사람이 알아야)

- **`npm run dev` / `npx electron .` 는 지금 안 뜬다** (위 §1). 확인은 `npm run build && npx electron-builder --dir`
  후 `release/mac-arm64/AutoFlowCut.app` 실행. quarantine 걸리면 `xattr -dr com.apple.quarantine <app>`.
- **실행 중인 게 옛 빌드 `.app`(AppTranslocation "Series Comic")인지 항상 의심하라.** 재빌드 안 하면 옛 코드가 뜬다.
  asar 검증: `grep -ac 'story:usage' <app>/Contents/Resources/app.asar` (문자열 리터럴은 minify 후에도 남는다).
- **`.app` 바이너리 직접 실행(`Contents/MacOS/...`)은 서명/Gatekeeper 로 조용히 죽는다.** `open <app>` 을 써라.
- **`npm run test:run` 은 실패해도 exit 0.** 숫자를 직접 봐라. 이 세션은 `npx vitest run` 을 직접 썼다.
- **StoryTokenUsage 는 0/0 이면 숨긴다** (`if (!usage || (!usage.input && !usage.output)) return null`).
  파이프라인 돌리기 전엔 안 보이는 게 정상 — "안 보인다" 신고의 절반은 이거였다.
- **UI 는 붙자마자 실앱 눈검증.** 리뷰 findings 0 은 실앱 게이트가 아니다.
- **내 pkill 이 사용자가 띄운 앱을 죽인 적 있다.** 프로세스 죽일 때 `.app`(사용자) vs `npx electron .`(내 테스트) 구분.

---

## 다음 세션 시작점

1. `git status` 로 WIP(StoryView 2파일) 확인 → 살릴지 되돌릴지 결정.
2. **dev 고치기부터** (music-metadata external) — 실앱 반복이 빨라진다.
3. dev 되면: 실시간 usage(message_delta pending/commit) + UI 위치(스텝별 인라인) 를 HMR 로 빠르게 조정.
4. 매번 실앱 눈으로 확인. 특히 파이프라인 **돌리는 중** 숫자가 오르는지.
