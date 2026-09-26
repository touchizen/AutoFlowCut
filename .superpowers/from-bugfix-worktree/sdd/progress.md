# M1 Key Layer — SDD progress

Plan: docs/plans/2026-07-21-story-audio-m1-key-layer.md
Branch: feature/story-audio-apikey-gate
Mode: implement all tasks, then Fable5 + Codex(gpt-5.6-sol) milestone review

Task 1: complete (commit 95fcdbfd, 5/5 tests, TDD)
Task 2: complete (commit a123c4d, 3/3 tests, TDD)
Task 3: complete (commit 36408acc, 10/10 new + 76/76 regression, TDD; concern: 2 out-of-scope mock strings noted)
Task 4: complete (commit f4d505a7, 2/2 new + 8/8 SFX + 2016 electron suite, TDD)
Task 5: complete (commit 0cbb8e64, 2/2 new + 754 regression, TDD)
Task 6: complete (commit 90a180d5, 5/5 unit + 6671 full suite, TDD; concern: brief test-fixture arg mismatch fixed, sfx library preserved)
M1 COMPLETE: commits 95fcdbfd..90a180d5
M1 review R1 (Fable5 + Codex gpt-5.6-sol): no prod bugs. Fixes in scope: errorKind e2e test, getKey() arg, !key falsy guard x5, story-api default-adapter nullable, sfx nits. DEFERRED to M2: canonical {key,source} resolver consuming registry (Codex Medium 2).
M1 fix: complete (commit 77ee38cf, 6674 tests, TDD; 5 findings + 2 nits)

# M2 Pre-flight — SDD
Plan: docs/plans/2026-07-21-story-audio-m2-preflight.md
M2 Task 1: complete (commit 5e0c5bfc, 8/8 new + 607 story + 6682 full, behavior-preserving hoist, audio 15/15 unchanged)
M2 Task 2: complete (commit 90261aaf, 5/5 new + 5/5 existing)
M2 Task 3: complete (commit 921ed817, 6688 full suite; machine null guard added)
M2 COMPLETE: commits 5e0c5bfc..921ed817
M2 review R1 (Fable5 + Codex gpt-5.6-sol): no prod bugs, hoist safe. Fixes: onlySpeaker mode in audioPreflight (must-fix pre-M3), resolveKeyWithSource canonical (ttsKeyFor derives .key), sfxFor guard, forceRegen test.
M2 fix: complete (commit 4fff3062, 37/37 + 6691 full; canonicalSpeaker hoist behavior-preserving)
M2 COMPLETE + reviewed + mutation-verified: commits 5e0c5bfc..4fff3062 (onlySpeaker match mutation killed)

# M3a Settings consolidation — SDD
Plan: docs/plans/2026-07-21-story-audio-m3a-settings-consolidation.md
M3a Task 1: complete (commit 63be45c6, 3/3 + 61/61 settings; ApiKeyField no hooks)
M3a Task 2: complete (commits eeb08b11+600587c3, 1/1 + 1418 components + 6685 full; TtsKeyTab removed)
M3a CODE COMPLETE: commits 63be45c6..600587c3 (visual check pending)
M3a review R1 (Fable5+Codex): structure/hook/store-split clean. Fixes: locale Typecast-fixed copy (visual bug), wrapper unit tests (validate-gate/plaintext-discard/clear), clearKey result check, statusLabel dead prop, GoogleTTS story-note.
M3a fix: complete (commit 78a65f40, 61 settings + 6694 full; 5 findings, wrapper tests added)
M3a COMPLETE + reviewed + mutation-verified: commits 63be45c6..78a65f40 (validate-gate mutation killed). VISUAL CHECK PENDING (user). M3b (gate/VoicePicker/errorKind locale) remains.

# M3b-1 errorKind locale — SDD
Plan: docs/plans/2026-07-21-story-audio-m3b1-errorkind-locale.md
M3b-1 Task 1: complete (commit bb0a01ba, 4/4)
M3b-1 Task 2: complete (commit ddf8e268, 3/3 + 80 regression + 6701 full)
M3b-1 COMPLETE: commits bb0a01ba..ddf8e268 (errorKind locale + voicePreview classification)
M3a VISUAL CHECK: PASS (user confirmed settings tab consolidation)

