/**
 * WelcomeScreen — BYOK 키 설정 진입.
 *
 * 회귀: 버튼 클릭 시 즉시 'waiting'(키 확인 중)으로 잠겨, 키 설정 모달을 취소해도
 * "키 확인 중..." 에 멈춰버렸다. 이제 클릭은 설정만 열고 폴링은 백그라운드 —
 * 화면은 버튼 그대로 남아야 한다.
 */
import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, screen, fireEvent, waitFor, cleanup } from '@testing-library/react'

vi.mock('../../src/hooks/useI18n', () => ({ useI18n: () => ({ t: (k) => k }) }))
vi.mock('/assets/icon128.png', () => ({ default: 'icon.png' }))

import WelcomeScreen from '../../src/components/WelcomeScreen'

afterEach(() => cleanup())

describe('WelcomeScreen — BYOK 키 설정', () => {
  it('키 없음 + 버튼 클릭: onSetupKey 호출, "키 확인 중"으로 안 잠김(취소해도 버튼 유지)', async () => {
    const getAccessToken = vi.fn().mockResolvedValue(null)
    const onSetupKey = vi.fn()
    render(<WelcomeScreen getAccessToken={getAccessToken} onSetupKey={onSetupKey} onReady={vi.fn()} />)

    const btn = await screen.findByText(/welcome\.openFlow/)
    fireEvent.click(btn)

    expect(onSetupKey).toHaveBeenCalled()
    // 'waiting' 잠금 없음 — waitingLogin 안 보이고 버튼 그대로
    expect(screen.queryByText(/welcome\.waitingLogin/)).toBeNull()
    expect(screen.getByText(/welcome\.openFlow/)).toBeTruthy()
  })

  it('키 있으면 자동 진입(onReady 호출)', async () => {
    const getAccessToken = vi.fn().mockResolvedValue('byok')
    const onReady = vi.fn()
    render(<WelcomeScreen getAccessToken={getAccessToken} onSetupKey={vi.fn()} onReady={onReady} />)
    await waitFor(() => expect(onReady).toHaveBeenCalled())
  })
})
