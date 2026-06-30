import { describe, it, expect, vi } from 'vitest'
import { createEngineApi } from '../../src/engine/engineApi'

describe('engineApi T7: mention-strip absorption', () => {
  function makeFakeGenAPI() {
    return {
      accessToken: 'byok', projectId: null,
      getAccessToken: vi.fn(), clearTokenCache: vi.fn(), listModels: vi.fn(),
      generateImage: vi.fn().mockResolvedValue({ success: true }),
      submitGeneration: vi.fn().mockResolvedValue({ success: true, generationId: 'g1' }),
      checkGeneration: vi.fn(), collectGeneration: vi.fn(), clearGenerations: vi.fn(),
      uploadReference: vi.fn().mockResolvedValue({ success: true, mediaId: 'm1' }),
      fetchMedia: vi.fn(),
      generateVideoT2V: vi.fn(), generateVideoI2V: vi.fn(), checkVideoStatus: vi.fn(), downloadVideo: vi.fn(),
      upscaleVideo: vi.fn(), upscaleImage: vi.fn(), fetchGallery: vi.fn(), listFlowProjects: vi.fn(),
      setStopRequested: vi.fn(),
    }
  }

  it('submitGeneration strips @mention from raw prompt before IPC call', async () => {
    const genAPI = makeFakeGenAPI()
    const engine = createEngineApi(genAPI)
    const ref = { id: 1, name: 'hero', type: 'character', category: 'character', mediaId: null, data: 'x', filePath: null }
    await engine.submitGeneration('A wizard @hero walks', [], { references: [ref] })
    expect(genAPI.submitGeneration).toHaveBeenCalledWith('A wizard hero walks', [], expect.objectContaining({ references: [ref] }))
  })

  it('generateImage strips @mention from raw prompt before IPC call', async () => {
    const genAPI = makeFakeGenAPI()
    const engine = createEngineApi(genAPI)
    const ref = { id: 1, name: 'hero', type: 'character', category: 'character', mediaId: null, data: 'x', filePath: null }
    await engine.generateImage('A wizard @hero walks', [], { references: [ref] })
    expect(genAPI.generateImage).toHaveBeenCalledWith('A wizard hero walks', [], expect.objectContaining({ references: [ref] }))
  })

  it('submitGeneration with no references passes prompt unchanged', async () => {
    const genAPI = makeFakeGenAPI()
    const engine = createEngineApi(genAPI)
    await engine.submitGeneration('A wizard walks', [], {})
    expect(genAPI.submitGeneration).toHaveBeenCalledWith('A wizard walks', [], {})
  })

  it('uploadReference normalizes string category to object call on genAPI', async () => {
    const genAPI = makeFakeGenAPI()
    const engine = createEngineApi(genAPI)
    await engine.uploadReference('b64data', { category: 'character', name: 'hero', type: 'character', refId: 1 })
    expect(genAPI.uploadReference).toHaveBeenCalledWith('b64data', 'character')
  })

  it('opts.purpose and opts.ref are passed through (ignored by genAPI, no error)', async () => {
    const genAPI = makeFakeGenAPI()
    const engine = createEngineApi(genAPI)
    await engine.generateImage('prompt', [], { purpose: 'reference', ref: { id: 1, name: 'x' } })
    expect(genAPI.generateImage).toHaveBeenCalledWith('prompt', [], { purpose: 'reference', ref: { id: 1, name: 'x' } })
  })
})
