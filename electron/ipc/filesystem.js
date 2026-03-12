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
import path from 'path'
import { app, dialog } from 'electron'

// ============================================================
// Helper Functions
// ============================================================

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
export function registerFilesystemIPC(ipcMain) {

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
        path: `${project}/${resourceType}/${filename}`,
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

      // Try common image extensions
      for (const ext of ['png', 'jpg', 'jpeg', 'webp', 'gif']) {
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
  // 7. fs:read-file-by-path
  // ----------------------------------------------------------
  ipcMain.handle('fs:read-file-by-path', async (_event, { workFolder, filePath }) => {
    try {
      const fullPath = path.join(workFolder, filePath)

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
      const imageExtensions = ['.png', '.jpg', '.jpeg', '.webp', '.gif']
      const entries = await fs.readdir(historyDir)

      const histories = []

      for (const entry of entries) {
        const lowerEntry = entry.toLowerCase()
        const isImage = imageExtensions.some(ext => lowerEntry.endsWith(ext))

        if (!isImage) continue
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
        const metaFilename = historyFilename.replace(/\.(png|jpg|jpeg|webp|gif)$/i, '.json')
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
        const metaFilename = historyFilename.replace(/\.(png|jpg|jpeg|webp|gif)$/i, '.json')
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
}
