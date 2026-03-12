import { contextBridge, ipcRenderer } from 'electron'

contextBridge.exposeInMainWorld('electronAPI', {
  // App
  openExternal: (url) => ipcRenderer.invoke('app:open-external', { url }),
  showInFolder: (filePath) => ipcRenderer.invoke('app:show-in-folder', { filePath }),
  onFlowStatus: (callback) => ipcRenderer.on('flow-status', (_, data) => callback(data)),

  // Layout
  setLayout: (params) => ipcRenderer.invoke('app:set-layout', params),
  updateSplit: (params) => ipcRenderer.invoke('app:update-split', params),
  getLayout: () => ipcRenderer.invoke('app:get-layout'),
  onLayoutChanged: (callback) => ipcRenderer.on('layout-changed', (_, data) => callback(data)),
  setModalVisible: (params) => ipcRenderer.invoke('app:set-modal-visible', params),

  // Flow API
  extractToken: () => ipcRenderer.invoke('flow:extract-token'),
  extractProjectId: () => ipcRenderer.invoke('flow:extract-project-id'),
  validateToken: (params) => ipcRenderer.invoke('flow:validate-token', params),
  generateImage: (params) => ipcRenderer.invoke('flow:generate-image', params),
  fetchMedia: (params) => ipcRenderer.invoke('flow:fetch-media', params),
  uploadReference: (params) => ipcRenderer.invoke('flow:upload-reference', params),

  // Flow Video API
  generateVideoT2V: (params) => ipcRenderer.invoke('flow:generate-video-t2v', params),
  generateVideoI2V: (params) => ipcRenderer.invoke('flow:generate-video-i2v', params),
  checkVideoStatus: (params) => ipcRenderer.invoke('flow:check-video-status', params),
  downloadVideoUrl: (params) => ipcRenderer.invoke('flow:download-video-url', params),
  domDownloadVideo: (params) => ipcRenderer.invoke('flow:dom-download-video', params),

  // File System
  getDefaultWorkFolder: () => ipcRenderer.invoke('fs:get-default-work-folder'),
  getSavedWorkFolder: () => ipcRenderer.invoke('fs:get-saved-work-folder'),
  saveWorkFolder: (params) => ipcRenderer.invoke('fs:save-work-folder', params),
  selectWorkFolder: () => ipcRenderer.invoke('fs:select-work-folder'),
  checkFolderExists: (params) => ipcRenderer.invoke('fs:check-folder-exists', params),
  listProjects: (params) => ipcRenderer.invoke('fs:list-projects', params),
  getProjectFolder: (params) => ipcRenderer.invoke('fs:get-project-folder', params),
  getResourceFolder: (params) => ipcRenderer.invoke('fs:get-resource-folder', params),
  saveResource: (params) => ipcRenderer.invoke('fs:save-resource', params),
  readResource: (params) => ipcRenderer.invoke('fs:read-resource', params),
  readFileByPath: (params) => ipcRenderer.invoke('fs:read-file-by-path', params),
  saveProjectData: (params) => ipcRenderer.invoke('fs:save-project-data', params),
  loadProjectData: (params) => ipcRenderer.invoke('fs:load-project-data', params),
  projectExists: (params) => ipcRenderer.invoke('fs:project-exists', params),
  renameProject: (params) => ipcRenderer.invoke('fs:rename-project', params),
  deleteProject: (params) => ipcRenderer.invoke('fs:delete-project', params),
  getHistory: (params) => ipcRenderer.invoke('fs:get-history', params),
  readHistoryFile: (params) => ipcRenderer.invoke('fs:read-history-file', params),
  restoreFromHistory: (params) => ipcRenderer.invoke('fs:restore-from-history', params),
  saveToHistory: (params) => ipcRenderer.invoke('fs:save-to-history', params),
  deleteHistory: (params) => ipcRenderer.invoke('fs:delete-history', params),

  // CapCut
  detectCapcutPath: () => ipcRenderer.invoke('capcut:detect-path'),
  checkCapcutInstalled: () => ipcRenderer.invoke('capcut:check-installed'),
  getNextProjectNumber: (params) => ipcRenderer.invoke('capcut:next-number', params),
  writeCapcutProject: (params) => ipcRenderer.invoke('capcut:write-project', params),
  openCapcut: () => ipcRenderer.invoke('capcut:open-app'),
  saveSrtFile: (params) => ipcRenderer.invoke('capcut:save-srt-file', params),
  getSystemInfo: () => ipcRenderer.invoke('capcut:get-system-info'),

  // Flow DOM Mode
  domNavigate: (params) => ipcRenderer.invoke('flow:dom-navigate', params),
  domGetUrl: () => ipcRenderer.invoke('flow:dom-get-url'),
  domClickEnterTool: (params) => ipcRenderer.invoke('flow:dom-click-enter-tool', params),
  domSetAspectRatio: (params) => ipcRenderer.invoke('flow:dom-set-aspect-ratio', params),
  domSendPrompt: (params) => ipcRenderer.invoke('flow:dom-send-prompt', params),
  domSnapshotBlobs: () => ipcRenderer.invoke('flow:dom-snapshot-blobs'),
  domScanImages: (params) => ipcRenderer.invoke('flow:dom-scan-images', params),
  domBlobToBase64: (params) => ipcRenderer.invoke('flow:dom-blob-to-base64', params),
  domShowFlow: () => ipcRenderer.invoke('flow:dom-show-flow'),

  // Auth
  googleSignIn: () => ipcRenderer.invoke('auth:google-sign-in'),
  googleSignOut: () => ipcRenderer.invoke('auth:google-sign-out')
})
