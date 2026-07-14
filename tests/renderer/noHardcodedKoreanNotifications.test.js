// @vitest-environment node
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { relative, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import {
  findHardcodedKoreanNotifications,
  shouldScanRendererFile,
} from '../helpers/rendererNotificationLocaleGuard'

const PROJECT_ROOT = fileURLToPath(new URL('../../', import.meta.url))
const SRC_ROOT = resolve(PROJECT_ROOT, 'src')

function jsFiles(dir) {
  return readdirSync(dir).flatMap((name) => {
    const path = resolve(dir, name)
    if (statSync(path).isDirectory()) return jsFiles(path)
    const projectPath = relative(PROJECT_ROOT, path)
    return shouldScanRendererFile(projectPath) ? [path] : []
  })
}

describe('renderer notification locale guard', () => {
  it('rejects a direct hardcoded Korean confirmation', () => {
    const offenders = findHardcodedKoreanNotifications(`
      window.confirm('한글 확인 문구')
      toast.error?.('한글 오류 문구')
    `)

    expect(offenders).toHaveLength(2)
    expect(offenders[0].expression).toContain('한글 확인 문구')
    expect(offenders[1].expression).toContain('한글 오류 문구')
  })

  it('ignores Korean comments and non-UI story prompts', () => {
    const source = `
      // window.confirm('주석 속 문구')
      const storyPrompt = '조선 시대 산골 마을을 배경으로 이야기를 작성하세요'
      sendPrompt(storyPrompt)
    `

    expect(findHardcodedKoreanNotifications(source)).toEqual([])
  })

  it('excludes locale catalogs while scanning renderer sources', () => {
    expect(shouldScanRendererFile('src/App.jsx')).toBe(true)
    expect(shouldScanRendererFile('src/locales/ko.js')).toBe(false)
    expect(shouldScanRendererFile('src/locales/en.js')).toBe(false)
  })

  it('has no hardcoded Korean notification strings in src/', () => {
    const offenders = jsFiles(SRC_ROOT).flatMap((file) => (
      findHardcodedKoreanNotifications(readFileSync(file, 'utf8')).map(offender => ({
        ...offender,
        file: relative(PROJECT_ROOT, file),
      }))
    ))

    expect(
      offenders,
      `Move renderer notification text into both locale catalogs:\n${offenders
        .map(({ file, line, expression }) => `${file}:${line}  ${expression.split('\n')[0].slice(0, 120)}`)
        .join('\n')}`,
    ).toEqual([])
  })
})
