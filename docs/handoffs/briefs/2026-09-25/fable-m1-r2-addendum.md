# Addendum — M1 review round 2 (fold into your current M2 work before the final report)

Round-2 reviews of 8aebbc03 (both Opus): no BLOCKER/MAJOR. Unique MINORs to fix, all accepted:
- Findings files: `/private/tmp/claude-501/-Users-tuxxon-workspace/97bf2874-bc98-45a4-b837-445245094350/scratchpad/review/m1-r2-opus1.findings.md` (4) and `…/m1-r2-opus2.findings.md` (7). Overlaps: ref-hook auth text (O1#2 = O2#1), settings needs-trusted close (O1#3 = O2#4), App-level reason tests (O1#4 = O2#5).
- Dispositions:
  1. Focus (O1#1): record `hadFocus` before `focus()`; give focus back to the main window after read-back/submit and on early returns when the viewport was entered or the view was not focused before; harness assertion. Note: since 7670858b the viewport wrapper covers the whole DOM phase — do the focus hand-back in that wrapper's finally.
  2. Ref-hook auth text (O1#2/O2#1): as stated, both stored errorMessage and displayResultError; test.
  3. Settings close after needs-trusted retry (O1#3/O2#4): close on `r.closed !== true`; harness test with two needsTrusted runs expecting `trusted:settings-trigger-close`.
  4. App-level tests for the video-retry and tag-proceed reason sites (O1#4/O2#5).
  5. Submit-time `flow-feature-unsupported` terminal in the video hook (O2#2) — implement even though M2 replaces the stubs: other unsupported kinds still need it. Test as stated.
  6. `report('submit:…')` must not block collect (O2#3): `void report(...)` (or race with a short timeout); test with a never-settling diagnostic.
  7. Hidden-view tests must distinguish layout restore from snapshot restore (O2#6): `setModalVisible(false)` inside the set-text branch; assert final bounds = split layout.
  8. Locale key scan (O2#7): match `kindResult('…')`/`errorKind:'…'` literals regardless of prefix; add shared.js, video.js, flow-api.js, character.js to SOURCES; add the missing strings it finds.
- Record them in the plan's §11.1 as #41–#48 (or §12 if you prefer to keep M1 notes closed). Same TDD rules. Report these in your final M2 report as a separate section.
