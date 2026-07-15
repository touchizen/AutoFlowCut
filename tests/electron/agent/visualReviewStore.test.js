// @vitest-environment node
import { describe, it, expect, beforeEach } from 'vitest'
import { mkdtemp, readFile, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import * as fs from 'node:fs/promises'
import { createVisualReviewStore } from '../../../electron/agent/visualReviewStore.js'

// M3 I8 (slice 33): visual review 는 renderer scene field 나 story state 가 아니라 main 소유
// durable dotfile 이다. `.audio_review.json` 선례를 따른다. rendererSceneId 를 key 로.

let dir, store, clock
beforeEach(async () => {
  dir = await mkdtemp(path.join(tmpdir(), 'vr-'))
  clock = '2026-07-15T00:00:00.000Z'
  store = createVisualReviewStore({ projectPath: dir, fs, now: () => clock })
})

describe('createVisualReviewStore', () => {
  it('파일 없으면 빈 reviews', async () => {
    expect(await store.read()).toEqual({ version: 1, reviews: {} })
  })

  it('update → read round-trip (rendererSceneId key)', async () => {
    const updated = await store.update([
      { rendererSceneId: 'scene_17', storyId: 'a', status: 'rejected', reason: 'face artifact', ordinalAtReview: 1 },
    ])
    expect(updated).toEqual([
      { rendererSceneId: 'scene_17', storyId: 'a', status: 'rejected', reason: 'face artifact', ordinalAtReview: 1, updatedAt: clock },
    ])
    const { reviews } = await store.read()
    expect(reviews.scene_17).toEqual({ storyId: 'a', status: 'rejected', reason: 'face artifact', ordinalAtReview: 1, updatedAt: clock })
  })

  it('같은 씬 재리뷰 → 덮어쓴다 (append 아님)', async () => {
    await store.update([{ rendererSceneId: 'scene_17', status: 'rejected', reason: 'first' }])
    await store.update([{ rendererSceneId: 'scene_17', status: 'ok' }])
    const { reviews } = await store.read()
    expect(reviews.scene_17.status).toBe('ok')
    expect(reviews.scene_17.reason).toBeUndefined()
    expect(Object.keys(reviews)).toEqual(['scene_17'])
  })

  it('디스크에 실제로 원자적으로 쓴다 (파일이 생기고 파싱된다)', async () => {
    await store.update([{ rendererSceneId: 'scene_3', status: 'rejected' }])
    const raw = await readFile(path.join(dir, '.visual_review.json'), 'utf8')
    expect(JSON.parse(raw).reviews.scene_3.status).toBe('rejected')
  })

  it('손상 JSON 은 덮어쓰지 않고 visual-review-corrupt 로 던진다', async () => {
    await writeFile(path.join(dir, '.visual_review.json'), '{ not json', 'utf8')
    await expect(store.read()).rejects.toThrow('visual-review-corrupt')
    // update 도 corrupt read 위에서 write 하지 않는다.
    await expect(store.update([{ rendererSceneId: 'x', status: 'ok' }])).rejects.toThrow('visual-review-corrupt')
    // 원본은 그대로 (덮어쓰지 않았다).
    expect(await readFile(path.join(dir, '.visual_review.json'), 'utf8')).toBe('{ not json')
  })

  it('JSON 이지만 object 가 아니면 corrupt', async () => {
    await writeFile(path.join(dir, '.visual_review.json'), '[1,2,3]', 'utf8')
    await expect(store.read()).rejects.toThrow('visual-review-corrupt')
  })
})
