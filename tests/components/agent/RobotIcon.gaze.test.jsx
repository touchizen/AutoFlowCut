// @vitest-environment jsdom
import React, { useRef } from 'react'
import { readFileSync } from 'node:fs'
import { act, cleanup, render } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import RobotIcon from '../../../src/components/agent/RobotIcon.jsx'
import { ROBOT_3D } from '../../../src/components/agent/robotConfig.js'

const robotCss = readFileSync('src/components/agent/RobotIcon.css', 'utf8')
const chatCss = readFileSync('src/components/agent/ChatPanel.css', 'utf8')
const FAB_RECT = { left: 100, top: 100, width: 72, height: 72, right: 172, bottom: 172 }
const FAB_CENTER = { x: 136, y: 136 }

let animationFrames
let nextFrameId

function ruleBody(source, selector) {
  const rules = [...source.matchAll(/([^{}]+)\{([^{}]*)\}/g)]
  return rules.find((match) => match[1].split(',').map((item) => item.trim()).includes(selector))?.[2] || ''
}

function matchMediaResult(matches) {
  return {
    matches,
    media: '(prefers-reduced-motion: reduce)',
    onchange: null,
    addListener: vi.fn(),
    removeListener: vi.fn(),
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    dispatchEvent: vi.fn(() => false),
  }
}

function Harness({ active = true }) {
  const hostRef = useRef(null)
  return (
    <button ref={hostRef} className="agent-chat-fab">
      <RobotIcon hostRef={hostRef} active={active} />
    </button>
  )
}

function renderHarness(active = true) {
  const result = render(<Harness active={active} />)
  const host = result.container.querySelector('.agent-chat-fab')
  host.getBoundingClientRect = vi.fn(() => FAB_RECT)
  return {
    ...result,
    host,
    root: result.container.querySelector('.robot-icon'),
  }
}

function pointerMove(x, y) {
  act(() => {
    window.dispatchEvent(new MouseEvent('pointermove', { clientX: x, clientY: y }))
  })
}

function flushAnimationFrames() {
  const pending = [...animationFrames.entries()]
  animationFrames.clear()
  act(() => {
    for (const [, callback] of pending) callback(16)
  })
}

function expectDynamicVars(root, { yaw, pitch, eyeX, eyeY }) {
  expect(root.style.getPropertyValue('--robot-yaw')).toBe(yaw)
  expect(root.style.getPropertyValue('--robot-pitch')).toBe(pitch)
  expect(root.style.getPropertyValue('--eye-x')).toBe(eyeX)
  expect(root.style.getPropertyValue('--eye-y')).toBe(eyeY)
}

function expectIdleReset(root) {
  expect(root.dataset.motionState).toBe('idle')
  expectDynamicVars(root, { yaw: '', pitch: '', eyeX: '', eyeY: '' })
}

beforeEach(() => {
  animationFrames = new Map()
  nextFrameId = 1
  vi.spyOn(window, 'matchMedia').mockReturnValue(matchMediaResult(false))
  vi.stubGlobal('requestAnimationFrame', vi.fn((callback) => {
    const id = nextFrameId
    nextFrameId += 1
    animationFrames.set(id, callback)
    return id
  }))
  vi.stubGlobal('cancelAnimationFrame', vi.fn((id) => {
    animationFrames.delete(id)
  }))
})

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})

