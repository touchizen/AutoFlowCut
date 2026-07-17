// @vitest-environment jsdom
import React, { useRef } from 'react'
import { existsSync, readFileSync } from 'node:fs'
import { cleanup, render } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import RobotIcon from '../../../src/components/agent/RobotIcon.jsx'
import { ROBOT_3D } from '../../../src/components/agent/robotConfig.js'

const SHELL_WITH_APERTURE = 'M25 17H39A12 12 0 0 1 51 29V39A12 12 0 0 1 39 51H25A12 12 0 0 1 13 39V29A12 12 0 0 1 25 17Z M25 21H39A8 8 0 0 1 47 29V35A8 8 0 0 1 39 43H25A8 8 0 0 1 17 35V29A8 8 0 0 1 25 21Z'
const css = readFileSync('src/components/agent/RobotIcon.css', 'utf8')
const parsedRules = [...css.matchAll(/([^{}]+)\{([^{}]*)\}/g)].map((match) => ({
  selectors: match[1].split(',').map((selector) => selector.trim()),
  body: match[2],
}))

function ruleBody(selector) {
  return parsedRules.find((rule) => rule.selectors.includes(selector))?.body || ''
}

function ruleBodies(selector) {
  return parsedRules.filter((rule) => rule.selectors.includes(selector)).map((rule) => rule.body)
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

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
})

