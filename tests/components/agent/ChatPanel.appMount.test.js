// @vitest-environment node
// 실제 view 전환 보존 효과는 ChatPanel.test.jsx가 검증한다. 이 guard는 App의 실제 mount 지점이
// generate/story 조건부 body 안으로 이동해 그 효과가 무효화되는 배선 mutant를 잡는다.
import fs from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'

describe('App agent surface 배치', () => {
  it('ChatPanel을 activeView 분기보다 앞선 전역 sibling으로 정확히 한 번 mount한다', () => {
    const source = fs.readFileSync(path.resolve('src/App.jsx'), 'utf8')
    const appRoot = source.indexOf('<div className={computeAppClass(mode)}>')
    const panel = source.indexOf('<ChatPanel', appRoot)
    const generateBranch = source.indexOf("{activeView === 'generate' && (", appRoot)
    const storyBranch = source.indexOf("{activeView === 'story' && (", appRoot)

    expect(source).toContain("import ChatPanel from './components/agent/ChatPanel'")
    expect(appRoot).toBeGreaterThan(-1)
    expect(panel).toBeGreaterThan(appRoot)
    expect(panel).toBeLessThan(generateBranch)
    expect(panel).toBeLessThan(storyBranch)
    const approval = source.lastIndexOf('<ApprovalDialog', panel)
    expect(source.slice(approval, panel)).toMatch(/<ApprovalDialog\s*\/>\s*$/)
    expect(source.match(/<ChatPanel\b/g)).toHaveLength(1)
  })
})
