/**
 * StoryStepper — active(파란색) 표시는 currentStep이 아니라 사용자가 보고 있는 activeStep을
 * 따라야 한다(스텝퍼 탭 클릭 시 클릭한 곳이 active). activeStep 미지정이면 currentStep 폴백.
 */
import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import StoryStepper from '../../../src/components/story/StoryStepper.jsx'

const allDone = { script: { status: 'done' }, scenes: { status: 'done' }, audio: { status: 'done' }, prompts: { status: 'done' } }
const pillOf = (label) => screen.getByText(label).closest('.story-step-pill')

describe('StoryStepper active', () => {
  it('activeStep이 지정되면 그 스텝이 active (currentStep 아님)', () => {
    render(<StoryStepper steps={allDone} currentStep="prompts" activeStep="audio" onStepClick={vi.fn()} />)
    expect(pillOf('오디오').classList.contains('active')).toBe(true)
    expect(pillOf('프롬프트').classList.contains('active')).toBe(false)
  })

  it('activeStep 미지정이면 currentStep 폴백(하위호환)', () => {
    render(<StoryStepper steps={allDone} currentStep="prompts" onStepClick={vi.fn()} />)
    expect(pillOf('프롬프트').classList.contains('active')).toBe(true)
    expect(pillOf('오디오').classList.contains('active')).toBe(false)
  })
})
