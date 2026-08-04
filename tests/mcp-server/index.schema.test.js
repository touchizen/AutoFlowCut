// @vitest-environment node
/**
 * mcp-server 툴 스키마 — includePending 이 실제로 선언돼 있는가.
 *
 * 스키마가 port 만 받으면 클라이언트가 옵션을 보내도 MCP 계층에서 잘린다.
 * 예전에는 스키마·바디·화이트리스트 세 곳이 전부 막고 있었다.
 */
import { describe, it, expect } from 'vitest'
import fs from 'node:fs'

const source = fs.readFileSync(new URL('../../mcp-server/index.js', import.meta.url), 'utf8')

function schemaOf(toolName) {
  const start = source.indexOf(`name: '${toolName}'`)
  expect(start).toBeGreaterThan(-1)
  const end = source.indexOf("name: '", start + 10)
  return source.slice(start, end === -1 ? source.length : end)
}

describe('mcp-server 스키마 — includePending', () => {
  it.each(['export_capcut', 'export_premiere'])('%s 가 includePending 을 받는다', (tool) => {
    const block = schemaOf(tool)
    expect(block).toContain('includePending')
    expect(block).toContain("type: 'boolean'")
  })

  it('Vrew 내보내기 툴은 애초에 없다 (스코프 밖)', () => {
    expect(source).not.toContain("name: 'export_vrew'")
  })
})
