import { describe, expect, it } from 'vitest'
import { busyPromptLines } from '../../src/utils/promptBusyLines'

const lines = (scenes, options) => [...busyPromptLines(scenes, options)]

describe('busyPromptLines', () => {
  it('내장 개행을 앞 씬부터 누적하고 생성 중인 씬의 첫 문단만 반환한다', () => {
    const scenes = [
      { prompt: 'scene 1-a\nscene 1-b' },
      { prompt: '', status: 'generating' },
      { prompt: 'scene 3-a\nscene 3-b\nscene 3-c', videoT2VStatus: 'generating' },
      { prompt: 'scene 4', videoI2VStatus: 'generating' },
    ]

    expect(lines(scenes, { field: 'prompt', trimTrailing: false })).toEqual([2, 3, 6])
  })

  it('빈 image prompt가 중간과 꼬리에 있어도 각 씬의 문단을 보존한다', () => {
    const scenes = [
      { prompt: 'first' },
      { prompt: '', status: 'generating' },
      { prompt: 'third' },
      { prompt: '', status: 'generating' },
    ]

    expect(lines(scenes, { field: 'prompt', trimTrailing: false })).toEqual([1, 3])
  })

  it('video value의 중간 빈 문단은 남기고 잘린 꼬리 씬은 방어 상한으로 제외한다', () => {
    const scenes = [
      { videoT2VPrompt: 'first' },
      { videoT2VPrompt: '', status: 'generating' },
      { videoT2VPrompt: 'third' },
      { videoT2VPrompt: '', status: 'generating' },
    ]

    expect(lines(scenes, { field: 'videoT2VPrompt', trimTrailing: true })).toEqual([1])
  })

  it('전부 빈 video value의 단일 문단은 첫 씬만 소유한다', () => {
    const scenes = [
      { videoT2VPrompt: '', status: 'generating' },
      { videoT2VPrompt: '', videoT2VStatus: 'generating' },
      { videoT2VPrompt: '', videoI2VStatus: 'generating' },
    ]

    expect(lines(scenes, { field: 'videoT2VPrompt', trimTrailing: true })).toEqual([0])
    expect(lines([
      { videoT2VPrompt: '' },
      { videoT2VPrompt: '', status: 'generating' },
    ], { field: 'videoT2VPrompt', trimTrailing: true })).toEqual([])
  })

  it('CRLF도 줄 경계 하나로 세어 뒤 씬의 문단 index를 맞춘다', () => {
    const scenes = [
      { prompt: 'windows first\r\nwindows second' },
      { prompt: 'next', status: 'generating' },
    ]

    expect(lines(scenes, { field: 'prompt', trimTrailing: false })).toEqual([2])
  })

  it('마지막 씬이 개행으로 끝나고 video 꼬리를 잘라도 그 씬의 첫 문단은 남는다', () => {
    const scenes = [
      { videoT2VPrompt: 'first' },
      { videoT2VPrompt: 'last\n', status: 'generating' },
    ]

    expect(lines(scenes, { field: 'videoT2VPrompt', trimTrailing: true })).toEqual([1])
  })

  it.each([
    ['image', { status: 'generating' }],
    ['T2V', { videoT2VStatus: 'generating' }],
    ['I2V', { videoI2VStatus: 'generating' }],
  ])('%s 생성 상태 하나만으로도 탭과 무관하게 busy다', (_label, generatingStatus) => {
    const scenes = [
      { prompt: 'two\nparagraphs', videoT2VPrompt: 'video', ...generatingStatus },
      { prompt: 'next', videoT2VPrompt: 'next video' },
    ]

    expect(lines(scenes, { field: 'prompt', trimTrailing: false })).toEqual([0])
    expect(lines(scenes, { field: 'videoT2VPrompt', trimTrailing: true })).toEqual([0])
  })

  it('빈 배열은 빈 Set을 반환한다', () => {
    const result = busyPromptLines([], { field: 'prompt', trimTrailing: false })

    expect(result).toBeInstanceOf(Set)
    expect([...result]).toEqual([])
  })
})
