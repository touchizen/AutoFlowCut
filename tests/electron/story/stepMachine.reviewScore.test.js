// @vitest-environment node
// 검수 라운드마다 몰입감 점수를 progress로 흘린다 — renderer가 첫/마지막 점수로 변화를 그린다.
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { mkdtemp, mkdir, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { createStepMachine } from '../../../electron/story/stepMachine.js'

let dir, storyDir, emitted, llm, machine
const scoreEvents = (target) => emitted
  .filter((e) => e.ch === 'story:progress' && e.payload.kind === 'review' && e.payload.target === target && e.payload.score != null)
  .map((e) => ({ round: e.payload.round, score: e.payload.score }))

beforeEach(async () => {
  dir = await mkdtemp(path.join(tmpdir(), 'sm-score-'))
  storyDir = path.join(dir, 'story')
  await mkdir(storyDir, { recursive: true })
  await writeFile(path.join(storyDir, 'script.md'), '# 대본', 'utf-8')
  emitted = []
  llm = {
    generateScript: vi.fn(async () => ({ scriptMd: '# 대본' })),
    reviewScript: vi.fn(async () => ({ verdict: 'revise', critique: 'c', score: 72 })),
    reviseScript: vi.fn(async () => ({ scriptMd: '# 개선본' })),
    reviewSynopsis: vi.fn(async () => ({ verdict: 'revise', critique: 'c', score: 60 })),
    reviseSynopsis: vi.fn(async () => ({ synopsisMd: '개선', characters: [], charactersParsed: true })),
    splitScenes: vi.fn(async () => ({ scenes: [], speakers: [] })),
    writePrompts: vi.fn(async (s) => ({ scenes: s })),
  }
  machine = createStepMachine({
    projectPath: dir, llm, loadMetaPrompt: vi.fn(async () => ''),
    emit: (ch, payload) => emitted.push({ ch, payload: JSON.parse(JSON.stringify(payload)) }),
    getApiKey: () => 'k',
  })
  await machine.open()
})

describe('시나리오 검수 점수', () => {
  it('라운드마다 score를 담은 review progress를 보낸다', async () => {
    llm.reviewScript
      .mockResolvedValueOnce({ verdict: 'revise', critique: 'c', score: 72 })
      .mockResolvedValueOnce({ verdict: 'pass', critique: '', score: 85 })
    await machine.start('script', { reviewOnly: true, scriptOverride: '# 대본', review: { script: { enabled: true, rounds: 2 } } })
    expect(scoreEvents('script')).toEqual([{ round: 1, score: 72 }, { round: 2, score: 85 }])
  })

  it('score가 null이면 이벤트에 싣지 않는다 (배지 숨김)', async () => {
    llm.reviewScript.mockResolvedValue({ verdict: 'pass', critique: '', score: null })
    await machine.start('script', { reviewOnly: true, scriptOverride: '# 대본', review: { script: { enabled: true, rounds: 1 } } })
    expect(scoreEvents('script')).toEqual([])
  })
})

describe('시놉시스 검수 점수', () => {
  it('라운드마다 score를 담은 review progress를 보낸다', async () => {
    llm.reviewSynopsis
      .mockResolvedValueOnce({ verdict: 'revise', critique: 'c', score: 60 })
      .mockResolvedValueOnce({ verdict: 'pass', critique: '', score: 88 })
    await machine.reviewSynopsis({ synopsisMd: '원본', characters: [], options: {}, review: { synopsis: { enabled: true, rounds: 2 } } })
    expect(scoreEvents('synopsis')).toEqual([{ round: 1, score: 60 }, { round: 2, score: 88 }])
  })

  it('pass로 1라운드에 끝나도 그 라운드 점수는 보낸다', async () => {
    llm.reviewSynopsis.mockResolvedValue({ verdict: 'pass', critique: '', score: 91 })
    await machine.reviewSynopsis({ synopsisMd: '원본', characters: [], options: {}, review: { synopsis: { enabled: true, rounds: 3 } } })
    expect(scoreEvents('synopsis')).toEqual([{ round: 1, score: 91 }])
  })
})
