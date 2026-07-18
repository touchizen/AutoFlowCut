import { computeKenBurns } from './kenBurns.js'
import { buildAss } from './subtitleAss.js'
import { ASS_PATH_TOKEN, FONTS_DIR_TOKEN } from './filtergraphTokens.js'

const K_AUDIO = 32
const K_VIDEO = 64
const WINDOWS_ARGV_LIMIT_CHARS = 32767
const ARGV_FIXED_RESERVE_CHARS = 8192
const MAX_STAGE_INPUT_ARG_CHARS = WINDOWS_ARGV_LIMIT_CHARS - ARGV_FIXED_RESERVE_CHARS
const INPUT_ARG_OVERHEAD_CHARS = 7 // Approximate characters for ` -i "<path>" ` around each path.
export const DEFAULT_SCENE_DURATION_SEC = 3

const SPECS = {
  portrait: {
    final: { width: 1080, height: 1920, fps: 30, crf: 20, preset: 'medium', upscale: 2, audioBitrate: '192k' },
    preview: { width: 720, height: 1280, fps: 24, crf: 26, preset: 'veryfast', upscale: 1.5, audioBitrate: '128k' },
  },
  landscape: {
    final: { width: 1920, height: 1080, fps: 30, crf: 20, preset: 'medium', upscale: 2, audioBitrate: '192k' },
    preview: { width: 1280, height: 720, fps: 24, crf: 26, preset: 'veryfast', upscale: 1.5, audioBitrate: '128k' },
  },
}

export function outputSpec(format, renderMode) {
  return SPECS[format]?.[renderMode] || SPECS.landscape.final
}

export function allocateFrames(durationsSec, fps) {
  assertFrameDurations(durationsSec, fps)
  const frames = []
  let cumulativeSec = 0
  let previousBoundary = 0

  for (const durationSec of durationsSec) {
    cumulativeSec += durationSec
    const cumulativeBoundary = Math.round(cumulativeSec * fps)
    frames.push(cumulativeBoundary - previousBoundary)
    previousBoundary = cumulativeBoundary
  }

  return frames
}

export function computeTotalDurationMs({ sceneEndMs, audioTracks = [], subtitleEndMs = 0 }) {
  let maxEndMs = finiteNumber(sceneEndMs, 0)

  for (const track of audioTracks) {
    maxEndMs = Math.max(maxEndMs, track.startMs + track.durationMs)
  }

  return Math.max(maxEndMs, finiteNumber(subtitleEndMs, 0))
}

export function buildRenderPlan(resolved, options) {
  const cloudRequest = options.cloudRequest
  const spec = outputSpec(cloudRequest.format, options.renderMode)
  const scenes = cloudRequest.scenes || []
  const durationsSec = scenes.map(sceneDurationSec)
  assertFrameDurations(durationsSec, spec.fps, scenes.map((scene, index) => scene.id || index + 1))
  const frames = allocateFrames(durationsSec, spec.fps)
  const sceneEndMs = Math.round(durationsSec.reduce((sum, duration) => sum + duration, 0) * 1000)
  const audioClips = resolved.audioClips || []
  const sceneStartsMs = buildSceneStartsMs(scenes)
  const subtitleEntries = options.renderBurnSubtitle
    ? effectiveSubtitleEntries(cloudRequest, sceneStartsMs, sceneEndMs)
    : []
  const subtitleEndMs = subtitleEntries.reduce((endMs, entry) => {
    const start = Number(entry.startMs)
    const end = Number(entry.endMs)
    return Number.isFinite(start) && Number.isFinite(end) && end > start ? Math.max(endMs, end) : endMs
  }, 0)
  const totalDurationMs = computeTotalDurationMs({
    sceneEndMs,
    audioTracks: audioClips,
    subtitleEndMs,
  })

  const sceneContexts = scenes.map((scene, index) => ({
    scene,
    index,
    frames: frames[index],
    durationSec: durationsSec[index],
    startMs: sceneStartsMs[scene.id],
    endMs: index + 1 < scenes.length ? sceneStartsMs[scenes[index + 1].id] : sceneEndMs,
    imagePath: resolved.images.get(scene.id),
    kenBurns: cloudRequest.kenBurns?.enabled
      ? computeKenBurns(scene, index, cloudRequest.kenBurns)
      : staticKenBurns(),
  }))

  const stages = []
  const imageInputPaths = sceneContexts.map(context => context.imagePath)
  const audioInputPaths = audioClips.map(clip => clip.path)
  const stagedAudio = audioClips.length > 0 && (
    audioClips.length > K_AUDIO
    || exceedsArgvBudget(audioInputPaths)
    || exceedsArgvBudget([...imageInputPaths, ...audioInputPaths])
  ) ? buildAudioStages(audioClips) : null
  if (stagedAudio) stages.push(...stagedAudio.stages)

  const finalAudioInputPaths = stagedAudio ? [stagedAudio.output] : audioInputPaths
  const stagedVideo = needsVideoStages(sceneContexts, finalAudioInputPaths)
    ? buildVideoStages({
        sceneContexts,
        spec,
        scaleMode: cloudRequest.scaleMode,
        subtitleEntries,
        subtitleFontSize: cloudRequest.subtitleFontSize,
        sceneEndMs,
        totalDurationMs,
      })
    : null
  if (stagedVideo) stages.push(...stagedVideo.stages)

  stages.push(buildFinalStage({
    sceneContexts,
    audioClips,
    stagedAudio,
    stagedVideo,
    spec,
    scaleMode: cloudRequest.scaleMode,
    subtitleEntries,
    subtitleFontSize: cloudRequest.subtitleFontSize,
    sceneEndMs,
    totalDurationMs,
  }))

  return {
    stages,
    totalDurationMs,
    sceneCount: scenes.length,
    audioClipCount: audioClips.length,
  }
}

