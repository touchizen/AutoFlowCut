import { EventEmitter } from 'node:events'
import { describe, expect, it, vi } from 'vitest'
import {
  codecArgs,
  runFfmpegRender,
} from '../../../electron/render/ffmpegRunner.js'

const videoStage = {
  kind: 'video',
  outputSpec: { fps: 24, crf: 26, preset: 'veryfast' },
}

const finalStage = {
  kind: 'final',
  outputSpec: { fps: 30, crf: 20, preset: 'medium', audioBitrate: '192k' },
}

describe('codecArgs software compatibility', () => {
  it('keeps the legacy video-only libx264 args byte-for-byte identical', () => {
    expect(codecArgs(videoStage, '[vout]', null)).toEqual([
      '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '26',
      '-pix_fmt', 'yuv420p', '-r', '24', '-an',
    ])
  })

  it('keeps the legacy final libx264 and AAC args byte-for-byte identical', () => {
    expect(codecArgs(finalStage, '[vout]', null)).toEqual([
      '-c:v', 'libx264', '-preset', 'medium', '-crf', '20',
      '-pix_fmt', 'yuv420p', '-r', '30',
      '-c:a', 'aac', '-b:a', '192k', '-ar', '48000',
    ])
  })

  it('keeps stream-copy video and final audio args when no vout is encoded', () => {
    expect(codecArgs(finalStage, '[aout]', 'h264_nvenc')).toEqual([
      '-c:v', 'copy',
      '-c:a', 'aac', '-b:a', '192k', '-ar', '48000',
    ])
  })
})

describe('codecArgs hardware mappings', () => {
  it('maps CRF inversely to VideoToolbox q:v and keeps video-only -an', () => {
    expect(codecArgs(finalStage, '[vout]', 'h264_videotoolbox')).toEqual([
      '-c:v', 'h264_videotoolbox', '-q:v', '61',
      '-pix_fmt', 'yuv420p', '-r', '30',
      '-c:a', 'aac', '-b:a', '192k', '-ar', '48000',
    ])
    expect(codecArgs(videoStage, '[vout]', 'h264_videotoolbox').at(-1)).toBe('-an')
  })

  it('uses NVENC VBR constant quality with the p5 preset', () => {
    expect(codecArgs(videoStage, '[vout]', 'h264_nvenc')).toEqual([
      '-c:v', 'h264_nvenc', '-preset', 'p5',
      '-rc', 'vbr', '-cq', '26', '-b:v', '0',
      '-pix_fmt', 'yuv420p', '-r', '24', '-an',
    ])
  })

  it('uses QSV global quality and nv12 while preserving final AAC args', () => {
    expect(codecArgs(finalStage, '[vout]', 'h264_qsv')).toEqual([
      '-c:v', 'h264_qsv', '-preset', 'medium',
      '-global_quality', '20', '-pix_fmt', 'nv12', '-r', '30',
      '-c:a', 'aac', '-b:a', '192k', '-ar', '48000',
    ])
  })

  it('uses AMF balanced CQP and nv12', () => {
    expect(codecArgs(videoStage, '[vout]', 'h264_amf')).toEqual([
      '-c:v', 'h264_amf', '-quality', 'balanced', '-rc', 'cqp',
      '-qp_i', '26', '-qp_p', '26', '-qp_b', '26',
      '-pix_fmt', 'nv12', '-r', '24', '-an',
    ])
  })
})

function fakeChild() {
  const child = new EventEmitter()
  child.stderr = new EventEmitter()
  child.kill = vi.fn()
  return child
}

function makeRenderDeps(overrides = {}) {
  return {
    ffmpegPath: '/vendor/ffmpeg-runner',
    outPath: '/exports/final.mp4',
    totalDurationMs: 1000,
    detectHardwareEncoder: vi.fn(async () => 'h264_nvenc'),
    spawn: vi.fn(() => fakeChild()),
    rename: vi.fn(async () => {}),
    unlink: vi.fn(async () => {}),
    rmdir: vi.fn(async () => {}),
    writeFile: vi.fn(async () => {}),
    mkdtemp: vi.fn(async () => '/tmp/render-hardware'),
    statfs: vi.fn(async () => ({ bavail: 10_000_000, bsize: 4096, fsid: 'test-volume' })),
    stat: vi.fn(async () => ({ dev: 1 })),
    warn: vi.fn(),
    ...overrides,
  }
}

const renderPlan = {
  totalDurationMs: 1000,
  stages: [{
    kind: 'final',
    inputs: [],
    filtergraphScript: '[vout]',
    output: 'out.mp4',
    dependsOn: [],
    subtitleAss: null,
    outputSpec: {
      width: 1920,
      height: 1080,
      fps: 30,
      crf: 20,
      preset: 'medium',
      audioBitrate: '192k',
    },
  }],
}

