import { describe, it, expect, vi } from 'vitest'
import { EventEmitter } from 'events'
import { tmpdir } from 'node:os'
import {
  escapeFilterOptionValue,
  estimateDiskSpaceBytes,
  runFfmpegRender,
} from '../../../electron/render/ffmpegRunner.js'
import { buildRenderPlan } from '../../../electron/render/buildRenderPlan.js'

function fakeChild() {
  const child = new EventEmitter()
  child.stderr = new EventEmitter()
  child.kill = vi.fn()
  return child
}

function makeDeps(overrides = {}) {
  return {
    spawn: vi.fn(() => fakeChild()),
    ffmpegPath: '/ff',
    rename: vi.fn(async () => {}),
    unlink: vi.fn(async () => {}),
    outPath: '/final.mp4',
    totalDurationMs: 1000,
    fontsDir: '/fonts',
    writeFile: vi.fn(async () => {}),
    mkdtemp: vi.fn(async () => '/tmp/render-job'),
    rmdir: vi.fn(async () => {}),
    warn: vi.fn(),
    stat: vi.fn(async directory => ({ dev: directory === tmpdir() ? 2 : 1 })),
    statfs: vi.fn(async () => ({ bavail: 10_000_000, bsize: 4096 })),
    ...overrides,
  }
}

async function waitForSpawn(spawn, count = 1) {
  await vi.waitFor(() => expect(spawn).toHaveBeenCalledTimes(count))
}

