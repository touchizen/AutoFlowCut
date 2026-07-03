import { describe, it, expect, vi } from 'vitest'
import { mkdtemp, mkdir, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { loadMetaPrompt } from '../../../../electron/api/llm/metaPrompts.js'

async function fixtureSkillsDir() {
  const root = await mkdtemp(path.join(os.tmpdir(), 'skills-'))
  const base = path.join(root, 'story-engine', 'meta-prompts')
  await mkdir(path.join(base, 'yadam'), { recursive: true })
  await mkdir(path.join(base, '_common'), { recursive: true })
  await writeFile(path.join(base, 'yadam', 'yadam-scenario-guide.md'), 'SCENARIO')
  await writeFile(path.join(base, 'yadam', 'yadam-narrative-guide.md'), 'NARRATIVE')
  await writeFile(path.join(base, 'yadam', 'yadam-suspense-techniques.md'), 'SUSPENSE')
  await writeFile(path.join(base, '_common', 'hook_principles.md'), 'HOOK')
  return root
}

describe('loadMetaPrompt', () => {
  it('yadam script 웨이브: 3파일 + hook을 합친다', async () => {
    const skillsDir = await fixtureSkillsDir()
    const out = await loadMetaPrompt({ genre: 'yadam', wave: 'script', language: 'ko', skillsDir })
    expect(out).toContain('SCENARIO')
    expect(out).toContain('NARRATIVE')
    expect(out).toContain('SUSPENSE')
    expect(out).toContain('HOOK')
  })
  it('wave가 script가 아니면 빈 문자열', async () => {
    const skillsDir = await fixtureSkillsDir()
    expect(await loadMetaPrompt({ genre: 'yadam', wave: 'scenes', language: 'ko', skillsDir })).toBe('')
  })
  it('genre 없으면 빈 문자열', async () => {
    expect(await loadMetaPrompt({ wave: 'script', language: 'ko', skillsDir: '/nope' })).toBe('')
  })
  it('누락 파일은 경고 후 건너뛴다', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const out = await loadMetaPrompt({ genre: 'dark-history', wave: 'script', language: 'en', skillsDir: '/nonexistent' })
    expect(out).toBe('')
    expect(warn).toHaveBeenCalled()
    warn.mockRestore()
  })
})
