/**
 * StoryStepper — active(파란색) 표시는 currentStep이 아니라 사용자가 보고 있는 activeStep을
 * 따라야 한다(스텝퍼 탭 클릭 시 클릭한 곳이 active). activeStep 미지정이면 currentStep 폴백.
 *
 * UI: 진입 탭(설정/리서치/시놉시스)은 왼쪽 텍스트 탭(.story-gate-tab), 실행 스텝은 번호 + 연결선
 * 레일(.story-rail-step). 상태는 색 점이 아니라 번호 자리(.story-rail-num)가 표현하고,
 * 자동 토글은 오른쪽 요약 버튼(.story-auto-summary) 팝오버 안에 있다.
 */
import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import StoryStepper from '../../../src/components/story/StoryStepper.jsx'

const allDone = { script: { status: 'done' }, scenes: { status: 'done' }, audio: { status: 'done' }, prompts: { status: 'done' } }
// 진입 탭이든 실행 스텝이든 "그 라벨을 가진 클릭 단위"를 집는다.
const stepOf = (label) => screen.getByText(label).closest('.story-gate-tab, .story-rail-step')
const gateOf = (label) => screen.getByText(label).closest('.story-gate-tab')
const railOf = (label) => screen.getByText(label).closest('.story-rail-step')

describe('StoryStepper 설정 탭(진입 탭, 레일 앞)', () => {
  it('설정 탭을 진입 탭 영역 첫 자리에 렌더 — 상태 표시 없음, 항상 클릭 가능', () => {
    render(<StoryStepper steps={allDone} currentStep="script" activeStep="setup" onStepClick={vi.fn()} />)
    const setup = gateOf('설정')
    expect(setup).toBeTruthy()
    const gates = [...document.querySelectorAll('.story-gate-tab')]
    expect(gates.indexOf(setup)).toBe(0)
    // 진입 탭은 실행 스텝의 번호/상태 자리를 갖지 않는다.
    expect(setup.querySelector('.story-rail-num')).toBeNull()
    expect(setup.querySelector('.story-gate-check')).toBeNull()
    // 진입 탭은 레일 밖에 있다.
    expect(setup.closest('.story-stepper-rail')).toBeNull()
  })
  it('설정 탭 클릭 시 onStepClick("setup") 호출', () => {
    const onStepClick = vi.fn()
    render(<StoryStepper steps={allDone} currentStep="script" activeStep="setup" onStepClick={onStepClick} />)
    fireEvent.click(gateOf('설정'))
    expect(onStepClick).toHaveBeenCalledWith('setup')
  })
  it('activeStep="setup"이면 설정 탭이 active', () => {
    render(<StoryStepper steps={allDone} currentStep="script" activeStep="setup" onStepClick={vi.fn()} />)
    expect(gateOf('설정').classList.contains('active')).toBe(true)
    expect(railOf('대본').classList.contains('active')).toBe(false)
  })
})

// §v2.12 B: synopsis 진입 탭 — 자리는 항상 렌더(숨김 폐지),
// synopsisEnabled prop이 활성(클릭 가능)/비활성(회색, 클릭 불가)을 가른다.
describe('StoryStepper 시놉시스 탭(항상 렌더 + synopsisEnabled)', () => {
  it('리서치 뒤·레일 앞에 진입 탭을 항상 렌더한다(prop 미지정 포함)', () => {
    render(<StoryStepper steps={allDone} currentStep="script" onStepClick={vi.fn()} />)
    const tab = gateOf('시놉시스')
    expect(tab).toBeTruthy()
    const gates = [...document.querySelectorAll('.story-gate-tab')]
    expect(gates.indexOf(gateOf('설정'))).toBe(0)
    expect(gates.indexOf(gateOf('리서치'))).toBe(1)
    expect(gates.indexOf(tab)).toBe(2)
    expect(tab.closest('.story-stepper-rail')).toBeNull()
  })
  it('synopsisEnabled 미지정(기본)이면 비활성 — 회색(disabled) 스타일 + 클릭 불가', () => {
    const onStepClick = vi.fn()
    render(<StoryStepper steps={allDone} currentStep="script" onStepClick={onStepClick} />)
    const tab = gateOf('시놉시스')
    expect(tab.classList.contains('story-step-disabled')).toBe(true)
    expect(tab.classList.contains('story-step-clickable')).toBe(false)
    fireEvent.click(tab)
    expect(onStepClick).not.toHaveBeenCalled()
  })
  it('synopsisEnabled=true면 활성 — 클릭 시 onStepClick("synopsis") 호출', () => {
    const onStepClick = vi.fn()
    render(<StoryStepper steps={allDone} currentStep="script" synopsisEnabled onStepClick={onStepClick} />)
    const tab = gateOf('시놉시스')
    expect(tab.classList.contains('story-step-disabled')).toBe(false)
    fireEvent.click(tab)
    expect(onStepClick).toHaveBeenCalledWith('synopsis')
  })
  it('activeStep="synopsis"면 시놉시스 탭이 active', () => {
    render(<StoryStepper steps={allDone} currentStep="script" activeStep="synopsis" synopsisEnabled onStepClick={vi.fn()} />)
    expect(gateOf('시놉시스').classList.contains('active')).toBe(true)
    expect(railOf('대본').classList.contains('active')).toBe(false)
  })
})