describe('RobotIcon structure', () => {
  it('keeps a non-flattening 48px scene root under an inline calibrated perspective host', () => {
    vi.spyOn(window, 'matchMedia').mockReturnValue(matchMediaResult(false))
    const { container } = render(<Harness />)
    const host = container.querySelector('.agent-chat-fab')
    const root = container.querySelector('.robot-icon')
    const rootCss = ruleBody('.robot-icon')

    expect(host.style.perspective).toBe(`${ROBOT_3D.perspective}px`)
    expect(host.style.perspectiveOrigin).toBe(ROBOT_3D.perspectiveOrigin)
    expect(root.parentElement).toBe(host)
    expect(ruleBodies('.robot-icon')).toHaveLength(1)
    expect(rootCss).toMatch(/width:\s*48px/)
    expect(rootCss).toMatch(/height:\s*48px/)
    expect(rootCss).toMatch(/transform-style:\s*preserve-3d/)
    expect(rootCss).toMatch(/overflow:\s*visible/)
    expect(rootCss).not.toMatch(/overflow:\s*hidden/)
    expect(rootCss).not.toMatch(/(?:^|;)\s*(?:opacity|filter|clip-path|contain)\s*:/)
  })

  it('ports all six gradient definitions through a visible paint-server holder and uses each one', () => {
    vi.spyOn(window, 'matchMedia').mockReturnValue(matchMediaResult(false))
    const { container } = render(<Harness />)
    const definitions = container.querySelector('.robot-icon-definitions')
    const definitionsCss = ruleBody('.robot-icon-definitions')

    expect(definitionsCss).toMatch(/position:\s*absolute/)
    expect(definitionsCss).toMatch(/width:\s*0/)
    expect(definitionsCss).toMatch(/height:\s*0/)
    expect(definitionsCss).toMatch(/overflow:\s*hidden/)
    expect(definitionsCss).not.toMatch(/display:\s*none/)

    for (const id of ['shell', 'screen', 'glass', 'limb', 'eye', 'bulb']) {
      expect(definitions.querySelector(`#${id}`), `gradient #${id} definition`).toBeTruthy()
      expect(container.querySelector(`[fill="url(#${id})"], [stroke="url(#${id})"]`), `gradient #${id} use`)
        .toBeTruthy()
    }

    const gradientContract = {
      shell: {
        attrs: { x1: '16', y1: '16', x2: '50', y2: '52', gradientUnits: 'userSpaceOnUse' },
        stops: [['0', '#FFFFFF', null], ['0.55', '#EDF3FF', null], ['1', '#B9C6DE', null]],
      },
      screen: {
        attrs: { x1: '17', y1: '21', x2: '47', y2: '43', gradientUnits: 'userSpaceOnUse' },
        stops: [['0', '#243149', null], ['0.5', '#141C2C', null], ['1', '#0C1220', null]],
      },
      glass: {
        attrs: { x1: '17', y1: '21', x2: '17', y2: '34', gradientUnits: 'userSpaceOnUse' },
        stops: [['0', '#FFFFFF', '0.20'], ['1', '#FFFFFF', '0']],
      },
      limb: {
        attrs: { x1: '8', y1: '29', x2: '8', y2: '41', gradientUnits: 'userSpaceOnUse' },
        stops: [['0', '#F7FAFF', null], ['1', '#B9C6DE', null]],
      },
      eye: {
        attrs: { cx: '0.35', cy: '0.32', r: '0.8' },
        stops: [['0', '#DCEBFF', null], ['0.45', '#79B4FF', null], ['1', '#3D7FE0', null]],
      },
      bulb: {
        attrs: { cx: '0.35', cy: '0.3', r: '0.85' },
        stops: [['0', '#EAF3FF', null], ['0.5', '#79B4FF', null], ['1', '#3D7FE0', null]],
      },
    }
    for (const [id, contract] of Object.entries(gradientContract)) {
      const gradient = definitions.querySelector(`#${id}`)
      for (const [name, value] of Object.entries(contract.attrs)) {
        expect(gradient.getAttribute(name), `gradient #${id} ${name}`).toBe(value)
      }
      expect([...gradient.querySelectorAll('stop')].map((stop) => [
        stop.getAttribute('offset'),
        stop.getAttribute('stop-color'),
        stop.getAttribute('stop-opacity'),
      ])).toEqual(contract.stops)
    }
  })

  it('ports the aperture, layer order, eyes, and exact extrusion endpoints', () => {
    vi.spyOn(window, 'matchMedia').mockReturnValue(matchMediaResult(false))
    const { container } = render(<Harness />)
    const root = container.querySelector('.robot-icon')
    const layers = [...root.querySelectorAll(':scope > .robot-icon-layer')]
    const slices = [...root.querySelectorAll('.extrusion-slice')]

    expect(layers).toHaveLength(17)
    expect(layers.map((layer) => [...layer.classList].find((name) => name !== 'robot-icon-layer'))).toEqual([
      'layer-ground',
      'layer-limbs',
      ...Array(ROBOT_3D.slices).fill('extrusion-slice'),
      'shell-face',
      'screen-face',
      'face-details',
      'glass-highlight',
      'layer-bulb',
    ])
    expect(slices).toHaveLength(ROBOT_3D.slices)
    expect(slices[0].style.getPropertyValue('--slice-z')).toBe('0px')
    expect(slices.at(-1).style.getPropertyValue('--slice-z')).toBe(`${ROBOT_3D.depth}px`)
    expect([...root.querySelectorAll('[data-aperture="screen"] path')]).toHaveLength(ROBOT_3D.slices + 1)
    for (const path of root.querySelectorAll('[data-aperture="screen"] path')) {
      expect(path.getAttribute('d')).toBe(SHELL_WITH_APERTURE)
      expect(path.getAttribute('fill-rule')).toBe('evenodd')
      expect(path.getAttribute('clip-rule')).toBe('evenodd')
    }
    expect(root.querySelector('.robot-icon-eyes')).toBeTruthy()
    expect(root.querySelectorAll('.robot-icon-eye')).toHaveLength(2)
    expect(root.querySelector('style')).toBeNull()
  })

  it('keeps every static Z seam unitful, named depth ordering valid, and extrusion progressively lighter', () => {
    vi.spyOn(window, 'matchMedia').mockReturnValue(matchMediaResult(false))
    const { container } = render(<Harness />)
    const root = container.querySelector('.robot-icon')
    const zVars = {
      '--z-face': ROBOT_3D.zFace,
      '--z-glass': ROBOT_3D.zGlass,
      '--z-eyes': ROBOT_3D.zEyes,
      '--z-screen': ROBOT_3D.zScreen,
      '--z-limb': ROBOT_3D.zLimb,
      '--z-ground': ROBOT_3D.zGround,
    }

    for (const [name, value] of Object.entries(zVars)) {
      expect(root.style.getPropertyValue(name)).toBe(`${value}px`)
    }
    expect(ROBOT_3D.zScreen).toBeLessThan(ROBOT_3D.zEyes)
    expect(ROBOT_3D.zEyes).toBeLessThan(ROBOT_3D.zGlass)
    expect(ROBOT_3D.zGlass).toBeLessThan(ROBOT_3D.zFace)
    const layerConsumers = {
      '.robot-icon > .layer-ground': '--z-ground',
      '.robot-icon > .layer-limbs': '--z-limb',
      '.robot-icon > .extrusion-slice': '--slice-z',
      '.robot-icon > .shell-face': '--z-face',
      '.robot-icon > .screen-face': '--z-screen',
      '.robot-icon > .face-details': '--z-eyes',
      '.robot-icon > .glass-highlight': '--z-glass',
      '.robot-icon > .layer-bulb': '--z-limb',
    }
    for (const [selector, variable] of Object.entries(layerConsumers)) {
      expect(ruleBody(selector)).toMatch(new RegExp(`transform:\\s*translateZ\\(var\\(${variable}\\)\\)`))
    }

    const slices = [...root.querySelectorAll('.extrusion-slice')]
    const zValues = slices.map((slice) => Number.parseFloat(slice.style.getPropertyValue('--slice-z')))
    expect(zValues[0]).toBe(0)
    expect(zValues.at(-1)).toBe(ROBOT_3D.depth)
    expect(zValues.every((value, index) => index === 0 || value > zValues[index - 1])).toBe(true)
    expect(slices.every((slice) => /px$/.test(slice.style.getPropertyValue('--slice-z')))).toBe(true)

    const channels = slices.map((slice) => slice.querySelector('path').getAttribute('fill')
      .match(/[a-f\d]{2}/gi).map((part) => Number.parseInt(part, 16)))
    expect(channels.every((rgb, index) => index === 0 || rgb.every((channel, channelIndex) => (
      channel >= channels[index - 1][channelIndex]
    )))).toBe(true)

    const allZ = [
      ROBOT_3D.zGround,
      ROBOT_3D.zLimb,
      ...zValues,
      ROBOT_3D.zScreen,
      ROBOT_3D.zEyes,
      ROBOT_3D.zGlass,
      ROBOT_3D.zFace,
    ]
    expect(new Set(allZ).size).toBe(allZ.length)
  })

  it('uses the single motion-state owner for mount-time reduced motion', () => {
    vi.spyOn(window, 'matchMedia').mockReturnValue(matchMediaResult(true))
    const { container } = render(<Harness />)
    const root = container.querySelector('.robot-icon')

    expect(root.dataset.motionState).toBe('reduced')
    expect(ruleBody('.robot-icon[data-motion-state="reduced"]')).toMatch(/animation:\s*none/)
    for (const target of ['robot-icon-eyes', 'robot-icon-eye', 'robot-icon-bulb']) {
      expect(ruleBody(`.robot-icon[data-motion-state="reduced"] .${target}`)).toMatch(/animation:\s*none/)
    }
  })

  it('demolishes the flat asset and every late-cascade img/perspective rule', () => {
    const chatCss = readFileSync('src/components/agent/ChatPanel.css', 'utf8')

    expect(existsSync('src/assets/Robot.svg')).toBe(false)
    expect(chatCss).not.toMatch(/\.agent-chat-fab\s*\{[^}]*perspective:/)
    expect(chatCss).not.toContain('.agent-chat-fab img')
    expect(chatCss).not.toContain('.agent-chat-fab:hover img')
    expect(chatCss).toContain('@keyframes robot-turn')
  })
})