describe('RobotIcon gaze wiring', () => {
  it('rAF-throttles pointermove and writes exact product-derived unit strings from the latest pointer', () => {
    const { host, root } = renderHarness()

    pointerMove(FAB_CENTER.x + ROBOT_3D.radius / 2, FAB_CENTER.y)
    pointerMove(FAB_CENTER.x + ROBOT_3D.radius, FAB_CENTER.y)

    expect(requestAnimationFrame).toHaveBeenCalledOnce()
    expect(host.getBoundingClientRect).not.toHaveBeenCalled()
    flushAnimationFrames()

    expect(host.getBoundingClientRect).toHaveBeenCalledOnce()
    expect(root.dataset.motionState).toBe('gazing')
    expectDynamicVars(root, {
      yaw: `${ROBOT_3D.maxYaw}deg`,
      pitch: '0deg',
      eyeX: `${ROBOT_3D.maxEye}px`,
      eyeY: '0px',
    })
  })

  it('uses circular FAB hover priority while continuing to update eye vars', () => {
    const { root } = renderHarness()

    pointerMove(FAB_CENTER.x + 36, FAB_CENTER.y)
    flushAnimationFrames()
    expect(root.dataset.motionState).toBe('hover')
    expect(root.style.getPropertyValue('--eye-x')).toBe(`${(36 / ROBOT_3D.radius) * ROBOT_3D.maxEye}px`)

    pointerMove(FAB_RECT.left + 1, FAB_RECT.top + 1)
    flushAnimationFrames()
    expect(root.dataset.motionState).toBe('gazing')
  })

  it('resets to idle outside the gaze radius and on both pointer-loss paths', () => {
    const { root } = renderHarness()

    pointerMove(FAB_CENTER.x + ROBOT_3D.radius, FAB_CENTER.y)
    flushAnimationFrames()
    pointerMove(FAB_CENTER.x + ROBOT_3D.radius + 1, FAB_CENTER.y)
    flushAnimationFrames()
    expectIdleReset(root)

    for (const [target, eventName] of [[window, 'blur'], [document, 'pointerleave']]) {
      pointerMove(FAB_CENTER.x + ROBOT_3D.radius, FAB_CENTER.y)
      flushAnimationFrames()
      expect(root.dataset.motionState).toBe('gazing')
      act(() => target.dispatchEvent(new Event(eventName)))
      expectIdleReset(root)
    }
  })

  it('handles the already-zero return without transitionend and immediately restores idle ownership', () => {
    const addEventListenerSpy = vi.spyOn(HTMLElement.prototype, 'addEventListener')
    const { root } = renderHarness()
    addEventListenerSpy.mockClear()

    pointerMove(FAB_CENTER.x, FAB_CENTER.y)
    flushAnimationFrames()
    expect(root.dataset.motionState).toBe('hover')
    expectDynamicVars(root, { yaw: '0deg', pitch: '0deg', eyeX: '0px', eyeY: '0px' })

    act(() => window.dispatchEvent(new Event('blur')))

    expectIdleReset(root)
    expect(addEventListenerSpy.mock.calls.some(([name]) => name === 'transitionend')).toBe(false)
  })

  it('active=false cancels pending work, removes listeners, and resets before reactivation', () => {
    const { root, rerender } = renderHarness()

    pointerMove(FAB_CENTER.x + ROBOT_3D.radius, FAB_CENTER.y)
    flushAnimationFrames()
    pointerMove(FAB_CENTER.x + 100, FAB_CENTER.y)
    expect(animationFrames.size).toBe(1)

    rerender(<Harness active={false} />)
    expect(cancelAnimationFrame).toHaveBeenCalled()
    expect(animationFrames.size).toBe(0)
    expectIdleReset(root)

    requestAnimationFrame.mockClear()
    pointerMove(FAB_CENTER.x + 100, FAB_CENTER.y)
    expect(requestAnimationFrame).not.toHaveBeenCalled()

    rerender(<Harness active />)
    expectIdleReset(root)
  })

  it('unmount cancels rAF, removes listeners, and enforces the idle-reset invariant', () => {
    const { root, unmount } = renderHarness()

    pointerMove(FAB_CENTER.x + ROBOT_3D.radius, FAB_CENTER.y)
    flushAnimationFrames()
    pointerMove(FAB_CENTER.x + 100, FAB_CENTER.y)
    unmount()

    expect(cancelAnimationFrame).toHaveBeenCalled()
    expect(animationFrames.size).toBe(0)
    expectIdleReset(root)

    requestAnimationFrame.mockClear()
    pointerMove(FAB_CENTER.x + 100, FAB_CENTER.y)
    expect(requestAnimationFrame).not.toHaveBeenCalled()
  })

  it('mount-time reduced motion registers no pointer work and remains the highest-priority state', () => {
    window.matchMedia.mockReturnValue(matchMediaResult(true))
    const { root, rerender } = renderHarness()

    expect(root.dataset.motionState).toBe('reduced')
    pointerMove(FAB_CENTER.x + ROBOT_3D.radius, FAB_CENTER.y)
    expect(requestAnimationFrame).not.toHaveBeenCalled()
    expectDynamicVars(root, { yaw: '', pitch: '', eyeX: '', eyeY: '' })

    rerender(<Harness active={false} />)
    expectIdleReset(root)

    rerender(<Harness active />)
    expect(root.dataset.motionState).toBe('reduced')
  })
})