function buildFinalStage({
  sceneContexts,
  audioClips,
  stagedAudio,
  stagedVideo,
  spec,
  scaleMode,
  subtitleEntries,
  subtitleFontSize,
  sceneEndMs,
  totalDurationMs,
}) {
  const lines = []
  const inputs = []
  const dependsOn = []
  let subtitleAss = null
  let audioInputOffset

  if (stagedVideo) {
    inputs.push(stagedVideo.output)
    dependsOn.push(stagedVideo.output)
    audioInputOffset = 1
  } else {
    inputs.push(...sceneContexts.map(context => context.imagePath))
    const videoChains = sceneContexts.map((context, inputIndex) =>
      buildSceneChain({ context, inputIndex, spec, scaleMode })
    )
    subtitleAss = subtitleEntries.length > 0
      ? buildAss(subtitleEntries, {
          subtitleFontSize,
          outputWidth: spec.width,
          outputHeight: spec.height,
          offsetMs: 0,
        })
      : null
    lines.push(...buildVideoGraph({
      videoChains,
      sceneDurationMs: sceneEndMs,
      targetDurationMs: totalDurationMs,
      subtitleAss,
    }))
    audioInputOffset = sceneContexts.length
  }

  const finalAudioClips = stagedAudio
    ? [{
        path: stagedAudio.output,
        startMs: stagedAudio.baseStartMs,
        durationMs: stagedAudio.durationMs,
        gain: 1,
      }]
    : sortAudioClips(audioClips)

  inputs.push(...finalAudioClips.map(clip => clip.path))
  if (stagedAudio) dependsOn.push(stagedAudio.output)
  if (finalAudioClips.length > 0) {
    lines.push(...buildAudioGraph({
      clips: finalAudioClips,
      inputOffset: audioInputOffset,
      baseStartMs: 0,
      applyLimiter: true,
      targetDurationMs: totalDurationMs,
    }))
  }

  return {
    kind: 'final',
    inputs,
    filtergraphScript: lines.join(';\n'),
    output: 'OUT.mp4',
    dependsOn,
    subtitleAss,
    outputSpec: spec,
    estimatedDurationMs: totalDurationMs,
  }
}

function buildSceneChain({ context, inputIndex, spec, scaleMode }) {
  const canvasWidth = Math.round(spec.width * spec.upscale)
  const canvasHeight = Math.round(spec.height * spec.upscale)
  const lastFrame = Math.max(1, context.frames - 1)
  const progress = context.frames > 1 ? `on/${lastFrame}` : '0'
  const { startScale, endScale, startAnchor, endAnchor } = context.kenBurns
  const zoom = linearExpression(startScale, endScale, progress)
  const anchorX = linearExpression(startAnchor.x, endAnchor.x, progress)
  const anchorY = linearExpression(startAnchor.y, endAnchor.y, progress)
  const x = `max(0,min(iw-iw/zoom,(iw-iw/zoom)*${anchorX}))`
  const y = `max(0,min(ih-ih/zoom,(ih-ih/zoom)*${anchorY}))`
  const baseTransform = scaleTransform(scaleMode, canvasWidth, canvasHeight, spec.upscale)
  const label = `v${context.index}`
  const filter = [
    `[${inputIndex}:v]${baseTransform}`,
    `zoompan=z='${zoom}':x='${x}':y='${y}':d=${context.frames}:s=${spec.width}x${spec.height}:fps=${spec.fps}`,
    `setsar=1[${label}]`,
  ].join(',')

  return { label, filter }
}

