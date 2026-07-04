// @vitest-environment node
import { describe, it, expect, vi } from 'vitest'
import { getTypecastKey } from '../../../../electron/api/tts/typecastKey.js'

// 스펙: CLAUDE.md 보안 — 키 로드 우선순위 env → ~/.typecast/credentials → 명시적 에러(silent fallback 금지).
// 동기 계약: typecast 어댑터가 getKey()를 동기로 호출하므로 이 헬퍼도 동기여야 한다.
describe('getTypecastKey', () => {
  const homedir = () => '/home/u'

  it('env.TYPECAST_API_KEY가 있으면 그 값을 반환한다(파일 안 읽음)', () => {
    const readFile = vi.fn()
    const key = getTypecastKey({ env: { TYPECAST_API_KEY: 'env-key' }, readFile, homedir })
    expect(key).toBe('env-key')
    expect(readFile).not.toHaveBeenCalled()
  })

  it('env 없으면 ~/.typecast/credentials의 raw 한 줄 키를 읽는다', () => {
    const readFile = vi.fn(() => 'file-key\n')
    const key = getTypecastKey({ env: {}, readFile, homedir })
    expect(key).toBe('file-key')
    expect(readFile).toHaveBeenCalledWith('/home/u/.typecast/credentials', 'utf8')
  })

  it('credentials가 KEY=VALUE(dotenv) 형식이면 값만 파싱한다', () => {
    const readFile = vi.fn(() => '# comment\nTYPECAST_API_KEY=dotenv-key\n')
    const key = getTypecastKey({ env: {}, readFile, homedir })
    expect(key).toBe('dotenv-key')
  })

  it('env도 없고 파일도 없으면 명시적 에러(silent fallback 금지)', () => {
    const readFile = vi.fn(() => { throw new Error('ENOENT') })
    expect(() => getTypecastKey({ env: {}, readFile, homedir })).toThrow(/Typecast API key/)
  })
})
