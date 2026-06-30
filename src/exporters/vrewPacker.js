/**
 * Vrew Packer — 주입된 generator 가 만든 projectJson 을 받아 로컬 미디어 바이트를
 * 패킹하고 .vrew ZIP 으로 디스크에 쓴다. generator 로직은 클라에 없음(GCF 소유) —
 * generate(cloudRequest)→{projectJson, mediaRefs} 를 주입받아 패킹만 담당.
 * "JSON 은 서버, 미디어 바이트 패킹은 로컬" 경계.
 */

import { prepareCloudRequest } from './prepareCloudRequest'

function pushLog(lines, message, data) {
  const suffix = data == null ? '' : ` ${JSON.stringify(data)}`
  lines.push(`[${new Date().toISOString()}] ${message}${suffix}`)
}

async function writeDebugLog(targetFolder, lines) {
  if (!window?.electronAPI?.writeFileAbsolute) return
  try {
    const content = `${lines.join('\n')}\n`
    const writes = [
      window.electronAPI.writeFileAbsolute({
        filePath: '/tmp/autoflowcut-vrew-export-debug.log',
        content,
      }),
    ]
    if (targetFolder) {
      writes.push(window.electronAPI.writeFileAbsolute({
        filePath: `${targetFolder}/vrew-export-debug.log`,
        content,
      }))
    }
    await Promise.allSettled(writes)
  } catch (error) {
    console.warn('[Vrew] Failed to write debug log:', error)
  }
}

async function writeDebugArtifact(filePath, value) {
  if (!window?.electronAPI?.writeFileAbsolute) return
  try {
    await window.electronAPI.writeFileAbsolute({
      filePath,
      content: typeof value === 'string' ? value : JSON.stringify(value, null, 2),
    })
  } catch (error) {
    console.warn('[Vrew] Failed to write debug artifact:', error)
  }
}

function shouldWriteDebugArtifacts(options) {
  if (options?.debugVrewArtifacts === true) return true
  if (options?.debugVrewArtifacts === false) return false
  try {
    return globalThis.window?.localStorage?.getItem('autoflowcut.vrewDebugArtifacts') === '1'
  } catch {
    return false
  }
}

function summarizePrepared(prepared) {
  const cloudRequest = prepared?.cloudRequest || {}
  return {
    projectName: cloudRequest.projectName,
    format: cloudRequest.format,
    scenes: Array.isArray(cloudRequest.scenes) ? cloudRequest.scenes.length : 0,
    videoOverlays: Array.isArray(cloudRequest.videoOverlays) ? cloudRequest.videoOverlays.length : 0,
    sfxItems: Array.isArray(cloudRequest.sfxItems) ? cloudRequest.sfxItems.length : 0,
    audioTracks: Array.isArray(cloudRequest.audioTracks) ? cloudRequest.audioTracks.length : 0,
    mediaFiles: Array.isArray(prepared?.mediaFiles) ? prepared.mediaFiles.length : 0,
    sfxFiles: Array.isArray(prepared?.sfxFiles) ? prepared.sfxFiles.length : 0,
    audioFiles: Array.isArray(prepared?.audioFiles) ? prepared.audioFiles.length : 0,
  }
}

function collectPreparedMedia({ mediaFiles = [], sfxFiles = [], audioFiles = [] }) {
  const collected = []
  const inputs = [
    ...mediaFiles.map((item) => ({ ...item, bucket: 'media' })),
    ...sfxFiles.map((item) => ({ ...item, bucket: 'sfx' })),
    ...audioFiles.map((item) => ({ ...item, bucket: 'audio' })),
  ]
  for (const item of inputs) {
    if (!item?.filename) continue
    collected.push(item)
  }
  return collected
}

// scene/overlay ref 가 sceneId 로 정확히 매칭되지 않을 때: 후보가 하나면 모호하지 않으니
// 그대로, 여러 개면 잘못된 파일에 조용히 바인딩하지 말고 에러를 던진다.
function disambiguateOrThrow(matches, ref) {
  if (matches.length === 1) return matches[0]
  throw new Error(`Vrew media ref '${ref.filename}' (${ref.role} scene ${ref.sceneId}) matches ${matches.length} local files but none by sceneId — cannot disambiguate`)
}

