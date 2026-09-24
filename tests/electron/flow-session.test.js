// @vitest-environment jsdom
//
// Flow 세션(access_token) 읽기.
//
// 2026-09-23: Flow 가 flow.google.com 으로 옮긴 뒤에도 세션은 옛 절대주소
// (https://labs.google/fx/api/auth/session)로 읽었다. 새 도메인 페이지에서 그 fetch 는 cross-origin
// 이라 쿠키가 안 실려 `{}`(2 bytes) 만 돌아오고, 앱은 로그인돼 있는 사용자에게 "Flow 로그인이
// 필요합니다"를 반복했다(dev.log: Session response received: 2 bytes / Session keys: []).
//
// 해법: 페이지 origin 기준 same-origin 후보를 먼저, 옛 절대주소를 마지막에 순서대로 시도하고
// **토큰이 든 첫 응답**을 고른다. `{}` 같은 빈 세션은 건너뛴다.
import { describe, it, expect, vi, afterEach } from 'vitest'
import { sessionUrlCandidates, buildSessionProbeJs, LEGACY_SESSION_URL } from '../../electron/flow-session.js'

describe('sessionUrlCandidates', () => {
  it('새 도메인: same-origin /fx/api → /api 순, 옛 절대주소는 마지막', () => {
    expect(sessionUrlCandidates('https://flow.google.com/project/abc')).toEqual([
      'https://flow.google.com/fx/api/auth/session',
      'https://flow.google.com/api/auth/session',
      LEGACY_SESSION_URL,
    ])
  })

  it('옛 도메인: same-origin 후보가 옛 주소와 같으면 중복 없이 한 번만', () => {
    const c = sessionUrlCandidates('https://labs.google/fx/tools/flow')
    expect(c[0]).toBe(LEGACY_SESSION_URL)
    expect(new Set(c).size).toBe(c.length)
  })

  it('Flow 가 아닌 페이지(로그인·빈 URL)면 옛 절대주소만 — 외부 origin 으로 세션을 묻지 않는다', () => {
    expect(sessionUrlCandidates('https://accounts.google.com/signin')).toEqual([LEGACY_SESSION_URL])
    expect(sessionUrlCandidates('')).toEqual([LEGACY_SESSION_URL])
  })
})

describe('buildSessionProbeJs', () => {
  afterEach(() => { delete globalThis.fetch })

  const run = (candidates) => new Function(`return ${buildSessionProbeJs(candidates)}`)()
  const respond = (table) => vi.fn(async (url) => {
    const t = table[url]
    if (!t) return { ok: false, text: async () => '' }
    return { ok: true, text: async () => t }
  })

  it('빈 세션 {} 은 건너뛰고 토큰이 든 첫 응답의 url/text 를 돌려준다', async () => {
    globalThis.fetch = respond({
      'https://labs.google/fx/api/auth/session': '{}',
      'https://flow.google.com/api/auth/session': '{"access_token":"tok","user":{}}',
    })
    const r = await run(['https://labs.google/fx/api/auth/session', 'https://flow.google.com/fx/api/auth/session', 'https://flow.google.com/api/auth/session'])
    expect(r).toEqual({ url: 'https://flow.google.com/api/auth/session', text: '{"access_token":"tok","user":{}}' })
    // 쿠키가 실리도록 same-origin 으로 요청한다
    expect(globalThis.fetch.mock.calls[0][1]).toMatchObject({ credentials: 'same-origin' })
  })

  it("XSSI 프리픽스()]}') 가 붙은 본문도 토큰으로 인식한다", async () => {
    globalThis.fetch = respond({ 'https://flow.google.com/fx/api/auth/session': ")]}'\n{\"accessToken\":\"tok\"}" })
    const r = await run(['https://flow.google.com/fx/api/auth/session'])
    expect(r.url).toBe('https://flow.google.com/fx/api/auth/session')
  })

  it('어느 후보도 토큰을 안 주면 null — 진짜 로그아웃만 로그인 요구로 이어진다', async () => {
    globalThis.fetch = respond({ 'https://flow.google.com/fx/api/auth/session': '{}' })
    expect(await run(['https://flow.google.com/fx/api/auth/session', 'https://flow.google.com/api/auth/session'])).toEqual({ url: null, text: null })
  })
})
