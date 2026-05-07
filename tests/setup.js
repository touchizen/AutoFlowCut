/**
 * Vitest 테스트 설정 (Desktop)
 */
import { expect, afterEach, vi } from 'vitest'
import { cleanup } from '@testing-library/react'
import * as matchers from '@testing-library/jest-dom/matchers'

// jest-dom matchers 확장
expect.extend(matchers)

// 각 테스트 후 cleanup — node-env 테스트는 DOM/localStorage 없음.
afterEach(() => {
  if (typeof document !== 'undefined') cleanup()
  vi.clearAllMocks()
  if (typeof localStorage !== 'undefined') localStorage.clear()
})

// Electron API 모킹
import './mocks/electronAPI.js'
