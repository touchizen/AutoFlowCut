import { describe, it, expect, beforeEach } from 'vitest'
import { mkdtemp, readFile, readdir } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { createStoryStore, defaultStoryState } from '../../../electron/story/storyStore.js'

let dir
beforeEach(async () => { dir = await mkdtemp(path.join(tmpdir(), 'story-')) })

describe('storyStore', () => {
  it('없으면 default 상태를 반환한다', async () => {
    const store = createStoryStore(dir)
    const s = await store.load()
    expect(s.steps.script.status).toBe('pending')
    expect(s.pendingPushRevision).toBe(0)
    expect(s.lastPushedRevision).toBe(0)
  })
  it('save 후 load 왕복', async () => {
    const store = createStoryStore(dir)
    const s = defaultStoryState()
    s.steps.script.status = 'done'
    await store.save(s)
    const loaded = await store.load()
    expect(loaded.steps.script.status).toBe('done')
  })
  it('원자적 쓰기 — tmp 파일이 남지 않는다', async () => {
    const store = createStoryStore(dir)
    await store.save(defaultStoryState())
    const files = await readdir(path.join(dir, 'story'))
    expect(files.filter((f) => f.includes('.tmp'))).toEqual([])
  })
  it('saveText/loadText 왕복 (script.md)', async () => {
    const store = createStoryStore(dir)
    await store.saveText('script.md', '# 대본')
    expect(await store.loadText('script.md')).toBe('# 대본')
  })
})
