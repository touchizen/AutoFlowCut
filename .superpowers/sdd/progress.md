# Agent UI Redesign — SDD progress ledger
Plan: docs/superpowers/plans/2026-07-16-agent-ui-redesign.md
Spec: docs/superpowers/specs/2026-07-16-agent-ui-redesign-design.md (rev7, Codex 7R findings=0)
BASE commit (before Task 1): 5ae54c9
Branch: feature/inapp-agent
Roles: implementer=Codex subagent (gpt-5.6-sol, workspace-write, xhigh); verify=Opus (full suite + raw diff + mutation); Fable review discontinued (token budget)

## Tasks
(진행 시 기록)

## Minor findings (for final review)
- Task 1: complete (commit f6d5533, Opus verify: suite 659f/7232 GREEN, wiring chain preload→agent-api→sessionManager→codexOrchestrator turn/start.model verified, preload passes params whole so no preload change)
- Task 2: complete (commit afcbb86, Opus verify: suite GREEN, createAgentModelCatalog contract OK — fallback[]/hidden-filter/cache/1-retry/inFlight-dedup, agent:list-models + preload agentListModels, no Story coupling)
- Task 3: complete (commit 3e7b7c4, base afcbb86). Opus verify: diff=brief verbatim, targeted 6 passed, mutation KILLED (nextEnabled disabled-skip + hidden-filter), full suite 660f/7240 GREEN. Fable review: 1 Important + 6 Minor.
  - FIXED (Important #1): hidden-filter had 0 test coverage (mutation-proven surviving). Added `hidden 모델은 옵션에서 제외한다` test → mutation now KILLED, amended into commit.
  - PLAN-CONTRADICTION to surface at final review (Fable #4): brief's test 2 mandates `nextEnabled` SKIPS the disabled Claude option → SR/keyboard users can never reach the "Coming soon" entry (APG recommends disabled options stay navigable). Design tension, do NOT fix unilaterally — human/final-review decision before Task 5 integration.
  - Minor (for final review, all spec-inherited/defense-in-depth unless noted):
    - #2 `loading` prop is write-only — no `[data-loading]` CSS rule, no observable effect, test 5 passes incidentally.
    - #3 stale activeIndex flash on click-reopen (useEffect resets post-paint; SR may double-announce). Keyboard-open immune.
    - #5 provider headers `role="presentation"` inside listbox = invalid ARIA group structure (should be role=group + aria-label).
    - #6 optionId sanitization collides for dotted ids (`gpt-5.1` vs `gpt-5-1`) / literal `default`/`claude-coming-soon` ids → ambiguous aria-activedescendant. Low real-world risk; watch when real Codex ids flow in Task 5.
    - #7 unmatched `value` inconsistency (button shows Default but no aria-selected; `value='claude'` lands activedescendant on disabled option). Unreachable via own onChange; defense-in-depth.

- Task 4: complete (commit 7dc4016, base 3e7b7c4). Opus verify: diff=brief verbatim (en 17 keys, ko 17 keys + closeSession '세션 닫기'→'세션 종료'), targeted 6 passed, parity mutation KILLED (drop key → red), full suite 660f/7242 GREEN. Fable review: findings 0 (verified full 121-key parity, zero duplicate keys, closeSession single, empty/raw-key/missing mutations all killed, ko semantics OK).

- Task 5: complete (commits 40da0d2 base + 7782701 fix1 + 6140ae4 fix2, base 7dc4016). Opus verify: diff semantics OK (snapshot before await, running guard, model-omission, Send disabled=running||!input.trim()), targeted GREEN, mutations KILLED (Send running-guard after test-strengthen, ensureSession model, abort-epoch guard, open-fail reset, sync abort bump), full suite 660f/7249 GREEN. ⚠️ mid-task incident: `git checkout --` on UNCOMMITTED ChatPanel.jsx reverted Task5 work → recovered via captured-diff `git apply`. LESSON: commit BEFORE mutation-testing (checkout restores to HEAD, destroys uncommitted work). Fable 3 rounds → findings 0:
  - R1: Important #1 Stop-during-open race (setRunning(true) before ensureSession lets Stop fire, aborted turn still launched) + Important #2 open-fail running-reset untested + Minor #3/#4.
  - FIXED #1 (fix1 7782701): abortEpochRef captured pre-open, guard before agentSend, bumped in abort()/close(). FIXED #2: added open-fail reset test. Also strengthened running-Send-disable test (mutation had survived — input-empty masked the running term).
  - R2: fix1 had RESIDUAL race — epoch bump in finally (post agentAbort await); open-resolves-before-abort still fired agentSend. FIXED (fix2 6140ae4): moved bump to synchronous first line of abort()/close() + probe test (defers both open & abort, resolves open first).
  - R3: findings 0 (Fable verified via own worktree mutation).
  - DEFERRED to final review (Minor): #3 collapsed-mode selector listbox clipped (190px overflow:hidden header) — likely superseded by Task 6-8 which replace collapse with FAB/dismiss; #4 omission assertions can't distinguish absent key from model:undefined (behavioral risk ~0, code omits key + IPC tolerates undefined).

- Task 6: complete (commit cc61503, base 6140ae4). Opus verify: diff=brief verbatim (agentPanelMode default 'floating' + loadSettings normalization), targeted 15 passed, mutation KILLED (disable normalization → 'drawer' test fails), full suite 660f/7252 GREEN. Fable review: 0 Critical/Important, 2 Minor (for final review): M1 updateSetting/setSettings bypass load-time validation in-session (identical to existing saveMode/seedNo pattern, brief specified load-time only, Task 7 is sole writer with fixed literals); M2 no non-string/null stored-value test (code is type-safe via Array.includes, verified, just unpinned).

- Task 7: complete (commit fec37b4, base cc61503). Opus verify: diff semantics OK (open/onOpen/onDismiss props, FAB fragment before aside, is-open/is-dismissed class keeping is-collapsed, dismiss button, App owns agentPanelOpen default false + source-string-exact props, Robot.svg, position fixed→absolute), 3 test files GREEN (ChatPanel 34, appMount 3, agentI18n 6), mutation KILLED (always-is-open → dismissed-state test fails), full suite 660f/7253 GREEN. Fable review: 0 Critical/Important, 3 Minor:
  - #1 collapsed-drag uses viewport coords + window clamp, now under position:absolute — exact today (.app at 0,0) but breaks if .app gains offset → **Task 8 reworks container-clamped drag, address there**.
  - #2 no focus handoff on open/dismiss (focused button becomes visibility:hidden → focus resets to body; aria-hidden-on-focused warning). Brief didn't require. Final-review UX item.
  - #3 live regions (role=alert / aria-live) muted while dismissed with no FAB badge — inherent to dismiss-without-close (session keeps running); Task 8/9 scope.

- Task 8: complete (commits b7dfbca base + 2d8f427 fix, base fec37b4). Opus verify: collapse fully removed, helper verbatim, CSS no viewport units + FAB/selector/heading preserved, 4 test files GREEN, mutations KILLED (effectiveMode flow-derive clean assertion / floatingPanelBox / dragEnabled gating / reclamp / selector-drag guard), full suite 661f/7264 GREEN. Fable R1: 1 Important (I1) + 4 Minor.
  - FIXED I1 (fix 2d8f427): dragged floating panel stranded off-container (.app overflow:hidden) on Flow entry/window shrink — added reclampAgentPanelPosition helper + appMode-keyed re-clamp effect + guarded ResizeObserver + positionRef mirror. Fable R2: RESOLVED, no render-loop/ref-desync/observer-leak.
  - FIXED M3 (functional): model-selector listbox options (role=option divs) started panel drag → guard broadened to closest('button, .agent-model-selector'). FIXED M2: re-added button-press-not-drag test.
  - DEFERRED to final review (Minor): M1 dead i18n keys agent.collapse/agent.expand (now unused, locales out of Task-8 scope); M4 four-way-split test proves production-dead floatingPanelBox helper (CSS drives real size; CSS-grep invariant IS meaningful but FAB 72 hardcoded not derived); + slide-mode position-memory nit (RO re-clamps floating pos against slide geometry → toggling back to floating snaps to top; always in-bounds, cosmetic).

- Task 9: complete (commit bebbfe3, base 2d8f427). Opus verify: 6 buttons→AgentIconButton with all 6 accessible names preserved, tooltipPosition verbatim, portal to body, 3 test files GREEN, mutations KILLED (placement flip / left-clamp / [aria-describedby & regex fixes below]), full suite 662f/7268 GREEN. Fable 2 rounds → findings 0:
  - Mid-task PLAN-INTERNAL CONTRADICTION resolved: Task 9 brief's `.agent-portal-tooltip { max-width: min(260px, calc(100vw-16px)) }` (legit — portal is position:fixed on body) tripped Task 8's over-broad `/agent-chat-panel[\s\S]*?100v[wh]/` regex (non-greedy bridged to tooltip). Kept tooltip 100vw, tightened Task 8 regex. R1 Fable caught my first tightening `\s*\{` MISSED `.mode-slide` viewport regressions → adopted Fable's `/\.agent-chat-panel[^{]*\{[^}]*100v[wh]/` (mutation-verified: catches base + mode-slide + descendant, no tooltip false-positive).
  - FIXED Minor (aria-describedby): guarded `showTooltip && tooltip ? tooltipId : undefined` (was dangling id ref when no tooltip prop — latent, reusable component).
  - DEFERRED to final review (Minor): Escape-to-dismiss tooltip missing (WCAG 1.4.13, brief didn't require); informational: viewport regex doesn't match 100dvh/svh/vmin/vmax (pre-existing).

## ALL 9 TASKS COMPLETE + final review done. HEAD=2bf5daa. Full suite 662f/7270 GREEN. Build exit 0 (vite dist + preload.cjs). NOT pushed (origin 5ae54c9). Pending: user live-smoke eye-check (incl. I-1) + push confirm.

## Final Verification gates (all GREEN)
- codex pin 0.142.5 ✓, B tool inventory 25 ✓, backend model wiring 2 ✓, catalog IPC 9 ✓
- scope: electron/ipc/layout.js, electron/agent/toolCore.js, package.json, Flow bounds UNTOUCHED ✓
- npm run build exit 0 (vite dist/ + dist-electron/preload.cjs fresh) ✓
- full suite 662f/7270 GREEN ✓

## Final whole-branch review (Fable, 5ae54c9..2bf5daa)
- Spec §1-§5 all met; cross-task state machine (running/epoch/session/open/effectiveMode) + model chain robust; 5 per-task fixes compose without conflict; Global Constraints not violated.
- Important I-1 (T3×T8 CROSS-TASK): model selector listbox (position:absolute, z-index 3) can be CLIPPED by panel .agent-chat-panel{overflow:hidden}, esp. empty/short floating panel or 288px narrow split. Spec §3 portal-ized the TOOLTIP for this exact reason but the SELECTOR dropdown was missed. Pixel estimate → **GATED ON USER LIVE-SMOKE EYE-CHECK** (open dropdown in empty panel). If clipped, fix = portal-ize listbox like AgentIconButton tooltip, or adjust listbox position/panel overflow. NOT blind-fixed pre-confirmation (avoid speculative refactor of just-reviewed selector).
- must-fix T7 focus handoff → FIXED (commit 2bf5daa): open→focus textarea, dismiss→focus FAB, prevOpenRef guards mount/rerender. Fable re-review: findings 0 (no focus-steal, tests mutation-proven).
- New Minors (ship-as-is): M-1 Flow enter/exit cycle deterministically triggers slide-geometry reclamp of floating pos (cosmetic top-jump); M-2 portal tooltip clamps to viewport not container → can overhang into native Flow area when panel near Flow edge; M-3 newly-added dead i18n keys agent.slideMode/floatingMode (+ pre-existing collapse/expand).
- Minor MERGE-TRIAGE: only T7 focus was must-fix (done). All 12 other accumulated Minors = ship-as-is (T3 loading/flash/SR-Claude-skip[plan-ok]/role=presentation/optionId-collision/unmatched-value; T5 omission-assert; T6 updateSetting-bypass/non-string-test; T7 dismissed-live-region; T8 dead-keys/slide-pos-memory; T9 tooltip-Escape/regex-dvh). Recommended a11y follow-ups: dismissed-live-region FAB badge, tooltip Escape, provider role=group, dead-key cleanup.
- Verdict: mergeable conditional on (1) T7 focus [DONE] + (2) I-1 eye-check confirmation.

## Remaining user live-smoke gate (plan §7, cannot be automated — needs real Electron + Codex):
1. I-1: open model dropdown in empty floating panel — is the listbox (esp. last "Coming soon" row) clipped? [Important, gates merge]
2. First-entry shows 72px Robot FAB bottom-right; FAB→panel→dismiss→FAB round-trip preserves messages.
3. API floating↔slide toggle; restart restores saved slide pref.
4. Stored slide + Flow on → instant floating + toggle disabled+notice; back to API → reverts to slide (stored not overwritten).
5. Flow split-left/right/top/bottom at ratio 0.8 — panel/FAB not hidden behind native Flow, not clipped at 288×180, log scrolls internally.
6. 4 action icons hover + keyboard focus → tooltip not clipped, body portal.
7. Real Codex model A first response → switch selector to B mid-stream → Steer keeps active turn on A.
8. After turn done, new Send → same thread context, model B applies from next turn (one real call).
9. Catalog auth-fail / Codex-absent → selector stays Default, Send tries app-server default.

## Resume notes (for next session)
- Fable 5 review RESTORED (token reset). From Task 3 on: implementer=Codex, ADVERSARIAL REVIEW=Fable 5 (Agent model:'fable'), attach prior findings, loop to findings 0. Opus still runs full suite + raw diff + mutation directly.
- ALL TASKS + final review + must-fix DONE. HEAD=2bf5daa. 12+ local commits (f6d5533..2bf5daa), NOT pushed; origin 5ae54c9. Awaiting user live-smoke eye-check (esp. I-1 listbox clip) + push confirm.
- If I-1 confirmed clipped at eye-check: portal-ize AgentModelSelector listbox (mirror AgentIconButton PortalTooltip pattern) OR relocate listbox / relax panel overflow. Then re-verify + push.

## POST-PLAN: composer redesign (user eye-check driven, new scope) + codex bump
- Trigger: user eye-check found composer should adopt reference "input + bottom toolbar" look; picked "pattern adoption". New scope beyond the 9-task plan, same rigor (Codex author → Opus mutation-verify → Fable findings 0).
- Slice 1 (commit cfbabec): portal-ize AgentModelSelector listbox → document.body (fixes final-review I-1 clipping + Claude "구현 예정" now visible). listboxRef + stopPropagation dual outside-click guard (stopPropagation load-bearing: portal React-bubble reaches header drag). Opus: 10/10, combined-guard mutation KILLED. Fable: 0 Crit/Imp, 4 Minor; fixed M-1 dead .agent-model-listbox positioning CSS + M-4 test viewport-restore; M-2 (z-index invariant test blindspot, pre-existing) + M-3 (scroll setState perf) logged.
- Slice 2 (commit d2220ee + fix 9b0fedf): reference-style composer — model picker moved to bottom toolbar (left), Send/Stop MERGED into one state-flip button (idle=Send/submit, running=Stop/red/abort), Close-session moved to header, running/flow indicators next to title, rounded compose w/ focus glow. Opus: 40/40, merge mutation KILLED (5 fail). Fable R1: Important (double-click Send→2nd click hits flipped Stop → cold-session silent message swallow via abortEpoch bail / warm abort) + Minor (dead .agent-model-selector drag token + vacuous test). Fixed (9b0fedf): STOP_ARM_MS=300 arm delay on Stop primary; trimmed drag guard; deleted vacuous test. Opus: cooldown mutation KILLED. Fable R2: both resolved, no new defect (Stop always works after 300ms), mutation-verified. findings 0.
- codex bump (commit af4c0cc): USER OVERRODE the 0.142.5 pin. Confirmed via scratch install that 0.144.1+ model/list returns gpt-5.6-sol/terra/luna (0.142.5 only had 4 models, no gpt-5.6, not a hidden-filter issue). Bumped @openai/codex 0.142.5 -> 0.144.5 (exact). Project model/list now returns 7 incl gpt-5.6 variants. packaging derives version dynamically (install-platform-binaries.cjs reads installedVersion) so no hardcode breakage. full suite 662f/7276 GREEN.
- HEAD now af4c0cc. ⚠️ LIVE SMOKE still needed (user gate): (1) composer look + mode-toggle clickable (model selector left header, should unblock) + Claude/gpt-5.6 visible in dropdown; (2) 0.144.5 app-server contract — per-turn model, elicitation granular approval, persistent thread were spiked against 0.142.5; confirm 0.144.5 still honors turn/start.model + thread persistence with a real call; (3) select gpt-5.6-sol mid-stream → next turn uses it.

## POST-PLAN 2: docking redesign (user-driven, eye-check loop)
- User rejected "slide overlay" → wants DOCK that pushes content ("보면서 할 수 있잖아"). Two modes now: Floating ↔ Docking.
- a3b1007 Slice A: dock pushes app content (API). `.app.agent-docked{padding-right:var(--agent-dock-w)}` + panel at right:0 strip; 'slide'→'docked' rename+migration. Fable: 0 Crit/Imp, 4 Minor (M1 fixed 400px no minWidth; M2 QA banner covers dock header; M3 dock z3200 occludes modals/maximized monitor; M4 real reflow only string-grep-tested → eye-check load-bearing). **User eye-verified API dock works ✓**
- 88f84d8 Slice C: resizable dock (drag handle, persisted `agentDockWidth`, pure `clampAgentDockWidth` min280/max min(720, 60% container)). Mutation KILLED. Supersedes M1.
- 5ab8cd0 Slice B: **Flow docking**. Design audited read-only by Codex → CONFIRMED layout.js NOT needed (dock lives inside `.app` which is nested in `.app-content-split`; native Flow bounds complementary w/ 3px gap). Codex REFUTED my "width only" claim: split-top/bottom shrinks App HEIGHT to ~180px → added `canDockInContainer` (min 600x420) floating fallback. Codex also found REAL bug: portal tooltip + model listbox were viewport-clamped `position:fixed` → in Flow they'd render over native Flow view = invisible + clicks stolen (ApprovalDialog.jsx:50/54 documents this constraint) → now clamped to `.app` container rect. Mutations KILLED (size fallback, container clamp).
- 58f1b99 Slice D: Robot FAB face animation (blink/gaze/antenna pulse) INSIDE the SVG (it's <img src> so outer CSS can't reach it) + prefers-reduced-motion. Mutation KILLED.
- ⚠️ REPEATED the Task-5 mistake: almost ran `git checkout --` on UNCOMMITTED Robot.svg (would have destroyed it). The permission classifier caught it. LESSON RE-CONFIRMED: commit BEFORE mutation-testing, always.
- Full suite 664f/7306 GREEN. HEAD=58f1b99. Still NOT pushed (origin 5ae54c9).
- 1024187 findings-0 fix: I-1 (persisted width applied unclamped pre-paint) + I-2 (never returned to preference) + M-1..M-4. DESIGN: `settings.agentDockWidth` = user PREFERENCE (only changed by explicit drag-release/keyboard commit); applied width always DERIVED = clampAgentDockWidth(preference, currentContainerWidth), recomputed PRE-PAINT (useLayoutEffect + guarded ResizeObserver + appMode change) → fixes both at once (first paint already clamped; container growth re-derives from preference so width returns). Single writer of --agent-dock-w (ChatPanel writes imperatively on container; App owns only the agent-docked class — App's inline style writer REMOVED). + pointercancel/pointer-capture, portal container ResizeObserver, keyboard commit-on-keyup.
  - Opus mutations KILLED: I-1 (useLayoutEffect→useEffect), I-2 (preferenceRef→latestWidthRef). Full suite 664f/7313 GREEN.
  - **Fable re-review: FINDINGS = 0 certified** (all 6 resolved w/ pinning tests + RED mutation evidence; probes for render loop / dual writers / stale ref / mode-fallback interference / observer leak / disabled residue all clean; 108/108 targeted re-run).
- HEAD=1024187. Full suite 664f/7313 GREEN. STILL NOT PUSHED (origin 5ae54c9).
- REMAINING user gates: (1) eye-check Flow docking + resize bar + FAB face animation; (2) 0.144.5 app-server contract smoke (per-turn model/thread persistence were spiked on 0.142.5); (3) push confirm.

## SESSION 2026-07-16/17 — §1 Codex 0.144.5 계약 스모크 (RPC 레벨 완료)

역할: Opus 오케스트레이션+검증(직접 실행/뮤테이션), 해석 리뷰 = Codex gpt-5.6-sol(xhigh) + Fable 5.

### 결론: **버전 bump 자체는 깨끗하다.** 단, 스모크가 제품 버그 1건 + 우리 증거체계 붕괴 1건을 드러냈다.

신규 `tests/spike/m0-14.codex144Contract.spike.test.js` (commit 3ac7291 → e871e43).
**제품 코드로만 말하게 했다** (`resolveCodexExecutablePath` / `buildOrchestratorThreadParams` / `openAppServer`) — 파라미터를 재구현하면 스파이크가 제품이 아니라 자신을 측정한다.

실측(0.144.5, ChatGPT 구독):
- `model/list` → 7개, gpt-5.6-sol/terra/luna 포함 ✓
- `thread/start` 응답이 **우리 `approvalPolicy.granular` 를 그대로 반사** + `thread.cliVersion:"0.144.5"` → "에러 안 났다"(약한 증거)가 아니라 **채택의 양성 증거** ✓
- tripwire: experimentalApi 없으면 granular 거부("granular requires experimentalApi") — **뮤테이션 KILLED**(강제로 켜면 red) → 우리 capability 는 load-bearing ✓
- tripwire: bogus model → 400 이 그 이름을 지목 → `turn/start.model` 이 backend 까지 간다 ✓
- persistent thread: turn1(gpt-5.5) 토큰 → turn2(gpt-5.6-sol) 회수 ✓
- elicitation(§1-4): 5s hold 3/3 ✓ + **10분 hold 3/3 ✓** (deny heldMs=600,013/bodyRuns=0, allow 600,009/bodyRuns=1, native 600,013/bodyRuns=1, 전부 VERDICT pass + RUN_COMPLETED exit 0) → 0.144.5 도 장시간 승인 보류를 안 죽인다
- tool bridge(§1-5): M0-8 echo MCP 왕복 ✓

### 🔴 제품 버그(신규 발견): `turn/start.model` 은 **sticky inheritance** 다
`turn/completed` 는 model 을 안 준다 → 서버 자신의 **rollout jsonl `turn_context`** 로 양성 확인:
`turn1 gpt-5.5(명시) → gpt-5.5` / `turn2 gpt-5.6-sol(명시) → gpt-5.6-sol` / `turn3 **생략** → gpt-5.6-sol`
= 생략은 기본 복귀가 아니라 **직전 명시 모델 상속**.
제품 영향: `AgentModelSelector.jsx:4` DEFAULT_OPTION `value:null` → `ChatPanel.jsx:621/637` 키 생략 → `codexOrchestrator.js:303` `...(model?{model}:{})`. 세션은 재사용되고 **모델 변경 시 close/reopen 이 없다**(Codex 교차검증) → 사용자가 B 쓰다 '기본' 고르면 **안 돌아온다. 라벨이 거짓말.**
⚠️ 원장 live-smoke 게이트 #9("selector Default → app-server 기본")는 **fresh thread 에서만 참**이다.
표현 주의: "thread 모델이 mutate 됐다"는 **미증명** — 관측된 건 상속뿐(Codex 지적, 수용).

### 🔴 우리 증거체계 붕괴: shell lockdown A/B 가 **2026-07-14 부터 vacuous** 였다 (버전 무관)
0.144.5 에서 `[control]` 이 red → 처음엔 "0.144.5 회귀" 로 의심했으나 **아니다**:
`f43a8c9`(07-14)가 `ORCHESTRATOR_INSTRUCTIONS_TEXT`("you have no shell or filesystem access")를 넣었고
`buildOrchestratorThreadParams` 가 baseInstructions 로 싣는다 → control 이 config 를 풀어도 **모델이 페르소나 때문에 거절**.
마지막 live control 은 07-13(그 커밋 이전). 그 사이 "제품 lockdown → otherItems=[]" 의 0 도 **같은 페르소나로 설명된다 = 아무것도 증명 못 함.**
3-arm 실측(0.144.5): A)config해제+지시문 → exec 0 "I can't run shell commands in this environment" / B)config해제+지시문X → **exec 1 "Darwin 25.5.0"**(관측장치 생존) / C)lockdown+지시문X → exec 0 "no shell execution tool is available".
→ **config lockdown 은 0.144.5 에서 진짜로 막는다. 깨진 건 lockdown 이 아니라 증명이었다.**
수정(5d1ef60): 두 arm 에서 baseInstructions 제거(**한 변수만 다른** A/B) + as-shipped arm 추가. 뮤테이션 KILLED(control 재잠금 → red).
교훈: **페르소나는 말로 뚫리지만 등록 안 된 툴은 못 뚫는다** — 보안 판정은 config 레이어를 단독으로 재야 한다.

### 부수 실측
- `deprecationNotice`: `[features].experimental_use_unified_exec_tool` deprecated → `[features].unified_exec` 로. 제품은 **둘 다** 잠근다(codexSdk.js:49 + :154) → 오늘은 안전. 단 lockdown 은 **열거형 denylist** 라 미지정 신규 feature 에 fail-closed 가 아니다(Codex 지적, 후속 과제).
- PATH 함정: 로그인 셸 `codex`=0.144.1(전역 nvm) vs `node_modules/.bin`=0.144.5. `npm run` 이 PATH 를 꽂아줘서 m0-12 는 **우연히** 맞다(틀렸다고 단정했다가 자체 정정). 단 m0-12 는 이름·label 에 "0.144.1" 을 **하드코딩**하고 `spawnError===null` 만 본다 → 저장된 증거가 **버전 오라벨**. 후속 수정 대상.

## §2.3 Claude M0 스파이크 (신규 `tests/spike/m0-15.claudeOrchestratorContract.spike.test.js`, commit d04dfcf+)

**측정만 했다. 코드 저작 없음.** 핸드오프 6문항 중 3개는 기존 스파이크에 이미 답이 있어 **다시 재지 않았다**(적대 리뷰가 이 스킵의 적법성도 검증: 핀 커밋 67ea194 가 m0-5/m0-2 실행보다 앞서고 셋 다 sdk 0.3.207 동일):
- Q1 persistent thread → m0-5 (후속 user message 통과)
- Q3 tool bridge → m0-2 (`type:'sdk'` in-process MCP, `MCP_TOOL_TIMEOUT` 이 hard bound, 12분 블로킹도 종단 tool_result → **폴링 불필요**)
- Q4 승인 → m0-5 (`canUseTool` 600,020ms hold → tool body 1회 + 종단 result). **Codex 의 `'never'` 즉시-decline 함정에 해당하는 게 없다** (단, "모든 설정에서 함정 없음" 은 과장 — 제품이 쓰는 canUseTool 경로에 한정된 주장이다).

실측(sdk 0.3.207, 로컬 CLI 구독 자격증명, ambient ANTHROPIC_API_KEY 없음):
- **Q6**: `supportedModels()` **프로그램적**으로 5행 (`default`→claude-opus-4-8[1m] / opus / fable / sonnet / haiku). 카탈로그 IPC 에 Claude 소스를 붙일 자리가 있다. 🔵 **Codex 와 결정적 차이**: Claude 는 `default` 가 **명시적 행 + resolvedModel** 이다 → Codex 의 sticky 문제를 Claude 는 구조적으로 안 겪는다(명시 id 로 보내면 됨).
- **Q2**: `setModel` **턴 사이** 전환 → turn1 haiku → turn2 **claude-sonnet-5**, 토큰 ZEBRA-4417 회수 = **모델 전환 + 맥락 유지 동시 성립**.
- **Q2-b (설계를 가른 질문)**: 턴 **한가운데**(canUseTool 대기 중) `setModel(B)` → 그 턴의 assistant 4개 **전부 haiku 유지**(`switchedMidTurn:false`) **그리고 다음 턴은 sonnet**(`appliedNextTurn:true`).
  → **지연 적용이지 drop 이 아니다.** 즉 Claude 의 경계 의미론이 우리 UX 계약("진행 중 턴 유지, 다음 턴부터 적용")과 **이미 일치** → **pendingModel 지연장치 불필요.**
  ⚠️ 이 결론은 **적대 리뷰(F1, Critical)가 구멍을 잡아 다시 측정한 뒤에야** 성립했다. 처음엔 user message 가 1개뿐이라 "in-flight 유지" 만 쟀고, **"그 setModel 이 다음 턴에 적용되는가" 를 안 쟀다** — 그 상태에선 "mid-turn setModel 은 통째로 drop" 가설을 배제 못 해 결론이 반대로 뒤집힐 수 있었다. 교훈: **두 명제를 하나로 착각하지 말 것.**
- **Q5 abort**: `interrupt()` → receipt `{still_queued:[]}` (CLI 가 `interrupt_receipt_v1` 광고) + 세션 생존(후속 턴 응답). 진행 중 턴 **절단** 측정은 아래 참조.

### 교차 리뷰 (Codex gpt-5.6-sol xhigh + Fable 5, 독립 병렬) — 해석 리뷰의 값어치가 증명됨
둘 다 "findings 0" 이 아니었고, **내 결론 하나를 실제로 뒤집을 뻔했다**:
- **Fable F1 (Critical)**: Q2-b 설계결론이 미측정 절반 위에 서 있었다 → 재측정 → 결론 유지(`appliedNextTurn:true`)되었으나 **재측정 전엔 근거 없음**이었다.
- **Fable F6 → 더 큰 발견**: Q5 가 "세션 생존" 만 재고 **절단을 안 쟀다**. 고치려다 두 번 연속 vacuous 를 밟았다: (1) 빈 프레임만 보고 끊어 `countedTo:null` → "관측 실패" 가 green (2) 고치니 `countedTo:100` — 모델이 1..100 을 **한 메시지에 통째로** 보내서 애초에 그 설계론 못 끊는다. → **제품이 실제로 쓰는 모양(툴 여러 번 호출 중 Stop)** 으로 재설계.
- **Codex Important**: (a) m0-14 raw 에 **verdict/run_completed 체인이 없었다** (m0-8-9 엔 있는 규율을 안 따름) → `afterEach` verdict + `run-spike.mjs` RAW_FILES 에 m0-14/15 추가. (b) 내가 추가한 as-shipped arm 이 **vacuous 가능** (spawn/thread 실패도 빈 배열) → `spawnError/threadError/turnDone.status` 추가.
- **🔴 provenance 구멍 (Fable F3)**: raw 에 `granular-tripwire rejected:false` 인 run 이 있다 — 그건 **내 뮤테이션 run** 인데 **기록만으론 뮤턴트와 진짜를 구분할 수 없다**(감사자에겐 "계약 붕괴 증거" 로 보인다). → `record()` 에 **gitSha + gitDirty + SPIKE_MUTANT** 스탬프 추가. 이 repo 는 이미 `*-PRE-RUNID-CONTAMINATED.jsonl` 로 같은 병을 앓았다.
- **리뷰어 둘이 갈린 지점 → 내가 raw 로 판정**: sticky 메커니즘을 Codex 는 "상속만 관측, thread 변이는 미증명", Fable 은 "thread 변이가 메커니즘" 이라 했다. raw `all-events` 를 열어보니 turn1 completed → **`thread/settings/updated`** → turn2 started 로 **Fable 이 맞다**. 표현을 "sticky inheritance (thread 설정 갱신이 메커니즘)" 으로 확정.
- 남은 미측정(정직하게 남긴다): **`steer` 등가물** (Codex 는 `turn/steer`+expectedTurnId 실물, Claude 의 턴 중 message 주입 의미론은 m0-5/m0-15 어디서도 안 쟀다) → **인터페이스 동등성 주장에서 steer 는 빼야 한다.** 그리고 Claude 스파이크는 개발자 개인 `~/.claude`(SessionStart hook 주입) 에서 돌았다 — Codex 쪽 runtime home 격리에 대응하는 격리가 없다(통제 안 된 변수).

### 다음 (핸드오프 순서대로)
스파이크 결과 → **스펙** → Codex 저작 → Fable 리뷰. 스펙에 반드시 반영할 설계 입력:
1. Codex sticky 때문에 **'기본' 은 생략이 아니라 명시 id 로 보내야 한다** (model/list 가 `isDefault:true` 를 준다 — Fable 이 수정 재료까지 찾아둠). Claude 는 `default` 행이 있어 같은 방식으로 통일 가능 → **provider 공통 규칙: Default = 명시 resolve**.
2. Claude 는 per-turn model 인자가 없다 → `send(text, model)` 매핑은 **턴 경계에서 setModel 선행 호출**. pendingModel 불필요(Q2-b 근거).
3. steer 는 **미측정** — 스펙 전에 스파이크 필요.

### Q7 M0-16 Claude steer 계약 — delivery/noncompliance 혼동 제거, 3차 하네스 재실측 대기 (2026-07-17)

- `tests/spike/m0-16.claudeSteerContract.spike.test.js`는 `type:'sdk'` MCP tool을 3회 호출시키고 첫 body를
  test-owned promise로 붙잡은 동안 고유 nonce user message를 주입한다. `priority` 생략 / `priority:'now'`
  두 arm을 비교한다. raw는 `docs/superpowers/specs/m0-16-raw.jsonl`, runner completion 목록에도 포함된다.
  모든 record는 `runId + gitSha + gitDirty + SPIKE_MUTANT + sdkVersion`을 유지한다.
- **Q7-2 측정**(run `mroonllu-58578`, pass, exit 0): SDK 0.3.207 공개 `Query`/`SDKUserMessage`에는
  `streamInput`, message `uuid`/`priority`는 있지만 `steer`/`expectedTurnId`/active-turn target은 없다.
  `cancelAsyncMessage`는 message UUID queue 제어이지 stale active turn precondition이 아니다.
- host 재측정 `mroqj5v7-11003`은 3 pass/exit 0였지만 당시 `injectionFate:'dropped'` 결론은 **폐기**한다.
  첫 result와 neutral follow-up write가 모두 20,715ms여서 follow-up 자체가 queued injection의 출력을
  덮을 수 있었고, nonce 미출력을 delivery 실패로 오해했다. 이 run도 `gitSha:acf0e3f, gitDirty:true,
  mutant:null`이라 clean/mutant provenance chain이 닫히지 않았다.
- 같은 run의 CLI transcript를 사후 대조하니 생략 arm(session `ac5f8463-…`)은 injected UUID가 step 1
  tool_result 직후 `queued_command` attachment의 `source_uuid`로 나타나고, 그 attachment의 assistant child는
  SDK **turn 1**이었다. 원래 step 1/2/3과 original token은 완주했다. 즉 **전달됐지만 nonce 지시를 따르지
  않은 것**이며 drop 증거가 아니다. `priority:'now'`(session `c795ce68-…`)는 injected UUID가 direct user
  node로 나타나고 descendant assistant는 SDK **turn 2**였다. 원래 turn은 gated tool 종료 전에
  `subtype:'success', is_error:false, result:''`로 끝났다. turn 2의 step 1/2/3 tool_result가 모두
  `Stream closed`였지만 test gate/stream lifecycle confound가 있어 dead MCP bridge 결론은 내리지 않는다.
- 3차 하네스는 fate를 독립 축으로 분리한다:
  `originalTurnFate = completed | preempted | ended-incomplete | undetermined`,
  `injectedMessageFate = joined-in-flight | delivered-next-turn | discarded | undetermined`.
  preemption은 delivery 판정을 short-circuit하지 않는다.
- 첫 result 뒤 named 5,000ms gap 동안 input을 넣지 않고 `gapTurnStarted`/`gapTurnOutput`을 기록한다.
  그 뒤 neutral fixed-token turn을 닫고, nonce를 prompt에 쓰지 않는 3차 probe가 이전 live correction의
  token 또는 `NONE`을 답하게 한다. text nonce와 thinking nonce는 별도 field/turn으로 남긴다.
- SDK `session_id`로 `~/.claude/projects/<slug>/<session_id>.jsonl`을 읽어 injected UUID direct node,
  `queued_command` attachment, 다음 assistant의 parent/child ancestry와 SDK turn mapping을 기록한다.
  파일 부재/parse 실패는 `transcriptEvidence:'unavailable'`이며 절대로 discarded로 해석하지 않는다.
  각 result의 실제 `num_turns`, preempted result surface, post-preempt `Stream closed` 진단/명시적 confound도
  assert하지 않고 raw observation으로 남긴다.
- arm assertion은 tool body 시작, injection write/in-flight overlap, first result, 완전한 5초 gap,
  neutral token result, 별도 probe result 등 **관측 장치 closure만** 검사한다. 어느 fate/nonce 순응/tool
  생존도 요구하지 않는다. HEAD `19ccc93` 기준 clean run과 `SPIKE_MUTANT` run은 아직 없으며 host에서 필요하다.

## 이번 세션 커밋 (**푸시됨**: origin/feature/inapp-agent `285e302..903550e` fast-forward, merge/PR 없음, main 무관)
⚠️ 원장의 "NOT pushed (origin 5ae54c9)" 표기는 **stale 이었다** — 실제 origin 은 285e302 였다(그 사이 푸시됨). 원장 숫자도 확인 없이 인용하지 말 것.
- `3ac7291` m0-14 신규(0.144.5 계약 스모크, 제품 코드 경유 + negative control)
- `e871e43` tripwire 를 **거부 사유**로 강화 (toBeTruthy 는 auth/네트워크 오류도 green → false-green 발생기였다) + m0-12 관련 자체 오정정
- `5d1ef60` shell lockdown A/B 수리 (07-14 부터 vacuous 였던 것)
- `d04dfcf` m0-15 신규 (Claude M0 Q2/Q5/Q6 측정)
- `903550e` 교차 리뷰 findings 반영 (F1 재측정 / Q5 정직 분리 / provenance 스탬프 / verdict 체인 / as-shipped arm 강화 / sticky 메커니즘 확정)

**증거 체인 닫힘**: m0-14 clean run `gitSha=903550e dirty=false mutant=null`, 7/7 verdict pass, RUN_COMPLETED exit 0, sticky 재현 `["gpt-5.5","gpt-5.6-sol","gpt-5.6-sol"]`.

## Default 버그 수정 (commit `ba67f0a`) — TDD + 뮤테이션

**설계 결정을 혼자 안 했다.** Codex(gpt-5.6-sol/xhigh) + Fable 5 에게 **독립 병렬**로 seam 을 물었고 **갈렸다**:
- Codex: A4(3-state sentinel: absent / `model:null`=Default / id) > A1(렌더러) > A2 > A3(틀림)
- Fable: **A2**(main/IPC, 생략=Default, sentinel 불필요) > A1 > ... > A3(틀림)

둘 다 합의: **A3(오케스트레이터가 thread/start 의 echo 를 기억) 은 틀렸다** — thread 의 open 시 모델은 "사용자가 그때 고른 것" 이지 서버 기본이 아니다 → '기본' 이 sticky 모델로 resolve 되는 **같은 거짓말**이 한 층 아래로 내려갈 뿐. (내 논거와 일치, 양쪽이 코드로 확인)

각자 상대가 못 본 것을 하나씩 잡았다 → **둘 다 물어본 값어치가 여기서 나왔다**:
- **Fable 단독**: A1(렌더러)엔 **remount 구멍**. `sessionManager.open` 이 기존 세션을 재사용하므로 thread(=sticky 설정)는 렌더러 수명보다 오래 산다. ChatPanel remount 시 `selectedModel:null` + `models:[]`(로딩 중) → 그 창에서 send 하면 **사용자가 selector 를 건드리지도 않았는데** 직전 sticky 모델로 나간다. → **main 이 답인 결정적 근거.**
- **Codex 단독**: `agent:send` 에서 `catalog.list()` 를 await 하면 **cold Send 가 20s(app-server timeout) × 2(1-retry) 까지 블로킹**. → **캐시-only 동기 조회**여야 한다.

**최종 채택 = A2 + Codex 의 non-blocking 제약** (sentinel 은 뺐다 — 호출자가 ChatPanel 하나뿐이고, "thread 의 현재 모델 상속" 이 **바로 그 버그**라 IPC 경계에서 **표현 불가능하게 만드는 게 이득**. 추측성 기능 금지 원칙에도 부합).
부수 효과: `list()` 를 안 부르므로 Fable 이 경고한 "테스트가 진짜 codex 를 spawn" 문제도 같이 사라졌다.

구현: `createAgentModelCatalog.defaultModelId()` (캐시-only, **동기**, fetch 유발 금지) + `agent:send` argsFor 가 생략 시 그 id 를 명시. `session-open`/`sessionManager`/`codexOrchestrator` **무수정**(thread/start 생략은 실측상 안전 — m0-14 turn1 이 증거).

🔴 **둘 다 같은 것을 잡았다: 기존 테스트가 버그를 계약으로 박아놨다** — `agentModelWiring.integration.test.js` 의 "선택 모델이 없으면 … model 필드를 생략한다". TDD 1단계는 새 테스트가 아니라 **그 테스트를 뒤집는 것**이었다.

🔴 **뮤테이션이 진짜 구멍을 잡았다 (이번 세션 최고의 교훈 재확인)**: 1차 뮤테이션에서 `models[0]` / 하드코딩 `'gpt-5.5'` 뮤턴트가 **살아남았다**. 통합 테스트가 카탈로그를 **가짜로 주입**해서 실제 `defaultModelId` 본체를 **한 줄도 안 지나가기** 때문. (Codex 가 "narrow unit 이 따로 필요하다" 고 예측했던 그대로.) → `tests/electron/ipc/agent-api.test.js` 에 **진짜 카탈로그** 단위 테스트 추가. 픽스처는 기본을 **두 번째 자리 + 비-codex id** 로 둬서 first-item/하드코딩 뮤턴트를 죽인다.
뮤턴트 4종 전부 KILLED: models[0] / 하드코딩 / 해결로직 제거 / defaultModelId 가 몰래 list() 호출(=블로킹).

### Fable 적대 리뷰 (fix 대상, `ba67f0a`) → Critical 0 / Important 2 / Minor 4 → 수정 `a65df62`
Fable 이 뮤턴트 4종을 **독립 재현**하고 전체 스위트도 직접 돌렸다. 판정: **paper fix 아님** — E2E 트레이스(선택 → 와이어)로 '기본' 이 실제로 복귀함을 확인. seam=main 결정과 20s×2 블로킹 수학도 코드로 검증됨.

- 🔴 **Important 1 — 내가 앵커를 드리프트시켰다.** "thread/start 생략은 실측상 안전 (m0-14 turn1 이 증거)" 를 **주석·테스트 2곳·커밋 메시지** 에 적었는데 **거짓 인용**이었다: m0-14 세션은 전부 `openOrchestratorSession({model: MODEL_A})` 로 열려 thread/start 에 **model 이 늘 명시**돼 있었다. 생략한 thread/start 는 **한 번도 측정된 적이 없다.**
  → 말을 무르지 않고 **쟀다**: 생략 thread/start + 생략 turn → **서버 기본 gpt-5.5** (thread/start echo 와 rollout turn_context 양쪽 일치). 이제 인용이 아니라 사실이다. (m0-14 `omitted-thread-start`)
  **교훈 재확인**: "이름을 읽고 그 물건을 열어보지 않는 것" 의 변종 — **내 자신의 스파이크를 안 열어보고 인용했다.**
- 🔴 **Important 2 — 불변식에 구멍.** "카탈로그 없으면 sticky 불가" 가 **부분집합에서 거짓**: 기본 모델이 `hidden:true` 면 카탈로그는 안 비었는데 defaultModelId 만 null → 사용자는 모델을 고를 수 **있고** → '기본' → 생략 → **버그 부활**. `hidden` 은 "선택지에 안 보인다" 이지 "서버 기본이 아니다" 가 아니다.
  → 기본 id 를 **hidden 필터 전 원본**에서 뽑는다. 내가 "hidden 은 기본이 될 수 없다" 로 **핀해둔 테스트가 틀렸던 것** → 뒤집었다. 남은 부분집합(서버가 isDefault 를 아예 안 줌)은 해결 불가라 **주석의 불변식 서술을 좁혔다**(넓게 말하면 거짓이므로).
- Minor 4 — `defaultModelId` 계약 가드 추가. **뮤테이션으로 또 걸렸다**: 가드를 넣었는데 그걸 핀하는 테스트가 없어 **가드 제거 뮤턴트가 살아남았다** → 가드 테스트 추가. (repo 에 가드 테스트가 아예 없다 = 기존 상태, 스코프 크립 피해 내 것만 핀했다.)
- 수용/문서화만: Minor 3(캐시된 기본이 앱 수명 중 stale 가능 — 실패는 pushError 로 가시적, 확률 낮음) / Minor 5(테스트 순서 취약성, 현재 안전) / Minor 6(카탈로그는 raw process.env, orchestrator 는 temp CODEX_HOME — fix 후엔 turn 명시가 이기므로 일관).

전체 스위트 **664 files / 7322 tests GREEN**. **푸시됨**: `903550e..a65df62`.

## 후속 과제 (이번 세션이 남긴 것)
2. 🔴 **steer 스파이크** (Claude 턴 중 message 주입 의미론) — 인터페이스 동등성의 마지막 미측정 조각.
3. 🔴 **Q5 절단 측정** (`includePartialMessages` 경로) — Claude Stop 이 진행 중 턴을 실제로 멈추는지.
4. m0-12: 이름/label 의 "0.144.1" 하드코딩 제거 + resolver 사용 + 실제 응답 assert (지금은 `spawnError===null` 만 본다).
5. lockdown 이 **열거형 denylist** 라 신규 feature 에 fail-closed 아님 (Codex 지적) — CLI feature 목록과 대조하는 tripwire 권장.
6. deprecated `experimental_use_unified_exec_tool` 가 제거되면 **조용히 통과**한다(미지 키 무시) → 버전 범프 때 deprecationNotice 감시.
7. Claude 스파이크 환경 격리 (현재 개발자 개인 `~/.claude` + SessionStart hook 주입 상태에서 측정됨).

## Robot FAB 3D + 시선추적 — 스펙 리뷰 원장 (2026-07-17)

스펙: `docs/superpowers/specs/2026-07-17-robot-fab-3d-gaze-design.md` (v4)
캘리브레이션 정본: `docs/superpowers/specs/2026-07-17-robot3d-calibration-spike.html` (D preset)


v1 은 교차 리뷰에서 **Critical 3 / Important 3 / Minor 4**(Fable), **Critical 2 / Important 3 / Minor 2**(Codex) 로 **구현 착수 불가** 판정을 받았다. 둘 다 "findings 0" 이 아니었고 **각자 상대가 못 본 Critical 을 하나씩 잡았다.**

**둘 다 독립적으로 잡은 것** (= 진짜):
- **C1** 실행 중 애니메이션이 static transform 을 이긴다 → gazing 무동작. v1 은 상태 적용 메커니즘을 **아예 안 썼다**.
- **C2** 불투명 셸 앞면이 스크린·눈을 가린다 → 얼굴 없는 흰 로봇. **개구부 누락** = 전형적 paper design(문장은 다 맞는데 합치면 안 됨).
- **앵커 드리프트**: `robot-look` 을 `50-54`(실제 **55-59**), `<style>` 을 `38-66`(실제 **39-67**) 로 인용. §7 에 "전부 직접 열어 확인함" 이라 써놓고. **어제 Important 1 로 맞은 그 병을, 그 병을 경고하는 문서에서 반복했다.**
- **§2.4 "눈이 셸보다 더 크게 움직인다" 는 거짓** — 시차는 Z 비례, 눈(Z8) < 앞면(Z9). 3D 논거의 근거 문장이었다.
- Z "단조성" 테스트가 설계와 자기모순 / clamp 논증이 `radius>0` 전제 누락 / 포인터 이탈 경로 누락.

**Fable 단독**:
- **C3 `perspective` 증발** — v1 의 컨테이너 스펙에도 테스트에도 perspective 가 없고, 그걸 핀하던 유일한 테스트를 **삭제하라고 썼고**, 교체 지점으로 그게 들어있는 `ChatPanel.css:91-110` 을 지목했다. → 정사영이 되어 **정확히 "입체감이 아주 살짝" 을 재생산**하고 새 테스트는 전부 초록. **이번 리뷰 최고의 발견.**
- 유리 하이라이트·접지 그림자가 레이어 트리에 **집이 없음** / 코플레인 Z8 충돌 / `Robot.svg`+import 의 dead code 처분 미명시 / transition 재타게팅·복귀 스냅.
- 전체 스위트를 **직접 실행**해 664/7322 확인.

**Codex 단독**:
- **48px 에서의 수학** (§2.0) — 전제 자체를 흔들었다. 8px 압출 @14° = ~1.94px, 층당 0.24–0.39px → "1–2px 색 띠". gaze 가 yaw 를 줄여 **상호작용 순간 3D 가 최약**. → **visual spike 로 숫자를 눈으로 정하라.**
- **테스트가 생산자만 보고 소비자를 안 봄** — var 소비를 지워도 6개 뮤턴트 전부 통과. (원장의 "카탈로그 가짜 주입 → 실제 로직 안 지나감" 과 같은 병.)
- `setProperty` 성능 서술 과장 / 전구 Z 의 진짜 근거는 오클루전이 아니라 **스템 정렬**.

**둘 다 검증하고 이상 없다고 한 것** (지어내지 않음): §2.3 인라인 `<style>` 전역화 **참** / §1.2 `<img>` 격리 **참** / §1.4 SVG 내부 preserve-3d 미지원 **참** / 진리표 산술 **행별로 전부 맞음** / clamp dead-code 논증 **`radius>0` 에서 성립** / ref+CSS var 접근 **타당**.

## Robot FAB 3D + 시선추적 — 구현 완료 (2026-07-17)

커밋 `a0badd8`(구현) → `cdafc60`(dead guard 제거) → `acf0e3f`(미핀 계약 3종). **로컬만, 미push.**
전체 **667 files / 7348 tests GREEN (exit 0)**, 빌드 GREEN. 남은 건 **사용자 실앱 눈검증** 하나.

### 🔴 이 세션 최대 교훈: **하네스가 네 번 거짓말했고, 매번 다른 방식이었다**
1. **배치 뮤테이션이 `-0` 가드 4종을 전부 KILLED 로 오보** → 개별 재측정하니 3종 SURVIVED(dead code). 원인 미규명 — **그래서 앞선 배치 판정도 전부 스팟체크로 재측정**했다(그건 진짜였다).
2. **`npx vitest run <다중파일>` 이 간헐적으로 "No test files found" → exit 1.** 같은 명령이 30초 뒤엔 18개를 정상 수집한다. 이걸 KILLED 로 읽으면 **전 뮤턴트가 가짜**다. 원장에 이미 적혀 있던 함정을 **적혀 있는 걸 알면서도 밟았다.**
3. **통제군 exit 1 을 찍어놓고 판정을 계속 돌렸다.** "baseline 을 확인하라" 를 **출력**은 했는데 **게이트**로 안 만들었다. → 교훈은 "확인하자"가 아니라 **하네스가 baseline 에서 강제 중단해야 한다**는 것.
4. **수집 실패와 테스트 실패를 구분 못 했다.** 둘 다 exit 1. → 요약 줄이 **비어 있으면 수집 실패**다. 하네스가 이제 재시도하고 `판정불가`를 보고한다(KILLED 아님).

### 스펙이 3라운드에 v6 까지 간 이유 (재발 방지)
Critical 6개 중 **5개가 "스파이크는 맞게 했는데 스펙이 그 말을 안 했다"** 였다 — 나는 **이미 동작하는 코드를 산문으로 재작성**하려다 매 라운드 흘렸다. v6 §2.-1 에 **"스파이크에서 포팅한다, 산문에서 재유도하지 마라"** 를 박고서야 멈췄다. Fable 최종 판정: **포트 충실도 통과, 침묵 발산 없음**(그라디언트 stop 색까지 문자 단위 일치).
→ **작동하는 참조 구현이 있으면 스펙은 계약이지 건설 설명서가 아니다.**

### 실패 유형 하나가 **입구 7개**로 나왔다 (전부 "전 게이트 초록 + 실앱 완전 사망", 전부 jsdom 불가시)
애니메이션이 static transform 을 이김 / `perspective` 증발 / **동적** var 단위 / **정적** config 단위 / 씬 루트 0×0·`overflow:hidden` 평면화 / 상수에 소비자 없음(cascade 가 FAIL 값을 배송) / `will-change: opacity`.
🔴 그중 셋은 **내가 인스턴스만 고치고 종류를 안 고쳐서** 생겼다(단위를 동적 절반만, 포인터 이탈 경로를 지목된 둘만). **"구멍 목록을 늘리지 말고 불변식 하나로 적어라."**

### 리뷰어 조합의 값어치 (재확인)
매 라운드 **각자 상대가 못 본 Critical 을 하나씩** 잡았다. Fable: perspective 증발 / var 단위 / 상수 소비자 없음 / 미핀 계약 3종. Codex: 48px 수학(설계 전제를 흔듦) / 정적 단위 / 씬 루트 / producer-not-consumer.
**갈린 지점은 raw 로 판정**: 접지 그림자(Fable 승 — 스파이크 :238 이 `translateZ(-1px)`, 사용자는 그 상태를 승인했다 → **승인된 모습을 "고치지" 마라**. Codex 가 확인 후 권고 철회) / perspective 근거 수학(Codex 승 — 정사영에서도 시차는 생긴다, Fable 의 근거는 틀렸고 결론은 맞았다).

### 숫자는 사람 눈에서 왔다
슬라이더 14개 = **사람에게 14차원 최적화를 시킨 것**("솔직히 난 잘 모르겠어"). 4개 후보 pick-one 으로 바꾸니 3초 만에 답이 나왔다(D). **추론으로 고른 기본값(depth 8)이 정확히 "안 보이는 구간"** 이었다("확실히는 아니고, 약간" = 폐기 조건 fail).
→ `robotConfig.js` 동결 + exact-value 테스트 + 캘리브레이션 뮤턴트 5종. **바꾸려면 스파이크를 다시 돌려 사용자에게 물어라.**

## Q7 steer — **최종 실측 (정정됨)**, 2026-07-17

**증거 체인 닫힘**: clean run `gitSha=8434b8ce dirty=false mutant=null`, 3/3 pass, exit 0, `transcriptEvidence: available`, 재현 2회.

| arm | `originalTurnFate` | `injectedMessageFate` | nonce | toolSteps |
|---|---|---|---|---|
| plain `streamInput` | `completed` | 🔴 **`joined-in-flight`** | 회수 | [1,2,3] |
| `priority:'now'` | `preempted` | 🔴 **`delivered-next-turn`** | 회수 | [1,**1**,2,3] |

### 🔴 결론이 세 번 뒤집혔다. 매번 **자신 있는 오답**이었다.
1. 나: **`dropped`** — 내 follow-up 이 first result 와 **같은 ms** 에 들어가 nonce 를 덮은 인공물.
2. 리뷰어 둘: **"배달됐는데 모델이 안 따랐다"** — 같은 오염된 데이터를 본 것. Codex 는 transcript 까지 열었는데도.
3. 진실: **`joined-in-flight` + 모델이 따른다.** follow-up 을 5초만 늦추니 nonce 가 나왔다.

**오염된 측정은 "모른다"를 주지 않는다. 자신 있는 오답을 준다.** 그리고 그 오답은 **리뷰를 통과한다** — 리뷰어도 같은 raw 를 보기 때문이다. 리뷰는 해석을 고치지 측정을 못 고친다.

### 세 번째 vacuity 는 **assertion 이 아니라 confound 로 왔다**
장치가 살아있음을 증명하는 **바로 그 follow-up** 이 판별 신호를 억압했다. 앞의 둘(`countedTo:null`, 한 메시지에 1..100)은 약한 assertion 이었지만 이건 **설계가 자기 판별력을 지운 것**이다. 하네스를 고치고 "장치가 닫혔다" 고 자축한 **다음에** 그 장치가 지지 못 하는 결론을 냈다.

### 하네스 검증 (Fable I-3 지적 반영 — SPIKE_MUTANT run 이 하나도 없었다)
negative control(`mutant=no-nonce-in-injection`, 주입은 하되 nonce 미요구): **`nonceInText:false` 로 뒤집힘**(탐지기 진짜) + **`joined-in-flight` 유지**(판정이 nonce 가 아니라 **transcript ancestry** 라는 구조적 증거 기반). → **모델 재량이 SDK 의미론으로 오독되지 않는다.** 원래 하네스는 정확히 그 오독을 했다.

### 제품 결론 (전부 정정됨)
- ✅ **`claudeOrchestrator.steer()` 는 plain `streamInput` 으로 구현 가능하다.** (❌ 폐기: "Claude 는 steer 못 하니 UI 비활성")
- 🔴 **`expectedTurnId` 등가 race guard 는 SDK 에 없다 → 우리가 만든다.** (이건 API 표면 실측, 확정)
- `priority:'now'` = **interrupt + 그 텍스트로 재질의**. `interrupt()` 는 메시지를 배달하지 않으므로 **등가 아님**.
- `send()` busy guard 는 **데이터 손실 방지가 아니라 정책 선택**으로 명명해야 한다(메시지는 배달된다). 단 send-while-running 은 실제 도달 가능: 렌더러 gate 는 로컬 state(race window), main 에 guard 없음(`agent-api.js:210`, `sessionManager.js:226`).

### 남은 미측정 (리뷰어 지적, 스펙 전에 판단할 것)
`priority:'next'`/`'later'`/`shouldQuery` / `cancelAsyncMessage` 의미론 / **preempt 후 MCP bridge 생존**(turn 2 tool 이 전부 `Stream closed` — gate confound 있어 미판정, m0-15 Q5 는 "세션 생존" 만 쟀다) / preempted turn 의 result 표면이 `subtype:'success', is_error:false, result:""` 로 **성공한 빈 turn 과 구별 불가** / n=1 / 개인 `~/.claude` hook 이라는 통제 안 된 변수.

## 🔴 m0-17 — `interrupt()` 후 MCP bridge 는 **죽는다** (2026-07-17, blocker 해소)

**clean run** `gitSha=10bbe9b8 dirty=false mutant=null`, 1/1 pass, exit 0, `q3Trust.apparatusTrustworthy=true failures=[]`.

| 관측 | 값 |
|---|---|
| `turnCutFate` | **`cut`** — interrupt 는 진행 중 턴을 **실제로 절단한다** (m0-15 Q5 가 안 쟀던 것) |
| `bridgeAfterInterrupt` | 🔴 **`dead`** |
| fresh turn tool_use | `[1,2,3]` (모델이 다 불렀다) / result 3개 / **`freshStreamClosedCount:3`** / 성공 왕복 **0** |
| 신뢰 조건 | `freshToolsUngatedByConstruction:true`, `sameSession:true`, `oldBodySettledBeforeFreshTurn:true`, `timedOut:false` |

→ **`abort()` → `interrupt()` 매핑은 성립하지 않는다.** 세션은 살고 모델은 대답하는데 **그 세션의 in-process MCP bridge 가 영구히 죽는다.** 사용자가 Stop 을 누르면 에이전트가 조용히 무력해진다(에러 없음).
→ **m0-16 의 초기 "Stream closed" 관측이 사실은 옳았다.** 그땐 우리 gate confound 때문에 못 믿었다. 이번엔 fresh tool 이 **구조적으로 ungated** 라 하네스로 설명되지 않는다.
→ **m0-15 Q5 의 "세션 생존" 은 참이지만 오해를 낳았다** — 후속 턴이 응답하는지만 쟀고 **툴이 사는지는 안 쟀다.** 리뷰어 둘이 이걸 blocker 로 올리라고 한 판단이 옳았다.
→ 선택지: abort 후 **close/reopen**(맥락 손실) / 다른 abort 메커니즘 / **Stop = 세션 종료**로 제품 정의. **스펙에서 결정할 것.**

### 부수 실측 (전부 신규)
- **cut turn 의 result 표면**: `subtype:"error_during_execution"`, `is_error:true`. ⚠️ **스펙 v1 은 `success`/`is_error:false` 라고 썼다 — 그건 m0-16 의 `priority:'now'` 경로였고 내가 `abort()` 경로에 갖다 붙였다.** 경로가 다르면 표면이 다르다. onEvent 매핑이 이걸 봐야 한다.
- **절단된 tool 이 모델에게 보이는 모양**: `isError:true` + *"The user doesn't want to proceed with this tool use… **STOP what you are doing and wait for the user to tell you how to proceed.**"* (m0-16 의 `AbortError: interrupt` 와 다르다.)

### 🔴 모델이 내 스파이크를 prompt injection 으로 잡아냈다
1차 fresh prompt 가 *"이건 system interrupt 지 사용자 거부가 아니고 그 취소는 이 턴에 적용 안 된다"* 로 **stop 을 미리 논증해서 우회**하려 했다. 모델 거부:
> *"거부 직후에 나타나서, 왜 stop 이 적용 안 되는지 미리 논증하고, 거의 동일한 tool-call 을 즉시 반복하라고 요구하는 건 **명시적 stop 신호를 넘어가게 설득하려는 시도의 특징**을 갖는다. 그 지시가 정말 당신에게서 온 건지 **주입된 건지 확인할 방법이 없다**."*

**모델이 옳았고 나는 틀렸다.** interrupt 의 tool_result 는 "STOP … wait for the user to tell you how to proceed" 이고 — **사용자의 다음 진짜 메시지가 바로 그 'how to proceed'** 다. 설득할 게 아니라 **그냥 시키면 된다**. 평범한 요청으로 바꾸니 모델이 tool_use 3개를 다 냈고 **그제야 bridge 가 죽었다는 게 보였다.**
**교훈: 모델의 조심성을 우회하려 프롬프트를 조작하면 측정이 죽는다. 제품의 모양이 곧 정직한 측정의 모양이다.**

⚠️ **n=1.** 그리고 개인 `~/.claude` + SessionStart hook 이라는 통제 안 된 변수는 여전하다.

## 🔴 abort 설계 확정 — `interrupt()` 가 아니라 `priority:'now'` (2026-07-17)

| | `interrupt()` (m0-17) | `priority:'now'` 주입 (m0-16) |
|---|---|---|
| 진행 중 턴 | **cut** | **preempted** |
| 진행 중 tool | 중단 (`isError` + "user … rejected … STOP") | 중단 (`AbortError: interrupt`) |
| **그 뒤 MCP bridge** | 🔴 **dead** — fresh tool_use `[1,2,3]` → **StreamClosed 3 / 성공 0**, ungated·sameSession, `q9Trust failures:[]`, **n=2** | ✅ **alive** — `turn2ToolUseSteps:[1,2,3]`, `turn2ToolResultCount:3`, **`turn2StreamClosedCount:0`** (clean sha `00cd059d` + `8434b8ce` **양쪽에서 재현**) |
| cut turn result 표면 | `subtype:"error_during_execution"`, `is_error:true` | `subtype:"success"`, `is_error:false`, `result:""` |
| resume 으로 복구 | ❌ **불가** — `resumedBridge:dead` / `resumedContext:**survived**` (`q9Trust failures:[]`). **새 query + 새로 만든 MCP 서버로도 죽어 있다 → 망가지는 건 query 의 서버가 아니라 세션 자체다.** | — |

→ **`abort()` 는 `priority:'now'` 주입으로 매핑한다.** `interrupt()` 는 세션을 **영구히 무력화**한다: 모델은 계속 대답하는데 앱 도구를 하나도 못 쓴다. 에러도 없다.
→ **남은 제품 결정**(측정 아님): `priority:'now'` 는 **메시지를 실어야** 한다. 순수 Stop 에는 payload 가 없으므로 Stop 의 의미("중단하고 확인만") 를 정의해야 한다.

### 🔴 내가 몇 시간 전에 이걸 기각했고, Fable 이 막았다
나: *"`priority:'now'` 는 interrupt 다 — 이미 `interrupt()` 가 있으니 새 정보 없음."* → Fable: **OVERSTATED**(`interrupt()` 는 메시지를 배달하지 않으니 등가가 아니다).
Fable 이 맞았지만 **그때는 우리 둘 다 진짜 이유를 몰랐다**. 진짜 이유는 `interrupt()` 가 **세션을 죽인다**는 것이고, 그건 그때 아무도 안 쟀다.
**교훈: "등가다" 라는 기각은 등가성을 재봤을 때만 할 수 있다.** 오늘 리뷰어가 나를 구한 다섯 번째이고, **이유가 나중에 밝혀진** 두 번째다.

### m0-15 Q5 의 "세션 생존" 은 참이지만 위험한 인용이었다
후속 턴이 응답하는지만 쟀다. **툴이 사는지는 안 쟀다.** 그 한 줄을 스펙이 `abort()` 근거로 인용했고, 실제로는 **정반대**였다.

## SESSION 2026-07-18 — 스펙 v2→v7 완결 (5 리뷰 라운드) + m0-18 스파이크 + abort 재설계

스펙 `docs/superpowers/specs/2026-07-17-claude-orchestrator-design.md` **v7, 633줄. 스코프 내 findings 0.** 역할: Codex gpt-5.6-sol(저작) / Codex+Fable5 독립 병렬(적대 리뷰) / Opus(오케스트레이션·검증·갈림 판정).

### 사용자 결정 D3·D4 (신규)
- **D3 = Stop 조용한 중단** (Codex Stop 과 UI 상 구별 불가, 맥락 유지 지향). payload 는 사용자 비가시 고정 지시문, 응답 턴 UI 억제.
- **D4 = 조용한 폴백 금지** (Claude 기본 resolve 실패 시 gpt-5.5 폴백을 selector/log 에 표시).

### 리뷰 루프 (매 라운드 갈린 지점은 Opus 가 raw/코드로 판정)
- R1 Crit5/Imp9 → R2 Crit2/Imp7 → R3 **Crit1(둘 다 abort A correlation 독립 발견)** → R4 C1(idle/close 모순, 582줄에서 close 통일) → R5 **리뷰어 갈림**.
- 🔴 **R3 근본 난제**: SDK result 에 input correlation key 없음 → abort A 의 완료를 식별 못 함. v5 는 "항상 close(맥락 소실)" fail-safe 로 후퇴.

### 🔴 m0-18 스파이크 (호스트 실측, clean `efd6476a`, 9/9 pass) — "맥락 보존 조용한 중단" 이 가능한가
사용자가 "지금 먼저 스파이크" 선택. Codex 저작 → Opus 호스트 실행 → Codex+Fable 해석 교차리뷰.
- **H1**: result 에 input uuid/priority/kind/turn-target 없음(확증).
- **H2**: `cancelAsyncMessage(uuid)` → 큐에 있으면 `cancelled:true`, dequeue/coalesce 되면 `false` (sdk.d.ts:3403 타입 문서 실측 일치). **public sdk.d.ts 엔 없고 runtime Query 에만.**
- **H5**: `priority:'now'` A 주입 → T preempt + 즉시 `cancelAsyncMessage(A)` → `true` 면 A turn 안 돎 + **맥락 보존**(follow-up 이 초기 랜덤 memoryToken 회수, prompt 비에코 간접 요청). **n=1.**
- **preempt/cancel 레이스 무해** (교차리뷰 n=2, 메커니즘+관측): enqueue subscriber 가 `AbortController.abort('interrupt')` 를 즉시 발행(preempt 는 enqueue 시 커밋), cancel 은 큐 항목만 제거, 이미 발행된 abort rollback 경로 없음.
- 🔴 **내 초기 판정 "대부분 보존" 은 과장** — 교차리뷰가 하향: 확률 미측정(early-A 2/2, 신뢰구간 하한 ~16%), 즉시 admission timing 미측정(H5 는 721ms 뒤 + gate release 후). `injectedFate:"cancelled-while-queued"` 는 순환 라벨(cancelled===true 면 정의상 부여) → 독립 증거로 못 씀.

### 🔴 R5 리뷰어 갈림 → Opus 가 Codex 편 판정 (원장 교훈: 충돌은 실측 신호)
§5.7 "enqueue 가 preempt 커밋" 을 둘 다 팠는데 **Codex=Critical / Fable=Major(무해)**.
- Codex: 번들 CLI 가 조건부 `if(W && ...now...) W.abort()`. **turn controller `W` 는 CLI 가 T dequeue 할 때 뒤늦게 생성**. T write~CLI dequeue 사이(W 없는 창)에 Stop → A 가 preempt 안 함 → `cancelAsyncMessage(A)=true` → CLI 가 T 정상 실행 → v6 가 "맥락 보존 성공" 오정산. **Stop 이 안 먹혔는데 성공.**
- **Opus 판정: Codex 옳다.** 둘 다 "메커니즘은 sdk.mjs 없고 241MB CLI 바이너리 안" 에 동의 + **m0-18 은 W-존재 조건(firstToolStarted 뒤)만 쟀다** → remote-not-started 창은 **미측정**. (side effect 는 aborting canUseTool deny 로 막히나 D3 정합성 위반이라 무시 불가.)
- **v7 수리**: `active(T).remoteStarted` 하위 관측 flag(로컬, result correlation 아님). **첫 T frame 관측 전 Stop = close-only fail-safe(`abort-before-remote-start`), 관측 후 = A+cancel barrier.** 메커니즘을 "미검증 가설(CLI 바이너리 재대조 불가, 안전성 이에 의존 안 함)" 로 하향. §6 에 remote-not-started arm release-gate.

### abort 설계 최종 (§5.7, v7)
`active(T,remoteStarted:true)` → A(`priority:'now'`,payload) write → `cancelAsyncMessage(A)`: **`true`+첫 opaque boundary → 맥락보존 idle**(sessionClosed:false) / **`false`/capability부재/throw → close** / **30초 watchdog**(preempt 불발·write hang·cancel hang 라이브니스). `remoteStarted:false` → close-only. no-FIFO 불변식 유지(result 를 A 로 식별 안 함, cancelled 가 유일한 A-미실행 신호).

### 남은 §6 release-gate 스파이크 (구현 착수 불가 사유 아님 — 릴리스 전)
1. **D1 setModel 문자열** — raw 는 `value:'default'/'opus[1m]'`, `resolvedModel:'claude-opus-4-8[1m]'` 만. bare `claude-opus-4-8` 은 어디에도 없음. `default/opus[1m]/claude-opus-4-8/claude-opus-4-8[1m]` 을 initial+turn-boundary setModel 로 재서 승자 확정 전엔 Claude default candidate 승격 금지(gpt-5.5 fallback 유지).
2. remote-not-started 즉시-abort arm / 3. 즉시 admission H5 n≥10 + cancel 0/5/10/20/40ms sweep / 4. queued-user-message 공존(배치 드롭) / 5. production permission regime abort.

### 🔴 하네스 새 거짓말 변종: codex-reply timeout 후에도 백그라운드로 파일 계속 수정
v5 저작 codex-reply 가 30분 idle timeout 으로 "실패" 반환 → **그 세션이 계속 돌며 568→582줄로 마저 수정**(C1 idle/close 모순을 스스로 close 로 통일). Codex R4 가 실시간 감지. **교훈: codex mcp timeout 은 작업 중단이 아니다 — 파일 상태를 직접 확인하라.** 이후 저작엔 "완성하면 멈춰라, 추가 수정 금지" 명시.

### 구현 (사용자: "지금 세션에서 이어서"). 마일스톤 순서: M1 catalog(§5.1) → M2 orchestrator 핵심(§5.2/5.3) → M3 승인(§5.4) → M4 abort(§5.7) → M5 busy(§5.5) → M6 provider factory(sessionManager) → M7 UI. 각 M: Codex 저작 → Opus 검증(스위트+뮤테이션) → Codex 리뷰. §7 뮤턴트 48종, §7.14 눈검증. §6 release-gate 스파이크(D1 setModel 등)는 릴리스 전.

**M1 완료 (커밋 `00f08a85`)**: catalog provider 정규화. `${provider}:${sourceKey}` id, AgentModelRow, Claude default candidate(sdkModel:null, 미승격), built-in `codex:gpt-5.5` fallback, `defaultModelId()` 항상 문자열(cold-null 폐기), COLD_DEFAULT_MODEL_ID 상수. constants: CLAUDE_AGENT_DEFAULT_SDK_MODEL=null(§6 스파이크 대기). Opus 검증: 전체 스위트 667f/7348 GREEN, 급소 뮤턴트 A(candidate null)/C(id 스킴)/D(built-in isDefault) **KILLED**. B(`?? COLD` 방어절)는 이중방어라 SURVIVED 정상(cold 계약은 coldRows built-in isDefault=뮤턴트D가 지킴, `??`는 2차방어). cold 계약 전부 테스트 핀(:207/:210/:186/:225).

**M2 완료 (커밋 `a85c7427`)**: `claudeOrchestrator.js` 신규(796줄). open/send/steer/close + §5.3 mapper(remoteStarted 관측·partial delta·assistant text run·MCP tool·error 10종·pending refusal leg·supersedes retraction·orphan drain·합성 turn id). §5.2 options 빈배열 5종+assertion, includePartialMessages/persistSession/maxTurns=384/MCP_TOOL_TIMEOUT env, cancelAsyncMessage capability open-time 고정. **abort=M4 stub `{aborted:false,reason:'not-implemented'}`, canUseTool=deny-only + MCP=빈서버(M3 stub)**. Opus 검증: 전체 스위트 668f/7386 GREEN(1 failed=spikeIsolation CPU 경합 flake, 단독+M2 44/44 통과 재확인). 뮤턴트 E(setModel 선행) KILLED, Codex 확인(pendingStart remoteStarted / uuid-only retraction RED).
- 🔴 **뮤턴트 F(remoteStarted active 관측 제거) SURVIVED = producer-only**(원장 [[mutation-catches-untraveled-paths]] producer-not-consumer 병). remoteStarted 는 내부 flag 라 M2 에선 소비자(abort barrier)가 stub 이라 검증 표면이 없다. **M4 에서 abort 의 `abort-before-remote-start` vs early-cancel barrier 분기와 함께 remoteStarted 생산자+소비자를 반드시 뮤테이션할 것.**

**main 병합 완료 (merge `1101c2af` + archive `d61112b2`, 푸시됨 origin/feature/inapp-agent).** 사용자가 rebase 요청 → 134커밋 재적용은 문서 add/rm 히스토리 + 코드충돌 반복이라 **merge 선택**(rebase는 문서 untracked checkout 충돌로 애초에 막힘, merge는 최종 3-way라 깔끔). origin/main 67커밋(story 파이프라인 + 실시간 토큰 usage) 병합. 충돌: 코드 7개(codexAppServer/llmClaude/story-api/stepMachine/App/StoryView/useStoryPipeline) Codex 3-way(agent+story 둘 다 살림), 문서 6개 theirs. 병합 후 3수정: (1) npm install(main `mpg123-decoder`) (2) claudeOrchestrator orphan-drain onExit 한글 에러→영어(main `noKoreanIpcErrors` 규칙) (3) story IPC 핸들러 계수 test 21→22=18guarded+4custom(main `pick-audio-import-file`=토큰무관 파일다이얼로그 custom). **전체 708f/7918 GREEN.** ⚠️ merge 후 rebase 는 무의미(merge commit flatten 시 같은 충돌 재발) — 사용자에게 설명함.

HEAD 진행: `efd6476a`(m0-18) → `00f08a85`(M1) → `a85c7427`(M2) → `1101c2af`(merge main) → `d61112b2`(archive, 푸시됨). 스펙 gitignore 디스크. ⚠️ M2 이후 main 병합으로 codebase 커짐 — M3+ 는 병합된 트리 기준.

## SESSION 2026-07-18 (2) — M3 완료 (승인 nonce + in-process MCP, §5.4). **로컬 3커밋 미push.**

역할: Codex gpt-5.6-sol(저작) → Opus(검증: 전체 스위트+뮤테이션+raw/스펙 대조, 직접 수정) → Codex+Fable5 독립병렬 적대리뷰 **3라운드 findings 0**.

**M3 커밋 3개 (origin d61112b2 기준 미push):**
- `b3810918` M3 core: `sdkMcpServerFactory` 실제 tool 등록(raw Zod shape + optional carrier + server `alwaysLoad`) + §5.4 canUseTool 승인흐름(R=UI없이 allow / G/B=elicitationResponder.handle 정확 wire `{serverName,message:encodeApprovalPayload,_meta:{nonce,tool,argsHash}}`). callToken+grantNonce 상관 → handler가 active turn/toolEpoch 재검사 후 `toolCore.call`. 신규 constructor dep: `grantLedger`(M6 배선), `projectToken`, `toolFactory`.
- `197eb320` R1 리뷰 fix: (F1 readQuery terminal이 §5.4 step6 invalidate 누락→두 경로+catch closeQueryOnce, orphanDrain/invalidRemoteState도 helper 통일) (F2 비-`.shape` 스키마 fail-closed throw) (Codex R token tool/args 미바인딩+G/B→R handler grant 미소각→R도 tool+argsHash 저장, burn을 authorization.nonce 기준으로) (deny 메시지 한글).
- `92e7c35d` R2 리뷰 fix: (permissionMatches 실제 제거 — 🔴 **linter가 첫 제거 edit를 조용히 revert했고 amend로 커밋됨, 리뷰어 둘이 잡음**; tool-name+argsHash 바인딩이 permission 동등 함의) (F2 catch의 closeQueryOnce 가드→throw해도 onExit 종결) (stream-ended EOF invalidation 테스트 핀 — R1 fix의 절반이 미고정이었음).

**Opus 검증(직접):** 전체 **709f/7946 GREEN**. 급소 뮤턴트 다수 KILLED — no-consume-on-stale-accept / post-accept-recheck / carrier-deny 양필드(hasOwn) / use-carrier-nonce / const-argsHash-to-responder / no-active-state-gate / no-prefix / grantMatches tool-name·argsHash 양반쪽 / fail-closed-throw 제거 / R-short-circuit 복원 / burn-by-dest-permission / stream-ended·stream-error invalidation 제거 / closeQueryOnce 가드 제거. **회귀 뮤테이션이 실제 버그 2건을 잡음**: (1) 모듈스코프 `authorizedCalls`(세션간 clear 교차오염) → 인스턴스 스코프 이동+회귀테스트 (2) R token 미바인딩(Codex도 독립 발견).
- **수용 SURVIVED**: M1 handler `activeMatches`(turn/epoch)는 clear-on-terminal과 이중방어(§5.4 step5가 둘 다 명시), M3 record-survives+turn-changed 경로는 도달불가 → **M4 abort에서 소비자 경로 생길 때 닫을 것**([[mutation-catches-untraveled-paths]]). R context `{}`vs`{nonce:undefined}` = 등가 뮤턴트(R은 isApproved 미경유).

**스펙 갱신(디스크만):** §5.4 step2/5 — R도 tool/argsHash 저장, handler가 전 permission에 tool+args 대조, burn은 authorization.nonce 기준(dest permission 아님), 별도 permission 대조는 tool-name과 중복이라 제거.

**적대리뷰 3라운드 (Codex+Fable 독립병렬, findings 0 인증):**
- R1: Fable Important(readQuery step6 누락 — 뮤테이션으로 "terminal 후 툴 실제 실행" 실증, **Opus의 M1 이중방어 판정을 반박, Fable이 옳음** / Codex는 이 경로 못봄=리뷰어조합 값어치) + 양쪽 Important(carrier-only 스키마) + Codex Important(R 미바인딩)+Minor(grant 미소각/한글).
- R2: 양쪽 **R1 findings 4건 전부 CLOSED**(뮤테이션 실증). 신규: Fable Important(stream-ended invalidation 테스트 미고정=뮤턴트 생존) + Minor(catch closeQueryOnce 무가드 onExit 억제 / permissionMatches 스펙-코드 drift). 🔴 **linter-revert로 내 permissionMatches 제거가 커밋 안 됨 — 리뷰어 둘이 독립 지적**([[user-questions-catch-what-review-misses]] 변종: 하네스가 내 edit를 되돌림).
- R3(델타집중): 양쪽 **"delta clean, M3 certified"** findings 0. F1/F2/F3 전부 실측+뮤테이션. 커밋 blob 직접 열어 linter-revert 재발없음 확인.

**🔴 M4로 넘길 것(비차단 advisory, 양쪽 지적):** orphan-timer 콜백(`claudeOrchestrator.js:314`)+`closeInvalidRemoteStartState`(:355)의 `closeQueryOnce()` 무가드 = M2 기존코드(a85c7427), throw 시 onExit 억제. F2와 동종 → **M4에서 같은 call-site 가드**(closeQueryOnce 내부 swallow 금지 — close()의 closeError 캡처 의미 깨짐). + **뮤턴트 F(remoteStarted producer-only) 여전히 열림** — M4 abort가 소비자.

## SESSION 2026-07-18 (3) — M4 완료 (abort transaction §5.7). **로컬 3커밋 미push (origin 92e7c35d).**

역할 동일: Codex gpt-5.6-sol 저작 → Opus 검증(스위트+뮤테이션 직접) → Codex+Fable 독립병렬 적대리뷰.

**M4 커밋 3개 (origin 92e7c35d 기준 미push):**
- `113520e3` M4 core: abort() stub → §5.7 early-cancel admission barrier. 단일 `settleAbort()`가 5개 settlement 경로(pendingStart unwind/timeout, active remote-start前 close-only, remote-start後 cancel-true+boundary idle, cancel-unconfirmed/unavailable/timeout/failure close, concurrent close) 전부 timer 정리+resolve(never reject). `createAbortTransaction`이 state/currentAbort/30s watchdog를 **await 전 동기** 설정, `remoteStarted` 캡처. remote-start前=A無 close-only(`abort-before-remote-start`), 後=`priority:'now'` A write→`cancelAsyncMessage`(true+opaque result boundary→맥락보존 idle / false·무능력·throw→close). 재진입 Stop=같은 promise, concurrent close 우선(`session-close`). mapper aborting 브랜치=non-result 버리고 active-abort result만 opaque boundary. 신규 상수 30s+D3 payload, optional `approvalPrompt` dep(M6 배선). **abort() NEVER rejects.**
- `c07bfbc1` R1 리뷰 fix: (D3 payload 🔴 — Codex 저작이 한글, **내가 프롬프트에서 "한글 payload"로 스펙 §5.0 D3:143을 드리프트시킨 게 근본원인**; 정확 ASCII로 복원+byte-exact 핀) (settleAbort 가드 🔴 — 내 "redundant" 판정을 **양쪽이 반박**: approvalClose.catch/continueActiveAbort catch가 pre-check 없이 settle → boundary-idle後 새 턴에서 구 transaction 늦은 approval reject가 라이브 세션 죽임; 코드는 옳고 회귀테스트로 핀) (approvalPrompt optional-chain `?.closeSession?.()`+`{}`픽스처) (closeQueryOnce 성공後에만 queryClosed=재시도가능) (closing→reason:'closing').
- `a2da32a5` R2 리뷰 fix: Codex Important — concurrent close가 close 시도 소유+`query.close()` throw면 close()가 rejected closePromise 캐시→재시도 불가 zombie. close()가 `!queryClosed`일 때 캐시 무효화→후속 close 재시도. 미핀이던 closeQueryOnce ordering도 핀.

**Opus 검증(직접):** 전체 **710f/7967 GREEN**. 🎯 **뮤턴트 F(remoteStarted producer-only, M2부터 열림) 완전 종결** — producer 제거/capture flip 양방향 KILLED(M4 abort가 소비자). abort 급소 전부 KILLED: barrier·watchdog·boundary·settlement 5경로·D3 byte-exact·settleAbort 가드·close-retry·closeQueryOnce ordering. 🔴 하네스 함정 재현: D3 뮤테이션 1차가 regex 미스(`user\'s` 이스케이프)로 false-survivor→명확한 위치로 재검증 KILLED. **수용 survivor 없음**(M3의 settleAbort 가드는 Important로 승격되어 핀됨). M1 handler activeMatches는 M4에서도 clear-on-abort 이중방어 유지(양쪽 동의, 격리불가).

**적대리뷰 3라운드 findings 0 인증:**
- R1: 양쪽 Important(D3 payload) + Fable Important(settleAbort 가드 = 유일방어선, 내 판정 반박·뮤턴트로 라이브세션 죽임 실증) + Codex Important(close-throws zombie / sessionManager sync-hoist 미구현 / self-close 정리 미소비) + Minor. 11스텝·§5.2 반환모양 byte-exact 검증.
- R2: 양쪽 R1 4/5 CLOSED. Codex Important(close-throws의 concurrent-close-소유 경로 잔존) → a2da32a5로 fix.
- R3(Codex focused): **"delta clean, certified"** findings 0, node 재현+뮤테이션.

**🔴 M5/M6/M7로 이연(양쪽 동의, M4-orchestrator 코드 결함 아님):**
1. **§5.7.2 sessionManager.abort 동기 hoist** — `withOpenSession()` await 전에 P cancel flag+epoch 동기 변경해야(현 `sessionManager.js:243`은 await 후 delegation). orchestrator abort()自체는 sync-first-tick 맞음. **M5 shared runState + M6 claude 배선 시 필수.**
2. **self-close 세션 정리** — abort 결과 `sessionClosed:true`를 manager가 소비해 세션 identity/RPC 제거, ChatPanel이 sessionOpenRef 내려야(`ChatPanel.jsx:663` 현재 미소비). **M6/M7.**
3. **§5.7.9 redacted diagnostic** — aborting(P) non-result가 현재 silent suppression(안전규범은 다 구현, 관측성 로그만 누락). **M6/M7 백로그.**

HEAD `a2da32a5`. 스펙 §5.4 step2/5(M3) + §5.0 D3 payload 정합 확인.

## SESSION 2026-07-18 (4) — M5 완료 (send busy reservation §5.5 + abort sync-hoist §5.7.2). **로컬 2커밋 미push (origin a2da32a5).**

역할 동일 + **설계결정은 혼자 안 함**: M5 seam(runState 주입 vs 별도 레이어)을 Codex+Fable 독립병렬 설계상담 → 합의 후 Codex 저작 → Opus 검증 → Codex+Fable 리뷰.

**설계 상담 결론(양쪽 합의, Fable 경계 refinement 채택):** §5.5 runState = **매니저 소유 provider 공통 semantic turn 권위**(별도 mirror 아님, §5.5:340/362). **M5 = codex 하드와이어 유지 + claudeOrchestrator/codexOrchestrator 내부 무수정**(codex는 onEvent wrapper로 완료 관측 release, turnStartPending은 inner transport guard 유지). **claude runState 주입/hoist는 M6**(아직 construct 안 하는 모듈을 M5에서 리팩터하면 M2-M4를 두 번 리뷰). Codex는 M5에서 claude lift 원했으나 Fable 논거가 강해 채택.

**M5 커밋 2개 (origin a2da32a5 기준 미push):**
- `33e5c16c` M5 core: sessionManager 세션별 runState cell(idle/pendingStart/active/aborting/orphanDrain/closing). send()가 모든 await·admitTurn 전 **동기 reservation(P)** + 상태별 busy refusal table + 각 await 경계 cancel 재검사 + envelope-0 unwind. **row→sdkModel 실버그 수정**(🔴 M1부터 codex가 `turn/start.model='codex:gpt-5.5'` prefix 받던 것 → `sdkModel='gpt-5.5'`; 미상 id/wrong provider/null sdkModel fail-closed 거부). abort() runState를 await 전 읽음(sync-hoist): idle/cold 즉시, pendingStart cancel+epoch+30s watchdog, active delegate. active는 onEvent wrapper가 turn/completed 관측 시만 idle 해제. main.js가 catalog 단일 인스턴스 공유.
- `7230a1a7` R1 리뷰 fix (abort 라이브니스 체인): 양쪽 리뷰가 잡음 — (Codex I2) active abort delegate 실패가 promise reject+idle 재개 → `failAbort`/`settleAbort`로 closing+`agent-abort-failed` resolve(never reject/reopen) (Codex I3+**Fable I1** 뮤턴트 2개 생존) close-during-abort가 cleanup await 뒤 정산 → 동기 정산; watchdog은 `agent-abort-timeout`, direct close는 `session-close` 분리 (Codex I5/Fable m4) turn/start id 없는 ack → active 고착 → 해제 (Fable m3) watchdog 가드가 replaceRunState identity(항상 동일) → per-transaction Symbol token (dead `reservation.delegated` 제거).

**Opus 검증(직접):** 전체 **710f/7989 GREEN**. 급소 뮤턴트 KILLED: pass-catalog-id-not-sdkModel(버그픽스 핀)/no-busy-refusal/no-provider-check/abort-no-cancel-pendingStart/no-release-on-completed/watchdog-neutered/close-no-abort-settle(Fable I1 종결)/failAbort-noop/timeout-vs-failed-code/token-guard-flip/unusable-turnid-release. 🔴 뮤테이션 regex 미스로 false-survivor 2건→failAbort-noop·token-guard-flip 직접 뮤턴트로 실제 커버 확인(하네스 함정 재확인).

**빈-카탈로그 계약변경 검증(양쪽 "correct-per-spec"):** old "생략→서버기본"에서 "unresolvable→agent-model-unavailable 거부"로 flip. **프로덕션 카탈로그는 `finalizeCatalogRows`가 built-in `codex:gpt-5.5` fallback을 항상 합성 → `[]` 도달 불가**, flip 정당(§5.5 fail-closed/D4). flip된 통합테스트는 unrealistic 빈 카탈로그를 주입한 것.

**리뷰 2라운드 findings 0:** R1 양쪽 Important(abort 라이브니스 5종)+Minor → 7230a1a7 fix. R2(Codex focused) **PASS** 5/5 CLOSED, interleaving exactly-once 검증, Minor(turn-id 테스트 강화)만 → it.each 4케이스+가드 뮤턴트 KILLED.

**🔴 M6로 이연(설계상담+리뷰 합의):**
1. **claude runState 주입/hoist** — claudeOrchestrator `let state`→주입된 runState cell로 lift + send가 매니저 P 인수(turnId=P). **M2-M4 machinery 무손상 mechanical hoist.**
2. **session-open id→sdkModel** — open도 prefixed id를 codexOrchestrator.open→thread/start.model에 흘림(send와 같은 버그 클래스, provider factory가 initial row resolve).
3. **steer() runState 게이팅**(§5.6 table) — 현재 codex self-check로 안전하나 pendingStart/aborting에서 structured refusal 아닌 throw.
4. **codex remoteStarted producer**(claude 주입이 소비) / abort during closing→idle·orphanDrain 엣지.
5. provider factory(createCodexOrchestratorImpl 하드코딩→row.provider 기반), defaultPin/cold fallback marker, D2 provider-switch close/reopen.

## SESSION 2026-07-18 (5) — M6 슬라이스 1 완료 (claude runState hoist). **로컬 1커밋 미push는 아래 참조.**

M6가 M5의 2배 크기라 **가장 위험한 prerequisite(M2-M4 재접촉)를 self-contained 슬라이스로 먼저** 처리.

**M6a 커밋 `6e255e98` (origin 7230a1a7 기준 — push 예정):** claudeOrchestrator `state`/`turnEpoch`/`toolEpoch`를 **주입 가능 runState cell**로 hoist. **순수 mechanical refactor, behavior 무변경.** 생략 시 인스턴스별 새 cell(`{state:{kind:'idle'},turnEpoch:0,toolEpoch:0}`), 주입 시 같은 객체를 authority로. `turnCounter`는 로컬 유지. 재작성 call site 전체: invalidateToolAuthorizations/settleAbort/createAbortTransaction/enterOrphanDrain/closeOrphanDrain/closeInvalidRemoteStartState/handleOwnedResult/mapSdkMessage/readQuery/doOpen(closing guard·activeMatches·permissionGate)/open/send/steer/continueActiveAbort/abort/close. **Opus 검증: 기존 88 무변경 통과 + 신규 주입테스트 = 89. 전체 710f/7990 GREEN. hoist 완전성 grep(bare 선언 0) + 뮤테이션(default를 공유 singleton으로 → 14 failed = 주입 non-vacuous).** ⚠️ M6a는 **리뷰 미실시**(mechanical refactor + 88 무변경 통과가 강한 증거지만, 규율상 M6b와 함께 리뷰할 것).

**🔴 다음: M6 슬라이스 2 (프로덕션 sessionManager에 claude 배선 — full author→검증→이중리뷰→fix 필요):**
1. **provider factory** — `sessionManager.js:47/159` `createCodexOrchestratorImpl` 하드코딩 → resolved initial row의 `provider` 기반 codex/claude factory. **DI가 다름**: codex=privateRpc/adapterPath/spawn 등, claude=elicitationResponder+toolCore+grantLedger+approvalPrompt+**주입 runState cell**(session.runState 그대로)+model=sdkModel. claude는 privateRpc 불필요(nullable close). claude 생성자 시그니처: `{sessionId,projectToken,elicitationResponder,toolCore,grantLedger,model,onDelta,onEvent,onExit,env,...factories,approvalPrompt,runState}`.
2. **open(modelId)→row** — open이 catalog에서 initial row resolve → `session.provider=row.provider`, sdkModel을 orchestrator model로. **session-open도 prefixed id 흘리는 버그 여기서 수정.** cold면 defaultPin=`codex:gpt-5.5`+`fallbackReason:'catalog-cold'` marker.
3. **defaultPin** — open 시 default 고정. 생략 send는 IPC의 매번 defaultModelId()가 아니라 session pin 사용.
4. **D2 provider-switch** — 다른 provider row로 send → `provider-switch-required`(이미 M5에 refusal 존재) = close/reopen 유도.
5. **steer() runState 게이팅**(§5.6) — 매니저가 runState 확인, non-active면 structured refusal.
6. **claude abort sessionClosed cleanup** — claude abort 결과 `sessionClosed:true`를 매니저가 소비해 세션 정리(M5는 codex 경로만).
7. **claude send가 매니저 P 인수** — 주입 cell이 pendingStart(P)면 claude send가 자기 P 민팅 대신 그걸 이어받음(turnId=P). ⚠️ **claudeOrchestrator.send의 `if(state.kind!=='idle')throw` + 자체 pendingStart 민팅을 매니저 P 채택으로 바꿔야** — 이건 claudeOrchestrator 추가 수정(M6a는 cell만 hoist, P 채택 로직은 미변경).

⚠️ **CLAUDE_AGENT_DEFAULT_SDK_MODEL=null(D1 대기)라 claude row sdkModel=null=미선택** → M6b claude 경로는 **D1 스파이크 전엔 프로덕션 도달 불가**, 테스트 픽스처(sdkModel 있는 claude row)로만 검증. 그 뒤 M7 UI(D4 fallback·item-retracted wire·abort sessionClosed/contextPreserved). §6 release-gate 스파이크(D1 setModel — claude 실사용 게이트)는 릴리스 전.

HEAD `6e255e98`(M6a).

## SESSION 2026-07-18 (6) — M6b 설계상담 확정 (runState 정합 아키텍처). 아직 저작 전.

M6b 착수 전 **runState 정합 fork를 Codex gpt-5.6-sol(xhigh) + Fable5 독립병렬 상담**(원장 규율 [[decisions-need-codex-and-fable]]). 상담문 `docs/superpowers/specs/2026-07-18-m6b-runstate-consult.md`(디스크만).

**충돌**: 매니저 runState는 flat `{kind,turnId,...}`+`replaceRunState`가 전 key delete(`sessionManager.js:70`). claude는 nested `{state:{kind},turnEpoch,toolEpoch}`(M6a). 스펙 §5.5 "provider 공통 single runState" vs M6a 커밋 "claude nested cell이 authority" 상충. 같은 객체 못 씀(첫 replaceRunState가 claude `.state` 삭제).

**🔴 둘 다 독립적으로 A(provider-branched 매니저) 추천 + 같은 치명적 구멍 발견:**
- **A 채택**: claude 세션 `session.runState`=nested cell(open이 nested로 생성). 매니저 send/steer/abort/busy/observe가 `session.provider` 분기. codex=flat SM verbatim(M5 무손상). §5.5 "공통"은 "세션당 단일 authority cell(provider별 shape)"로 정정(스펙 반영 완료). B(flat통일)=M2~M4 재작성(claude state는 이름표 아니라 **행위 운반체**+**객체 identity** stale판정 `runState.state!==pending/active/transaction` → flat 재사용시 소멸). C(두 cell)=orphanDrain이 이벤트 0이라 바깥 cell이 관측 불가=구조적 desync.
- **Fable 결정 물증**: `createReservation`(`:108-126`)이 이미 claude pending과 shape 호환(5필드+같은 cancellation promise) → 매니저 P와 claude pending = **같은 객체**. A는 예정된 설계.
- **🔴 둘 다 잡은 구멍 — pendingStart 창 abort**: 매니저 open/catalog await 중(claude.send 호출 전) abort → claude `settlePendingAbort`가 claude.send finally(`:1071`)에서만 불림 → 아무도 정산 안 함 → 30s watchdog이 **정상 취소마다 세션 close**. 처방: claude에 additive 정산 훅(`settlePendingAbort(reservation)` 노출), 매니저 pre-handoff unwind가 호출. **M4 transaction 내부 무변경.**

**합의된 규율(양쪽):**
- Q2: 매니저 P=claude pending 같은 객체. turnId=매니저 `${sessionId}:pending:N` 단일(§5.3 claude:... 포맷 스펙 정정 완료). claude.send: `state.kind==='pendingStart'`면 채택(민팅 안 함), idle이면 self-mint 유지=M2~M4 테스트 무변경. claude.send 첫줄 `await open()`이 sync-first-tick과 양립불가 → reservation 설치는 매니저 몫(item7 강제 근거).
- Q3: abort=위임(감싸지 마라). 매니저 transaction/watchdog 만들면 `failAbort→replaceRunState`가 claude transaction cell 전삭제+이중 watchdog 레이스+rich value 재조립(계약 위반 `sessionManager.test.js:337-339`). 매니저=동기 state 읽고 await 없이 `claude.abort()` 호출, `sessionClosed===true`만 소비해 `closeSession` 구동(item6), 값 무변형 반환. ChatPanel(`:663-672`)도 sessionClosed 소비해 sessionOpenRef 내려야(M7).
- Q4: observeEvent release=codex-only 명시 guard(`session.provider!=='codex'`면 onEvent forward만). claude는 handleOwnedResult가 자체 idle(`:704-706`). 현재 우연 no-op(undefined 필드)은 필드 추가시 침묵 파괴=paper-safety. send 후처리(`:486-501`)도 claude 분기 skip. **steer: claude steerRefusal(`:181-222`)이 §5.6 표와 6상태 error/message/turnId 전부 일치 → 위임으로 방전. item5 "매니저 게이팅"이 실제 필요한 건 codex(`:319` throw).**
- Q5: catalog에 동기 `snapshot()`/`cacheReady` 추가(§5.1:184). `coldRows=finalizeCatalogRows([])`(`:163`)에 built-in `codex:gpt-5.5` full row 이미 동기 존재 → cold open도 await 0. open은 `list()` **await 금지**(claude SDK spawn/timeout 노출). cold+생략=COLD pin+`{defaultFallbackFrom,fallbackReason:'catalog-cold'}`. cold+명시(built-in 아님)=fail-closed. `claude:default`(sdkModel:null,hidden)=send와 같은 sdkModel 검사를 open에도 → orchestrator 생성 전 modelUnavailable(안 막으면 claude 생성자 TypeError `:249`가 agent-command-failed로 샘). defaultPin=full row. `agent:send`의 defaultModelId 재호출(`:348`)→세션 pin 소비.
- Q6 변경면: **무변경**=codexOrchestrator 전체, claude mapper/gate/abort barrier/close. **불가피**=sessionManager(M6b 표면), claude send pendingStart 블록만(P 채택), claude 정산 훅 1개(additive), agent-api snapshot/pin. manager close는 claude에서 `privateRpc:null` 허용해야(`:368-400` 현재 무조건 close).

**스펙 정정 완료(디스크)**: §5.5:340 "provider 공통"→"세션당 단일 authority cell(provider별 shape)", §5.3:248 P id=매니저 포맷.

### M6b-2a 완료 (커밋 `5117a3d2`, origin 6e255e98 기준 미push)
provider factory + open row resolve(prefixed-id 버그 수정: open이 raw `codex:gpt-5.5`를 thread/start.model로 흘리던 것 → sdkModel resolve) + catalog 동기 `snapshot()`({cacheReady,rows,defaultId}, list() 미호출) + defaultPin(cold marker `fallbackReason:'catalog-cold'`) + close null-safe privateRpc. claude 세션은 nested cell 생성+claude DI(privateRpc 없음). fail-closed: unknown provider / 미해결 명시 id / null sdkModel(claude:default). **Opus 검증: 전체 710f/8001 GREEN. 급소 뮤턴트 7종 KILLED**(codex model=id 버그재도입 / provider 분기 flip / null-sdkModel fail-closed / cold marker / snapshot cold fallback / claude nested cell / close null-safe). Codex 저작(브리프 `docs/superpowers/specs/2026-07-18-m6b-slice2a-brief.md`).

### M6b-2b 완료 (커밋 `3c804a21`, amend, origin 미push)
claude coordination core. replaceRunState codex-only hard guard + runStateView + busy/send/steer/abort/observeEvent provider 분기. observeEvent release=codex-only(claude는 handleOwnedResult 자체 idle, forward만). send가 매니저 reservation을 claude nested pendingStart로 설치+delegate, **claudeOrchestrator.send가 주입 pendingStart 채택**(await open 전 캡처, self-mint 제거→turnId=매니저 P; standalone은 self-mint 유지=M2~M4 88개 무변경). 🔴 **claudeOrchestrator가 `settlePendingAbort` public 노출** + 매니저 claude finishPending unwind가 호출 → **pendingStart 창 abort 구멍**(claude.send 호출 전 abort가 30s watchdog로 세션 닫힘, 리뷰어 둘 다 발견) 봉합. abort=claude 위임(매니저 transaction/watchdog 안 만듦)+`sessionClosed:true` background closeSession 소비. steer=claude 위임(자체 steerRefusal §5.6 일치)/codex는 매니저 게이팅 refusal(throw 아님). D2=기존 send provider 검사 재사용.
- **Opus 검증: 전체 710f/8011 GREEN. 급소 뮤턴트 5종 KILLED**(claude P-adoption[claudeOrch.lifecycle 테스트가 잡음, sessionManager mock은 다른 레이어] / settlement hook / sessionClosed consume / codex steer gating / claude reservation install→replaceRunState guard behavioral). 🔴 **하네스 거짓말 재현**: M1 다중파일 vitest가 "No test files found"로 Tests 요약 빔→단일파일 재실측(원장 #2). 🔴 **Codex가 vitest 못 돌려 놓친 실회귀 1건**: 기존 codex steer 테스트에 `autoComplete:false` 추가가 두 번째 send를 busy로 만듦(limit 기대와 모순)→Opus가 turn/completed emit으로 active 해제 후 limit 도달하게 수정, amend.
- ⚠️ **리뷰 대상 2건**(비차단): (1) observeEvent codex-only guard = defense-in-depth survivor(nested shape라 우연 no-op, 리뷰어가 명시화 권고했던 그것). (2) replaceRunState guard 존재를 **소스-문자열 grep**으로 핀한 테스트(line 155-163) = 원장 규율 위반, behavioral로 교체 제안. M7 뮤턴트가 guard의 behavioral 의미는 이미 실증.
- 브리프 `docs/superpowers/specs/2026-07-18-m6b-slice2b-brief.md`. **M6a 리뷰는 2b와 함께(미실시).**

### M6b-2c 완료 (커밋 `f138c804`, origin 미push)
send 생략을 session.defaultPin으로 위임(sticky 방지를 ba67f0a의 agent-api 주입 → session pin으로 이동, §5.1). `sessionManager.send`: `modelId==null`→`session.defaultPin`(sync, catalog 재조회 안 함), 명시→기존 list(). 공통 provider(D2)/sdkModel 검사 유지. agent-api argsFor의 defaultModelId 주입 제거 + IPC 가드 제거(authority가 snapshot/pin으로 이동). **Opus 검증: 전체 710f/8015 GREEN. 뮤턴트 KILLED**: #13(생략 send가 pin 대신 warm 재resolve→cold-warm 스위치) / 생략 라우팅(modelId==null→false). Codex 저작(브리프 slice2c-brief.md).

## ✅ M7a 완료 대기 (렌더러 계약 배선, R1~R4 리뷰). 로컬, 미push.
M7 UI를 **M7a(렌더러 계약, 컴포넌트 테스트)** + **M7b(비주얼, 눈검증 게이트)**로 분할. M7a = M6b 이벤트를 renderer가 소비.
- 저작 `75e12f7f`(Codex): preload/forwarder에 agent:item-retracted + forwarder onDelta claude 객체 언팩 + ChatPanel message/tool provenance(turnId+sourceUuids) + item-retracted 핸들러(turnId AND uuid 교집합) + agent:error partial streaming:false + abort sessionClosed/contextPreserved. 브리프 m7a-brief.md.
- `305f59d1`: Opus가 vacuous 테스트(agent:error streaming, turnId 미스매치 마스킹) 수정. 뮤턴트 5종 KILLED.
- **R1 리뷰**(`af8ebb5e`): 둘 다 M-1(appendDelta turnId 분리 미핀) + Fable M-2(orphan-drain sessionClosed 미배선=wedge). fix: forwarder onExit sessionClosed 통과 + ChatPanel agent:error가 payload.sessionClosed 소비 + cross-turn delta 테스트. 뮤턴트 3종 KILLED.
- **R2 리뷰**(`af0c2ba0`): 둘 다 M-3 — M-2가 orphan-drain만 커버, **나머지 crash 경로(claude stream-ended/stream-error, codex crash), wall-clock, close-failure**는 wedge 잔존. **근본원인: "세션 닫힘" 진실 소유자는 manager**(exitedSession != null). fix: onExit 래퍼가 current-session exit에 sessionClosed 부여 + admitWallClock refusal에 sessionClosed + ChatPanel close finally ref 내림. 뮤턴트 3종 KILLED.
- **R3 리뷰**(`d8cd8ea1`): Codex M-1 — `closeOrphanDrain()`이 Query 닫으며 onExit 안 불러 wedge(마지막 미통지 경로). Fable MINOR — stale-exit 분기 미핀. fix: closeOrphanDrain onExit 보고 + stale-exit 테스트. 뮤턴트 2종 KILLED.
- **R4 리뷰**(`d2fe2215`): 둘 다 — orphan/timeout/invalid-remote-start의 `closeQueryOnce()` 미가드라 **throwing query.close()가 onExit 삼켜** wedge가 error 서브패스 생존(Codex MAJOR/Fable LOW=pre-existing). fix: 3곳 `try{closeQueryOnce()}catch{}` 가드(readQuery 패턴 미러) + throw 테스트. 뮤턴트 KILLED.
- **R5 리뷰**(`e2e95074`): Codex MAJOR — manager onExit 래퍼가 `onExit?.()`(webContents.send)를 `closeSession()` **전에** 호출 → 통지가 throw하면 cleanup 스킵 wedge(pre-existing 순서, R2 이전 원본도 동일). Fable은 제품 findings 0 certified(전 close 경로 스윕)+MINOR(R4 guard 2곳 미핀). fix: onExit 통지 try/catch 가드(cleanup load-bearing) + timer throw-guard 테스트. 뮤턴트 2종 KILLED. **이연(out-of-scope, pre-existing)**: codexOrchestrator cleanupResources가 한 cleanup reject 시 뒤 스킵(temp-dir 누수, wedge 아님); closeInvalidRemoteStartState guard는 상태기계상 도달불가 defense(code-verified, closeOrphanDrain+timer 테스트가 동일 패턴 커버).
- 🔴 **리뷰가 매 라운드 값어치**: R1 릴리스차단 wedge → R5 pre-existing onExit 순서, 점점 좁아지며 수렴. R4/R5 finding은 M7a 델타가 아니라 **pre-existing close 머신러리의 latent 이슈**(M7a 렌더러 배선은 R3부터 clean). "세션 닫힘→renderer 통지, cleanup 항상 실행, throwing 통지/close에 강건" 계약을 5라운드에 완비. 🔴 하네스 함정 재현: 오염된 뮤테이션 루프의 vacuous 신호(R1), git checkout이 미커밋 fix 파괴 — 매 fix 커밋 후 뮤테이션.
- **R6 리뷰**(`3e7721bb`): Fable — M7a 렌더러 배선 스코프 **findings 0 CERTIFIED**(R5 fix 뮤테이션 2/2 killed, 전 계약 무회귀). Codex MAJOR — `reportLimit`의 `onError?.()` 미가드라 통지 throw가 (a)wall-clock closeSession 스킵 (b)`maxTurns=0` throw가 admitTurn 통과→send reservation 미정산→agent-busy wedge. fix: reportLimit onError try/catch 가드 + 2 테스트. 뮤턴트 KILLED.
- **클래스 완결**(`ab7c5f99`): R4/R5/R6가 전부 **같은 "throwing 통지가 sync-path flow 억제" 클래스**의 미가드 콜백을 하나씩 발견 → whack-a-mole 대신 매니저 경계 콜백 전수 가드: onUsage(admitTurn/admitToolCall, onError 직접 형제 wedge, 뮤테이션 KILLED)+onEvent+onDelta(defensive forward). **6개 콜백 전부 가드**: onDelta/onEvent/onUsage/onError(R6)/onExit(R5) + closeQueryOnce(R4).
- 🔴 **리뷰 루프 종료 판정**(R6에서 끊음): R4/R5/R6 findings가 전부 **pre-existing 통지-robustness 클래스**(M7a 델타 아님, 렌더러 배선은 R3부터 clean·Fable R6 certified)라 [[findings-zero-is-not-a-stop-condition]]의 "스코프 안 잡힌 신호". 6라운드는 규율(3-5) 초과. 클래스를 전수 닫아 R7 whack-a-mole 방지. 가드는 기계적 try/catch resilience(구성상 안전). **이연(out-of-scope pre-existing)**: codexOrchestrator cleanupResources 순서 누수(temp-dir, wedge 아님), admitWallClock onError 순서(자가치유), closeInvalidRemoteStartState guard(도달불가 defense), open catch 에러 마스킹(코스메틱).
- **전체 710f/8039 GREEN**. HEAD `ab7c5f99`.

## ✅ M6b 완료 (M6a+2a+2b+2c+R1+R2). **origin push `6e255e98..42d170fe`.**
리뷰 범위 `7230a1a7..f138c804`(M6a 6e255e98 + 2a 5117a3d2 + 2b 3c804a21 + 2c f138c804). R1 C1(refuse-wedge, 둘 다·릴리스차단)→fix `852e7db9`. R2 Codex findings 0 / Fable MINOR(identity 조건 미핀)→fix `42d170fe`. 전체 710f/8017 GREEN.

### 합동 적대리뷰 R1 (Codex+Fable 독립병렬) — 🔴 릴리스 차단급 C1 발견
**둘 다 독립적으로 같은 버그 발견**(Fable 실조립 재현): claude send가 reservation을 nested cell에 설치 후 **abort 없이 refuse**(D2/model-unavailable/sdk-invalid/turn-limit/list()-throw)로 unwind → finishPending claude 분기가 `settlePendingAbort`(no-op)만 하고 **cell을 idle로 안 되돌림** → cell이 stale pendingStart 고정 → 이후 모든 send `agent-busy` → Stop도 30s watchdog로 세션 폐기. **내 브리프의 "cancel은 abort/close로만" 전제가 refuse 경로를 빠뜨린 paper-design.** 리뷰가 정확히 잡음. 나머지: Codex Minor(claude closing abort 값 idle vs closing), 둘 다 M1(observeEvent guard survivor)/M2(replaceRunState 소스-문자열 테스트).

**R1 fix (커밋 `852e7db9`, origin 미push):**
- C1: finishPending claude 분기가 cell이 여전히 reservation이면 idle 복원(identity-guard로 abort transaction 안 침범). 회귀: claude open→D2 refuse→유효 send 성공(busy 아님). **뮤테이션 KILLED.**
- Minor: abort claude 분기를 closing 단락 위로 올려 claude 자체 값(`reason:'closing'`) 무변형 반환. **뮤테이션 KILLED.**
- M2: 브리틀한 소스-문자열 replaceRunState guard 테스트 제거(repo 규율). replaceRunState guard·observeEvent guard 둘 다 **nested shape라 도달불가/no-op forward-proofing defense=킬 불가 survivor**(양쪽 리뷰어 "defense-in-depth로 충분" 동의). 소스 주석으로 문서화, untested. 🔴 **하네스 함정 재현**: 처음 만든 observeEvent behavioral 테스트가 vacuous였음(심은 reservation에 sessionToken 없어 ownsReservation false→releaseActive 조기반환). 오염된 뮤테이션 루프가 "2 failed" 거짓신호 줌 → 커밋된 blob 클린 재실측이 SURVIVED 드러냄 → vacuous 테스트 제거.
- M3(Fable): claude.send adopt→try 창 throw 도달불가 근거 주석. M4(standalone P-adoption ownership marker 없음)=매니저 busyRefusal 선차단이라 도달불가, 기록만. M6(status() defaultPin 없음)=M7 이연. spec §5.1:186 문구 정정(snapshot/M7 status 이연).
- 🔴 **하네스 함정 재현 2**: 뮤테이션 루프의 `git checkout -- $SM`가 **미커밋 C1/closing fix를 파괴**(원장 Task-5 교훈 재확인) → 재적용+커밋. **뮤테이션 전 커밋.**
- **Opus 검증: 전체 710f/8016 GREEN.**

### 합동 적대리뷰 R2 (델타 852e7db9) — **M6b 종결**
- **Codex: findings 0 certified**(C1 identity-guard 실조립 probe, active 비침범, closing 위임, codex byte-diff 0, guard survivor 판단 정직 전부 실측).
- **Fable: 1 MINOR** — C1 identity 조건(`state === reservation`)이 안 핀됨(제거해도 스위트 GREEN이나 P4=close가 pendingStart 창에 온 뒤 refuse unwind에서 closing cell을 idle로 덮음, killable-but-unkilled). **fix 커밋 `42d170fe`(test-only)**: close-during-pendingStart 실조립 테스트 추가, 조건 뮤턴트 **KILLED**. 소스 무변경(852e7db9에서 양쪽 certified).
- 리뷰 루프 종료([[findings-zero-is-not-a-stop-condition]]): 소스는 R2에서 양쪽 clean, 유일 MINOR는 처방받은 테스트로 닫음.

## ✅ M6b 완료 (M6a+2a+2b+2c+R1+R2). 로컬 6커밋, origin 6e255e98 기준 **미push**.
`6e255e98`(M6a) → `5117a3d2`(2a) → `3c804a21`(2b) → `f138c804`(2c) → `852e7db9`(R1) → `42d170fe`(R2). **전체 710f/8017 GREEN, build exit 0.** provider factory + claude를 프로덕션 sessionManager 배선(아키텍처 A: claude=nested cell 권위, provider 분기). prefixed-id 버그 수정, defaultPin sticky, D2, steer 게이팅, abort 위임, P 채택, 정산 훅. ⚠️ **CLAUDE_AGENT_DEFAULT_SDK_MODEL=null(D1) + M7 selector 미배선이라 claude 경로는 프로덕션 미도달** — 테스트 픽스처로만 검증됨.
**남은 것**: (1) 사용자 push 확인, (2) **M7 UI**(§5.8: selector claude 활성화+provider grouping, ChatPanel D2 경고/D4 fallback 표시/`agent:item-retracted` wire/abort `sessionClosed`·`contextPreserved` 처리/`agent:error` streaming:false/status defaultPin 노출), (3) §6 release-gate 스파이크(D1 setModel — claude 실사용 게이트, 릴리스 전).

**저작 계획**: 2 슬라이스. **2a**=catalog snapshot + open row resolve(prefixed-id 버그 수정) + defaultPin + provider factory(claude nested cell 생성+DI) + close nullable privateRpc. **2b**=send/steer/abort/observe claude 분기 + claude.send P 채택 + 정산 훅 + D2 + agent-api send pin. 각 Codex 저작→Opus 검증(스위트+뮤테이션)→Codex+Fable 리뷰 findings 0. **M6a 리뷰도 2b와 함께.**

## SESSION 2026-07-19 — M7b (비주얼 UI) 완료. 로컬 6커밋, **미push** (origin ab7c5f99 기준).
`1b141c8f`(S1) → `ae904f76`(S2) → `f505ed42`(S3) → `939d4086`(R1 fix) → `b9dd5f6e`(R2 fix) → `77838a82`(R3 fix). **전체 710f/8065 GREEN, build exit 0.**

역할: 저작=Opus(기계적 UI 배선; S2 selector·S3 ChatPanel은 미묘한 시퀀싱이지만 "누가 쓰든 다른 쪽이 뜯는다" 불변식을 적대 리뷰로 충족) / 검증=Opus(스위트+뮤테이션+raw) / 적대 리뷰=Codex gpt-5.6-sol(xhigh)+Fable5 독립 병렬, 3라운드.

### 구현 (§5.0 D1~D4, §5.1, §8:577)
- **S1** sessionManager.status() → provider+defaultPin+initialModelId+turnActive 노출(remount 복구).
- **S2** AgentModelSelector: 하드코딩 disabled "Claude coming soon" 제거 → 저장된 `provider` 필드로 grouping(Default 맨 위 header 없음, provider별 header 1회), claude 실선택 활성화. Default label은 ChatPanel이 계산해 pass(D4 문자열 통과). id-prefix 파싱 안 함.
- **S3** agent:status IPC(+preload) / ChatPanel: open응답·mount status로 orchestratorProvider+pin hydrate / D2 cross-provider 확인 배너(**비모달 인라인**, role=alert — 네이티브 모달 금지) → 확인 시 abort→close→reopen / D4 fallback label(pin 기반, pre-session은 catalog default row) + status log(실제 fallback 사용 세션만) / i18n 5키.

### 🔴 적대 리뷰 3라운드 (Codex+Fable 독립 병렬) — 매 라운드 값어치가 나왔다
- **R1: 둘 다 독립적으로 같은 Critical(C1)**: codexOrchestrator.open()이 `{threadId}`만 반환(provider 없음) → ChatPanel orchestratorProvider가 **프로덕션 codex 경로에서 절대 set 안 됨** → D2가 remount 후에만 작동, 내 테스트는 open mock에 provider를 심어 가림(vacuous). fix: sessionManager.open()이 `provider: session.provider` authoritative 반환 + 테스트를 실제 shape로. 추가 fix: initialModelId(§5.1 initial row, 명시 세션 remount wedge)·send/confirm while pending·session-death clear·hydration state/epoch guard·video abort leak.
- **R2: 둘 다 다시 같은 Important**: same-provider 재선택 시 stale pendingSwitch(배너 남고 target 옛 Claude). + Codex: active-turn remount → running 미복원 → D2가 라이브 턴 종료(status.turnActive 노출+복원). + Fable: D4 status log이 명시 claude 세션에도 "GPT-5.5 사용" 거짓 로그(initialModelId==null 게이트).
- **R3: Codex 2 Important, Fable findings 0 → 갈림 → raw 판정**: turnActive가 `kind!==idle`이라 aborting(Stop이 이미 agent:done 냄, 30초 창) remount에서 running 영구 복원 wedge. Fable은 "Stop으로 복구 가능"이라 안 올림, Codex는 Important. **raw로 판정: claudeOrchestrator가 aborting에서 turn/completed를 앞서 냄 → 새 done 없음 → 실제 wedge → 수정**(active/pendingStart만 true). + D4 log이 explicit→mid-session-Default 전환(실제 fallback 사용)을 놓침 → logFallbackDefaultOnce(sessionIdRef dedup) 헬퍼로 open+mid-session 양쪽.
- **R4: Codex+Fable findings 0**. Codex가 남긴 low-sev UX 창(느린 manual close pending 중 Default 선택 시 closing 세션에 D4 로그) 1건은 Critical/Important 아님(수용).

전 fix 뮤테이션 KILLED: C1-provider, initialModelId(open+status), send-block, error-clears, hydration-state, selectedModel-restore, video-abort, pre-session-D4, stale-pendingSwitch, D4-log-gate, turnActive(producer+consumer, active/pendingStart), mid-session-D4-log, dedup.

### 🔴 이 세션 교훈 (재확인)
- **뮤테이션 전 커밋 규율을 R3에서 어겼다** → 뮤테이션 스크립트의 `git checkout`이 **미커밋 R3 소스 fix(sessionManager turnActive + ChatPanel logFallbackDefaultOnce)를 통째로 파괴**. 테스트만 남아 실패로 발각 → 재적용 후 즉시 커밋. [[autoflowcut-story-realtime-usage]] Task5·docking에서 두 번 데인 병을 세 번째로 밟음. **fix는 뮤테이션 전에 반드시 커밋.**
- **리뷰어 둘 다 같은 Critical/Important를 독립으로 잡으면 진짜**(R1 C1, R2 stale-switch). **갈리면 raw로 판정**(R3 aborting wedge: Fable 관용 vs Codex Important → claudeOrchestrator raw가 Codex 편).
- **테스트 mock이 main이 못 만드는 shape를 쓰면 vacuous**(R1 open-provider 가림, R2 markerless codex pin). 실제 계약 shape로 핀.

### ⚠️ 남은 것 (사용자 게이트)
1. **push 확인** (origin ab7c5f99 기준 6커밋 미push).
2. **실앱 눈검증**(테스트 불가): D2 전환 양방향(codex↔claude), cold start의 D4 label+status log, mid-turn reload 뒤 Stop, 배너 비모달 표시.
3. §6 release-gate D1 setModel 스파이크(claude default 승격 — claude 실사용 릴리스 게이트). 미승격이라 현재 프로덕션 기본은 여전히 codex gpt-5.5 fallback.
