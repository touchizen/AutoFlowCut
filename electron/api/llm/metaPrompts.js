/**
 * story-engine 장르 메타프롬프트 로더 (main process). 대본(W3) 웨이브만 주입한다.
 * 파일명은 story-engine SKILL.md W3 표 기준 + 공통 hook_principles(표 외 추가).
 */
import { readFile } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

// app.isPackaged 는 dev 에서 믿을 수 없다: patch-electron-name 이 electron 바이너리를
// AutoFlowCut.app 으로 리네임해 isPackaged=true 가 되고, process.resourcesPath 는 바이너리 자신의
// Resources(skills 없음)를 가리킨다(실측 확인). 그래서 플래그가 아니라 "실제로 skills 가 있는
// 후보"를 고른다. 실제 packaged 는 process.resourcesPath/skills 가, dev 는 프로젝트 루트가 이긴다.
export function pickSkillsDir(candidates, exists = existsSync) {
  const real = candidates.filter(Boolean)
  return real.find((c) => exists(c)) ?? real[real.length - 1] ?? ''
}

export function resolveSkillsDir() {
  const moduleDir = path.dirname(fileURLToPath(import.meta.url))
  return pickSkillsDir([
    process.resourcesPath && path.join(process.resourcesPath, 'skills'), // 실제 packaged
    path.join(moduleDir, '..', 'skills'), // dev: 번들 위치(dist-electron)의 부모
    path.join(process.cwd(), 'skills'), // dev: 프로젝트 루트에서 실행
  ])
}

// 장르 → 대본(W3) 파일 (리터럴 고정). bespoke는 language 서브폴더.
const W3_FILES = {
  yadam: () => ['yadam/yadam-scenario-guide.md', 'yadam/yadam-narrative-guide.md', 'yadam/yadam-suspense-techniques.md'],
  'dark-history': () => ['dark-history/screenplay_guidelines.md', 'dark-history/narrative_techniques.md', 'dark-history/suspense_techniques.md'],
  bespoke: (lang) => [`bespoke/${lang}/screenplay_guidelines.md`, `bespoke/${lang}/narrative_techniques.md`, `bespoke/${lang}/suspense_techniques.md`],
}
const COMMON_FILES = ['_common/hook_principles.md']

export async function loadMetaPrompt({ genre, wave, language = 'ko', skillsDir } = {}) {
  if (wave !== 'script' || !genre || !Object.hasOwn(W3_FILES, genre)) return ''
  const dir = skillsDir ?? resolveSkillsDir()
  const lang = language === 'en' ? 'en' : 'ko'
  const rels = [...W3_FILES[genre](lang), ...COMMON_FILES]
  const base = path.join(dir, 'story-engine', 'meta-prompts')
  const parts = []
  for (const rel of rels) {
    try {
      parts.push((await readFile(path.join(base, rel), 'utf8')).trim())
    } catch {
      console.warn(`[metaPrompts] missing meta file: ${rel}`)
    }
  }
  return parts.join('\n\n---\n\n')
}
