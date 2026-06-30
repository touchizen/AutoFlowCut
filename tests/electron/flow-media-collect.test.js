// @vitest-environment jsdom

/**
 * flow-media-collect — collect generated images from the Flow agent-chat DOM.
 *
 * Flow's agent model returns the image inside the streamChat SSE (NO separate
 * batchGenerateImages request fires), so the old response-interception
 * collection never completes. Instead each result renders as
 *   <img alt="생성된 이미지" src=".../media.getMediaUrlRedirect?name=<UUID>">
 * which is a fetchable (cookie-auth) URL. We scan the DOM for these and fetch them.
 */

import { describe, it, expect, beforeEach } from 'vitest'
import { extractMediaName, scanGeneratedImages, GENERATED_IMG_PROBE, planDomImageAssignments, clampImageBatchCount, scanGeneratedVideos, GENERATED_VIDEO_PROBE } from '../../electron/flow-media-collect.js'

const REDIRECT = (uuid) => `https://labs.google/fx/api/trpc/media.getMediaUrlRedirect?name=${uuid}`
const U1 = '0670a4e9-febb-4016-8ab8-624f6717ab44'
const U2 = '11111111-2222-3333-4444-555555555555'

// jsdom has no layout → getBoundingClientRect returns 0. Force a size so the
// "real generated image" size filter passes.
function img(uuid, { alt = '생성된 이미지', w = 689, h = 388 } = {}) {
  const el = document.createElement('img')
  el.setAttribute('src', REDIRECT(uuid))
  el.setAttribute('alt', alt)
  el.getBoundingClientRect = () => ({ width: w, height: h })
  return el
}

beforeEach(() => { document.body.innerHTML = '' })

describe('extractMediaName', () => {
  it('pulls the UUID from a media.getMediaUrlRedirect src', () => {
    expect(extractMediaName(REDIRECT(U1))).toBe(U1)
  })
  it('returns null for unrelated / empty src', () => {
    expect(extractMediaName('https://example.com/x.png')).toBeNull()
    expect(extractMediaName('')).toBeNull()
    expect(extractMediaName(null)).toBeNull()
  })
})

describe('scanGeneratedImages', () => {
  it('returns generated images in DOM (submission) order with their mediaId', () => {
    document.body.appendChild(img(U1))
    document.body.appendChild(img(U2))
    const out = scanGeneratedImages(document)
    expect(out.map(i => i.mediaId)).toEqual([U1, U2])
    expect(out[0].src).toContain(U1)
  })

  it('ignores tiny icons/avatars (no name param, or sub-threshold size)', () => {
    const icon = document.createElement('img')
    icon.setAttribute('src', 'https://lh3.googleusercontent.com/a/avatar=s96-c')
    icon.getBoundingClientRect = () => ({ width: 32, height: 32 })
    document.body.appendChild(icon)
    document.body.appendChild(img(U1))
    expect(scanGeneratedImages(document).map(i => i.mediaId)).toEqual([U1])
  })

  it('accepts a generated image by alt text even if size is unknown', () => {
    document.body.appendChild(img(U1, { w: 0, h: 0 }))
    expect(scanGeneratedImages(document).map(i => i.mediaId)).toEqual([U1])
  })
})

describe('GENERATED_IMG_PROBE', () => {
  it('is a self-contained page expression over document', () => {
    expect(typeof GENERATED_IMG_PROBE).toBe('string')
    expect(GENERATED_IMG_PROBE).toContain('document')
    expect(GENERATED_IMG_PROBE).toContain('name=')
  })
})

/**
 * scanGeneratedVideos — Agent-ON video result renders as
 *   <video src=".../media.getMediaUrlRedirect?name=<UUID>">  (live dump 2026-06-27)
 * i.e. the SAME media URL shape as images, just <video> not <img>. The src may
 * also live on a child <source>. The name UUID IS the mediaId.
 */
function video(uuid, { useSource = false } = {}) {
  const el = document.createElement('video')
  if (useSource) {
    const s = document.createElement('source')
    s.setAttribute('src', REDIRECT(uuid))
    el.appendChild(s)
  } else {
    el.setAttribute('src', REDIRECT(uuid))
  }
  return el
}

describe('scanGeneratedVideos', () => {
  it('returns generated videos in DOM order with their mediaId (src on <video>)', () => {
    document.body.appendChild(video(U1))
    document.body.appendChild(video(U2))
    const out = scanGeneratedVideos(document)
    expect(out.map(v => v.mediaId)).toEqual([U1, U2])
    expect(out[0].src).toContain(U1)
  })

  it('reads the media URL from a child <source> too', () => {
    document.body.appendChild(video(U1, { useSource: true }))
    expect(scanGeneratedVideos(document).map(v => v.mediaId)).toEqual([U1])
  })

  it('ignores <video> without a media.getMediaUrlRedirect?name=<uuid> src', () => {
    const v = document.createElement('video')
    v.setAttribute('src', 'blob:https://labs.google/abc')
    document.body.appendChild(v)
    document.body.appendChild(video(U1))
    expect(scanGeneratedVideos(document).map(v => v.mediaId)).toEqual([U1])
  })
})

