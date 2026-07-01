// @vitest-environment node
//
// #R35: 비동기 멘션 씬의 응답↔gen 상관키 선택. 멘션은 요청 body 에서 entity 로 치환돼 verbatim 이
//   아니므로, 요청 body 에 그대로 실리는 "가장 긴 텍스트 세그먼트"를 키로 써서 씬을 구분한다.
import { describe, it, expect } from 'vitest'
import { pickSceneCorrelationKey } from '../../../electron/ipc/character.js'

describe('#R35: pickSceneCorrelationKey', () => {
  it('가장 긴 텍스트 세그먼트를 고른다', () => {
    const segs = [
      { type: 'text', text: '가 ' },
      { type: 'mention', name: 'hero' },
      { type: 'text', text: '가 회사에 걸어간다' },
    ]
    expect(pickSceneCorrelationKey(segs, '@hero 가 회사에 걸어간다')).toBe('가 회사에 걸어간다')
  })

  it('mention 세그먼트는 무시한다', () => {
    const segs = [{ type: 'mention', name: 'x' }, { type: 'text', text: '짧게' }]
    expect(pickSceneCorrelationKey(segs, 'p')).toBe('짧게')
  })

  it('#R35-fix(Codex[1]): 키는 원문(leading/trailing space) 보존 — trim 하면 요청 body exact 매칭이 깨진다', () => {
    // "@hero walks" → 세그먼트 [mention hero, text " walks"]. 삽입된 body 값은 " walks" 이므로
    //   키도 " walks"(원문)여야 promptInBody('" walks"')가 매칭된다. "walks"(trim)면 drop.
    const segs = [{ type: 'mention', name: 'hero' }, { type: 'text', text: ' walks' }]
    expect(pickSceneCorrelationKey(segs, '@hero walks')).toBe(' walks')
  })

  it('텍스트 세그먼트가 없으면 prompt 원문으로 폴백', () => {
    expect(pickSceneCorrelationKey([{ type: 'mention', name: 'x' }], '@x now')).toBe('@x now')
    expect(pickSceneCorrelationKey([], 'plain prompt')).toBe('plain prompt')
  })

  it('빈/누락 입력에 안전', () => {
    expect(pickSceneCorrelationKey(null, null)).toBe('')
    expect(pickSceneCorrelationKey(undefined, undefined)).toBe('')
    expect(pickSceneCorrelationKey([{ type: 'text' }], '')).toBe('')
  })

  it('서로 다른 씬은 서로 다른 키(고유성) — 같은 캐릭터라도 설명이 다르면 구분', () => {
    const a = pickSceneCorrelationKey([{ type: 'mention', name: 'king' }, { type: 'text', text: '이 성으로 들어간다' }], '')
    const b = pickSceneCorrelationKey([{ type: 'mention', name: 'king' }, { type: 'text', text: '이 말을 탄다' }], '')
    expect(a).not.toBe(b)
  })
})
