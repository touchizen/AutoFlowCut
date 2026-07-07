import { describe, it, expect, beforeEach } from 'vitest'
import { mkdtemp, readFile, readdir } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { createStoryStore, defaultStoryState } from '../../../electron/story/storyStore.js'
import { existsSync } from 'node:fs'

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

  // HIGH/Codex: tmp 파일명이 pid만으로 구성되면 같은 프로세스 내 동시 save가 같은 tmp 경로를
  // 놓고 경합해(둘째 rename이 ENOENT) 저장이 깨질 수 있다. tmp 이름에 랜덤 suffix를 더하고
  // 인스턴스 내 save/saveText를 큐로 직렬화해 병렬 호출도 안전해야 한다.
  it('병렬 save를 다수 실행해도 최종 파일이 유효 JSON이고 tmp 잔재가 없다', async () => {
    const store = createStoryStore(dir)
    const states = Array.from({ length: 20 }, (_, i) => ({ ...defaultStoryState(), pendingPushRevision: i }))
    await Promise.all(states.map((s) => store.save(s)))

    const raw = await readFile(path.join(dir, 'story', 'story.json'), 'utf-8')
    expect(() => JSON.parse(raw)).not.toThrow()
    const files = await readdir(path.join(dir, 'story'))
    expect(files.filter((f) => f.includes('.tmp'))).toEqual([])
  })

  it('병렬 saveText를 다수 실행해도 최종 파일이 유효하고 tmp 잔재가 없다', async () => {
    const store = createStoryStore(dir)
    const texts = Array.from({ length: 20 }, (_, i) => `본문 ${i}`)
    await Promise.all(texts.map((t) => store.saveText('script.md', t)))

    const raw = await store.loadText('script.md')
    expect(texts).toContain(raw)
    const files = await readdir(path.join(dir, 'story'))
    expect(files.filter((f) => f.includes('.tmp'))).toEqual([])
  })

  it('saveBinary 왕복 — non-UTF8 바이트도 손상 없이 저장/읽기', async () => {
    const store = createStoryStore(dir)
    const buf = Buffer.from([0x00, 0xff, 0x10, 0xfe, 0x42])
    await store.saveBinary('audio/segments/s1.wav', buf)
    const read = await readFile(path.join(dir, 'story', 'audio/segments/s1.wav'))
    expect(Buffer.compare(read, buf)).toBe(0)
  })

  it('saveBinary 원자적 쓰기 — tmp 파일이 남지 않는다', async () => {
    const store = createStoryStore(dir)
    const buf = Buffer.from([0xde, 0xad, 0xbe, 0xef])
    await store.saveBinary('audio/output.bin', buf)
    const files = await readdir(path.join(dir, 'story'))
    expect(files.filter((f) => f.includes('.tmp'))).toEqual([])
  })

  it('saveBinary는 없는 중첩 디렉토리를 생성한다', async () => {
    const store = createStoryStore(dir)
    const buf = Buffer.from([0x11, 0x22, 0x33])
    const relPath = 'audio/segments/nested/deep/file.bin'
    await store.saveBinary(relPath, buf)
    expect(existsSync(path.join(dir, 'story', relPath))).toBe(true)
    const read = await readFile(path.join(dir, 'story', relPath))
    expect(Buffer.compare(read, buf)).toBe(0)
  })

  // m5-잔여(R2): updateText — write 큐 안에서 read-modify-write를 원자화해 lost-update 방지.
  describe('updateText (원자적 read-modify-write)', () => {
    it('updater가 현재 내용을 받아 갱신 저장한다(없으면 null)', async () => {
      const store = createStoryStore(dir)
      let seen
      await store.updateText('research.draft.json', (raw) => { seen = raw; return '{"a":1}' })
      expect(seen).toBeNull()
      await store.updateText('research.draft.json', (raw) => {
        const d = JSON.parse(raw); d.b = 2; return JSON.stringify(d)
      })
      expect(JSON.parse(await store.loadText('research.draft.json'))).toEqual({ a: 1, b: 2 })
    })

    it('동시 updateText 두 건이 서로의 필드를 덮지 않는다(lost-update 방지 — 큐 안 재읽기)', async () => {
      const store = createStoryStore(dir)
      await store.saveText('d.json', JSON.stringify({ transcripts: { vidA: { ok: true } } }))
      // 두 갱신을 동시에 발사 — 하나는 selectedVideoIds, 하나는 transcripts.vidB 추가.
      // 큐 안에서 각 task가 최신을 재읽으므로 둘 다 살아남아야 한다.
      const p1 = store.updateText('d.json', (raw) => {
        const d = JSON.parse(raw); d.selectedVideoIds = ['vidA']; return JSON.stringify(d)
      })
      const p2 = store.updateText('d.json', (raw) => {
        const d = JSON.parse(raw); d.transcripts.vidB = { ok: true }; return JSON.stringify(d)
      })
      await Promise.all([p1, p2])
      const final = JSON.parse(await store.loadText('d.json'))
      expect(final.selectedVideoIds).toEqual(['vidA'])
      expect(final.transcripts).toEqual({ vidA: { ok: true }, vidB: { ok: true } })
    })

    it('updater가 null을 반환하면 파일을 건드리지 않는다', async () => {
      const store = createStoryStore(dir)
      await store.saveText('d.json', 'keep')
      await store.updateText('d.json', () => null)
      expect(await store.loadText('d.json')).toBe('keep')
    })
  })

  // 리서치 슬라이스(§3.8): researchSkip이 draft/research.json/transcripts를 정리할 때 사용.
  it('remove — 파일/디렉토리 삭제, 없는 경로는 no-op', async () => {
    const store = createStoryStore(dir)
    await store.saveText('research.draft.json', '{}')
    await store.saveText('research/transcripts/vidA.srt', 'srt')
    await store.remove('research.draft.json')
    await store.remove('research')
    expect(existsSync(path.join(dir, 'story', 'research.draft.json'))).toBe(false)
    expect(existsSync(path.join(dir, 'story', 'research'))).toBe(false)
    await expect(store.remove('없는파일.json')).resolves.toBeUndefined()
  })
})
