// @vitest-environment node
import fs from 'node:fs'
import { mkdtemp, rm } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { execFileSync, spawn, spawnSync } from 'node:child_process'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { adaptAudioClips } from '../../electron/render/audioAdapter.js'
import { buildRenderPlan } from '../../electron/render/buildRenderPlan.js'
import { resolveFfmpegPath } from '../../electron/render/ffmpegPath.js'
import { runFfmpegRender } from '../../electron/render/ffmpegRunner.js'
import { resolveAndValidateInputs } from '../../electron/render/resolveInputs.js'
import { validateRenderRequest } from '../../electron/render/validateRequest.js'
import { verifyStagedFfmpeg } from '../../scripts/install-platform-binaries.cjs'

const projectRoot = path.resolve(__dirname, '..', '..')
const fontsDir = path.join(projectRoot, 'assets', 'fonts')
const vendorTarget = `${process.platform}-${process.arch}`
const vendorFfmpegPath = resolveFfmpegPath({
  isPackaged: false,
  appRoot: projectRoot,
  platform: process.platform,
  arch: process.arch,
})
const vendorFfmpegPresent = fs.existsSync(vendorFfmpegPath)

function executableFfmpeg(candidate) {
  if (!candidate || !fs.existsSync(candidate)) return false
  try {
    execFileSync(candidate, ['-version'], { stdio: 'ignore' })
    return true
  } catch {
    return false
  }
}

function findSystemFfmpeg() {
  if (process.env.AFC_RENDER_SMOKE_FORCE_MISSING === '1') return null
  const candidates = [
    process.env.AFC_TEST_FFMPEG,
    process.platform === 'darwin' && '/opt/homebrew/bin/ffmpeg',
    process.platform === 'darwin' && '/usr/local/bin/ffmpeg',
    process.platform === 'linux' && '/usr/bin/ffmpeg',
  ].filter(candidate => Boolean(candidate) && path.resolve(candidate) !== path.resolve(vendorFfmpegPath))
  for (const candidate of candidates) if (executableFfmpeg(candidate)) return candidate

  try {
    const lookup = process.platform === 'win32' ? 'where.exe' : 'which'
    const candidate = execFileSync(lookup, ['ffmpeg'], { encoding: 'utf8' }).trim().split(/\r?\n/)[0]
    if (path.resolve(candidate) === path.resolve(vendorFfmpegPath)) return null
    return executableFfmpeg(candidate) ? candidate : null
  } catch {
    return null
  }
}

const systemFfmpegPath = findSystemFfmpeg()
const systemFfmpegAvailable = Boolean(systemFfmpegPath)
const slowSmokeEnabled = process.env.AFC_SLOW_SMOKE === '1'
const slowFfmpegPath = vendorFfmpegPresent ? vendorFfmpegPath : systemFfmpegPath

function sceneStartsMs(scenes) {
  const starts = {}
  let elapsedMs = 0
  for (const scene of scenes) {
    starts[scene.id] = elapsedMs
    elapsedMs += Math.round(scene.duration * 1000)
  }
  return starts
}

