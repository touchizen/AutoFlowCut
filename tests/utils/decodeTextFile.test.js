/**
 * 임포트하는 텍스트 파일(SRT/CSV/TXT)의 **인코딩**을 감지해서 디코딩한다.
 *
 * 왜 필요한가: ImportModal 은 FileReader.readAsText(file) 를 썼는데, 인코딩을 안 주면 무조건
 * UTF-8 로 해석한다. 그래서
 *   - Windows 메모장이 "유니코드"로 저장한 SRT(UTF-16) → 글자가 통째로 깨진다
 *   - 한국 자막 도구가 흔히 쓰는 CP949/EUC-KR SRT → 한글이 "¾È³çÇÏ¼¼¿ä" 꼴로 들어온다
 * 그리고 이건 CRLF 버그보다 고약하다 — **파싱은 성공하고 에러도 안 뜬다.** 자막 내용만 조용히
 * 깨진 채로 프로젝트에 들어간다.
 */

import { describe, it, expect } from 'vitest'
import { decodeTextBytes } from '../../src/utils/decodeTextFile'

const utf8 = (s) => new TextEncoder().encode(s)
const withBom = (bytes, bom) => Uint8Array.from([...bom, ...bytes])

/** UTF-16LE 로 인코딩(코드유닛 리틀엔디언). */
const utf16le = (s) => {
  const out = new Uint8Array(s.length * 2)
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i)
    out[i * 2] = c & 0xff
    out[i * 2 + 1] = c >> 8
  }
  return out
}
const utf16be = (s) => {
  const le = utf16le(s)
  const out = new Uint8Array(le.length)
  for (let i = 0; i < le.length; i += 2) { out[i] = le[i + 1]; out[i + 1] = le[i] }
  return out
}

/** "안녕" in CP949(EUC-KR). */
const CP949_ANNYEONG = Uint8Array.from([0xbe, 0xc8, 0xb3, 0xe7])

const SRT = '1\r\n00:00:00,000 --> 00:00:02,000\r\n안녕하세요\r\n'

describe('decodeTextBytes — 인코딩을 감지해서 읽는다', () => {
  it('UTF-8 (BOM 없음)', () => {
    expect(decodeTextBytes(utf8(SRT))).toBe(SRT)
  })

  it('UTF-8 + BOM — BOM 은 벗겨서 준다', () => {
    const bytes = withBom(utf8(SRT), [0xef, 0xbb, 0xbf])
    expect(decodeTextBytes(bytes)).toBe(SRT)
  })

  it('UTF-16LE + BOM (Windows 메모장 "유니코드")', () => {
    const bytes = withBom(utf16le(SRT), [0xff, 0xfe])
    expect(decodeTextBytes(bytes)).toBe(SRT)
  })

  it('UTF-16BE + BOM', () => {
    const bytes = withBom(utf16be(SRT), [0xfe, 0xff])
    expect(decodeTextBytes(bytes)).toBe(SRT)
  })

  it('CP949/EUC-KR (한국 Windows 자막 도구) — 한글이 깨지지 않는다', () => {
    expect(decodeTextBytes(CP949_ANNYEONG)).toBe('안녕')
  })

  it('UTF-8 한글을 CP949 로 오인하지 않는다', () => {
    expect(decodeTextBytes(utf8('안녕하세요 世界 🌏'))).toBe('안녕하세요 世界 🌏')
  })

  it('ASCII 는 어느 경로로도 그대로다', () => {
    expect(decodeTextBytes(utf8('billions of people'))).toBe('billions of people')
    expect(decodeTextBytes(CP949_ANNYEONG.slice(0, 0))).toBe('')
  })

  it('ArrayBuffer 도 받는다 (File.arrayBuffer() 결과)', () => {
    const buf = utf8(SRT).buffer
    expect(decodeTextBytes(buf)).toBe(SRT)
  })
})