function buildVideoGraph({ videoChains, sceneDurationMs, targetDurationMs, subtitleAss }) {
  if (videoChains.length === 0) return []

  const lines = videoChains.map(chain => chain.filter)
  const concatInputs = videoChains.map(chain => `[${chain.label}]`).join('')
  lines.push(`${concatInputs}concat=n=${videoChains.length}:v=1:a=0[vconcat]`)

  const filters = []
  const holdMs = Math.max(0, targetDurationMs - sceneDurationMs)
  if (holdMs > 0) filters.push(`tpad=stop_mode=clone:stop_duration=${formatSeconds(holdMs)}`)
  filters.push(`trim=duration=${formatSeconds(targetDurationMs)}`)
  filters.push('setpts=PTS-STARTPTS')
  if (hasAssDialogue(subtitleAss)) {
    filters.push(`subtitles=filename='${ASS_PATH_TOKEN}':fontsdir='${FONTS_DIR_TOKEN}'`)
  }
  filters.push('format=yuv420p')
  filters.push('setsar=1')
  lines.push(`[vconcat]${filters.join(',')}[vout]`)

  return lines
}

function scaleTransform(scaleMode, width, height, upscale) {
  if (scaleMode === 'fit') {
    return [
      `scale=w=${width}:h=${height}:force_original_aspect_ratio=decrease:flags=lanczos`,
      `pad=w=${width}:h=${height}:x=(ow-iw)/2:y=(oh-ih)/2:color=black`,
    ].join(',')
  }

  if (scaleMode === 'none') {
    return [
      `scale=iw*${formatNumber(upscale)}:ih*${formatNumber(upscale)}:flags=lanczos`,
      `crop=w='min(iw,${width})':h='min(ih,${height})':x=(iw-ow)/2:y=(ih-oh)/2`,
      `pad=w=${width}:h=${height}:x=(ow-iw)/2:y=(oh-ih)/2:color=black`,
    ].join(',')
  }

  return [
    `scale=w=${width}:h=${height}:force_original_aspect_ratio=increase:flags=lanczos`,
    `crop=w=${width}:h=${height}:x=(iw-ow)/2:y=(ih-oh)/2`,
  ].join(',')
}

function buildAudioStages(audioClips) {
  const orderedClips = sortAudioClips(audioClips)
  const stages = []
  let nodes = chunkByArgvBudget(orderedClips, clip => clip.path, K_AUDIO).map((clips, batchIndex) => {
    const baseStartMs = clips[0].startMs
    const endMs = clips.reduce(
      (maxEnd, clip) => Math.max(maxEnd, clip.startMs + clip.durationMs),
      baseStartMs,
    )
    const output = audioOutputName(0, batchIndex)
    stages.push({
      kind: 'audio',
      inputs: clips.map(clip => clip.path),
      filtergraphScript: buildAudioGraph({ clips, inputOffset: 0, baseStartMs }).join(';\n'),
      output,
      dependsOn: [],
      subtitleAss: null,
      estimatedDurationMs: endMs - baseStartMs,
    })
    return { path: output, output, baseStartMs, endMs }
  })

  let level = 1
  while (nodes.length > 1) {
    nodes = chunkByArgvBudget(nodes, node => node.output, K_AUDIO).map((children, batchIndex) => {
      const baseStartMs = children[0].baseStartMs
      const endMs = children.reduce((maxEnd, child) => Math.max(maxEnd, child.endMs), baseStartMs)
      const clips = children.map(child => ({
        path: child.output,
        startMs: child.baseStartMs,
        durationMs: child.endMs - child.baseStartMs,
        gain: 1,
      }))
      const output = audioOutputName(level, batchIndex)
      stages.push({
        kind: 'audio',
        inputs: children.map(child => child.output),
        filtergraphScript: buildAudioGraph({ clips, inputOffset: 0, baseStartMs }).join(';\n'),
        output,
        dependsOn: children.map(child => child.output),
        subtitleAss: null,
        estimatedDurationMs: endMs - baseStartMs,
      })
      return { path: output, output, baseStartMs, endMs }
    })
    level += 1
  }

  const master = nodes[0]
  return {
    stages,
    output: master.output,
    baseStartMs: master.baseStartMs,
    durationMs: master.endMs - master.baseStartMs,
  }
}

