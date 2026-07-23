import {
  mkdir as fsMkdir,
  readFile as fsReadFile,
  rename as fsRename,
  writeFile as fsWriteFile,
} from 'node:fs/promises'
import { randomUUID as cryptoRandomUUID } from 'node:crypto'
import path from 'node:path'

const STORE_KEYS = Object.freeze([
  'snapshot',
  'currentPlanHash',
  'approvedHash',
  'revision',
  'state',
  'pendingMaterialization',
  'rendererAck',
  'generationJournal',
  'visualReviews',
  'dialogueReviews',
  'openAcceptanceHold',
])

export function defaultShoppingPlanState() {
  return {
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
  }
}

export function assertShoppingPlanStoreState(state) {
  // F6/M2a-2 contract: dumb persistence validates only this key shape; approve must gate approvedHash === computePlanHash(canonicalize(snapshot)).
  if (!state || typeof state !== 'object' || Array.isArray(state)) {
    throw new TypeError('shopping plan store state must be an object')
  }

  const expected = new Set(STORE_KEYS)
  for (const key of STORE_KEYS) {
    if (!Object.hasOwn(state, key)) throw new TypeError(`shopping plan store state missing key ${key}`)
    if (state[key] === undefined) throw new TypeError(`shopping plan store state has undefined key ${key}`)
  }
  for (const key of Object.keys(state)) {
    if (!expected.has(key)) throw new TypeError(`shopping plan store state has unknown key ${key}`)
  }
  return state
}

export function createShoppingPlanStore(projectPath, deps = {}) {
  if (typeof projectPath !== 'string' || !projectPath) {
    throw new TypeError('projectPath must be a non-empty string')
  }

  const mkdir = deps.mkdir || fsMkdir
  const readFile = deps.readFile || fsReadFile
  const writeFile = deps.writeFile || fsWriteFile
  const rename = deps.rename || fsRename
  const randomUUID = deps.randomUUID || cryptoRandomUUID
  const shoppingDir = path.join(projectPath, 'shopping')
  const planPath = path.join(shoppingDir, 'plan.json')
  let writeQueue = Promise.resolve()

  function enqueueWrite(task) {
    const result = writeQueue.then(task)
    writeQueue = result.then(() => undefined, () => undefined)
    return result
  }

  async function readState() {
    let text
    try {
      text = await readFile(planPath, 'utf8')
    } catch (error) {
      if (error?.code === 'ENOENT') return defaultShoppingPlanState()
      throw error
    }
    return assertShoppingPlanStoreState(JSON.parse(text))
  }

  async function writeAtomic(serialized) {
    await mkdir(shoppingDir, { recursive: true })
    const tempPath = `${planPath}.tmp-${process.pid}-${randomUUID().slice(0, 8)}`
    await writeFile(tempPath, serialized, 'utf8')
    await rename(tempPath, planPath)
  }

  return {
    async load() {
      return readState()
    },

    // F5 contract: save() is blind full-state last-writer-wins; approval/hash mutations must use queued update() for atomic read-modify-write.
    save(state) {
      return enqueueWrite(async () => {
        assertShoppingPlanStoreState(state)
        await writeAtomic(JSON.stringify(state, null, 2))
      })
    },

    update(updater) {
      if (typeof updater !== 'function') return Promise.reject(new TypeError('updater must be a function'))
      return enqueueWrite(async () => {
        const current = await readState()
        const next = await updater(current)
        if (next == null) return current
        assertShoppingPlanStoreState(next)
        await writeAtomic(JSON.stringify(next, null, 2))
        return next
      })
    },
  }
}
