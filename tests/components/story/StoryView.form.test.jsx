import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import StoryView from '../../../src/components/story/StoryView.jsx'

const LLM_OPTIONS = [
  { id: 'claude:claude-opus-4-8', engine: 'claude', model: 'claude-opus-4-8', label: 'Claude Opus 4.8', reasoningEfforts: ['off', 'low', 'medium', 'high', 'max'], defaultReasoningEffort: 'off' },
  { id: 'claude:claude-sonnet-5', engine: 'claude', model: 'claude-sonnet-5', label: 'Claude Sonnet 5', reasoningEfforts: ['off', 'low', 'medium', 'high', 'max'], defaultReasoningEffort: 'off' },
  { id: 'codex:gpt-5.5', engine: 'codex', model: 'gpt-5.5', label: 'Codex GPT-5.5', reasoningEfforts: ['minimal', 'low', 'medium', 'high', 'xhigh'], defaultReasoningEffort: 'xhigh' },
  { id: 'codex:gpt-5.4', engine: 'codex', model: 'gpt-5.4', label: 'Codex GPT-5.4', reasoningEfforts: ['minimal', 'low', 'medium', 'high', 'xhigh'], defaultReasoningEffort: 'high' },
]

// 슬라이스5(§v2.8 B1): 제목 경로 [시작]은 synopsis 게이트(generateSynopsis)로 진입한다 —
// 폼 options 플럼빙 검증도 generateSynopsis 페이로드 기준.
function makePipeline(generateSynopsis, overrides = {}) {
  return {
    state: { steps: {}, ...(overrides.state || {}) },
    streamingText: '',
    start: vi.fn(),
    generateSynopsis,
    abort: () => {},
    scenes: [],
    openError: null,
    llmOptions: LLM_OPTIONS,
    defaultLlmOption: LLM_OPTIONS[0],
    ...overrides,
  }
}

