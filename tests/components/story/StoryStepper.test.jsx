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
    // 상태 점 없음(설정은 실행 스텝 아님)
    expect(setup.querySelector('.story-step-dot')).toBeNull()
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

// §v2.12 B: synopsis 정식 번호 스텝(UI) — pill 자리는 항상 렌더(숨김 폐지),
// synopsisEnabled prop이 활성(클릭 가능)/비활성(회색, 클릭 불가)을 가른다.
describe('StoryStepper 시놉시스 스텝(항상 렌더 + synopsisEnabled)', () => {
  it('리서치 뒤·대본 앞에 무배지 pill을 항상 렌더한다(prop 미지정 포함)', () => {
    render(<StoryStepper steps={allDone} currentStep="script" onStepClick={vi.fn()} />)
    const pill = pillOf('시놉시스')
    expect(pill).toBeTruthy()
    const pills = [...document.querySelectorAll('.story-step-pill')]
    expect(pills.indexOf(pillOf('설정'))).toBe(0)
    expect(pills.indexOf(pillOf('리서치'))).toBe(1)
    expect(pills.indexOf(pill)).toBe(2)
    expect(pills.indexOf(pillOf('대본'))).toBe(3)
    expect(pill.querySelector('.story-step-dot')).toBeNull()
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
    expect(pillOf('대본').classList.contains('active')).toBe(false)
  })
})

// 리서치 spec §2.1/D1: 리서치(①) 삽입으로 번호 재시프트 —
// setup 0, research ①, synopsis ②, script ③, scenes ④, audio ⑤, prompts ⑥.
describe('StoryStepper 스텝 번호(리서치 D1)', () => {
  it('setup=0, research=①, synopsis=②, script=③, scenes=④, audio=⑤, prompts=⑥', () => {
    render(<StoryStepper steps={allDone} currentStep="script" onStepClick={vi.fn()} />)
    const iconOf = (label) => pillOf(label).querySelector('.story-step-icon').textContent
    expect(iconOf('설정')).toBe('0')
    expect(iconOf('리서치')).toBe('①')
    expect(iconOf('시놉시스')).toBe('②')
    expect(iconOf('대본')).toBe('③')
    expect(iconOf('씬 분리')).toBe('④')
    expect(iconOf('오디오')).toBe('⑤')
    expect(iconOf('프롬프트')).toBe('⑥')
  })
})

