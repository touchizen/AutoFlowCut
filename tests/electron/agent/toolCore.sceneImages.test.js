// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { createToolCore } from '../../../electron/agent/toolCore.js'

// M3 I4 (D11, slices 28–32): get_scene_images 는 ordinal 을 resolver 로 rendererSceneId 로 바꾸고,
// projectPath 에서 유도한 scene directory 에서 이미지 후보를 찾아 주입된 codec 으로 decode/resize 한다.
// nativeImage 는 imageReader 로 주입 — 이 테스트는 Electron 없이 돈다.

const TOKEN = 'tok-1'

function makeImg({ empty = false, width = 400, height = 600, data = 'BLOCK' } = {}) {
  const toBlock = vi.fn(() => ({ data, mimeType: 'image/jpeg' }))
  return { isEmpty: empty, width, height, toBlock }
}

let storyCommands, toolBridge, imageReader, core
beforeEach(() => {
  storyCommands = {
    hasProject: () => true,
    projectToken: TOKEN,
    projectPath: '/proj',
    // audio-first 기본: fixedScenes 없음, sceneMode audio-first
    getState: vi.fn(async () => ({ sceneMode: 'audio-first', fixedScenes: null })),
  }
  toolBridge = {
    invoke: vi.fn(async (name) => {
      if (name === 'scene.snapshot') {
        return { sceneMode: 'audio-first', scenes: [
          { id: 'scene_17', storyId: 'story-a', hasImage: true },
          { id: 'scene_3', storyId: 'story-b', hasImage: true },
        ] }
      }
      throw new Error(`unexpected bridge ${name}`)
    }),
  }
  imageReader = {
    exists: vi.fn(async (p) => p.endsWith('scene_17.png')),
    decodeFile: vi.fn(async () => makeImg({ width: 400, height: 600 })),
  }
  core = createToolCore({ toolBridge, projectToken: TOKEN, imageReader })
  core.use(storyCommands)
})

