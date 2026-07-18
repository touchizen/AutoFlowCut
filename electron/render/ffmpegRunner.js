import { spawn as nodeSpawn } from 'node:child_process'
import {
  mkdtemp as nodeMkdtemp,
  rename as nodeRename,
  rmdir as nodeRmdir,
  statfs as nodeStatfs,
  unlink as nodeUnlink,
  writeFile as nodeWriteFile,
} from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'

const STDERR_TAIL_LINES = 20
const ASS_PATH_TOKEN = '__ASS_PATH__'
const FONTS_DIR_TOKEN = '__FONTS_DIR__'
const PCM_F32LE_BYTES_PER_SECOND = 48000 * 2 * 4
const VIDEO_BYTES_PER_PIXEL_FRAME = 0.08
const DISK_SAFETY_FACTOR = 1.25
const MIN_FREE_RESERVE_BYTES = 256 * 1024 * 1024

export async function runFfmpegRender(jobPlan, jobCtx, onProgress = () => {}, deps = {}) {
  const stages = jobPlan.stages || []
  if (stages.length === 0) throw new Error('render plan has no stages')

  const spawn = deps.spawn || nodeSpawn
  const rename = deps.rename || nodeRename
  const unlink = deps.unlink || nodeUnlink
  const rmdir = deps.rmdir || nodeRmdir
  const statfs = deps.statfs || nodeStatfs
  const writeFile = deps.writeFile || nodeWriteFile
  const mkdtemp = deps.mkdtemp || nodeMkdtemp
  const ffmpegPath = deps.ffmpegPath
  const outPath = deps.outPath
  const fontsDir = deps.fontsDir
  const totalDurationMs = positiveNumber(deps.totalDurationMs, positiveNumber(jobPlan.totalDurationMs, 1))
  const safeJobId = sanitizeName(jobCtx.jobId || 'render')
  const outputPaths = new Map()
  let tempDirPromise
  let tempDirRemoved = false
  let lastPercent = 0

  jobCtx.tempFiles ||= []

  try {
    await assertNotCancelled()
    await preflightDiskSpace()
    for (let stageIndex = 0; stageIndex < stages.length; stageIndex += 1) {
      await assertNotCancelled()
      const stage = stages[stageIndex]
      const prepared = await prepareStage(stage, stageIndex)
      await assertNotCancelled()
      await runStage(stage, stageIndex, prepared.args)
      await removeCompletedDependencies(stage)
    }

    const finalStage = stages.at(-1)
    const finalOutput = outputPaths.get(finalStage.output) || finalStage.output
    await rename(finalOutput, outPath)
    untrackTemp(finalOutput)
    await cleanupArtifacts()
    return { outPath }
  } catch (error) {
    if (isCancelled()) await killCurrentChildAndWait()
    await cleanupArtifacts()
    if (isCancelled()) throw new Error('render cancelled')
    throw error
  }

  async function prepareStage(stage, stageIndex) {
    const resolvedInputs = (stage.inputs || []).map(input => outputPaths.get(input) || input)
    const output = await resolveStageOutput(stage.output, stageIndex)
    outputPaths.set(stage.output, output)
    trackTemp(output)

    if (stage.concatDemuxer === true) {
      const listPath = await stageTempPath(stageIndex, 'ffconcat')
      const list = [
        'ffconcat version 1.0',
        ...resolvedInputs.map(input => `file ${quoteConcatPath(input)}`),
        '',
      ].join('\n')
      await writeFile(listPath, list, 'utf8')
      trackTemp(listPath)
      return {
        args: [
          '-y', '-f', 'concat', '-safe', '0', '-i', listPath,
          '-c', 'copy', '-progress', 'pipe:2', output,
        ],
      }
    }

    let graph = String(stage.filtergraphScript || '')
    if (stage.subtitleAss != null) {
      if (!fontsDir) throw new Error('fontsDir is required for subtitle rendering')
      const assPath = await stageTempPath(stageIndex, 'ass')
      await writeFile(assPath, stage.subtitleAss, 'utf8')
      trackTemp(assPath)
      graph = replaceAll(graph, ASS_PATH_TOKEN, escapeFilterOptionValue(assPath))
      graph = replaceAll(graph, FONTS_DIR_TOKEN, escapeFilterOptionValue(fontsDir))
    }

    const inputArgs = resolvedInputs.flatMap(input => ['-i', input])
    const graphArgs = []
    if (graph) {
      const graphPath = await stageTempPath(stageIndex, 'filtergraph')
      await writeFile(graphPath, graph, 'utf8')
      trackTemp(graphPath)
      graphArgs.push('-filter_complex_script', graphPath)
    }

    return {
      args: [
        '-y',
        ...inputArgs,
        ...graphArgs,
        ...mapArgs(stage, graph, resolvedInputs),
        ...codecArgs(stage, graph),
        '-progress', 'pipe:2',
        output,
      ],
    }
  }

  async function preflightDiskSpace() {
    const peakBytes = estimatePeakDiskBytes(jobPlan, totalDurationMs)
    const requiredBytes = Math.ceil(peakBytes * DISK_SAFETY_FACTOR) + MIN_FREE_RESERVE_BYTES
    const directories = [...new Set([path.dirname(outPath), tmpdir()])]

    for (const targetDirectory of directories) {
      let filesystem
      try {
        filesystem = await statfs(targetDirectory)
      } catch (error) {
        throw new Error(`disk space preflight failed for ${targetDirectory}: ${error.message}`)
      }

      const availableBytes = statfsAvailableBytes(filesystem)
      if (availableBytes < requiredBytes) {
        throw new Error(
          `insufficient disk space on ${targetDirectory}: required ${formatBytes(requiredBytes)}, available ${formatBytes(availableBytes)}`,
        )
      }
    }
  }

  function runStage(stage, stageIndex, args) {
    return new Promise((resolve, reject) => {
      let child
      try {
        child = spawn(ffmpegPath, args, { windowsHide: true })
      } catch (error) {
        reject(error)
        return
      }

      jobCtx.currentChild = child
      jobCtx.phase = stage.kind
      let lineBuffer = ''
      let tailLines = []
      let settled = false

      const rememberLine = (line) => {
        if (!line) return

        const progressMatch = line.match(/^out_time_ms=(\d+)$/)
        if (progressMatch) {
          const outTimeMs = Number(progressMatch[1]) / 1000
          const localRatio = Math.min(1, Math.max(0, outTimeMs / totalDurationMs))
          emitProgress(stage, stageIndex, localRatio, outTimeMs)
        }

        if (isProgressProtocolLine(line)) return
        tailLines.push(line)
        if (tailLines.length > STDERR_TAIL_LINES) tailLines = tailLines.slice(-STDERR_TAIL_LINES)
      }

      const onData = (buffer) => {
        const lines = `${lineBuffer}${buffer.toString()}`.split(/\r?\n/)
        lineBuffer = lines.pop() || ''
        for (const line of lines) rememberLine(line)
      }

      const onAbort = () => {
        jobCtx.cancelled = true
        try { child.kill('SIGKILL') } catch {}
      }

      const finish = (error, value) => {
        if (settled) return
        settled = true
        jobCtx.signal?.removeEventListener?.('abort', onAbort)
        if (jobCtx.currentChild === child) jobCtx.currentChild = null
        error ? reject(error) : resolve(value)
      }

      child.stderr?.on('data', onData)
      child.once('error', error => finish(error))
      child.once('close', (code) => {
        if (lineBuffer) rememberLine(lineBuffer)
        if (isCancelled()) {
          finish(new Error('render cancelled'))
          return
        }
        if (code === 0) {
          emitProgress(stage, stageIndex, 1, totalDurationMs)
          finish(null)
          return
        }
        finish(new Error(`ffmpeg exit ${code}: ${tailLines.join('\n')}`))
      })

      if (jobCtx.signal?.aborted) onAbort()
      else jobCtx.signal?.addEventListener?.('abort', onAbort, { once: true })
    })
  }

  function emitProgress(stage, stageIndex, localRatio, currentMs) {
    const stageCount = stages.length
    // Stage durations are not part of RenderJobPlan yet; equal slices are the
    // deterministic fallback while preserving monotonic progress.
    const percent = Math.min(100, Math.max(
      lastPercent,
      ((stageIndex + localRatio) / stageCount) * 100,
    ))
    lastPercent = percent
    onProgress({
      jobId: jobCtx.jobId,
      percent,
      currentSec: currentMs / 1000,
      totalSec: totalDurationMs / 1000,
      stage: stage.kind,
    })
  }

  async function assertNotCancelled() {
    if (jobCtx.signal?.aborted) jobCtx.cancelled = true
    if (!jobCtx.cancelled) return
    await killCurrentChildAndWait()
    throw new Error('render cancelled')
  }

  async function killCurrentChildAndWait() {
    const child = jobCtx.currentChild
    if (!child) return
    const closed = new Promise(resolve => {
      child.once('close', resolve)
      child.once('error', resolve)
    })
    try { child.kill('SIGKILL') } catch {}
    await closed
    if (jobCtx.currentChild === child) jobCtx.currentChild = null
  }

  function isCancelled() {
    return Boolean(jobCtx.cancelled || jobCtx.signal?.aborted)
  }

  async function ensureTempDir() {
    tempDirPromise ||= mkdtemp(path.join(tmpdir(), `autoflowcut-${safeJobId}-`))
    return tempDirPromise
  }

  async function stageTempPath(stageIndex, extension) {
    const directory = await ensureTempDir()
    const index = String(stageIndex).padStart(3, '0')
    return joinPortable(directory, `${safeJobId}-stage-${index}.${extension}`)
  }

  async function resolveStageOutput(output, stageIndex) {
    if (stageIndex === stages.length - 1) return siblingTempPath(outPath, safeJobId)
    if (isAbsolutePortable(output)) return output
    const directory = await ensureTempDir()
    return joinPortable(directory, sanitizeName(baseNamePortable(output)))
  }

  async function removeCompletedDependencies(stage) {
    for (const dependency of (stage.dependsOn || [])) {
      const dependencyPath = outputPaths.get(dependency)
      if (dependencyPath) await unlinkTemp(dependencyPath)
    }
  }

  function trackTemp(file) {
    if (!jobCtx.tempFiles.includes(file)) jobCtx.tempFiles.push(file)
  }

  function untrackTemp(file) {
    const index = jobCtx.tempFiles.indexOf(file)
    if (index >= 0) jobCtx.tempFiles.splice(index, 1)
  }

  async function unlinkTemp(file) {
    try {
      await unlink(file)
      untrackTemp(file)
      return true
    } catch (error) {
      if (error?.code === 'ENOENT') {
        untrackTemp(file)
        return true
      }
      return false
    }
  }

  async function cleanupTempFiles() {
    for (const file of [...jobCtx.tempFiles]) await unlinkTemp(file)
  }

  async function cleanupArtifacts() {
    await cleanupTempFiles()
    if (!tempDirPromise || tempDirRemoved) return
    tempDirRemoved = true
    try { await rmdir(await tempDirPromise) } catch {}
  }
}

