import { describe, expect, it, vi } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import {
  exportCapcutToolResponse,
  handleExportCapcutTool,
  exportPremiereToolResponse,
  handleExportPremiereTool,
} from '../../mcp-server/lib/toolResponses.js'
import * as toolResponses from '../../mcp-server/lib/toolResponses.js'

const mcpIndexSource = readFileSync(resolve(process.cwd(), 'mcp-server/index.js'), 'utf8')

describe('mcp-server toolResponses', () => {
  it('G3/H3: CSV tool response keeps structured warnings and appends them to visible content', () => {
    expect(toolResponses.csvToolResponse).toBeTypeOf('function')
    const warnings = [
      "Rejected unknown provider 'unknown' at generation.image.",
      "Rejected invalid model '__inherit__' at generation.video.t2v.",
    ]

    expect(toolResponses.csvToolResponse('CSV loaded', warnings)).toEqual({
      content: [{
        type: 'text',
        text: [
          'CSV loaded',
          '',
          'Warnings:',
          "- Rejected unknown provider 'unknown' at generation.image.",
          "- Rejected invalid model '__inherit__' at generation.video.t2v.",
        ].join('\n'),
      }],
      warnings,
    })
    expect(toolResponses.csvToolResponse('CSV loaded', [])).toEqual({
      content: [{ type: 'text', text: 'CSV loaded' }],
    })
  })

  it('G3: MCP CSV handlers collect parser warnings and pass them to the tool response', () => {
    const loadCsvBlock = mcpIndexSource.slice(
      mcpIndexSource.indexOf("case 'load_csv':"),
      mcpIndexSource.indexOf("case 'list_scenes':"),
    )
    expect(loadCsvBlock).toContain('bundleSceneCSVRows(data.scenes, { warnings: csvWarnings })')
    expect(loadCsvBlock).toContain('nestSceneGenerationColumns(row, { warnings: csvWarnings })')
    expect(loadCsvBlock).toMatch(/csvToolResponse\([\s\S]*csvWarnings,\s*\)/)

    const updateFieldBlock = mcpIndexSource.slice(
      mcpIndexSource.indexOf("case 'update_field':"),
      mcpIndexSource.indexOf("case 'list_references':"),
    )
    expect(updateFieldBlock).toContain(
      'nestSceneGenerationColumns(scenes[idx], { warnings: csvWarnings })',
    )
    expect(updateFieldBlock).toMatch(/csvToolResponse\([\s\S]*csvWarnings,\s*\)/)
  })

  it('export_capcut propagates HTTP failure as MCP tool error', () => {
    const result = exportCapcutToolResponse({
      status: 500,
      data: { success: false, error: 'toast.noGeneratedImages' },
    })

    expect(result.isError).toBe(true)
    expect(result.content[0].text).toContain('CapCut 내보내기 실패')
    expect(result.content[0].text).toContain('toast.noGeneratedImages')
  })

  it('export_capcut propagates success:false even with HTTP 200', () => {
    const result = exportCapcutToolResponse({
      status: 200,
      data: { success: false, error: 'No generated images' },
    })

    expect(result.isError).toBe(true)
    expect(result.content[0].text).toContain('No generated images')
  })

  it('export_capcut keeps successful app response as completion', () => {
    const result = exportCapcutToolResponse({
      status: 200,
      data: { success: true, path: '/tmp/capcut-project' },
    })

    expect(result.isError).toBeUndefined()
    expect(result.content[0].text).toContain('CapCut 내보내기 완료')
    expect(result.content[0].text).toContain('/tmp/capcut-project')
  })

  it('export_capcut handler fetches app endpoint and propagates failure', async () => {
    const fetcher = vi.fn().mockResolvedValue({
      status: 500,
      data: { success: false, error: 'No generated images' },
    })

    const result = await handleExportCapcutTool({ port: 4321 }, fetcher)

    expect(fetcher).toHaveBeenCalledWith(4321, 'POST', '/api/export-capcut', { includePending: false })
    expect(result.isError).toBe(true)
    expect(result.content[0].text).toContain('No generated images')
  })

  it('export_premiere propagates HTTP failure as MCP tool error', () => {
    const result = exportPremiereToolResponse({
      status: 500,
      data: { success: false, error: 'toast.noGeneratedImages' },
    })

    expect(result.isError).toBe(true)
    expect(result.content[0].text).toContain('Premiere 내보내기 실패')
    expect(result.content[0].text).toContain('toast.noGeneratedImages')
  })

  it('export_premiere keeps successful app response as completion', () => {
    const result = exportPremiereToolResponse({
      status: 200,
      data: { success: true, path: '/tmp/p.prproj' },
    })

    expect(result.isError).toBeUndefined()
    expect(result.content[0].text).toContain('Premiere 내보내기 완료')
    expect(result.content[0].text).toContain('/tmp/p.prproj')
  })

  it('export_premiere handler fetches app endpoint', async () => {
    const fetcher = vi.fn().mockResolvedValue({
      status: 200,
      data: { success: true, path: '/tmp/p.prproj' },
    })

    const result = await handleExportPremiereTool({ port: 4321 }, fetcher)

    expect(fetcher).toHaveBeenCalledWith(4321, 'POST', '/api/export-premiere', { includePending: false })
    expect(result.isError).toBeUndefined()
  })
})

// pending 씬 포함 옵션이 MCP 를 통과해 앱까지 도달하는지 — 스키마·바디·화이트리스트
// 세 곳이 전부 막고 있어서 예전에는 어디로도 가지 못했다.
describe('mcp-server toolResponses — includePending 전달', () => {
  it('기본은 false 다 (자동화 의미가 조용히 바뀌면 안 된다)', async () => {
    const fetcher = vi.fn().mockResolvedValue({ ok: true, status: 200, data: {} })

    await handleExportCapcutTool({ port: 3210 }, fetcher)
    await handleExportPremiereTool({ port: 3210 }, fetcher)

    expect(fetcher).toHaveBeenNthCalledWith(1, 3210, 'POST', '/api/export-capcut', { includePending: false })
    expect(fetcher).toHaveBeenNthCalledWith(2, 3210, 'POST', '/api/export-premiere', { includePending: false })
  })

  it('true 를 주면 그대로 바디에 실린다', async () => {
    const fetcher = vi.fn().mockResolvedValue({ ok: true, status: 200, data: {} })

    await handleExportCapcutTool({ port: 3210, includePending: true }, fetcher)
    await handleExportPremiereTool({ port: 3210, includePending: true }, fetcher)

    expect(fetcher).toHaveBeenNthCalledWith(1, 3210, 'POST', '/api/export-capcut', { includePending: true })
    expect(fetcher).toHaveBeenNthCalledWith(2, 3210, 'POST', '/api/export-premiere', { includePending: true })
  })

  it("truthy 문자열 같은 건 true 로 안 친다 (=== true)", async () => {
    const fetcher = vi.fn().mockResolvedValue({ ok: true, status: 200, data: {} })

    await handleExportCapcutTool({ port: 3210, includePending: 'yes' }, fetcher)

    expect(fetcher).toHaveBeenCalledWith(3210, 'POST', '/api/export-capcut', { includePending: false })
  })
})