describe('get_scene_images', () => {
  it('slice 28: ordinal 1 → scene_17.png decode 성공, content 이미지 블록, scene_1.* probe 0회', async () => {
    const r = await core.call('get_scene_images', { sceneNumbers: [1] }, {})
    expect(r.status).toBe('done')
    expect(r.images).toEqual([{ ordinal: 1, rendererSceneId: 'scene_17', status: 'ok', mimeType: 'image/jpeg' }])
    expect(r.content).toEqual([{ type: 'image', data: 'BLOCK', mimeType: 'image/jpeg' }])
    for (const call of imageReader.exists.mock.calls) {
      expect(call[0]).not.toContain('scene_1.')
    }
    expect(imageReader.decodeFile).toHaveBeenCalledWith('/proj/scenes/scene_17.png')
  })

  it('slice 29: 후보 전부 없음 → image-not-found, decode 호출 0회', async () => {
    imageReader.exists = vi.fn(async () => false)
    const r = await core.call('get_scene_images', { sceneNumbers: [1] }, {})
    expect(r.images).toEqual([{ ordinal: 1, rendererSceneId: 'scene_17', status: 'image-not-found' }])
    expect(r.content).toEqual([])
    expect(imageReader.decodeFile).not.toHaveBeenCalled()
  })

  it('slice 30: 후보 있으나 codec isEmpty(WebP/GIF) → unsupported-image-format', async () => {
    imageReader.exists = vi.fn(async (p) => p.endsWith('scene_17.webp'))
    imageReader.decodeFile = vi.fn(async () => makeImg({ empty: true }))
    const r = await core.call('get_scene_images', { sceneNumbers: [1] }, {})
    expect(r.images).toEqual([{ ordinal: 1, rendererSceneId: 'scene_17', status: 'unsupported-image-format' }])
    expect(r.content).toEqual([])
  })

  it('slice 31: 긴 변 > 768 → toBlock 이 resize 스펙을 받는다', async () => {
    const img = makeImg({ width: 720, height: 1280 })
    imageReader.decodeFile = vi.fn(async () => img)
    await core.call('get_scene_images', { sceneNumbers: [1] }, {})
    expect(img.toBlock).toHaveBeenCalledWith({ resize: { height: 768 } })
  })

  it('768 이내면 resize 없이 toBlock({resize:null})', async () => {
    const img = makeImg({ width: 400, height: 600 })
    imageReader.decodeFile = vi.fn(async () => img)
    await core.call('get_scene_images', { sceneNumbers: [1] }, {})
    expect(img.toBlock).toHaveBeenCalledWith({ resize: null })
  })

  it('sceneNumbers 생략 → 전체 씬, 각 per-scene 결과', async () => {
    imageReader.exists = vi.fn(async () => true) // 둘 다 존재
    const r = await core.call('get_scene_images', {}, {})
    expect(r.images.map((i) => i.ordinal)).toEqual([1, 2])
    expect(r.content).toHaveLength(2)
  })

  it('범위 밖 ordinal 은 per-scene error(scene-not-found)로 섞인다', async () => {
    const r = await core.call('get_scene_images', { sceneNumbers: [1, 9] }, {})
    expect(r.images).toContainEqual({ ordinal: 9, status: 'scene-not-found' })
    expect(r.images.find((i) => i.ordinal === 1).status).toBe('ok')
  })

  it('slice 32: projectPath 에서 scene directory 를 유도한다 (load_csv 없이)', async () => {
    await core.call('get_scene_images', { sceneNumbers: [1] }, {})
    expect(imageReader.exists.mock.calls[0][0]).toMatch(/^\/proj\/scenes\//)
  })

  it('needs 배열: 프로젝트 미오픈 → no-project (I0 게이트)', async () => {
    storyCommands.hasProject = () => false
    const r = await core.call('get_scene_images', { sceneNumbers: [1] }, {})
    expect(r).toEqual({ status: 'rejected', reason: 'no-project' })
  })

  it('needs 배열: stale token → stale-token', async () => {
    const other = createToolCore({ toolBridge, projectToken: 'DIFFERENT', imageReader })
    other.use(storyCommands) // storyCommands.projectToken = TOKEN != DIFFERENT
    const r = await other.call('get_scene_images', { sceneNumbers: [1] }, {})
    expect(r).toMatchObject({ status: 'rejected', reason: 'stale-token' })
  })

  // MAJOR 1 (Fable): mode 는 같아도 revision 이 드리프트한 set-replacement 크래시에서 getState 가
  // 이미 state.fixedSceneError='fixed-scenes-stale' 를 계산해 준다 — 툴이 그걸 읽어야 stale 로 닫는다.
  it('mode 는 같아도 state.fixedSceneError=fixed-scenes-stale 면 stale 로 닫는다', async () => {
    storyCommands.getState = vi.fn(async () => ({
      sceneMode: 'image-first',
      fixedScenes: [{ ordinal: 1, rendererSceneId: 'scene_17', storyId: 'a' }],
      fixedSceneError: 'fixed-scenes-stale',
    }))
    toolBridge.invoke = vi.fn(async () => ({ sceneMode: 'image-first', scenes: [{ id: 'scene_17', storyId: 'a', image: 'x' }] }))
    const r = await core.call('get_scene_images', { sceneNumbers: [1] }, {})
    expect(r).toMatchObject({ status: 'rejected', reason: 'fixed-scenes-stale' })
  })

  // MAJOR 2 (Fable): 삭제된 씬의 유령 디스크 이미지(재사용 id + 잔존 파일) 를 'ok' 로 반환하면 안 된다.
  // 렌더러가 hasImage:false 로 "이 씬엔 이미지 없다" 하면 디스크 조회 전에 image-not-found.
  it('snapshot 이 hasImage:false 면 디스크 파일이 있어도 image-not-found, decode/probe 안 함', async () => {
    toolBridge.invoke = vi.fn(async () => ({ sceneMode: 'audio-first', scenes: [
      { id: 'scene_17', storyId: 'a', hasImage: false },
    ] }))
    imageReader.exists = vi.fn(async () => true) // 유령 파일이 존재해도
    const r = await core.call('get_scene_images', { sceneNumbers: [1] }, {})
    expect(r.images).toEqual([{ ordinal: 1, rendererSceneId: 'scene_17', status: 'image-not-found' }])
    expect(imageReader.exists).not.toHaveBeenCalled()
    expect(imageReader.decodeFile).not.toHaveBeenCalled()
  })

  it('hasImage:true 면 정상 조회', async () => {
    toolBridge.invoke = vi.fn(async () => ({ sceneMode: 'audio-first', scenes: [
      { id: 'scene_17', storyId: 'a', hasImage: true },
    ] }))
    const r = await core.call('get_scene_images', { sceneNumbers: [1] }, {})
    expect(r.images[0].status).toBe('ok')
  })

  // MAJOR 3 (Fable): 렌더러가 준 rendererSceneId 를 무검증으로 fs 경로에 조립하면 traversal 이 된다.
  it('rendererSceneId 가 안전한 path segment 가 아니면(traversal) image-not-found, probe 0회', async () => {
    toolBridge.invoke = vi.fn(async () => ({ sceneMode: 'audio-first', scenes: [
      { id: '../../etc/passwd', storyId: 'a', hasImage: true },
    ] }))
    imageReader.exists = vi.fn(async () => true)
    const r = await core.call('get_scene_images', { sceneNumbers: [1] }, {})
    expect(r.images[0].status).toBe('image-not-found')
    expect(imageReader.exists).not.toHaveBeenCalled()
  })

  it('mode 불일치(story image-first, snapshot audio-first) → fixed-scenes-stale', async () => {
    storyCommands.getState = vi.fn(async () => ({ sceneMode: 'image-first', fixedScenes: [
      { ordinal: 1, rendererSceneId: 'scene_17', storyId: 'story-a' },
    ] }))
    // snapshot 은 여전히 audio-first
    const r = await core.call('get_scene_images', { sceneNumbers: [1] }, {})
    expect(r).toMatchObject({ status: 'rejected', reason: 'fixed-scenes-stale' })
  })

  it('image-first 정합: story+snapshot 둘 다 image-first → fixedScenes 슬롯으로 resolve', async () => {
    const slots = [{ ordinal: 1, rendererSceneId: 'scene_17', storyId: 'story-a' }]
    storyCommands.getState = vi.fn(async () => ({ sceneMode: 'image-first', fixedScenes: slots }))
    toolBridge.invoke = vi.fn(async () => ({ sceneMode: 'image-first', scenes: [
      { id: 'scene_17', storyId: 'story-a', hasImage: true },
    ] }))
    const r = await core.call('get_scene_images', { sceneNumbers: [1] }, {})
    expect(r.images[0]).toMatchObject({ ordinal: 1, rendererSceneId: 'scene_17', status: 'ok' })
  })
})