function segmentedRenderPlan() {
  const segments = [1, 2].map(index => ({
    kind: 'video',
    inputs: [`/image-${index}.png`],
    filtergraphScript: '[0:v]null[vout]',
    output: `segment-${index}.mp4`,
    dependsOn: [],
    subtitleAss: null,
    outputSpec: { fps: 24, crf: 26, preset: 'veryfast' },
  }))
  return {
    totalDurationMs: 2000,
    stages: [
      ...segments,
      {
        kind: 'video',
        concatDemuxer: true,
        inputs: segments.map(stage => stage.output),
        filtergraphScript: '',
        output: 'joined.mp4',
        dependsOn: segments.map(stage => stage.output),
        subtitleAss: null,
      },
    ],
  }
}

async function waitForSpawn(spawn, count) {
  await vi.waitFor(() => expect(spawn).toHaveBeenCalledTimes(count))
}

describe('runFfmpegRender hardware fallback', () => {
  it('uses the exact legacy stage command when detection finds no hardware', async () => {
    const child = fakeChild()
    const deps = makeRenderDeps({
      detectHardwareEncoder: vi.fn(async () => null),
      spawn: vi.fn(() => child),
    })
    const render = runFfmpegRender(
      renderPlan,
      { jobId: 'software-default', cancelled: false, tempFiles: [] },
      () => {},
      deps,
    )

    await waitForSpawn(deps.spawn, 1)
    expect(deps.spawn.mock.calls[0][1]).toEqual([
      '-y',
      '-filter_complex_script', '/tmp/render-hardware/software-default-stage-000.filtergraph',
      '-map', '[vout]',
      '-c:v', 'libx264', '-preset', 'medium', '-crf', '20',
      '-pix_fmt', 'yuv420p', '-r', '30',
      '-c:a', 'aac', '-b:a', '192k', '-ar', '48000',
      '-progress', 'pipe:2',
      '/exports/final.tmp-software-default.mp4',
    ])

    child.emit('close', 0)
    await render
  })

  it('deletes a failed hardware output before retrying once with exact libx264 args', async () => {
    const hardwareChild = fakeChild()
    const softwareChild = fakeChild()
    const spawn = vi.fn()
      .mockReturnValueOnce(hardwareChild)
      .mockReturnValueOnce(softwareChild)
    const unlink = vi.fn(async () => {})
    const deps = makeRenderDeps({ spawn, unlink })
    const render = runFfmpegRender(
      renderPlan,
      { jobId: 'hardware-fallback', cancelled: false, tempFiles: [] },
      () => {},
      deps,
    )
    const observed = render.then(value => ({ value }), error => ({ error }))

    await waitForSpawn(spawn, 1)
    hardwareChild.stderr.emit('data', Buffer.from('Cannot load libcuda\n'))
    hardwareChild.emit('close', 1)

    await waitForSpawn(spawn, 2)
    const hardwareArgs = spawn.mock.calls[0][1]
    const softwareArgs = spawn.mock.calls[1][1]
    expect(hardwareArgs).toEqual(expect.arrayContaining([
      '-c:v', 'h264_nvenc', '-preset', 'p5', '-rc', 'vbr', '-cq', '20',
    ]))
    expect(softwareArgs).toEqual(expect.arrayContaining([
      '-c:v', 'libx264', '-preset', 'medium', '-crf', '20',
      '-pix_fmt', 'yuv420p', '-r', '30',
    ]))
    expect(softwareArgs).not.toContain('h264_nvenc')
    expect(unlink).toHaveBeenCalledWith('/exports/final.tmp-hardware-fallback.mp4')
    expect(unlink.mock.invocationCallOrder[0]).toBeLessThan(spawn.mock.invocationCallOrder[1])

    softwareChild.emit('close', 0)
    const result = await observed
    expect(result.error).toBeUndefined()
    expect(result.value).toEqual({ outPath: '/exports/final.mp4' })
    expect(deps.rename).toHaveBeenCalledWith(
      '/exports/final.tmp-hardware-fallback.mp4',
      '/exports/final.mp4',
    )
  })

  it('propagates the software error when both attempts fail', async () => {
    const hardwareChild = fakeChild()
    const softwareChild = fakeChild()
    const spawn = vi.fn()
      .mockReturnValueOnce(hardwareChild)
      .mockReturnValueOnce(softwareChild)
    const deps = makeRenderDeps({ spawn })
    const render = runFfmpegRender(
      renderPlan,
      { jobId: 'both-fail', cancelled: false, tempFiles: [] },
      () => {},
      deps,
    )
    const observed = render.then(value => ({ value }), error => ({ error }))

    await waitForSpawn(spawn, 1)
    hardwareChild.stderr.emit('data', Buffer.from('hardware init failed\n'))
    hardwareChild.emit('close', 1)
    await waitForSpawn(spawn, 2)
    softwareChild.stderr.emit('data', Buffer.from('software encode failed\n'))
    softwareChild.emit('close', 2)

    const result = await observed
    expect(result.value).toBeUndefined()
    expect(result.error).toMatchObject({ code: 2, phase: 'final' })
    expect(result.error.message).toContain('software encode failed')
    expect(result.error.cause).toMatchObject({ code: 1, phase: 'final' })
    expect(result.error.cause.message).toContain('hardware init failed')
    expect(spawn).toHaveBeenCalledTimes(2)
    expect(deps.rename).not.toHaveBeenCalled()
  })

  it('warns and continues the software restart when a partial output is locked', async () => {
    const hardwareChild = fakeChild()
    const softwareChild = fakeChild()
    const spawn = vi.fn()
      .mockReturnValueOnce(hardwareChild)
      .mockReturnValueOnce(softwareChild)
    const locked = Object.assign(new Error('file busy'), { code: 'EBUSY' })
    const unlink = vi.fn(async () => { throw locked })
    const warn = vi.fn()
    const deps = makeRenderDeps({ spawn, unlink, warn })
    const render = runFfmpegRender(
      renderPlan,
      { jobId: 'locked-output', cancelled: false, tempFiles: [] },
      () => {},
      deps,
    )
    const observed = render.then(value => ({ value }), error => ({ error }))

    await waitForSpawn(spawn, 1)
    hardwareChild.emit('close', 1)
    await waitForSpawn(spawn, 2)
    expect(spawn.mock.calls[1][1]).toContain('libx264')
    expect(warn).toHaveBeenCalledWith(expect.stringMatching(/unlink.*EBUSY/i))

    softwareChild.emit('close', 0)
    const result = await observed
    expect(result.error).toBeUndefined()
  })

  it('restarts every segment in software before concat after a later hardware failure', async () => {
    const children = Array.from({ length: 5 }, () => fakeChild())
    const spawn = vi.fn()
    children.forEach(child => spawn.mockReturnValueOnce(child))
    const unlink = vi.fn(async () => {})
    const deps = makeRenderDeps({ spawn, unlink, totalDurationMs: 2000 })
    const render = runFfmpegRender(
      segmentedRenderPlan(),
      { jobId: 'mixed-segment-guard', cancelled: false, tempFiles: [] },
      () => {},
      deps,
    )
    const observed = render.then(value => ({ value }), error => ({ error }))

    await waitForSpawn(spawn, 1)
    children[0].emit('close', 0)
    await waitForSpawn(spawn, 2)
    children[1].stderr.emit('data', Buffer.from('hardware session exhausted\n'))
    children[1].emit('close', 1)
    await waitForSpawn(spawn, 3)
    children[2].emit('close', 0)
    await waitForSpawn(spawn, 4)
    children[3].emit('close', 0)
    await waitForSpawn(spawn, 5)
    children[4].emit('close', 0)

    const result = await observed
    expect(result.error).toBeUndefined()
    expect(spawn.mock.calls[0][1]).toEqual(expect.arrayContaining([
      '-i', '/image-1.png', '-c:v', 'h264_nvenc',
    ]))
    expect(spawn.mock.calls[1][1]).toEqual(expect.arrayContaining([
      '-i', '/image-2.png', '-c:v', 'h264_nvenc',
    ]))
    expect(spawn.mock.calls[2][1]).toEqual(expect.arrayContaining([
      '-i', '/image-1.png', '-c:v', 'libx264',
    ]))
    expect(spawn.mock.calls[3][1]).toEqual(expect.arrayContaining([
      '-i', '/image-2.png', '-c:v', 'libx264',
    ]))
    expect(spawn.mock.calls[2][1]).not.toContain('h264_nvenc')
    expect(spawn.mock.calls[3][1]).not.toContain('h264_nvenc')
    expect(spawn.mock.calls[4][1]).toEqual(expect.arrayContaining(['-c', 'copy']))
    expect(unlink).toHaveBeenCalledWith('/tmp/render-hardware/segment-1.mp4')
    expect(unlink).toHaveBeenCalledWith('/tmp/render-hardware/segment-2.mp4')
    const restartSpawnOrder = spawn.mock.invocationCallOrder[2]
    const resetUnlinks = unlink.mock.invocationCallOrder.slice(0, 2)
    expect(resetUnlinks.every(order => order < restartSpawnOrder)).toBe(true)
  })

  it('uses libx264 for segment 2 when segment 1 hardware encoding fails', async () => {
    const children = Array.from({ length: 4 }, () => fakeChild())
    const spawn = vi.fn()
    children.forEach(child => spawn.mockReturnValueOnce(child))
    const deps = makeRenderDeps({ spawn, totalDurationMs: 2000 })
    const render = runFfmpegRender(
      segmentedRenderPlan(),
      { jobId: 'later-segment-software', cancelled: false, tempFiles: [] },
      () => {},
      deps,
    )
    const observed = render.then(value => ({ value }), error => ({ error }))

    await waitForSpawn(spawn, 1)
    children[0].emit('close', 1)
    await waitForSpawn(spawn, 2)
    children[1].emit('close', 0)
    await waitForSpawn(spawn, 3)
    expect(spawn.mock.calls[2][1]).toEqual(expect.arrayContaining([
      '-i', '/image-2.png', '-c:v', 'libx264',
    ]))
    expect(spawn.mock.calls[2][1]).not.toContain('h264_nvenc')
    children[2].emit('close', 0)
    await waitForSpawn(spawn, 4)
    children[3].emit('close', 0)

    const result = await observed
    expect(result.error).toBeUndefined()
  })
})
