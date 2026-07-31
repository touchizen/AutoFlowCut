import { contextBridge, ipcRenderer, webUtils } from 'electron'

contextBridge.exposeInMainWorld('electronAPI', {
  // App
  openExternal: (url) => ipcRenderer.invoke('app:open-external', { url }),
  showInFolder: (filePath) => ipcRenderer.invoke('app:show-in-folder', { filePath }),
  notifyOS: (payload) => ipcRenderer.invoke('notify:os', payload),

  // Layout
  setLayout: (params) => ipcRenderer.invoke('app:set-layout', params),
  updateSplit: (params) => ipcRenderer.invoke('app:update-split', params),
  flowDragStart: () => ipcRenderer.invoke('app:flow-drag-start'),
  flowDragEnd: () => ipcRenderer.invoke('app:flow-drag-end'),
  getLayout: () => ipcRenderer.invoke('app:get-layout'),
  onLayoutChanged: (callback) => {
    const handler = (_, data) => callback(data)
    ipcRenderer.on('layout-changed', handler)
    return () => ipcRenderer.removeListener('layout-changed', handler)
  },
  setModalVisible: (params) => ipcRenderer.invoke('app:set-modal-visible', params),
  // 렌더러 언어 → 네이티브 메뉴 라벨 현지화
  setLocale: (params) => ipcRenderer.invoke('app:set-locale', params),
  // Flow Agent(Maps 그라운딩) 모드 on/off → main 상태 (generate 핸들러가 분기)
  setFlowAgentMode: (params) => ipcRenderer.invoke('flow:set-agent-mode', params),

  // Native menu (File → New Project / Recent Projects)
  onMenuAction: (callback) => {
    const handler = (_, data) => callback(data)
    ipcRenderer.on('menu:action', handler)
    return () => ipcRenderer.removeListener('menu:action', handler)
  },
  notifyProjectActivated: (name, workFolder) => ipcRenderer.invoke('app:project-activated', { name, workFolder }),

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
  getResourcePath: (params) => ipcRenderer.invoke('fs:get-resource-path', params),
  readFileByPath: (params) => ipcRenderer.invoke('fs:read-file-by-path', params),
  saveProjectData: (params) => ipcRenderer.invoke('fs:save-project-data', params),
  mergeProjectData: (params) => ipcRenderer.invoke('fs:merge-project-data', params),
  loadProjectData: (params) => ipcRenderer.invoke('fs:load-project-data', params),
  projectExists: (params) => ipcRenderer.invoke('fs:project-exists', params),
  renameProject: (params) => ipcRenderer.invoke('fs:rename-project', params),
  deleteProject: (params) => ipcRenderer.invoke('fs:delete-project', params),
  getHistory: (params) => ipcRenderer.invoke('fs:get-history', params),
  readHistoryFile: (params) => ipcRenderer.invoke('fs:read-history-file', params),
  readHistoryMetadata: (params) => ipcRenderer.invoke('fs:read-history-metadata', params),
  restoreFromHistory: (params) => ipcRenderer.invoke('fs:restore-from-history', params),
  saveToHistory: (params) => ipcRenderer.invoke('fs:save-to-history', params),
  deleteHistory: (params) => ipcRenderer.invoke('fs:delete-history', params),
  saveStyleThumbnail: (params) => ipcRenderer.invoke('fs:save-style-thumbnail', params),
  loadStyleThumbnails: () => ipcRenderer.invoke('fs:load-style-thumbnails'),
  checkStyleThumbnails: () => ipcRenderer.invoke('fs:check-style-thumbnails'),
  deleteStyleThumbnail: (params) => ipcRenderer.invoke('fs:delete-style-thumbnail', params),
  scanAudioPackage: () => ipcRenderer.invoke('fs:scan-audio-package'),
  rescanAudioPackage: (params) => ipcRenderer.invoke('fs:rescan-audio-package', params),
  probeAudioFile: (params) => ipcRenderer.invoke('fs:probe-audio-file', params),
  copyDroppedAudio: (params) => ipcRenderer.invoke('fs:copy-dropped-audio', params),
  // Electron 36에서 File.path는 deprecated → webUtils.getPathForFile 사용
  getPathForFile: (file) => webUtils.getPathForFile(file),
  readFileAbsolute: (params) => ipcRenderer.invoke('fs:read-file-absolute', params),
  writeFileAbsolute: (params) => ipcRenderer.invoke('fs:write-file-absolute', params),

  // CapCut
  detectCapcutPath: () => ipcRenderer.invoke('capcut:detect-path'),
  checkCapcutInstalled: () => ipcRenderer.invoke('capcut:check-installed'),
  getNextProjectNumber: (params) => ipcRenderer.invoke('capcut:next-number', params),
  writeCapcutProject: (params) => ipcRenderer.invoke('capcut:write-project', params),
  writeSrtToWorkFolder: (params) => ipcRenderer.invoke('capcut:write-srt-to-workfolder', params),
  openCapcut: () => ipcRenderer.invoke('capcut:open-app'),
  saveSrtFile: (params) => ipcRenderer.invoke('capcut:save-srt-file', params),
  getSystemInfo: () => ipcRenderer.invoke('capcut:get-system-info'),
  getVolumePath: () => ipcRenderer.invoke('capcut:get-volume-path'),

  // Premiere (.prproj — gzipped XML)
  writePremiereProject: (params) => ipcRenderer.invoke('premiere:write-project', params),
  checkPremiereInstalled: () => ipcRenderer.invoke('premiere:check-installed'),
  openPremiereProject: (params) => ipcRenderer.invoke('premiere:open-project', params),

  // Vrew (.vrew — ZIP archive)
  writeVrewProject: (params) => ipcRenderer.invoke('vrew:write-project', params),
  openVrewProject: (params) => ipcRenderer.invoke('vrew:open-project', params),
  checkVrewInstalled: () => ipcRenderer.invoke('vrew:check-installed'),

  // MCP (Claude Code integration)
  mcpStatus: () => ipcRenderer.invoke('mcp:status'),
  mcpRegister: () => ipcRenderer.invoke('mcp:register'),
  mcpUnregister: () => ipcRenderer.invoke('mcp:unregister'),
  skillsList: () => ipcRenderer.invoke('skills:list'),
  skillsInstall: (params) => ipcRenderer.invoke('skills:install', params),
  skillsUninstall: (params) => ipcRenderer.invoke('skills:uninstall', params),

  // Google GenAI (BYOK) — official Imagen/Veo API, replaces Flow reverse-engineering.
  // Key management exposes only existence/validity to the renderer — never the key itself.
  genaiGetKeyStatus: () => ipcRenderer.invoke('genai:get-key-status'),
  genaiSetKey: (params) => ipcRenderer.invoke('genai:set-key', params),
  genaiClearKey: (params) => ipcRenderer.invoke('genai:clear-key', params),
  genaiValidateKey: (params) => ipcRenderer.invoke('genai:validate-key', params),
  genaiListModels: (params) => ipcRenderer.invoke('genai:list-models', params),
  genaiListProviders: () => ipcRenderer.invoke('genai:list-providers'),
  genaiGenerateImage: (params) => ipcRenderer.invoke('genai:generate-image', params),
  genaiGenerateVideo: (params) => ipcRenderer.invoke('genai:generate-video', params),
  genaiCheckVideoStatus: (params) => ipcRenderer.invoke('genai:check-video-status', params),
  genaiDownloadVideo: (params) => ipcRenderer.invoke('genai:download-video', params),

  // --- TTS provider keys + voices (M2a-3b) — 평문 키는 renderer로 반환하지 않는다 ---
  keysStatus: (params) => ipcRenderer.invoke('keys:status', params),
  keysSet: (params) => ipcRenderer.invoke('keys:set', params),
  keysDelete: (params) => ipcRenderer.invoke('keys:delete', params),
  ttsListVoices: (params) => ipcRenderer.invoke('tts:list-voices', params),
  ttsPreviewVoice: (params) => ipcRenderer.invoke('tts:preview-voice', params),
  ttsTagVoiceGender: (params) => ipcRenderer.invoke('tts:tag-voice-gender', params),

  // --- Story pipeline ---
  storyOpen: (params) => ipcRenderer.invoke('story:open', params),
  storyGetState: (params) => ipcRenderer.invoke('story:get-state', params),
  storyStart: (params) => ipcRenderer.invoke('story:start', params),
  storyAbort: (params) => ipcRenderer.invoke('story:abort', params),
  storyPushAck: (params) => ipcRenderer.invoke('story:push-ack', params),
  storyGenerateTitle: (params) => ipcRenderer.invoke('story:generate-title', params),
  storyGenerateSynopsis: (params) => ipcRenderer.invoke('story:generate-synopsis', params),
  storyReviewSynopsis: (params) => ipcRenderer.invoke('story:review-synopsis', params),
  storyConfirmSynopsis: (params) => ipcRenderer.invoke('story:confirm-synopsis', params),
  storyTtsPreview: (params) => ipcRenderer.invoke('story:tts-preview', params),
  storyAudioPreflight: (params) => ipcRenderer.invoke('story:audio-preflight', params),
  // SRT 가져오기 — 나레이션 오디오를 TTS로 만들지, 완성된 mp3에서 잘라 쓸지.
  storyPickAudioImportFile: (params) => ipcRenderer.invoke('story:pick-audio-import-file', params),
  storyLoadAudioPackage: (projectPath) => ipcRenderer.invoke('story:load-audio-package', { projectPath }),
  storyListLlmOptions: () => ipcRenderer.invoke('story:list-llm-options'),
  // 리서치 side actions (spec §5) — 진행(research-fetch)은 기존 story:progress 채널 재사용.
  storyResearchSearch: (params) => ipcRenderer.invoke('story:research-search', params),
  storyResearchFetch: (params) => ipcRenderer.invoke('story:research-fetch', params),
  storyResearchAnalyze: (params) => ipcRenderer.invoke('story:research-analyze', params),
  storyResearchFactCheck: (params) => ipcRenderer.invoke('story:research-factcheck', params),
  storyResearchCommit: (params) => ipcRenderer.invoke('story:research-commit', params),
  storyResearchSkip: (params) => ipcRenderer.invoke('story:research-skip', params),
  storyResearchSelect: (params) => ipcRenderer.invoke('story:research-select', params),
  storyResearchVideoDetails: (params) => ipcRenderer.invoke('story:research-video-details', params),
  onStoryEvent: (channel, cb) => {
    const valid = ['story:state', 'story:delta', 'story:progress', 'story:pushScenes', 'story:pushCharacters', 'story:synopsis-delta', 'story:research-state', 'story:usage']
    if (!valid.includes(channel)) return () => {}
    const listener = (_e, payload) => cb(payload)
    ipcRenderer.on(channel, listener)
    return () => ipcRenderer.removeListener(channel, listener)
  },

  // Auth
  googleSignIn: () => ipcRenderer.invoke('auth:google-sign-in'),
  googleSignOut: () => ipcRenderer.invoke('auth:google-sign-out'),

  // Power Save
  setPreventSleep: (params) => ipcRenderer.invoke('app:set-prevent-sleep', params),
  getPreventSleep: () => ipcRenderer.invoke('app:get-prevent-sleep'),

  // MCP HTTP Server
  startMcpHttp: (params) => ipcRenderer.invoke('mcp:start-http', params),
  stopMcpHttp: () => ipcRenderer.invoke('mcp:stop-http'),
  onMcpUpdate: (callback) => {
    const handler = (_, data) => callback(data)
    ipcRenderer.on('mcp-update', handler)
    return () => ipcRenderer.removeListener('mcp-update', handler)
  },

  // Route controller — canonical {mode, sessionTarget} route (route:set handler in electron/ipc/mode.js).
  setRoute: (params) => ipcRenderer.invoke('route:set', params),
  onRouteQuiesceRequest: (callback) => {
    const handler = (_, request) => callback(request)
    ipcRenderer.on('route:quiesce-request', handler)
    return () => ipcRenderer.removeListener('route:quiesce-request', handler)
  },
  sendRouteQuiesceReceipt: (payload) => ipcRenderer.send('route:quiesce-receipt', payload),
  // Mode controller — attaches/detaches Flow WebContentsView (mode:set handler in electron/ipc/mode.js).
  // Restored: was dropped during M4 T5 preload rewrite (review C1).
  setMode: (params) => ipcRenderer.invoke('mode:set', params),

  // Flow DOM automation bridges (Flow mode)
  flowExtractToken: () => ipcRenderer.invoke('flow:extract-token'),
  flowValidateToken: (payload) => ipcRenderer.invoke('flow:validate-token', payload),
  flowExtractProjectId: (opts) => ipcRenderer.invoke('flow:extract-project-id', opts),
  flowGenerateImage: (payload) => ipcRenderer.invoke('flow:generate-image', payload),
  flowCheckGeneration: (payload) => ipcRenderer.invoke('flow:check-generation', payload),
  flowCollectGeneration: (payload) => ipcRenderer.invoke('flow:collect-generation', payload),
  flowClearGenerations: () => ipcRenderer.invoke('flow:clear-generations'),
  flowUploadReference: (payload) => ipcRenderer.invoke('flow:upload-reference', payload),
  flowGenerateCharacter: (payload) => ipcRenderer.invoke('flow:generate-character', payload),
  flowRerollCharacter: (payload) => ipcRenderer.invoke('flow:reroll-character', payload),
  flowUploadCharacterEntity: (payload) => ipcRenderer.invoke('flow:upload-character-entity', payload),
  flowFetchMedia: (payload) => ipcRenderer.invoke('flow:fetch-media', payload),
  flowGenerateVideoT2V: (payload) => ipcRenderer.invoke('flow:generate-video-t2v', payload),
  flowGenerateVideoI2V: (payload) => ipcRenderer.invoke('flow:generate-video-i2v', payload),
  flowCheckVideoStatus: (payload) => ipcRenderer.invoke('flow:check-video-status', payload),
  flowDownloadVideoUrl: (payload) => ipcRenderer.invoke('flow:download-video-url', payload),
  flowDomDownloadVideo: (payload) => ipcRenderer.invoke('flow:dom-download-video', payload),
  flowUpscaleVideo: (payload) => ipcRenderer.invoke('flow:upscale-video', payload),
  flowUpscaleImage: (payload) => ipcRenderer.invoke('flow:upscale-image', payload),
  flowFetchGallery: (payload) => ipcRenderer.invoke('flow:fetch-gallery', payload),
  flowListProjects: (payload) => ipcRenderer.invoke('flow:list-projects', payload),
  flowGenerateScene: (payload) => ipcRenderer.invoke('flow:generate-scene', payload),
  refreshFlowComposer: (payload) => ipcRenderer.invoke('flow:refresh-composer', payload),  // #R33: 등록/동기화 후 SPA 새로고침
  renameFlowCharacter: (payload) => ipcRenderer.invoke('flow:rename-character', payload),  // #R34: 기존 entity displayName 재동기화(이름 변경)
  flowRegisterCharacterEntity: (payload) => ipcRenderer.invoke('flow:register-character-entity', payload),  // #R37: 재업로드 없이 등록 PATCH 만 복구
  setStartupProject: (params) => ipcRenderer.invoke('flow:set-startup-project', params),
  openFlowProject: (params) => ipcRenderer.invoke('flow:open-project', params),
  newFlowProject: () => ipcRenderer.invoke('flow:new-project'),
  dumpFlowSettings: () => ipcRenderer.invoke('flow:dump-settings'),  // 진단: 에이전트 설정 패널 DOM 덤프
  listFlowAgentModels: () => ipcRenderer.invoke('flow:list-agent-models'),  // 동적 이미지/비디오 모델 목록
  onFlowStatus: (cb) => {
    // 반환된 unsubscribe 를 useEffect cleanup 에서 호출해야 listener leak 안 됨.
    // 미반환 시 HMR / 재마운트 때마다 listener 누적 → MaxListenersExceededWarning.
    const handler = (_, data) => cb(data)
    ipcRenderer.on('flow-status', handler)
    return () => ipcRenderer.removeListener('flow-status', handler)
  },
})
