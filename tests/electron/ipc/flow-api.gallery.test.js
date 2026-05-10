// @vitest-environment node

/**
 * flow:fetch-gallery / flow:list-projects IPC handlers
 *
 * Pins the parser shape and the URL-resolution path that took several
 * iterations to land:
 *   - project.searchUserProjects → flat {projectId, title, ...} list
 *   - project.getProjectContents → media + workflows
 *   - filter: every image (uploaded + generated), no videos
 *   - mediaId resolved via plain ?name=<uuid> redirect endpoint, then
 *     ses.fetch auto-follows to CDN, body → base64 data URL
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { registerFlowAPIIPC } from '../../../electron/ipc/flow-api.js'

function makeIpcMain() {
  const handlers = new Map()
  return {
    handle: vi.fn((name, fn) => handlers.set(name, fn)),
    invoke: (name, payload) => {
      const fn = handlers.get(name)
      if (!fn) throw new Error(`no handler ${name}`)
      return fn({}, payload)
    },
  }
}

const RESP_JSON = {
  result: {
    data: {
      json: {
        result: {
          media: [
            // generated image
            {
              name: 'gen-uuid-1',
              workflowId: 'wf1',
              image: { generatedImage: { /* fields */ }, dimensions: { width: 1, height: 1 } },
            },
            // uploaded image
            {
              name: 'up-uuid-2',
              workflowId: 'wf2',
              image: { userUploadedImage: { aspectRatio: 'X' }, dimensions: { width: 1, height: 1 } },
            },
            // a video — must be filtered OUT
            {
              name: 'vid-uuid-3',
              workflowId: 'wf3',
              video: { someVideo: 1 },
            },
          ],
          workflows: [
            { name: 'wf1', metadata: { displayName: 'generated.png', primaryMediaId: 'gen-uuid-1' } },
            { name: 'wf2', metadata: { displayName: 'photo.jpg', primaryMediaId: 'up-uuid-2' } },
            { name: 'wf3', metadata: { displayName: 'clip.mp4' } },
          ],
        },
      },
    },
  },
}

const PROJECTS_RESP = {
  result: {
    data: {
      json: {
        result: {
          projects: [
            {
              projectId: 'p-A',
              projectInfo: { projectTitle: 'Mar 11 - 14:53', thumbnailMediaKey: 'thumb-1' },
              creationTime: '2026-03-11T05:53:44Z',
            },
            {
              projectId: 'p-B',
              projectInfo: { projectTitle: 'Mar 11 - 14:39', thumbnailMediaKey: 'thumb-2' },
              creationTime: '2026-03-11T05:39:44Z',
            },
          ],
        },
      },
    },
  },
}

function mockSessionFetch({ projectContents, listProjects, mediaResolver }) {
  return vi.fn(async (url, opts) => {
    if (url.includes('project.searchUserProjects')) {
      return {
        ok: true,
        status: 200,
        text: async () => JSON.stringify(listProjects ?? PROJECTS_RESP),
      }
    }
    if (url.includes('project.getProjectContents')) {
      return {
        ok: true,
        status: 200,
        text: async () => JSON.stringify(projectContents ?? RESP_JSON),
      }
    }
    if (url.includes('media.getMediaUrlRedirect')) {
      // mediaId pulled from ?name=<uuid>
      const m = url.match(/[?&]name=([^&]+)/)
      const mediaId = decodeURIComponent(m?.[1] || '')
      return mediaResolver(mediaId)
    }
    throw new Error('unexpected url ' + url)
  })
}

function buildDeps(overrides = {}) {
  return {
    getFlowView: () => null,
    getMainWindow: () => null,
    trustedClickOnFlowView: vi.fn(),
    sessionFetch: vi.fn(),
    flowPageFetch: vi.fn(),
    parseFlowResponse: (text) => {
      try { return JSON.parse(text.replace(/^\)\]\}'/, '')) } catch { return null }
    },
    getRecaptchaToken: vi.fn(),
    extractMediaIds: vi.fn(),
    extractFifeUrls: vi.fn(),
    extractBase64Images: vi.fn(),
    fetchMediaAsBase64: vi.fn(),
    configureFlowMode: vi.fn(),
    getCapturedProjectId: () => 'captured-project-id',
    setCapturedProjectId: vi.fn(),
    getPendingGeneration: vi.fn(),
    setPendingGeneration: vi.fn(),
    pendingGenerations: new Map(),
    getPendingReferenceImages: vi.fn(),
    setPendingReferenceImages: vi.fn(),
    getPendingSeedValue: vi.fn(),
    setPendingSeedValue: vi.fn(),
    getEnterToolClicked: () => true,
    setEnterToolClicked: vi.fn(),
    SESSION_URL: 'https://x/session',
    TOKEN_INFO_URL: 'https://x/token',
    FLOW_URL: 'https://x/flow',
    MEDIA_REDIRECT_URL: 'https://labs.google/fx/api/trpc/media.getMediaUrlRedirect',
    UPLOAD_URL: 'https://x/upload',
    API_HEADERS: {},
    GENERATE_URL: 'https://x/generate',
    BASE_API_URL: 'https://x',
    ...overrides,
  }
}

