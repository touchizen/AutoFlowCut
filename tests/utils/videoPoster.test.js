import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { waitFor } from '@testing-library/react'
import {
  VIDEO_POSTER_CACHE_LIMIT,
  clearVideoPosterCacheForTests,
  getVideoPoster,
} from '../../src/utils/videoPoster'

const POSTER = 'data:image/jpeg;base64,FAKE'

let createElementSpy
let originalCreateElement
let videos

class FakeVideo {
  constructor({ duration = 3, autoMetadata = true } = {}) {
    this.duration = duration
    this.videoWidth = 1920
    this.videoHeight = 1080
    this.listeners = new Map()
    this.autoMetadata = autoMetadata
    this.muted = false
    this.playsInline = false
    this.preload = ''
    this.crossOrigin = ''
    this.paused = false
    this.removedSrc = false
    this._currentTime = 0
  }

  addEventListener(type, callback, options = {}) {
    const list = this.listeners.get(type) || []
    list.push({ callback, once: !!options.once })
    this.listeners.set(type, list)
  }

  dispatch(type) {
    const list = [...(this.listeners.get(type) || [])]
    for (const listener of list) listener.callback()
    this.listeners.set(type, (this.listeners.get(type) || []).filter(listener => !listener.once))
  }

  set src(value) {
    this._src = value
    if (this.autoMetadata) {
      queueMicrotask(() => this.dispatch('loadedmetadata'))
      queueMicrotask(() => this.dispatch('loadeddata'))
    }
  }

  get src() {
    return this._src
  }

  set currentTime(value) {
    this._currentTime = value
    queueMicrotask(() => this.dispatch('seeked'))
  }

  get currentTime() {
    return this._currentTime
  }

  pause() {
    this.paused = true
  }

  removeAttribute(name) {
    if (name === 'src') this.removedSrc = true
  }
}

function installFakeMediaDom(options = {}) {
  videos = []
  originalCreateElement = document.createElement.bind(document)
  createElementSpy = vi.spyOn(document, 'createElement').mockImplementation((tagName) => {
    if (tagName === 'video') {
      const video = new FakeVideo(options)
      videos.push(video)
      return video
    }
    if (tagName === 'canvas') {
      return {
        width: 0,
        height: 0,
        getContext: () => ({ drawImage: vi.fn() }),
        toDataURL: () => POSTER,
      }
    }
    return originalCreateElement(tagName)
  })
}

describe('videoPoster', () => {
  beforeEach(() => {
    clearVideoPosterCacheForTests()
  })

  afterEach(() => {
    createElementSpy?.mockRestore()
    createElementSpy = null
    clearVideoPosterCacheForTests()
  })

  it('captures away from the opening black frame for normal-duration videos', async () => {
    installFakeMediaDom({ duration: 3 })

    const poster = await getVideoPoster('file:///video.mp4')

    expect(poster).toBe(POSTER)
    expect(videos[0].currentTime).toBe(0.5)
  })

  it('sets crossOrigin only for http(s) video sources', async () => {
    installFakeMediaDom({ duration: 3 })

    await getVideoPoster('https://example.com/video.mp4')
    await getVideoPoster('file:///video.mp4')

    expect(videos[0].crossOrigin).toBe('anonymous')
    expect(videos[1].crossOrigin).toBe('')
  })

  it('does not start queued extraction work after the request is aborted', async () => {
    installFakeMediaDom({ duration: 3, autoMetadata: false })

    const first = getVideoPoster('file:///first.mp4')
    await Promise.resolve()

    const controller = new AbortController()
    const second = getVideoPoster('file:///second.mp4', { signal: controller.signal })
    controller.abort()

    expect(videos).toHaveLength(1)
    videos[0].dispatch('loadedmetadata')

    expect(await first).toBe(POSTER)
    expect(await second).toBeNull()
    expect(videos).toHaveLength(1)
  })

  it('retries the same source after an aborted queued request', async () => {
    installFakeMediaDom({ duration: 3, autoMetadata: false })

    const first = getVideoPoster('file:///first.mp4')
    await Promise.resolve()

    const controller = new AbortController()
    const aborted = getVideoPoster('file:///same.mp4', { signal: controller.signal })
    controller.abort()
    const retry = getVideoPoster('file:///same.mp4')

    expect(videos).toHaveLength(1)
    videos[0].dispatch('loadedmetadata')

    expect(await first).toBe(POSTER)
    expect(await aborted).toBeNull()
    await waitFor(() => expect(videos).toHaveLength(2))
    videos[1].dispatch('loadedmetadata')
    expect(await retry).toBe(POSTER)
    expect(videos).toHaveLength(2)
  })

  it('shared cache survives one consumer aborting when a peer is still alive', async () => {
    installFakeMediaDom({ duration: 3, autoMetadata: false })

    const ctrlA = new AbortController()
    const ctrlB = new AbortController()
    const consumerA = getVideoPoster('file:///shared.mp4', { signal: ctrlA.signal })
    const consumerB = getVideoPoster('file:///shared.mp4', { signal: ctrlB.signal })

    // A aborts; B is still interested — extraction must still fire and B must get the poster.
    ctrlA.abort()

    await waitFor(() => expect(videos).toHaveLength(1))
    videos[0].dispatch('loadedmetadata')

    expect(await consumerA).toBeNull()
    expect(await consumerB).toBe(POSTER)
    expect(videos).toHaveLength(1) // single shared extraction, no retry
  })

  it('bounds the poster cache and evicts the oldest entries', async () => {
    installFakeMediaDom({ duration: 3 })

    for (let i = 0; i < VIDEO_POSTER_CACHE_LIMIT + 1; i += 1) {
      await getVideoPoster(`file:///video-${i}.mp4`)
    }
    expect(videos).toHaveLength(VIDEO_POSTER_CACHE_LIMIT + 1)

    await getVideoPoster('file:///video-0.mp4')

    expect(videos).toHaveLength(VIDEO_POSTER_CACHE_LIMIT + 2)
  })
})
