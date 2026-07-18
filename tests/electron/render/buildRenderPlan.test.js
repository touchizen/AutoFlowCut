import { describe, it, expect } from 'vitest'
import { buildRenderPlan, allocateFrames, outputSpec, computeTotalDurationMs } from '../../../electron/render/buildRenderPlan.js'

function makeScenes(count, duration = 1) {
  return Array.from({ length: count }, (_, index) => ({ id: `scene_${index + 1}`, duration }))
}

function makeResolved(scenes, audioClips = [], pathFor = scene => `/${scene.id}.png`) {
  return {
    images: new Map(scenes.map(scene => [scene.id, pathFor(scene)])),
    sfx: new Map(),
    audioClips,
  }
}

function makeOptions(scenes, cloudOverrides = {}, optionOverrides = {}) {
  return {
    renderMode: 'final',
    renderBurnSubtitle: false,
    ...optionOverrides,
    cloudRequest: {
      format: 'landscape',
      scaleMode: 'fill',
      kenBurns: { enabled: true, mode: 'pattern', scaleMin: 1, scaleMax: 1.3 },
      scenes,
      audioTracks: [],
      sfxItems: [],
      srtEntries: null,
      ...cloudOverrides,
    },
  }
}

function makeAudioClips(count, { startMs = 0, spacingMs = 100, durationMs = 500 } = {}) {
  return Array.from({ length: count }, (_, index) => ({
    filename: `clip_${index}.wav`,
    path: `/clip_${index}.wav`,
    startMs: startMs + index * spacingMs,
    durationMs,
    gain: 1,
  }))
}

describe('allocateFrames (cumulative boundaries, no per-scene rounding drift)', () => {
  it('sums to round(totalSec*fps)', () => {
    const durs = [3, 4, 3.5]
    const frames = allocateFrames(durs, 30)
    const total = durs.reduce((a, b) => a + b, 0)
    expect(frames.reduce((a, b) => a + b, 0)).toBe(Math.round(total * 30))
  })
  it('rejects a duration shorter than one output frame', () => {
    expect(() => allocateFrames([1, 0.01], 24))
      .toThrow(/scene 2.*0\.01.*one frame.*24 fps/i)
  })
})

describe('outputSpec', () => {
  it('portrait final is 1080x1920@30', () => {
    expect(outputSpec('portrait', 'final')).toMatchObject({
      width: 1080, height: 1920, fps: 30, upscale: 2, audioBitrate: '192k',
    })
  })
  it('landscape preview is 1280x720@24', () => {
    expect(outputSpec('landscape', 'preview')).toMatchObject({
      width: 1280, height: 720, fps: 24, upscale: 1.5, audioBitrate: '128k',
    })
  })
})

describe('computeTotalDurationMs (max of all endpoints)', () => {
  it('takes subtitle endMs when it exceeds video/audio', () => {
    const t = computeTotalDurationMs({ sceneEndMs: 5000, audioTracks: [{ timecodeMs: 0, durationMs: 4000 }], sfxStarts: [], subtitleEndMs: 8000 })
    expect(t).toBe(8000)
  })
  it('ignores null audioDuration and uses clip ends', () => {
    const t = computeTotalDurationMs({ sceneEndMs: 3000, audioTracks: [{ timecodeMs: 20000, durationMs: 2000 }], sfxStarts: [], subtitleEndMs: 0 })
    expect(t).toBe(22000)
  })
})

