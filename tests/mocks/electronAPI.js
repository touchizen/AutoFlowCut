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
  domNavigate: vi.fn(),
  domGetUrl: vi.fn(),
  domSnapshotBlobs: vi.fn(),
  domShowWhisk: vi.fn(),

  // App lifecycle
  setLayout: vi.fn(),
  openCapcut: vi.fn(),
  checkCapcutInstalled: vi.fn(),
  getAppVersion: vi.fn(),
  saveSrtFile: vi.fn(),
  openExternal: vi.fn(),
  writeVrewProject: vi.fn(),
  openVrewProject: vi.fn(),
  writePremiereProject: vi.fn(),
  checkPremiereInstalled: vi.fn(),
  openPremiereProject: vi.fn(),

  // Google GenAI (BYOK)
  genaiGetKeyStatus: vi.fn(),
  genaiSetKey: vi.fn(),
  genaiClearKey: vi.fn(),
  genaiValidateKey: vi.fn(),
  genaiListModels: vi.fn(),
  genaiGenerateImage: vi.fn(),
  genaiGenerateVideo: vi.fn(),
  genaiCheckVideoStatus: vi.fn(),
  genaiDownloadVideo: vi.fn(),

  // TTS provider keys + voices (M2a-3b)
  keysStatus: vi.fn(),
  keysSet: vi.fn(),
  keysDelete: vi.fn(),
  ttsListVoices: vi.fn(),
  storyListLlmOptions: vi.fn(),
  readFileAbsolute: vi.fn(),

  // In-app agent — preload 가 항상 노출하는 표면이라 App 을 렌더하는 어떤 테스트든 필요하다
  // (ChatPanel 이 mount 에서 구독한다). 구독형은 반드시 **dispose 함수**를 돌려줘야 한다 —
  // ChatPanel 의 cleanup 이 `disposers.forEach(d => d())` 로 부른다.
  agentSessionOpen: vi.fn(),
  agentSend: vi.fn(),
  agentSteer: vi.fn(),
  agentAbort: vi.fn(),
  agentSessionClose: vi.fn(),
  agentStatus: vi.fn(),
  agentListModels: vi.fn(),
  onAgentEvent: vi.fn(() => () => {}),
  onToolBridgeRequest: vi.fn(() => () => {}),
  respondToolBridge: vi.fn(),
  emitToolBridgeEvent: vi.fn(),
  onAgentPermissionRequest: vi.fn(() => () => {}),
  onAgentPermissionCancel: vi.fn(() => () => {}),
  respondAgentPermission: vi.fn(),
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
