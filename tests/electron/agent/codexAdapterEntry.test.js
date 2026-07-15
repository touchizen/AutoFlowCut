// @vitest-environment node
import { describe, it, expect } from 'vitest'
import { toMcpContent } from '../../../electron/agent/codexAdapterEntry.js'

// M3 I6: get_scene_images 가 image block 을 담아 반환해도, adapter 가 전부 JSON.stringify 하면
// 에이전트는 픽셀을 못 본다("에이전트의 눈"이 안 뜬다). content 배열의 image block 은 MCP image block 으로
// 살려 내보내고, 나머지 metadata 만 text 로 싣는다.

describe('toMcpContent', () => {
  it('content 없는 일반 결과 → 통째로 JSON text 하나 (기존 계약 유지)', () => {
    const result = { status: 'done', scenes: [{ scene: 1 }] }
    expect(toMcpContent(result)).toEqual([{ type: 'text', text: JSON.stringify(result) }])
  })

  it('image block 이 있으면 metadata text + 실제 MCP image block 들', () => {
    const result = {
      status: 'done',
      images: [{ ordinal: 1, rendererSceneId: 'scene_17', status: 'ok', mimeType: 'image/jpeg' }],
      content: [{ type: 'image', data: 'BASE64', mimeType: 'image/jpeg' }],
    }
    const out = toMcpContent(result)
    // content(바이트)는 metadata text 에서 빠진다.
    expect(out[0]).toEqual({
      type: 'text',
      text: JSON.stringify({
        status: 'done',
        images: [{ ordinal: 1, rendererSceneId: 'scene_17', status: 'ok', mimeType: 'image/jpeg' }],
      }),
    })
    expect(out[1]).toEqual({ type: 'image', data: 'BASE64', mimeType: 'image/jpeg' })
    expect(out).toHaveLength(2)
  })

  it('content 가 비어도 metadata text 하나는 나온다', () => {
    const out = toMcpContent({ status: 'done', images: [], content: [] })
    expect(out).toEqual([{ type: 'text', text: JSON.stringify({ status: 'done', images: [] }) }])
  })

  it('image 아닌 content 원소는 text 로 폴백한다', () => {
    const out = toMcpContent({ status: 'done', content: [{ type: 'note', v: 1 }] })
    expect(out[1]).toEqual({ type: 'text', text: JSON.stringify({ type: 'note', v: 1 }) })
  })
})
