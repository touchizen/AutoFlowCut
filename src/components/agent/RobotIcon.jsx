import { useEffect, useLayoutEffect, useRef } from 'react'
import { ROBOT_3D } from './robotConfig.js'
import { computeRobotGaze } from './robotGaze.js'
import './RobotIcon.css'

const SHELL_WITH_APERTURE = 'M25 17H39A12 12 0 0 1 51 29V39A12 12 0 0 1 39 51H25A12 12 0 0 1 13 39V29A12 12 0 0 1 25 17Z M25 21H39A8 8 0 0 1 47 29V35A8 8 0 0 1 39 43H25A8 8 0 0 1 17 35V29A8 8 0 0 1 25 21Z'
const DYNAMIC_VARS = ['--robot-yaw', '--robot-pitch', '--eye-x', '--eye-y']

function resetMotion(root, state = 'idle') {
  root.dataset.motionState = state
  for (const property of DYNAMIC_VARS) root.style.removeProperty(property)
}

function mixHex(from, to, amount) {
  const start = from.match(/[a-f\d]{2}/gi).map((part) => Number.parseInt(part, 16))
  const end = to.match(/[a-f\d]{2}/gi).map((part) => Number.parseInt(part, 16))
  return `#${start.map((channel, index) => {
    const value = Math.round(channel + (end[index] - channel) * amount)
    return value.toString(16).padStart(2, '0')
  }).join('')}`
}

function GradientDefinitions() {
  return (
    <svg className="robot-icon-definitions" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
      <defs>
        <linearGradient id="shell" x1="16" y1="16" x2="50" y2="52" gradientUnits="userSpaceOnUse">
          <stop offset="0" stopColor="#FFFFFF" />
          <stop offset="0.55" stopColor="#EDF3FF" />
          <stop offset="1" stopColor="#B9C6DE" />
        </linearGradient>
        <linearGradient id="screen" x1="17" y1="21" x2="47" y2="43" gradientUnits="userSpaceOnUse">
          <stop offset="0" stopColor="#243149" />
          <stop offset="0.5" stopColor="#141C2C" />
          <stop offset="1" stopColor="#0C1220" />
        </linearGradient>
        <linearGradient id="glass" x1="17" y1="21" x2="17" y2="34" gradientUnits="userSpaceOnUse">
          <stop offset="0" stopColor="#FFFFFF" stopOpacity="0.20" />
          <stop offset="1" stopColor="#FFFFFF" stopOpacity="0" />
        </linearGradient>
        <linearGradient id="limb" x1="8" y1="29" x2="8" y2="41" gradientUnits="userSpaceOnUse">
          <stop offset="0" stopColor="#F7FAFF" />
          <stop offset="1" stopColor="#B9C6DE" />
        </linearGradient>
        <radialGradient id="eye" cx="0.35" cy="0.32" r="0.8">
          <stop offset="0" stopColor="#DCEBFF" />
          <stop offset="0.45" stopColor="#79B4FF" />
          <stop offset="1" stopColor="#3D7FE0" />
        </radialGradient>
        <radialGradient id="bulb" cx="0.35" cy="0.3" r="0.85">
          <stop offset="0" stopColor="#EAF3FF" />
          <stop offset="0.5" stopColor="#79B4FF" />
          <stop offset="1" stopColor="#3D7FE0" />
        </radialGradient>
      </defs>
    </svg>
  )
}

function ExtrusionSlices() {
  return Array.from({ length: ROBOT_3D.slices }, (_, index) => {
    const ratio = index / (ROBOT_3D.slices - 1)
    const z = ROBOT_3D.depth * ratio
    const fill = mixHex('#5A6A85', '#B9C6DE', ratio)
    return (
      <svg
        key={index}
        className="robot-icon-layer extrusion-slice"
        viewBox="0 0 64 64"
        fill="none"
        data-aperture="screen"
        style={{ '--slice-z': `${z}px` }}
        aria-hidden="true"
      >
        <path d={SHELL_WITH_APERTURE} fill={fill} fillRule="evenodd" clipRule="evenodd" />
      </svg>
    )
  })
}

