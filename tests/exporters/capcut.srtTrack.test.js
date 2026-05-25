/**
 * capcut.js generateSRT — Phase 5: srtTrack 사용
 */
import { describe, it, expect } from 'vitest'
import { generateSRT } from '../../src/exporters/capcut'

describe('generateSRT — srtTrack path (Phase 5)', () => {
  it('project.srtTrack 가 있으면 srtTrack 그대로 출력', () => {
    const project = {
      scenes: [{ id: 's1', srtLineIds: ['sub_1', 'sub_2'] }],
      srtTrack: [
        { id: 'sub_1', startTime: 0,   endTime: 3.5,  text: '자막1' },
        { id: 'sub_2', startTime: 3.5, endTime: 7.0,  text: '자막2' },
      ],
    }
    const srt = generateSRT(project, 'ko')
    expect(srt).toContain('자막1')
    expect(srt).toContain('자막2')
    expect(srt).toContain('00:00:00,000 --> 00:00:03,500')
    expect(srt).toContain('00:00:03,500 --> 00:00:07,000')
  })

  it('srtTrack 인덱스 1부터 시작', () => {
    const project = {
      scenes: [],
      srtTrack: [
        { id: 'sub_1', startTime: 0, endTime: 1, text: 'A' },
        { id: 'sub_2', startTime: 1, endTime: 2, text: 'B' },
      ],
    }
    const srt = generateSRT(project, 'ko')
    const lines = srt.split('\n')
    expect(lines[0]).toBe('1')
    // 한 자막 블록: 4 줄 (index, time, text, 빈줄)
    expect(lines).toContain('2')
  })

  it('빈 text 라인은 스킵 (인덱스 건너뜀)', () => {
    const project = {
      scenes: [],
      srtTrack: [
        { id: 'sub_1', startTime: 0, endTime: 1, text: 'A' },
        { id: 'sub_2', startTime: 1, endTime: 2, text: '' },
        { id: 'sub_3', startTime: 2, endTime: 3, text: 'C' },
      ],
    }
    const srt = generateSRT(project, 'ko')
    expect(srt).toContain('A')
    expect(srt).toContain('C')
    expect(srt).not.toMatch(/^2$/m) // 인덱스 2 없음 (B 가 스킵됨)
  })

  it('lang 파라미터 무관 — srtTrack 은 단일 언어', () => {
    const project = {
      scenes: [],
      srtTrack: [{ id: 'sub_1', startTime: 0, endTime: 1, text: 'OnlyText' }],
    }
    expect(generateSRT(project, 'ko')).toContain('OnlyText')
    expect(generateSRT(project, 'en')).toContain('OnlyText')
  })

  it('srtTrack 비어있으면 옛 동작 (scene.subtitle 기반) 으로 폴백', () => {
    const project = {
      scenes: [
        { id: 's1', subtitle_ko: '한글', subtitle_en: 'English', image_duration: 3 },
      ],
      srtTrack: [],
    }
    expect(generateSRT(project, 'ko')).toContain('한글')
    expect(generateSRT(project, 'en')).toContain('English')
  })

  it('srtTrack 없어도 (undefined) 옛 동작으로 폴백', () => {
    const project = {
      scenes: [
        { id: 's1', subtitle_ko: 'fallback', subtitle_en: '', image_duration: 3 },
      ],
    }
    expect(generateSRT(project, 'ko')).toContain('fallback')
  })

  it('실제 SRT 블록 포맷 검증', () => {
    const project = {
      scenes: [],
      srtTrack: [
        { id: 'sub_1', startTime: 0.5, endTime: 3.25, text: 'Hello' },
      ],
    }
    const srt = generateSRT(project, 'ko')
    expect(srt).toMatch(/^1\n00:00:00,500 --> 00:00:03,250\nHello/)
  })

  it('여러 라인 자막 (\\n 포함된 text) 도 그대로 출력', () => {
    const project = {
      scenes: [],
      srtTrack: [
        { id: 'sub_1', startTime: 0, endTime: 2, text: 'line 1\nline 2' },
      ],
    }
    const srt = generateSRT(project, 'ko')
    expect(srt).toContain('line 1\nline 2')
  })
})
