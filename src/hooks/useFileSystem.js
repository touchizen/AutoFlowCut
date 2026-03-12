/**
 * File System API — Electron Desktop Edition
 *
 * Thin IPC wrapper that delegates all file I/O to the Electron main process
 * via window.electronAPI (preload bridge).
 *
 * Work folder path is stored in localStorage (key: 'workFolderPath').
 * Work folder display name is stored in localStorage (key: 'workFolderName').
 *
 * No IndexedDB. No File System Access API. No Blob/FileReader.
 * All heavy lifting happens in the main process.
 *
 * Folder structure (managed by main process):
 * {workFolder}/
 * └── {project}/
 *     ├── project.json
 *     ├── scenes/
 *     │   ├── scene_001.png (current file)
 *     │   └── history/
 *     │       └── scene_001_2026-01-27T14-30-00_flow.png
 *     ├── references/
 *     │   └── history/
 *     ├── videos/
 *     │   └── history/
 *     └── sfx/
 *         └── history/
 */

import { RESOURCE } from '../config/defaults'

export const fileSystemAPI = {
  // ==========================================
  // Folder Selection / Permission
  // ==========================================

  /**
   * Open native folder picker and set as work folder.
   * Stores the selected path and name in localStorage.
   */
  async selectWorkFolder() {
    try {
      const result = await window.electronAPI.selectWorkFolder()

      if (!result || result.canceled) {
        return { success: false, error: 'cancelled' }
      }

      // result: { path, name } from main process
      localStorage.setItem('workFolderPath', result.path)
      localStorage.setItem('workFolderName', result.name)

      // config 파일에도 영속 저장 (localStorage 유실 대비)
      try {
        await window.electronAPI.saveWorkFolder({ workFolderPath: result.path, workFolderName: result.name })
      } catch {}

      return {
        success: true,
        name: result.name,
        hasPermission: true
      }
    } catch (error) {
      return { success: false, error: error.message }
    }
  },

  /**
   * Get the currently configured work folder from localStorage.
   */
  async getWorkFolder() {
    const path = localStorage.getItem('workFolderPath')
    const name = localStorage.getItem('workFolderName')

    if (!path) {
      return { success: false, error: 'not_set' }
    }

    return { success: true, name, path }
  },

  /**
   * Check if we have permission to access the work folder.
   * In Electron desktop, permission is always granted if the folder is set.
   */
  async checkPermission() {
    const path = localStorage.getItem('workFolderPath')
    const name = localStorage.getItem('workFolderName')

    if (!path) {
      return { success: false, error: 'not_set', hasPermission: false }
    }

    // Optionally verify the folder still exists on disk
    try {
      const result = await window.electronAPI.checkFolderExists({ folderPath: path })
      if (!result.exists) {
        return { success: false, error: 'folder_deleted', hasPermission: false, name }
      }
    } catch (e) {
      // If IPC is unavailable, trust localStorage
      console.warn('[FileSystem] checkFolderExists IPC unavailable, trusting localStorage')
    }

    return { success: true, hasPermission: true, name }
  },

  /**
   * Request permission — no-op in desktop (always granted if folder is set).
   */
  async requestPermission() {
    const path = localStorage.getItem('workFolderPath')

    if (!path) {
      return { success: false, error: 'not_set' }
    }

    return { success: true, granted: true }
  },

  /**
   * Ensure permission — workFolder가 없으면:
   * 1. main process config 파일에서 복원 시도
   * 2. 없으면 기본 폴더 자동 설정
   * 기본 경로: Mac ~/Documents/flow2capcut, Windows Documents\flow2capcut
   */
  async ensurePermission() {
    const existing = localStorage.getItem('workFolderPath')
    if (!existing) {
      // 1단계: main process config 파일에서 이전 설정 복원
      try {
        const saved = await window.electronAPI.getSavedWorkFolder()
        if (saved?.success && saved.path) {
          localStorage.setItem('workFolderPath', saved.path)
          localStorage.setItem('workFolderName', saved.name || '')
          console.log('[FileSystem] Restored work folder from config:', saved.path)
          return this.checkPermission()
        }
      } catch (e) {
        console.warn('[FileSystem] Config restore failed:', e.message)
      }

      // 2단계: config도 없으면 기본 폴더 자동 설정
      try {
        const result = await window.electronAPI.getDefaultWorkFolder()
        if (result?.success) {
          localStorage.setItem('workFolderPath', result.path)
          localStorage.setItem('workFolderName', result.name)
          // 기본 폴더도 config에 저장
          try { await window.electronAPI.saveWorkFolder({ workFolderPath: result.path, workFolderName: result.name }) } catch {}
          console.log('[FileSystem] Default work folder set:', result.path)
        }
      } catch (e) {
        console.warn('[FileSystem] Failed to set default work folder:', e.message)
      }
    } else {
      // localStorage에 있으면 config 파일에도 동기화 (최초 1회)
      try { await window.electronAPI.saveWorkFolder({ workFolderPath: existing, workFolderName: localStorage.getItem('workFolderName') || '' }) } catch {}
    }
    return this.checkPermission()
  },

  // ==========================================
  // Project Management
  // ==========================================

  /**
   * List all project folders inside the work folder.
   */
  async listProjects() {
    try {
      const workFolder = localStorage.getItem('workFolderPath')
      if (!workFolder) {
        return { success: false, error: 'not_set', projects: [] }
      }

      const result = await window.electronAPI.listProjects({ workFolder })
      return { success: true, projects: result.projects || [] }
    } catch (error) {
      return { success: false, error: error.message, projects: [] }
    }
  },

  /**
   * Get (or ensure existence of) a project folder.
   * Returns path string instead of a FileSystemDirectoryHandle.
   */
  async getProjectFolder(projectName) {
    try {
      const workFolder = localStorage.getItem('workFolderPath')
      if (!workFolder) {
        return { success: false, error: 'not_set' }
      }

      const result = await window.electronAPI.getProjectFolder({ workFolder, project: projectName })
      return { success: true, path: result.path }
    } catch (error) {
      return { success: false, error: error.message }
    }
  },

  /**
   * Invalidate cache — no-op in desktop (no IndexedDB or memory cache).
   */
  invalidateCache() {
    // No-op in Electron desktop
  },

  /**
   * Get resource folder path (and history subfolder path).
   * Returns paths instead of handles.
   */
  async getResourceFolder(projectName, resourceType) {
    try {
      const workFolder = localStorage.getItem('workFolderPath')
      if (!workFolder) {
        return { success: false, error: 'not_set' }
      }

      const result = await window.electronAPI.getResourceFolder({
        workFolder,
        project: projectName,
        resourceType
      })

      return {
        success: true,
        path: result.path,
        historyPath: result.historyPath
      }
    } catch (error) {
      return { success: false, error: error.message }
    }
  },

  // ==========================================
  // Utility Functions
  // ==========================================

  /**
   * Generate a timestamp string for filenames.
   */
  _getTimestamp() {
    return new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19)
  },

  /**
   * Convert base64 string to a Blob (kept for renderer-side callers).
   */
  _base64ToBlob(base64Data, mimeType = 'image/png') {
    const cleanBase64 = base64Data.replace(/^data:[^;]+;base64,/, '')
    const binaryData = atob(cleanBase64)
    const bytes = new Uint8Array(binaryData.length)
    for (let i = 0; i < binaryData.length; i++) {
      bytes[i] = binaryData.charCodeAt(i)
    }
    return new Blob([bytes], { type: mimeType })
  },

  /**
   * Detect MIME type and file extension from base64 data.
   */
  _detectMimeType(base64Data) {
    const cleanBase64 = base64Data.replace(/^data:[^;]+;base64,/, '')

    if (cleanBase64.startsWith('/9j/')) {
      return { mimeType: 'image/jpeg', ext: 'jpg' }
    } else if (cleanBase64.startsWith('iVBOR')) {
      return { mimeType: 'image/png', ext: 'png' }
    } else if (cleanBase64.startsWith('R0lGOD')) {
      return { mimeType: 'image/gif', ext: 'gif' }
    } else if (cleanBase64.startsWith('UklGR')) {
      return { mimeType: 'image/webp', ext: 'webp' }
    } else if (cleanBase64.startsWith('//u') || cleanBase64.startsWith('SUQ')) {
      return { mimeType: 'audio/mpeg', ext: 'mp3' }
    } else if (cleanBase64.startsWith('AAAA')) {
      return { mimeType: 'video/mp4', ext: 'mp4' }
    }

    return { mimeType: 'image/png', ext: 'png' }
  },

  // ==========================================
  // Save Operations (delegated to main process)
  // ==========================================

  /**
   * Save a resource (image, reference, video, sfx) via IPC.
   * The main process handles: file write, history copy, metadata JSON.
   */
  async saveResource(projectName, resourceType, name, data, engine = 'flow', metadata = null, options = {}) {
    try {
      const workFolder = localStorage.getItem('workFolderPath')
      if (!workFolder) {
        return { success: false, error: 'not_set' }
      }

      return await window.electronAPI.saveResource({
        workFolder,
        project: projectName,
        resourceType,
        name,
        data,
        engine,
        metadata,
        historyOnly: options.historyOnly || false
      })
    } catch (error) {
      console.error(`[FileSystem] Save ${resourceType} error:`, error)
      return { success: false, error: error.message }
    }
  },

  /**
   * Save an image (saveResource wrapper).
   * @param {Object|null} metadata - 메타데이터 (prompt, mediaId 등) → history/*.json으로 저장
   */
  async saveImage(projectName, sceneId, imageData, engine = 'flow', metadata = null, options = {}) {
    return this.saveResource(projectName, RESOURCE.SCENES, sceneId, imageData, engine, metadata, options)
  },

  /**
   * Save a reference image (saveResource wrapper).
   */
  async saveReference(projectName, refName, imageData, engine = 'flow', metadata = null, options = {}) {
    return this.saveResource(projectName, RESOURCE.REFERENCES, refName, imageData, engine, metadata, options)
  },

  /**
   * Save a video (saveResource wrapper).
   */
  async saveVideo(projectName, videoId, videoData, engine = 'kling') {
    return this.saveResource(projectName, 'videos', videoId, videoData, engine)
  },

  /**
   * Save a sound effect (saveResource wrapper).
   */
  async saveSFX(projectName, sceneId, audioData, engine = 'elevenlabs') {
    return this.saveResource(projectName, 'sfx', sceneId, audioData, engine)
  },

  /**
   * 여분 이미지(2장째~) → History에만 저장.
   * @param {string} projectName - 프로젝트명
   * @param {string} resourceType - RESOURCE.SCENES | RESOURCE.REFERENCES
   * @param {string} name - scene id 또는 reference name
   * @param {Array} imageObjects - [{ base64, mediaId }] 또는 [base64string] (backward compat)
   * @param {string} prompt - 프롬프트 (metadata에 포함)
   * @param {string} tag - 로그 태그 (e.g. 'Automation', 'Scene', 'Reference')
   */
  async saveExtraToHistory(projectName, resourceType, name, imageObjects, prompt = null, tag = 'Extra') {
    if (!imageObjects || imageObjects.length <= 1) return
    console.log(`[${tag}] ${imageObjects.length - 1} extra images → saving to history only`)
    for (let i = 1; i < imageObjects.length; i++) {
      try {
        const img = imageObjects[i]
        const base64 = (typeof img === 'string') ? img : (img.base64 || img)
        const mediaId = (typeof img === 'object') ? (img.mediaId || null) : null

        // alt 이미지에도 metadata 저장 (mediaId 보존)
        const metadata = (mediaId || prompt) ? {
          prompt: prompt || null,
          mediaId,
          model: 'flow',
          timestamp: Date.now()
        } : null

        await this.saveResource(projectName, resourceType, name, base64, `flow-alt${i}`, metadata, { historyOnly: true })
      } catch (e) {
        console.warn(`[${tag}] Failed to save extra image #${i + 1} to history:`, e)
      }
    }
  },

  // ==========================================
  // Read Operations (delegated to main process)
  // ==========================================

  /**
   * Read a resource file as base64 data URL.
   */
  async readResource(projectName, resourceType, name) {
    try {
      const workFolder = localStorage.getItem('workFolderPath')
      if (!workFolder) return { success: false, error: 'not_set' }

      return await window.electronAPI.readResource({
        workFolder,
        project: projectName,
        resourceType,
        name
      })
    } catch (error) {
      return { success: false, error: error.message }
    }
  },

  /**
   * Read a reference image (readResource wrapper).
   */
  async readReference(projectName, refName) {
    return this.readResource(projectName, RESOURCE.REFERENCES, refName)
  },

  /**
   * Read an image (readResource wrapper).
   */
  async readImage(projectName, sceneId) {
    return this.readResource(projectName, RESOURCE.SCENES, sceneId)
  },

  /**
   * Read a file by exact filename within a resource folder.
   * Strips the extension and delegates to readResource.
   */
  async readFile(projectName, resourceType, filename) {
    const workFolder = localStorage.getItem('workFolderPath')
    if (!workFolder) {
      return { success: false, error: 'not_set' }
    }

    const nameWithoutExt = filename.replace(/\.[^/.]+$/, '')
    return await window.electronAPI.readResource({
      workFolder,
      project: projectName,
      resourceType,
      name: nameWithoutExt
    })
  },

  /**
   * Read a file by its relative path within the work folder.
   */
  async readFileByPath(filePath) {
    const workFolder = localStorage.getItem('workFolderPath')
    if (!workFolder) {
      return { success: false, error: 'not_set' }
    }

    return await window.electronAPI.readFileByPath({ workFolder, filePath })
  },

  // ==========================================
  // History Management (delegated to main process)
  // ==========================================

  /**
   * Get history entries for a resource.
   */
  async getHistory(projectName, resourceType, baseName) {
    try {
      const workFolder = localStorage.getItem('workFolderPath')
      if (!workFolder) {
        return { success: false, error: 'not_set' }
      }

      return await window.electronAPI.getHistory({
        workFolder,
        project: projectName,
        resourceType,
        baseName
      })
    } catch (error) {
      console.error('[FileSystem] Get history error:', error)
      return { success: false, error: error.message }
    }
  },

  /**
   * Restore a file from history (copies history file to current, backs up current first).
   */
  async restoreFromHistory(projectName, resourceType, currentFilename, historyFilename) {
    try {
      const workFolder = localStorage.getItem('workFolderPath')
      if (!workFolder) {
        return { success: false, error: 'not_set' }
      }

      return await window.electronAPI.restoreFromHistory({
        workFolder,
        project: projectName,
        resourceType,
        currentFilename,
        historyFilename
      })
    } catch (error) {
      console.error('[FileSystem] Restore from history error:', error)
      return { success: false, error: error.message }
    }
  },

  /**
   * Read a history file as base64 data URL (with optional metadata).
   */
  async readHistoryFile(projectName, resourceType, historyFilename) {
    try {
      const workFolder = localStorage.getItem('workFolderPath')
      if (!workFolder) {
        return { success: false, error: 'not_set' }
      }

      return await window.electronAPI.readHistoryFile({
        workFolder,
        project: projectName,
        resourceType,
        historyFilename
      })
    } catch (error) {
      return { success: false, error: error.message }
    }
  },

  /**
   * Save current image data to history (e.g., before-restore backup).
   */
  async saveToHistory(projectName, resourceType, baseName, base64Data) {
    try {
      const workFolder = localStorage.getItem('workFolderPath')
      if (!workFolder) {
        return { success: false, error: 'not_set' }
      }

      return await window.electronAPI.saveToHistory({
        workFolder,
        project: projectName,
        resourceType,
        baseName,
        data: base64Data
      })
    } catch (error) {
      console.error('[FileSystem] Save to history error:', error)
      return { success: false, error: error.message }
    }
  },

  /**
   * Delete a single history file.
   */
  async deleteHistory(projectName, resourceType, historyFilename) {
    try {
      const workFolder = localStorage.getItem('workFolderPath')
      if (!workFolder) {
        return { success: false, error: 'not_set' }
      }

      return await window.electronAPI.deleteHistory({
        workFolder,
        project: projectName,
        resourceType,
        historyFilename
      })
    } catch (error) {
      console.error('[FileSystem] Delete history error:', error)
      return { success: false, error: error.message }
    }
  },

  /**
   * Clear all history entries for a specific resource.
   */
  async clearHistory(projectName, resourceType, baseName) {
    const result = await this.getHistory(projectName, resourceType, baseName)
    if (!result.success) return result

    let deleted = 0
    for (const hist of result.histories) {
      const r = await this.deleteHistory(projectName, resourceType, hist.filename)
      if (r.success) deleted++
    }

    return { success: true, deleted }
  },

  // ==========================================
  // Project Data (project.json)
  // ==========================================

  /**
   * Save project data (scenes, references, settings) as project.json.
   */
  async saveProjectData(projectName, data) {
    try {
      const workFolder = localStorage.getItem('workFolderPath')
      if (!workFolder) {
        return { success: false, error: 'not_set' }
      }

      return await window.electronAPI.saveProjectData({
        workFolder,
        project: projectName,
        data
      })
    } catch (error) {
      console.error('[FileSystem] Save project data error:', error)
      return { success: false, error: error.message }
    }
  },

  /**
   * Load project data from project.json.
   */
  async loadProjectData(projectName) {
    try {
      const workFolder = localStorage.getItem('workFolderPath')
      if (!workFolder) {
        return { success: false, error: 'not_set' }
      }

      return await window.electronAPI.loadProjectData({
        workFolder,
        project: projectName
      })
    } catch (error) {
      console.error('[FileSystem] Load project data error:', error)
      return { success: false, error: error.message }
    }
  },

  /**
   * Check if a project folder exists.
   */
  async projectExists(projectName) {
    try {
      const workFolder = localStorage.getItem('workFolderPath')
      if (!workFolder) return false

      const result = await window.electronAPI.projectExists({
        workFolder,
        project: projectName
      })
      return result.exists
    } catch (error) {
      return false
    }
  },

  /**
   * Rename a project folder.
   */
  async renameProject(oldName, newName) {
    try {
      const workFolder = localStorage.getItem('workFolderPath')
      if (!workFolder) {
        return { success: false, error: 'not_set' }
      }

      return await window.electronAPI.renameProject({
        workFolder,
        oldName,
        newName
      })
    } catch (error) {
      console.error('[FileSystem] Rename project error:', error)
      return { success: false, error: error.message }
    }
  }
}

export default fileSystemAPI
