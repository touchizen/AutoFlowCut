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

describe('StoryStepper 자동 진행(자동 체크박스 + 전체 진행)', () => {
  const steps = { script: { status: 'done' }, scenes: { status: 'pending' }, audio: { status: 'pending' }, prompts: { status: 'pending' } }
  it('scenes/audio/prompts 각 pill에 자동 체크박스, 상태는 autoSteps 반영', () => {
    render(<StoryStepper steps={steps} currentStep="scenes" onStepClick={vi.fn()}
      autoSteps={{ scenes: true, audio: false, prompts: true }} onToggleAuto={vi.fn()} onRunAll={vi.fn()} canRunAll autoRunning={false} />)
    expect(pillOf('씬 분리').querySelector('input[type=checkbox]').checked).toBe(true)
    expect(pillOf('오디오').querySelector('input[type=checkbox]').checked).toBe(false)
    expect(pillOf('프롬프트').querySelector('input[type=checkbox]').checked).toBe(true)
    // 대본/설정엔 자동 체크박스 없음
    expect(pillOf('대본').querySelector('input[type=checkbox]')).toBeNull()
  })
  it('자동 체크박스 클릭 시 onToggleAuto(step) 호출, 탭 이동(onStepClick)은 안 함', () => {
    const onToggleAuto = vi.fn(); const onStepClick = vi.fn()
    render(<StoryStepper steps={steps} currentStep="scenes" onStepClick={onStepClick}
      autoSteps={{ scenes: false, audio: false, prompts: true }} onToggleAuto={onToggleAuto} onRunAll={vi.fn()} canRunAll autoRunning={false} />)
    fireEvent.click(pillOf('오디오').querySelector('input[type=checkbox]'))
    expect(onToggleAuto).toHaveBeenCalledWith('audio')
    expect(onStepClick).not.toHaveBeenCalled()
  })
  it('전체 진행 버튼 클릭 → onRunAll, canRunAll=false면 disabled', () => {
    const onRunAll = vi.fn()
    const { rerender } = render(<StoryStepper steps={steps} currentStep="scenes" onStepClick={vi.fn()}
      autoSteps={{ scenes: true, audio: false, prompts: true }} onToggleAuto={vi.fn()} onRunAll={onRunAll} canRunAll autoRunning={false} />)
    fireEvent.click(screen.getByRole('button', { name: /전체 진행/ }))
    expect(onRunAll).toHaveBeenCalled()
    rerender(<StoryStepper steps={steps} currentStep="scenes" onStepClick={vi.fn()}
      autoSteps={{ scenes: true, audio: false, prompts: true }} onToggleAuto={vi.fn()} onRunAll={onRunAll} canRunAll={false} autoRunning={false} />)
    expect(screen.getByRole('button', { name: /전체 진행/ })).toBeDisabled()
  })
})