describe('GENERATED_VIDEO_PROBE', () => {
  it('is a self-contained page expression over document', () => {
    expect(typeof GENERATED_VIDEO_PROBE).toBe('string')
    expect(GENERATED_VIDEO_PROBE).toContain('document')
    expect(GENERATED_VIDEO_PROBE).toContain('name=')
  })
})

/**
 * planDomImageAssignments — match scanned DOM images to pending generations.
 *
 * The DOM fallback (assignDomImagesToPending) exists for the Agent-ON path
 * (streamChat, no batchGenerateImages request to intercept). When a generation
 * is submitted with Agent OFF, its image arrives via intercept (fifeUrl) and is
 * NOT tracked in collectedMediaIds — so a still-rendered image from the PREVIOUS
 * Agent-OFF scene would get wrongly re-assigned to the next pending gen
 * ("첫 이미지가 둘째에도 들어감"). Agent-OFF gens therefore opt out of DOM fallback
 * via allowDomFallback:false; intercept failures stay visibly empty instead.
 */
const di = (id) => ({ mediaId: id, src: `https://x/media.getMediaUrlRedirect?name=${id}` })

describe('planDomImageAssignments', () => {
  it('skips Agent-OFF gens so a previous scene image is not re-assigned (bug repro)', () => {
    // gen1: Agent-OFF, intercept-completed (its image never entered collectedMediaIds).
    // gen2: Agent-OFF, still awaiting intercept; gen1's image 'a' still in the DOM.
    const gens = [
      { generationId: 'gen1', completed: true, domImages: null, allowDomFallback: false },
      { generationId: 'gen2', completed: false, domImages: null, allowDomFallback: false },
    ]
    expect(planDomImageAssignments([di('a')], gens, new Set())).toEqual([])
  })

  it('assigns fresh images to Agent-ON gens in submission order', () => {
    const gens = [
      { generationId: 'g1', completed: false, domImages: null, allowDomFallback: true },
      { generationId: 'g2', completed: false, domImages: null, allowDomFallback: true },
    ]
    const out = planDomImageAssignments([di('a'), di('b')], gens, new Set())
    expect(out.map(x => [x.gen.generationId, x.img.mediaId])).toEqual([['g1', 'a'], ['g2', 'b']])
  })

  it('excludes already-collected mediaIds', () => {
    const gens = [{ generationId: 'g1', completed: false, domImages: null, allowDomFallback: true }]
    const out = planDomImageAssignments([di('a'), di('b')], gens, new Set(['a']))
    expect(out.map(x => x.img.mediaId)).toEqual(['b'])
  })

  it('skips completed gens and gens that already have domImages', () => {
    const gens = [
      { generationId: 'done', completed: true, domImages: null, allowDomFallback: true },
      { generationId: 'has', completed: false, domImages: [di('x')], allowDomFallback: true },
      { generationId: 'need', completed: false, domImages: null, allowDomFallback: true },
    ]
    const out = planDomImageAssignments([di('a')], gens, new Set())
    expect(out.map(x => x.gen.generationId)).toEqual(['need'])
  })

  it('treats missing allowDomFallback as allowed (back-compat with Agent-ON default)', () => {
    const gens = [{ generationId: 'g1', completed: false, domImages: null }]
    expect(planDomImageAssignments([di('a')], gens, new Set()).length).toBe(1)
  })
})

describe('clampImageBatchCount', () => {
  it('정상 1~4 는 그대로', () => {
    expect(clampImageBatchCount(1)).toBe(1)
    expect(clampImageBatchCount(2)).toBe(2)
    expect(clampImageBatchCount(4)).toBe(4)
  })
  it('범위 밖/비정상은 1~4 로 클램프', () => {
    expect(clampImageBatchCount(0)).toBe(1)
    expect(clampImageBatchCount(-3)).toBe(1)
    expect(clampImageBatchCount(9)).toBe(4)
  })
  it('undefined/null/NaN/소수는 안전하게 정수 1~4 로', () => {
    expect(clampImageBatchCount(undefined)).toBe(1)
    expect(clampImageBatchCount(null)).toBe(1)
    expect(clampImageBatchCount(NaN)).toBe(1)
    expect(clampImageBatchCount(2.9)).toBe(2)
    expect(clampImageBatchCount('3')).toBe(3)
  })
})
