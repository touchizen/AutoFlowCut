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

// isPackaged 는 dev 에서 거짓말을 한다: patch-electron-name 이 electron 바이너리를 AutoFlowCut.app
// 으로 리네임해 isPackaged=true 가 되고, process.resourcesPath 는 바이너리 자신의 Resources(skills
// 없음)를 가리킨다. 그래서 플래그가 아니라 "실제로 skills 가 있는 후보"를 골라야 한다.
import { pickSkillsDir } from '../../../../electron/api/llm/metaPrompts.js'

describe('pickSkillsDir — 존재하는 후보 선택', () => {
  it('첫 번째로 존재하는 후보를 고른다 (실제 packaged: resourcesPath)', () => {
    const exists = (p) => p === '/res/skills'
    expect(pickSkillsDir(['/res/skills', '/proj/skills'], exists)).toBe('/res/skills')
  })

  it('resourcesPath 에 없으면 모듈/cwd 후보로 떨어진다 (dev 의 가짜 packaged)', () => {
    const exists = (p) => p === '/proj/skills'
    expect(pickSkillsDir(['/electron/Resources/skills', '/proj/skills'], exists)).toBe('/proj/skills')
  })

  it('아무 후보도 없으면 마지막 후보로 폴백한다 (경고는 loadMetaPrompt 가 낸다)', () => {
    expect(pickSkillsDir(['/a/skills', '/b/skills'], () => false)).toBe('/b/skills')
  })

  it('falsy 후보(process.resourcesPath 미정의 등)는 건너뛴다', () => {
    const exists = (p) => p === '/proj/skills'
    expect(pickSkillsDir([undefined, null, '/proj/skills'], exists)).toBe('/proj/skills')
  })

  it('후보가 전부 falsy 면 빈 문자열 (크래시하지 않는다)', () => {
    expect(pickSkillsDir([undefined, null], () => true)).toBe('')
  })
})

// dev(vite-plugin-electron)에서 app.getAppPath()는 프로젝트 루트가 아니라 electron 바이너리의
// 번들 Resources(node_modules/electron/dist/…/Resources)를 반환한다. 거기엔 skills 가 없어
// 모든 메타파일이 ENOENT 로 뜬다. dev 경로는 모듈 위치(dist-electron)의 부모에서 잡아야 한다.


