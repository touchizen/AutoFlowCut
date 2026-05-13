# CapCut Installation Check Before Export — Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Prevent users from exporting when CapCut is not installed; guide them to download it.

**Architecture:** Add a new `capcut:check-installed` IPC handler that checks for the CapCut app executable on disk. The ExportModal calls this before proceeding with export. If not installed, a confirm dialog offers to open the CapCut download page.

**Tech Stack:** Electron IPC, React (ExportModal.jsx), i18n (en.js/ko.js)

---

### Task 1: Extract shared helper `getCapcutAppPaths()` in capcut.js

**Files:**
- Modify: `electron/ipc/capcut.js:68-91` (add helper), `electron/ipc/capcut.js:234-303` (refactor open-app to use helper)

**Step 1: Add helper function after `getCapcutCandidatePaths()`**

Add this function at line ~92, before `registerCapcutIPC`:

```javascript
/**
 * Get CapCut application paths for the current platform.
 * Used by both check-installed and open-app handlers.
 */
function getCapcutAppPaths() {
  const platform = process.platform

  if (platform === 'darwin') {
    return [
      '/Applications/CapCut.app',
      '/Applications/CapCut Pro.app',
    ]
  } else if (platform === 'win32') {
    const localAppData = process.env.LOCALAPPDATA || path.join(os.homedir(), 'AppData', 'Local')
    const programFiles = process.env['ProgramFiles'] || 'C:\\Program Files'
    const programFilesX86 = process.env['ProgramFiles(x86)'] || 'C:\\Program Files (x86)'

    return [
      path.join(localAppData, 'CapCut', 'Apps', 'CapCut.exe'),
      path.join(localAppData, 'Programs', 'CapCut', 'CapCut.exe'),
      path.join(programFiles, 'CapCut', 'CapCut.exe'),
      path.join(programFilesX86, 'CapCut', 'CapCut.exe'),
    ]
  }

  return []
}
```

**Step 2: Commit**

```bash
git add electron/ipc/capcut.js
git commit -m "refactor: extract getCapcutAppPaths() helper in capcut.js"
```

---

### Task 2: Add `capcut:check-installed` IPC handler

**Files:**
- Modify: `electron/ipc/capcut.js` (add new handler inside `registerCapcutIPC`)

**Step 1: Add the handler after `capcut:detect-path` (after line ~124)**

```javascript
  // ----------------------------------------------------------
  // 1.5. capcut:check-installed
  //
  // Check if CapCut application is installed on the system.
  // Checks app executable paths (not project folders).
  // ----------------------------------------------------------
  ipcMain.handle('capcut:check-installed', async () => {
    try {
      const platform = process.platform

      if (platform === 'darwin') {
        // macOS: also try `open -a` which checks Launch Services
        const appNames = ['CapCut', 'CapCut Pro']
        for (const appName of appNames) {
          try {
            // mdfind is faster and doesn't launch the app
            await execPromise(`mdfind "kMDItemCFBundleIdentifier == 'com.lemon.lv'" | head -1`)
            return { installed: true }
          } catch { /* continue */ }
        }

        // Fallback: check /Applications directly
        const appPaths = getCapcutAppPaths()
        for (const appPath of appPaths) {
          if (await pathExists(appPath)) {
            return { installed: true }
          }
        }

        return { installed: false }
      } else if (platform === 'win32') {
        const exePaths = getCapcutAppPaths()
        for (const exePath of exePaths) {
          if (await pathExists(exePath)) {
            return { installed: true }
          }
        }
        return { installed: false }
      }

      // Unknown platform — assume installed to not block
      return { installed: true }
    } catch (error) {
      console.warn('[capcut:check-installed] Error:', error.message)
      // On error, don't block the user
      return { installed: true }
    }
  })
```

**Step 2: Commit**

```bash
git add electron/ipc/capcut.js
git commit -m "feat: add capcut:check-installed IPC handler"
```

---

### Task 3: Expose in preload.js

**Files:**
- Modify: `electron/preload.js:44-49`

**Step 1: Add `checkCapcutInstalled` to the CapCut section**

After line 45 (`detectCapcutPath`), add:

```javascript
  checkCapcutInstalled: () => ipcRenderer.invoke('capcut:check-installed'),
```

The CapCut section should look like:

