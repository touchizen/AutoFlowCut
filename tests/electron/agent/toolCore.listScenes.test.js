// @vitest-environment node
import { describe, expect, it, vi } from 'vitest'
import { createToolCore } from '../../../electron/agent/toolCore.js'

const TOKEN = 'list-scenes-token'
const SCENE_DTO_KEYS = [
  'duration',
  'endTime',
  'hasImage',
  'hasVideoI2V',
  'hasVideoT2V',
  'ordinal',
  'prompt',
  'rendererSceneId',
  'startTime',
  'status',
  'storyId',
  'subtitle',
  'videoI2VPrompt',
  'videoT2VPrompt',
]

function rendererScene(id, overrides = {}) {
  return {
    id,
    storyId: null,
    status: 'done',
    subtitle: `${id} subtitle`,
    prompt: `${id} image prompt`,
    videoT2VPrompt: `${id} t2v prompt`,
    videoI2VPrompt: `${id} i2v prompt`,
    hasImage: true,
    videoT2VPath: `/project/videos/${id}.t2v.mp4`,
    videoI2VPath: `/project/videos/${id}.i2v.mp4`,
    startTime: 0,
    endTime: 3,
    duration: 3,
    ...overrides,
  }
}

function makeHarness({
  scenes = [],
  state = { sceneMode: 'audio-first', scenes: [] },
  snapshotMode = 'audio-first',
  hasProject = true,
  withBridge = true,
} = {}) {
  const storyCommands = {
    hasProject: () => hasProject,
    projectToken: TOKEN,
    projectPath: '/project',
    getState: vi.fn(async () => state),
  }
  const toolBridge = withBridge
    ? {
        invoke: vi.fn(async (name) => {
          if (name === 'scene.snapshot') return { sceneMode: snapshotMode, scenes }
          throw new Error(`unexpected bridge call: ${name}`)
        }),
      }
    : undefined
  const imageReader = {
    exists: vi.fn(async () => true),
    decodeFile: vi.fn(async () => ({
      isEmpty: false,
      width: 100,
      height: 100,
      toBlock: () => ({ data: 'IMAGE_BLOCK', mimeType: 'image/png' }),
    })),
  }
  const core = createToolCore({ toolBridge, imageReader, projectToken: TOKEN })
  core.use(storyCommands)
  return { core, storyCommands, toolBridge }
}