export default function RobotIcon({ active = true, hostRef }) {
  const rootRef = useRef(null)
  const reducedMotionRef = useRef(
    typeof window !== 'undefined' && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches,
  )

  useLayoutEffect(() => {
    const host = hostRef?.current || rootRef.current?.parentElement
    if (!host) return
    host.style.perspective = `${ROBOT_3D.perspective}px`
    host.style.perspectiveOrigin = ROBOT_3D.perspectiveOrigin
  }, [hostRef])

  useEffect(() => {
    const root = rootRef.current
    const host = hostRef?.current || root?.parentElement
    if (!root) return undefined

    const reducedMotion = reducedMotionRef.current
    resetMotion(root)

    if (!active || !host) {
      return () => resetMotion(root)
    }

    if (reducedMotion) {
      resetMotion(root, 'reduced')
      return () => resetMotion(root)
    }

    let frameId = 0
    let latestPointer = null

    const cancelPendingFrame = () => {
      if (!frameId) return
      window.cancelAnimationFrame(frameId)
      frameId = 0
    }

    const deactivate = () => {
      latestPointer = null
      cancelPendingFrame()
      resetMotion(root)
    }

    const renderGaze = () => {
      frameId = 0
      if (!latestPointer) {
        resetMotion(root)
        return
      }

      const bounds = host.getBoundingClientRect()
      const fabCenter = {
        x: bounds.left + bounds.width / 2,
        y: bounds.top + bounds.height / 2,
      }
      const gaze = computeRobotGaze({
        fabCenter,
        pointer: latestPointer,
        radius: ROBOT_3D.radius,
        maxYaw: ROBOT_3D.maxYaw,
        maxPitch: ROBOT_3D.maxPitch,
        maxEye: ROBOT_3D.maxEye,
      })

      if (!gaze.engaged) {
        resetMotion(root)
        return
      }

      root.style.setProperty('--robot-yaw', `${gaze.yaw}deg`)
      root.style.setProperty('--robot-pitch', `${gaze.pitch}deg`)
      root.style.setProperty('--eye-x', `${gaze.eyeX}px`)
      root.style.setProperty('--eye-y', `${gaze.eyeY}px`)

      const hoverRadius = Math.min(bounds.width, bounds.height) / 2
      const hoverDistance = Math.hypot(
        latestPointer.x - fabCenter.x,
        latestPointer.y - fabCenter.y,
      )
      root.dataset.motionState = hoverDistance <= hoverRadius ? 'hover' : 'gazing'
    }

    const onPointerMove = (event) => {
      latestPointer = { x: event.clientX, y: event.clientY }
      if (!frameId) frameId = window.requestAnimationFrame(renderGaze)
    }

    window.addEventListener('pointermove', onPointerMove, { passive: true })
    window.addEventListener('blur', deactivate)
    document.addEventListener('pointerleave', deactivate)

    return () => {
      window.removeEventListener('pointermove', onPointerMove)
      window.removeEventListener('blur', deactivate)
      document.removeEventListener('pointerleave', deactivate)
      deactivate()
    }
  }, [active, hostRef])

  const rootStyle = {
    '--z-face': `${ROBOT_3D.zFace}px`,
    '--z-glass': `${ROBOT_3D.zGlass}px`,
    '--z-eyes': `${ROBOT_3D.zEyes}px`,
    '--z-screen': `${ROBOT_3D.zScreen}px`,
    '--z-limb': `${ROBOT_3D.zLimb}px`,
    '--z-ground': `${ROBOT_3D.zGround}px`,
  }

  return (
    <>
      <GradientDefinitions />
      <span
        ref={rootRef}
        className="robot-icon"
        data-motion-state={active && reducedMotionRef.current ? 'reduced' : 'idle'}
        data-active={active ? 'true' : 'false'}
        style={rootStyle}
        aria-hidden="true"
      >
        <svg className="robot-icon-layer layer-ground" viewBox="0 0 64 64" fill="none" aria-hidden="true">
          <ellipse cx="32" cy="49.5" rx="15" ry="2.2" fill="#8797B4" opacity="0.35" />
        </svg>
        <svg className="robot-icon-layer layer-limbs" viewBox="0 0 64 64" fill="none" aria-hidden="true">
          <path d="M13 29H8v12h5M51 29h5v12h-5" stroke="url(#limb)" strokeWidth="4" strokeLinejoin="round" />
          <path d="M32 17V10" stroke="url(#limb)" strokeWidth="4" strokeLinecap="round" />
        </svg>
        <ExtrusionSlices />
        <svg className="robot-icon-layer shell-face" viewBox="0 0 64 64" fill="none" data-aperture="screen" aria-hidden="true">
          <path d={SHELL_WITH_APERTURE} fill="url(#shell)" fillRule="evenodd" clipRule="evenodd" />
        </svg>
        <svg className="robot-icon-layer screen-face" viewBox="0 0 64 64" fill="none" aria-hidden="true">
          <rect x="17" y="21" width="30" height="22" rx="8" fill="url(#screen)" />
        </svg>
        <svg className="robot-icon-layer face-details" viewBox="0 0 64 64" fill="none" aria-hidden="true">
          <g className="robot-icon-eyes">
            <circle className="robot-icon-eye" cx="26" cy="32" r="4" fill="url(#eye)" />
            <circle className="robot-icon-eye" cx="38" cy="32" r="4" fill="url(#eye)" />
          </g>
          <path d="M25 40c2.2 1.8 4.5 2.7 7 2.7s4.8-.9 7-2.7" stroke="#79B4FF" strokeWidth="2.5" strokeLinecap="round" />
        </svg>
        <svg className="robot-icon-layer glass-highlight" viewBox="0 0 64 64" fill="none" aria-hidden="true">
          <rect x="17" y="21" width="30" height="13" rx="8" fill="url(#glass)" />
        </svg>
        <svg className="robot-icon-layer layer-bulb" viewBox="0 0 64 64" fill="none" aria-hidden="true">
          <circle className="robot-icon-bulb" cx="32" cy="8" r="4" fill="url(#bulb)" />
        </svg>
      </span>
    </>
  )
}
