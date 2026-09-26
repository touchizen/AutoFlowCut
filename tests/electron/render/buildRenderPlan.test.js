import { describe, it, expect } from 'vitest'
import {
  DEFAULT_SCENE_DURATION_SEC,
  allocateFrames,
  buildRenderPlan,
  buildSceneStartsMs,
  computeTotalDurationMs,
  outputSpec,
  sceneDurationSec,
} from '../../../electron/render/buildRenderPlan.js'

function makeScenes(count, duration = 1) {
  return Array.from({ length: count }, (_, index) => ({ id: `scene_${index + 1}`, duration }))
}

function makeResolved(scenes, audioClips = [], pathFor = scene => `/${scene.id}.png`, videos = new Map()) {
  return {
    images: new Map(scenes.map(scene => [scene.id, pathFor(scene)])),
    videos,
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

function makeVideoOptions(scenes, segments, hasVideoSceneIds = segments.map(segment => segment.sceneId), overrides = {}) {
  return makeOptions(scenes, {}, {
    renderVideoSegments: segments,
    renderSceneMeta: Object.fromEntries(scenes.map(scene => [
      scene.id,
      { hasVideo: hasVideoSceneIds.includes(scene.id) },
    ])),
    ...overrides,
  })
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

describe('canonical scene timeline', () => {
  it('uses one three-second fallback and returns scene-id keyed start milliseconds', () => {
    const scenes = [
      { id: 'first', duration: 1.25 },
      { id: 'zero', duration: 0 },
      { id: 'missing' },
    ]

    expect(DEFAULT_SCENE_DURATION_SEC).toBe(3)
    expect(sceneDurationSec(scenes[0])).toBe(1.25)
    expect(sceneDurationSec(scenes[1])).toBe(DEFAULT_SCENE_DURATION_SEC)
    expect(sceneDurationSec(scenes[2])).toBe(DEFAULT_SCENE_DURATION_SEC)
    expect(buildSceneStartsMs(scenes)).toEqual({
      first: 0,
      zero: 1250,
      missing: 4250,
    })
  })

  it('handles a "__proto__" scene id without prototype pollution (null-proto map)', () => {
    const starts = buildSceneStartsMs([{ id: '__proto__', duration: 2 }, { id: 'scene_2', duration: 3 }])
    expect(starts['__proto__']).toBe(0)     // 실제 값이 저장됨(prototype 아님)
    expect(starts.scene_2).toBe(2000)
    expect(Object.getPrototypeOf(starts)).toBe(null)
  })
})

describe('computeTotalDurationMs (max of all endpoints)', () => {
  it('takes subtitle endMs when it exceeds video/audio', () => {
    const t = computeTotalDurationMs({ sceneEndMs: 5000, audioTracks: [{ startMs: 0, durationMs: 4000 }], subtitleEndMs: 8000 })
    expect(t).toBe(8000)
  })
  it('uses normalized clip ends', () => {
    const t = computeTotalDurationMs({ sceneEndMs: 3000, audioTracks: [{ startMs: 20000, durationMs: 2000 }], subtitleEndMs: 0 })
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
  it('pads black after the last scene (not frame-hold) when audio outlasts scenes', () => {
    const audioLonger = {
      ...resolved,
      audioClips: [{ filename: 'nar.wav', path: '/nar.wav', startMs: 0, durationMs: 8500, gain: 1 }],
    }
    const plan = buildRenderPlan(audioLonger, options)
    const graph = plan.stages.find(stage => stage.kind === 'final').filtergraphScript
    const tpad = 'tpad=stop_mode=add:stop_duration=1.5:color=black'
    expect(plan.totalDurationMs).toBe(8500)
    expect(graph).toContain(tpad)
    expect(graph).not.toContain('stop_mode=clone')
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

describe('buildRenderPlan visual video overlays', () => {
  it('composites a selected video with the measured timing recipe and disables Ken Burns', () => {
    const scenes = [{ id: 'scene_1', duration: 5 }]
    const segments = [{ sceneId: 'scene_1', source: 'i2v', inSec: 3, outSec: 5 }]
    const videos = new Map([['scene_1:i2v', '/scene_1-i2v.mp4']])
    const final = buildRenderPlan(
      makeResolved(scenes, [], undefined, videos),
      makeVideoOptions(scenes, segments),
    ).stages.at(-1)

    expect(final.inputs).toEqual(['/scene_1.png', '/scene_1-i2v.mp4'])
    expect(final.filtergraphScript).toContain('[1:v]scale=1920:1080:force_original_aspect_ratio=decrease')
    expect(final.filtergraphScript).toContain('pad=1920:1080:(ow-iw)/2:(oh-ih)/2:color=black,setsar=1')
    expect(final.filtergraphScript).toContain('trim=duration=2')
    expect(final.filtergraphScript).toContain('setpts=PTS-STARTPTS+3/TB')
    expect(final.filtergraphScript).toContain("overlay=(W-w)/2:(H-h)/2:enable='gte(t,3)*lt(t,5)':shortest=0:eof_action=repeat")
    expect(final.filtergraphScript).toContain("zoompan=z='(1+(1-1)*on/149)'")
    expect(final.filtergraphScript).not.toContain("zoompan=z='(1.3+")
  })

  it('keeps the existing image-only scene chain unchanged', () => {
    const scenes = [{ id: 'scene_1', duration: 1 }]
    const withoutVideoOptions = makeVideoOptions(scenes, [], [])
    const graph = buildRenderPlan(makeResolved(scenes), withoutVideoOptions).stages.at(-1).filtergraphScript

    expect(graph).toContain('[0:v]scale=w=3840:h=2160:force_original_aspect_ratio=increase:flags=lanczos')
    expect(graph).toContain("zoompan=z='(1+(1.3-1)*on/29)'")
    expect(graph).toContain('setsar=1[v0]')
    expect(graph).not.toContain('overlay=')
  })

  it('uses static Ken Burns for duration-null video metadata without adding an overlay input', () => {
    const scenes = [{ id: 'scene_1', duration: 1 }]
    const options = makeVideoOptions(scenes, [], ['scene_1'])
    const final = buildRenderPlan(makeResolved(scenes), options).stages.at(-1)

    expect(final.inputs).toEqual(['/scene_1.png'])
    expect(final.filtergraphScript).toContain("zoompan=z='(1+(1-1)*on/29)'")
    expect(final.filtergraphScript).not.toContain('overlay=')
  })

  it('indexes images before selected videos and starts audio after every visual input', () => {
    const scenes = makeScenes(3, 2)
    const segments = [
      { sceneId: 'scene_1', source: 'i2v', inSec: 1, outSec: 2 },
      { sceneId: 'scene_3', source: 't2v', inSec: 0, outSec: 2 },
    ]
    const videos = new Map([
      ['scene_1:i2v', '/scene_1-i2v.mp4'],
      ['scene_3:t2v', '/scene_3-t2v.mp4'],
    ])
    const audio = [{ filename: 'nar.wav', path: '/nar.wav', startMs: 0, durationMs: 6000, gain: 1 }]
    const final = buildRenderPlan(
      makeResolved(scenes, audio, undefined, videos),
      makeVideoOptions(scenes, segments),
    ).stages.at(-1)

    expect(final.inputs).toEqual([
      '/scene_1.png', '/scene_2.png', '/scene_3.png',
      '/scene_1-i2v.mp4', '/scene_3-t2v.mp4',
      '/nar.wav',
    ])
    expect(final.filtergraphScript).toContain('[0:v]')
    expect(final.filtergraphScript).toContain('[3:v]scale=1920:1080')
    expect(final.filtergraphScript).toContain('[2:v]')
    expect(final.filtergraphScript).toContain('[4:v]scale=1920:1080')
    expect(final.filtergraphScript).toContain('[5:a]aresample=48000')
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

  it('counts selected video paths when deciding whether combined visual and audio argv needs audio staging', () => {
    const scenes = makeScenes(1, 1)
    const segments = [{ sceneId: 'scene_1', source: 'i2v', inSec: 0, outSec: 1 }]
    const imagePath = () => `/${'i'.repeat(8200)}.png`
    const videoPath = `/${'v'.repeat(8200)}.mp4`
    const clips = [{ filename: 'a.wav', path: `/${'a'.repeat(8200)}.wav`, startMs: 0, durationMs: 1000, gain: 1 }]
    const videos = new Map([['scene_1:i2v', videoPath]])
    const plan = buildRenderPlan(
      makeResolved(scenes, clips, imagePath, videos),
      makeVideoOptions(scenes, segments),
    )

    expect(plan.stages.some(stage => stage.kind === 'audio')).toBe(true)
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
    expect(segments[0].filtergraphScript).not.toContain('tpad=stop_mode=add')
    expect(segments[1].filtergraphScript).toContain('tpad=stop_mode=add:stop_duration=1:color=black')
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

  it('bounds stages by visual input count and recomputes image/video indices locally', () => {
    const scenes = makeScenes(33, 1)
    const segments = scenes.map(scene => ({ sceneId: scene.id, source: 'i2v', inSec: 0, outSec: 1 }))
    const videos = new Map(scenes.map(scene => [`${scene.id}:i2v`, `/${scene.id}.mp4`]))
    const plan = buildRenderPlan(
      makeResolved(scenes, [], undefined, videos),
      makeVideoOptions(scenes, segments),
    )
    const stages = plan.stages.filter(stage => stage.kind === 'video' && !stage.concatDemuxer)

    expect(stages.map(stage => stage.inputs.length)).toEqual([64, 2])
    expect(stages[0].inputs.slice(0, 32)).toEqual(scenes.slice(0, 32).map(scene => `/${scene.id}.png`))
    expect(stages[0].inputs.slice(32)).toEqual(scenes.slice(0, 32).map(scene => `/${scene.id}.mp4`))
    expect(stages[0].filtergraphScript).toContain('[0:v]')
    expect(stages[0].filtergraphScript).toContain('[32:v]scale=1920:1080')
    expect(stages[0].filtergraphScript).toContain('[31:v]')
    expect(stages[0].filtergraphScript).toContain('[63:v]scale=1920:1080')
    expect(stages[1].filtergraphScript).toContain('[0:v]')
    expect(stages[1].filtergraphScript).toContain('[1:v]scale=1920:1080')
  })

  it('counts video path characters in both the staging trigger and per-stage argv chunks', () => {
    const scenes = makeScenes(2, 1)
    const segments = scenes.map(scene => ({ sceneId: scene.id, source: 'i2v', inSec: 0, outSec: 1 }))
    const videos = new Map(scenes.map((scene, index) => [
      `${scene.id}:i2v`,
      `/${scene.id}-${String(index).repeat(13000)}.mp4`,
    ]))
    const plan = buildRenderPlan(
      makeResolved(scenes, [], undefined, videos),
      makeVideoOptions(scenes, segments),
    )
    const stages = plan.stages.filter(stage => stage.kind === 'video' && !stage.concatDemuxer)

    expect(stages).toHaveLength(2)
    expect(stages.map(stage => stage.inputs.length)).toEqual([2, 2])
    expect(stages[0].filtergraphScript).toContain('[0:v]')
    expect(stages[0].filtergraphScript).toContain('[1:v]scale=1920:1080')
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

  it('uses the canonical fallback duration when timing scene-derived subtitles', () => {
    const scenes = [
      { id: 'scene_1', duration: 0, subtitleKo: 'fallback duration' },
      { id: 'scene_2', duration: 1, subtitleKo: 'next scene' },
    ]
    const plan = buildRenderPlan(
      makeResolved(scenes),
      makeOptions(scenes, { srtEntries: null }, { renderBurnSubtitle: true }),
    )

    expect(plan.stages.at(-1).subtitleAss).toContain('0:00:00.00,0:00:03.00')
    expect(plan.stages.at(-1).subtitleAss).toContain('0:00:03.00,0:00:04.00')
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