describe('list_scenes — renderer scene authority', () => {
  it('Story 씬이 비어 있고 sceneMode가 없어도 renderer 전체 씬을 ordinal 순서로 나열한다', async () => {
    const scenes = [
      rendererScene('renderer-a', { storyId: 'story-a' }),
      rendererScene('renderer-b', { hasImage: false }),
      rendererScene('renderer-c'),
    ]
    const { core } = makeHarness({ scenes, state: { scenes: [] } })

    const result = await core.call('list_scenes')

    expect(result).toMatchObject({
      status: 'done',
      source: 'renderer',
      sceneMode: 'audio-first',
      errors: [],
    })
    expect(result.scenes.map(({ ordinal, rendererSceneId, hasImage }) => (
      { ordinal, rendererSceneId, hasImage }
    ))).toEqual([
      { ordinal: 1, rendererSceneId: 'renderer-a', hasImage: true },
      { ordinal: 2, rendererSceneId: 'renderer-b', hasImage: false },
      { ordinal: 3, rendererSceneId: 'renderer-c', hasImage: true },
    ])
  })

  it('중간 씬 삭제 뒤 list_scenes와 get_scene_images의 ordinal이 같은 renderer 씬으로 함께 이동한다', async () => {
    const scenes = [
      rendererScene('renderer-a'),
      rendererScene('renderer-b'),
      rendererScene('renderer-c'),
    ]
    const { core } = makeHarness({ scenes })

    const beforeList = await core.call('list_scenes')
    const beforeImages = await core.call('get_scene_images', { sceneNumbers: [2] })
    expect(beforeList.scenes[1].rendererSceneId).toBe('renderer-b')
    expect(beforeImages.images[0].rendererSceneId).toBe('renderer-b')

    scenes.splice(1, 1)

    const afterList = await core.call('list_scenes')
    const afterImages = await core.call('get_scene_images', { sceneNumbers: [2] })
    expect(afterList.scenes[1].rendererSceneId).toBe('renderer-c')
    expect(afterImages.images[0].rendererSceneId).toBe('renderer-c')
  })

  it('audio-first renderer 씬은 storyId:null이어도 정상적으로 나열한다', async () => {
    const { core } = makeHarness({ scenes: [rendererScene('renderer-only', { storyId: null })] })

    const result = await core.call('list_scenes')

    expect(result.scenes).toHaveLength(1)
    expect(result.scenes[0]).toMatchObject({
      ordinal: 1,
      rendererSceneId: 'renderer-only',
      storyId: null,
    })
  })

  it('image-first는 fixed slot 순서로 pair된 씬을 나열하고 broken pair를 errors에 싣는다', async () => {
    const fixedScenes = [
      { ordinal: 1, rendererSceneId: 'renderer-a', storyId: 'story-a' },
      { ordinal: 2, rendererSceneId: 'renderer-missing', storyId: 'story-missing' },
      { ordinal: 3, rendererSceneId: 'renderer-c', storyId: 'story-c' },
    ]
    const scenes = [
      rendererScene('renderer-c', { storyId: 'story-c' }),
      rendererScene('renderer-a', { storyId: 'story-a' }),
    ]
    const { core } = makeHarness({
      scenes,
      snapshotMode: 'image-first',
      state: { sceneMode: 'image-first', fixedScenes },
    })

    const result = await core.call('list_scenes')

    expect(result.sceneMode).toBe('image-first')
    expect(result.scenes.map(({ ordinal, rendererSceneId }) => ({ ordinal, rendererSceneId }))).toEqual([
      { ordinal: 1, rendererSceneId: 'renderer-a' },
      { ordinal: 3, rendererSceneId: 'renderer-c' },
    ])
    expect(result.errors).toEqual([{ ordinal: 2, error: 'fixed-slot-missing' }])
  })

  it('stale fixed revision은 fixed-scenes-stale로 닫는다', async () => {
    const { core } = makeHarness({
      scenes: [rendererScene('renderer-a', { storyId: 'story-a' })],
      snapshotMode: 'image-first',
      state: {
        sceneMode: 'image-first',
        fixedScenes: [{ ordinal: 1, rendererSceneId: 'renderer-a', storyId: 'story-a' }],
        fixedSceneError: 'fixed-scenes-stale',
      },
    })

    await expect(core.call('list_scenes')).resolves.toEqual({
      status: 'rejected',
      reason: 'fixed-scenes-stale',
    })
  })

  it('프로젝트가 없으면 renderer를 읽지 않고 no-project로 닫는다', async () => {
    const { core, toolBridge } = makeHarness({ hasProject: false })

    await expect(core.call('list_scenes')).resolves.toEqual({
      status: 'rejected',
      reason: 'no-project',
    })
    expect(toolBridge.invoke).not.toHaveBeenCalled()
  })

  it('toolBridge가 주입되지 않으면 needs gate에서 명시적으로 throw한다', async () => {
    const { core } = makeHarness({ withBridge: false })

    await expect(core.call('list_scenes')).rejects.toThrow('list_scenes requires toolBridge')
  })

  it('scene DTO는 whitelist 필드만 내고 경로·base64를 has* boolean으로 접는다', async () => {
    const scene = rendererScene('renderer-secret', {
      imagePath: '/private/project/scenes/renderer-secret.png',
      videoT2VPath: '/private/project/videos/renderer-secret-t2v.mp4',
      videoI2VPath: '',
      image: 'BASE64_IMAGE',
      videoT2V: 'BASE64_T2V',
      videoI2V: 'BASE64_I2V',
      internalOnly: 'do-not-emit',
    })
    const { core } = makeHarness({ scenes: [scene] })

    const result = await core.call('list_scenes')

    expect(Object.keys(result.scenes[0]).sort()).toEqual(SCENE_DTO_KEYS)
    expect(result.scenes[0]).toMatchObject({
      hasImage: true,
      hasVideoT2V: true,
      hasVideoI2V: false,
    })
    expect(JSON.stringify(result)).not.toContain('/private/project')
    expect(JSON.stringify(result)).not.toContain('BASE64')
    expect(JSON.stringify(result)).not.toContain('internalOnly')
  })

  it('툴 설명은 list_scenes를 씬 권위로, story_get_state를 파이프라인 진행 상태로 안내한다', () => {
    const { core } = makeHarness()
    const descriptions = Object.fromEntries(core.list().map(({ name, description }) => [name, description]))

    expect(descriptions.list_scenes).toContain('renderer')
    expect(descriptions.list_scenes).toContain('ordinal')
    expect(descriptions.story_get_state).toContain('파이프라인 진행')
    expect(descriptions.story_get_state).toContain('list_scenes')
  })
})
