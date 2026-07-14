// @vitest-environment node
import { describe, expect, it } from 'vitest'
import {
  APPROVAL_PAYLOAD_VERSION,
  decodeApprovalPayload,
  encodeApprovalPayload,
} from '../../../electron/agent/approvalPayload.js'

describe('approval payload — canonical 봉투', () => {
  it('tool과 args를 버전 1 JSON으로 왕복한다', () => {
    const args = { synopsisMd: '# 시놉시스', characters: [{ name: '김철수' }] }

    const message = encodeApprovalPayload('story_confirm_synopsis', args)

    expect(JSON.parse(message)).toEqual({ v: 1, tool: 'story_confirm_synopsis', args })
    expect(decodeApprovalPayload(message)).toEqual({ tool: 'story_confirm_synopsis', args })
    expect(APPROVAL_PAYLOAD_VERSION).toBe(1)
  })

  it('유니코드와 배열/중첩 객체를 값과 순서 그대로 보존한다', () => {
    const args = {
      speakers: [
        { id: 'narrator', name: '나레이션', voice: { provider: 'elevenlabs', tags: ['차분함', '🎙️'] } },
        { id: 'kim', name: '김철수', aliases: ['철수', 'Chul-su'] },
      ],
      options: { enabled: true, retries: 0, empty: null },
    }

    expect(decodeApprovalPayload(encodeApprovalPayload('story_set_speakers', args)))
      .toEqual({ tool: 'story_set_speakers', args })
  })

  it('5000자 synopsis를 자르지 않는다', () => {
    const args = { synopsisMd: `BEGIN-${'긴'.repeat(5000)}-END` }

    const decoded = decodeApprovalPayload(encodeApprovalPayload('story_confirm_synopsis', args))

    expect(decoded.args).toEqual(args)
    expect(decoded.args.synopsisMd).toContain('-END')
  })
})

describe('approval payload — 어떤 손상도 부분 해석하지 않는다', () => {
  it.each([
    ['비문자열', null],
    ['객체', { v: 1, tool: 'story_confirm_synopsis', args: {} }],
    ['비JSON', '{broken'],
    ['버전 없음', JSON.stringify({ tool: 'story_confirm_synopsis', args: {} })],
    ['버전 불일치', JSON.stringify({ v: 2, tool: 'story_confirm_synopsis', args: {} })],
    ['tool 없음', JSON.stringify({ v: 1, args: {} })],
    ['tool 빈 문자열', JSON.stringify({ v: 1, tool: '', args: {} })],
    ['tool 비문자열', JSON.stringify({ v: 1, tool: 7, args: {} })],
    ['args 배열', JSON.stringify({ v: 1, tool: 'story_confirm_synopsis', args: [] })],
    ['args null', JSON.stringify({ v: 1, tool: 'story_confirm_synopsis', args: null })],
    ['args 문자열', JSON.stringify({ v: 1, tool: 'story_confirm_synopsis', args: 'not-an-object' })],
    ['args 없음', JSON.stringify({ v: 1, tool: 'story_confirm_synopsis' })],
  ])('%s이면 null', (_label, message) => {
    expect(decodeApprovalPayload(message)).toBeNull()
  })
})