# M3b-2a preflight wiring — SDD
Plan: docs/plans/2026-07-21-story-audio-m3b2a-preflight-hook.md
M3b-2a Task 1: complete (commit 4a35e1a1, 111 pipeline tests; params direct no projectToken)
M3b-2a Task 2: complete (commit 30c38f74, 3/3 + 6705 full)
M3b-2a COMPLETE: commits 4a35e1a1..30c38f74 (preflight renderer wiring + useAudioPreflight hook)

# M3b-2b gate UI — SDD
Plan: docs/plans/2026-07-21-story-audio-m3b2b-gate-ui.md
M3b-2b Task 1: complete (commit 136763e3, 2/2 + 61 settings; AudioKeyGateCard + onSaved optional)
M3b-2b Task 2: complete (commit 38fa7e63, 4/4 + 516 StoryView + 6711 full; 5 entry points wrapped, audioPreflight-fn guard for test doubles). CONCERN: StoryView useSafeT(key,fallback,params) mis-slots gate card's t(key,{label}) -> literal {label} in placeholder (visual bug, fix in T3).
M3b-2b Task 3: complete (commits 0a40fc0a+fb96a9e8, 6717 full; VoicePicker attempt-first + useSafeT i18n interpolation fix)
M3b-2b COMPLETE: commits 136763e3..fb96a9e8. M3 (ALL) CODE COMPLETE. Visual check + final Fable/Codex review pending.

# M3b final review (Fable5 + Codex, 2026-07-21) — NOT fixed (next session)
[High] onKeySaved refetch no-op (onVoiceSearch signature mismatch; App needs provider-reload prop + real-contract test)
[High] redo/regenerateSegment gate card invisible (setViewedStep(null) -> screen leaves audio panel where card renders)
[High] testSegment ungated (ttsPreview direct, errorKind lost -> raw toast)
[Med] VoicePicker inline card no onKeySaved (no retry/dismiss after save)
[Low] GETKEY_URL dup -> registry; main re-check (§4.4) deferrable (errorKind downgrades to translated banner)
NEXT: fix High 3 first -> re-review -> real-app visual check -> main PR

# M3b findings FIX (2026-07-21): commits 4b80e00b,80da150b,7f68acae,4e682e7d
[High1] onKeySaved refetch -> App reloadTtsVoicesForProvider + onReloadVoices prop; [High2] redo/regen keep audio panel; [High3] testSegment preflight-gated; [Med4] VoicePicker onKeySaved; [Low5] GETKEY_URL->registry. 6725 tests.

# M3b fix R2 review (Fable5+Codex): High1-3+Med4 CLOSED. Residual:
[High] testSegment save-retry no catch/busy guard (unhandled rejection on invalid key)
[Med] reload merge not replace (stale on account switch); VoicePicker inline save not wired to reload
[Low] URL registry half (ApiKeyTab/Gemini hardcoded); App reload test pins source string (not executed)
M3b fix R2: complete (commit a2cd61b1, 6736 tests; testSegment guard, reload replace, VoicePicker reload, URL registry, real-exec test)

# M3b fix R3 review (Fable5+Codex): 5 findings CLOSED, no new defects. Residual (orig spec clauses):
[High/Low] §4.8 story:tts-preview errorKind not returned (invalid-key auth raw toast); asKind pattern (story-api.js:167-170) + renderer resolveDisplayError
[Med] §4.7 settings-tab save doesn't share App reload (ApiKeyTab wrappers no onSaved)
[deferred] §4.4 main re-check
M3b fix R3: complete (commits 7e6415ae,44cf2f2c, 6742 tests; §4.8 tts-preview errorKind translation, §4.7 settings-save voice reload)

# M3b fix R3 review (R4 final, Fable5+Codex): §4.8 + §4.7 CLOSED. Fable findings 0.
Codex residual: [Med, edge] reload race (same-provider consecutive saves + out-of-order fetch; needs per-provider sequence guard). DEFERRED.
M3b REVIEW LOOP DONE (R1-R4). Code findings 0 (Fable). Deferred: §4.4 main re-check, reload race.
REMAINING = real-app visual check (M3b) + main PR.