describe('buildRenderPlan', () => {
  const resolved = {
    images: new Map([['scene_1', '/a.png'], ['scene_2', '/b.png']]),
    sfx: new Map(),
    audioClips: [{ filename: 'nar.wav', path: '/nar.wav', startMs: 0, durationMs: 7000, gain: 1.0 }],
  }
  const options = { renderMode: 'final', renderBurnSubtitle: false, cloudRequest: {
    format: 'portrait', scaleMode: 'fill',
    kenBurns: { enabled: true, mode: 'random', scaleMin: 1.0, scaleMax: 1.3 },
    scenes: [{ id: 'scene_1', duration: 3 }, { id: 'scene_2', duration: 4 }],
    audioTracks: [], sfxItems: [], srtEntries: null,
  } }

  it('reports scene and audio clip counts (count assert)', () => {
    const plan = buildRenderPlan(resolved, options)
    expect(plan.sceneCount).toBe(2)
    expect(plan.audioClipCount).toBe(1)
  })
  it('produces at least a final stage', () => {
    const plan = buildRenderPlan(resolved, options)
    const final = plan.stages.find(stage => stage.kind === 'final')
    expect(final).toBeDefined()
    expect(final.outputSpec).toEqual(outputSpec('portrait', 'final'))
  })
  it('total duration covers the 7s narration past the 7s of scenes', () => {
    const plan = buildRenderPlan(resolved, options)
    expect(plan.totalDurationMs).toBe(7000)
  })
  it('holds the last frame before trimming when audio outlasts scenes', () => {
    const audioLonger = {
      ...resolved,
      audioClips: [{ filename: 'nar.wav', path: '/nar.wav', startMs: 0, durationMs: 8500, gain: 1 }],
    }
    const plan = buildRenderPlan(audioLonger, options)
    const graph = plan.stages.find(stage => stage.kind === 'final').filtergraphScript
    const tpad = 'tpad=stop_mode=clone:stop_duration=1.5'
    expect(plan.totalDurationMs).toBe(8500)
    expect(graph).toContain(tpad)
    expect(graph.indexOf(tpad)).toBeLessThan(graph.indexOf('trim=duration=8.5'))
  })
  it('matches golden filtergraph snapshot', () => {
    const plan = buildRenderPlan(resolved, options)
    expect(plan.stages.map(s => s.filtergraphScript)).toMatchSnapshot()
  })

  it('rejects an all-sub-frame project with the offending scene id', () => {
    const scenes = makeScenes(1000, 0.01)
    expect(() => buildRenderPlan(
      makeResolved(scenes),
      makeOptions(scenes, {}, { renderMode: 'preview' }),
    )).toThrow(/scene_1.*0\.01.*one frame.*24 fps/i)
  })
})

describe('buildRenderPlan staged audio', () => {
  const scenes = makeScenes(1, 3)

  it('mixes 33 clips through two leaf stages and one merge stage', () => {
    const clips = makeAudioClips(33, { startMs: 5000, spacingMs: 250 })
    const plan = buildRenderPlan(makeResolved(scenes, clips), makeOptions(scenes))
    const audioStages = plan.stages.filter(stage => stage.kind === 'audio')
    const leaves = audioStages.filter(stage => stage.dependsOn.length === 0)
    const merge = audioStages.at(-1)

    expect(plan.stages).toHaveLength(4)
    expect(audioStages).toHaveLength(3)
    expect(leaves).toHaveLength(2)
    expect(merge.dependsOn).toEqual(leaves.map(stage => stage.output))
    expect(leaves[0].filtergraphScript).toContain('adelay=250:all=1[a1]')
    expect(leaves[1].filtergraphScript).toContain('adelay=0:all=1[a0]')
  })

  it('builds a two-level merge tree for 32²+1 clips', () => {
    const clips = makeAudioClips(32 ** 2 + 1, { spacingMs: 2, durationMs: 100 })
    const plan = buildRenderPlan(makeResolved(scenes, clips), makeOptions(scenes))
    const audioStages = plan.stages.filter(stage => stage.kind === 'audio')
    const leaves = audioStages.filter(stage => stage.output.startsWith('AUDIO_LEVEL_00'))
    const levelOne = audioStages.filter(stage => stage.output.startsWith('AUDIO_LEVEL_01'))
    const levelTwo = audioStages.filter(stage => stage.output.startsWith('AUDIO_LEVEL_02'))

    expect(plan.stages).toHaveLength(37)
    expect(audioStages).toHaveLength(36)
    expect(leaves).toHaveLength(33)
    expect(levelOne).toHaveLength(2)
    expect(levelTwo).toHaveLength(1)
    expect(levelOne[0].dependsOn).toEqual(leaves.slice(0, 32).map(stage => stage.output))
    expect(levelOne[1].dependsOn).toEqual([leaves[32].output])
    expect(levelTwo[0].dependsOn).toEqual(levelOne.map(stage => stage.output))
  })

  it('restores a non-zero master baseStartMs in the final graph', () => {
    const clips = makeAudioClips(33, { startMs: 20000, spacingMs: 100 })
    const plan = buildRenderPlan(makeResolved(scenes, clips), makeOptions(scenes))
    const finalGraph = plan.stages.find(stage => stage.kind === 'final').filtergraphScript
    expect(finalGraph).toContain('adelay=20000:all=1[a0]')
  })

  it('stages audio when image and audio inputs only exceed the argv budget together', () => {
    const scenes = makeScenes(64, 1)
    const imagePath = scene => `/${scene.id}-${'i'.repeat(340)}.png`
    const clips = makeAudioClips(32).map((clip, index) => ({
      ...clip,
      path: `/audio-${index}-${'a'.repeat(340)}.wav`,
    }))
    const plan = buildRenderPlan(makeResolved(scenes, clips, imagePath), makeOptions(scenes))
    const audioStages = plan.stages.filter(stage => stage.kind === 'audio')
    const final = plan.stages.at(-1)

    expect(audioStages).toHaveLength(1)
    expect(final.inputs).toContain(audioStages[0].output)
    expect(final.inputs).not.toContain(clips[0].path)
  })

  it('chunks 32 audio clips by UTF-16 argv length even when the count limit is not exceeded', () => {
    const clips = makeAudioClips(32).map((clip, index) => ({
      ...clip,
      path: `/audio-${index}-${'긴'.repeat(900)}.wav`,
    }))
    const plan = buildRenderPlan(makeResolved(scenes, clips), makeOptions(scenes))
    const leaves = plan.stages.filter(stage => stage.kind === 'audio' && stage.dependsOn.length === 0)

    expect(leaves.length).toBeGreaterThan(1)
    for (const leaf of leaves) {
      const inputChars = leaf.inputs.reduce((sum, input) => sum + input.length + 7, 0)
      expect(inputChars + 8192).toBeLessThanOrEqual(32767)
    }
  })
})

