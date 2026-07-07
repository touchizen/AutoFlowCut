/**
 * story.json / story 산출물 영속화 — 스펙 §2, §3.
 * 소유자는 main process 스텝 머신. temp 파일 + rename으로 원자적 쓰기.
 */
import { mkdir, readFile, writeFile, rename, rm } from 'node:fs/promises'
import { randomUUID } from 'node:crypto'
import path from 'node:path'

export function defaultStoryState() {
  return {
    version: 1,
    input: null,
    engine: { llm: 'claude' },
    steps: {
      script: { status: 'pending' },
      scenes: { status: 'pending' },
      audio: { status: 'pending', registration: null },
      prompts: { status: 'pending' },
    },
    autoRun: false,
    pushedAt: null,
    pendingPushRevision: 0,
    lastPushedRevision: 0,
    speakers: [],
  }
}

export function createStoryStore(projectPath) {
  const storyDir = path.join(projectPath, 'story')
  // HIGH/Codex: 같은 프로세스 내 동시 save가 같은 pid-only tmp 경로를 놓고 경합하면 둘째
  // rename이 ENOENT로 실패한다. tmp 이름에 랜덤 suffix를 더해 경로 충돌을 없애고, 그 위에
  // 인스턴스별 promise 큐로 write 직렬화까지 더해 파일 내용 자체의 교착(마지막-쓰기-승리 순서
  // 보장)도 안전하게 만든다.
  let writeQueue = Promise.resolve()

  function enqueueWrite(task) {
    const result = writeQueue.then(task)
    writeQueue = result.then(() => undefined, () => undefined)
    return result
  }

  async function writeAtomic(relPath, data, encoding = 'utf-8') {
    await mkdir(path.dirname(path.join(storyDir, relPath)), { recursive: true })
    const target = path.join(storyDir, relPath)
    const tmp = `${target}.tmp-${process.pid}-${randomUUID().slice(0, 8)}`
    await writeFile(tmp, data, encoding)
    await rename(tmp, target)
  }

  return {
    async load() {
      try {
        return JSON.parse(await readFile(path.join(storyDir, 'story.json'), 'utf-8'))
      } catch {
        return defaultStoryState()
      }
    },
    async save(state) { return enqueueWrite(() => writeAtomic('story.json', JSON.stringify(state, null, 2))) },
    async saveText(relPath, text) { return enqueueWrite(() => writeAtomic(relPath, text)) },
    async saveBinary(relPath, buffer) { return enqueueWrite(() => writeAtomic(relPath, buffer, null)) },
    async loadText(relPath) {
      try { return await readFile(path.join(storyDir, relPath), 'utf-8') } catch { return null }
    },
    // 리서치 m5-잔여: read-modify-write를 write 큐 안에서 원자화한다. updater가 "현재 파일 내용
    // (없으면 null)"을 받아 새 텍스트를 반환하면 저장, null이면 no-op. 읽기가 큐 task 안에 있어
    // 다른 write와의 lost-update(stale 스냅샷 덮어쓰기)가 발생하지 않는다.
    async updateText(relPath, updater) {
      return enqueueWrite(async () => {
        let current = null
        try { current = await readFile(path.join(storyDir, relPath), 'utf-8') } catch { current = null }
        const next = await updater(current)
        if (next == null) return
        await writeAtomic(relPath, next)
      })
    },
    // 리서치 §3.8: draft/research.json/transcripts 정리(researchSkip). 없는 경로는 no-op(force).
    async remove(relPath) { return enqueueWrite(() => rm(path.join(storyDir, relPath), { recursive: true, force: true })) },
  }
}
