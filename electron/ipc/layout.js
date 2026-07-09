/**
 * Layout IPC — 레이아웃 모드 변경, Flow 뷰 bounds 관리, 모달 가시성
 */

import { powerSaveBlocker, shell } from 'electron'

let layoutMode = 'split-left'
let splitRatio = 0.5
let modalVisible = false
// 드래그 중 Flow 뷰 접기(A′) — 네이티브 뷰가 마우스 이벤트를 가로채 리사이즈가 흔들리므로,
// 드래그 동안 Flow 를 0×0 으로 접고 렌더러가 정지 스냅샷을 대신 그린다. dragToken 은 캡처(async)
// 도중 drag-end 가 와서 Flow 가 접힌 채 남는 레이스를 막는다.
let dragging = false
let dragToken = 0
let powerSaveBlockerId = null

/**
 * Flow WebContentsView 위치/크기를 현재 레이아웃에 맞게 업데이트
 * @param {BrowserWindow} mainWindow
 * @param {WebContentsView} flowView
 */
export function updateBounds(mainWindow, flowView) {
  if (!mainWindow || !flowView) return

  if (modalVisible || dragging) {
    flowView.setBounds({ x: 0, y: 0, width: 0, height: 0 })
    return
  }

  const { width, height } = mainWindow.getContentBounds()
  const GAP = 3

  if (layoutMode === 'split-left') {
    const splitPos = Math.round(width * splitRatio)
    flowView.setBounds({ x: 0, y: 0, width: splitPos - GAP, height })
  } else if (layoutMode === 'split-right') {
    const splitPos = Math.round(width * splitRatio)
    flowView.setBounds({ x: width - splitPos + GAP, y: 0, width: splitPos - GAP, height })
  } else if (layoutMode === 'split-top') {
    const splitPos = Math.round(height * splitRatio)
    flowView.setBounds({ x: 0, y: 0, width, height: splitPos - GAP })
  } else if (layoutMode === 'split-bottom') {
    const splitPos = Math.round(height * splitRatio)
    flowView.setBounds({ x: 0, y: height - splitPos + GAP, width, height: splitPos - GAP })
  }
}

/**
 * 레이아웃 관련 IPC 핸들러 등록
 * @param {ipcMain} ipcMain
 * @param {Function} getMainWindow - mainWindow getter
 * @param {Function} getFlowView - flowView getter
 */
export function registerLayoutIPC(ipcMain, getMainWindow, getFlowView) {
  ipcMain.handle('app:set-layout', (event, { mode, ratio }) => {
    layoutMode = mode || 'split-left'
    if (ratio !== undefined) splitRatio = Math.max(0.2, Math.min(0.8, ratio))
    updateBounds(getMainWindow(), getFlowView())
    const mw = getMainWindow()
    if (mw) {
      mw.webContents.send('layout-changed', { mode: layoutMode, splitRatio })
    }
    return { success: true, mode: layoutMode, splitRatio }
  })

  ipcMain.handle('app:update-split', (event, { ratio }) => {
    if (!getMainWindow()) return
    splitRatio = Math.max(0.2, Math.min(0.8, ratio))
    updateBounds(getMainWindow(), getFlowView())
    return { success: true, splitRatio }
  })

  // A′: 드래그 시작 — Flow 를 스냅샷으로 뜬 뒤 0×0 으로 접어 흔들림을 없앤다. 렌더러가 이 스냅샷을
  //   DOM 으로 그려 드래그 중에도 Flow 가 그대로 있는 것처럼 보이게 한다. 접기 전에 캡처(0×0 캡처 방지).
  ipcMain.handle('app:flow-drag-start', async () => {
    const flowView = getFlowView()
    const token = ++dragToken
    let snapshot = null
    if (flowView) {
      try { snapshot = (await flowView.webContents.capturePage()).toDataURL() } catch { /* 캡처 실패 시 스냅샷 없이 접기만 */ }
    }
    // 캡처 도중 drag-end(또는 새 start)가 오면 token 이 바뀐다 → 접지 않는다(Flow 가 접힌 채 남는 것 방지).
    if (token !== dragToken) return { snapshot }
    dragging = true
    updateBounds(getMainWindow(), getFlowView())
    return { snapshot }
  })

  // A′: 드래그 종료 — 접기 해제 후 최종 비율로 Flow 복원. 진행 중인 start 의 지연 접기도 무효화(token++).
  ipcMain.handle('app:flow-drag-end', () => {
    dragToken++
    dragging = false
    updateBounds(getMainWindow(), getFlowView())
    return { success: true }
  })

  ipcMain.handle('app:get-layout', () => {
    return { mode: layoutMode, splitRatio }
  })

  ipcMain.handle('app:set-modal-visible', (event, { visible }) => {
    modalVisible = visible
    updateBounds(getMainWindow(), getFlowView())
    // 모달이 열릴 때 키보드 포커스를 메인 renderer로 되돌린다.
    // Flow WebContentsView를 0×0으로 줄여도 네이티브 포커스는 그대로 남아
    // (Electron은 뷰 간 포커스 자동 전환을 안 함), 모달 입력창에 키 입력이
    // 안 가는 현상이 생긴다 — 특히 Windows에서.
    if (visible) {
      getMainWindow()?.webContents?.focus()
    }
    return { success: true }
  })

  // 화면 꺼짐/절전 방지
  ipcMain.handle('app:set-prevent-sleep', (event, { enabled }) => {
    if (enabled) {
      if (powerSaveBlockerId === null || !powerSaveBlocker.isStarted(powerSaveBlockerId)) {
        powerSaveBlockerId = powerSaveBlocker.start('prevent-display-sleep')
      }
    } else {
      if (powerSaveBlockerId !== null && powerSaveBlocker.isStarted(powerSaveBlockerId)) {
        powerSaveBlocker.stop(powerSaveBlockerId)
        powerSaveBlockerId = null
      }
    }
    return { success: true, enabled }
  })

  ipcMain.handle('app:get-prevent-sleep', () => {
    return { enabled: powerSaveBlockerId !== null && powerSaveBlocker.isStarted(powerSaveBlockerId) }
  })

  // Open external URL — #R12-14: http/https/mailto 만 허용(렌더러가 보낸 임의 URL 로
  //   file://, javascript:, app-scheme 등이 shell.openExternal 로 새는 것을 막는다).
  ipcMain.handle('app:open-external', async (event, { url }) => {
    try {
      const parsed = new URL(String(url))
      const ALLOWED = ['http:', 'https:', 'mailto:']
      if (!ALLOWED.includes(parsed.protocol)) {
        console.warn('[Layout] open-external blocked (protocol):', parsed.protocol)
        return { success: false, error: 'protocol_not_allowed' }
      }
      // #R15-9: await — OS open 실패가 success 로 보고되거나 unhandled rejection 으로 새지 않게.
      await shell.openExternal(parsed.href)
      return { success: true }
    } catch (e) {
      console.warn('[Layout] open-external failed:', e?.message)
      return { success: false, error: e?.message || 'open_failed' }
    }
  })

  // Reveal file in Finder / Explorer
  ipcMain.handle('app:show-in-folder', (event, { filePath }) => {
    shell.showItemInFolder(filePath)
    return { success: true }
  })
}

export function getLayoutMode() { return layoutMode }
export function setLayoutMode(mode) { layoutMode = mode }
export function getSplitRatio() { return splitRatio }
export function setSplitRatio(ratio) { splitRatio = ratio }
export function getModalVisible() { return modalVisible }
export function setModalVisible(visible) { modalVisible = visible }
