// @vitest-environment node
import { describe, expect, it, vi } from 'vitest'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { fileURLToPath } from 'node:url'
import {
  formatComparisonRows,
  runStorySplitAb,
} from '../../scripts/story-split-ab.mjs'

const source = ['P0-aaaa', 'P1-bbbb', 'P2-cccc'].join('\n\n')

function exactResult(text) {
  return {
    scenes: [{
      sceneNo: 8,
      summary: text.slice(0, 10),
      segments: [{ type: 'narration', speaker: 'narrator', text, emotion: 'normal' }],
    }],
    speakers: [{ id: 'narrator', name: '나레이션' }],
    usage: { input: 10, output: 4 },
    retries: 0,
  }
}

describe('story-split A/B harness', () => {
  it('raw Node CLI로 직접 실행할 수 있다', async () => {
    const scriptPath = fileURLToPath(new URL('../../scripts/story-split-ab.mjs', import.meta.url))
    const { stdout, stderr } = await promisify(execFile)(process.execPath, [scriptPath, '--help'])

    expect(stdout).toContain('Usage: node scripts/story-split-ab.mjs')
    expect(stderr).toBe('')
  })

  it('raw Node에서 실제 Story LLM adapter를 load할 수 있다', async () => {
    const scriptUrl = new URL('../../scripts/story-split-ab.mjs', import.meta.url).href
    const expression = `import(${JSON.stringify(scriptUrl)}).then(m => m.loadStorySplitAdapter('gemini')).then(() => console.log('adapter-ok'))`
    const { stdout, stderr } = await promisify(execFile)(process.execPath, [
      '--input-type=module', '--eval', expression,
    ])

    expect(stdout.trim()).toBe('adapter-ok')
    expect(stderr).toBe('')
  })

  it('같은 splitScenes interface로 single/parallel을 실행하고 §6 측정값을 모은다', async () => {
    const llm = { splitScenes: vi.fn(async (text, _opts, ctx) => {
      const result = exactResult(text)
      ctx.onPartialScene?.(result.scenes[0], 0)
      return result
    }) }
    const priorScenes = [{
      storyId: 'story-old',
      sceneNo: 1,
      summary: 'old',
      segments: [{ id: 'segment-old', type: 'narration', speaker: 'narrator', text: source }],
    }]

    const comparison = await runStorySplitAb({
      scriptMd: source,
      llm,
      opts: { roster: [] },
      priorScenes,
      concurrency: 2,
      plannerOptions: { minChars: 0, targetChars: 10 },
    })

    expect(llm.splitScenes).toHaveBeenCalledTimes(4)
    expect(comparison.single).toMatchObject({
      mode: 'single',
      ok: true,
      callCount: 1,
      coverage: { ok: true },
      identity: {
        storyIdInherited: 1,
        storyIdTotal: 1,
        segmentIdInherited: 1,
        segmentIdTotal: 1,
      },
      tokens: { input: 10, output: 4, total: 14 },
      retryCount: 0,
    })
    expect(comparison.parallel).toMatchObject({
      mode: 'parallel',
      ok: true,
      callCount: 3,
      coverage: { ok: true },
      speakerConsistency: {
        rosterViolations: 0,
        unknownSpeakerToNarratorRewrites: 0,
        canonicalSpeakerIdConflicts: 0,
      },
      tokens: { input: 30, output: 12, total: 42 },
      retryCount: 0,
    })
    expect(comparison.single.timing).toMatchObject({
      firstPreviewMs: expect.any(Number),
      splitCallMs: expect.any(Number),
      terminalMs: expect.any(Number),
    })
  })

  it('comparison table에 필수 latency/quality/cost 행과 accepted normalization을 분리해 넣는다', async () => {
    const result = {
      single: {
        timing: { firstPreviewMs: 1, splitCallMs: 2, terminalMs: 3 },
        coverage: { ok: true, normalizedCoverage: { acceptedNormalization: { quoteMarks: 2 } } },
        identity: { storyIdRate: 1, segmentIdRate: 1 },
        speakerConsistency: { rosterViolations: 0, unknownSpeakerToNarratorRewrites: 0, canonicalSpeakerIdConflicts: 0 },
        tokens: { input: 10, output: 5, total: 15 },
        callCount: 1,
        retryCount: null,
      },
      parallel: {
        timing: { firstPreviewMs: 1, splitCallMs: 2, terminalMs: 3 },
        coverage: { ok: true, normalizedCoverage: { acceptedNormalization: { quoteMarks: 3 } } },
        identity: { storyIdRate: 1, segmentIdRate: 1 },
        speakerConsistency: { rosterViolations: 0, unknownSpeakerToNarratorRewrites: 0, canonicalSpeakerIdConflicts: 0 },
        tokens: { input: 20, output: 10, total: 30 },
        callCount: 3,
        retryCount: null,
      },
    }

    const rows = formatComparisonRows(result)
    const metrics = rows.map((row) => row.metric)

    expect(metrics).toEqual(expect.arrayContaining([
      'first preview (ms)',
      'split call (ms)',
      'terminal≈split (ms, harness)',
      'verbatim coverage',
      'accepted normalization',
      'storyId inherited',
      'segment IDs inherited',
      'roster violations',
      'unknown→narrator rewrites',
      'canonical speaker ID conflicts',
      'input tokens',
      'output tokens',
      'calls',
      'retries',
    ]))
    expect(rows.find((row) => row.metric === 'accepted normalization')).toEqual({
      metric: 'accepted normalization',
      single: JSON.stringify({ quoteMarks: 2 }),
      parallel: JSON.stringify({ quoteMarks: 3 }),
    })
  })
})
