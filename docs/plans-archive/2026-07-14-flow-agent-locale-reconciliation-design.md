# Flow Agent Locale Reconciliation Design

## Problem

Flow generation depends on the page's Agent toggle matching the app setting. The image and video handlers reconcile that state, but `flow:generate-scene` does not. The selectors used during reconciliation also depend on Korean or English UI text, so adding the missing scene guard alone would make generation fail closed for additional account languages.

The live 2026-07-14 English and Korean DOM dumps show three stable, untranslated contracts:

- the Agent toggle is the only toggle-state control in the composer scope and carries `aria-pressed`;
- the Agent settings surface is described by ARIA roles/states and Material ligatures (`radiogroup`, `radio`, `tablist`, `tab`, `arrow_back`, `crop_*`, `radio_button_*`);
- generated media grid images are links to the current Flow project's `/edit/…` route, while character/reference/library images are not.

The provided dumps do not contain the Agent chat header (`edit_square`, New session, History, or their localized equivalents). `findAgentChatCloseButton` therefore remains unchanged: inventing an unverified structure would recreate the locale paper-fix this work is intended to remove.

## Design

### Scene Agent reconciliation

After `flow:generate-scene` reaches the target project composer, read the app Agent setting once and reconcile the page before waiting on, configuring, mutating, or submitting the composer. Call `ensureAgentOff()` for the OFF path and `ensureAgentOn()` for the ON path. Treat thrown errors and `{ success: false }` as terminal, returning the same clear fail-closed class of error used by image/video generation. All later scene branches use that captured setting so the reconciled page and selected collection path cannot diverge during one request.

### Locale-invariant Agent toggle

Start at the live Slate editor (`[data-slate-editor='true']`) and walk outward until an ancestor contains a toggle-state candidate: `button[aria-pressed]`, or a switch/checkbox carrying `aria-checked`. This first matching ancestor is the composer scope seen in both dumps.

If the scope has exactly one candidate, return it without reading translated text. If it has multiple candidates, apply the existing Agent/에이전트 text and ARIA-label matcher only as a disambiguator. Return an element only when that fallback produces exactly one match; otherwise return `null` and fail closed. The diagnostic probe records every scoped state candidate so an ambiguity is inspectable. Every injected expression assigns serialized functions to local constants and invokes those constants, preserving production-minification safety.

### Locale-invariant Agent settings

Use one shared set of pure DOM locators for panel close, default application, and model listing:

1. Find a `role="radiogroup"` with radio controls, then walk outward to the smallest ancestor containing the four live tablists and two model menu triggers.
2. Identify aspect tablists by `crop_16_9`. The image section is the one also containing `crop_landscape` / the `LANDSCAPE_4_3` tab; the remaining aspect section is video.
3. Find the close control by walking from the settings content to the nearest ancestor containing an `arrow_back` button.
4. Find the save action structurally as the visible plain button in the settings content after excluding radio/tab/menu/icon controls.

Do not use section labels, Save text, account locale, styled-components class names, geometry, or translated ARIA labels. The generated page scripts serialize the shared locators into local constants before use.

### Locale-invariant generated media

Accept an image only when its media redirect URL contains a UUID and the image is inside a Flow project edit link (`/tools/flow/project/…/edit/…`, allowing an optional locale segment such as `/ko/`). Remove translated-alt and size fallbacks. This keeps the Korean and English generated cards while rejecting the large character preview and library thumbnail present in the real dumps.

## Error handling

- Scene reconciliation failure returns before any mode switch, prompt injection, pending generation, or submit click.
- Ambiguous composer toggle candidates return `null`; the existing `ensureAgentOff`/`ensureAgentOn` diagnostic path records the candidates and fails closed.
- Settings application remains best-effort at its existing callers, but it can now find and drive the panel without account-language assumptions.
- Media scanning prefers omission over assigning a reference/library asset as a new generation result.

## Tests

- Check in focused fixtures extracted verbatim from the supplied English and Korean dump `bodyHtml` values.
- Exercise `findAgentToggle`, `AGENT_TOGGLE_SELECTOR`, and diagnostics with real English/Korean composer markup, a Japanese label variant, and two-candidate ambiguity cases.
- Exercise `AGENT_SETTINGS_CLOSE_SELECTOR` and both settings page-script builders against the real English settings subtree.
- Exercise `GENERATED_IMG_PROBE` against real English and Korean generated cards plus their real reference/preview neighbors.
- Add scene IPC tests proving OFF and ON reconciliation failures return before submission, plus success-path ordering.
- Keep the round-3 mention fixtures unchanged and run the complete `npm run test:run` suite.