// 리서치 spec §2.1/D1: research 탭 — 자리는 항상 렌더(설정 뒤·시놉시스 앞), 무상태 진입 탭.
describe('StoryStepper 리서치 탭(항상 렌더 + researchEnabled)', () => {
  it('설정 뒤·시놉시스 앞에 진입 탭을 항상 렌더한다(prop 미지정 포함)', () => {
    render(<StoryStepper steps={allDone} currentStep="script" onStepClick={vi.fn()} />)
    const tab = gateOf('리서치')
    expect(tab).toBeTruthy()
    const gates = [...document.querySelectorAll('.story-gate-tab')]
    expect(gates.indexOf(tab)).toBe(1)
    expect(tab.closest('.story-stepper-rail')).toBeNull()
  })
  it('researchEnabled 미지정(기본)이면 비활성 — 회색(disabled) 스타일 + 클릭 불가', () => {
    const onStepClick = vi.fn()
    render(<StoryStepper steps={allDone} currentStep="script" onStepClick={onStepClick} />)
    const tab = gateOf('리서치')
    expect(tab.classList.contains('story-step-disabled')).toBe(true)
    expect(tab.classList.contains('story-step-clickable')).toBe(false)
    fireEvent.click(tab)
    expect(onStepClick).not.toHaveBeenCalled()
  })
  it('researchEnabled=true면 활성 — 클릭 시 onStepClick("research") 호출', () => {
    const onStepClick = vi.fn()
    render(<StoryStepper steps={allDone} currentStep="script" researchEnabled onStepClick={onStepClick} />)
    const tab = gateOf('리서치')
    expect(tab.classList.contains('story-step-disabled')).toBe(false)
    fireEvent.click(tab)
    expect(onStepClick).toHaveBeenCalledWith('research')
  })
  it('activeStep="research"면 리서치 탭이 active', () => {
    render(<StoryStepper steps={allDone} currentStep="script" activeStep="research" researchEnabled onStepClick={vi.fn()} />)
    expect(gateOf('리서치').classList.contains('active')).toBe(true)
    expect(gateOf('시놉시스').classList.contains('active')).toBe(false)
  })
})

