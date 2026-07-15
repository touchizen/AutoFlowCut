import path from 'node:path'
import { randomUUID } from 'node:crypto'

/**
 * visual review 영속 store (M3, slice 33).
 *
 * 🔴 renderer scene field 나 story state 가 아니라 **main 소유 durable dotfile** 이다
 *    (`.audio_review.json` 선례). 이유:
 *    - renderer scene 은 CSV 재import 때 merge/rebuild 되어 field 가 유실될 수 있다. side file 은 구조적으로 산다.
 *    - audio-first story scene 엔 rendererSceneId 가 없다 — 리뷰는 renderer scene 에 대한 것이라 key 가 없다.
 *
 * key 는 rendererSceneId. ordinal 은 기록 시점 metadata 로만 두고, 읽을 때 현재 resolver 로 재계산한다.
 * 손상 JSON 은 **덮어쓰지 않고** 실행 오류로 닫는다 — 조용히 재작성하면 사람이 남긴 리뷰가 사라진다.
 *
 * @param {{projectPath:string, fs:object, now?:()=>string}} deps fs 는 node:fs/promises 호환.
 */
export function createVisualReviewStore({ projectPath, fs, now = () => new Date().toISOString() }) {
  const file = path.join(projectPath, '.visual_review.json')

  async function read() {
    let raw
    try {
      raw = await fs.readFile(file, 'utf8')
    } catch {
      // 파일 부재는 정상 — 아직 아무 리뷰도 없다.
      return { version: 1, reviews: {} }
    }
    let parsed
    try {
      parsed = JSON.parse(raw)
    } catch {
      throw new Error('visual-review-corrupt')
    }
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      throw new Error('visual-review-corrupt')
    }
    return { version: 1, reviews: parsed.reviews && typeof parsed.reviews === 'object' ? parsed.reviews : {} }
  }

  async function writeAtomic(data) {
    // temp+rename 으로 원자화 — 쓰다 죽어도 기존 파일은 온전하다.
    const tmp = `${file}.${randomUUID()}.tmp`
    await fs.writeFile(tmp, JSON.stringify(data, null, 2))
    await fs.rename(tmp, file)
  }

  /**
   * entries 를 rendererSceneId key 로 덮어쓴다(append 아님). read-modify-write.
   * corrupt read 위에서는 write 하지 않는다 (read 가 throw).
   * @param {Array<{rendererSceneId:string, status:'rejected'|'ok', reason?:string, storyId?:string, ordinalAtReview?:number}>} entries
   * @returns {Promise<Array>} 기록된 record 목록.
   */
  async function update(entries) {
    const data = await read()
    const updated = []
    for (const e of entries) {
      const record = { status: e.status, updatedAt: now() }
      if (e.storyId !== undefined) record.storyId = e.storyId
      if (e.reason !== undefined) record.reason = e.reason
      if (e.ordinalAtReview !== undefined) record.ordinalAtReview = e.ordinalAtReview
      data.reviews[e.rendererSceneId] = record
      updated.push({ rendererSceneId: e.rendererSceneId, ...record })
    }
    await writeAtomic(data)
    return updated
  }

  return { read, update, file }
}
