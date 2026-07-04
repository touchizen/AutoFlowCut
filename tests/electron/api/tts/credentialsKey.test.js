/**
 * readCredentialsKey — provider별 ~/.{service}/credentials 파일 키 로더(폴백용).
 * typecastKey와 동일한 형식(env → 파일, dotenv KEY=VALUE 또는 raw 키 한 줄)이되, 없으면 throw가
 * 아니라 null 반환(keychain 우선 뒤 폴백이라 최종 판단은 어댑터가). CLAUDE.md 보안: 키 평문 소스 금지.
 */
import { describe, it, expect } from 'vitest'
import { readCredentialsKey } from '../../../../electron/api/tts/credentialsKey.js'

const opts = (over = {}) => ({ env: {}, readFile: () => { throw new Error('no file') }, homedir: () => '/home/u', ...over })

describe('readCredentialsKey', () => {
  it('env 변수가 있으면 그것을 우선', () => {
    expect(readCredentialsKey('elevenlabs', 'ELEVENLABS_API_KEY', opts({ env: { ELEVENLABS_API_KEY: 'from-env' } }))).toBe('from-env')
  })

  it('env 없고 파일에 raw 키 한 줄이면 그 키', () => {
    expect(readCredentialsKey('elevenlabs', 'ELEVENLABS_API_KEY', opts({ readFile: () => 'sk-raw-123\n' }))).toBe('sk-raw-123')
  })

  it('파일이 dotenv(KEY=VALUE) 형식이면 값만', () => {
    expect(readCredentialsKey('elevenlabs', 'ELEVENLABS_API_KEY', opts({ readFile: () => 'ELEVENLABS_API_KEY=sk-dot-456\n' }))).toBe('sk-dot-456')
  })

  it('따옴표/주석/빈 줄 처리', () => {
    const raw = '# comment\n\nELEVENLABS_API_KEY="sk-q"\n'
    expect(readCredentialsKey('elevenlabs', 'ELEVENLABS_API_KEY', opts({ readFile: () => raw }))).toBe('sk-q')
  })

  it('env도 파일도 없으면 null (throw 아님 — 폴백 체인용)', () => {
    expect(readCredentialsKey('elevenlabs', 'ELEVENLABS_API_KEY', opts())).toBeNull()
  })

  it('파일이 비어/키만 없으면 null', () => {
    expect(readCredentialsKey('elevenlabs', 'ELEVENLABS_API_KEY', opts({ readFile: () => '# only comment\n' }))).toBeNull()
  })

  it('service별 경로는 ~/.{service}/credentials', () => {
    let readPath = null
    readCredentialsKey('googletts', 'GOOGLE_TTS_API_KEY', opts({ readFile: (p) => { readPath = p; return 'k' } }))
    expect(readPath).toBe('/home/u/.googletts/credentials')
  })
})
