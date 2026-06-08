import { describe, expect, it, vi } from 'vitest'
import { exportCapcutToolResponse, handleExportCapcutTool } from '../../mcp-server/lib/toolResponses.js'

describe('mcp-server toolResponses', () => {
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

    expect(fetcher).toHaveBeenCalledWith(4321, 'POST', '/api/export-capcut')
    expect(result.isError).toBe(true)
    expect(result.content[0].text).toContain('No generated images')
  })
})