function buildAudioGraph({ clips, inputOffset, baseStartMs, applyLimiter = false, targetDurationMs }) {
  if (clips.length === 0) return []

  const lines = clips.map((clip, index) => {
    const durationMs = Math.max(0, clip.durationMs)
    const delayMs = Math.max(0, Math.round(clip.startMs - baseStartMs))
    const gain = clip.gain
    return [
      `[${inputOffset + index}:a]aresample=48000`,
      'aformat=sample_fmts=fltp:channel_layouts=stereo',
      `atrim=duration=${formatSeconds(durationMs)}`,
      'asetpts=PTS-STARTPTS',
      `volume=${formatNumber(gain)}`,
      `adelay=${delayMs}:all=1[a${index}]`,
    ].join(',')
  })

  const mixInputs = clips.map((_, index) => `[a${index}]`).join('')
  const mixFilters = [`amix=inputs=${clips.length}:normalize=0:dropout_transition=0`]
  if (applyLimiter) mixFilters.push('alimiter=level=false:latency=1')
  if (Number.isFinite(targetDurationMs)) {
    mixFilters.push('apad')
    mixFilters.push(`atrim=duration=${formatSeconds(targetDurationMs)}`)
    mixFilters.push('asetpts=PTS-STARTPTS')
  } else {
    mixFilters.push('aformat=sample_fmts=flt:sample_rates=48000:channel_layouts=stereo')
  }
  lines.push(`${mixInputs}${mixFilters.join(',')}[aout]`)

  return lines
}

function needsVideoStages(sceneContexts, finalAudioInputPaths = []) {
  if (sceneContexts.length > K_VIDEO) return true
  return exceedsArgvBudget([
    ...sceneContexts.map(context => context.imagePath),
    ...finalAudioInputPaths,
  ])
}

function buildVideoStages({ sceneContexts, spec, scaleMode, subtitleEntries, subtitleFontSize, sceneEndMs, totalDurationMs }) {
  const groups = chunkVideoContexts(sceneContexts)
  const segmentStages = groups.map((contexts, segmentIndex) => {
    const segmentStartMs = contexts[0].startMs
    const segmentSceneEndMs = contexts[contexts.length - 1].endMs
    const isLast = segmentIndex === groups.length - 1
    const segmentTargetMs = segmentSceneEndMs - segmentStartMs
      + (isLast ? Math.max(0, totalDurationMs - sceneEndMs) : 0)
    const segmentEntries = subtitleEntries
      .filter(entry => entry.endMs > segmentStartMs && entry.startMs < segmentSceneEndMs + (isLast ? Math.max(0, totalDurationMs - sceneEndMs) : 0))
      .map(entry => ({
        ...entry,
        startMs: Math.max(segmentStartMs, entry.startMs),
        endMs: Math.min(segmentStartMs + segmentTargetMs, entry.endMs),
      }))
    const subtitleAss = segmentEntries.length > 0
      ? buildAss(segmentEntries, {
          subtitleFontSize,
          outputWidth: spec.width,
          outputHeight: spec.height,
          offsetMs: segmentStartMs,
        })
      : null
    const videoChains = contexts.map((context, inputIndex) =>
      buildSceneChain({ context, inputIndex, spec, scaleMode })
    )
    const output = `VIDEO_SEGMENT_${String(segmentIndex).padStart(4, '0')}.mp4`
    return {
      kind: 'video',
      inputs: contexts.map(context => context.imagePath),
      filtergraphScript: buildVideoGraph({
        videoChains,
        sceneDurationMs: segmentSceneEndMs - segmentStartMs,
        targetDurationMs: segmentTargetMs,
        subtitleAss,
      }).join(';\n'),
      output,
      dependsOn: [],
      subtitleAss,
      outputSpec: spec,
      estimatedDurationMs: segmentTargetMs,
    }
  })

  if (segmentStages.length === 1) {
    return { stages: segmentStages, output: segmentStages[0].output }
  }

  const concatStage = {
    kind: 'video',
    concatDemuxer: true,
    inputs: segmentStages.map(stage => stage.output),
    filtergraphScript: '',
    output: 'VIDEO_CONCAT.mp4',
    dependsOn: segmentStages.map(stage => stage.output),
    subtitleAss: null,
    estimatedDurationMs: totalDurationMs,
  }
  return { stages: [...segmentStages, concatStage], output: concatStage.output }
}

