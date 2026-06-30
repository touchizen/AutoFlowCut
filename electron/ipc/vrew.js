/**
 * Electron IPC Handler - Vrew Project File Operations
 *
 * The renderer builds only the Vrew project structure and small media source
 * references. The main process reads media files, packs the .vrew ZIP, and
 * writes it directly to disk so large ZIP bytes never cross IPC.
 */

import fs from 'fs/promises'
import path from 'path'
import os from 'os'
import { shell } from 'electron'
import { packVrewProject } from '../../src/exporters/vrewZip.js'

async function pathExists(p) {
  try { await fs.access(p); return true } catch { return false }
}

/**
 * 현재 플랫폼의 Vrew 앱 실행파일/번들 후보 경로. (CapCut getCapcutAppPaths 패턴 미러)
 */
function getVrewAppPaths() {
  const platform = process.platform
  if (platform === 'darwin') {
    return ['/Applications/Vrew.app']
  }
  if (platform === 'win32') {
    const localAppData = process.env.LOCALAPPDATA || path.join(os.homedir(), 'AppData', 'Local')
    const programFiles = process.env['ProgramFiles'] || 'C:\\Program Files'
    return [
      path.join(localAppData, 'Programs', 'Vrew', 'Vrew.exe'),
      path.join(localAppData, 'Vrew', 'Vrew.exe'),
      path.join(programFiles, 'Vrew', 'Vrew.exe'),
    ]
  }
  return []
}

function normalizeMediaSource(source) {
  if (!source?.mediaId || !source?.archivePath) {
    throw new Error('mediaSource mediaId/archivePath is required')
  }
  return source
}

function byteLengthOf(value) {
  if (!value) return null
  if (typeof Buffer !== 'undefined' && Buffer.isBuffer(value)) return value.length
  if (value instanceof Uint8Array) return value.byteLength
  if (ArrayBuffer.isView(value)) return value.byteLength
  if (value instanceof ArrayBuffer) return value.byteLength
  return null
}

function base64ToBuffer(value) {
  const normalized = String(value || '')
    .replace(/^data:[^;]+;base64,/, '')
    .trim()
  if (!/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(normalized)) {
    throw new Error('Invalid base64 media data')
  }
  return Buffer.from(normalized, 'base64')
}

async function mediaCandidateFromSource(source) {
  const normalized = normalizeMediaSource(source)
  if (normalized.filePath) {
    return {
      mediaId: normalized.mediaId,
      archivePath: normalized.archivePath,
      sourcePath: normalized.sourcePath || normalized.filePath,
      bytes: await fs.readFile(normalized.filePath),
    }
  }
  if (normalized.data) {
    return {
      mediaId: normalized.mediaId,
      archivePath: normalized.archivePath,
      sourcePath: normalized.sourcePath,
      bytes: base64ToBuffer(normalized.data),
    }
  }
  throw new Error(`Missing media source data for ${normalized.archivePath}`)
}

function projectJsonWithFileSizes(projectJson, media) {
  const files = Array.isArray(projectJson?.files) ? projectJson.files : null
  if (!files) return projectJson

  const sizeByArchivePath = new Map()
  const sizeByMediaId = new Map()
  for (const candidate of media) {
    const size = byteLengthOf(candidate.bytes)
    if (size === null) continue
    if (candidate.archivePath) sizeByArchivePath.set(candidate.archivePath, size)
    if (candidate.mediaId) sizeByMediaId.set(candidate.mediaId, size)
  }

  return {
    ...projectJson,
    files: files.map((file) => {
      const size = sizeByArchivePath.get(file?.path) ?? sizeByMediaId.get(file?.mediaId)
      return size === undefined ? file : { ...file, fileSize: size }
    }),
  }
}

export function registerVrewIPC(ipcMain) {
  // Vrew 앱 설치 여부 확인 (CapCut capcut:check-installed 패턴 미러).
  ipcMain.handle('vrew:check-installed', async () => {
    try {
      for (const appPath of getVrewAppPaths()) {
        if (await pathExists(appPath)) return { installed: true }
      }
      return { installed: false }
    } catch (error) {
      console.warn('[vrew:check-installed] Error:', error.message)
      return { installed: true }  // 체크 실패 시 export 막지 않음
    }
  })

  ipcMain.handle('vrew:open-project', async (_event, { targetPath } = {}) => {
    try {
      if (!targetPath) return { success: false, error: 'targetPath required' }
      const err = await shell.openPath(targetPath)
      if (err) return { success: false, error: err }
      return { success: true }
    } catch (error) {
      return { success: false, error: error.message }
    }
  })

  ipcMain.handle('vrew:write-project', async (_event, { targetPath, projectJson, mediaRefs, mediaSources } = {}) => {
    try {
      if (!targetPath) {
        return { success: false, error: 'targetPath is required' }
      }
      if (!projectJson || typeof projectJson !== 'object') {
        return { success: false, targetPath, error: 'projectJson is required' }
      }
      if (!Array.isArray(mediaRefs)) {
        return { success: false, targetPath, error: 'mediaRefs must be an array' }
      }
      if (!Array.isArray(mediaSources)) {
        return { success: false, targetPath, error: 'mediaSources must be an array' }
      }

      const media = []
      for (const source of mediaSources) {
        media.push(await mediaCandidateFromSource(source))
      }

      const sizedProjectJson = projectJsonWithFileSizes(projectJson, media)
      const zipBytes = await packVrewProject({ projectJson: sizedProjectJson, mediaRefs, media })
      await fs.mkdir(path.dirname(targetPath), { recursive: true })
      await fs.writeFile(targetPath, Buffer.from(zipBytes))
      return { success: true, targetPath, bytesWritten: zipBytes.byteLength }
    } catch (error) {
      return { success: false, targetPath, error: error.message }
    }
  })
}

export default {
  registerVrewIPC,
}
