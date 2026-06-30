/**
 * premiereCloud.js exporter tests
 *
 * Covers the load-bearing logic of exportPremierePackageCloud:
 * - prepareCloudRequest reuse (cloudRequest + pathMap)
 * - token → XML-escaped absolute path substitution
 * - media/ prefix strip on mediaRefs filename lookup
 * - appId sent to generatePremiereJson
 * - unsubstituted-token guard
 * - writePremiereProject IPC receives raw (substituted) XML
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'

// --- Mocks -------------------------------------------------------

const callableSpy = vi.fn()
vi.mock('firebase/functions', () => ({
  getFunctions: vi.fn(() => ({})),
  httpsCallable: vi.fn(() => (data) => callableSpy(data)),
}))

vi.mock('../../src/firebase/config', () => ({ APP_ID: 'autoflowcut' }))

// prepareCloudRequest is reused — stub it to return a known cloudRequest + pathMap.
const prepareSpy = vi.fn()
vi.mock('../../src/exporters/prepareCloudRequest', () => ({
  prepareCloudRequest: (...args) => prepareSpy(...args),
}))

import { exportPremierePackageCloud } from '../../src/exporters/premiereCloud'

// --- Helpers -----------------------------------------------------

function setupWindow(writeResult = { success: true, targetPath: '/out/My Project.prproj' }) {
  const writePremiereProject = vi.fn().mockResolvedValue(writeResult)
  global.window = {
    electronAPI: {
      getVolumePath: vi.fn().mockResolvedValue({ success: true, volumePath: '' }),
      writePremiereProject,
    },
  }
  return writePremiereProject
}

beforeEach(() => {
  vi.clearAllMocks()
})

describe('exportPremierePackageCloud', () => {
  it('substitutes tokens with XML-escaped absolute paths and writes gzipped .prproj', async () => {
    const writePremiereProject = setupWindow()

    prepareSpy.mockResolvedValue({
      cloudRequest: { scenes: [{ id: 's1' }], mediaPathBase: 'media' },
      pathMap: {
        'image_scene_1.png': '/Users/me/proj/scene_1.png',
        'image_scene_2.png': '/Users/me/A & B/scene_2.png', // needs & escape
      },
    })

    callableSpy.mockResolvedValue({
      data: {
        premiereXml: '<root><a>__AFC_MEDIA_0__</a><b>__AFC_MEDIA_1__</b></root>',
        mediaRefs: [
          { token: '__AFC_MEDIA_0__', filename: 'media/image_scene_1.png' }, // media/ prefix
          { token: '__AFC_MEDIA_1__', filename: 'image_scene_2.png' },        // bare
        ],
        sceneCount: 2,
      },
    })

    const result = await exportPremierePackageCloud(
      { name: 'My Project' },
      { capcutProjectNumber: '/out' }
    )

    expect(result.success).toBe(true)

    // appId sent
    expect(callableSpy).toHaveBeenCalledWith(
      expect.objectContaining({ appId: 'autoflowcut' })
    )

    // IPC received substituted XML at the .prproj file path
    expect(writePremiereProject).toHaveBeenCalledTimes(1)
    const arg = writePremiereProject.mock.calls[0][0]
    expect(arg.targetPath).toBe('/out/My Project.prproj')

    const xml = arg.premiereXml
    // both tokens substituted, none left
    expect(xml).not.toMatch(/__AFC_MEDIA_\d+__/)
    expect(xml).toContain('/Users/me/proj/scene_1.png')
    // & escaped to &amp;
    expect(xml).toContain('/Users/me/A &amp; B/scene_2.png')
    expect(xml).not.toContain('A & B') // raw ampersand must not survive
  })

  it('applies macOS volume prefix to absolute paths', async () => {
    const writePremiereProject = setupWindow()
    global.window.electronAPI.getVolumePath.mockResolvedValue({
      success: true, volumePath: '/Volumes/Macintosh HD',
    })

    prepareSpy.mockResolvedValue({
      cloudRequest: { scenes: [{ id: 's1' }], mediaPathBase: 'media' },
      pathMap: { 'image_scene_1.png': '/Users/me/scene_1.png' },
    })
    callableSpy.mockResolvedValue({
      data: {
        premiereXml: '<r>__AFC_MEDIA_0__</r>',
        mediaRefs: [{ token: '__AFC_MEDIA_0__', filename: 'image_scene_1.png' }],
      },
    })

    await exportPremierePackageCloud({ name: 'P' }, { capcutProjectNumber: '/out' })

    const xml = writePremiereProject.mock.calls[0][0].premiereXml
    expect(xml).toContain('/Volumes/Macintosh HD/Users/me/scene_1.png')
  })

  it('throws if any media token remains unsubstituted (missing path)', async () => {
    setupWindow()
    prepareSpy.mockResolvedValue({
      cloudRequest: { scenes: [{ id: 's1' }], mediaPathBase: 'media' },
      pathMap: {}, // no path for the token
    })
    callableSpy.mockResolvedValue({
      data: {
        premiereXml: '<r>__AFC_MEDIA_0__</r>',
        mediaRefs: [{ token: '__AFC_MEDIA_0__', filename: 'image_scene_1.png' }],
      },
    })

    await expect(
      exportPremierePackageCloud({ name: 'P' }, { capcutProjectNumber: '/out' })
    ).rejects.toThrow(/Unsubstituted media tokens/)
  })

  it('requires capcutProjectNumber (output folder)', async () => {
    setupWindow()
    await expect(
      exportPremierePackageCloud({ name: 'P' }, {})
    ).rejects.toThrow(/folder path is required/)
  })

  it('throws if GCF returns empty premiereXml', async () => {
    setupWindow()
    prepareSpy.mockResolvedValue({
      cloudRequest: { scenes: [{ id: 's1' }], mediaPathBase: 'media' },
      pathMap: {},
    })
    callableSpy.mockResolvedValue({ data: { premiereXml: '', mediaRefs: [] } })

    await expect(
      exportPremierePackageCloud({ name: 'P' }, { capcutProjectNumber: '/out' })
    ).rejects.toThrow(/empty premiereXml/)
  })

  it('rejects with a clear error when GCF returns non-string premiereXml', async () => {
    const writePremiereProject = setupWindow()
    prepareSpy.mockResolvedValue({
      cloudRequest: { scenes: [{ id: 's1' }], mediaPathBase: 'media' },
      pathMap: {},
    })
    callableSpy.mockResolvedValue({ data: { premiereXml: null, mediaRefs: [] } })

    await expect(
      exportPremierePackageCloud({ name: 'P' }, { capcutProjectNumber: '/out' })
    ).rejects.toThrow(/invalid premiereXml/)
    expect(writePremiereProject).not.toHaveBeenCalled()
  })
})