// 진행 레일 — 실행 스텝만 번호 + 연결선. 순번은 레일 안 위치(1..4)를 따른다.
describe('StoryStepper 진행 레일(번호 + 연결선)', () => {
  it('실행 스텝 4개가 레일 안에 순서대로, 대기 스텝은 순번을 번호 자리에 표시', () => {
    const steps = { script: { status: 'pending' }, scenes: { status: 'pending' }, audio: { status: 'pending' }, prompts: { status: 'pending' } }
    render(<StoryStepper steps={steps} currentStep="script" onStepClick={vi.fn()} />)
    const rail = document.querySelector('.story-stepper-rail')
    expect(rail).toBeTruthy()
    const railSteps = [...rail.querySelectorAll('.story-rail-step')]
    expect(railSteps.length).toBe(4)
    const numOf = (label) => railOf(label).querySelector('.story-rail-num').textContent
    expect(numOf('대본')).toBe('1')
    expect(numOf('씬 분리')).toBe('2')
    expect(numOf('오디오')).toBe('3')
    expect(numOf('프롬프트')).toBe('4')
  })
  it('상태는 번호 자리가 표현 — 완료는 체크, 진행/오류는 상태 클래스', () => {
    const steps = { script: { status: 'done' }, scenes: { status: 'running' }, audio: { status: 'pending' }, prompts: { status: 'error' } }
    render(<StoryStepper steps={steps} currentStep="scenes" researchEnabled synopsisEnabled onStepClick={vi.fn()} />)
    // 완료 스텝은 순번 대신 체크
    expect(railOf('대본').querySelector('.story-rail-num').textContent).toBe('✓')
    expect(railOf('대본').classList.contains('story-step-done')).toBe(true)
    expect(railOf('씬 분리').classList.contains('story-step-running')).toBe(true)
    expect(railOf('오디오').classList.contains('story-step-pending')).toBe(true)
    expect(railOf('프롬프트').classList.contains('story-step-error')).toBe(true)
    // 상태는 접근성 라벨로도 읽힌다(색에만 의존하지 않는다).
    expect(railOf('씬 분리').querySelector('.story-rail-num').getAttribute('aria-label')).toBe('진행 중')
  })
  it('좁은 폭에서 라벨이 접히거나 잘려도 전체 이름을 title 로 남긴다', () => {
    render(<StoryStepper steps={allDone} currentStep="prompts" onStepClick={vi.fn()} />)
    for (const label of ['대본', '씬 분리', '오디오', '프롬프트']) {
      expect(railOf(label).querySelector('.story-rail-label').getAttribute('title')).toBe(label)
    }
  })

  // 임포트 경로는 대본을 먼저 저장(script done)하고 시놉시스 게이트로 들어간다. 그 동안 레일이
  // "대본 완료 → 씬 분리로 진행"으로 보이면 아직 게이트에 서 있는 사용자에게 거짓 진행이 된다.
  it('시놉시스 게이트에 머무는 동안에는 대본이 done 이어도 흐름을 채우지 않는다', () => {
    const steps = { script: { status: 'done' }, scenes: { status: 'pending' }, audio: { status: 'pending' }, prompts: { status: 'pending' } }
    render(<StoryStepper steps={steps} currentStep="scenes" activeStep="synopsis"
      synopsisEnabled synopsisDone={false} onStepClick={vi.fn()} />)
    const lines = [...document.querySelectorAll('.story-rail-line')]
    expect(lines.every((l) => !l.classList.contains('filled'))).toBe(true)
  })

  it('리서치 게이트도 마찬가지로 흐름을 채우지 않는다', () => {
    const steps = { script: { status: 'done' }, scenes: { status: 'pending' }, audio: { status: 'pending' }, prompts: { status: 'pending' } }
    render(<StoryStepper steps={steps} currentStep="scenes" activeStep="research"
      researchEnabled researchDone={false} onStepClick={vi.fn()} />)
    expect([...document.querySelectorAll('.story-rail-line')].some((l) => l.classList.contains('filled'))).toBe(false)
  })

  it('게이트를 통과(확정)했으면 게이트 탭을 보고 있어도 흐름은 채워진다', () => {
    const steps = { script: { status: 'done' }, scenes: { status: 'pending' }, audio: { status: 'pending' }, prompts: { status: 'pending' } }
    render(<StoryStepper steps={steps} currentStep="scenes" activeStep="synopsis"
      synopsisEnabled synopsisDone onStepClick={vi.fn()} />)
    expect(document.querySelectorAll('.story-rail-line')[0].classList.contains('filled')).toBe(true)
  })

  it('연결선은 앞 스텝이 완료면 채워진다(진행 방향 표시)', () => {
    const steps = { script: { status: 'done' }, scenes: { status: 'running' }, audio: { status: 'pending' }, prompts: { status: 'pending' } }
    render(<StoryStepper steps={steps} currentStep="scenes" onStepClick={vi.fn()} />)
    const lines = [...document.querySelectorAll('.story-rail-line')]
    expect(lines.length).toBe(3)                                  // 스텝 4개 사이 3개
    expect(lines[0].classList.contains('filled')).toBe(true)      // 대본(done) → 씬 분리
    expect(lines[1].classList.contains('filled')).toBe(false)     // 씬 분리(running) → 오디오
    expect(lines[2].classList.contains('filled')).toBe(false)
  })
})

describe('StoryStepper active', () => {
  it('activeStep이 지정되면 그 스텝이 active (currentStep 아님)', () => {
    render(<StoryStepper steps={allDone} currentStep="prompts" activeStep="audio" onStepClick={vi.fn()} />)
    expect(railOf('오디오').classList.contains('active')).toBe(true)
    expect(railOf('프롬프트').classList.contains('active')).toBe(false)
  })

  it('activeStep 미지정이면 currentStep 폴백(하위호환)', () => {
    render(<StoryStepper steps={allDone} currentStep="prompts" onStepClick={vi.fn()} />)
    expect(railOf('프롬프트').classList.contains('active')).toBe(true)
    expect(railOf('오디오').classList.contains('active')).toBe(false)
  })
})

