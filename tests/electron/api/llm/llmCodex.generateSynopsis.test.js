import { describe, it, expect, vi } from 'vitest'
import { generateSynopsis } from '../../../../electron/api/llm/llmCodex.js'

const OPTS = { engine: 'codex', model: 'gpt-5.5', reasoningEffort: 'high', language: 'ko' }
const SYNOPSIS_BODY = '로그라인: 몰락한 가문의 비밀.\n도입과 전개, 전환과 결말을 담은 개요.'
const CHAR_JSON = '[{"name":"강리안","gender":"male","age":"20대","role":"주인공","ethnicity":"한국인","appearance":"tall man in hanbok"},{"name":"소월"}]'
const FULL = `${SYNOPSIS_BODY}\nCHARACTERS_JSON\n${CHAR_JSON}`

describe('llmCodex.generateSynopsis (title)', () => {
  it('runText 스트리밍으로 onDelta를 흘리고 완료 후 synopsisMd/characters로 분리 반환한다', async () => {
    const runText = vi.fn(async (_prompt, _opts, ctx) => {
      ctx.onDelta?.(SYNOPSIS_BODY)
      ctx.onDelta?.(`\nCHARACTERS_JSON\n${CHAR_JSON}`)
      return FULL
    })
    const onDelta = vi.fn()
    const r = await generateSynopsis({ type: 'title', title: '왕의 비밀' }, OPTS, { runText, onDelta, signal: 'sig' })
    expect(r.synopsisMd).toBe(SYNOPSIS_BODY)
    expect(r.characters).toEqual([
      { id: '강리안', name: '강리안', gender: 'male', age: '20대', role: '주인공', ethnicity: '한국인', appearance: 'tall man in hanbok' },
      { id: '소월', name: '소월', gender: 'unknown', age: '', role: '', ethnicity: '', appearance: '' },
    ])
    const streamed = onDelta.mock.calls.map((c) => c[0]).join('')
    expect(streamed).toContain('로그라인: 몰락한 가문의 비밀.')
    expect(streamed).not.toContain('CHARACTERS_JSON') // M4: JSON 파편 델타 노출 금지
    expect(runText.mock.calls[0][0]).toContain('제목: 왕의 비밀')
    expect(runText.mock.calls[0][0]).toContain('Do not inspect local files') // 백엔드 가드
    expect(runText.mock.calls[0][1]).toEqual({ model: 'gpt-5.5', reasoningEffort: 'high' })
    expect(runText.mock.calls[0][2]).toMatchObject({ signal: 'sig' })
  })

  it('마커가 델타 경계에서 쪼개져도 마커/JSON 파편을 onDelta로 흘리지 않는다', async () => {
    const runText = vi.fn(async (_p, _o, ctx) => {
      ctx.onDelta?.('개요다. CHARACTERS')
      ctx.onDelta?.('_JSON\n[]')
      return '개요다. CHARACTERS_JSON\n[]'
    })
    const onDelta = vi.fn()
    await generateSynopsis({ type: 'title', title: 'T' }, OPTS, { runText, onDelta })
    expect(onDelta.mock.calls.map((c) => c[0]).join('')).toBe('개요다. ')
  })

  it('마커 없음/깨진 JSON은 throw 없이 characters=[] 폴백, synopsisMd는 유지', async () => {
    const noMarker = vi.fn(async () => '개요만 있다')
    await expect(generateSynopsis({ type: 'title', title: 'T' }, OPTS, { runText: noMarker }))
      .resolves.toEqual({ synopsisMd: '개요만 있다', characters: [] })

    const broken = vi.fn(async () => '개요.\nCHARACTERS_JSON\n[{"name": broken')
    await expect(generateSynopsis({ type: 'title', title: 'T' }, OPTS, { runText: broken }))
      .resolves.toEqual({ synopsisMd: '개요.', characters: [] })
  })
})

describe('llmCodex.generateSynopsis (pasted)', () => {
  it('buildCharacterExtractPrompt로 non-streaming 호출하고 characters만 반환한다', async () => {
    const runText = vi.fn(async () => CHAR_JSON)
    const onDelta = vi.fn()
    const r = await generateSynopsis({ type: 'pasted', pastedScript: '# 붙여넣은 대본' }, OPTS, { runText, onDelta, signal: 'sig' })
    expect(r.synopsisMd).toBe('')
    expect(r.characters.map((c) => c.name)).toEqual(['강리안', '소월'])
    expect(onDelta).not.toHaveBeenCalled()
    expect(runText.mock.calls[0][0]).toContain('--- 대본 ---')
    expect(runText.mock.calls[0][0]).toContain('# 붙여넣은 대본')
    expect(runText.mock.calls[0][0]).toContain('Do not inspect local files')
    expect(runText.mock.calls[0][2].onDelta).toBeUndefined() // M4: pasted는 스트리밍 안 함
    expect(runText.mock.calls[0][2]).toMatchObject({ signal: 'sig' })
  })

  it('pasted 결과 JSON이 깨져도 throw하지 않고 characters=[] 폴백', async () => {
    const runText = vi.fn(async () => 'not json at all')
    await expect(generateSynopsis({ type: 'pasted', pastedScript: 'S' }, OPTS, { runText }))
      .resolves.toEqual({ synopsisMd: '', characters: [] })
  })
})