export function estimatePeakDiskBytes(jobPlan, fallbackDurationMs = jobPlan?.totalDurationMs) {
  const outputSizes = new Map()
  const fallbackMs = positiveNumber(fallbackDurationMs, 1000)
  let liveBytes = 0
  let peakBytes = 0

  for (const stage of (jobPlan?.stages || [])) {
    const outputBytes = estimateStageOutputBytes(stage, fallbackMs)
    outputSizes.set(stage.output, outputBytes)
    liveBytes += outputBytes
    peakBytes = Math.max(peakBytes, liveBytes)

    for (const dependency of (stage.dependsOn || [])) {
      const dependencyBytes = outputSizes.get(dependency)
      if (dependencyBytes == null) continue
      liveBytes = Math.max(0, liveBytes - dependencyBytes)
      outputSizes.delete(dependency)
    }
  }

  return Math.ceil(peakBytes)
}

function estimateStageOutputBytes(stage, fallbackDurationMs) {
  const durationSec = positiveNumber(stage?.estimatedDurationMs, fallbackDurationMs) / 1000
  if (stage?.kind === 'audio') return durationSec * PCM_F32LE_BYTES_PER_SECOND + 4096

  const spec = stage?.outputSpec || stage?.spec || {}
  const width = positiveNumber(spec.width, 1920)
  const height = positiveNumber(spec.height, 1080)
  const fps = positiveNumber(spec.fps, 30)
  const videoBytes = durationSec * width * height * fps * VIDEO_BYTES_PER_PIXEL_FRAME
  const audioBytes = stage?.kind === 'final' ? durationSec * 32000 : 0
  return videoBytes + audioBytes + 1024 * 1024
}

