/**
 * M2a-4a IP-A2 — stepMachine.loadAudioPackage()
 *
 * export(renderer)가 story 나레이션을 배치하려면 audio manifest 와 정합 기준
 * (lastPushedRevision)이 필요하다. renderer 엔 없으므로 main 이 한 번에 로드해 준다.
 *   - manifest(story/audio/manifest.json) + state.lastPushedRevision → { manifest, lastPushedRevision }
 *   - manifest 없으면(audio 미실행) null → 오디오 없이 export
 *   - 정합 판단(pushRevision 일치)은 renderer(prepareCloudRequest)가 함. 여기선 raw 값만 실어 줌.
 */
import { describe, it, expect, beforeEach } from 'vitest'
import { mkdtemp, mkdir, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { createStepMachine } from '../../../electron/story/stepMachine.js'
import { defaultStoryState } from '../../../electron/story/storyStore.js'

async function tmpProject() { return await mkdtemp(path.join(tmpdir(), 'story-loadaudio-')) }

function makeMachine(projectPath) {
  return createStepMachine({ projectPath, llm: {}, emit: () => {}, getApiKey: () => 'k' })
}

async function writeStory(projectPath, { lastPushedRevision, manifest }) {
  const dir = path.join(projectPath, 'story')
  await mkdir(path.join(dir, 'audio'), { recursive: true })
  const state = { ...defaultStoryState(), lastPushedRevision }
  await writeFile(path.join(dir, 'story.json'), JSON.stringify(state))
  if (manifest) await writeFile(path.join(dir, 'audio', 'manifest.json'), JSON.stringify(manifest))
}

describe('stepMachine.loadAudioPackage', () => {
  let projectPath
  beforeEach(async () => { projectPath = await tmpProject() })

  it('manifest + story.json 있으면 { manifest, lastPushedRevision } 반환', async () => {
    await writeStory(projectPath, {
      lastPushedRevision: 5,
      manifest: { version: 1, pushRevision: 5, segments: [{ id: 's1', type: 'narration', startMs: 0, durationMs: 1000 }] },
    })
    const machine = makeMachine(projectPath)
    await machine.open()
    const pkg = await machine.loadAudioPackage()
    expect(pkg.manifest.pushRevision).toBe(5)
    expect(pkg.lastPushedRevision).toBe(5)
    expect(pkg.manifest.segments).toHaveLength(1)
  })

  it('manifest 없으면 null (audio 미실행 story)', async () => {
    await writeStory(projectPath, { lastPushedRevision: 0, manifest: null })
    const machine = makeMachine(projectPath)
    await machine.open()
    expect(await machine.loadAudioPackage()).toBeNull()
  })

  it('open 전에 호출해도 state 를 로드해 lastPushedRevision 반영', async () => {
    await writeStory(projectPath, {
      lastPushedRevision: 3,
      manifest: { version: 1, pushRevision: 3, segments: [] },
    })
    const machine = makeMachine(projectPath)
    const pkg = await machine.loadAudioPackage()
    expect(pkg.lastPushedRevision).toBe(3)
  })

  // Codex finding 1(재검토): mismatch 를 null 로 뭉개면 현재 프로젝트의 manifest 가 조용히
  // 누락된다. machine 상태와 무관하게 "요청된 projectPath 의 디스크"를 직접 읽어야 교차 주입도
  // 막고(요청 경로 것만) 누락도 없다.
  it('요청 projectPath 의 manifest 를 직접 읽는다 (machine 상태 독립)', async () => {
    const other = await tmpProject()
    await writeStory(other, {
      lastPushedRevision: 9,
      manifest: { version: 1, pushRevision: 9, segments: [{ id: 'b1', type: 'narration', startMs: 0, durationMs: 100 }] },
    })
    await writeStory(projectPath, {
      lastPushedRevision: 2,
      manifest: { version: 1, pushRevision: 2, segments: [{ id: 'a1', type: 'narration', startMs: 0, durationMs: 200 }] },
    })
    const machine = makeMachine(projectPath) // machine 은 projectPath(A) 로 열림
    await machine.open()
    // B 경로 요청 → B manifest(9, b1) — A 것이 새지 않는다
    const pkgB = await machine.loadAudioPackage(other)
    expect(pkgB.manifest.pushRevision).toBe(9)
    expect(pkgB.manifest.segments[0].id).toBe('b1')
    expect(pkgB.lastPushedRevision).toBe(9)
    // 인자 없으면 자기(A)
    const pkgA = await machine.loadAudioPackage()
    expect(pkgA.manifest.pushRevision).toBe(2)
    expect(pkgA.manifest.segments[0].id).toBe('a1')
  })

  it('요청 projectPath 에 manifest 가 없으면 null', async () => {
    const other = await tmpProject() // manifest 없음
    await writeStory(projectPath, { lastPushedRevision: 1, manifest: { version: 1, pushRevision: 1, segments: [] } })
    const machine = makeMachine(projectPath)
    await machine.open()
    expect(await machine.loadAudioPackage(other)).toBeNull()
  })

  // Codex finding 3: manifest 는 있지만 손상(파싱 실패)이면 조용히 null(오디오 누락) 대신
  // fail-fast 로 throw 해 export 를 막는다.
  it('manifest 가 손상(파싱 불가)이면 throw (fail-fast)', async () => {
    const dir = path.join(projectPath, 'story', 'audio')
    await mkdir(dir, { recursive: true })
    await writeFile(path.join(projectPath, 'story', 'story.json'),
      JSON.stringify({ ...defaultStoryState(), lastPushedRevision: 1 }))
    await writeFile(path.join(dir, 'manifest.json'), '{ not valid json ')
    const machine = makeMachine(projectPath)
    await machine.open()
    await expect(machine.loadAudioPackage()).rejects.toThrow(/manifest|corrupt|parse|손상/i)
  })
})