const plan = {
  stages: [{
    kind: 'final',
    inputs: [],
    filtergraphScript: '[vout]',
    output: '/tmp/out.tmp.mp4',
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

describe('runFfmpegRender base lifecycle', () => {
  it('parses -progress and reports, then resolves on exit 0', async () => {
    const child = fakeChild()
    const spawn = vi.fn(() => child)
    const rename = vi.fn(async () => {})
    const onProgress = vi.fn()
    const ctx = { cancelled: false, tempFiles: [] }
    const deps = makeDeps({ spawn, rename })
    const promise = runFfmpegRender(plan, ctx, onProgress, deps)

    await waitForSpawn(spawn)
    expect(spawn.mock.calls[0][1]).toEqual(expect.arrayContaining([
      '-filter_complex_script', 'libx264', '-crf', '20', '-preset', 'medium', 'aac',
    ]))
    child.stderr.emit('data', Buffer.from('out_time_ms=500000\n'))
    child.emit('close', 0)

    const result = await promise
    expect(onProgress).toHaveBeenCalled()
    expect(rename).toHaveBeenCalledWith('/final.tmp-render.mp4', '/final.mp4')
    expect(deps.rmdir).toHaveBeenCalledWith('/tmp/render-job')
    expect(result.outPath).toBe('/final.mp4')
  })

  it('does not spawn when already cancelled and cleans temp', async () => {
    const spawn = vi.fn(() => fakeChild())
    const unlink = vi.fn(async () => {})
    const ctx = { cancelled: true, tempFiles: ['/tmp/out.tmp.mp4'] }
    const deps = makeDeps({ spawn, unlink, outPath: '/f.mp4' })

    await expect(runFfmpegRender(plan, ctx, () => {}, deps)).rejects.toThrow(/cancel/i)
    expect(spawn).not.toHaveBeenCalled()
    expect(unlink).toHaveBeenCalledWith('/tmp/out.tmp.mp4')
  })

  it('short-circuits an already-aborted external signal before preflight or spawn', async () => {
    const controller = new AbortController()
    controller.abort()
    const deps = makeDeps()

    await expect(runFfmpegRender(
      plan,
      { signal: controller.signal, cancelled: false, tempFiles: [] },
      () => {},
      deps,
    )).rejects.toThrow('render cancelled')
    expect(deps.statfs).not.toHaveBeenCalled()
    expect(deps.spawn).not.toHaveBeenCalled()
  })

  it('rejects with stderr tail on non-zero exit and never renames destination', async () => {
    const child = fakeChild()
    const spawn = vi.fn(() => child)
    const rename = vi.fn(async () => {})
    const ctx = { cancelled: false, tempFiles: [] }
    const deps = makeDeps({ spawn, rename, outPath: '/f.mp4' })
    const promise = runFfmpegRender(plan, ctx, () => {}, deps)

    await waitForSpawn(spawn)
    child.stderr.emit('data', Buffer.from('boom error\n'))
    child.emit('close', 1)

    let error
    try { await promise } catch (caught) { error = caught }
    expect(error.message).toMatch(/ffmpeg exit 1:.*boom error/s)
    expect(error.stderrTail).toBe('boom error')
    expect(error.phase).toBe('final')
    expect(error.code).toBe(1)
    expect(rename).not.toHaveBeenCalled()
  })

  it('explains how to stage ffmpeg when the development binary is missing', async () => {
    const child = fakeChild()
    const missing = Object.assign(new Error('spawn ENOENT'), { code: 'ENOENT' })
    const deps = makeDeps({
      ffmpegPath: '/app/vendor/ffmpeg/darwin-arm64/ffmpeg',
      spawn: vi.fn(() => child),
    })

    const render = runFfmpegRender(
      plan,
      { jobId: 'missing-ffmpeg', cancelled: false, tempFiles: [] },
      () => {},
      deps,
    )
    const rejection = expect(render).rejects
      .toThrow(/ffmpeg executable not found.*npm run install:platform-binaries/is)

    await waitForSpawn(deps.spawn)
    child.emit('error', missing)
    await rejection
  })

  it('keeps only the last 20 stderr lines in an error', async () => {
    const child = fakeChild()
    const deps = makeDeps({ spawn: vi.fn(() => child) })
    const promise = runFfmpegRender(plan, { cancelled: false, tempFiles: [] }, () => {}, deps)

    await waitForSpawn(deps.spawn)
    child.stderr.emit('data', Buffer.from(`${Array.from({ length: 25 }, (_, i) => `line-${i + 1}`).join('\n')}\n`))
    child.emit('close', 2)

    let error
    try { await promise } catch (caught) { error = caught }
    expect(error.message).toContain('line-25')
    expect(error.message).toContain('line-6')
    expect(error.message).not.toContain('line-5\n')
  })

  it('keeps real diagnostics while excluding progress protocol lines from the error tail', async () => {
    const child = fakeChild()
    const deps = makeDeps({ spawn: vi.fn(() => child) })
    const promise = runFfmpegRender(plan, { cancelled: false, tempFiles: [] }, () => {}, deps)

    await waitForSpawn(deps.spawn)
    const progressBlock = Array.from({ length: 25 }, (_, index) => [
      `frame=${index + 1}`,
      `out_time_ms=${(index + 1) * 1000}`,
      'progress=continue',
    ]).flat().join('\n')
    child.stderr.emit('data', Buffer.from(`real decoder failure\n${progressBlock}\n`))
    child.emit('close', 2)

    let error
    try { await promise } catch (caught) { error = caught }
    expect(error.message).toContain('real decoder failure')
    expect(error.message).not.toContain('progress=continue')
    expect(error.message).not.toContain('out_time_ms=')
  })

  it('renders the last stage to a unique sibling of the destination before rename', async () => {
    const child = fakeChild()
    const rename = vi.fn(async () => {})
    const deps = makeDeps({
      spawn: vi.fn(() => child),
      rename,
      outPath: '/exports/final.mp4',
    })
    const promise = runFfmpegRender(
      plan,
      { jobId: 'atomic-1', cancelled: false, tempFiles: [] },
      () => {},
      deps,
    )

    await waitForSpawn(deps.spawn)
    expect(deps.spawn.mock.calls[0][1].at(-1)).toBe('/exports/final.tmp-atomic-1.mp4')
    child.emit('close', 0)
    await promise
    expect(rename).toHaveBeenCalledWith('/exports/final.tmp-atomic-1.mp4', '/exports/final.mp4')
  })
})

describe('runFfmpegRender disk preflight and cleanup', () => {
  function splitVolumePlan() {
    const audioStage = (output, dependsOn = []) => ({
      kind: 'audio',
      inputs: [],
      filtergraphScript: '[aout]',
      output,
      dependsOn,
      subtitleAss: null,
      estimatedDurationMs: 8_000_000,
    })
    return {
      totalDurationMs: 3_000_000,
      stages: [
        audioStage('leaf-1.wav'),
        audioStage('leaf-2.wav'),
        audioStage('master.wav', ['leaf-1.wav', 'leaf-2.wav']),
        {
          kind: 'final',
          inputs: ['master.wav'],
          filtergraphScript: '[vout]',
          output: 'out.mp4',
          dependsOn: ['master.wav'],
          subtitleAss: null,
          estimatedDurationMs: 3_000_000,
          outputSpec: { width: 1920, height: 1080, fps: 30 },
        },
      ],
    }
  }

  it('refuses before spawning when estimated intermediates exceed free disk space', async () => {
    const deps = makeDeps({
      outPath: '/exports/final.mp4',
      statfs: vi.fn(async () => ({ bavail: 1, bsize: 1024 })),
    })

    await expect(runFfmpegRender(
      plan,
      { jobId: 'disk-full', cancelled: false, tempFiles: [] },
      () => {},
      deps,
    )).rejects.toThrow(/insufficient disk space.*required.*available/i)
    expect(deps.statfs).toHaveBeenCalledWith('/exports')
    expect(deps.spawn).not.toHaveBeenCalled()
  })

  it('checks the OS temp volume separately from the destination volume', async () => {
    const statfs = vi.fn(async directory => directory === '/exports'
      ? { bavail: 10_000_000, bsize: 4096 }
      : { bavail: 1, bsize: 1024 })
    const spawn = vi.fn(() => { throw new Error('spawned before temp-volume preflight') })

    await expect(runFfmpegRender(
      plan,
      { jobId: 'temp-disk-full', cancelled: false, tempFiles: [] },
      () => {},
      makeDeps({ outPath: '/exports/final.mp4', statfs, spawn }),
    )).rejects.toThrow(/insufficient disk space.*available/i)
    expect(statfs).toHaveBeenCalledWith('/exports')
    expect(statfs).toHaveBeenCalledWith(tmpdir())
    expect(spawn).not.toHaveBeenCalled()
  })

  it('requires only the final output peak on a separate destination volume', async () => {
    const gib = 1024 ** 3
    const reachedSpawn = new Error('spawn reached after split-volume preflight')
    const spawn = vi.fn(() => { throw reachedSpawn })
    const statfs = vi.fn(async directory => ({
      bavail: Math.floor((directory === '/exports' ? 5 * gib : 12 * gib) / 4096),
      bsize: 4096,
      fsid: directory === '/exports' ? 'destination-volume' : 'temp-volume',
    }))

    await expect(runFfmpegRender(
      splitVolumePlan(),
      { jobId: 'split-volume', cancelled: false, tempFiles: [] },
      () => {},
      makeDeps({ outPath: '/exports/final.mp4', statfs, spawn }),
    )).rejects.toThrow('spawn reached after split-volume preflight')
    expect(spawn).toHaveBeenCalledTimes(1)
  })

  it('combines temp and destination peaks when both paths share one filesystem', async () => {
    const gib = 1024 ** 3
    const statfs = vi.fn(async () => ({
      bavail: Math.floor(12 * gib / 4096),
      bsize: 4096,
      fsid: 'shared-volume',
    }))
    const spawn = vi.fn(() => { throw new Error('must not spawn') })

    await expect(runFfmpegRender(
      splitVolumePlan(),
      { jobId: 'shared-volume', cancelled: false, tempFiles: [] },
      () => {},
      makeDeps({ outPath: '/exports/final.mp4', statfs, spawn }),
    )).rejects.toThrow(/insufficient disk space.*shared filesystem/i)
    expect(spawn).not.toHaveBeenCalled()
  })

  it('keeps the peak estimate realistic but conservative for a 1000-clip staged render', () => {
    const scenes = [{ id: 'scene_1', duration: 3000 }]
    const audioClips = Array.from({ length: 1000 }, (_, index) => ({
      filename: `clip_${index}.wav`,
      path: `/clip_${index}.wav`,
      startMs: index * 3000,
      durationMs: 3000,
      gain: 1,
    }))
    const renderPlan = buildRenderPlan({
      images: new Map([['scene_1', '/image.png']]),
      sfx: new Map(),
      audioClips,
    }, {
      renderMode: 'final',
      renderBurnSubtitle: false,
      cloudRequest: {
        format: 'landscape',
        scaleMode: 'fill',
        kenBurns: { enabled: false },
        scenes,
        audioTracks: [],
        sfxItems: [],
        srtEntries: null,
      },
    })

    const estimates = estimateDiskSpaceBytes(renderPlan)
    const estimate = estimates.tempBytes + estimates.destinationBytes
    expect(estimate).toBeGreaterThan(3 * 1024 ** 3)
    expect(estimate).toBeLessThan(8 * 1024 ** 3)
  })

  it('untracks a temp file that was already absent', async () => {
    const missing = Object.assign(new Error('missing'), { code: 'ENOENT' })
    const unlink = vi.fn(async () => { throw missing })
    const ctx = { cancelled: true, tempFiles: ['/tmp/gone.wav'] }

    await expect(runFfmpegRender(plan, ctx, () => {}, makeDeps({ unlink })))
      .rejects.toThrow('render cancelled')
    expect(ctx.tempFiles).toEqual([])
  })

  it('warns once for a non-ENOENT unlink failure and keeps the file retryable', async () => {
    const unlinkError = Object.assign(new Error('locked'), { code: 'EACCES' })
    const unlink = vi.fn(async () => { throw unlinkError })
    const warn = vi.fn()
    const ctx = { cancelled: true, tempFiles: ['/tmp/locked.wav'] }

    await expect(runFfmpegRender(plan, ctx, () => {}, makeDeps({ unlink, warn })))
      .rejects.toThrow('render cancelled')
    expect(warn).toHaveBeenCalledTimes(1)
    expect(warn).toHaveBeenCalledWith(expect.stringMatching(/unlink.*\/tmp\/locked\.wav.*EACCES/i))
    expect(ctx.tempFiles).toContain('/tmp/locked.wav')
  })

  it('warns when removing the controlled temp directory fails', async () => {
    const child = fakeChild()
    const rmdirError = Object.assign(new Error('directory busy'), { code: 'EBUSY' })
    const warn = vi.fn()
    const deps = makeDeps({
      spawn: vi.fn(() => child),
      rmdir: vi.fn(async () => { throw rmdirError }),
      warn,
    })
    const render = runFfmpegRender(
      plan,
      { jobId: 'rmdir-warning', cancelled: false, tempFiles: [] },
      () => {},
      deps,
    )

    await waitForSpawn(deps.spawn)
    child.emit('close', 0)
    await render
    expect(warn).toHaveBeenCalledTimes(1)
    expect(warn).toHaveBeenCalledWith(expect.stringMatching(/rmdir.*\/tmp\/render-job.*EBUSY/i))
  })
})

describe('runFfmpegRender Task 5 seams', () => {
  it('escapes Windows drive colons, backslashes, and single quotes for filter options', () => {
    expect(escapeFilterOptionValue('C:\\Users\\a b\\sub.ass'))
      .toBe('C\\:\\\\Users\\\\a b\\\\sub.ass')
    expect(escapeFilterOptionValue("D:\\Kid's Fonts"))
      .toBe("D\\:\\\\Kid\\'\\''s Fonts")
    expect(escapeFilterOptionValue("C:\\Users\\O'Brien\\sub.ass"))
      .toBe("C\\:\\\\Users\\\\O\\'\\''Brien\\\\sub.ass")
  })

  it('writes ASS and substitutes filter-option-escaped Windows paths', async () => {
    const child = fakeChild()
    const writeFile = vi.fn(async () => {})
    const deps = makeDeps({
      spawn: vi.fn(() => child),
      writeFile,
      mkdtemp: vi.fn(async () => "C:\\Users\\O'Brien"),
      fontsDir: "D:\\Kid's Fonts",
    })
    const subtitlePlan = { stages: [{
      kind: 'final',
      inputs: [],
      filtergraphScript: "[v]subtitles=filename='__ASS_PATH__':fontsdir='__FONTS_DIR__'[vout]",
      output: 'out.mp4',
      dependsOn: [],
      subtitleAss: '[Script Info]\n',
      outputSpec: { width: 1920, height: 1080, fps: 30, crf: 20, preset: 'medium', audioBitrate: '192k' },
    }] }
    const ctx = { jobId: 'sub', cancelled: false, tempFiles: [] }
    const promise = runFfmpegRender(subtitlePlan, ctx, () => {}, deps)

    await waitForSpawn(deps.spawn)
    const graphWrite = writeFile.mock.calls.find(([path]) => path.endsWith('.filtergraph'))
    const graph = graphWrite[1]
    expect(writeFile).toHaveBeenCalledWith("C:\\Users\\O'Brien\\sub-stage-000.ass", '[Script Info]\n', 'utf8')
    expect(graph).toContain("filename='C\\:\\\\Users\\\\O\\'\\''Brien\\\\sub-stage-000.ass'")
    expect(graph).toContain("fontsdir='D\\:\\\\Kid\\'\\''s Fonts'")
    expect(graph).not.toContain("filename='C:")
    expect(ctx.tempFiles).toContain("C:\\Users\\O'Brien\\sub-stage-000.ass")

    child.emit('close', 0)
    await promise
  })

  it('writes an ffconcat list and uses concat demuxer stream-copy args', async () => {
    const child = fakeChild()
    const writeFile = vi.fn(async () => {})
    const deps = makeDeps({ spawn: vi.fn(() => child), writeFile })
    const concatPlan = { stages: [{
      kind: 'video',
      concatDemuxer: true,
      inputs: ["/tmp/O'Brien segment.mp4", '/tmp/segment-2.mp4'],
      filtergraphScript: '',
      output: 'joined.mp4',
      dependsOn: [],
      subtitleAss: null,
    }] }
    const promise = runFfmpegRender(concatPlan, { jobId: 'concat', cancelled: false, tempFiles: [] }, () => {}, deps)

    await waitForSpawn(deps.spawn)
    const args = deps.spawn.mock.calls[0][1]
    const listWrite = writeFile.mock.calls.find(([path]) => path.endsWith('.ffconcat'))
    expect(args).toEqual(expect.arrayContaining(['-f', 'concat', '-safe', '0', '-c', 'copy']))
    expect(args).not.toContain('-filter_complex_script')
    expect(listWrite[1]).toContain("file '/tmp/O'\\''Brien segment.mp4'")
    expect(listWrite[1]).toContain("file '/tmp/segment-2.mp4'")

    child.emit('close', 0)
    await promise
  })
})

describe('runFfmpegRender staged execution', () => {
  it('runs in order with pcm_f32le intermediates, final codecs, and monotonic phase progress', async () => {
    const audioChild = fakeChild()
    const finalChild = fakeChild()
    const spawn = vi.fn()
      .mockReturnValueOnce(audioChild)
      .mockReturnValueOnce(finalChild)
    const onProgress = vi.fn()
    const deps = makeDeps({ spawn })
    const stagedPlan = { stages: [
      {
        kind: 'audio', inputs: ['/clip.wav'], filtergraphScript: '[0:a]anull[aout]',
        output: 'master.wav', dependsOn: [], subtitleAss: null,
      },
      {
        kind: 'final', inputs: ['/image.png', 'master.wav'],
        filtergraphScript: '[0:v]null[vout];[1:a]anull[aout]', output: 'out.mp4',
        dependsOn: ['master.wav'], subtitleAss: null,
        outputSpec: { crf: 26, preset: 'veryfast', audioBitrate: '128k' },
      },
    ] }
    const ctx = { jobId: 'ordered', cancelled: false, tempFiles: [] }
    const promise = runFfmpegRender(stagedPlan, ctx, onProgress, deps)

    await waitForSpawn(spawn, 1)
    expect(spawn.mock.calls[0][1]).toContain('pcm_f32le')
    expect(spawn).toHaveBeenCalledTimes(1)
    audioChild.stderr.emit('data', Buffer.from('out_time_ms=800000\n'))
    audioChild.emit('close', 0)

    await waitForSpawn(spawn, 2)
    const finalArgs = spawn.mock.calls[1][1]
    expect(finalArgs).toEqual(expect.arrayContaining(['libx264', 'aac', '-crf', '26', '-preset', 'veryfast', '-b:a', '128k']))
    expect(finalArgs).toContain('/tmp/render-job/master.wav')
    finalChild.stderr.emit('data', Buffer.from('out_time_ms=100000\n'))
    finalChild.emit('close', 0)

    await promise
    const percents = onProgress.mock.calls.map(([event]) => event.percent)
    expect(percents).toEqual([...percents].sort((a, b) => a - b))
    expect(percents.at(-1)).toBe(100)
    expect(onProgress.mock.calls.map(([event]) => event.stage)).toEqual(expect.arrayContaining(['audio', 'final']))
  })

  it('fails loudly when an encoding stage only supplies the removed stage.spec seam', async () => {
    const deps = makeDeps()
    const obsoletePlan = { stages: [{
      kind: 'final',
      inputs: [],
      filtergraphScript: '[vout]',
      output: 'out.mp4',
      dependsOn: [],
      subtitleAss: null,
      spec: { fps: 24, crf: 26, preset: 'veryfast', audioBitrate: '128k' },
    }] }

    await expect(runFfmpegRender(
      obsoletePlan,
      { jobId: 'obsolete-spec', cancelled: false, tempFiles: [] },
      () => {},
      deps,
    )).rejects.toThrow(/missing outputSpec/i)
    expect(deps.spawn).not.toHaveBeenCalled()
  })

  it('uses preview encoding settings from a genuine buildRenderPlan output', async () => {
    const scenes = [{ id: 'scene_1', duration: 1 }]
    const renderPlan = buildRenderPlan({
      images: new Map([['scene_1', '/image.png']]),
      sfx: new Map(),
      audioClips: [],
    }, {
      renderMode: 'preview',
      renderBurnSubtitle: false,
      cloudRequest: {
        format: 'landscape',
        scaleMode: 'fill',
        kenBurns: { enabled: false },
        scenes,
        audioTracks: [],
        sfxItems: [],
        srtEntries: null,
      },
    })
    const child = fakeChild()
    const deps = makeDeps({
      spawn: vi.fn(() => child),
      totalDurationMs: renderPlan.totalDurationMs,
    })
    const promise = runFfmpegRender(
      renderPlan,
      { jobId: 'real-preview-plan', cancelled: false, tempFiles: [] },
      () => {},
      deps,
    )

    await waitForSpawn(deps.spawn)
    const args = deps.spawn.mock.calls[0][1]
    expect(renderPlan.stages.at(-1).outputSpec).toMatchObject({
      fps: 24,
      crf: 26,
      preset: 'veryfast',
      audioBitrate: '128k',
    })
    expect(args).toEqual(expect.arrayContaining([
      '-r', '24',
      '-c:v', 'libx264', '-crf', '26', '-preset', 'veryfast',
      '-c:a', 'aac', '-b:a', '128k',
    ]))

    child.emit('close', 0)
    await promise
  })

  it('pins video segment encoder output to the stage fps', async () => {
    const child = fakeChild()
    const deps = makeDeps({ spawn: vi.fn(() => child) })
    const segmentPlan = { stages: [{
      kind: 'video',
      inputs: ['/image.png'],
      filtergraphScript: '[0:v]null[vout]',
      output: 'segment.mp4',
      dependsOn: [],
      subtitleAss: null,
      outputSpec: { fps: 24, crf: 26, preset: 'veryfast' },
    }] }
    const promise = runFfmpegRender(
      segmentPlan,
      { jobId: 'segment-fps', cancelled: false, tempFiles: [] },
      () => {},
      deps,
    )

    await waitForSpawn(deps.spawn)
    expect(deps.spawn.mock.calls[0][1]).toEqual(expect.arrayContaining([
      '-r', '24', '-c:v', 'libx264', '-crf', '26', '-preset', 'veryfast',
    ]))

    child.emit('close', 0)
    await promise
  })

  it('stream-copies staged video when the final graph has no video output label', async () => {
    const child = fakeChild()
    const deps = makeDeps({ spawn: vi.fn(() => child) })
    const stagedVideoPlan = { stages: [{
      kind: 'final',
      inputs: ['/joined-video.mp4', '/audio.wav'],
      filtergraphScript: '[1:a]anull[aout]',
      output: 'out.mp4',
      dependsOn: [],
      subtitleAss: null,
      outputSpec: { crf: 20, preset: 'medium', audioBitrate: '192k' },
    }] }
    const promise = runFfmpegRender(
      stagedVideoPlan,
      { jobId: 'video-copy', cancelled: false, tempFiles: [] },
      () => {},
      deps,
    )

    await waitForSpawn(deps.spawn)
    const args = deps.spawn.mock.calls[0][1]
    expect(args).toEqual(expect.arrayContaining([
      '-map', '0:v:0?', '-c:v', 'copy', '-c:a', 'aac', '-b:a', '192k',
    ]))
    expect(args).not.toContain('libx264')
    expect(args).not.toContain('-crf')

    child.emit('close', 0)
    await promise
  })

  it('checks cancellation before the next stage spawn', async () => {
    const firstChild = fakeChild()
    const spawn = vi.fn(() => firstChild)
    const unlink = vi.fn(async () => {})
    const deps = makeDeps({ spawn, unlink })
    const twoStages = { stages: [
      { kind: 'audio', inputs: [], filtergraphScript: 'a', output: 'a.wav', dependsOn: [], subtitleAss: null },
      {
        kind: 'final', inputs: ['a.wav'], filtergraphScript: 'v', output: 'out.mp4',
        dependsOn: ['a.wav'], subtitleAss: null,
        outputSpec: { width: 1920, height: 1080, fps: 30, crf: 20, preset: 'medium', audioBitrate: '192k' },
      },
    ] }
    const ctx = { jobId: 'cancel-next', cancelled: false, tempFiles: [] }
    const promise = runFfmpegRender(twoStages, ctx, () => {}, deps)

    await waitForSpawn(spawn)
    ctx.cancelled = true
    firstChild.emit('close', 0)

    await expect(promise).rejects.toThrow('render cancelled')
    expect(spawn).toHaveBeenCalledTimes(1)
    expect(unlink).toHaveBeenCalled()
  })

  it('kills an active child on abort and waits for close before cleanup', async () => {
    const child = fakeChild()
    const controller = new AbortController()
    const unlink = vi.fn(async () => {})
    const deps = makeDeps({ spawn: vi.fn(() => child), unlink })
    const ctx = { jobId: 'abort', signal: controller.signal, cancelled: false, tempFiles: [] }
    const promise = runFfmpegRender(plan, ctx, () => {}, deps)

    await waitForSpawn(deps.spawn)
    controller.abort()
    expect(child.kill).toHaveBeenCalledWith('SIGKILL')
    expect(unlink).not.toHaveBeenCalled()
    child.emit('close', null, 'SIGKILL')

    await expect(promise).rejects.toThrow('render cancelled')
    expect(unlink).toHaveBeenCalled()
  })
})