describe('buildRenderPlan staged video', () => {
  it('segments >64 scenes, rebases subtitles, pads only the last segment, and marks concat demuxing', () => {
    const scenes = makeScenes(65, 1)
    const resolved = makeResolved(scenes, [
      { filename: 'nar.wav', path: '/nar.wav', startMs: 0, durationMs: 66000, gain: 1 },
    ])
    const options = makeOptions(scenes, {
      srtEntries: [{ startMs: 63500, endMs: 64500, text: 'boundary' }],
    }, { renderBurnSubtitle: true })
    const plan = buildRenderPlan(resolved, options)
    const segments = plan.stages.filter(stage => stage.kind === 'video' && !stage.concatDemuxer)
    const concat = plan.stages.find(stage => stage.concatDemuxer)

    expect(segments).toHaveLength(2)
    expect(segments[0].filtergraphScript).not.toContain('tpad=stop_mode=clone')
    expect(segments[1].filtergraphScript).toContain('tpad=stop_mode=clone:stop_duration=1')
    expect(segments[0].subtitleAss).toContain('0:01:03.50,0:01:04.00')
    expect(segments[1].subtitleAss).toContain('0:00:00.00,0:00:00.50')
    for (const segment of segments) {
      expect(segment.filtergraphScript)
        .toContain("subtitles=filename='__ASS_PATH__':fontsdir='__FONTS_DIR__'")
      expect(segment.outputSpec).toEqual(outputSpec('landscape', 'final'))
    }
    expect(concat).toMatchObject({ kind: 'video', concatDemuxer: true, filtergraphScript: '' })
    expect(concat.outputSpec).toBeUndefined()
    expect(concat.dependsOn).toEqual(segments.map(stage => stage.output))
  })

  it('segments when long input paths exceed the argv character budget', () => {
    const scenes = makeScenes(2, 1)
    const resolved = makeResolved(scenes, [], scene => `/${scene.id}-${'가'.repeat(13000)}.png`)
    const plan = buildRenderPlan(resolved, makeOptions(scenes))
    const segments = plan.stages.filter(stage => stage.kind === 'video' && !stage.concatDemuxer)
    const concat = plan.stages.find(stage => stage.concatDemuxer)

    expect(segments).toHaveLength(2)
    expect(segments.map(stage => stage.inputs.length)).toEqual([1, 1])
    expect(concat?.dependsOn).toEqual(segments.map(stage => stage.output))
  })
})

