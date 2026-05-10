// @vitest-environment node

/**
 * flow:fetch-gallery / flow:list-projects IPC handlers
 *
 * Pins the parser shape and the URL-resolution path that took several
 * iterations to land:
 *   - project.searchUserProjects → flat {projectId, title, ...} list
 *   - project.getProjectContents → media + workflows
 *   - filter: every image (uploaded + generated), no videos
 *   - mediaId resolved via plain ?name=<uuid> redirect endpoint;
 *     net.request reads the 307 Location header and returns the signed
 *     CDN URL (must be on *.googleusercontent.com, https only)
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'

// Configurable per test: redirect handler picks a URL based on the request URL.
// Default returns a URL on lh3.googleusercontent.com (allowed host).
let redirectHandler = (url) => {
  const m = url.match(/[?&]name=([^&]+)/)
  return `https://lh3.googleusercontent.com/${decodeURIComponent(m?.[1] || 'x')}.jpg?Expires=1`
}
let redirectFailHandler = null // fn(url) => Error to fire instead, or null
let resolveDelayMs = 0 // delay before firing redirect — used to test concurrency
let stalls = false // when true, request never fires any event (used for timeout test)
let activeCount = 0
let peakActive = 0

vi.mock('electron', () => ({
  net: {
    request: vi.fn(({ url }) => {
      const handlers = {}
      const req = {
        setHeader: vi.fn(),
        on: vi.fn((evt, fn) => { handlers[evt] = fn }),
        end: vi.fn(() => {
          activeCount++
          if (activeCount > peakActive) peakActive = activeCount
          if (stalls) return // never settle — exercise the timeout path
          const fire = () => {
            activeCount--
            const fail = redirectFailHandler && redirectFailHandler(url)
            if (fail) handlers.error?.(fail)
            else handlers.redirect?.(307, 'GET', redirectHandler(url))
          }
          if (resolveDelayMs > 0) setTimeout(fire, resolveDelayMs)
          else setImmediate(fire)
        }),
        abort: vi.fn(),
      }
      return req
    }),
  },
}))

beforeEach(() => {
  resolveDelayMs = 0
  stalls = false
  activeCount = 0
  peakActive = 0
})

const { registerFlowAPIIPC } = await import('../../../electron/ipc/flow-api.js')

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

function mockSessionFetch({ projectContents, listProjects } = {}) {
  return vi.fn(async (url) => {
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
    throw new Error('unexpected url ' + url)
  })
}

function buildDeps(overrides = {}) {
  return {
    getFlowView: () => ({ webContents: { session: { fake: true } } }),
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
  beforeEach(() => {
    redirectFailHandler = null
    redirectHandler = (url) => {
      const m = url.match(/[?&]name=([^&]+)/)
      return `https://lh3.googleusercontent.com/${decodeURIComponent(m?.[1] || 'x')}.jpg?Expires=1`
    }
  })

  it('returns every image (uploaded + generated) as signed CDN URLs, skips videos', async () => {
    const ipc = makeIpcMain()
    const sessionFetch = mockSessionFetch()
    const deps = buildDeps({ sessionFetch })
    registerFlowAPIIPC(ipc, deps)

    const out = await ipc.invoke('flow:fetch-gallery', { token: 'tok', projectId: 'pid' })
    expect(out.success).toBe(true)
    expect(out.items.map(i => i.mediaId).sort()).toEqual(['gen-uuid-1', 'up-uuid-2'])
    for (const it of out.items) {
      expect(it.url).toMatch(/^https:\/\/lh3\.googleusercontent\.com\//)
      expect(it.url).not.toMatch(/^data:/)
    }
  })

  it('attaches workflow displayName to each item', async () => {
    const ipc = makeIpcMain()
    registerFlowAPIIPC(ipc, buildDeps({ sessionFetch: mockSessionFetch() }))

    const out = await ipc.invoke('flow:fetch-gallery', { token: 'tok', projectId: 'pid' })
    const byId = Object.fromEntries(out.items.map(i => [i.mediaId, i.displayName]))
    expect(byId['gen-uuid-1']).toBe('generated.png')
    expect(byId['up-uuid-2']).toBe('photo.jpg')
  })

  it('drops only the items whose redirect resolution fails', async () => {
    redirectFailHandler = (url) => url.includes('gen-uuid-1') ? new Error('boom') : null
    const ipc = makeIpcMain()
    registerFlowAPIIPC(ipc, buildDeps({ sessionFetch: mockSessionFetch() }))

    const out = await ipc.invoke('flow:fetch-gallery', { token: 'tok', projectId: 'pid' })
    expect(out.items.map(i => i.mediaId)).toEqual(['up-uuid-2'])
  })

  it('uses ?name=<uuid> plain query for the redirect endpoint (not tRPC ?input=)', async () => {
    const seenUrls = []
    redirectHandler = (url) => {
      seenUrls.push(url)
      const m = url.match(/[?&]name=([^&]+)/)
      return `https://lh3.googleusercontent.com/${decodeURIComponent(m?.[1] || 'x')}.jpg`
    }
    const ipc = makeIpcMain()
    registerFlowAPIIPC(ipc, buildDeps({ sessionFetch: mockSessionFetch() }))

    await ipc.invoke('flow:fetch-gallery', { token: 'tok', projectId: 'pid' })

    expect(seenUrls.length).toBeGreaterThan(0)
    for (const u of seenUrls) {
      expect(u).toMatch(/\?name=[a-z0-9-]+$/i)
      expect(u).not.toContain('?input=')
    }
  })

  it('drops items whose redirect points to a non-Google host', async () => {
    redirectHandler = (url) => {
      // pretend auth expired and we get redirected to an attacker site
      if (url.includes('gen-uuid-1')) return 'https://evil.example.com/login.png'
      const m = url.match(/[?&]name=([^&]+)/)
      return `https://lh3.googleusercontent.com/${decodeURIComponent(m?.[1] || 'x')}.jpg`
    }
    const ipc = makeIpcMain()
    registerFlowAPIIPC(ipc, buildDeps({ sessionFetch: mockSessionFetch() }))
    const out = await ipc.invoke('flow:fetch-gallery', { token: 'tok', projectId: 'pid' })
    expect(out.items.map(i => i.mediaId)).toEqual(['up-uuid-2'])
  })

  it('drops items whose redirect points to accounts.google.com (login redirect)', async () => {
    redirectHandler = (url) => {
      // simulate session-expired login redirect
      if (url.includes('gen-uuid-1')) return 'https://accounts.google.com/ServiceLogin?continue=...'
      const m = url.match(/[?&]name=([^&]+)/)
      return `https://lh3.googleusercontent.com/${decodeURIComponent(m?.[1] || 'x')}.jpg`
    }
    const ipc = makeIpcMain()
    registerFlowAPIIPC(ipc, buildDeps({ sessionFetch: mockSessionFetch() }))
    const out = await ipc.invoke('flow:fetch-gallery', { token: 'tok', projectId: 'pid' })
    expect(out.items.map(i => i.mediaId)).toEqual(['up-uuid-2'])
  })

  it('allows redirects to flow-content.google (Flow CDN on .google TLD)', async () => {
    redirectHandler = (url) => {
      const m = url.match(/[?&]name=([^&]+)/)
      return `https://flow-content.google/media/${decodeURIComponent(m?.[1] || 'x')}?Expires=1`
    }
    const ipc = makeIpcMain()
    registerFlowAPIIPC(ipc, buildDeps({ sessionFetch: mockSessionFetch() }))
    const out = await ipc.invoke('flow:fetch-gallery', { token: 'tok', projectId: 'pid' })
    expect(out.success).toBe(true)
    expect(out.items.map(i => i.mediaId).sort()).toEqual(['gen-uuid-1', 'up-uuid-2'])
  })

  it('allows redirects to googleapis.com hosts (Flow signed media URLs)', async () => {
    redirectHandler = (url) => {
      const m = url.match(/[?&]name=([^&]+)/)
      return `https://aisandbox-pa.googleapis.com/v1/media/${decodeURIComponent(m?.[1] || 'x')}?Expires=1`
    }
    const ipc = makeIpcMain()
    registerFlowAPIIPC(ipc, buildDeps({ sessionFetch: mockSessionFetch() }))
    const out = await ipc.invoke('flow:fetch-gallery', { token: 'tok', projectId: 'pid' })
    expect(out.success).toBe(true)
    // Both image media items should resolve (videos still excluded by filter)
    expect(out.items.map(i => i.mediaId).sort()).toEqual(['gen-uuid-1', 'up-uuid-2'])
  })

  it('drops items whose redirect uses http (not https)', async () => {
    redirectHandler = (url) => {
      if (url.includes('up-uuid-2')) return 'http://lh3.googleusercontent.com/foo.jpg'
      const m = url.match(/[?&]name=([^&]+)/)
      return `https://lh3.googleusercontent.com/${decodeURIComponent(m?.[1] || 'x')}.jpg`
    }
    const ipc = makeIpcMain()
    registerFlowAPIIPC(ipc, buildDeps({ sessionFetch: mockSessionFetch() }))
    const out = await ipc.invoke('flow:fetch-gallery', { token: 'tok', projectId: 'pid' })
    expect(out.items.map(i => i.mediaId)).toEqual(['gen-uuid-1'])
  })

  it('drops items whose redirect request stalls past the timeout', async () => {
    stalls = true
    vi.useFakeTimers()
    const ipc = makeIpcMain()
    registerFlowAPIIPC(ipc, buildDeps({ sessionFetch: mockSessionFetch() }))

    const promise = ipc.invoke('flow:fetch-gallery', { token: 'tok', projectId: 'pid' })
    // Advance past the 10s timeout; fake-timer-async lets microtasks run between ticks
    await vi.advanceTimersByTimeAsync(11_000)
    const out = await promise
    vi.useRealTimers()

    expect(out.success).toBe(true)
    expect(out.items).toEqual([]) // every item dropped via timeout
  })

  it('caps concurrent media URL resolution at 6', async () => {
    // 25 image items so we'd see >6 active without the cap
    const manyImages = Array.from({ length: 25 }, (_, i) => ({
      name: `m-${i}`,
      workflowId: `wf-${i}`,
      image: { generatedImage: {}, dimensions: { width: 1, height: 1 } },
    }))
    const projectContents = {
      result: { data: { json: { result: { media: manyImages, workflows: [] } } } },
    }
    resolveDelayMs = 25 // hold each fetch open long enough for backlog to form
    const sessionFetch = mockSessionFetch({ projectContents })
    const ipc = makeIpcMain()
    registerFlowAPIIPC(ipc, buildDeps({ sessionFetch }))

    await ipc.invoke('flow:fetch-gallery', { token: 'tok', projectId: 'pid' })
    expect(peakActive).toBeGreaterThan(0)
    expect(peakActive).toBeLessThanOrEqual(6)
  })

  it('falls back to captured projectId when none is passed', async () => {
    const ipc = makeIpcMain()
    const sessionFetch = mockSessionFetch()
    registerFlowAPIIPC(ipc, buildDeps({ sessionFetch }))

    await ipc.invoke('flow:fetch-gallery', { token: 'tok' /* no projectId */ })
    const contentsCall = sessionFetch.mock.calls
      .find(([u]) => u.includes('project.getProjectContents'))
    expect(contentsCall[0]).toContain(encodeURIComponent('captured-project-id'))
  })
})
