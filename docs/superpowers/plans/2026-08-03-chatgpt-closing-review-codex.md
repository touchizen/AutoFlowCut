# ChatGPT Closing Review — Codex

- Commit under review: `555e97be`
- Scope: closing confirmation; review only
- Status: complete.

## Evidence so far

- The new harness calls `createModeController(...).register(...)` and captures the handlers that production registration supplies.
- Its bridge invokes those captured `chatgpt:*` handlers with the trusted renderer sender; the submission handler is not replaced with a test double.
- `route:set` is invoked through the captured production handler under the explicit development gate before the default-settings run.
- The ChatGPT target is created through `createChatgptTarget`, whose normal adapter construction path is used; only Electron primitives/page behavior and time are faked.

## Interim judgment

- (a) Closed. The preload module itself is not executed; its channel mapping is reproduced. That shim does not bypass main: every renderer call reaches the exact handler captured from production `register`, including submit/observe/collect and route state. A new guard inside `chatgpt:submit-generation` therefore cannot stay green on this default run.
- The harness also uses the real target registry, real `createChatgptTarget` default adapter factory, real auth probe, and real adapter. Faked `ipcMain`, `WebContentsView`, page DOM responses, filesystem, and clock are appropriate boundary doubles rather than admission substitutes.

## Final verdict

- (a) **Yes — objection closed.** The preload mapping is represented by a transparent channel-for-channel forwarding shim, but handler registration and invocation are real. The real-defaults request enters the production `route:set` and `chatgpt:*` handlers, so a main admission guard on that traffic cannot ship green.
- (b) **Yes.** All three scoped caller paths now invoke the imported `effectiveSeedFrom`; none retains an inline equivalent. Their payload assertions exercise the derived value. Equivalent seed logic elsewhere is in separate video/unrelated paths and does not contradict this scoped unification.
- (c) **No new breakage found.** The source changes preserve the previous derivation semantics, and the added harness introduces no production mutation.
- (d) **Parking accepted.** `purpose`/`ref` metadata are path-specific and no current ChatGPT admission or adapter guard inspects them. Adding three more full-chain harnesses is not required to close the measured default/main-guard gap; fence them when a guard or behavior begins depending on them.
- **findings-0: Yes.**

Verification: focused run passed **4 files / 27 tests**, covering the two new seed suites, the real call-shape integration suite, and all 19 existing `mode.chatgptDevGate` tests. The reported full-suite and mutation results were treated as supplied evidence; no contradiction was found.