function chunkVideoContexts(contexts) {
  return chunkByArgvBudget(contexts, context => context.imagePath, K_VIDEO)
}

function chunkByArgvBudget(items, pathFor, maxCount) {
  const groups = []
  let current = []
  let currentInputChars = 0

  for (const item of items) {
    const inputPath = String(pathFor(item))
    const inputChars = inputArgChars(inputPath)
    if (inputChars > MAX_STAGE_INPUT_ARG_CHARS) {
      throw new Error(`ffmpeg input path exceeds the argv budget: ${inputPath}`)
    }
    if (current.length > 0 && (
      current.length >= maxCount
      || currentInputChars + inputChars > MAX_STAGE_INPUT_ARG_CHARS
    )) {
      groups.push(current)
      current = []
      currentInputChars = 0
    }
    current.push(item)
    currentInputChars += inputChars
  }

  if (current.length > 0) groups.push(current)
  return groups
}

function exceedsArgvBudget(inputPaths) {
  return ARGV_FIXED_RESERVE_CHARS
    + inputPaths.reduce((total, inputPath) => total + inputArgChars(inputPath), 0)
    > WINDOWS_ARGV_LIMIT_CHARS
}

function inputArgChars(inputPath) {
  // JS string length is UTF-16 code units, matching CreateProcessW's command-line limit.
  return String(inputPath).length + INPUT_ARG_OVERHEAD_CHARS
}

function effectiveSubtitleEntries(cloudRequest, sceneStartsMs, sceneEndMs) {
  if (Array.isArray(cloudRequest.srtEntries)) return cloudRequest.srtEntries

  return (cloudRequest.scenes || []).flatMap((scene, index) => {
    const startMs = sceneStartsMs[scene.id]
    const nextScene = cloudRequest.scenes[index + 1]
    const endMs = nextScene ? sceneStartsMs[nextScene.id] : sceneEndMs
    const text = [scene.subtitleKo, scene.subtitleEn]
      .find(value => typeof value === 'string' && value.trim())
      ?.trim() || ''
    const entry = text ? [{ startMs, endMs, text }] : []
    return entry
  })
}

export function buildSceneStartsMs(scenes) {
  const starts = Object.create(null)  // '__proto__' 같은 씬 id 가 prototype 을 오염/무력화하지 않도록
  let cumulativeSec = 0
  scenes.forEach((scene) => {
    starts[scene.id] = Math.round(cumulativeSec * 1000)
    cumulativeSec += sceneDurationSec(scene)
  })
  return starts
}

function sortAudioClips(audioClips) {
  return [...audioClips].sort((a, b) => a.startMs - b.startMs)
}

function audioOutputName(level, batchIndex) {
  return `AUDIO_LEVEL_${String(level).padStart(2, '0')}_BATCH_${String(batchIndex).padStart(4, '0')}.wav`
}

export function sceneDurationSec(scene) {
  const duration = Number(scene.duration)
  return Number.isFinite(duration) && duration > 0 ? duration : DEFAULT_SCENE_DURATION_SEC
}

function assertFrameDurations(durationsSec, fps, sceneLabels = []) {
  durationsSec.forEach((durationSec, index) => {
    if (Number(durationSec) * fps >= 1) return
    const label = sceneLabels[index] ?? index + 1
    throw new Error(
      `scene ${label} duration ${formatNumber(durationSec)}s is shorter than one frame at ${fps} fps`,
    )
  })
}

function staticKenBurns() {
  return {
    startScale: 1,
    endScale: 1,
    startAnchor: { x: 0.5, y: 0.5 },
    endAnchor: { x: 0.5, y: 0.5 },
  }
}

function linearExpression(start, end, progress) {
  return `(${formatNumber(start)}+(${formatNumber(end)}-${formatNumber(start)})*${progress})`
}

function formatSeconds(durationMs) {
  return formatNumber(durationMs / 1000)
}

function formatNumber(value) {
  const rounded = Math.round(Number(value) * 1000000) / 1000000
  return Object.is(rounded, -0) ? '0' : String(rounded)
}

function finiteNumber(value, fallback) {
  const number = Number(value)
  return Number.isFinite(number) ? number : fallback
}

function hasAssDialogue(assText) {
  return typeof assText === 'string' && assText.includes('\nDialogue:')
}
