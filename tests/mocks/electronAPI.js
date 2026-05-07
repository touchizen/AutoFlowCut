/**
 * Electron API Mock — window.electronAPI 전체 mock
 */
import { vi } from 'vitest'

export const mockElectronAPI = {
  // File system
  selectWorkFolder: vi.fn(),
  checkFolderExists: vi.fn(),
  listProjects: vi.fn(),
  getProjectFolder: vi.fn(),
  getResourceFolder: vi.fn(),
  saveResource: vi.fn(),
  readResource: vi.fn(),
  readFileByPath: vi.fn(),
  getHistory: vi.fn(),
  restoreFromHistory: vi.fn(),
  readHistoryFile: vi.fn(),
  saveToHistory: vi.fn(),
  deleteHistory: vi.fn(),
  saveProjectData: vi.fn(),
  loadProjectData: vi.fn(),
  projectExists: vi.fn(),
  renameProject: vi.fn(),

  // DOM automation
  domScanImages: vi.fn(),
  domBlobToBase64: vi.fn(),
  domSendPrompt: vi.fn(),
  domClickEnterTool: vi.fn(),
  domSetAspectRatio: vi.fn(),
  domNavigate: vi.fn(),
  domGetUrl: vi.fn(),
  domSnapshotBlobs: vi.fn(),
  domShowWhisk: vi.fn(),

  // App lifecycle
  setLayout: vi.fn(),
  openCapcut: vi.fn(),
  getAppVersion: vi.fn(),
  saveSrtFile: vi.fn(),
}

export function resetElectronAPI() {
  Object.values(mockElectronAPI).forEach(fn => {
    if (typeof fn.mockReset === 'function') fn.mockReset()
  })
}

// Install on window — node-env tests skip this (no DOM, no electronAPI usage).
if (typeof window !== 'undefined') {
  Object.defineProperty(window, 'electronAPI', {
    value: mockElectronAPI,
    writable: true,
    configurable: true
  })
}
