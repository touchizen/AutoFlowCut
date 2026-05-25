/**
 * generateSRT — Review fix 2 (C1, C2)
 *
 * C1: lang='en' 일 때 srtTrack (단일 언어) 사용 안 함, scene.subtitle_en fallback
 * C2: 빈 text 라인은 idx 증가 안 시켜 SRT 블록 번호 1..N 순차 유지
 */
import { describe, it, expect } from 'vitest'
import { generateSRT } from '../../src/exporters/capcut'

describe('C1 — lang 라우팅', () => {
  const project = {
    srtTrack: [{ id: 'sub_1', startTime: 0, endTime: 1, text: '한국어 자막' }],
    scenes: [
      { id: 's1', subtitle_ko: '한국어 자막', subtitle_en: 'English subtitle', image_duration: 1 },
    ],
  }

  it('lang=ko: srtTrack 사용 (한국어 텍스트)', () => {
    const srt = generateSRT(project, 'ko')
    expect(srt).toContain('한국어 자막')
    expect(srt).not.toContain('English subtitle')
  })

  it('lang=en: srtTrack 무시, scene.subtitle_en 사용', () => {
    const srt = generateSRT(project, 'en')
    expect(srt).toContain('English subtitle')
    expect(srt).not.toContain('한국어 자막')
  })

  it('lang=en, scene.subtitle_en 없음: 빈 결과 (옛 동작 보존)', () => {
    const proj = {
      srtTrack: [{ id: 'sub_1', startTime: 0, endTime: 1, text: 'KO' }],
      scenes: [{ id: 's1', subtitle_ko: 'KO', subtitle_en: '', image_duration: 1 }],
    }
    const srt = generateSRT(proj, 'en')
    expect(srt).toBe('')
  })
})

describe('C2 — 빈 text 라인은 idx 증가 안', () => {
  it('빈 라인 사이에 있어도 번호 순차 (1, 2 — 빈 라인이 idx 안 먹음)', () => {
    const project = {
      srtTrack: [
        { id: 'sub_1', startTime: 0, endTime: 1, text: 'A' },
        { id: 'sub_2', startTime: 1, endTime: 2, text: '' },
        { id: 'sub_3', startTime: 2, endTime: 3, text: 'C' },
      ],
      scenes: [],
    }
    const srt = generateSRT(project, 'ko')
    expect(srt).toMatch(/^1\n.+\nA/)
    expect(srt).toContain('2\n')
    expect(srt).toContain('C')
    expect(srt).not.toMatch(/^3$/m) // 인덱스 3 없음 (총 2개 블록)
  })

  it('연속 빈 라인이 여러개 있어도 번호 순차', () => {
    const project = {
      srtTrack: [
        { id: 'sub_1', startTime: 0, endTime: 1, text: 'A' },
        { id: 'sub_2', startTime: 1, endTime: 2, text: '' },
        { id: 'sub_3', startTime: 2, endTime: 3, text: '' },
        { id: 'sub_4', startTime: 3, endTime: 4, text: 'D' },
      ],
      scenes: [],
    }
    const srt = generateSRT(project, 'ko')
    const lines = srt.split('\n')
    expect(lines[0]).toBe('1')
    expect(srt).toContain('2\n')
    expect(srt).not.toMatch(/^3$/m)
    expect(srt).not.toMatch(/^4$/m)
  })
})
