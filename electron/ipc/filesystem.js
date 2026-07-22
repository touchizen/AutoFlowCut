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
import { execFile, execSync } from 'child_process'
import { app, dialog } from 'electron'
import { parseSfxList } from '../../src/utils/parseSfxList.js'

// ============================================================
// Helper Functions
// ============================================================

// #R7-4: per-project.json write serialization. save-project-data 와 merge-project-data 가
//   같은 파일을 read-modify-write 할 때 interleave 하지 않도록 경로별 promise chain 으로 직렬화한다.
const projectWriteChains = new Map()
function withProjectWriteLock(jsonPath, fn) {
  const prev = projectWriteChains.get(jsonPath) || Promise.resolve()
  const run = prev.then(fn, fn) // 이전 작업 성공/실패와 무관하게 직렬 실행
  // 다음 caller 가 결과와 무관하게 대기하도록 항상 resolve 하는 guard 를 저장.
  const guard = run.then(() => {}, () => {})
  projectWriteChains.set(jsonPath, guard)
  // #R11-12: 마지막 작업이면 map 엔트리 제거(누수 방지). 사이에 새 writer 가 끼면 get!==guard 라 보존.
  guard.finally(() => { if (projectWriteChains.get(jsonPath) === guard) projectWriteChains.delete(jsonPath) })
  return run
}

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
  // #R11-10: fd 를 try 밖에 두고 finally 에서 닫는다 — readSync 가 throw 해도 fd 누수 방지.
  let fd = null
  try {
    fd = fsSync.openSync(filePath, 'r')
    const header = Buffer.alloc(44)
    fsSync.readSync(fd, header, 0, 44, 0)

    if (header.toString('ascii', 0, 4) !== 'RIFF' ||
        header.toString('ascii', 8, 12) !== 'WAVE') {
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

    if (byteRate > 0 && dataSize > 0) {
      return Math.round((dataSize / byteRate) * 1000)
    }
    return null
  } catch {
    return null
  } finally {
    if (fd !== null) { try { fsSync.closeSync(fd) } catch { /* ignore */ } }
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

function binaryPayloadToBuffer({ bytes, base64Data }) {
  if (bytes != null) {
    if (Buffer.isBuffer(bytes)) return Buffer.from(bytes)
    if (bytes instanceof ArrayBuffer) return Buffer.from(bytes)
    if (ArrayBuffer.isView(bytes)) {
      return Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength)
    }
    if (Array.isArray(bytes)) return Buffer.from(bytes)
    throw new Error('Unsupported binary bytes payload')
  }

  if (typeof base64Data === 'string' && base64Data) {
    const clean = base64Data.replace(/^data:[^;]+;base64,/, '')
    return Buffer.from(clean, 'base64')
  }

  throw new Error('bytes or base64Data is required')
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

/**
 * Read a JSON file, or null when it is missing or unparseable.
 * 손상된 project.json 을 읽다 throw 하면 저장 자체가 실패한다 — 읽기 실패는 "이전 값 없음"으로
 * 취급하고 쓰기는 진행한다(다음 쓰기가 파일을 정상화한다).
 */
async function readJsonOrNull(p) {
  try {
    return JSON.parse(await fs.readFile(p, 'utf-8'))
  } catch {
    return null
  }
}

/**
 * Try to read + parse W4-3 SFX prompt list (`08_sfx_list.md` / `08_sfx_목록.md`).
 * Returns a plain object `{ [filenameStem]: meta }` for IPC structured-clone safety,
 * or `null` if no file found. Never throws.
 */
async function loadSfxPromptMap(folderPath) {
  // story-engine /story-new writes authoring artifacts under `_story_source/`
  // (see skills/story-engine/workflows/new-episode.md). W8 imports the episode
  // root, so `08_sfx_*.md` actually lives at `{ep}/_story_source/`. Keep the
  // bare-root paths as a back-compat fallback for legacy / hand-assembled
  // bundles where the user dropped the file at the top level.
  const filenames = ['08_sfx_list.md', '08_sfx_목록.md']
  const subdirs = ['_story_source', '']  // _story_source first (canonical), root second (legacy)
  for (const subdir of subdirs) {
    for (const filename of filenames) {
      const mdPath = subdir
        ? path.join(folderPath, subdir, filename)
        : path.join(folderPath, filename)
      if (await pathExists(mdPath)) {
        try {
          const content = await fs.readFile(mdPath, 'utf-8')
          const map = parseSfxList(content)
          // Map → plain object (IPC structured-clone friendly)
          const obj = {}
          for (const [k, v] of map.entries()) obj[k] = v
          return obj
        } catch (err) {
          console.warn(`[FS] Failed to parse ${mdPath}:`, err?.message || err)
          return null
        }
      }
    }
  }
  return null
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
    // 경로엔 사용자 이름이 들어간다(PII) — 저장 여부만 남긴다.
    console.log('[FS] Work folder config saved')
  } catch (e) {
    console.warn('[FS] Failed to save work folder config:', e.message)
  }
}

// 리소스 파일명 정규화. 저장(fs:save-resource)·읽기(fs:read-resource)·history 조회(fs:get-history)가
// 반드시 같은 규칙을 써야 한다 — 다르면 '석준의 딸' 처럼 공백/특수문자가 든 이름의 파일을
// 디스크에 써놓고도 앱이 못 찾는다(카드 이미지·history 가 사라진 것처럼 보인다).
export function safeResourceName(name) {
  return String(name).replace(/[^a-zA-Z0-9\uAC00-\uD7A3_-]/g, '_')
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
  //    Mac: ~/Documents/AutoFlowCut
  //    Windows: C:\Users\{user}\Documents\AutoFlowCut
  // ----------------------------------------------------------
  ipcMain.handle('fs:get-default-work-folder', async () => {
    try {
      const documentsPath = app.getPath('documents')
      const defaultFolder = path.join(documentsPath, 'AutoFlowCut')

      // 폴더가 없으면 생성
      await fs.mkdir(defaultFolder, { recursive: true })

      return { success: true, path: defaultFolder, name: 'AutoFlowCut' }
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
    const jsonPath = path.join(workFolder, project, 'project.json')
    // #R7-4: project.json 쓰기를 경로별로 직렬화 — merge-project-data 와 interleave 방지.
    return withProjectWriteLock(jsonPath, async () => {
      try {
        await fs.mkdir(path.join(workFolder, project), { recursive: true })
        // flowProjectId 는 renderer state 가 아직 null 이던 시점의 payload 에는 실리지 않는다.
        // 그런 payload 가 merge-project-data 뒤에 도착하면 방금 저장된 매핑을 지우는데,
        // merge 성공을 보고 생성 게이트를 연 renderer 는 그걸 알 수 없다(디스크엔 id 가 없어
        // 다음 실행이 또 새 Flow 프로젝트를 만든다). payload 가 그 키를 아예 언급하지 않을
        // 때만 디스크 값을 보존한다 — 명시하면(null 포함) payload 가 이긴다.
        const next = { ...data }
        if (!('flowProjectId' in next)) {
          const prev = await readJsonOrNull(jsonPath)
          if (prev && 'flowProjectId' in prev) next.flowProjectId = prev.flowProjectId
        }
        await fs.writeFile(jsonPath, JSON.stringify(next, null, 2), 'utf-8')
        return { success: true }
      } catch (error) {
        return { success: false, error: error.message }
      }
    })
  })

  // 4b. fs:merge-project-data — project.json 의 최상위 키만 원자적으로 머지(read-modify-write).
  //   #R7-4: write-lock 안에서 read+merge+write 를 수행해 autosave(save-project-data)와의
  //   interleave 로 인한 clobber 를 막는다. patch 의 키만 갱신, 나머지 디스크 데이터는 보존.
  ipcMain.handle('fs:merge-project-data', async (_event, { workFolder, project, patch }) => {
    const jsonPath = path.join(workFolder, project, 'project.json')
    return withProjectWriteLock(jsonPath, async () => {
      try {
        // 파일이 없으면 패치만으로 만든다. 반환값을 실패로 두면(옛 동작) 최초 저장이 실패한
        // 프로젝트는 저장 재시도가 통과할 길이 없어 flowProjectReady 가 영구히 닫힌다.
        await fs.mkdir(path.join(workFolder, project), { recursive: true })
        const data = (await readJsonOrNull(jsonPath)) || {}
        const merged = { ...data, ...(patch || {}) }
        await fs.writeFile(jsonPath, JSON.stringify(merged, null, 2), 'utf-8')
        return { success: true }
      } catch (error) {
        return { success: false, error: error.message }
      }
    })
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
      const safeName = safeResourceName(name)
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
      const safeName = safeResourceName(name)
      const resourceDir = path.join(workFolder, project, resourceType)

      // Try common image + video extensions
      for (const ext of ['png', 'jpg', 'jpeg', 'webp', 'gif', 'mp4', 'webm']) {
        const filePath = path.join(resourceDir, `${safeName}.${ext}`)
        if (await pathExists(filePath)) {
          const dataUrl = await fileToDataUrl(filePath)
          return { success: true, data: dataUrl }
        }
      }

      // not-found 는 정상 케이스다 — 렌더러가 로드 시 모든 씬의 이미지/비디오를 프로브하므로
      // 미생성 리소스(예: 비디오 미생성)가 대량으로 나온다. return 값으로만 알리고 로그는 남기지
      // 않는다(console.warn 은 Sentry breadcrumb + 콘솔 도배가 된다).
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
      const safeName = safeResourceName(name)
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

      // 저장 파일명은 safeResourceName 로 정규화돼 있다 — 원본 이름으로 매칭하면 공백/특수문자가
      //   든 카드의 history 가 영영 안 잡힌다.
      const prefix = safeResourceName(baseName.replace(/\.[^/.]+$/, '')) // strip extension if present
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
  // 9a. fs:read-history-metadata — JSON 사이드카만 읽음 (이미지/비디오 본문 X)
  // ----------------------------------------------------------
  // backfill 용도 (상세 모달이 seed/timestamp/model 만 필요한 경우).
  // 비디오 history 는 파일이 수십 MB → fileToDataUrl 호출 시 IPC/메모리 부담 큼.
  // 이 IPC 는 .json 사이드카만 읽어 즉시 반환.
  ipcMain.handle('fs:read-history-metadata', async (_event, {
    workFolder, project, resourceType, historyFilename
  }) => {
    try {
      const historyDir = path.join(workFolder, project, resourceType, 'history')
      const metaFilename = historyFilename.replace(/\.(png|jpg|jpeg|webp|gif|mp4|webm)$/i, '.json')
      const metaPath = path.join(historyDir, metaFilename)

      if (!(await pathExists(metaPath))) {
        return { success: true, metadata: null }
      }

      const metaText = await fs.readFile(metaPath, 'utf-8')
      const metadata = JSON.parse(metaText)
      return { success: true, metadata }
    } catch (error) {
      // 파싱 실패 등 — 메타 없는 것으로 처리 (앱 안 깨짐)
      return { success: true, metadata: null }
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
      const historyPath = path.join(historyDir, historyFilename)

      if (!(await pathExists(historyPath))) {
        return { success: false, error: 'History file not found' }
      }

      // 대상 확장자는 히스토리 파일의 확장자를 따른다.
      // (caller가 .png를 넘겨도 히스토리가 .jpg면 .jpg로 저장 — 내용-확장자 불일치 방지)
      const historyExt = path.extname(historyFilename).slice(1).toLowerCase()
      const callerExt = path.extname(currentFilename).slice(1)
      const baseName = path.basename(currentFilename, callerExt ? `.${callerExt}` : '')
      const targetFilename = `${baseName}.${historyExt}`
      const currentPath = path.join(resourceDir, targetFilename)

      await fs.mkdir(historyDir, { recursive: true })

      // Back up any existing files with the same basename (regardless of extension)
      // Then remove them so only one canonical file remains after restore.
      const KNOWN_EXTS = ['png', 'jpg', 'jpeg', 'webp', 'gif', 'mp4', 'webm', 'mov', 'm4v']
      for (const ext of KNOWN_EXTS) {
        const candidate = path.join(resourceDir, `${baseName}.${ext}`)
        if (await pathExists(candidate)) {
          const timestamp = getTimestamp()
          const backupFilename = `${baseName}_${timestamp}_before-restore.${ext}`
          const backupPath = path.join(historyDir, backupFilename)
          await fs.copyFile(candidate, backupPath)
          if (ext !== historyExt) {
            // Remove stale file with different extension to avoid leaving
            // scene_1.png next to a fresh scene_1.jpg (would confuse getResourcePath).
            await fs.unlink(candidate)
          }
        }
      }

      // Copy history file to the canonical location
      await fs.copyFile(historyPath, currentPath)

      return { success: true, path: currentPath, filename: targetFilename }
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

      await fs.rm(projectPath, { recursive: true, force: true, maxRetries: 3, retryDelay: 500 })

      return { success: true }
    } catch (error) {
      // Windows EPERM fallback (OneDrive 등 파일 잠금 시)
      if (process.platform === 'win32' && error.code === 'EPERM') {
        try {
          // #R11-11: ESM 모듈이라 require 불가 — 모듈 스코프 import 된 execSync 사용.
          execSync(`rmdir /s /q "${path.join(workFolder, project)}"`, { windowsHide: true })
          return { success: true }
        } catch (fallbackErr) {
          return { success: false, error: fallbackErr.message }
        }
      }
      return { success: false, error: error.message }
    }
  })

  // ----------------------------------------------------------
  // Style thumbnail helpers
  //   다양한 이미지 포맷(jpg/png/webp)을 실제 데이터에 맞춰 저장/로드
  // ----------------------------------------------------------
  const THUMB_EXT_REGEX = /\.(png|jpg|jpeg|webp)$/i
  const THUMB_FILE_REGEX = /^(.+)\.(png|jpg|jpeg|webp)$/i

  // ----------------------------------------------------------
  // 19. fs:save-style-thumbnail — 스타일 프리셋 썸네일 저장 (전역 캐시)
  //     저장 위치: {userData}/style-thumbnails/{presetId}.{실제포맷}
  //     base64 prefix(data:image/jpeg;base64,...)에서 포맷 자동 추출
  // ----------------------------------------------------------
  ipcMain.handle('fs:save-style-thumbnail', async (_event, { presetId, data }) => {
    try {
      const thumbDir = path.join(app.getPath('userData'), 'style-thumbnails')
      await fs.mkdir(thumbDir, { recursive: true })

      // base64 prefix에서 실제 포맷 추출 (image/jpeg → jpg)
      const match = data.match(/^data:image\/(\w+);base64,/)
      const rawExt = match?.[1]?.toLowerCase() || 'png'
      const ext = rawExt === 'jpeg' ? 'jpg' : rawExt

      // base64 데이터에서 prefix 제거
      const base64Data = data.replace(/^data:image\/\w+;base64,/, '')
      const buffer = Buffer.from(base64Data, 'base64')

      // 동일 presetId의 기존 파일(다른 확장자) 정리 — 잔재 방지
      try {
        const existing = await fs.readdir(thumbDir)
        await Promise.all(
          existing
            .filter(f => {
              const m = f.match(THUMB_FILE_REGEX)
              return m && m[1] === presetId
            })
            .map(f => fs.unlink(path.join(thumbDir, f)).catch(() => {}))
        )
      } catch {}

      const filePath = path.join(thumbDir, `${presetId}.${ext}`)
      await fs.writeFile(filePath, buffer)

      return { success: true, path: filePath }
    } catch (error) {
      return { success: false, error: error.message }
    }
  })

  // ----------------------------------------------------------
  // 20. fs:load-style-thumbnails — 저장된 모든 썸네일 경로 로드
  //     반환: { [presetId]: filePath } (메모리 절약: base64 대신 파일 경로)
  //     png/jpg/jpeg/webp 모두 인식
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
        const m = file.match(THUMB_FILE_REGEX)
        if (!m) continue
        const presetId = m[1]
        thumbnails[presetId] = path.join(thumbDir, file)
      }

      return { success: true, thumbnails }
    } catch (error) {
      return { success: false, error: error.message, thumbnails: {} }
    }
  })

  // ----------------------------------------------------------
  // 21. fs:check-style-thumbnails — 썸네일 존재 여부 확인
  //     반환: 존재하는 presetId 배열 (png/jpg/jpeg/webp 모두)
  // ----------------------------------------------------------
  ipcMain.handle('fs:check-style-thumbnails', async () => {
    try {
      const thumbDir = path.join(app.getPath('userData'), 'style-thumbnails')

      if (!(await pathExists(thumbDir))) {
        return { success: true, ids: [] }
      }

      const files = await fs.readdir(thumbDir)
      const ids = files
        .map(f => f.match(THUMB_FILE_REGEX)?.[1])
        .filter(Boolean)

      return { success: true, ids }
    } catch (error) {
      return { success: false, error: error.message, ids: [] }
    }
  })

  // ----------------------------------------------------------
  // 22. fs:delete-style-thumbnail — 개별 썸네일 삭제
  //     해당 presetId의 모든 확장자(png/jpg/jpeg/webp) 변형을 삭제
  // ----------------------------------------------------------
  ipcMain.handle('fs:delete-style-thumbnail', async (_event, { presetId }) => {
    try {
      const thumbDir = path.join(app.getPath('userData'), 'style-thumbnails')
      const files = await fs.readdir(thumbDir).catch(() => [])
      const targets = files.filter(f => {
        const m = f.match(THUMB_FILE_REGEX)
        return m && m[1] === presetId
      })

      if (targets.length === 0) {
        return { success: false, error: 'thumbnail not found' }
      }

      await Promise.all(targets.map(f => fs.unlink(path.join(thumbDir, f))))
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
  //   media/voices/ → 인물별 음성 (타임코드 파일명, 캐릭터별 서브폴더)
  //   media/sfx/ → 음향효과 파일 (카테고리별 하위 폴더 + 플랫 구조)
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

      // 1. media/ 스캔 — 상위 디렉토리 또는 media/ 직접 지정 둘 다 지원
      const _md = path.join(folderPath, 'media')
      const mediaDir = await pathExists(_md) ? _md : folderPath
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

      // 1-a. 음성 mp3 duration 측정 (ffprobe)
      if (media.video) {
        const durationMs = await getAudioDurationMs(media.video.path)
        if (durationMs) media.video.durationMs = durationMs
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

      // 2. media/voices/ 스캔 — 상위 디렉토리(ep02/) 또는 media/ 직접 지정 둘 다 지원
      const _vd1 = path.join(folderPath, 'media', 'voices')
      const _vd2 = path.join(folderPath, 'voices')
      const voiceDir = await pathExists(_vd1) ? _vd1 : _vd2
      const voices = []
      const sfxCategories = []

      if (await pathExists(voiceDir)) {
        const entries = await fs.readdir(voiceDir, { withFileTypes: true })

        for (const entry of entries) {
          if (!entry.isDirectory()) continue

          const subDirPath = path.join(voiceDir, entry.name)

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

      // 2-b. media/sfx/ 카테고리별 하위 폴더 스캔
      const _sd1 = path.join(folderPath, 'media', 'sfx')
      const _sd2 = path.join(folderPath, 'sfx')
      const sfxCatDir = await pathExists(_sd1) ? _sd1 : _sd2
      if (await pathExists(sfxCatDir)) {
        const sfxEntries = await fs.readdir(sfxCatDir, { withFileTypes: true })
        for (const sfxEntry of sfxEntries) {
          if (!sfxEntry.isDirectory()) continue
          const sfxCatPath = path.join(sfxCatDir, sfxEntry.name)
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
      }

      // 3. 음향효과_추출.md 읽기 (legacy 포맷, 그대로 유지)
      let sfxMdContent = null
      const sfxMdCandidates = ['음향효과_추출.md', 'sfx_timecodes.md']
      for (const candidate of sfxMdCandidates) {
        const mdPath = path.join(folderPath, candidate)
        if (await pathExists(mdPath)) {
          sfxMdContent = await fs.readFile(mdPath, 'utf-8')
          break
        }
      }

      // 3-b. W4-3 신포맷 08_sfx_list.md / 08_sfx_목록.md → sfxPromptMap
      // (AudioTab에서 SFX 클립마다 anchor/placement/prompt/duration 표시용)
      const sfxPromptMap = await loadSfxPromptMap(folderPath)

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
        sfxPromptMap,
        summary: {
          characters: voices.map(v => v.character),
          totalVoiceFiles: voices.reduce((sum, v) => sum + v.files.length, 0),
          totalSfxCategories: sfxCategories.length,
          totalSfxFiles: sfxCategories.reduce((sum, c) => sum + c.files.length, 0),
          hasSrt: !!srtContent,
          hasMedia: !!media.video,
          hasSfxTimecodes: !!sfxMdContent || mediaSfxFiles.some(f => f.timecodeMs != null),
          hasSfxPrompts: !!sfxPromptMap && Object.keys(sfxPromptMap).length > 0
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

      // 1. media/ 스캔 — 상위 디렉토리 또는 media/ 직접 지정 둘 다 지원
      const _md = path.join(folderPath, 'media')
      const mediaDir = await pathExists(_md) ? _md : folderPath
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

      // 1-a. 음성 mp3 duration 측정 (ffprobe)
      if (media.video) {
        const durationMs = await getAudioDurationMs(media.video.path)
        if (durationMs) media.video.durationMs = durationMs
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

      // 2. media/voices/ 스캔 — 상위 디렉토리(ep02/) 또는 media/ 직접 지정 둘 다 지원
      const _vd1 = path.join(folderPath, 'media', 'voices')
      const _vd2 = path.join(folderPath, 'voices')
      const voiceDir = await pathExists(_vd1) ? _vd1 : _vd2
      const voices = []
      const sfxCategories = []

      if (await pathExists(voiceDir)) {
        const entries = await fs.readdir(voiceDir, { withFileTypes: true })

        for (const entry of entries) {
          if (!entry.isDirectory()) continue
          const subDirPath = path.join(voiceDir, entry.name)

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

      // 2-b. media/sfx/ 카테고리별 하위 폴더 스캔
      const _sd1 = path.join(folderPath, 'media', 'sfx')
      const _sd2 = path.join(folderPath, 'sfx')
      const sfxCatDir = await pathExists(_sd1) ? _sd1 : _sd2
      if (await pathExists(sfxCatDir)) {
        const sfxEntries = await fs.readdir(sfxCatDir, { withFileTypes: true })
        for (const sfxEntry of sfxEntries) {
          if (!sfxEntry.isDirectory()) continue
          const sfxCatPath = path.join(sfxCatDir, sfxEntry.name)
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
      }

      // media/sfx/ 플랫 파일을 sfxCategories에 합치기
      if (mediaSfxFiles.length > 0) {
        sfxCategories.push({
          category: '_media',
          files: mediaSfxFiles
        })
      }

      // 3. 음향효과_추출.md 읽기 (legacy 포맷, 그대로 유지)
      let sfxMdContent = null
      const sfxMdCandidates = ['음향효과_추출.md', 'sfx_timecodes.md']
      for (const candidate of sfxMdCandidates) {
        const mdPath = path.join(folderPath, candidate)
        if (await pathExists(mdPath)) {
          sfxMdContent = await fs.readFile(mdPath, 'utf-8')
          break
        }
      }

      // 3-b. W4-3 신포맷 08_sfx_list.md / 08_sfx_목록.md → sfxPromptMap
      const sfxPromptMap = await loadSfxPromptMap(folderPath)

      return {
        success: true,
        folderPath,
        media,
        srtContent,
        voices,
        sfx: sfxCategories,
        sfxMdContent,
        sfxPromptMap,
        summary: {
          characters: voices.map(v => v.character),
          totalVoiceFiles: voices.reduce((sum, v) => sum + v.files.length, 0),
          totalSfxCategories: sfxCategories.length,
          totalSfxFiles: sfxCategories.reduce((sum, c) => sum + c.files.length, 0),
          hasSrt: !!srtContent,
          hasMedia: !!media.video,
          hasSfxTimecodes: !!sfxMdContent || mediaSfxFiles.some(f => f.timecodeMs != null),
          hasSfxPrompts: !!sfxPromptMap && Object.keys(sfxPromptMap).length > 0
        }
      }
    } catch (error) {
      return { success: false, error: error.message }
    }
  })

  // ----------------------------------------------------------
  // 23-c. fs:probe-audio-file — 단일 오디오 파일 메타 측정 (드래그앤드롭 경로용)
  // 파일 존재 확인 + 지원 확장자 체크 + duration 측정 + 부모 폴더 경로 반환.
  // ----------------------------------------------------------
  ipcMain.handle('fs:probe-audio-file', async (_event, { filePath }) => {
    try {
      if (!filePath || !(await pathExists(filePath))) {
        return { success: false, error: 'File not found' }
      }
      const ext = path.extname(filePath).toLowerCase()
      if (!['.mp3', '.wav', '.m4a', '.mp4'].includes(ext)) {
        return { success: false, error: 'Unsupported format' }
      }
      const durationMs = await getAudioDurationMs(filePath)
      return {
        success: true,
        path: filePath,
        filename: path.basename(filePath),
        folderPath: path.dirname(filePath),
        durationMs: durationMs || null,
      }
    } catch (error) {
      return { success: false, error: error.message }
    }
  })

  // ----------------------------------------------------------
  // 23-d. fs:copy-dropped-audio — 드롭한 mp3를 오디오 패키지 폴더로 복사하여 영속화
  // - audioFolderPath: 패키지 root. 없으면 IPC가 만들지 않음 (호출자가 결정).
  // - trackType: 'narration' (→ media/) 또는 'sfx' (→ media/sfx/, 파일명에 timecode 인코딩)
  // - 충돌 시 _1, _2 suffix
  // ----------------------------------------------------------
  ipcMain.handle('fs:copy-dropped-audio', async (_event, { sourcePath, audioFolderPath, trackType, timecodeMs }) => {
    try {
      if (!sourcePath || !(await pathExists(sourcePath))) {
        return { success: false, error: 'Source file not found' }
      }
      if (!audioFolderPath) {
        return { success: false, error: 'audioFolderPath required' }
      }
      if (!['narration', 'sfx'].includes(trackType)) {
        return { success: false, error: `Unsupported trackType: ${trackType}` }
      }
      const ext = path.extname(sourcePath).toLowerCase()
      if (!['.mp3', '.wav', '.m4a', '.mp4'].includes(ext)) {
        return { success: false, error: 'Unsupported format' }
      }

      // 폴더 자동 생성 (audio/, audio/media[/sfx])
      const mediaDir = path.join(audioFolderPath, 'media')
      const destDir = trackType === 'sfx' ? path.join(mediaDir, 'sfx') : mediaDir
      await fs.mkdir(destDir, { recursive: true })

      // Narration은 "media/ 안 첫 mp3" 컨트랙트라 의미적으로 1개. 새 narration 드롭 시
      // 기존 audio 파일들을 unlink — 안 그러면 readdir 알파벳 순서로 옛 파일이 다시
      // narration으로 잡힘(예: intro.mp3가 그대로 있고 새 intro_1.mp3가 무시됨).
      // SRT는 보존. source 파일이 media/ 안에 있다면(자기 자신 재드롭) skip해야 copy 가능.
      const sourceResolved = path.resolve(sourcePath)
      if (trackType === 'narration') {
        try {
          const existing = await fs.readdir(mediaDir)
          for (const f of existing) {
            const fext = path.extname(f).toLowerCase()
            if (['.mp3', '.wav', '.m4a', '.mp4'].includes(fext)) {
              const filePath = path.join(mediaDir, f)
              if (path.resolve(filePath) === sourceResolved) continue // source 보존
              await fs.unlink(filePath)
            }
          }
        } catch (e) {
          // 디렉토리 없거나 권한 문제 — copy 단계에서 다시 잡힘
          console.warn('[FS] narration pre-clean failed:', e?.message)
        }
      }

      // 파일명 결정
      const origStem = path.basename(sourcePath, ext)
      let destFilename
      if (trackType === 'narration') {
        // 원본 파일명 그대로 (timecode 인코딩 없음). pre-clean 했으므로 충돌 없음.
        destFilename = `${origStem}${ext}`
      } else {
        // sfx — <stem>_<MMSS or HHMMSS>.mp3
        const totalSec = Math.max(0, Math.floor((timecodeMs || 0) / 1000))
        let tcStr
        if (totalSec >= 3600) {
          const hh = Math.floor(totalSec / 3600)
          const mm = Math.floor((totalSec % 3600) / 60)
          const ss = totalSec % 60
          tcStr = `${String(hh).padStart(2, '0')}${String(mm).padStart(2, '0')}${String(ss).padStart(2, '0')}`
        } else {
          const mm = Math.floor(totalSec / 60)
          const ss = totalSec % 60
          tcStr = `${String(mm).padStart(2, '0')}${String(ss).padStart(2, '0')}`
        }
        destFilename = `${origStem}_${tcStr}${ext}`
      }

      // 충돌 시 증분 suffix.
      // SFX: scanner는 파일명의 **마지막** `_` 토큰을 timecode로 보므로 suffix는
      //      timecode **앞에** 삽입해야 함. 예: boom_0005.mp3 → boom_1_0005.mp3.
      //      `boom_0005_1.mp3`처럼 뒤에 붙으면 scanner가 마지막 `1`을 보고
      //      timecodeMs를 null로 인식 → 타임라인에서 사라짐.
      // Narration: 위에서 pre-clean으로 충돌 없음 (이 분기엔 안 옴).
      // sourcePath === destPath(자기 자신 재드롭)는 "충돌"이 아니라 no-op로 처리.
      let destPath = path.join(destDir, destFilename)
      const isSelfCopy = path.resolve(destPath) === sourceResolved
      if (!isSelfCopy && await pathExists(destPath)) {
        if (trackType === 'sfx') {
          // SFX: <stem>_<timecode>.<ext> → <stem>_<N>_<timecode>.<ext>
          const tcWithExt = destFilename.slice(destFilename.lastIndexOf('_'))  // "_0005.mp3"
          const stemPart = destFilename.slice(0, destFilename.lastIndexOf('_')) // "boom"
          for (let n = 1; n < 1000; n++) {
            const candidate = `${stemPart}_${n}${tcWithExt}`
            const candPath = path.join(destDir, candidate)
            if (!(await pathExists(candPath))) {
              destFilename = candidate
              destPath = candPath
              break
            }
          }
        } else {
          // 안전망 — 사실 narration은 pre-clean으로 이 분기 안 옴
          const baseNoExt = destFilename.slice(0, -ext.length)
          for (let n = 1; n < 1000; n++) {
            const candidate = `${baseNoExt}_${n}${ext}`
            const candPath = path.join(destDir, candidate)
            if (!(await pathExists(candPath))) {
              destFilename = candidate
              destPath = candPath
              break
            }
          }
        }
      }

      // sourcePath === destPath (자기 자신 재드롭, 같은 경로) — copy 자체가 no-op면 skip.
      // OS에 따라 fs.copyFile에 같은 경로 주면 truncate 위험.
      if (path.resolve(destPath) !== sourceResolved) {
        await fs.copyFile(sourcePath, destPath)
      }

      return {
        success: true,
        destPath,
        audioFolderPath,
        filename: destFilename,
      }
    } catch (error) {
      console.error('[FS] copy-dropped-audio error:', error)
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

  // ----------------------------------------------------------
  // 26. fs:write-binary-file-absolute — 절대 경로로 바이너리 파일 쓰기
  //     .vrew(zip)처럼 UTF-8 문자열로 쓰면 깨지는 파일에 사용
  // ----------------------------------------------------------
  ipcMain.handle('fs:write-binary-file-absolute', async (_event, { filePath, bytes, base64Data }) => {
    try {
      if (!filePath) {
        return { success: false, error: 'filePath is required' }
      }
      const buffer = binaryPayloadToBuffer({ bytes, base64Data })
      await fs.mkdir(path.dirname(filePath), { recursive: true })
      await fs.writeFile(filePath, buffer)
      return { success: true, targetPath: filePath }
    } catch (error) {
      console.error('[FS] write-binary-file-absolute error:', error)
      return { success: false, error: error.message }
    }
  })
}
