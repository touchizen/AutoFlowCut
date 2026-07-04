/**
 * StoryStepper — active(파란색) 표시는 currentStep이 아니라 사용자가 보고 있는 activeStep을
 * 따라야 한다(스텝퍼 탭 클릭 시 클릭한 곳이 active). activeStep 미지정이면 currentStep 폴백.
 */
import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import StoryStepper from '../../../src/components/story/StoryStepper.jsx'

const allDone = { script: { status: 'done' }, scenes: { status: 'done' }, audio: { status: 'done' }, prompts: { status: 'done' } }
const pillOf = (label) => screen.getByText(label).closest('.story-step-pill')

describe('StoryStepper 설정 탭(0번, 대본 앞)', () => {
  it('설정 pill을 대본 앞에 렌더 — 상태 배지 없음, 항상 클릭 가능', () => {
    render(<StoryStepper steps={allDone} currentStep="script" activeStep="setup" onStepClick={vi.fn()} />)
    const setup = pillOf('설정')
    expect(setup).toBeTruthy()
    // 대본 앞 순서
    const pills = [...document.querySelectorAll('.story-step-pill')]
    expect(pills.indexOf(setup)).toBe(0)
    // 상태 배지 없음(설정은 실행 스텝 아님)
    expect(setup.querySelector('.story-step-badge')).toBeNull()
  })
  it('설정 pill 클릭 시 onStepClick("setup") 호출', () => {
    const onStepClick = vi.fn()
    render(<StoryStepper steps={allDone} currentStep="script" activeStep="setup" onStepClick={onStepClick} />)
    fireEvent.click(pillOf('설정'))
    expect(onStepClick).toHaveBeenCalledWith('setup')
  })
  it('activeStep="setup"이면 설정 pill이 active', () => {
    render(<StoryStepper steps={allDone} currentStep="script" activeStep="setup" onStepClick={vi.fn()} />)
    expect(pillOf('설정').classList.contains('active')).toBe(true)
    expect(pillOf('대본').classList.contains('active')).toBe(false)
  })
})

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