describe('StoryStepper 자동 진행(자동 요약 팝오버 + 전체 진행)', () => {
  const steps = { script: { status: 'done' }, scenes: { status: 'pending' }, audio: { status: 'pending' }, prompts: { status: 'pending' } }
  const openAuto = () => fireEvent.click(document.querySelector('.story-auto-summary'))
  const autoBoxOf = (label) => screen.getByLabelText(`${label} 자동`)

  it('요약 버튼이 켜진 자동 스텝 수를 보여준다(칩마다 흩어진 토글 대체)', () => {
    render(<StoryStepper steps={steps} currentStep="scenes" onStepClick={vi.fn()}
      autoSteps={{ scenes: true, audio: false, prompts: true }} onToggleAuto={vi.fn()} onRunAll={vi.fn()} canRunAll autoRunning={false} />)
    const summary = document.querySelector('.story-auto-summary')
    expect(summary.querySelector('.story-auto-count').textContent).toBe('2')
    // 팝오버를 열기 전에는 개별 체크박스가 없다(스텝퍼가 조용하다).
    expect(document.querySelector('.story-auto-popover')).toBeNull()
    expect(screen.queryByLabelText('씬 분리 자동')).toBeNull()
  })

  it('요약 버튼을 열면 scenes/audio/prompts 개별 체크박스가 autoSteps를 반영한다', () => {
    render(<StoryStepper steps={steps} currentStep="scenes" onStepClick={vi.fn()}
      autoSteps={{ scenes: true, audio: false, prompts: true }} onToggleAuto={vi.fn()} onRunAll={vi.fn()} canRunAll autoRunning={false} />)
    openAuto()
    expect(autoBoxOf('씬 분리').checked).toBe(true)
    expect(autoBoxOf('오디오').checked).toBe(false)
    expect(autoBoxOf('프롬프트').checked).toBe(true)
    // 대본/설정은 자동 대상이 아니다.
    expect(screen.queryByLabelText('대본 자동')).toBeNull()
    expect(screen.queryByLabelText('설정 자동')).toBeNull()
  })

  it('개별 자동 토글 클릭 시 onToggleAuto(step) 호출, 탭 이동(onStepClick)은 안 함', () => {
    const onToggleAuto = vi.fn(); const onStepClick = vi.fn()
    render(<StoryStepper steps={steps} currentStep="scenes" onStepClick={onStepClick}
      autoSteps={{ scenes: false, audio: false, prompts: true }} onToggleAuto={onToggleAuto} onRunAll={vi.fn()} canRunAll autoRunning={false} />)
    openAuto()
    fireEvent.click(autoBoxOf('씬 분리'))
    expect(onToggleAuto).toHaveBeenCalledWith('scenes')
    expect(onStepClick).not.toHaveBeenCalled()
  })

  it('팝오버는 바깥을 누르면 닫힌다', () => {
    render(<StoryStepper steps={steps} currentStep="scenes" onStepClick={vi.fn()}
      autoSteps={{ scenes: true, audio: false, prompts: false }} onToggleAuto={vi.fn()} />)
    openAuto()
    expect(document.querySelector('.story-auto-popover')).toBeTruthy()
    fireEvent.mouseDown(document.body)
    expect(document.querySelector('.story-auto-popover')).toBeNull()
  })

  it('onToggleAuto 없이 렌더하면 자동 제어를 그리지 않는다', () => {
    render(<StoryStepper steps={steps} currentStep="scenes" onStepClick={vi.fn()} onRunAll={vi.fn()} canRunAll />)
    expect(document.querySelector('.story-auto-summary')).toBeNull()
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

// 구조 — 진입 탭 / 레일 / 액션 3영역. 'Run all'은 레일 밖 오른쪽.
describe('StoryStepper 구조', () => {
  it('진입 탭은 gates 영역, 실행 스텝은 rail 영역, 전체 진행은 레일 밖', () => {
    render(<StoryStepper steps={allDone} currentStep="prompts" onStepClick={vi.fn()} onRunAll={vi.fn()} canRunAll />)
    const gates = document.querySelector('.story-stepper-gates')
    const rail = document.querySelector('.story-stepper-rail')
    expect(gateOf('설정').closest('.story-stepper-gates')).toBe(gates)
    expect(railOf('프롬프트').closest('.story-stepper-rail')).toBe(rail)
    expect(screen.getByRole('button', { name: /전체 진행/ }).closest('.story-stepper-rail')).toBeNull()
  })
})

// 게이트 완료 표시 — 리서치/시놉시스 확정 시 체크(실행 스텝 완료 체크와 일관).
describe('StoryStepper 게이트 완료 표시(done)', () => {
  it('researchDone/synopsisDone 이면 해당 진입 탭에 완료 체크', () => {
    render(<StoryStepper steps={allDone} currentStep="script" researchEnabled synopsisEnabled researchDone synopsisDone onStepClick={vi.fn()} />)
    expect(gateOf('리서치').querySelector('.story-gate-check')).toBeTruthy()
    expect(gateOf('시놉시스').querySelector('.story-gate-check')).toBeTruthy()
    // 설정은 완료 개념 없음
    expect(gateOf('설정').querySelector('.story-gate-check')).toBeNull()
  })
  it('done 미지정(기본)이면 게이트 체크 없음', () => {
    render(<StoryStepper steps={allDone} currentStep="script" researchEnabled synopsisEnabled onStepClick={vi.fn()} />)
    for (const g of ['설정', '리서치', '시놉시스']) {
      expect(gateOf(g).querySelector('.story-gate-check')).toBeNull()
    }
  })
})
