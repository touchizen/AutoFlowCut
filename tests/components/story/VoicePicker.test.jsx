import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import VoicePicker from '../../../src/components/story/VoicePicker.jsx'

const t = (k, d) => d || k
const voices = [
  { provider: 'gemini', id: 'Kore', name: 'Kore', gender: 'female', genderSource: 'adapter', language: 'multi', traits: ['firm'] },
  { provider: 'typecast', id: 'v1', name: 'Sanghyun', gender: null, genderSource: null, language: 'ko', traits: [] },
]

it('filters by gender segment', () => {
  render(<VoicePicker voices={voices} selected={{}} onSelect={vi.fn()} onPreview={vi.fn()} onOverrideGender={vi.fn()} previewState={{ status: 'idle' }} t={t} isKo />)
  fireEvent.click(screen.getByRole('button', { name: /여성|female/i }))
  expect(screen.getByText('Kore')).toBeInTheDocument()
  expect(screen.queryByText('Sanghyun')).not.toBeInTheDocument()
})

it('calls onSelect with provider+voiceId on card click', () => {
  const onSelect = vi.fn()
  render(<VoicePicker voices={voices} selected={{}} onSelect={onSelect} onPreview={vi.fn()} onOverrideGender={vi.fn()} previewState={{ status: 'idle' }} t={t} isKo />)
  fireEvent.click(screen.getByText('Kore'))
  expect(onSelect).toHaveBeenCalledWith({ provider: 'gemini', voiceId: 'Kore' })
})

it('calls onPreview when play clicked', () => {
  const onPreview = vi.fn()
  render(<VoicePicker voices={voices} selected={{}} onSelect={vi.fn()} onPreview={onPreview} onOverrideGender={vi.fn()} previewState={{ status: 'idle' }} t={t} isKo />)
  fireEvent.click(screen.getAllByRole('button', { name: /preview|미리듣기/i })[0])
  expect(onPreview).toHaveBeenCalled()
})

it('footer confirm is enabled for the default voice when selected={}', () => {
  const onSelect = vi.fn()
  render(<VoicePicker voices={voices} selected={{}} onSelect={onSelect} onPreview={vi.fn()} onOverrideGender={vi.fn()} previewState={{ status: 'idle' }} t={t} isKo />)
  const confirmBtn = screen.getByRole('button', { name: /이 성우로 지정|use this voice/i })
  expect(confirmBtn).not.toBeDisabled()
  fireEvent.click(confirmBtn)
  expect(onSelect).toHaveBeenCalledWith({ provider: 'typecast', voiceId: '' })
})

// 최종 리뷰 Finding 1: selected.voiceId가 현재 voices 목록에 없으면 footer가 "기본 성우"로
// 잘못 읽히던 버그 — 저장된 id가 있음을 구분해서 보여줘야 한다.
it('footer shows a distinct "not loaded" label (not default) when selected voiceId is missing from voices', () => {
  render(<VoicePicker voices={voices} selected={{ provider: 'elevenlabs', voiceId: 'el_missing' }} onSelect={vi.fn()} onPreview={vi.fn()} onOverrideGender={vi.fn()} previewState={{ status: 'idle' }} t={t} isKo />)
  const footer = screen.getByText(/선택됨|selected/i).closest('.sel')
  expect(footer.textContent).not.toMatch(/기본 성우/)
  expect(footer.textContent).toMatch(/미로드|el_missing/)
})

it('footer [이 성우로 지정] calls onConfirm and [취소] calls onCancel', () => {
  const onConfirm = vi.fn()
  const onCancel = vi.fn()
  render(<VoicePicker voices={voices} selected={{ provider: 'gemini', voiceId: 'Kore' }} onSelect={vi.fn()} onPreview={vi.fn()} onOverrideGender={vi.fn()} previewState={{ status: 'idle' }} onConfirm={onConfirm} onCancel={onCancel} t={t} isKo />)
  fireEvent.click(screen.getByRole('button', { name: /이 성우로 지정|use this voice/i }))
  expect(onConfirm).toHaveBeenCalledTimes(1)
  fireEvent.click(screen.getByRole('button', { name: /취소|cancel/i }))
  expect(onCancel).toHaveBeenCalledTimes(1)
})

describe('remote voice search (debounced)', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('calls onVoiceSearch with elevenlabs provider after debounce when ElevenLabs chip is active and query >= 2 chars', () => {
    const onVoiceSearch = vi.fn()
    render(<VoicePicker voices={voices} selected={{}} onSelect={vi.fn()} onPreview={vi.fn()} onOverrideGender={vi.fn()} previewState={{ status: 'idle' }} onVoiceSearch={onVoiceSearch} t={t} isKo />)
    fireEvent.click(screen.getByRole('button', { name: /ElevenLabs/i }))
    const input = screen.getByPlaceholderText(/이름·특성 검색|Search name or traits/i)
    fireEvent.change(input, { target: { value: 'ab' } })
    expect(onVoiceSearch).not.toHaveBeenCalled()
    vi.advanceTimersByTime(300)
    expect(onVoiceSearch).toHaveBeenCalledWith({ provider: 'elevenlabs', query: 'ab' })
  })

  it('does not call onVoiceSearch for a query shorter than 2 chars', () => {
    const onVoiceSearch = vi.fn()
    render(<VoicePicker voices={voices} selected={{}} onSelect={vi.fn()} onPreview={vi.fn()} onOverrideGender={vi.fn()} previewState={{ status: 'idle' }} onVoiceSearch={onVoiceSearch} t={t} isKo />)
    fireEvent.click(screen.getByRole('button', { name: /ElevenLabs/i }))
    const input = screen.getByPlaceholderText(/이름·특성 검색|Search name or traits/i)
    fireEvent.change(input, { target: { value: 'a' } })
    vi.advanceTimersByTime(300)
    expect(onVoiceSearch).not.toHaveBeenCalled()
  })

  it('does not call onVoiceSearch when the Gemini chip is active (remote search is elevenlabs-only)', () => {
    const onVoiceSearch = vi.fn()
    render(<VoicePicker voices={voices} selected={{}} onSelect={vi.fn()} onPreview={vi.fn()} onOverrideGender={vi.fn()} previewState={{ status: 'idle' }} onVoiceSearch={onVoiceSearch} t={t} isKo />)
    fireEvent.click(screen.getByRole('button', { name: /^Gemini/i }))
    const input = screen.getByPlaceholderText(/이름·특성 검색|Search name or traits/i)
    fireEvent.change(input, { target: { value: 'ab' } })
    vi.advanceTimersByTime(300)
    expect(onVoiceSearch).not.toHaveBeenCalled()
  })

  it('calls onVoiceSearch targeting elevenlabs when the "all" provider chip is active', () => {
    const onVoiceSearch = vi.fn()
    render(<VoicePicker voices={voices} selected={{}} onSelect={vi.fn()} onPreview={vi.fn()} onOverrideGender={vi.fn()} previewState={{ status: 'idle' }} onVoiceSearch={onVoiceSearch} t={t} isKo />)
    const input = screen.getByPlaceholderText(/이름·특성 검색|Search name or traits/i)
    fireEvent.change(input, { target: { value: 'ab' } })
    vi.advanceTimersByTime(300)
    expect(onVoiceSearch).toHaveBeenCalledWith({ provider: 'elevenlabs', query: 'ab' })
  })
})
