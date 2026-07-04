// @vitest-environment node
// IP4(M2a-2b): ② 재실행 시 세그먼트 id가 텍스트로 승계돼야 storyId 멤버십(세그먼트 id 집합)이
// 안정된다. 위치기반 재발급은 세그먼트 삽입/재정렬 시 드리프트 + 승계 id와 충돌한다.
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { mkdtemp, readFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { createStepMachine } from '../../../electron/story/stepMachine.js'

describe('scenes 재실행 세그먼트 id 승계 (IP4)', () => {
  let dir, machine, llm

  const scenesOf = (...texts) => ({
    scenes: [{ sceneNo: 1, summary: '', segments: texts.map((t) => ({ speaker: 'narrator', text: t, emotion: 'normal' })) }],
    speakers: [{ id: 'narrator', name: 'n' }],
  })
  const readSegs = async () =>
    JSON.parse(await readFile(path.join(dir, 'story/scenes.json'), 'utf8')).scenes.flatMap((s) => s.segments || [])

  beforeEach(async () => {
    dir = await mkdtemp(path.join(tmpdir(), 'sm-rerun-'))
    llm = {
      generateScript: vi.fn(async () => ({ scriptMd: '#' })),
      splitScenes: vi.fn(async () => scenesOf('문장 에이', '문장 비')),
    }
    machine = createStepMachine({ projectPath: dir, llm, emit: () => {}, getApiKey: () => 'k' })
    await machine.open()
    await machine.start('script', { input: { type: 'title', title: 'T' }, options: { language: 'ko' } })
  })

  it('재실행 시 앞에 세그먼트가 삽입돼도 기존 세그먼트 id를 보존하고 전체 유일하다', async () => {
    await machine.start('scenes', {})
    const first = await readSegs()
    const idA = first.find((g) => g.text === '문장 에이').id
    const idB = first.find((g) => g.text === '문장 비').id
    expect(idA).toBeTruthy()
    expect(idB).toBeTruthy()

    // 2차: 앞에 '새 도입' 삽입
    llm.splitScenes = vi.fn(async () => scenesOf('새 도입', '문장 에이', '문장 비'))
    await machine.start('scenes', {})
    const second = await readSegs()

    // 기존 세그먼트 id 보존 (위치가 밀려도)
    expect(second.find((g) => g.text === '문장 에이').id).toBe(idA)
    expect(second.find((g) => g.text === '문장 비').id).toBe(idB)
    // 삽입분도 id를 받고, 전체 유일 (승계 id와 충돌 없음)
    const ids = second.map((g) => g.id)
    expect(ids.every(Boolean)).toBe(true)
    expect(new Set(ids).size).toBe(ids.length)
  })
})
