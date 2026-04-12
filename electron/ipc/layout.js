/**
 * Layout IPC — 레이아웃 모드 변경, Flow 뷰 bounds 관리, 모달 가시성
 */

import { powerSaveBlocker, shell } from 'electron'

let layoutMode = 'split-left'
let splitRatio = 0.5
let modalVisible = false
let powerSaveBlockerId = null

/**
 * Flow WebContentsView 위치/크기를 현재 레이아웃에 맞게 업데이트
 * @param {BrowserWindow} mainWindow
 * @param {WebContentsView} flowView
 */
export function updateBounds(mainWindow, flowView) {
  if (!mainWindow || !flowView) return

  if (modalVisible) {
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

  ipcMain.handle('app:get-layout', () => {
    return { mode: layoutMode, splitRatio }
  })

  ipcMain.handle('app:set-modal-visible', (event, { visible }) => {
    modalVisible = visible
    updateBounds(getMainWindow(), getFlowView())
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

  // Open external URL
  ipcMain.handle('app:open-external', (event, { url }) => {
    shell.openExternal(url)
    return { success: true }
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
