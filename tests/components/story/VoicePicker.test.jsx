import { describe, it, expect, vi } from 'vitest'
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