```javascript
  // CapCut
  detectCapcutPath: () => ipcRenderer.invoke('capcut:detect-path'),
  checkCapcutInstalled: () => ipcRenderer.invoke('capcut:check-installed'),
  getNextProjectNumber: (params) => ipcRenderer.invoke('capcut:next-number', params),
  writeCapcutProject: (params) => ipcRenderer.invoke('capcut:write-project', params),
  openCapcut: () => ipcRenderer.invoke('capcut:open-app'),
  saveSrtFile: (params) => ipcRenderer.invoke('capcut:save-srt-file', params),
  getSystemInfo: () => ipcRenderer.invoke('capcut:get-system-info'),
```

**Step 2: Commit**

```bash
git add electron/preload.js
git commit -m "feat: expose checkCapcutInstalled in preload API"
```

---

### Task 4: Add i18n strings

**Files:**
- Modify: `src/locales/en.js:513-516` (exportModalExtra section)
- Modify: `src/locales/ko.js:513-516` (exportModalExtra section)

**Step 1: Add key to en.js exportModalExtra**

```javascript
  exportModalExtra: {
    pathRequired: 'Export path is required.',
    autoDetected: 'auto-detected',
    capcutNotInstalled: 'CapCut is not installed. Would you like to download it?',
  },
```

**Step 2: Add key to ko.js exportModalExtra**

```javascript
  exportModalExtra: {
    pathRequired: '내보내기 경로가 필요합니다.',
    autoDetected: '자동 감지됨',
    capcutNotInstalled: 'CapCut이 설치되어 있지 않습니다. 다운로드하시겠습니까?',
  },
```

**Step 3: Commit**

```bash
git add src/locales/en.js src/locales/ko.js
git commit -m "i18n: add capcutNotInstalled message for en/ko"
```

---

### Task 5: Add install check to ExportModal.handleExport

**Files:**
- Modify: `src/components/ExportModal.jsx:150-179`

**Step 1: Make handleExport async and add install check**

Replace the `handleExport` function (lines 150-179):

```jsx
  const handleExport = async () => {
    // 필수 입력 검증
    if (!fullPath.trim()) {
      alert(t('exportModalExtra.pathRequired'))
      return
    }

    // CapCut 설치 확인 (Custom 경로가 아닌 경우에만)
    if (pathPreset !== 'custom' && window.electronAPI?.checkCapcutInstalled) {
      try {
        const result = await window.electronAPI.checkCapcutInstalled()
        if (!result.installed) {
          const wantDownload = window.confirm(t('exportModalExtra.capcutNotInstalled'))
          if (wantDownload) {
            window.electronAPI.openExternal('https://www.capcut.com/download')
          }
          return
        }
      } catch (err) {
        console.warn('[ExportModal] CapCut install check failed:', err)
        // Don't block export on check failure
      }
    }

    // 설정 저장
    saveSettings({
      pathPreset,
      scaleMode,
      includeSubtitle,
      kenBurns,
      kenBurnsMode,
      kenBurnsCycle: Number(kenBurnsCycle) || 5,
      kenBurnsScaleMin: Number(kenBurnsScaleMin) || 100,
      kenBurnsScaleMax: Number(kenBurnsScaleMax) || 130,
    })

    onExport({
      capcutProjectNumber: fullPath,
      scaleMode,
      kenBurns,
      kenBurnsMode,
      kenBurnsCycle: Number(kenBurnsCycle) || 5,
      kenBurnsScaleMin: Number(kenBurnsScaleMin) / 100 || 1.0,
      kenBurnsScaleMax: Number(kenBurnsScaleMax) / 100 || 1.15,
      subtitleOption: hasSubtitles && includeSubtitle ? 'ko' : 'none'
    })
  }
```

**Step 2: Commit**

```bash
git add src/components/ExportModal.jsx
git commit -m "feat: check CapCut installation before export, guide to download if missing"
```

---

### Task 6: Manual smoke test

**Step 1: Run dev server**

```bash
npm run dev
```

**Step 2: Test happy path**
- Open Export modal → click Export → should work as before (CapCut installed)

**Step 3: Test not-installed path**
- Temporarily rename `/Applications/CapCut.app` to `/Applications/CapCut.app.bak`
- Click Export → confirm dialog should appear
- Click OK → browser opens capcut.com/download
- Click Cancel → returns to modal
- Restore: rename `.bak` back

**Step 4: Test custom path bypass**
- Select "Custom" path preset → click Export → no install check (proceeds directly)
