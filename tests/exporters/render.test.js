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

  it('does not call renderMp4 when shouldCancel latches before IPC registration', async () => {
    const prepareCloudRequest = vi.fn(async () => ({ cloudRequest: {} }))
    const renderMp4 = vi.fn()
    const res = await exportRenderVideo({ name: 'p' }, { renderMode: 'final', renderBurnSubtitle: false },
      { prepareCloudRequest, renderMp4, makeJobId: () => 'j', shouldCancel: () => true })
    expect(renderMp4).not.toHaveBeenCalled()
    expect(res).toMatchObject({ ok: false, cancelled: true })
  })

  it('proceeds to renderMp4 when shouldCancel stays false', async () => {
    const prepareCloudRequest = vi.fn(async () => ({ cloudRequest: {} }))
    const renderMp4 = vi.fn(async () => ({ ok: true }))
    await exportRenderVideo({ name: 'p' }, { renderMode: 'final', renderBurnSubtitle: false },
      { prepareCloudRequest, renderMp4, makeJobId: () => 'j', shouldCancel: () => false })
    expect(renderMp4).toHaveBeenCalled()
  })

  it('renders generated video overlays without confirmation or still-image substitution', async () => {
    const prepareCloudRequest = vi.fn(async () => ({
      cloudRequest: { videoOverlays: [{ sceneId: 'scene_1' }] },
      renderVideoSegments: [{ sceneId: 'scene_1', source: 'i2v', inSec: 0, outSec: 3 }],
    }))
    const renderMp4 = vi.fn(async () => ({ ok: true }))
    const confirmOverlays = vi.fn(async () => false)

    const result = await exportRenderVideo(
      { name: 'p' },
      { renderMode: 'final', renderBurnSubtitle: false },
      { prepareCloudRequest, renderMp4, confirmOverlays, makeJobId: () => 'j' },
    )

    expect(confirmOverlays).not.toHaveBeenCalled()
    expect(renderMp4).toHaveBeenCalled()
    expect(result).toMatchObject({ ok: true })
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
