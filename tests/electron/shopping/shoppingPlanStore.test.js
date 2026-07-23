// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { mkdtemp, mkdir, readFile, readdir, rename, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'

import {
  createShoppingPlanStore,
  defaultShoppingPlanState,
} from '../../../electron/shopping/shoppingPlanStore.js'

function stateFixture(revision = 1) {
  const hash = String(revision).padStart(64, 'a')
  return {
    snapshot: { planId: 'plan-1', revision, scenes: [{ sceneKey: 'S01' }] },
    currentPlanHash: hash,
    approvedHash: revision > 1 ? hash : null,
    revision,
    state: revision > 1 ? 'materialized' : 'plan_review',
    pendingMaterialization: revision > 1 ? { revision, digest: `digest-${revision}` } : null,
    rendererAck: revision > 1 ? { revision, planHash: hash, materializationDigest: `digest-${revision}` } : null,
    generationJournal: [{ submissionId: `shopsub_${revision}`, status: 'reserved' }],
    visualReviews: [{ rendererSceneId: 'scene-1', status: 'ok' }],
    dialogueReviews: [{ rendererSceneId: 'scene-1', status: 'ok' }],
    openAcceptanceHold: null,
  }
}

describe('shoppingPlanStore', () => {
  let projectPath

  beforeEach(async () => {
    projectPath = await mkdtemp(path.join(tmpdir(), 'shopping-plan-store-'))
  })

  afterEach(async () => {
    await rm(projectPath, { recursive: true, force: true })
  })

  it('returns a fresh default state only when shopping/plan.json is absent', async () => {
    const store = createShoppingPlanStore(projectPath)

    const first = await store.load()
    const second = await store.load()

    expect(first).toEqual({
      snapshot: null,
      currentPlanHash: null,
      approvedHash: null,
      revision: 0,
      state: 'empty',
      pendingMaterialization: null,
      rendererAck: null,
      generationJournal: [],
      visualReviews: [],
      dialogueReviews: [],
      openAcceptanceHold: null,
    })
    expect(first).toEqual(defaultShoppingPlanState())
    expect(first).not.toBe(second)
    expect(first.generationJournal).not.toBe(second.generationJournal)
  })

  it('round-trips the exact shopping/plan.json shape', async () => {
    const store = createShoppingPlanStore(projectPath)
    const state = stateFixture(2)

    await store.save(state)

    expect(await store.load()).toEqual(state)
    expect(JSON.parse(await readFile(path.join(projectPath, 'shopping', 'plan.json'), 'utf8'))).toEqual(state)
  })

  it('writes a unique temp file and renames it over plan.json', async () => {
    const events = []
    const store = createShoppingPlanStore(projectPath, {
      writeFile: async (filePath, ...args) => {
        events.push(['write', filePath])
        return writeFile(filePath, ...args)
      },
      rename: async (from, to) => {
        events.push(['rename', from, to])
        return rename(from, to)
      },
      randomUUID: () => '12345678-aaaa-bbbb-cccc-1234567890ab',
    })

    await store.save(stateFixture())

    const target = path.join(projectPath, 'shopping', 'plan.json')
    expect(events).toEqual([
      ['write', `${target}.tmp-${process.pid}-12345678`],
      ['rename', `${target}.tmp-${process.pid}-12345678`, target],
    ])
  })

  it('keeps the prior plan intact if a crash/failure occurs before rename', async () => {
    const original = stateFixture(1)
    await createShoppingPlanStore(projectPath).save(original)

    const crashStore = createShoppingPlanStore(projectPath, {
      rename: async () => { throw new Error('simulated crash before rename') },
      randomUUID: () => 'deadbeef-aaaa-bbbb-cccc-1234567890ab',
    })
    await expect(crashStore.save(stateFixture(2))).rejects.toThrow('simulated crash')

    expect(await createShoppingPlanStore(projectPath).load()).toEqual(original)
    const files = await readdir(path.join(projectPath, 'shopping'))
    expect(files).toContain(`plan.json.tmp-${process.pid}-deadbeef`)
  })

  it('serializes concurrent saves so the final call wins', async () => {
    const events = []
    let releaseFirstWrite
    const firstWriteGate = new Promise((resolve) => { releaseFirstWrite = resolve })
    let writeCount = 0
    const store = createShoppingPlanStore(projectPath, {
      writeFile: async (filePath, ...args) => {
        writeCount += 1
        events.push(`write-${writeCount}-start`)
        if (writeCount === 1) await firstWriteGate
        await writeFile(filePath, ...args)
        events.push(`write-${writeCount}-end`)
      },
      rename: async (...args) => {
        events.push(`rename-${writeCount}`)
        await rename(...args)
      },
    })

    const firstSave = store.save(stateFixture(1))
    const secondSave = store.save(stateFixture(2))
    await vi.waitFor(() => expect(events).toEqual(['write-1-start']))

    releaseFirstWrite()
    await Promise.all([firstSave, secondSave])

    expect(events).toEqual([
      'write-1-start',
      'write-1-end',
      'rename-1',
      'write-2-start',
      'write-2-end',
      'rename-2',
    ])
    expect(await store.load()).toEqual(stateFixture(2))
  })

  it('continues the queue after one save rejects', async () => {
    let renameCount = 0
    const store = createShoppingPlanStore(projectPath, {
      rename: async (...args) => {
        renameCount += 1
        if (renameCount === 1) throw new Error('first rename failed')
        return rename(...args)
      },
    })

    const first = store.save(stateFixture(1))
    const second = store.save(stateFixture(2))
    await expect(first).rejects.toThrow('first rename failed')
    await expect(second).resolves.toBeUndefined()
    expect(await store.load()).toEqual(stateFixture(2))
  })

  it('runs concurrent read-modify-write updates in the same queue', async () => {
    const store = createShoppingPlanStore(projectPath)
    await store.save(defaultShoppingPlanState())

    await Promise.all([
      store.update(async (state) => ({ ...state, revision: state.revision + 1 })),
      store.update(async (state) => ({ ...state, revision: state.revision + 1 })),
    ])

    expect((await store.load()).revision).toBe(2)
  })

  it('does not swallow corrupted JSON or non-ENOENT read failures', async () => {
    const shoppingDir = path.join(projectPath, 'shopping')
    await mkdir(shoppingDir, { recursive: true })
    await writeFile(path.join(shoppingDir, 'plan.json'), '{broken json', 'utf8')
    await expect(createShoppingPlanStore(projectPath).load()).rejects.toBeInstanceOf(SyntaxError)

    const denied = Object.assign(new Error('permission denied'), { code: 'EACCES' })
    const store = createShoppingPlanStore(projectPath, {
      readFile: async () => { throw denied },
    })
    await expect(store.load()).rejects.toBe(denied)
  })

  it('rejects missing or extra store keys instead of persisting ambiguous authority state', async () => {
    const missing = stateFixture()
    delete missing.currentPlanHash
    await expect(createShoppingPlanStore(projectPath).save(missing)).rejects.toThrow('missing key currentPlanHash')

    const extra = { ...stateFixture(), callerHash: 'renderer-controlled' }
    await expect(createShoppingPlanStore(projectPath).save(extra)).rejects.toThrow('unknown key callerHash')

    const undefinedValue = { ...stateFixture(), currentPlanHash: undefined }
    await expect(createShoppingPlanStore(projectPath).save(undefinedValue)).rejects.toThrow('undefined key currentPlanHash')
  })
})
