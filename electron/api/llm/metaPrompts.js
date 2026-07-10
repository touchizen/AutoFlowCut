/**
 * story-engine 장르 메타프롬프트 로더 (main process). 대본(W3) 웨이브만 주입한다.
 * 파일명은 story-engine SKILL.md W3 표 기준 + 공통 hook_principles(표 외 추가).
 */
import { readFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { app } from 'electron'

// dev(vite-plugin-electron)에서 app.getAppPath()는 프로젝트 루트가 아니라 electron 바이너리의
// 번들 Resources 를 반환한다(실측 확인). 거기엔 skills 가 없다. main.js 가 쓰는 검증된 패턴대로
// 모듈 위치(dist-electron/main.js 로 번들됨)의 부모에서 잡는다.
export function devSkillsDir(moduleDir) {
  return path.join(moduleDir, '..', 'skills')
}

export function resolveSkillsDir() {
  if (app?.isPackaged) return path.join(process.resourcesPath, 'skills')
  return devSkillsDir(path.dirname(fileURLToPath(import.meta.url)))
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