function findPreparedMediaForRef(ref, collected) {
  const matches = collected.filter((item) => item.filename === ref.filename)
  if (matches.length === 0) return null

  if (ref.role === 'scene') {
    const sceneType = ref.type === 'Image' ? 'image' : ref.type === 'AVMedia' ? 'video' : null
    const exact = matches.find((item) => item.sceneId === ref.sceneId && (!sceneType || item.type === sceneType)) ||
      matches.find((item) => item.sceneId === ref.sceneId)
    return exact || disambiguateOrThrow(matches, ref)
  }

  if (ref.role === 'overlay') {
    const exact = matches.find((item) => item.sceneId === ref.sceneId && item.type === 'video') ||
      matches.find((item) => item.sceneId === ref.sceneId)
    return exact || disambiguateOrThrow(matches, ref)
  }

  if (ref.role === 'audioTrack') {
    return matches.find((item) => item.bucket === 'audio') || matches[0]
  }

  return matches[0]
}

// 데스크톱 모드: 미디어는 항상 파일 경로로 패킹된다. (base64/fallback 분기는 실제
// 플로우에서 안 타 제거 — 인라인 base64 는 발생하지 않음.)
function sourceForItem(item) {
  return item?.path ? { filePath: item.path } : null
}

function buildMediaSources(mediaRefs, prepared) {
  const collected = collectPreparedMedia(prepared)
  return mediaRefs.map((ref) => {
    const item = findPreparedMediaForRef(ref, collected)
    const source = sourceForItem(item)
    if (!source) {
      throw new Error(`Missing Vrew media data for ${ref.filename}`)
    }
    return {
      mediaId: ref.mediaId,
      archivePath: ref.archivePath,
      filename: ref.filename,
      ...source,
    }
  })
}

// 공유 패킹/쓰기 — generator(로컬 vs GCF)만 generate(cloudRequest)→{projectJson,mediaRefs,...} 로
// 주입받아 교체한다. 미디어 바이트 패킹(buildMediaSources + writeVrewProject)은 동일. vrewCloud 가 재사용.
export async function packAndWriteVrew(project, options, generate) {
  const { capcutProjectNumber } = options
  const name = project.name || 'untitled'
  const debugLines = []

  pushLog(debugLines, 'Vrew export started', {
    name,
    targetFolder: capcutProjectNumber || null,
  })

  if (!capcutProjectNumber) {
    throw new Error('Vrew project folder path is required.')
  }
  if (!window?.electronAPI?.writeVrewProject) {
    throw new Error('Vrew project writer is not available.')
  }

  const targetFolder = capcutProjectNumber
  const targetPath = `${targetFolder}/${name}.vrew`

  try {
    const prepared = await prepareCloudRequest(project, options)
    pushLog(debugLines, 'Prepared cloud request', summarizePrepared(prepared))

    const response = await generate(prepared.cloudRequest)
    if (shouldWriteDebugArtifacts(options)) {
      await Promise.allSettled([
        writeDebugArtifact('/tmp/autoflowcut-vrew-project.json', response.projectJson),
        writeDebugArtifact('/tmp/autoflowcut-vrew-mediaRefs.json', response.mediaRefs),
      ])
    }
    pushLog(debugLines, 'Generated Vrew project structure', {
      sceneCount: response.sceneCount,
      totalDurationMs: response.totalDurationMs,
      files: response.projectJson?.files?.length || 0,
      tracks: Object.keys(response.projectJson?.props?.tracks || {}).length,
      clips: response.projectJson?.transcript?.clips?.length || 0,
      mediaRefs: response.mediaRefs?.length || 0,
      warnings: response.warnings?.map((warning) => warning.code) || [],
    })

    const mediaSources = buildMediaSources(response.mediaRefs, prepared)
    pushLog(debugLines, 'Collected media source references', {
      count: mediaSources.length,
      filePathCount: mediaSources.filter((source) => source.filePath).length,
      inlineDataCount: mediaSources.filter((source) => source.data).length,
    })

    const result = await window.electronAPI.writeVrewProject({
      targetPath,
      projectJson: response.projectJson,
      mediaRefs: response.mediaRefs,
      mediaSources,
    })
    pushLog(debugLines, 'Delegated Vrew package write to main process', {
      targetPath,
      success: !!result?.success,
    })

    if (!result?.success) {
      throw new Error(result?.error || 'Failed to write Vrew project')
    }

    pushLog(debugLines, 'Vrew export completed', {
      targetPath: result.targetPath || targetPath,
    })
    await writeDebugLog(targetFolder, debugLines)

    return {
      ...result,
      success: true,
      targetPath: result.targetPath || targetPath,
      warnings: response.warnings,
      totalDurationMs: response.totalDurationMs,
      sceneCount: response.sceneCount,
    }
  } catch (error) {
    pushLog(debugLines, 'Vrew export failed', {
      message: error?.message || String(error),
      stack: error?.stack || null,
    })
    await writeDebugLog(targetFolder, debugLines)
    throw error
  }
}

export default {
  packAndWriteVrew,
}
