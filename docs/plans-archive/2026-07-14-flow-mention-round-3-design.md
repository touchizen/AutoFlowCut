# Flow Mention Round-3 Design

## Goal

Align Flow mention selection with the captured English picker and Slate mention-chip DOM while preserving the working Korean legacy forms and preventing same-name image selection from the All tab.

## Observed contract

- Picker option names come from the exact `img[alt]` value or the concatenation of all non-terminal text leaves. Whole-row text is only a candidate when the row has no element leaves.
- A real mention chip is a `data-slate-void="true"` element whose name is a bare text node. Its whole `textContent` can contain NBSP and BOM/zero-width whitespace, but it has no `@` or type label.
- The character tab is primarily identified by the `accessibility_new` ligature. `/캐릭터|characters?/i` is only a fallback for a future ligature rename.
- A dispatched tab click is successful only if the same tab reports `aria-selected="true"` or an active `data-state` afterward.
- Flow locale is exposed through `document.documentElement.lang`; the project URL has no locale segment.

## Matching and failure design

Option matching remains exact. It deliberately removes per-leaf candidates, so a hypothetical split name such as `회사원` + `3` can only match `회사원3`, never the prefix `회사원`. The mandatory activated character tab remains the type boundary because image and character rows are structurally identical and can have the same caption and alt.

Chip verification uses only the chip's whole `textContent`. It compares normalized and whitespace-stripped forms exactly, allowing an optional leading `@` and retaining the original Korean `캐릭터` suffix forms. It deliberately removes every leaf-based shortcut because the observed chip name is a bare text node and leaf shortcuts admit prefix collisions.

When option polling completed but found nothing, a successful probe that reports no dialog yields `picker-closed-before-selection`. A probe evaluation failure is distinct and leaves the legitimate result as `option-not-found`. Diagnostic output keeps `documentLang` and removes dead `pathLocale`; it never includes user-authored text.

## Testing

Tests evaluate the exported injection strings through indirect `(0, eval)`. New regressions cover split-leaf prefix collisions, whitespace-bearing legacy chips, chip near-misses, non-activating tab clicks, label fallback activation, a same-name image exposed on the All tab, probe failure routing, and the real locale-less Flow URL. The captured `실측 DOM (라이브 영어 Flow)` fixtures remain intact.
