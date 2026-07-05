import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import StoryView from '../../../src/components/story/StoryView.jsx'

const LLM_OPTIONS = [
  { id: 'claude:claude-opus-4-8', engine: 'claude', model: 'claude-opus-4-8', label: 'Claude Opus 4.8', reasoningEfforts: ['off', 'low', 'medium', 'high', 'max'], defaultReasoningEffort: 'off' },
  { id: 'claude:claude-sonnet-5', engine: 'claude', model: 'claude-sonnet-5', label: 'Claude Sonnet 5', reasoningEfforts: ['off', 'low', 'medium', 'high', 'max'], defaultReasoningEffort: 'off' },
  { id: 'codex:gpt-5.5', engine: 'codex', model: 'gpt-5.5', label: 'Codex GPT-5.5', reasoningEfforts: ['minimal', 'low', 'medium', 'high', 'xhigh'], defaultReasoningEffort: 'xhigh' },
  { id: 'codex:gpt-5.4', engine: 'codex', model: 'gpt-5.4', label: 'Codex GPT-5.4', reasoningEfforts: ['minimal', 'low', 'medium', 'high', 'xhigh'], defaultReasoningEffort: 'high' },
]

function makePipeline(start, overrides = {}) {
  return {
    state: { steps: {}, ...(overrides.state || {}) },
    streamingText: '',
    start,
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
    const start = vi.fn()
    render(<StoryView pipeline={makePipeline(start)} />)
    fireEvent.change(screen.getByPlaceholderText('제목'), { target: { value: 'T' } })
    fireEvent.change(screen.getByLabelText('모델'), { target: { value: 'claude:claude-sonnet-5' } })
    fireEvent.click(screen.getByRole('button', { name: '시작' }))
    expect(start).toHaveBeenCalledWith('script', expect.objectContaining({
      options: expect.objectContaining({ engine: 'claude', model: 'claude-sonnet-5' }),
    }))
  })
  it('Catalog에서 받은 Codex 모델을 렌더하고 Codex 선택 시 추론 수준을 payload에 싣는다', () => {
    const start = vi.fn()
    render(<StoryView pipeline={makePipeline(start)} />)
    expect(screen.getByRole('option', { name: 'Codex GPT-5.5' })).toBeInTheDocument()
    fireEvent.change(screen.getByPlaceholderText('제목'), { target: { value: 'T' } })
    fireEvent.change(screen.getByLabelText('모델'), { target: { value: 'codex:gpt-5.5' } })
    expect(screen.getByLabelText('추론 수준')).toHaveValue('xhigh')
    fireEvent.change(screen.getByLabelText('추론 수준'), { target: { value: 'high' } })
    fireEvent.click(screen.getByRole('button', { name: '시작' }))
    expect(start).toHaveBeenCalledWith('script', expect.objectContaining({
      options: expect.objectContaining({ engine: 'codex', model: 'gpt-5.5', reasoningEffort: 'high' }),
    }))
  })
  it('Claude 선택 시 추론 수준을 payload에 싣는다', () => {
    const start = vi.fn()
    render(<StoryView pipeline={makePipeline(start)} />)
    fireEvent.change(screen.getByPlaceholderText('제목'), { target: { value: 'T' } })
    fireEvent.change(screen.getByLabelText('모델'), { target: { value: 'claude:claude-opus-4-8' } })
    expect(screen.getByLabelText('추론 수준')).toHaveValue('off')
    fireEvent.change(screen.getByLabelText('추론 수준'), { target: { value: 'high' } })
    fireEvent.click(screen.getByRole('button', { name: '시작' }))
    const options = start.mock.calls[0][1].options
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
    const start = vi.fn()
    render(<StoryView pipeline={makePipeline(start, {
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
    expect(start).toHaveBeenCalledWith('script', expect.objectContaining({
      options: expect.objectContaining({ engine: 'claude', model: 'claude-sonnet-5', reasoningEffort: 'max' }),
    }))
  })
  it('길이 값+단위가 options.lengthValue/lengthUnit으로 전달된다', () => {
    const start = vi.fn()
    render(<StoryView pipeline={makePipeline(start)} />)
    fireEvent.change(screen.getByPlaceholderText('제목'), { target: { value: 'T' } })
    fireEvent.change(screen.getByLabelText('길이 값'), { target: { value: '6000' } })
    fireEvent.change(screen.getByLabelText('길이 단위'), { target: { value: 'chars' } })
    fireEvent.click(screen.getByRole('button', { name: '시작' }))
    expect(start).toHaveBeenCalledWith('script', expect.objectContaining({
      options: expect.objectContaining({ lengthValue: '6000', lengthUnit: 'chars' }),
    }))
  })
  it('기본 모델은 claude-opus-4-8, 기본 길이 10 min', () => {
    const start = vi.fn()
    render(<StoryView pipeline={makePipeline(start)} />)
    fireEvent.change(screen.getByPlaceholderText('제목'), { target: { value: 'T' } })
    fireEvent.click(screen.getByRole('button', { name: '시작' }))
    expect(start).toHaveBeenCalledWith('script', expect.objectContaining({
      options: expect.objectContaining({ model: 'claude-opus-4-8', lengthValue: '10', lengthUnit: 'min' }),
    }))
  })

  it('언어를 en으로 바꾸면 chars 단위가 words로 정규화된다', () => {
    const start = vi.fn()
    render(<StoryView pipeline={makePipeline(start)} />)
    fireEvent.change(screen.getByPlaceholderText('제목'), { target: { value: 'T' } })
    fireEvent.change(screen.getByLabelText('길이 단위'), { target: { value: 'chars' } })
    fireEvent.change(screen.getByLabelText('언어'), { target: { value: 'en' } })
    fireEvent.click(screen.getByRole('button', { name: '시작' }))
    expect(start).toHaveBeenCalledWith('script', expect.objectContaining({
      options: expect.objectContaining({ lengthUnit: 'words' }),
    }))
  })

  it('언어를 ko로 바꾸면 words 단위가 chars로 정규화된다', () => {
    const start = vi.fn()
    render(<StoryView pipeline={makePipeline(start)} />)
    fireEvent.change(screen.getByPlaceholderText('제목'), { target: { value: 'T' } })
    fireEvent.change(screen.getByLabelText('언어'), { target: { value: 'en' } })
    fireEvent.change(screen.getByLabelText('길이 단위'), { target: { value: 'words' } })
    fireEvent.change(screen.getByLabelText('언어'), { target: { value: 'ko' } })
    fireEvent.click(screen.getByRole('button', { name: '시작' }))
    expect(start).toHaveBeenCalledWith('script', expect.objectContaining({
      options: expect.objectContaining({ lengthUnit: 'chars' }),
    }))
  })

  it('min 단위는 언어를 바꿔도 유지된다', () => {
    const start = vi.fn()
    render(<StoryView pipeline={makePipeline(start)} />)
    fireEvent.change(screen.getByPlaceholderText('제목'), { target: { value: 'T' } })
    fireEvent.change(screen.getByLabelText('언어'), { target: { value: 'en' } })
    fireEvent.click(screen.getByRole('button', { name: '시작' }))
    expect(start).toHaveBeenCalledWith('script', expect.objectContaining({
      options: expect.objectContaining({ lengthUnit: 'min' }),
    }))
  })
})
