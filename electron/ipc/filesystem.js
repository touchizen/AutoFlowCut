/**
 * Electron IPC Handler - File System Operations
 *
 * Node.js fs-based replacement for Chrome Extension's File System Access API + IndexedDB.
 * All file operations go through IPC from the renderer process to this main process handler.
 *
 * Folder structure:
 * {workFolder}/
 * └── {project}/
 *     ├── project.json
 *     ├── images/
 *     │   ├── scene_001.png
 *     │   └── history/
 *     │       └── scene_001_2026-01-27T14-30-00_flow.png
 *     ├── references/
 *     │   └── history/
 *     ├── videos/
 *     │   └── history/
 *     └── sfx/
 *         └── history/
 */

import fs from 'fs/promises'
import fsSync from 'fs'
import path from 'path'
import { execFile } from 'child_process'
import { app, dialog } from 'electron'

// ============================================================
// Helper Functions
// ============================================================

/**
 * 오디오 파일 재생 시간(ms) 추출 — ffprobe 사용 (WAV, MP3, OGG, M4A 등 모두 지원)
 * ffprobe 없으면 WAV는 헤더 파싱 폴백
 */
function getAudioDurationMs(filePath) {
  return new Promise((resolve) => {
    execFile('ffprobe', [
      '-v', 'quiet',
      '-print_format', 'json',
      '-show_format',
      filePath
    ], { timeout: 5000 }, (err, stdout) => {
      if (!err && stdout) {
        try {
          const info = JSON.parse(stdout)
          const duration = parseFloat(info.format?.duration)
          if (duration > 0) {
            resolve(Math.round(duration * 1000))
            return
          }
        } catch { /* fallthrough */ }
      }

      // ffprobe 실패 시 WAV 헤더 폴백
      const ext = path.extname(filePath).toLowerCase()
      if (ext === '.wav') {
        resolve(getWavDurationMs(filePath))
      } else {
        resolve(null)
      }
    })
  })
}

/**
 * WAV 파일 헤더에서 재생 시간(ms) 추출 (ffprobe 폴백용)
 */
function getWavDurationMs(filePath) {
  try {
    const fd = fsSync.openSync(filePath, 'r')
    const header = Buffer.alloc(44)
    fsSync.readSync(fd, header, 0, 44, 0)

    if (header.toString('ascii', 0, 4) !== 'RIFF' ||
        header.toString('ascii', 8, 12) !== 'WAVE') {
      fsSync.closeSync(fd)
      return null
    }

    const byteRate = header.readUInt32LE(28)

    const buf = Buffer.alloc(8)
    let offset = 12
    let dataSize = 0
    while (offset < 4096) {
      const bytesRead = fsSync.readSync(fd, buf, 0, 8, offset)
      if (bytesRead < 8) break
      const chunkId = buf.toString('ascii', 0, 4)
      const chunkSize = buf.readUInt32LE(4)
      if (chunkId === 'data') {
        dataSize = chunkSize
        break
      }
      offset += 8 + chunkSize
    }

    fsSync.closeSync(fd)

    if (byteRate > 0 && dataSize > 0) {
      return Math.round((dataSize / byteRate) * 1000)
    }
    return null
  } catch {
    return null
  }
}

/**
 * Detect MIME type and file extension from base64 header bytes.
 * Matches the logic from the Chrome extension's _detectMimeType.
 */
function detectMimeType(base64Data) {
  const clean = base64Data.replace(/^data:[^;]+;base64,/, '')

  if (clean.startsWith('/9j/')) {
    return { mimeType: 'image/jpeg', ext: 'jpg' }
  } else if (clean.startsWith('iVBOR')) {
    return { mimeType: 'image/png', ext: 'png' }
  } else if (clean.startsWith('R0lGOD')) {
    return { mimeType: 'image/gif', ext: 'gif' }
  } else if (clean.startsWith('UklGR')) {
    return { mimeType: 'image/webp', ext: 'webp' }
  } else if (clean.startsWith('//u') || clean.startsWith('SUQ')) {
    return { mimeType: 'audio/mpeg', ext: 'mp3' }
  } else if (clean.startsWith('AAAA')) {
    return { mimeType: 'video/mp4', ext: 'mp4' }
  }

  return { mimeType: 'image/png', ext: 'png' }
}

/**
 * Generate an ISO timestamp formatted for use in filenames.
 * Colons and dots are replaced with dashes.
 * Example: "2026-01-27T14-30-00"
 */
function getTimestamp() {
  return new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19)
}

/**
 * Strip the data: URL prefix from base64 data and convert to a Buffer.
 */
function base64ToBuffer(base64Data) {
  const clean = base64Data.replace(/^data:[^;]+;base64,/, '')
  return Buffer.from(clean, 'base64')
}

/**
 * Read a file from disk and return it as a data URL string.
 * e.g. "data:image/png;base64,iVBOR..."
 */
async function fileToDataUrl(filePath) {
  const data = await fs.readFile(filePath)
  const ext = path.extname(filePath).toLowerCase().slice(1)

  const mimeMap = {
    png: 'image/png',
    jpg: 'image/jpeg',
    jpeg: 'image/jpeg',
    gif: 'image/gif',
    webp: 'image/webp',
    mp3: 'audio/mpeg',
    mp4: 'video/mp4',
    webm: 'video/webm',
    wav: 'audio/wav',
    ogg: 'audio/ogg'
  }

  const mimeType = mimeMap[ext] || 'application/octet-stream'
  return `data:${mimeType};base64,${data.toString('base64')}`
}

/**
 * Check whether a path exists on disk.
 */