describe('buildRenderPlan subtitles and normalized SFX', () => {
  it('emits the ASS temp-file seam and extends duration to subtitle end', () => {
    const scenes = makeScenes(1, 3)
    const options = makeOptions(scenes, {
      subtitleFontSize: 7,
      srtEntries: [{ startMs: 2500, endMs: 5000, text: '자막' }],
    }, { renderBurnSubtitle: true })
    const plan = buildRenderPlan(makeResolved(scenes), options)
    const final = plan.stages.find(stage => stage.kind === 'final')

    expect(plan.totalDurationMs).toBe(5000)
    expect(final.subtitleAss).toContain('Dialogue:')
    expect(final.subtitleAss).toContain('자막')
    expect(final.filtergraphScript)
      .toContain("subtitles=filename='__ASS_PATH__':fontsdir='__FONTS_DIR__'")
    expect(final.filtergraphScript).not.toContain('data\\:text/plain;base64')
  })

  it('falls back to subtitleEn when srtEntries and a usable subtitleKo are absent', () => {
    const scenes = [{ id: 'scene_1', duration: 3, subtitleKo: '   ', subtitleEn: 'English fallback' }]
    const plan = buildRenderPlan(
      makeResolved(scenes),
      makeOptions(scenes, { srtEntries: null }, { renderBurnSubtitle: true }),
    )
    const final = plan.stages.find(stage => stage.kind === 'final')

    expect(final.subtitleAss).toContain('Dialogue:')
    expect(final.subtitleAss).toContain('English fallback')
  })

  it('uses normalized audioClips as the only SFX timing source', () => {
    const scenes = makeScenes(1, 1)
    const sfxClip = { filename: 'sfx.wav', path: '/sfx.wav', startMs: 1000, durationMs: 3000, gain: 0.7 }
    const options = makeOptions(scenes, {
      sfxItems: [{ sceneId: scenes[0].id, filename: 'sfx.wav', duration: 99 }],
    })
    const plan = buildRenderPlan(makeResolved(scenes, [sfxClip]), options)
    expect(plan.totalDurationMs).toBe(4000)
  })
})

describe('buildRenderPlan scale modes', () => {
  const scenes = makeScenes(1, 1)

  it('uses contain scaling and padding for fit mode', () => {
    const options = makeOptions(scenes, { format: 'landscape', scaleMode: 'fit' }, { renderMode: 'preview' })
    const graph = buildRenderPlan(makeResolved(scenes), options).stages.at(-1).filtergraphScript
    expect(graph).toContain('scale=w=1920:h=1080:force_original_aspect_ratio=decrease:flags=lanczos')
    expect(graph).toContain('pad=w=1920:h=1080:x=(ow-iw)/2:y=(oh-ih)/2:color=black')
  })

  it('uses crop and padding without aspect scaling for none mode', () => {
    const options = makeOptions(scenes, { format: 'landscape', scaleMode: 'none' }, { renderMode: 'preview' })
    const graph = buildRenderPlan(makeResolved(scenes), options).stages.at(-1).filtergraphScript
    expect(graph).toContain('scale=iw*1.5:ih*1.5:flags=lanczos')
    expect(graph).toContain("crop=w='min(iw,1920)':h='min(ih,1080)'")
    expect(graph).toContain('pad=w=1920:h=1080:x=(ow-iw)/2:y=(oh-ih)/2:color=black')
    expect(graph).not.toContain('force_original_aspect_ratio')
  })

  it('uses the 2x source upscale for none mode in the default final render path', () => {
    const options = makeOptions(scenes, { format: 'landscape', scaleMode: 'none' })
    const graph = buildRenderPlan(makeResolved(scenes), options).stages.at(-1).filtergraphScript
    expect(graph).toContain('scale=iw*2:ih*2:flags=lanczos')
    expect(graph).toContain("crop=w='min(iw,3840)':h='min(ih,2160)'")
  })

  it('uses a static zoom and centered anchor when Ken Burns is disabled', () => {
    const options = makeOptions(scenes, { kenBurns: { enabled: false } })
    const graph = buildRenderPlan(makeResolved(scenes), options).stages.at(-1).filtergraphScript
    expect(graph).toContain("zoompan=z='(1+(1-1)*on/29)'")
    expect(graph).toContain('(0.5+(0.5-0.5)*on/29)')
  })
})
