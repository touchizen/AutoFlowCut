// @vitest-environment node
import { describe, expect, it, vi } from 'vitest'
import { mkdtemp, readFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { createStepMachine } from '../../../electron/story/stepMachine.js'
import { runScenesSplitExperiment } from '../../../electron/story/storySplitExperiment.js'

const paragraphSource = (count = 4, size = 8) => Array.from(
  { length: count },
  (_, index) => `P${index}-${String.fromCharCode(65 + index).repeat(size)}`,
).join('\n\n')

const splitResult = (text, sceneNo = 99, speaker = 'narrator') => ({
  scenes: [{
    sceneNo,
    summary: text.slice(0, 12),
    segments: [{ type: 'narration', speaker, text, emotion: 'normal' }],
  }],
  speakers: [{ id: speaker, name: speaker }],
})

const tinyPlanner = { minChars: 0, targetChars: 14 }

describe('runScenesSplitExperiment', () => {
  it('single mode는 현재 단일 호출의 opts와 sceneNo를 그대로 보존한다', async () => {
    const source = paragraphSource(4, 3_200)
    const opts = { language: 'ko' }
    const llm = { splitScenes: vi.fn(async () => splitResult(source, 99)) }

    const result = await runScenesSplitExperiment(source, llm, opts, { mode: 'single' })

    expect(llm.splitScenes).toHaveBeenCalledTimes(1)
    expect(llm.splitScenes.mock.calls[0][0]).toBe(source)
    expect(llm.splitScenes.mock.calls[0][1]).toBe(opts)
    expect(result.scenes[0].sceneNo).toBe(99)
  })

  it('worker concurrency를 설정값 이하로 제한한다', async () => {
    const source = paragraphSource(6)
    let active = 0
    let maxActive = 0
    const llm = {
      splitScenes: vi.fn(async (text) => {
        active += 1
        maxActive = Math.max(maxActive, active)
        await new Promise((resolve) => setTimeout(resolve, 5))
        active -= 1
        return splitResult(text)
      }),
    }

    const result = await runScenesSplitExperiment(source, llm, {}, {
      mode: 'parallel',
      concurrency: 2,
      plannerOptions: tinyPlanner,
    })

    expect(result.record.mode).toBe('parallel')
    expect(result.record.callCount).toBe(6)
    expect(maxActive).toBe(2)
  })

  it('abort 뒤에는 대기 chunk를 더 scheduling하지 않는다', async () => {
    const source = paragraphSource(6)
    const controller = new AbortController()
    const releases = []
    const llm = {
      splitScenes: vi.fn((text) => new Promise((resolve) => {
        releases.push(() => resolve(splitResult(text)))
      })),
    }

    const pending = runScenesSplitExperiment(source, llm, {}, {
      mode: 'parallel',
      concurrency: 2,
      plannerOptions: tinyPlanner,
      signal: controller.signal,
    })
    while (llm.splitScenes.mock.calls.length < 2) await new Promise((resolve) => setImmediate(resolve))

    controller.abort()
    for (const release of releases) release()

    await expect(pending).rejects.toMatchObject({ name: 'AbortError' })
    expect(llm.splitScenes).toHaveBeenCalledTimes(2)
  })

  it('chunk 완료가 역순이어도 결과와 speaker를 chunk index 순으로 모으고 sceneNo를 전역 재발급한다', async () => {
    const source = paragraphSource(4)
    const completed = []
    const previews = []
    const llm = {
      splitScenes: vi.fn(async (text, opts, ctx) => {
        const index = Number(text.match(/^P(\d+)-/)?.[1])
        expect(opts.splitContext).toEqual({
          before: index > 0 ? expect.stringMatching(new RegExp(`^P${index - 1}-`)) : '',
          after: index < 3 ? expect.stringMatching(new RegExp(`^P${index + 1}-`)) : '',
        })
        await new Promise((resolve) => setTimeout(resolve, (4 - index) * 3))
        completed.push(index)
        ctx.onPartialScene?.(splitResult(text, 80 + index, `speaker-${index}`).scenes[0], 7)
        return splitResult(text, 80 + index, `speaker-${index}`)
      }),
    }

    const result = await runScenesSplitExperiment(source, llm, { language: 'ko' }, {
      mode: 'parallel',
      concurrency: 4,
      plannerOptions: tinyPlanner,
      onPartialScene: (scene, localSceneNo, chunkIndex) => previews.push({ scene, localSceneNo, chunkIndex }),
    })

    expect(completed).toEqual([3, 2, 1, 0])
    expect(result.scenes.map((scene) => scene.sceneNo)).toEqual([1, 2, 3, 4])
    expect(result.scenes.map((scene) => scene.segments[0].text)).toEqual(
      source.split(/\n\n/).map((text, index) => index < 3 ? `${text}\n\n` : text),
    )
    expect(result.speakers.map((speaker) => speaker.id)).toEqual([
      'speaker-0', 'speaker-1', 'speaker-2', 'speaker-3',
    ])
    expect(previews.map(({ chunkIndex, localSceneNo }) => ({ chunkIndex, localSceneNo }))).toEqual([
      { chunkIndex: 3, localSceneNo: 7 },
      { chunkIndex: 2, localSceneNo: 7 },
      { chunkIndex: 1, localSceneNo: 7 },
      { chunkIndex: 0, localSceneNo: 7 },
    ])
    expect(result.record.quality.verbatimCoverage.ok).toBe(true)
    expect(result.record.timing.firstPreviewMs).toBeTypeOf('number')
  })

  it('streaming delta가 없는 engine은 chunk 완료 장면을 coarse preview로 보낸다', async () => {
    const previews = []
    const llm = { splitScenes: vi.fn(async (text) => splitResult(text)) }

    await runScenesSplitExperiment(paragraphSource(3), llm, {}, {
      mode: 'parallel',
      concurrency: 2,
      plannerOptions: tinyPlanner,
      onPartialScene: (_scene, localSceneNo, chunkIndex) => previews.push({ localSceneNo, chunkIndex }),
    })

    expect(previews).toEqual([
      { localSceneNo: 0, chunkIndex: 0 },
      { localSceneNo: 0, chunkIndex: 1 },
      { localSceneNo: 0, chunkIndex: 2 },
    ])
  })
})

async function createMachine(dir, llm, sceneSplitExperiment) {
  const emitted = []
  const machine = createStepMachine({
    projectPath: dir,
    llm,
    sceneSplitExperiment,
    emit: (channel, payload) => emitted.push({ channel, payload }),
    getApiKey: () => 'k',
  })
  await machine.open()
  return { machine, emitted }
}

describe('stepMachine scenes experiment hook', () => {
  it('parallel chunk 검증 하나라도 실패하면 기존 scenes.json을 덮어쓰지 않는다', async () => {
    const dir = await mkdtemp(path.join(tmpdir(), 'sm-scenes-experiment-fail-'))
    let failParallel = false
    const llm = {
      splitScenes: vi.fn(async (text) => {
        if (failParallel && text.startsWith('P2-')) return splitResult('원문을 바꾼 응답')
        return splitResult(text)
      }),
    }
    const { machine } = await createMachine(dir, llm, {
      mode: 'parallel',
      concurrency: 2,
    })

    await machine.start('script', { pastedScript: '기존 장면 원문' })
    await machine.confirmSynopsis({ synopsisMd: '', characters: [] })
    await machine.start('scenes', {})
    const scenesPath = path.join(dir, 'story', 'scenes.json')
    const before = await readFile(scenesPath, 'utf8')

    failParallel = true
    await machine.start('script', { pastedScript: paragraphSource(4, 3_200) })
    await machine.confirmSynopsis({ synopsisMd: '', characters: [] })
    await machine.start('scenes', {})

    expect((await machine.getState()).steps.scenes.status).toBe('error')
    expect(await readFile(scenesPath, 'utf8')).toBe(before)
    expect(machine.getSceneSplitExperimentRecord()).toMatchObject({
      mode: 'parallel',
      ok: false,
      failedChunkIndex: 2,
    })
  })

  it('명시적 parallel 모드의 record에 timing과 chunk quality를 남긴다', async () => {
    const dir = await mkdtemp(path.join(tmpdir(), 'sm-scenes-experiment-record-'))
    const llm = { splitScenes: vi.fn(async (text) => splitResult(text)) }
    const { machine, emitted } = await createMachine(dir, llm, {
      mode: 'parallel',
      concurrency: 2,
    })

    await machine.start('script', { pastedScript: paragraphSource(4, 3_200) })
    await machine.confirmSynopsis({ synopsisMd: '', characters: [] })
    await machine.start('scenes', {})

    expect(machine.getSceneSplitExperimentRecord()).toMatchObject({
      requestedMode: 'parallel',
      mode: 'parallel',
      ok: true,
      callCount: 4,
      chunkCount: 4,
      timing: {
        firstPreviewMs: expect.any(Number),
        splitCallMs: expect.any(Number),
        terminalMs: expect.any(Number),
      },
      quality: {
        chunks: expect.arrayContaining([expect.objectContaining({ ok: true })]),
        verbatimCoverage: expect.objectContaining({ ok: true }),
      },
    })
    expect(emitted.some(({ payload }) => (
      payload.kind === 'scene-split-experiment' && payload.record?.ok === true
    ))).toBe(true)
  })

  it('experiment-off 기본 경로는 긴 대본도 정확히 한 번, 원문 전체로 splitScenes를 호출한다', async () => {
    const dir = await mkdtemp(path.join(tmpdir(), 'sm-scenes-experiment-off-'))
    const source = paragraphSource(4, 3_200)
    const llm = { splitScenes: vi.fn(async (text) => splitResult(text)) }
    const { machine } = await createMachine(dir, llm, undefined)

    await machine.start('script', { pastedScript: source })
    await machine.confirmSynopsis({ synopsisMd: '', characters: [] })
    await machine.start('scenes', {})

    expect(llm.splitScenes).toHaveBeenCalledTimes(1)
    expect(llm.splitScenes.mock.calls[0][0]).toBe(source)
    expect(llm.splitScenes.mock.calls[0][1]).not.toHaveProperty('splitContext')
    expect(machine.getSceneSplitExperimentRecord()).toBeNull()
    expect((await machine.getState()).steps.scenes.status).toBe('done')
  })
})
