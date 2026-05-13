# CapCut Installation Check Before Export

## Problem

When a user clicks Export but CapCut is not installed, the export writes project files to a non-existent CapCut directory, then fails to launch CapCut with only a vague warning toast. Users should be informed upfront and guided to install CapCut.

## Solution

Add a `capcut:check-installed` IPC that checks for the CapCut app executable (not project folders). On Export button click, if CapCut is not installed (and path preset is not "custom"), show a confirm dialog asking the user to download CapCut. If confirmed, open `capcut.com/download` in the default browser.

## Flow

```
Export button click (ExportModal.handleExport)
  -> path validation (existing)
  -> if pathPreset !== 'custom':
       -> capcut:check-installed IPC
       -> not installed: confirm dialog -> open capcut.com/download -> return
       -> installed: continue
  -> existing export logic
```

## Changes

### 1. `electron/ipc/capcut.js` — New IPC handler

`capcut:check-installed`: Reuses app path logic from `capcut:open-app`.

- macOS: Check `/Applications/CapCut.app`, `/Applications/CapCut Pro.app`
- Windows: Check exe paths in LocalAppData, ProgramFiles, ProgramFiles(x86)
- Returns `{ installed: true/false }`

### 2. `electron/preload.js` — Expose new API

Add `checkCapcutInstalled` to electronAPI.

### 3. `src/components/ExportModal.jsx` — Pre-export check

In `handleExport`, after path validation:
- If `pathPreset !== 'custom'`, call `checkCapcutInstalled()`
- If not installed, `window.confirm(t('exportModal.capcutNotInstalled'))`
- If user confirms, `window.electronAPI.openExternal('https://www.capcut.com/download')`
- Return (do not proceed with export)

### 4. `src/locales/en.js` and `ko.js` — i18n strings

Key: `exportModal.capcutNotInstalled`

- EN: `"CapCut is not installed. Would you like to download it?"`
- KO: `"CapCut이 설치되어 있지 않습니다. 다운로드하시겠습니까?"`

## Notes

- Custom path users skip the check (they may have CapCut in a non-standard location)
- The check is lightweight (file existence only, no process launch)
- `capcut:open-app` already has the same path lists; we extract a shared helper
