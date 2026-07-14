// @vitest-environment jsdom
//
// M2 — **승인 다이얼로그** (D14 `agent:permission-request` / `agent:permission-response`).
//
// 🔴 **사람이 무엇을 승인하는지 보여야 한다.** 툴 *이름*만 띄우면 —
//    `"generate_videos 를 승인할까요?"` — 영상이 2개인지 8개인지 모른 채 누른다. 그건 동의가 아니다.
//    (main 은 `argsHash` 로 "승인한 것"과 "실행되는 것"을 묶는다. 사람이 본 적 없는 값에 묶으면 소용없다.)
//
// 🔴 **닫기 = 거부.** 사용자가 X 를 누르거나 ESC 를 눌러도 **승인이 되면 안 된다.**
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, cleanup } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import ApprovalDialog from '../../../src/components/agent/ApprovalDialog.jsx'

let listeners, responses
beforeEach(() => {
  cleanup()
  listeners = []
  responses = []
  window.electronAPI = {
    onAgentPermissionRequest: (cb) => { listeners.push(cb); return () => { listeners = listeners.filter((l) => l !== cb) } },
    respondAgentPermission: (payload) => responses.push(payload),
  }
})

const fire = (over = {}) => listeners.forEach((cb) => cb({
  requestId: 'r1',
  tool: 'generate_videos',
  message: 'generate_videos\n\n{"items":[1,2]}',
  ...over,
}))

describe('승인 다이얼로그', () => {
  it('요청이 없으면 아무것도 안 보인다', () => {
    render(<ApprovalDialog />)
    expect(screen.queryByRole('dialog')).toBeNull()
  })

  it('🔴 요청이 오면 **툴 이름과 인자를 함께** 보여준다 (이름만 보고 누르면 동의가 아니다)', async () => {
    render(<ApprovalDialog />)
    fire()

    expect(await screen.findByRole('dialog')).toBeTruthy()
    expect(screen.getByText(/generate_videos/)).toBeTruthy()
    // 인자가 화면에 있어야 한다 — 사용자가 "영상 몇 개"를 볼 수 있어야 한다.
    expect(screen.getByText(/items/)).toBeTruthy()
  })

  it('승인하면 accept 를 같은 requestId 로 보낸다', async () => {
    const user = userEvent.setup()
    render(<ApprovalDialog />)
    fire()

    await user.click(await screen.findByRole('button', { name: /승인|allow|approve/i }))

    expect(responses).toEqual([{ requestId: 'r1', action: 'accept' }])
    expect(screen.queryByRole('dialog'), '응답 뒤에도 창이 떠 있다').toBeNull()
  })

  it('거부하면 decline', async () => {
    const user = userEvent.setup()
    render(<ApprovalDialog />)
    fire()

    await user.click(await screen.findByRole('button', { name: /거부|deny|decline/i }))

    expect(responses).toEqual([{ requestId: 'r1', action: 'decline' }])
  })

  it('🔴 **ESC 로 닫으면 거부다** — 닫았다고 승인이 될 수는 없다', async () => {
    const user = userEvent.setup()
    render(<ApprovalDialog />)
    fire()
    await screen.findByRole('dialog')

    await user.keyboard('{Escape}')

    expect(responses).toEqual([{ requestId: 'r1', action: 'decline' }])
  })

  it('🔴 **한 번만 응답한다** — 연타해도 두 번 보내지 않는다', async () => {
    const user = userEvent.setup()
    render(<ApprovalDialog />)
    fire()
    const allow = await screen.findByRole('button', { name: /승인|allow|approve/i })

    await user.click(allow)
    // 창이 닫혔으니 두 번째 클릭은 대상이 없다 — 그래도 응답은 정확히 1개여야 한다.
    expect(responses).toHaveLength(1)
  })

  it('🔴 승인 요청이 **여럿** 오면 하나씩 처리하고 서로 섞이지 않는다 (Codex 는 병렬로 쏜다)', async () => {
    const user = userEvent.setup()
    render(<ApprovalDialog />)
    fire({ requestId: 'r1', tool: 'story_confirm_synopsis', message: 'story_confirm_synopsis\n\n{}' })
    fire({ requestId: 'r2', tool: 'generate_videos', message: 'generate_videos\n\n{"items":[1]}' })

    // 첫 번째를 거부한다.
    await user.click(await screen.findByRole('button', { name: /거부|deny|decline/i }))
    expect(responses[0]).toEqual({ requestId: 'r1', action: 'decline' })

    // 그러면 두 번째가 뜬다 — 첫 응답이 두 번째까지 삼키면 안 된다.
    expect(await screen.findByText(/generate_videos/)).toBeTruthy()
    await user.click(screen.getByRole('button', { name: /승인|allow|approve/i }))
    expect(responses[1]).toEqual({ requestId: 'r2', action: 'accept' })
  })
})
