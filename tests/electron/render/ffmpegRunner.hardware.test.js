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
    expect(spawn).toHaveBeenCalledTimes(2)
    expect(deps.rename).not.toHaveBeenCalled()
  })
})