describe('StoryView 폼 재구성', () => {
  it('모델 드롭다운 선택이 options.model로 전달된다', () => {
    const gen = vi.fn().mockResolvedValue({})
    render(<StoryView pipeline={makePipeline(gen)} />)
    fireEvent.change(screen.getByPlaceholderText('제목'), { target: { value: 'T' } })
    fireEvent.change(screen.getByLabelText('모델'), { target: { value: 'claude:claude-sonnet-5' } })
    fireEvent.click(screen.getByRole('button', { name: '시작' }))
    expect(gen).toHaveBeenCalledWith(expect.objectContaining({
      options: expect.objectContaining({ engine: 'claude', model: 'claude-sonnet-5' }),
    }))
  })
  it('Catalog에서 받은 Codex 모델을 렌더하고 Codex 선택 시 추론 수준을 payload에 싣는다', () => {
    const gen = vi.fn().mockResolvedValue({})
    render(<StoryView pipeline={makePipeline(gen)} />)
    expect(screen.getByRole('option', { name: 'Codex GPT-5.5' })).toBeInTheDocument()
    fireEvent.change(screen.getByPlaceholderText('제목'), { target: { value: 'T' } })
    fireEvent.change(screen.getByLabelText('모델'), { target: { value: 'codex:gpt-5.5' } })
    expect(screen.getByLabelText('추론 수준')).toHaveValue('xhigh')
    fireEvent.change(screen.getByLabelText('추론 수준'), { target: { value: 'high' } })
    fireEvent.click(screen.getByRole('button', { name: '시작' }))
    expect(gen).toHaveBeenCalledWith(expect.objectContaining({
      options: expect.objectContaining({ engine: 'codex', model: 'gpt-5.5', reasoningEffort: 'high' }),
    }))
  })
  it('Claude 선택 시 추론 수준을 payload에 싣는다', () => {
    const gen = vi.fn().mockResolvedValue({})
    render(<StoryView pipeline={makePipeline(gen)} />)
    fireEvent.change(screen.getByPlaceholderText('제목'), { target: { value: 'T' } })
    fireEvent.change(screen.getByLabelText('모델'), { target: { value: 'claude:claude-opus-4-8' } })
    expect(screen.getByLabelText('추론 수준')).toHaveValue('off')
    fireEvent.change(screen.getByLabelText('추론 수준'), { target: { value: 'high' } })
    fireEvent.click(screen.getByRole('button', { name: '시작' }))
    const options = gen.mock.calls[0][0].options
    expect(options).toMatchObject({ engine: 'claude', model: 'claude-opus-4-8', reasoningEffort: 'high' })
  })
  it('모델 선택과 추론 메뉴를 한 행에 둔다', () => {
    render(<StoryView pipeline={makePipeline(vi.fn())} />)
    const modelRow = screen.getByLabelText('모델').closest('.story-llm-row')
    const reasoningRow = screen.getByLabelText('추론 수준').closest('.story-llm-row')
    expect(modelRow).toBeTruthy()
    expect(reasoningRow).toBe(modelRow)
    expect(modelRow.querySelector('.story-llm-controls')).toBeTruthy()
    expect(modelRow.querySelector('.story-llm-reasoning')).toContainElement(screen.getByLabelText('추론 수준'))
  })
  it('저장된 Claude 추론 수준을 hydrate한다', () => {
    const gen = vi.fn().mockResolvedValue({})
    render(<StoryView pipeline={makePipeline(gen, {
      state: {
        steps: {},
        input: {
          title: 'T',
          options: { engine: 'claude', model: 'claude-sonnet-5', reasoningEffort: 'max' },
        },
      },
    })} />)
    expect(screen.getByLabelText('모델')).toHaveValue('claude:claude-sonnet-5')
    expect(screen.getByLabelText('추론 수준')).toHaveValue('max')
    fireEvent.click(screen.getByRole('button', { name: '시작' }))
    expect(gen).toHaveBeenCalledWith(expect.objectContaining({
      options: expect.objectContaining({ engine: 'claude', model: 'claude-sonnet-5', reasoningEffort: 'max' }),
    }))
  })
  it('대본 분량은 값 combobox와 단위 select로 options.lengthValue/unit을 전달한다', () => {
    const gen = vi.fn().mockResolvedValue({})
    render(<StoryView pipeline={makePipeline(gen)} />)
    fireEvent.change(screen.getByPlaceholderText('제목'), { target: { value: 'T' } })
    fireEvent.change(screen.getByLabelText('대본 분량 단위'), { target: { value: 'chars' } })
    fireEvent.change(screen.getByLabelText('대본 분량 값'), { target: { value: '4200' } })
    fireEvent.click(screen.getByRole('button', { name: '시작' }))
    expect(gen).toHaveBeenCalledWith(expect.objectContaining({
      options: expect.objectContaining({ lengthValue: '4200', lengthUnit: 'chars', lengthMode: 'unit' }),
    }))
  })
  it('기본 모델은 claude-opus-4-8, 기본 길이 10 min', () => {
    const gen = vi.fn().mockResolvedValue({})
    render(<StoryView pipeline={makePipeline(gen)} />)
    fireEvent.change(screen.getByPlaceholderText('제목'), { target: { value: 'T' } })
    fireEvent.click(screen.getByRole('button', { name: '시작' }))
    expect(gen).toHaveBeenCalledWith(expect.objectContaining({
      options: expect.objectContaining({ model: 'claude-opus-4-8', lengthValue: '10', lengthUnit: 'min' }),
    }))
  })

  it('언어를 en으로 바꾸면 words/chars 단위를 선택할 수 있다', () => {
    const gen = vi.fn().mockResolvedValue({})
    render(<StoryView pipeline={makePipeline(gen)} />)
    fireEvent.change(screen.getByPlaceholderText('제목'), { target: { value: 'T' } })
    fireEvent.change(screen.getByLabelText('언어'), { target: { value: 'en' } })
    fireEvent.change(screen.getByLabelText('대본 분량 단위'), { target: { value: 'words' } })
    fireEvent.click(screen.getByRole('button', { name: '시작' }))
    expect(gen).toHaveBeenCalledWith(expect.objectContaining({
      options: expect.objectContaining({ language: 'en', lengthValue: '1500', lengthUnit: 'words', lengthMode: 'unit' }),
    }))
  })

  it('한국어 자수 단위에서 영어로 바꿔도 chars 단위는 유지된다', () => {
    const gen = vi.fn().mockResolvedValue({})
    render(<StoryView pipeline={makePipeline(gen)} />)
    fireEvent.change(screen.getByPlaceholderText('제목'), { target: { value: 'T' } })
    fireEvent.change(screen.getByLabelText('대본 분량 단위'), { target: { value: 'chars' } })
    fireEvent.change(screen.getByLabelText('대본 분량 값'), { target: { value: '6600' } })
    fireEvent.change(screen.getByLabelText('언어'), { target: { value: 'en' } })
    fireEvent.click(screen.getByRole('button', { name: '시작' }))
    expect(gen).toHaveBeenCalledWith(expect.objectContaining({
      options: expect.objectContaining({ language: 'en', lengthValue: '6600', lengthUnit: 'chars', lengthMode: 'unit' }),
    }))
  })

  it('영어 words 단위에서 한국어로 바꾸면 같은 분량의 자수로 변환된다', () => {
    const gen = vi.fn().mockResolvedValue({})
    render(<StoryView pipeline={makePipeline(gen)} />)
    fireEvent.change(screen.getByPlaceholderText('제목'), { target: { value: 'T' } })
    fireEvent.change(screen.getByLabelText('언어'), { target: { value: 'en' } })
    fireEvent.change(screen.getByLabelText('대본 분량 단위'), { target: { value: 'words' } })
    fireEvent.change(screen.getByLabelText('대본 분량 값'), { target: { value: '3000' } })
    fireEvent.change(screen.getByLabelText('언어'), { target: { value: 'ko' } })
    fireEvent.click(screen.getByRole('button', { name: '시작' }))
    expect(gen).toHaveBeenCalledWith(expect.objectContaining({
      options: expect.objectContaining({ language: 'ko', lengthValue: '6600', lengthUnit: 'chars', lengthMode: 'unit' }),
    }))
  })

  it('1분 미만 words 값을 한국어로 바꿔도 같은 분량 비율을 유지한다', () => {
    const gen = vi.fn().mockResolvedValue({})
    render(<StoryView pipeline={makePipeline(gen)} />)
    fireEvent.change(screen.getByPlaceholderText('제목'), { target: { value: 'T' } })
    fireEvent.change(screen.getByLabelText('언어'), { target: { value: 'en' } })
    fireEvent.change(screen.getByLabelText('대본 분량 단위'), { target: { value: 'words' } })
    fireEvent.change(screen.getByLabelText('대본 분량 값'), { target: { value: '100' } })
    fireEvent.change(screen.getByLabelText('언어'), { target: { value: 'ko' } })
    expect(screen.getByLabelText('대본 분량 값')).toHaveValue('220')
    expect(screen.getByLabelText('대본 분량 단위')).toHaveValue('chars')
    fireEvent.click(screen.getByRole('button', { name: '시작' }))
    expect(gen).toHaveBeenCalledWith(expect.objectContaining({
      options: expect.objectContaining({ language: 'ko', lengthValue: '220', lengthUnit: 'chars', lengthMode: 'unit' }),
    }))
  })

  it('1분 미만 words 값을 min으로 바꿔도 같은 분량 비율을 유지한다', () => {
    const gen = vi.fn().mockResolvedValue({})
    render(<StoryView pipeline={makePipeline(gen)} />)
    fireEvent.change(screen.getByPlaceholderText('제목'), { target: { value: 'T' } })
    fireEvent.change(screen.getByLabelText('언어'), { target: { value: 'en' } })
    fireEvent.change(screen.getByLabelText('대본 분량 단위'), { target: { value: 'words' } })
    fireEvent.change(screen.getByLabelText('대본 분량 값'), { target: { value: '100' } })
    fireEvent.change(screen.getByLabelText('대본 분량 단위'), { target: { value: 'min' } })
    expect(screen.getByLabelText('대본 분량 값')).toHaveValue('0.6667')
    fireEvent.click(screen.getByRole('button', { name: '시작' }))
    expect(gen).toHaveBeenCalledWith(expect.objectContaining({
      options: expect.objectContaining({ language: 'en', lengthValue: '0.6667', lengthUnit: 'min' }),
    }))
  })

  it.each([
    ['en', 'words', '1', '0.0067'],
    ['ko', 'chars', '2', '0.0061'],
  ])('아주 작은 %s %s 값을 min으로 바꿔도 비율을 보존한다', (language, unit, value, expected) => {
    render(<StoryView pipeline={makePipeline(vi.fn())} />)
    fireEvent.change(screen.getByPlaceholderText('제목'), { target: { value: 'T' } })
    if (language === 'en') fireEvent.change(screen.getByLabelText('언어'), { target: { value: 'en' } })
    fireEvent.change(screen.getByLabelText('대본 분량 단위'), { target: { value: unit } })
    fireEvent.change(screen.getByLabelText('대본 분량 값'), { target: { value } })
    fireEvent.change(screen.getByLabelText('대본 분량 단위'), { target: { value: 'min' } })
    expect(screen.getByLabelText('대본 분량 값')).toHaveValue(expected)
  })

  it('아주 작은 자수 값을 min으로 바꿔도 0으로 떨어뜨리지 않는다', () => {
    const gen = vi.fn().mockResolvedValue({})
    render(<StoryView pipeline={makePipeline(gen)} />)
    fireEvent.change(screen.getByPlaceholderText('제목'), { target: { value: 'T' } })
    fireEvent.change(screen.getByLabelText('대본 분량 단위'), { target: { value: 'chars' } })
    fireEvent.change(screen.getByLabelText('대본 분량 값'), { target: { value: '1' } })
    fireEvent.change(screen.getByLabelText('대본 분량 단위'), { target: { value: 'min' } })
    expect(screen.getByLabelText('대본 분량 값')).toHaveValue('0.003')
    fireEvent.click(screen.getByRole('button', { name: '시작' }))
    expect(gen).toHaveBeenCalledWith(expect.objectContaining({
      options: expect.objectContaining({ language: 'ko', lengthValue: '0.003', lengthUnit: 'min' }),
    }))
  })

  it('min 단위는 언어를 바꿔도 유지된다', () => {
    const gen = vi.fn().mockResolvedValue({})
    render(<StoryView pipeline={makePipeline(gen)} />)
    fireEvent.change(screen.getByPlaceholderText('제목'), { target: { value: 'T' } })
    fireEvent.change(screen.getByLabelText('언어'), { target: { value: 'en' } })
    fireEvent.click(screen.getByRole('button', { name: '시작' }))
    expect(gen).toHaveBeenCalledWith(expect.objectContaining({
      options: expect.objectContaining({ lengthUnit: 'min' }),
    }))
  })
})
