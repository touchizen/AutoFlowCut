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

const projectRoot = path.resolve(__dirname, '..', '..')
const fontsDir = path.join(projectRoot, 'assets', 'fonts')

function executableFfmpeg(candidate) {
  if (!candidate || !fs.existsSync(candidate)) return false
  try {
    execFileSync(candidate, ['-version'], { stdio: 'ignore' })
    return true
  } catch {
    return false
  }
}

function findFfmpeg() {
  if (process.env.AFC_RENDER_SMOKE_FORCE_MISSING === '1') return null
  const vendor = resolveFfmpegPath({
    isPackaged: false,
    appRoot: projectRoot,
    platform: process.platform,
    arch: process.arch,
  })
  const candidates = [
    process.env.AFC_TEST_FFMPEG,
    vendor,
    process.platform === 'darwin' && '/opt/homebrew/bin/ffmpeg',
    process.platform === 'darwin' && '/usr/local/bin/ffmpeg',
    process.platform === 'linux' && '/usr/bin/ffmpeg',
  ].filter(Boolean)
  for (const candidate of candidates) if (executableFfmpeg(candidate)) return candidate

  try {
    const lookup = process.platform === 'win32' ? 'where.exe' : 'which'
    const candidate = execFileSync(lookup, ['ffmpeg'], { encoding: 'utf8' }).trim().split(/\r?\n/)[0]
    return executableFfmpeg(candidate) ? candidate : null
  } catch {
    return null
  }
}

const ffmpegPath = findFfmpeg()
const ffmpegAvailable = Boolean(ffmpegPath)

function sceneStartsMs(scenes) {
  const starts = {}
  let elapsedMs = 0
  for (const scene of scenes) {
    starts[scene.id] = elapsedMs
    elapsedMs += Math.round(scene.duration * 1000)
  }
  return starts
}

function probeMp4(filePath) {
  const result = spawnSync(ffmpegPath, [
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

describe.skipIf(!ffmpegAvailable)('self-render real ffmpeg smoke', () => {
  let fixtureDir
  let redPng
  let bluePng
  let toneWav

  beforeAll(async () => {
    fixtureDir = await mkdtemp(path.join(os.tmpdir(), 'afc-render-smoke-'))
    redPng = path.join(fixtureDir, 'red.png')
    bluePng = path.join(fixtureDir, 'blue.png')
    toneWav = path.join(fixtureDir, 'tone.wav')

    for (const [colour, output] of [['red', redPng], ['blue', bluePng]]) {
      execFileSync(ffmpegPath, [
        '-y', '-hide_banner', '-loglevel', 'error',
        '-f', 'lavfi', '-i', `color=c=${colour}:s=64x64:d=0.1`,
        '-frames:v', '1', output,
      ])
    }
    execFileSync(ffmpegPath, [
      '-y', '-hide_banner', '-loglevel', 'error',
      '-f', 'lavfi', '-i', 'sine=frequency=440:sample_rate=48000:duration=0.5',
      '-ac', '2', '-c:a', 'pcm_s16le', toneWav,
    ])
  }, 30_000)

  afterAll(async () => {
    if (fixtureDir) await rm(fixtureDir, { recursive: true, force: true })
  })

  async function assembleAndRender({ name, sceneCount = 2, burnSubtitle = false, withAudio = true }) {
    // Two or more frames per scene keeps concat timestamps meaningful; a
    // single isolated frame has no measurable end PTS in ffmpeg's concat filter.
    const duration = sceneCount > 64 ? 0.1 : 0.25
    const scenes = Array.from({ length: sceneCount }, (_, index) => ({
      id: `scene_${index + 1}`,
      duration,
      subtitleKo: burnSubtitle && index === 0 ? '한글 자막 확인' : null,
      subtitleEn: null,
    }))
    const totalDurationMs = Math.round(sceneCount * duration * 1000)
    const cloudRequest = {
      format: 'landscape',
      scaleMode: 'fill',
      subtitleFontSize: 5,
      kenBurns: { enabled: false, mode: 'pattern', scaleMin: 1, scaleMax: 1 },
      scenes,
      audioTracks: withAudio ? [{
        type: 'story_narration',
        filename: 'tone.wav',
        timecodeMs: 0,
        durationMs: totalDurationMs,
      }] : [],
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
        path: index % 2 === 0 ? redPng : bluePng,
      })),
      sfxFiles: [],
      audioFiles: withAudio ? [{ filename: 'tone.wav', path: toneWav }] : [],
    }
    const options = { renderMode: 'preview', renderBurnSubtitle: burnSubtitle }
    const request = { jobId: `smoke-${name}`, prepared, options }

    expect(validateRenderRequest(request)).toEqual({ ok: true })
    const resolved = await resolveAndValidateInputs(prepared, { jobId: request.jobId })
    resolved.audioClips = await adaptAudioClips(cloudRequest, resolved, sceneStartsMs(scenes))
    const plan = buildRenderPlan(resolved, { ...options, cloudRequest })
    const outPath = path.join(fixtureDir, `${name}.mp4`)
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
      { ffmpegPath, fontsDir, outPath, totalDurationMs: plan.totalDurationMs, spawn: captureSpawn },
    )
    expect(fs.statSync(outPath).size).toBeGreaterThan(0)
    const observed = probeMp4(outPath)
    if (process.env.AFC_RENDER_SMOKE_LOG === '1') {
      console.info(`[render-smoke] ${name} ${JSON.stringify(observed)}`)
      console.info(`[render-smoke] ${name} stages ${ffmpegStderr.split(/\r?\n/).filter(line => /^(?:frame|out_time|progress)=/.test(line)).join(' | ')}`)
    }
    return { plan, observed, ffmpegStderr }
  }

  it('runs validate → resolve → adapt → plan → runner and emits preview H.264/AAC', async () => {
    const { observed } = await assembleAndRender({ name: 'basic' })

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
    const { observed, ffmpegStderr } = await assembleAndRender({ name: 'korean', burnSubtitle: true })

    expect(observed.durationSec).toBeGreaterThanOrEqual(0.45)
    expect(ffmpegStderr).toMatch(/Loading font file .*NanumGothic\.ttc/i)
    expect(ffmpegStderr).toMatch(/fontselect: \(NanumGothic,.*\)\s*->\s*NanumGothic,\s*0,\s*NanumGothic/i)
  }, 60_000)

  it('renders >K_VIDEO through segment encodes and concat-demuxer stream copy', async () => {
    const { plan, observed } = await assembleAndRender({
      name: 'staged-concat',
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