export function escapeFilterOptionValue(value) {
  return String(value)
    .replace(/\\/g, '\\\\')
    .replace(/:/g, '\\:')
    .replace(/'/g, "\\'\\''")
}

function mapArgs(stage, graph, inputs) {
  const args = []
  const hasVideoOutput = graph.includes('[vout]')
  const hasAudioOutput = graph.includes('[aout]')
  if (hasVideoOutput) args.push('-map', '[vout]')
  else if (stage.kind === 'final' && inputs.length > 0) args.push('-map', '0:v:0?')
  if (hasAudioOutput) args.push('-map', '[aout]')
  return args
}

function codecArgs(stage, graph) {
  const spec = stage.outputSpec || stage.spec || {}
  if (stage.kind === 'audio') {
    return ['-c:a', 'pcm_f32le', '-ar', '48000', '-ac', '2']
  }

  const crf = String(spec.crf ?? 20)
  const preset = String(spec.preset ?? 'medium')
  if (stage.kind === 'video') {
    return ['-c:v', 'libx264', '-preset', preset, '-crf', crf, '-pix_fmt', 'yuv420p', '-an']
  }

  const audioBitrate = String(spec.audioBitrate ?? '192k')
  const videoArgs = graph.includes('[vout]')
    ? ['-c:v', 'libx264', '-preset', preset, '-crf', crf, '-pix_fmt', 'yuv420p']
    : ['-c:v', 'copy']
  return [
    ...videoArgs,
    '-c:a', 'aac', '-b:a', audioBitrate, '-ar', '48000',
  ]
}

function quoteConcatPath(value) {
  const pathValue = String(value)
  if (/[\r\n]/.test(pathValue)) throw new Error('concat input path contains a newline')
  return `'${pathValue.replace(/'/g, "'\\''")}'`
}

function isProgressProtocolLine(line) {
  return /^(?:frame|fps|stream_\d+_\d+_q|bitrate|total_size|out_time_us|out_time_ms|out_time|dup_frames|drop_frames|speed|progress)=/.test(line)
}

function siblingTempPath(outPath, jobId) {
  const value = String(outPath)
  const separatorIndex = Math.max(value.lastIndexOf('/'), value.lastIndexOf('\\'))
  const extensionIndex = value.lastIndexOf('.')
  if (extensionIndex > separatorIndex) {
    return `${value.slice(0, extensionIndex)}.tmp-${jobId}${value.slice(extensionIndex)}`
  }
  return `${value}.tmp-${jobId}`
}

function statfsAvailableBytes(filesystem) {
  const availableBlocks = filesystem?.bavail ?? filesystem?.bfree
  const blockSize = filesystem?.bsize
  if (availableBlocks == null || blockSize == null) {
    throw new Error('statfs did not return bavail/bfree and bsize')
  }
  return Number(BigInt(availableBlocks) * BigInt(blockSize))
}

function formatBytes(bytes) {
  const gib = Number(bytes) / (1024 ** 3)
  return `${gib.toFixed(2)} GiB`
}

function replaceAll(value, token, replacement) {
  return value.split(token).join(replacement)
}

function sanitizeName(value) {
  return String(value).replace(/[^A-Za-z0-9._-]/g, '_').slice(0, 96) || 'render'
}

function baseNamePortable(value) {
  return String(value).split(/[\\/]/).at(-1)
}

function isAbsolutePortable(value) {
  return path.isAbsolute(value) || /^[A-Za-z]:[\\/]/.test(value)
}

function joinPortable(directory, name) {
  const separator = /^[A-Za-z]:[\\/]/.test(directory) || directory.includes('\\') ? '\\' : path.sep
  return `${String(directory).replace(/[\\/]+$/, '')}${separator}${name}`
}

function positiveNumber(value, fallback) {
  const number = Number(value)
  return Number.isFinite(number) && number > 0 ? number : fallback
}