describe('flow:list-projects', () => {
  it('flattens project.searchUserProjects response into title/thumb/creationTime', async () => {
    const ipc = makeIpcMain()
    const deps = buildDeps({ sessionFetch: mockSessionFetch({}) })
    registerFlowAPIIPC(ipc, deps)

    const out = await ipc.invoke('flow:list-projects', { token: 'tok', pageSize: 20 })
    expect(out.success).toBe(true)
    expect(out.items).toHaveLength(2)
    expect(out.items[0]).toMatchObject({
      projectId: 'p-A',
      title: 'Mar 11 - 14:53',
      thumbnailMediaKey: 'thumb-1',
    })
  })

  it('uses pageSize=PINHOLE in the URL query', async () => {
    const ipc = makeIpcMain()
    const sessionFetch = mockSessionFetch({})
    const deps = buildDeps({ sessionFetch })
    registerFlowAPIIPC(ipc, deps)

    await ipc.invoke('flow:list-projects', { token: 'tok' })
    const url = sessionFetch.mock.calls[0][0]
    expect(url).toContain('project.searchUserProjects')
    expect(url).toContain('PINHOLE')
  })
})

describe('flow:fetch-gallery', () => {
  it('returns every image (uploaded + generated) and skips videos', async () => {
    const ipc = makeIpcMain()
    const sessionFetch = mockSessionFetch({
      mediaResolver: async (id) => ({
        ok: true,
        status: 200,
        headers: { get: (h) => h.toLowerCase() === 'content-type' ? 'image/jpeg' : null },
        arrayBuffer: async () => new Uint8Array([1, 2, 3]).buffer,
      }),
    })
    const deps = buildDeps({ sessionFetch })
    registerFlowAPIIPC(ipc, deps)

    const out = await ipc.invoke('flow:fetch-gallery', { token: 'tok', projectId: 'pid' })
    expect(out.success).toBe(true)
    expect(out.items.map(i => i.mediaId).sort()).toEqual(['gen-uuid-1', 'up-uuid-2'])
    for (const it of out.items) {
      expect(it.url.startsWith('data:image/jpeg;base64,')).toBe(true)
    }
  })

  it('attaches workflow displayName to each item', async () => {
    const ipc = makeIpcMain()
    const sessionFetch = mockSessionFetch({
      mediaResolver: async () => ({
        ok: true,
        status: 200,
        headers: { get: () => 'image/png' },
        arrayBuffer: async () => new Uint8Array([1]).buffer,
      }),
    })
    registerFlowAPIIPC(ipc, buildDeps({ sessionFetch }))

    const out = await ipc.invoke('flow:fetch-gallery', { token: 'tok', projectId: 'pid' })
    const byId = Object.fromEntries(out.items.map(i => [i.mediaId, i.displayName]))
    expect(byId['gen-uuid-1']).toBe('generated.png')
    expect(byId['up-uuid-2']).toBe('photo.jpg')
  })

  it('drops only the items whose redirect resolution fails', async () => {
    const ipc = makeIpcMain()
    const sessionFetch = mockSessionFetch({
      mediaResolver: async (id) => {
        if (id === 'gen-uuid-1') return { ok: false, status: 401 }
        return {
          ok: true,
          status: 200,
          headers: { get: () => 'image/jpeg' },
          arrayBuffer: async () => new Uint8Array([9]).buffer,
        }
      },
    })
    registerFlowAPIIPC(ipc, buildDeps({ sessionFetch }))

    const out = await ipc.invoke('flow:fetch-gallery', { token: 'tok', projectId: 'pid' })
    expect(out.items.map(i => i.mediaId)).toEqual(['up-uuid-2'])
  })

  it('uses ?name=<uuid> plain query for the redirect endpoint (not tRPC ?input=)', async () => {
    const ipc = makeIpcMain()
    const sessionFetch = mockSessionFetch({
      mediaResolver: async () => ({
        ok: true,
        status: 200,
        headers: { get: () => 'image/jpeg' },
        arrayBuffer: async () => new Uint8Array([0]).buffer,
      }),
    })
    registerFlowAPIIPC(ipc, buildDeps({ sessionFetch }))

    await ipc.invoke('flow:fetch-gallery', { token: 'tok', projectId: 'pid' })

    const redirectCalls = sessionFetch.mock.calls
      .filter(([u]) => u.includes('media.getMediaUrlRedirect'))
    expect(redirectCalls.length).toBeGreaterThan(0)
    for (const [u] of redirectCalls) {
      expect(u).toMatch(/\?name=[a-z0-9-]+$/i)
      expect(u).not.toContain('?input=')
    }
  })

  it('falls back to captured projectId when none is passed', async () => {
    const ipc = makeIpcMain()
    const sessionFetch = mockSessionFetch({
      mediaResolver: async () => ({
        ok: true,
        status: 200,
        headers: { get: () => 'image/jpeg' },
        arrayBuffer: async () => new Uint8Array([0]).buffer,
      }),
    })
    registerFlowAPIIPC(ipc, buildDeps({ sessionFetch }))

    await ipc.invoke('flow:fetch-gallery', { token: 'tok' /* no projectId */ })
    const contentsCall = sessionFetch.mock.calls
      .find(([u]) => u.includes('project.getProjectContents'))
    expect(contentsCall[0]).toContain(encodeURIComponent('captured-project-id'))
  })
})
