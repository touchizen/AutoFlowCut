/**
 * StoryStepper — active(파란색) 표시는 currentStep이 아니라 사용자가 보고 있는 activeStep을
 * 따라야 한다(스텝퍼 탭 클릭 시 클릭한 곳이 active). activeStep 미지정이면 currentStep 폴백.
 */
import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import StoryStepper from '../../../src/components/story/StoryStepper.jsx'

const allDone = { script: { status: 'done' }, scenes: { status: 'done' }, audio: { status: 'done' }, prompts: { status: 'done' } }
const pillOf = (label) => screen.getByText(label).closest('.story-step-pill')

describe('StoryStepper 설정 탭(0번, 시나리오 앞)', () => {
  it('설정 pill을 시나리오 앞에 렌더 — 상태 배지 없음, 항상 클릭 가능', () => {
    render(<StoryStepper steps={allDone} currentStep="script" activeStep="setup" onStepClick={vi.fn()} />)
    const setup = pillOf('설정')
    expect(setup).toBeTruthy()
    // 시나리오 앞 순서
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
    expect(pillOf('시나리오').classList.contains('active')).toBe(false)
  })
})

// §v2.12 B: synopsis 정식 번호 스텝(UI) — pill 자리는 항상 렌더(숨김 폐지),
// synopsisEnabled prop이 활성(클릭 가능)/비활성(회색, 클릭 불가)을 가른다.
describe('StoryStepper 시놉시스 스텝(항상 렌더 + synopsisEnabled)', () => {
  it('설정 뒤·시나리오 앞에 무배지 pill을 항상 렌더한다(prop 미지정 포함)', () => {
    render(<StoryStepper steps={allDone} currentStep="script" onStepClick={vi.fn()} />)
    const pill = pillOf('시놉시스')
    expect(pill).toBeTruthy()
    const pills = [...document.querySelectorAll('.story-step-pill')]
    expect(pills.indexOf(pillOf('설정'))).toBe(0)
    expect(pills.indexOf(pill)).toBe(1)
    expect(pills.indexOf(pillOf('시나리오'))).toBe(2)
    expect(pill.querySelector('.story-step-badge')).toBeNull()
  })
  it('synopsisEnabled 미지정(기본)이면 비활성 — 회색(disabled) 스타일 + 클릭 불가', () => {
    const onStepClick = vi.fn()
    render(<StoryStepper steps={allDone} currentStep="script" onStepClick={onStepClick} />)
    const pill = pillOf('시놉시스')
    expect(pill.classList.contains('story-step-disabled')).toBe(true)
    expect(pill.classList.contains('story-step-clickable')).toBe(false)
    fireEvent.click(pill)
    expect(onStepClick).not.toHaveBeenCalled()
  })
  it('synopsisEnabled=true면 활성 — 클릭 시 onStepClick("synopsis") 호출', () => {
    const onStepClick = vi.fn()
    render(<StoryStepper steps={allDone} currentStep="script" synopsisEnabled onStepClick={onStepClick} />)
    const pill = pillOf('시놉시스')
    expect(pill.classList.contains('story-step-disabled')).toBe(false)
    fireEvent.click(pill)
    expect(onStepClick).toHaveBeenCalledWith('synopsis')
  })
  it('activeStep="synopsis"면 시놉시스 pill이 active', () => {
    render(<StoryStepper steps={allDone} currentStep="script" activeStep="synopsis" synopsisEnabled onStepClick={vi.fn()} />)
    expect(pillOf('시놉시스').classList.contains('active')).toBe(true)
    expect(pillOf('시나리오').classList.contains('active')).toBe(false)
  })
})

// §v2.12 B: 정식 번호 시프트 — setup 0, synopsis ①, script ②, scenes ③, audio ④, prompts ⑤.
describe('StoryStepper 스텝 번호(§v2.12)', () => {
  it('setup=0, synopsis=①, script=②, scenes=③, audio=④, prompts=⑤', () => {
    render(<StoryStepper steps={allDone} currentStep="script" onStepClick={vi.fn()} />)
    const iconOf = (label) => pillOf(label).querySelector('.story-step-icon').textContent
    expect(iconOf('설정')).toBe('0')
    expect(iconOf('시놉시스')).toBe('①')
    expect(iconOf('시나리오')).toBe('②')
    expect(iconOf('씬 분리')).toBe('③')
    expect(iconOf('오디오')).toBe('④')
    expect(iconOf('프롬프트')).toBe('⑤')
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
    expect(screen.getByText('씬 분리').closest('.story-step-col').querySelector('input[type=checkbox]').checked).toBe(true)
    expect(screen.getByText('오디오').closest('.story-step-col').querySelector('input[type=checkbox]').checked).toBe(false)
    expect(screen.getByText('프롬프트').closest('.story-step-col').querySelector('input[type=checkbox]').checked).toBe(true)
    // 시나리오/설정엔 자동 체크박스 없음
    expect(screen.getByText('시나리오').closest('.story-step-col').querySelector('input[type=checkbox]')).toBeNull()
  })
  it('자동 체크박스 클릭 시 onToggleAuto(step) 호출, 탭 이동(onStepClick)은 안 함', () => {
    const onToggleAuto = vi.fn(); const onStepClick = vi.fn()
    render(<StoryStepper steps={steps} currentStep="scenes" onStepClick={onStepClick}
      autoSteps={{ scenes: false, audio: false, prompts: true }} onToggleAuto={onToggleAuto} onRunAll={vi.fn()} canRunAll autoRunning={false} />)
    fireEvent.click(screen.getByText('오디오').closest('.story-step-col').querySelector('input[type=checkbox]'))
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