function probeMp4(binaryPath, filePath) {
  const result = spawnSync(binaryPath, [
    '-hide_banner', '-i', filePath,
    '-map', '0:v:0', '-map', '0:a:0?',
    '-f', 'null', '-',
  ], { encoding: 'utf8' })
  if (result.status !== 0) throw new Error(`ffmpeg probe failed: ${result.stderr}`)

  const info = result.stderr
  const durationMatch = info.match(/Duration:\s*(\d+):(\d+):(\d+(?:\.\d+)?)/)
  const videoLine = info.split(/\r?\n/).find(line => line.includes('Stream #') && line.includes('Video:')) || ''
  const audioLine = info.split(/\r?\n/).find(line => line.includes('Stream #') && line.includes('Audio:')) || ''
  const sizeMatch = videoLine.match(/(\d{2,5})x(\d{2,5})/)
  const fpsMatch = videoLine.match(/(\d+(?:\.\d+)?)\s+fps/)
  const tbrMatch = videoLine.match(/(\d+(?:\.\d+)?)\s+tbr/)
  const durationSec = durationMatch
    ? Number(durationMatch[1]) * 3600 + Number(durationMatch[2]) * 60 + Number(durationMatch[3])
    : NaN

  return {
    width: Number(sizeMatch?.[1]),
    height: Number(sizeMatch?.[2]),
    fps: Number(tbrMatch?.[1] || fpsMatch?.[1]),
    averageFps: Number(fpsMatch?.[1]),
    videoCodec: videoLine.match(/Video:\s*([^\s,(]+)/)?.[1] || null,
    audioCodec: audioLine.match(/Audio:\s*([^\s,(]+)/)?.[1] || null,
    durationSec,
  }
}

async function createSmokeFixture(binaryPath, label) {
  const directory = await mkdtemp(path.join(os.tmpdir(), `afc-render-${label}-`))
  const redPng = path.join(directory, 'red.png')
  const bluePng = path.join(directory, 'blue.png')
  const toneWav = path.join(directory, 'tone.wav')
  try {
    for (const [colour, output] of [['red', redPng], ['blue', bluePng]]) {
      execFileSync(binaryPath, [
        '-y', '-hide_banner', '-loglevel', 'error',
        '-f', 'lavfi', '-i', `color=c=${colour}:s=2x2:d=0.1`,
        '-frames:v', '1', output,
      ])
    }
    execFileSync(binaryPath, [
      '-y', '-hide_banner', '-loglevel', 'error',
      '-f', 'lavfi', '-i', 'sine=frequency=440:sample_rate=48000:duration=0.5',
      '-ac', '2', '-c:a', 'pcm_s16le', toneWav,
    ])
    return { directory, redPng, bluePng, toneWav }
  } catch (error) {
    await rm(directory, { recursive: true, force: true })
    throw error
  }
}

async function assembleAndRender({
  name,
  fixture,
  binaryPath,
  sceneCount = 2,
  sceneDuration = sceneCount > 64 ? 0.1 : 0.25,
  burnSubtitle = false,
  withAudio = true,
  audioClipCount = 1,
}) {
  const scenes = Array.from({ length: sceneCount }, (_, index) => ({
    id: `scene_${index + 1}`,
    duration: sceneDuration,
    subtitleKo: burnSubtitle && index === 0 ? '한글 자막 확인' : null,
    subtitleEn: null,
  }))
  const totalDurationMs = Math.round(sceneCount * sceneDuration * 1000)
  const effectiveAudioClipCount = withAudio ? audioClipCount : 0
  const audioTracks = Array.from({ length: effectiveAudioClipCount }, (_, index) => ({
    type: 'story_narration',
    filename: 'tone.wav',
    timecodeMs: effectiveAudioClipCount === 1 ? 0 : index * 50,
    durationMs: effectiveAudioClipCount === 1 ? totalDurationMs : 50,
  }))
  const cloudRequest = {
    format: 'landscape',
    scaleMode: 'fill',
    subtitleFontSize: 5,
    kenBurns: { enabled: false, mode: 'pattern', scaleMin: 1, scaleMax: 1 },
    scenes,
    audioTracks,
    sfxItems: [],
    srtEntries: burnSubtitle
      ? [{ startMs: 0, endMs: totalDurationMs, text: '한글 자막 확인' }]
      : null,
  }
  const prepared = {
    cloudRequest,
    mediaFiles: scenes.map((scene, index) => ({
      type: 'image',
      sceneId: scene.id,
      filename: `${scene.id}.png`,
      path: index % 2 === 0 ? fixture.redPng : fixture.bluePng,
    })),
    sfxFiles: [],
    audioFiles: effectiveAudioClipCount > 0
      ? [{ filename: 'tone.wav', path: fixture.toneWav }]
      : [],
  }
  const options = { renderMode: 'preview', renderBurnSubtitle: burnSubtitle }
  const request = { jobId: `smoke-${name}`, prepared, options }

  expect(validateRenderRequest(request)).toEqual({ ok: true })
  const resolved = await resolveAndValidateInputs(prepared, { jobId: request.jobId })
  resolved.audioClips = await adaptAudioClips(cloudRequest, resolved, sceneStartsMs(scenes))
  const plan = buildRenderPlan(resolved, { ...options, cloudRequest })
  const outPath = path.join(fixture.directory, `${name}.mp4`)
  let ffmpegStderr = ''
  const captureSpawn = (command, args, spawnOptions) => {
    const child = spawn(command, args, spawnOptions)
    child.stderr?.on('data', chunk => { ffmpegStderr += chunk.toString() })
    return child
  }

  await runFfmpegRender(
    plan,
    { jobId: request.jobId, cancelled: false, tempFiles: [] },
    () => {},
    {
      ffmpegPath: binaryPath,
      fontsDir,
      outPath,
      totalDurationMs: plan.totalDurationMs,
      spawn: captureSpawn,
    },
  )
  expect(fs.statSync(outPath).size).toBeGreaterThan(0)
  const observed = probeMp4(binaryPath, outPath)
  if (process.env.AFC_RENDER_SMOKE_LOG === '1') {
    console.info(`[render-smoke] ${name} ${JSON.stringify(observed)}`)
    console.info(`[render-smoke] ${name} stages ${ffmpegStderr.split(/\r?\n/).filter(line => /^(?:frame|out_time|progress)=/.test(line)).join(' | ')}`)
  }
  return { plan, observed, ffmpegStderr }
}

describe.skipIf(!systemFfmpegAvailable)('self-render system ffmpeg smoke', () => {
  let fixture

  beforeAll(async () => {
    fixture = await createSmokeFixture(systemFfmpegPath, 'system-smoke')
  }, 30_000)

  afterAll(async () => {
    if (fixture) await rm(fixture.directory, { recursive: true, force: true })
  })

  it('runs validate → resolve → adapt → plan → runner and emits preview H.264/AAC', async () => {
    const { observed } = await assembleAndRender({
      name: 'basic', fixture, binaryPath: systemFfmpegPath,
    })

    expect(observed).toMatchObject({
      width: 1280,
      height: 720,
      fps: 24,
      videoCodec: 'h264',
      audioCodec: 'aac',
    })
    expect(observed.durationSec).toBeGreaterThanOrEqual(0.45)
    expect(observed.durationSec).toBeLessThanOrEqual(0.60)
  }, 60_000)

  it('burns Korean with the bundled NanumGothic face selected directly by libass', async () => {
    const { observed, ffmpegStderr } = await assembleAndRender({
      name: 'korean', fixture, binaryPath: systemFfmpegPath, burnSubtitle: true,
    })

    expect(observed.durationSec).toBeGreaterThanOrEqual(0.45)
    expect(ffmpegStderr).toMatch(/Loading font file .*NanumGothic\.ttc/i)
    expect(ffmpegStderr).toMatch(/fontselect: \(NanumGothic,.*\)\s*->\s*NanumGothic,\s*0,\s*NanumGothic/i)
  }, 60_000)

  it('renders >K_VIDEO through segment encodes and concat-demuxer stream copy', async () => {
    const { plan, observed } = await assembleAndRender({
      name: 'staged-concat',
      fixture,
      binaryPath: systemFfmpegPath,
      sceneCount: 65,
      withAudio: false,
    })

    expect(plan.stages.some(stage => stage.concatDemuxer === true)).toBe(true)
    expect(plan.stages.filter(stage => stage.kind === 'video' && !stage.concatDemuxer)).toHaveLength(2)
    expect(observed).toMatchObject({ width: 1280, height: 720, fps: 24, videoCodec: 'h264' })
    expect(observed.durationSec).toBeGreaterThanOrEqual(6.40)
    expect(observed.durationSec).toBeLessThanOrEqual(6.60)
  }, 120_000)
})

describe.skipIf(!vendorFfmpegPresent)('self-render staged vendor ffmpeg smoke', () => {
  let fixture

  afterAll(async () => {
    if (fixture) await rm(fixture.directory, { recursive: true, force: true })
  })

  it('passes checksum, architecture, self-containment, and capability gates before rendering', async () => {
    expect(verifyStagedFfmpeg(vendorFfmpegPath, vendorTarget)).toBe(true)
    fixture = await createSmokeFixture(vendorFfmpegPath, 'vendor-smoke')
    const { observed } = await assembleAndRender({
      name: 'vendor-packable', fixture, binaryPath: vendorFfmpegPath,
    })

    expect(observed).toMatchObject({
      width: 1280,
      height: 720,
      fps: 24,
      videoCodec: 'h264',
      audioCodec: 'aac',
    })
    expect(observed.durationSec).toBeGreaterThanOrEqual(0.45)
    expect(observed.durationSec).toBeLessThanOrEqual(0.60)
  }, 60_000)
})

describe.skipIf(!slowSmokeEnabled || !slowFfmpegPath)('self-render 1000-scene slow smoke', () => {
  let fixture

  afterAll(async () => {
    if (fixture) await rm(fixture.directory, { recursive: true, force: true })
  })

  it('renders 1000 scenes plus a staged audio tree without argv or FD failures', async () => {
    if (slowFfmpegPath === vendorFfmpegPath) {
      expect(verifyStagedFfmpeg(vendorFfmpegPath, vendorTarget)).toBe(true)
    }
    fixture = await createSmokeFixture(slowFfmpegPath, 'slow-smoke')
    const { plan, observed, ffmpegStderr } = await assembleAndRender({
      name: 'slow-1000',
      fixture,
      binaryPath: slowFfmpegPath,
      sceneCount: 1000,
      sceneDuration: 0.1,
      audioClipCount: 40,
    })

    expect(plan.sceneCount).toBe(1000)
    expect(plan.audioClipCount).toBe(40)
    expect(plan.stages.filter(stage => stage.kind === 'audio')).toHaveLength(3)
    expect(plan.stages.filter(stage => stage.kind === 'video' && !stage.concatDemuxer)).toHaveLength(16)
    expect(plan.stages.some(stage => stage.concatDemuxer === true)).toBe(true)
    expect(observed).toMatchObject({
      width: 1280,
      height: 720,
      fps: 24,
      videoCodec: 'h264',
      audioCodec: 'aac',
    })
    expect(observed.durationSec).toBeGreaterThanOrEqual(99.8)
    expect(observed.durationSec).toBeLessThanOrEqual(100.2)
    expect(ffmpegStderr).not.toMatch(/argument list too long|too many open files/i)
  }, 600_000)
})