describe('RobotIcon motion CSS contract', () => {
  it('uses animation:none for gaze/hover ownership and consumes both head and eye vars with fallbacks', () => {
    expect(robotCss).not.toContain('animation-play-state')
    expect(robotCss).toMatch(/\[data-motion-state="gazing"\]\s*\{[^}]*animation:\s*none[^}]*rotateY\(var\(--robot-yaw, 0deg\)\) rotateX\(var\(--robot-pitch, 0deg\)\)/)
    expect(robotCss).toMatch(/\[data-motion-state="hover"\]\s*\{[^}]*animation:\s*none[^}]*rotateY\(0deg\) rotateX\(0deg\)/)
    for (const state of ['gazing', 'hover']) {
      const eyeRule = ruleBody(
        robotCss,
        `.robot-icon[data-motion-state="${state}"] .robot-icon-eyes`,
      )
      expect(eyeRule).toMatch(/animation:\s*none/)
      expect(eyeRule).toContain('translate(var(--eye-x, 0px), var(--eye-y, 0px))')
      expect(eyeRule).toMatch(/transition:\s*none/)
    }
  })

  // 머리에도 transition 금지가 필요하다. 없으면 base 의 320ms transition 이 살아나
  // 매 프레임의 var 쓰기를 재타게팅해 머리가 포인터 뒤에서 고무줄처럼 늘어진다.
  // 눈 쪽만 핀돼 있어 이 뮤턴트가 전 스위트를 초록으로 통과했다.
  it('forbids transition on the head while gazing or hovering, not just on the eyes', () => {
    for (const state of ['gazing', 'hover']) {
      expect(ruleBody(robotCss, `.robot-icon[data-motion-state="${state}"]`)).toMatch(
        /transition:\s*none/,
      )
    }
  })

  // 생산자(@keyframes)만 핀하면 소비 선언을 통째로 지워도 아무 테스트도 안 죽는다 —
  // idle 에서 로봇이 영원히 정지하는데 스위트는 초록. 소비자를 직접 핀한다.
  it('consumes the idle animations, not just declares their keyframes', () => {
    expect(ruleBody(robotCss, '.robot-icon')).toMatch(/animation:\s*robot-turn\s/)
    expect(ruleBody(robotCss, '.robot-icon .robot-icon-eyes')).toMatch(/animation:\s*robot-look\s/)
  })

  it('uses one return-duration var for head and eyes with delay and fill-mode none', () => {
    expect(robotCss.match(/animation-delay:\s*var\(--robot-return-duration\)/g)).toHaveLength(2)
    expect(robotCss.match(/animation-fill-mode:\s*none/g)).toHaveLength(2)
    expect(robotCss.match(/transition:\s*transform var\(--robot-return-duration\)/g)).toHaveLength(2)
    expect(robotCss).not.toContain('transitionend')
  })

  it('leaves robot-turn exclusively in ChatPanel.css with an identity 0% keyframe', () => {
    expect(robotCss).not.toContain('@keyframes robot-turn')
    expect(chatCss).toMatch(/@keyframes robot-turn\s*\{\s*0%, 100%\s*\{\s*transform:\s*rotateY\(0deg\) rotateX\(0deg\)/)
  })
})
