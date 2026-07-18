import { spawn as nodeSpawn } from 'node:child_process'
import {
  mkdtemp as nodeMkdtemp,
  rename as nodeRename,
  rmdir as nodeRmdir,
  stat as nodeStat,
  statfs as nodeStatfs,
  unlink as nodeUnlink,
  writeFile as nodeWriteFile,
} from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { ASS_PATH_TOKEN, FONTS_DIR_TOKEN } from './filtergraphTokens.js'

const STDERR_TAIL_LINES = 20
const PCM_F32LE_BYTES_PER_SECOND = 48000 * 2 * 4
const WAV_HEADER_SLACK_BYTES = 4096
const AAC_BYTES_PER_SECOND = 32000
const CONTAINER_OVERHEAD_BYTES = 1024 * 1024
// About 10 Mbps at 1080p30 before the separate safety factor is applied.
const VIDEO_BYTES_PER_PIXEL_FRAME = 0.02
const DISK_SAFETY_FACTOR = 1.25
const MIN_FREE_RESERVE_BYTES = 256 * 1024 * 1024

export async function runFfmpegRender(jobPlan, jobCtx, onProgress = () => {}, deps = {}) {
  const stages = jobPlan.stages || []
  if (stages.length === 0) throw new Error('render plan has no stages')

  const spawn = deps.spawn || nodeSpawn
  const rename = deps.rename || nodeRename
  const unlink = deps.unlink || nodeUnlink
  const rmdir = deps.rmdir || nodeRmdir
  const stat = deps.stat || nodeStat
  const statfs = deps.statfs || nodeStatfs
  const writeFile = deps.writeFile || nodeWriteFile
  const mkdtemp = deps.mkdtemp || nodeMkdtemp
  const warn = deps.warn || console.warn
  const ffmpegPath = deps.ffmpegPath
  const outPath = deps.outPath
  const fontsDir = deps.fontsDir
  const totalDurationMs = positiveNumber(deps.totalDurationMs, positiveNumber(jobPlan.totalDurationMs, 1))
  const safeJobId = sanitizeName(jobCtx.jobId || 'render')
  const outputPaths = new Map()
  let tempDirPromise
  let tempDirRemoved = false
  let lastPercent = 0
  const warnedCleanupFailures = new Set()

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
    const estimates = estimateDiskSpaceBytes(jobPlan, totalDurationMs)
    const destinationDirectory = path.dirname(outPath)
    const temporaryDirectory = tmpdir()
    const destination = await inspectFilesystem(destinationDirectory)
    const temporary = destinationDirectory === temporaryDirectory
      ? destination
      : await inspectFilesystem(temporaryDirectory)

    if (sameFilesystem(destination, temporary)) {
      const requiredBytes = diskRequirementBytes(
        estimates.destinationBytes + estimates.tempBytes,
      )
      const availableBytes = Math.min(destination.availableBytes, temporary.availableBytes)
      if (availableBytes < requiredBytes) {
        throw new Error(
          `insufficient disk space on shared filesystem for ${destinationDirectory} and ${temporaryDirectory}: ` +
          `required ${formatBytes(requiredBytes)}, available ${formatBytes(availableBytes)}`,
        )
      }
      return
    }

    assertDiskAvailable(
      destinationDirectory,
      'destination',
      diskRequirementBytes(estimates.destinationBytes),
      destination.availableBytes,
    )
    assertDiskAvailable(
      temporaryDirectory,
      'temporary',
      diskRequirementBytes(estimates.tempBytes),
      temporary.availableBytes,
    )

    async function inspectFilesystem(targetDirectory) {
      let filesystem
      try {
        filesystem = await statfs(targetDirectory)
      } catch (error) {
        throw new Error(`disk space preflight failed for ${targetDirectory}: ${error.message}`)
      }

      let identity = statfsIdentity(filesystem)
      if (!identity) {
        try {
          const metadata = await stat(targetDirectory)
          if (metadata?.dev != null) identity = `dev:${String(metadata.dev)}`
        } catch (error) {
          throw new Error(`disk filesystem preflight failed for ${targetDirectory}: ${error.message}`)
        }
      }
      return {
        availableBytes: statfsAvailableBytes(filesystem),
        identity,
      }
    }
  }

  function runStage(stage, stageIndex, args) {
    return new Promise((resolve, reject) => {
      let child
      try {
        child = spawn(ffmpegPath, args, { windowsHide: true })
      } catch (error) {
        reject(describeSpawnError(error, ffmpegPath))
        return
      }

      jobCtx.currentChild = child
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
      child.once('error', error => finish(describeSpawnError(error, ffmpegPath)))
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
        const stderrTail = tailLines.join('\n')
        const error = new Error(`ffmpeg exit ${code}: ${stderrTail}`)
        error.stderrTail = stderrTail
        error.phase = stage.kind
        error.code = code
        finish(error)
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
      warnCleanupFailure('unlink', file, error)
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
    const directory = await tempDirPromise
    try {
      await rmdir(directory)
    } catch (error) {
      if (error?.code !== 'ENOENT') warnCleanupFailure('rmdir', directory, error)
    }
  }

  function warnCleanupFailure(operation, targetPath, error) {
    const code = error?.code || error?.name || 'UNKNOWN'
    const key = `${operation}:${targetPath}:${code}`
    if (warnedCleanupFailures.has(key)) return
    warnedCleanupFailures.add(key)
    warn(`[ffmpegRunner] ${operation} failed for ${targetPath} (${code}): ${error?.message || error}`)
  }
}

export function estimateDiskSpaceBytes(jobPlan, fallbackDurationMs = jobPlan?.totalDurationMs) {
  const stages = jobPlan?.stages || []
  const outputSizes = new Map()
  const fallbackMs = positiveNumber(fallbackDurationMs, 1000)
  let liveBytes = 0
  let tempBytes = 0

  for (const stage of stages.slice(0, -1)) {
    const outputBytes = estimateStageOutputBytes(stage, fallbackMs)
    outputSizes.set(stage.output, outputBytes)
    liveBytes += outputBytes
    tempBytes = Math.max(tempBytes, liveBytes)

    for (const dependency of (stage.dependsOn || [])) {
      const dependencyBytes = outputSizes.get(dependency)
      if (dependencyBytes == null) continue
      liveBytes = Math.max(0, liveBytes - dependencyBytes)
      outputSizes.delete(dependency)
    }
  }

  const finalStage = stages.at(-1)
  const destinationBytes = finalStage
    ? estimateStageOutputBytes(finalStage, fallbackMs)
    : 0
  return {
    tempBytes: Math.ceil(tempBytes),
    destinationBytes: Math.ceil(destinationBytes),
  }
}

function estimateStageOutputBytes(stage, fallbackDurationMs) {
  const durationSec = positiveNumber(stage?.estimatedDurationMs, fallbackDurationMs) / 1000
  if (stage?.kind === 'audio') {
    return durationSec * PCM_F32LE_BYTES_PER_SECOND + WAV_HEADER_SLACK_BYTES
  }

  const spec = stage?.outputSpec || {}
  const width = positiveNumber(spec.width, 1920)
  const height = positiveNumber(spec.height, 1080)
  const fps = positiveNumber(spec.fps, 30)
  const videoBytes = durationSec * width * height * fps * VIDEO_BYTES_PER_PIXEL_FRAME
  const audioBytes = stage?.kind === 'final' ? durationSec * AAC_BYTES_PER_SECOND : 0
  return videoBytes + audioBytes + CONTAINER_OVERHEAD_BYTES
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
  if (stage.kind === 'audio') {
    return ['-c:a', 'pcm_f32le', '-ar', '48000', '-ac', '2']
  }
  const spec = stage.outputSpec
  if (!spec) throw new Error(`render ${stage.kind} stage is missing outputSpec`)

  const crf = String(spec.crf ?? 20)
  const preset = String(spec.preset ?? 'medium')
  const outputFrameRateArgs = ['-r', String(spec.fps ?? 30)]
  if (stage.kind === 'video') {
    return [
      '-c:v', 'libx264', '-preset', preset, '-crf', crf,
      '-pix_fmt', 'yuv420p', ...outputFrameRateArgs, '-an',
    ]
  }

  const audioBitrate = String(spec.audioBitrate ?? '192k')
  const videoArgs = graph.includes('[vout]')
    ? [
        '-c:v', 'libx264', '-preset', preset, '-crf', crf,
        '-pix_fmt', 'yuv420p', ...outputFrameRateArgs,
      ]
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

function statfsIdentity(filesystem) {
  if (filesystem?.fsid != null) return `fsid:${stableIdentityValue(filesystem.fsid)}`
  const mount = filesystem?.mount ?? filesystem?.mountpoint
  return mount == null ? null : `mount:${String(mount)}`
}

function stableIdentityValue(value) {
  if (typeof value === 'object') {
    if (Array.isArray(value)) return value.map(String).join(',')
    return Object.keys(value).sort().map(key => `${key}:${String(value[key])}`).join(',')
  }
  return String(value)
}

function sameFilesystem(left, right) {
  return Boolean(left.identity && right.identity && left.identity === right.identity)
}

function diskRequirementBytes(estimatedBytes) {
  return Math.ceil(estimatedBytes * DISK_SAFETY_FACTOR) + MIN_FREE_RESERVE_BYTES
}

function assertDiskAvailable(directory, role, requiredBytes, availableBytes) {
  if (availableBytes >= requiredBytes) return
  throw new Error(
    `insufficient disk space on ${role} volume ${directory}: ` +
    `required ${formatBytes(requiredBytes)}, available ${formatBytes(availableBytes)}`,
  )
}

function formatBytes(bytes) {
  const gib = Number(bytes) / (1024 ** 3)
  return `${gib.toFixed(2)} GiB`
}

function describeSpawnError(error, ffmpegPath) {
  if (error?.code !== 'ENOENT') return error
  return new Error(
    `ffmpeg executable not found at ${ffmpegPath}. ` +
    'In development, run "npm run install:platform-binaries"; packaged builds must include resources/ffmpeg.',
  )
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
