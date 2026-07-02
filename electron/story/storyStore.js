/**
 * story.json / story 산출물 영속화 — 스펙 §2, §3.
 * 소유자는 main process 스텝 머신. temp 파일 + rename으로 원자적 쓰기.
 */
import { mkdir, readFile, writeFile, rename } from 'node:fs/promises'
import path from 'node:path'

export function defaultStoryState() {
  return {
    version: 1,
    input: null,
    engine: { llm: 'gemini' },
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

  async function writeAtomic(relPath, data) {
    await mkdir(path.dirname(path.join(storyDir, relPath)), { recursive: true })
    const target = path.join(storyDir, relPath)
    const tmp = `${target}.tmp-${process.pid}`
    await writeFile(tmp, data, 'utf-8')
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
    async save(state) { await writeAtomic('story.json', JSON.stringify(state, null, 2)) },
    async saveText(relPath, text) { await writeAtomic(relPath, text) },
    async loadText(relPath) {
      try { return await readFile(path.join(storyDir, relPath), 'utf-8') } catch { return null }
    },
  }
}
