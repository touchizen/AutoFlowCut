import { describe, it, expect, vi } from 'vitest'
import { exportRenderVideo } from '../../src/exporters/render.js'

describe('exportRenderVideo', () => {
  it('prepares payload locally and calls renderMp4 without GCF', async () => {
    const prepareCloudRequest = vi.fn(async () => ({ cloudRequest: { format: 'portrait' }, mediaFiles: [], audioFiles: [], sfxFiles: [], pathMap: {} }))
    const renderMp4 = vi.fn(async () => ({ ok: true, outPath: '/o.mp4' }))
    const callExportFunction = vi.fn()
    const res = await exportRenderVideo({ name: 'p' }, { renderMode: 'final', renderBurnSubtitle: true },
      { prepareCloudRequest, renderMp4, callExportFunction, makeJobId: () => 'job_1' })
    expect(prepareCloudRequest).toHaveBeenCalled()
    expect(callExportFunction).not.toHaveBeenCalled()
    expect(renderMp4).toHaveBeenCalledWith(expect.objectContaining({
      jobId: 'job_1',
      options: { renderMode: 'final', renderBurnSubtitle: true },
      prepared: expect.objectContaining({ cloudRequest: { format: 'portrait' } }),
    }))
    expect(res.ok).toBe(true)
  })

  it('generates a deterministic jobId without Date.now', async () => {
    const prepareCloudRequest = vi.fn(async () => ({ cloudRequest: {} }))
    const renderMp4 = vi.fn(async (p) => p.jobId)
    const j1 = await exportRenderVideo({ name: 'My Proj' }, { renderMode: 'preview', renderBurnSubtitle: false }, { prepareCloudRequest, renderMp4 })
    const j2 = await exportRenderVideo({ name: 'My Proj' }, { renderMode: 'preview', renderBurnSubtitle: false }, { prepareCloudRequest, renderMp4 })
    expect(j1).toMatch(/My_Proj/)
    expect(j1).not.toBe(j2) // counter advances
  })
})