// 리서치 spec §2.1/§3.6: research pill(①) — 자리는 항상 렌더(설정 뒤·시놉시스 앞), 무배지 게이트 탭.
// researchEnabled prop이 활성/비활성을 가른다(시놉시스 synopsisEnabled 미러).
describe('StoryStepper 리서치 스텝(항상 렌더 + researchEnabled)', () => {
  it('설정 뒤·시놉시스 앞에 무배지 pill을 항상 렌더한다(prop 미지정 포함)', () => {
    render(<StoryStepper steps={allDone} currentStep="script" onStepClick={vi.fn()} />)
    const pill = pillOf('리서치')
    expect(pill).toBeTruthy()
    const pills = [...document.querySelectorAll('.story-step-pill')]
    expect(pills.indexOf(pill)).toBe(1)
    expect(pill.querySelector('.story-step-dot')).toBeNull()
  })
  it('researchEnabled 미지정(기본)이면 비활성 — 회색(disabled) 스타일 + 클릭 불가', () => {
    const onStepClick = vi.fn()
    render(<StoryStepper steps={allDone} currentStep="script" onStepClick={onStepClick} />)
    const pill = pillOf('리서치')
    expect(pill.classList.contains('story-step-disabled')).toBe(true)
    expect(pill.classList.contains('story-step-clickable')).toBe(false)
    fireEvent.click(pill)
    expect(onStepClick).not.toHaveBeenCalled()
  })
  it('researchEnabled=true면 활성 — 클릭 시 onStepClick("research") 호출', () => {
    const onStepClick = vi.fn()
    render(<StoryStepper steps={allDone} currentStep="script" researchEnabled onStepClick={onStepClick} />)
    const pill = pillOf('리서치')
    expect(pill.classList.contains('story-step-disabled')).toBe(false)
    fireEvent.click(pill)
    expect(onStepClick).toHaveBeenCalledWith('research')
  })
  it('activeStep="research"면 리서치 pill이 active', () => {
    render(<StoryStepper steps={allDone} currentStep="script" activeStep="research" researchEnabled onStepClick={vi.fn()} />)
    expect(pillOf('리서치').classList.contains('active')).toBe(true)
    expect(pillOf('시놉시스').classList.contains('active')).toBe(false)
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

describe('StoryStepper 자동 진행(칩 안 인라인 자동 토글 + 전체 진행)', () => {
  const steps = { script: { status: 'done' }, scenes: { status: 'pending' }, audio: { status: 'pending' }, prompts: { status: 'pending' } }
  const autoOf = (label) => pillOf(label).querySelector('input[type=checkbox]')
  it('scenes/audio/prompts 칩 안에 자동 체크박스, 상태는 autoSteps 반영', () => {
    render(<StoryStepper steps={steps} currentStep="scenes" onStepClick={vi.fn()}
      autoSteps={{ scenes: true, audio: false, prompts: true }} onToggleAuto={vi.fn()} onRunAll={vi.fn()} canRunAll autoRunning={false} />)
    expect(autoOf('씬 분리').checked).toBe(true)
    expect(autoOf('오디오').checked).toBe(false)
    expect(autoOf('프롬프트').checked).toBe(true)
    // 대본/설정엔 자동 체크박스 없음
    expect(autoOf('대본')).toBeNull()
    expect(autoOf('설정')).toBeNull()
  })
  it('자동 토글 클릭 시 onToggleAuto(step) 호출, 클릭 가능 스텝이어도 탭 이동(onStepClick)은 안 함', () => {
    const onToggleAuto = vi.fn(); const onStepClick = vi.fn()
    render(<StoryStepper steps={steps} currentStep="scenes" onStepClick={onStepClick}
      autoSteps={{ scenes: false, audio: false, prompts: true }} onToggleAuto={onToggleAuto} onRunAll={vi.fn()} canRunAll autoRunning={false} />)
    // scenes 는 currentStep 이라 클릭 가능(role=button) — 자동 토글이 칩 안에 있어도 stopPropagation 으로 탭 이동 방지.
    fireEvent.click(autoOf('씬 분리'))
    expect(onToggleAuto).toHaveBeenCalledWith('scenes')
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

// UI: 세그먼트 칩 — 칩은 한 줄 track 안, 'Run all'은 track 밖 오른쪽 고정. 상태는 텍스트 배지 대신 색 점.
describe('StoryStepper 세그먼트 칩 구조', () => {
  it('모든 칩은 한 줄 track(.story-stepper-track) 안, Run all 은 track 밖', () => {
    render(<StoryStepper steps={allDone} currentStep="prompts" onStepClick={vi.fn()} onRunAll={vi.fn()} canRunAll />)
    const track = document.querySelector('.story-stepper-track')
    expect(track).toBeTruthy()
    expect(pillOf('설정').closest('.story-stepper-track')).toBe(track)
    expect(pillOf('프롬프트').closest('.story-stepper-track')).toBe(track)
    // Run all 은 track 밖(오른쪽 고정)
    expect(screen.getByRole('button', { name: /전체 진행/ }).closest('.story-stepper-track')).toBeNull()
  })
  it('실행 스텝은 상태 점(.story-step-dot)을 상태 클래스와 함께, 게이트 탭엔 점 없음', () => {
    const steps = { script: { status: 'done' }, scenes: { status: 'running' }, audio: { status: 'pending' }, prompts: { status: 'error' } }
    render(<StoryStepper steps={steps} currentStep="scenes" researchEnabled synopsisEnabled onStepClick={vi.fn()} />)
    expect(pillOf('대본').querySelector('.story-step-dot.story-dot-done')).toBeTruthy()
    expect(pillOf('씬 분리').querySelector('.story-step-dot.story-dot-running')).toBeTruthy()
    expect(pillOf('오디오').querySelector('.story-step-dot.story-dot-pending')).toBeTruthy()
    expect(pillOf('프롬프트').querySelector('.story-step-dot.story-dot-error')).toBeTruthy()
    for (const gate of ['설정', '리서치', '시놉시스']) {
      expect(pillOf(gate).querySelector('.story-step-dot')).toBeNull()
    }
  })
})

// 게이트 완료 표시 — 리서치/시놉시스 확정 시 done 점(대본 등 실행 스텝과 일관).
describe('StoryStepper 게이트 완료 표시(done)', () => {
  it('researchDone/synopsisDone 이면 해당 게이트 칩에 완료 점(.story-dot-done)', () => {
    render(<StoryStepper steps={allDone} currentStep="script" researchEnabled synopsisEnabled researchDone synopsisDone onStepClick={vi.fn()} />)
    expect(pillOf('리서치').querySelector('.story-step-dot.story-dot-done')).toBeTruthy()
    expect(pillOf('시놉시스').querySelector('.story-step-dot.story-dot-done')).toBeTruthy()
    // 설정은 완료 개념 없음
    expect(pillOf('설정').querySelector('.story-step-dot')).toBeNull()
  })
  it('done 미지정(기본)이면 게이트 점 없음', () => {
    render(<StoryStepper steps={allDone} currentStep="script" researchEnabled synopsisEnabled onStepClick={vi.fn()} />)
    for (const g of ['설정', '리서치', '시놉시스']) {
      expect(pillOf(g).querySelector('.story-step-dot')).toBeNull()
    }
  })
})