async function pathExists(p) {
  try {
    await fs.access(p)
    return true
  } catch {
    return false
  }
}

// ============================================================
// IPC Registration
// ============================================================

/**
 * Register all filesystem-related IPC handlers on the given ipcMain instance.
 */
// ============================================================
// Config file for persisting work folder across sessions
// Stored in app's userData directory (survives localStorage loss)
// ============================================================
function getConfigPath() {
  return path.join(app.getPath('userData'), 'work-folder-config.json')
}

async function readWorkFolderConfig() {
  try {
    const configPath = getConfigPath()
    const text = await fs.readFile(configPath, 'utf-8')
    return JSON.parse(text)
  } catch {
    return null
  }
}

async function writeWorkFolderConfig(workFolderPath, workFolderName) {
  try {
    const configPath = getConfigPath()
    await fs.writeFile(configPath, JSON.stringify({ path: workFolderPath, name: workFolderName }, null, 2), 'utf-8')
    console.log('[FS] Work folder config saved:', workFolderPath)
  } catch (e) {
    console.warn('[FS] Failed to save work folder config:', e.message)
  }
}

export function registerFilesystemIPC(ipcMain) {

  // ----------------------------------------------------------
  // -1. fs:get-saved-work-folder — config 파일에서 저장된 작업폴더 읽기
  // ----------------------------------------------------------
  ipcMain.handle('fs:get-saved-work-folder', async () => {
    const config = await readWorkFolderConfig()
    if (config?.path) {
      return { success: true, path: config.path, name: config.name || path.basename(config.path) }
    }
    return { success: false, error: 'No saved work folder' }
  })

  // ----------------------------------------------------------
  // -0. fs:save-work-folder — 작업폴더를 config 파일에 영속 저장
  // ----------------------------------------------------------
  ipcMain.handle('fs:save-work-folder', async (_event, { workFolderPath, workFolderName }) => {
    await writeWorkFolderConfig(workFolderPath, workFolderName)
    return { success: true }
  })

  // ----------------------------------------------------------
  // 0. fs:get-default-work-folder — 기본 작업 폴더 경로 반환 + 생성
  //    Mac: ~/Documents/flow2capcut
  //    Windows: C:\Users\{user}\Documents\flow2capcut
  // ----------------------------------------------------------
  ipcMain.handle('fs:get-default-work-folder', async () => {
    try {
      const documentsPath = app.getPath('documents')
      const defaultFolder = path.join(documentsPath, 'flow2capcut')

      // 폴더가 없으면 생성
      await fs.mkdir(defaultFolder, { recursive: true })

      return { success: true, path: defaultFolder, name: 'flow2capcut' }
    } catch (error) {
      return { success: false, error: error.message }
    }
  })

  // ----------------------------------------------------------
  // 1. fs:select-work-folder
  // ----------------------------------------------------------
  ipcMain.handle('fs:select-work-folder', async () => {
    try {
      const result = await dialog.showOpenDialog({
        properties: ['openDirectory', 'createDirectory']
      })

      if (result.canceled || result.filePaths.length === 0) {
        return { success: false, error: 'cancelled' }
      }

      const selectedPath = result.filePaths[0]
      const name = path.basename(selectedPath)

      return { success: true, path: selectedPath, name }
    } catch (error) {
      return { success: false, error: error.message }
    }
  })

  // ----------------------------------------------------------
  // 2. fs:list-projects
  // ----------------------------------------------------------
  ipcMain.handle('fs:list-projects', async (_event, { workFolder }) => {
    try {
      const entries = await fs.readdir(workFolder, { withFileTypes: true })
      const projects = entries
        .filter(e => e.isDirectory())
        .map(e => e.name)
        .sort()
        .reverse()

      return { success: true, projects }
    } catch (error) {
      return { success: false, error: error.message, projects: [] }
    }
  })

  // ----------------------------------------------------------
  // 3. fs:load-project-data
  // ----------------------------------------------------------
  ipcMain.handle('fs:load-project-data', async (_event, { workFolder, project }) => {
    try {
      const jsonPath = path.join(workFolder, project, 'project.json')

      if (!(await pathExists(jsonPath))) {
        return { success: true, data: null, isNew: true }
      }

      const text = await fs.readFile(jsonPath, 'utf-8')
      const data = JSON.parse(text)
      return { success: true, data, isNew: false }
    } catch (error) {
      return { success: false, error: error.message }
    }
  })

  // ----------------------------------------------------------
  // 4. fs:save-project-data
  // ----------------------------------------------------------
  ipcMain.handle('fs:save-project-data', async (_event, { workFolder, project, data }) => {
    try {
      const projectDir = path.join(workFolder, project)
      await fs.mkdir(projectDir, { recursive: true })

      const jsonPath = path.join(projectDir, 'project.json')
      await fs.writeFile(jsonPath, JSON.stringify(data, null, 2), 'utf-8')

      return { success: true }
    } catch (error) {
      return { success: false, error: error.message }
    }
  })

  // ----------------------------------------------------------
  // 5. fs:save-resource
  // ----------------------------------------------------------
  ipcMain.handle('fs:save-resource', async (_event, {
    workFolder, project, resourceType, name, data, engine = 'flow', metadata = null, historyOnly = false
  }) => {
    try {
      // Detect MIME type and extension
      const { mimeType, ext } = detectMimeType(data)
      const safeName = String(name).replace(/[^a-zA-Z0-9\uAC00-\uD7A3_-]/g, '_')
      const filename = `${safeName}.${ext}`

      // Ensure resource and history directories exist
      const resourceDir = path.join(workFolder, project, resourceType)
      const historyDir = path.join(resourceDir, 'history')
      await fs.mkdir(historyDir, { recursive: true })

      // Convert base64 to buffer
      const buffer = base64ToBuffer(data)

      // Write current file (skip if historyOnly — 여분 이미지를 history에만 저장할 때)
      const currentPath = path.join(resourceDir, filename)
      if (!historyOnly) {
        await fs.writeFile(currentPath, buffer)
      }

      // Write timestamped history copy
      const timestamp = getTimestamp()
      const historyFilename = `${safeName}_${timestamp}_${engine}.${ext}`
      const historyPath = path.join(historyDir, historyFilename)
      await fs.writeFile(historyPath, buffer)

      // Save metadata JSON in history if provided
      if (metadata) {
        const metaFilename = `${safeName}_${timestamp}_${engine}.json`
        const metaPath = path.join(historyDir, metaFilename)
        await fs.writeFile(metaPath, JSON.stringify(metadata, null, 2), 'utf-8')
      }

      // Build data URL for renderer display
      const cleanBase64 = data.replace(/^data:[^;]+;base64,/, '')
      const dataUrl = `data:${mimeType};base64,${cleanBase64}`

      return {
        success: true,
        filename,
        path: path.join(workFolder, project, resourceType, filename),
        engine,
        historyFilename,
        dataUrl
      }
    } catch (error) {
      return { success: false, error: error.message }
    }
  })

  // ----------------------------------------------------------
  // 6. fs:read-resource
  // ----------------------------------------------------------
  ipcMain.handle('fs:read-resource', async (_event, { workFolder, project, resourceType, name }) => {
    try {
      const safeName = String(name).replace(/[^a-zA-Z0-9\uAC00-\uD7A3_-]/g, '_')
      const resourceDir = path.join(workFolder, project, resourceType)

      // Try common image + video extensions
      for (const ext of ['png', 'jpg', 'jpeg', 'webp', 'gif', 'mp4', 'webm']) {
        const filePath = path.join(resourceDir, `${safeName}.${ext}`)
        if (await pathExists(filePath)) {
          const dataUrl = await fileToDataUrl(filePath)
          return { success: true, data: dataUrl }
        }
      }

      console.warn(`[FS] read-resource: not found ${safeName}.* in ${resourceDir}`)
      return { success: false, error: 'File not found' }
    } catch (error) {
      return { success: false, error: error.message }
    }
  })

  // ----------------------------------------------------------
  // 6b. fs:get-resource-path (경로만 반환, 파일 읽지 않음 — 메모리 최적화)
  // ----------------------------------------------------------
  ipcMain.handle('fs:get-resource-path', async (_event, { workFolder, project, resourceType, name }) => {
    try {
      const safeName = String(name).replace(/[^a-zA-Z0-9\uAC00-\uD7A3_-]/g, '_')
      const resourceDir = path.join(workFolder, project, resourceType)

      for (const ext of ['png', 'jpg', 'jpeg', 'webp', 'gif', 'mp4', 'webm']) {
        const filePath = path.join(resourceDir, `${safeName}.${ext}`)
        if (await pathExists(filePath)) {
          return { success: true, path: filePath }
        }
      }

      return { success: false, error: 'File not found' }
    } catch (error) {
      return { success: false, error: error.message }
    }
  })

  // ----------------------------------------------------------
  // 7. fs:read-file-by-path
  // ----------------------------------------------------------
  ipcMain.handle('fs:read-file-by-path', async (_event, { workFolder, filePath }) => {
    try {
      // 절대 경로면 그대로 사용, 상대 경로면 workFolder와 합침
      const isAbsolute = filePath && (filePath.startsWith('/') || /^[A-Z]:\\/i.test(filePath))
      const fullPath = isAbsolute ? filePath : path.join(workFolder, filePath)

      if (!(await pathExists(fullPath))) {
        return { success: false, error: 'File not found' }
      }

      const dataUrl = await fileToDataUrl(fullPath)
      return { success: true, data: dataUrl }
    } catch (error) {
      return { success: false, error: error.message }
    }
  })

  // ----------------------------------------------------------
  // 8. fs:get-history
  // ----------------------------------------------------------
  ipcMain.handle('fs:get-history', async (_event, { workFolder, project, resourceType, baseName }) => {
    try {
      const historyDir = path.join(workFolder, project, resourceType, 'history')

      if (!(await pathExists(historyDir))) {
        return { success: true, histories: [] }
      }

      const prefix = baseName.replace(/\.[^/.]+$/, '') // strip extension if present
      const mediaExtensions = ['.png', '.jpg', '.jpeg', '.webp', '.gif', '.mp4', '.webm']
      const entries = await fs.readdir(historyDir)

      const histories = []

      for (const entry of entries) {
        const lowerEntry = entry.toLowerCase()
        const isMedia = mediaExtensions.some(ext => lowerEntry.endsWith(ext))

        if (!isMedia) continue
        if (!entry.startsWith(prefix + '_')) continue

        const filePath = path.join(historyDir, entry)
        const stat = await fs.stat(filePath)

        // Extract engine from filename pattern: baseName_timestamp_engine.ext
        let engine = 'flow'
        const engineMatch = entry.match(/_(\w+)\.(\w+)$/)
        if (engineMatch && !engineMatch[1].match(/^\d/)) {
          engine = engineMatch[1]
        }

        histories.push({
          filename: entry,
          timestamp: stat.mtimeMs,
          engine,
          size: stat.size
        })
      }

      // Sort newest first
      histories.sort((a, b) => b.timestamp - a.timestamp)

      return { success: true, histories }
    } catch (error) {
      return { success: false, error: error.message }
    }
  })

  // ----------------------------------------------------------
  // 9. fs:read-history-file
  // ----------------------------------------------------------
  ipcMain.handle('fs:read-history-file', async (_event, {
    workFolder, project, resourceType, historyFilename
  }) => {
    try {
      const historyDir = path.join(workFolder, project, resourceType, 'history')
      const filePath = path.join(historyDir, historyFilename)

      if (!(await pathExists(filePath))) {
        return { success: false, error: 'History file not found' }
      }

      // Read image as data URL
      const dataUrl = await fileToDataUrl(filePath)

      // Try to read matching metadata JSON
      let metadata = null
      try {
        const metaFilename = historyFilename.replace(/\.(png|jpg|jpeg|webp|gif|mp4|webm)$/i, '.json')
        const metaPath = path.join(historyDir, metaFilename)
        if (await pathExists(metaPath)) {
          const metaText = await fs.readFile(metaPath, 'utf-8')
          metadata = JSON.parse(metaText)
        }
      } catch {
        // No metadata file or parse error — ignore
      }

      return { success: true, data: dataUrl, metadata }
    } catch (error) {
      return { success: false, error: error.message }
    }
  })

  // ----------------------------------------------------------
  // 10. fs:restore-from-history
  // ----------------------------------------------------------
  ipcMain.handle('fs:restore-from-history', async (_event, {
    workFolder, project, resourceType, currentFilename, historyFilename
  }) => {
    try {
      const resourceDir = path.join(workFolder, project, resourceType)
      const historyDir = path.join(resourceDir, 'history')
      const currentPath = path.join(resourceDir, currentFilename)
      const historyPath = path.join(historyDir, historyFilename)

      if (!(await pathExists(historyPath))) {
        return { success: false, error: 'History file not found' }
      }

      // Back up the current file to history as "before-restore"
      if (await pathExists(currentPath)) {
        const ext = path.extname(currentFilename).slice(1)
        const baseName = path.basename(currentFilename, `.${ext}`)
        const timestamp = getTimestamp()
        const backupFilename = `${baseName}_${timestamp}_before-restore.${ext}`
        const backupPath = path.join(historyDir, backupFilename)
        await fs.mkdir(historyDir, { recursive: true })
        await fs.copyFile(currentPath, backupPath)
      }

      // Copy history file to the current location
      await fs.copyFile(historyPath, currentPath)

      return { success: true }
    } catch (error) {
      return { success: false, error: error.message }
    }
  })

  // ----------------------------------------------------------
  // 11. fs:delete-history
  // ----------------------------------------------------------
  ipcMain.handle('fs:delete-history', async (_event, {
    workFolder, project, resourceType, historyFilename
  }) => {
    try {
      const historyDir = path.join(workFolder, project, resourceType, 'history')
      const filePath = path.join(historyDir, historyFilename)

      if (!(await pathExists(filePath))) {
        return { success: false, error: 'File not found' }
      }

      await fs.unlink(filePath)

      // Also try to delete matching metadata JSON
      try {
        const metaFilename = historyFilename.replace(/\.(png|jpg|jpeg|webp|gif|mp4|webm)$/i, '.json')
        const metaPath = path.join(historyDir, metaFilename)
        if (await pathExists(metaPath)) {
          await fs.unlink(metaPath)
        }
      } catch {
        // Metadata file may not exist — ignore
      }

      return { success: true }
    } catch (error) {
      return { success: false, error: error.message }
    }
  })

  // ----------------------------------------------------------
  // 12. fs:rename-project
  // ----------------------------------------------------------
  ipcMain.handle('fs:rename-project', async (_event, { workFolder, oldName, newName }) => {
    try {
      const oldPath = path.join(workFolder, oldName)
      const newPath = path.join(workFolder, newName)

      // Check if new name already exists
      if (await pathExists(newPath)) {
        return { success: false, error: 'already_exists' }
      }

      // If old folder doesn't exist, just create the new one
      if (!(await pathExists(oldPath))) {
        await fs.mkdir(newPath, { recursive: true })
        return { success: true }
      }

      // Rename (move) the folder
      await fs.rename(oldPath, newPath)

      return { success: true }
    } catch (error) {
      // fs.rename can fail across filesystems; fall back to copy + delete
      if (error.code === 'EXDEV') {
        try {
          const oldPath = path.join(workFolder, oldName)
          const newPath = path.join(workFolder, newName)
          await fs.cp(oldPath, newPath, { recursive: true })
          await fs.rm(oldPath, { recursive: true, force: true })
          return { success: true }
        } catch (copyError) {
          return { success: false, error: copyError.message }
        }
      }
      return { success: false, error: error.message }
    }
  })

  // ----------------------------------------------------------
  // 13. fs:project-exists
  // ----------------------------------------------------------
  ipcMain.handle('fs:project-exists', async (_event, { workFolder, project }) => {
    try {
      const projectPath = path.join(workFolder, project)
      const exists = await pathExists(projectPath)
      return { exists }
    } catch {
      return { exists: false }
    }
  })

  // ----------------------------------------------------------
  // 14. fs:check-folder-exists
  // ----------------------------------------------------------
  ipcMain.handle('fs:check-folder-exists', async (_event, { folderPath }) => {
    try {
      const exists = await pathExists(folderPath)
      return { exists }
    } catch {
      return { exists: false }
    }
  })

  // ----------------------------------------------------------
  // 15. fs:get-project-folder
  // ----------------------------------------------------------
  ipcMain.handle('fs:get-project-folder', async (_event, { workFolder, project }) => {
    try {
      const projectDir = path.join(workFolder, project)
      await fs.mkdir(projectDir, { recursive: true })
      return { success: true, path: projectDir }
    } catch (error) {
      return { success: false, error: error.message }
    }
  })

  // ----------------------------------------------------------
  // 16. fs:get-resource-folder
  // ----------------------------------------------------------
  ipcMain.handle('fs:get-resource-folder', async (_event, { workFolder, project, resourceType }) => {
    try {
      const resourceDir = path.join(workFolder, project, resourceType)
      const historyDir = path.join(resourceDir, 'history')
      await fs.mkdir(historyDir, { recursive: true })
      return { success: true, path: resourceDir, historyPath: historyDir }
    } catch (error) {
      return { success: false, error: error.message }
    }
  })

  // ----------------------------------------------------------
  // 17. fs:save-to-history
  // ----------------------------------------------------------
  ipcMain.handle('fs:save-to-history', async (_event, {
    workFolder, project, resourceType, baseName, data
  }) => {
    try {
      const historyDir = path.join(workFolder, project, resourceType, 'history')
      await fs.mkdir(historyDir, { recursive: true })

      const { ext } = detectMimeType(data)
      const safeName = String(baseName).replace(/[^a-zA-Z0-9\uAC00-\uD7A3_-]/g, '_')
      const timestamp = getTimestamp()
      const historyFilename = `${safeName}_${timestamp}_backup.${ext}`
      const historyPath = path.join(historyDir, historyFilename)

      const buffer = base64ToBuffer(data)
      await fs.writeFile(historyPath, buffer)

      return { success: true, historyFilename }
    } catch (error) {
      return { success: false, error: error.message }
    }
  })

  // ----------------------------------------------------------
  // 18. fs:delete-project
  // ----------------------------------------------------------
  ipcMain.handle('fs:delete-project', async (_event, { workFolder, project }) => {
    try {
      const projectPath = path.join(workFolder, project)

      if (!(await pathExists(projectPath))) {
        return { success: false, error: 'Project not found' }
      }

      await fs.rm(projectPath, { recursive: true, force: true })

      return { success: true }
    } catch (error) {
      return { success: false, error: error.message }
    }
  })

  // ----------------------------------------------------------
  // 19. fs:save-style-thumbnail — 스타일 프리셋 썸네일 저장 (전역 캐시)
  //     저장 위치: {userData}/style-thumbnails/{presetId}.png
  // ----------------------------------------------------------
  ipcMain.handle('fs:save-style-thumbnail', async (_event, { presetId, data }) => {
    try {
      const thumbDir = path.join(app.getPath('userData'), 'style-thumbnails')
      await fs.mkdir(thumbDir, { recursive: true })

      // base64 데이터에서 prefix 제거
      const base64Data = data.replace(/^data:image\/\w+;base64,/, '')
      const buffer = Buffer.from(base64Data, 'base64')
      const filePath = path.join(thumbDir, `${presetId}.png`)
      await fs.writeFile(filePath, buffer)

      return { success: true, path: filePath }
    } catch (error) {
      return { success: false, error: error.message }
    }
  })

  // ----------------------------------------------------------
  // 20. fs:load-style-thumbnails — 저장된 모든 썸네일 경로 로드
  //     반환: { [presetId]: filePath } (메모리 절약: base64 대신 파일 경로)
  // ----------------------------------------------------------
  ipcMain.handle('fs:load-style-thumbnails', async () => {
    try {
      const thumbDir = path.join(app.getPath('userData'), 'style-thumbnails')

      // 폴더 없으면 빈 결과
      if (!(await pathExists(thumbDir))) {
        return { success: true, thumbnails: {} }
      }

      const files = await fs.readdir(thumbDir)
      const thumbnails = {}

      for (const file of files) {
        if (!file.endsWith('.png')) continue
        const presetId = file.replace('.png', '')
        thumbnails[presetId] = path.join(thumbDir, file)
      }

      return { success: true, thumbnails }
    } catch (error) {
      return { success: false, error: error.message, thumbnails: {} }
    }
  })

  // ----------------------------------------------------------
  // 21. fs:check-style-thumbnails — 썸네일 존재 여부 확인
  //     반환: 존재하는 presetId 배열
  // ----------------------------------------------------------
  ipcMain.handle('fs:check-style-thumbnails', async () => {
    try {
      const thumbDir = path.join(app.getPath('userData'), 'style-thumbnails')

      if (!(await pathExists(thumbDir))) {
        return { success: true, ids: [] }
      }

      const files = await fs.readdir(thumbDir)
      const ids = files
        .filter(f => f.endsWith('.png'))
        .map(f => f.replace('.png', ''))

      return { success: true, ids }
    } catch (error) {
      return { success: false, error: error.message, ids: [] }
    }
  })

  // ----------------------------------------------------------
  // 22. fs:delete-style-thumbnail — 개별 썸네일 삭제
  // ----------------------------------------------------------
  ipcMain.handle('fs:delete-style-thumbnail', async (_event, { presetId }) => {
    try {
      const filePath = path.join(app.getPath('userData'), 'style-thumbnails', `${presetId}.png`)
      await fs.unlink(filePath)
      return { success: true }
    } catch (error) {
      return { success: false, error: error.message }
    }
  })

  // ----------------------------------------------------------
  // 23. fs:scan-audio-package — 오디오 패키지 폴더 스캔
  //
  // 폴더 선택 다이얼로그 → 하위 구조 스캔:
  //   media/  → 원본 영상/오디오 + SRT
  //   media/sfx/ → SFX 파일 (플랫 구조, 파일명 타임코드)
  //   voice_samples/ → 인물별 음성 (타임코드 파일명)
  //   voice_samples/sfx/ → 음향효과 파일 (카테고리별 하위 폴더)
  //   음향효과_추출.md → SFX 타임코드 매핑
  // ----------------------------------------------------------
  ipcMain.handle('fs:scan-audio-package', async () => {
    try {
      // 폴더 선택 다이얼로그
      const result = await dialog.showOpenDialog({
        properties: ['openDirectory'],
        title: 'Select Audio Package Folder'
      })

      if (result.canceled || result.filePaths.length === 0) {
        return { success: false, error: 'cancelled' }
      }

      const folderPath = result.filePaths[0]

      // 1. media/ 스캔
      const mediaDir = path.join(folderPath, 'media')
      let media = { video: null, srt: null }
      if (await pathExists(mediaDir)) {
        const files = await fs.readdir(mediaDir)
        for (const f of files) {
          const ext = path.extname(f).toLowerCase()
          if (['.mp4', '.wav', '.mp3', '.m4a'].includes(ext) && !media.video) {
            media.video = { path: path.join(mediaDir, f), filename: f }
          }
          if (ext === '.srt' && !media.srt) {
            media.srt = { path: path.join(mediaDir, f), filename: f }
          }
        }
      }

      // 1-b. media/sfx/ 스캔 (플랫 구조 — 타임코드 포함 SFX 파일)
      const mediaSfxDir = path.join(mediaDir, 'sfx')
      const mediaSfxFiles = []
      if (await pathExists(mediaSfxDir)) {
        const sfxFiles = await fs.readdir(mediaSfxDir)
        for (const f of sfxFiles) {
          if (!/\.(mp3|wav|m4a)$/i.test(f)) continue
          const name = f.replace(/\.\w+$/, '')
          const parts = name.split('_')
          const timecodeStr = parts[parts.length - 1]
          let timecodeMs = null

          if (timecodeStr && /^\d{4}$/.test(timecodeStr)) {
            const mm = parseInt(timecodeStr.slice(0, 2), 10)
            const ss = parseInt(timecodeStr.slice(2, 4), 10)
            timecodeMs = (mm * 60 + ss) * 1000
          } else if (timecodeStr && /^\d{6}$/.test(timecodeStr)) {
            const hh = parseInt(timecodeStr.slice(0, 2), 10)
            const mm = parseInt(timecodeStr.slice(2, 4), 10)
            const ss = parseInt(timecodeStr.slice(4, 6), 10)
            timecodeMs = (hh * 3600 + mm * 60 + ss) * 1000
          }

          mediaSfxFiles.push({ path: path.join(mediaSfxDir, f), filename: f, timecodeMs })
        }
      }

      // SRT 내용 읽기
      let srtContent = null
      if (media.srt) {
        srtContent = await fs.readFile(media.srt.path, 'utf-8')
      }

      // 2. voice_samples/ 스캔
      const voiceDir = path.join(folderPath, 'voice_samples')
      const voices = []
      const sfxCategories = []

      if (await pathExists(voiceDir)) {
        const entries = await fs.readdir(voiceDir, { withFileTypes: true })

        for (const entry of entries) {
          if (!entry.isDirectory()) continue

          const subDirPath = path.join(voiceDir, entry.name)

          if (entry.name === 'sfx') {
            // SFX 하위 폴더 스캔
            const sfxEntries = await fs.readdir(subDirPath, { withFileTypes: true })
            for (const sfxEntry of sfxEntries) {
              if (!sfxEntry.isDirectory()) continue
              const sfxCatPath = path.join(subDirPath, sfxEntry.name)
              const sfxFiles = await fs.readdir(sfxCatPath)
              const audioFiles = sfxFiles
                .filter(f => /\.(mp3|wav|m4a)$/i.test(f))
                .map(f => {
                  const name = f.replace(/\.\w+$/, '')
                  const parts = name.split('_')
                  const timecodeStr = parts[parts.length - 1]
                  let timecodeMs = null

                  if (timecodeStr && /^\d{4}$/.test(timecodeStr)) {
                    const mm = parseInt(timecodeStr.slice(0, 2), 10)
                    const ss = parseInt(timecodeStr.slice(2, 4), 10)
                    timecodeMs = (mm * 60 + ss) * 1000
                  } else if (timecodeStr && /^\d{6}$/.test(timecodeStr)) {
                    const hh = parseInt(timecodeStr.slice(0, 2), 10)
                    const mm = parseInt(timecodeStr.slice(2, 4), 10)
                    const ss = parseInt(timecodeStr.slice(4, 6), 10)
                    timecodeMs = (hh * 3600 + mm * 60 + ss) * 1000
                  }

                  return { path: path.join(sfxCatPath, f), filename: f, timecodeMs }
                })

              if (audioFiles.length > 0) {
                sfxCategories.push({
                  category: sfxEntry.name,
                  files: audioFiles
                })
              }
            }
          } else {
            // 인물 음성 폴더
            const voiceFiles = await fs.readdir(subDirPath)
            const candidates = voiceFiles
              .filter(f => /\.(wav|mp3|ogg|m4a)$/i.test(f))
              .map(f => {
                const name = f.replace(/\.\w+$/, '')
                const parts = name.split('_')
                const timecodeStr = parts[parts.length - 1]
                const seqStr = parts.length >= 3 ? parts[parts.length - 2] : null
                let timecodeMs = null

                if (timecodeStr && /^\d{4}$/.test(timecodeStr)) {
                  const mm = parseInt(timecodeStr.slice(0, 2), 10)
                  const ss = parseInt(timecodeStr.slice(2, 4), 10)
                  timecodeMs = (mm * 60 + ss) * 1000
                } else if (timecodeStr && /^\d{6}$/.test(timecodeStr)) {
                  const hh = parseInt(timecodeStr.slice(0, 2), 10)
                  const mm = parseInt(timecodeStr.slice(2, 4), 10)
                  const ss = parseInt(timecodeStr.slice(4, 6), 10)
                  timecodeMs = (hh * 3600 + mm * 60 + ss) * 1000
                }

                return {
                  path: path.join(subDirPath, f),
                  filename: f,
                  seq: seqStr ? parseInt(seqStr, 10) : null,
                  timecodeMs
                }
              })
              .filter(f => f.timecodeMs !== null)
              .sort((a, b) => a.timecodeMs - b.timecodeMs)

            // 각 파일의 실제 재생 시간 읽기 (병렬)
            const audioFiles = await Promise.all(
              candidates.map(async (f) => {
                const durationMs = await getAudioDurationMs(f.path)
                return { ...f, durationMs }
              })
            )

            if (audioFiles.length > 0) {
              voices.push({
                character: entry.name,
                files: audioFiles
              })
            }
          }
        }
      }

      // 3. 음향효과_추출.md 읽기
      let sfxMdContent = null
      const sfxMdCandidates = ['음향효과_추출.md', 'sfx_timecodes.md']
      for (const candidate of sfxMdCandidates) {
        const mdPath = path.join(folderPath, candidate)
        if (await pathExists(mdPath)) {
          sfxMdContent = await fs.readFile(mdPath, 'utf-8')
          break
        }
      }

      // media/sfx/ 플랫 파일을 sfxCategories에 합치기
      if (mediaSfxFiles.length > 0) {
        sfxCategories.push({
          category: '_media',
          files: mediaSfxFiles
        })
      }

      return {
        success: true,
        folderPath,
        media,
        srtContent,
        voices,
        sfx: sfxCategories,
        sfxMdContent,
        summary: {
          characters: voices.map(v => v.character),
          totalVoiceFiles: voices.reduce((sum, v) => sum + v.files.length, 0),
          totalSfxCategories: sfxCategories.length,
          totalSfxFiles: sfxCategories.reduce((sum, c) => sum + c.files.length, 0),
          hasSrt: !!srtContent,
          hasMedia: !!media.video,
          hasSfxTimecodes: !!sfxMdContent
        }
      }
    } catch (error) {
      return { success: false, error: error.message }
    }
  })

  // ----------------------------------------------------------
  // 23-b. fs:rescan-audio-package — 기존 폴더 경로로 재스캔 (다이얼로그 없음)
  // ----------------------------------------------------------
  ipcMain.handle('fs:rescan-audio-package', async (_event, { folderPath }) => {
    try {
      if (!folderPath || !(await pathExists(folderPath))) {
        return { success: false, error: 'Invalid folder path' }
      }

      // 1. media/ 스캔
      const mediaDir = path.join(folderPath, 'media')
      let media = { video: null, srt: null }
      if (await pathExists(mediaDir)) {
        const files = await fs.readdir(mediaDir)
        for (const f of files) {
          const ext = path.extname(f).toLowerCase()
          if (['.mp4', '.wav', '.mp3', '.m4a'].includes(ext) && !media.video) {
            media.video = { path: path.join(mediaDir, f), filename: f }
          }
          if (ext === '.srt' && !media.srt) {
            media.srt = { path: path.join(mediaDir, f), filename: f }
          }
        }
      }

      // 1-b. media/sfx/ 스캔 (플랫 구조 — 타임코드 포함 SFX 파일)
      const mediaSfxDir = path.join(mediaDir, 'sfx')
      const mediaSfxFiles = []
      if (await pathExists(mediaSfxDir)) {
        const sfxFiles = await fs.readdir(mediaSfxDir)
        for (const f of sfxFiles) {
          if (!/\.(mp3|wav|m4a)$/i.test(f)) continue
          const name = f.replace(/\.\w+$/, '')
          const parts = name.split('_')
          const timecodeStr = parts[parts.length - 1]
          let timecodeMs = null

          if (timecodeStr && /^\d{4}$/.test(timecodeStr)) {
            const mm = parseInt(timecodeStr.slice(0, 2), 10)
            const ss = parseInt(timecodeStr.slice(2, 4), 10)
            timecodeMs = (mm * 60 + ss) * 1000
          } else if (timecodeStr && /^\d{6}$/.test(timecodeStr)) {
            const hh = parseInt(timecodeStr.slice(0, 2), 10)
            const mm = parseInt(timecodeStr.slice(2, 4), 10)
            const ss = parseInt(timecodeStr.slice(4, 6), 10)
            timecodeMs = (hh * 3600 + mm * 60 + ss) * 1000
          }

          mediaSfxFiles.push({ path: path.join(mediaSfxDir, f), filename: f, timecodeMs })
        }
      }

      let srtContent = null
      if (media.srt) {
        srtContent = await fs.readFile(media.srt.path, 'utf-8')
      }

      // 2. voice_samples/ 스캔
      const voiceDir = path.join(folderPath, 'voice_samples')
      const voices = []
      const sfxCategories = []

      if (await pathExists(voiceDir)) {
        const entries = await fs.readdir(voiceDir, { withFileTypes: true })

        for (const entry of entries) {
          if (!entry.isDirectory()) continue
          const subDirPath = path.join(voiceDir, entry.name)

          if (entry.name === 'sfx') {
            const sfxEntries = await fs.readdir(subDirPath, { withFileTypes: true })
            for (const sfxEntry of sfxEntries) {
              if (!sfxEntry.isDirectory()) continue
              const sfxCatPath = path.join(subDirPath, sfxEntry.name)
              const sfxFiles = await fs.readdir(sfxCatPath)
              const audioFiles = sfxFiles
                .filter(f => /\.(mp3|wav|m4a)$/i.test(f))
                .map(f => {
                  const name = f.replace(/\.\w+$/, '')
                  const parts = name.split('_')
                  const timecodeStr = parts[parts.length - 1]
                  let timecodeMs = null

                  if (timecodeStr && /^\d{4}$/.test(timecodeStr)) {
                    const mm = parseInt(timecodeStr.slice(0, 2), 10)
                    const ss = parseInt(timecodeStr.slice(2, 4), 10)
                    timecodeMs = (mm * 60 + ss) * 1000
                  } else if (timecodeStr && /^\d{6}$/.test(timecodeStr)) {
                    const hh = parseInt(timecodeStr.slice(0, 2), 10)
                    const mm = parseInt(timecodeStr.slice(2, 4), 10)
                    const ss = parseInt(timecodeStr.slice(4, 6), 10)
                    timecodeMs = (hh * 3600 + mm * 60 + ss) * 1000
                  }

                  return { path: path.join(sfxCatPath, f), filename: f, timecodeMs }
                })

              if (audioFiles.length > 0) {
                sfxCategories.push({ category: sfxEntry.name, files: audioFiles })
              }
            }
          } else {
            const voiceFiles = await fs.readdir(subDirPath)
            const candidates = voiceFiles
              .filter(f => /\.(wav|mp3|ogg|m4a)$/i.test(f))
              .map(f => {
                const name = f.replace(/\.\w+$/, '')
                const parts = name.split('_')
                const timecodeStr = parts[parts.length - 1]
                const seqStr = parts.length >= 3 ? parts[parts.length - 2] : null
                let timecodeMs = null

                if (timecodeStr && /^\d{4}$/.test(timecodeStr)) {
                  const mm = parseInt(timecodeStr.slice(0, 2), 10)
                  const ss = parseInt(timecodeStr.slice(2, 4), 10)
                  timecodeMs = (mm * 60 + ss) * 1000
                } else if (timecodeStr && /^\d{6}$/.test(timecodeStr)) {
                  const hh = parseInt(timecodeStr.slice(0, 2), 10)
                  const mm = parseInt(timecodeStr.slice(2, 4), 10)
                  const ss = parseInt(timecodeStr.slice(4, 6), 10)
                  timecodeMs = (hh * 3600 + mm * 60 + ss) * 1000
                }

                return { path: path.join(subDirPath, f), filename: f, seq: seqStr ? parseInt(seqStr, 10) : null, timecodeMs }
              })
              .filter(f => f.timecodeMs !== null)
              .sort((a, b) => a.timecodeMs - b.timecodeMs)

            const audioFiles = await Promise.all(
              candidates.map(async (f) => {
                const durationMs = await getAudioDurationMs(f.path)
                return { ...f, durationMs }
              })
            )

            if (audioFiles.length > 0) {
              voices.push({ character: entry.name, files: audioFiles })
            }
          }
        }
      }

      // media/sfx/ 플랫 파일을 sfxCategories에 합치기
      if (mediaSfxFiles.length > 0) {
        sfxCategories.push({
          category: '_media',
          files: mediaSfxFiles
        })
      }

      // 3. 음향효과_추출.md 읽기
      let sfxMdContent = null
      const sfxMdCandidates = ['음향효과_추출.md', 'sfx_timecodes.md']
      for (const candidate of sfxMdCandidates) {
        const mdPath = path.join(folderPath, candidate)
        if (await pathExists(mdPath)) {
          sfxMdContent = await fs.readFile(mdPath, 'utf-8')
          break
        }
      }

      return {
        success: true,
        folderPath,
        media,
        srtContent,
        voices,
        sfx: sfxCategories,
        sfxMdContent,
        summary: {
          characters: voices.map(v => v.character),
          totalVoiceFiles: voices.reduce((sum, v) => sum + v.files.length, 0),
          totalSfxCategories: sfxCategories.length,
          totalSfxFiles: sfxCategories.reduce((sum, c) => sum + c.files.length, 0),
          hasSrt: !!srtContent,
          hasMedia: !!media.video,
          hasSfxTimecodes: !!sfxMdContent
        }
      }
    } catch (error) {
      return { success: false, error: error.message }
    }
  })

  // ----------------------------------------------------------
  // 24. fs:read-file-absolute — 절대 경로로 파일 읽기 (base64)
  //     오디오 파일 등 workFolder 밖의 파일을 읽을 때 사용
  // ----------------------------------------------------------
  ipcMain.handle('fs:read-file-absolute', async (_event, { filePath }) => {
    try {
      if (!(await pathExists(filePath))) {
        return { success: false, error: 'File not found' }
      }

      const dataUrl = await fileToDataUrl(filePath)
      return { success: true, data: dataUrl }
    } catch (error) {
      return { success: false, error: error.message }
    }
  })

  // ----------------------------------------------------------
  // 25. fs:write-file-absolute — 절대 경로로 텍스트 파일 쓰기
  // ----------------------------------------------------------
  ipcMain.handle('fs:write-file-absolute', async (_event, { filePath, content }) => {
    try {
      await fs.writeFile(filePath, content, 'utf-8')
      return { success: true }
    } catch (error) {
      console.error('[FS] write-file-absolute error:', error)
      return { success: false, error: error.message }
    }
  })
}
