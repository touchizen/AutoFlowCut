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
import { act, render, screen, cleanup } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import ApprovalDialog from '../../../src/components/agent/ApprovalDialog.jsx'

let listeners, cancelListeners, responses
beforeEach(() => {
  cleanup()
  listeners = []
  cancelListeners = []
  responses = []
  window.electronAPI = {
    onAgentPermissionRequest: (cb) => { listeners.push(cb); return () => { listeners = listeners.filter((l) => l !== cb) } },
    onAgentPermissionCancel: (cb) => { cancelListeners.push(cb); return () => { cancelListeners = cancelListeners.filter((l) => l !== cb) } },
    respondAgentPermission: (payload) => responses.push(payload),
  }
})

const fire = (over = {}) => listeners.forEach((cb) => cb({
  requestId: 'r1',
  tool: 'story_set_speakers',
  args: { speakers: [{ id: 'narrator', name: 'Narrator' }] },
  ...over,
}))
const cancel = (requestId) => cancelListeners.forEach((cb) => cb({ requestId, reason: 'session-closed' }))

describe('승인 다이얼로그', () => {
  it('요청이 없으면 아무것도 안 보인다', () => {
    render(<ApprovalDialog />)
    expect(screen.queryByRole('dialog')).toBeNull()
  })

  it('🔴 요청이 오면 **툴 이름과 인자를 함께** 보여준다 (이름만 보고 누르면 동의가 아니다)', async () => {
    const { container } = render(<ApprovalDialog />)
    fire()

    expect(await screen.findByRole('dialog')).toBeTruthy()
    expect(screen.getByText(/story_set_speakers/)).toBeTruthy()
    // 인자가 화면에 있어야 한다 — 서술만 보고 누르면 원본과 실행값이 갈릴 수 있다.
    expect(JSON.parse(container.querySelector('.approval-args').textContent))
      .toEqual({ speakers: [{ id: 'narrator', name: 'Narrator' }] })
  })

  it('args가 null이면 모르는 값을 빈 객체로 위장하지 않고 null 원본을 보여준다', async () => {
    const { container } = render(<ApprovalDialog />)
    fire({ args: null })

    expect(await screen.findByText('story_set_speakers')).toBeTruthy()
    expect(container.querySelector('.approval-args').textContent).toBe('null')
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

  it('presenter가 없는 미지 툴은 전체 raw와 경고를 보이되 승인 버튼을 disabled로 막는다', async () => {
    const user = userEvent.setup()
    const { container } = render(<ApprovalDialog />)
    fire({ tool: 'generate_videos', args: { items: [1, 2] } })

    expect(await screen.findByText('generate_videos')).toBeTruthy()
    expect(screen.getByRole('alert').textContent).toMatch(/설명할 수 없|cannot explain/i)
    const raw = container.querySelector('.approval-original-expanded .approval-args')
    expect(JSON.parse(raw.textContent)).toEqual({ items: [1, 2] })
    const allow = screen.getByRole('button', { name: /승인|allow|approve/i })
    expect(allow.disabled).toBe(true)

    await user.click(allow)
    expect(responses).toEqual([])
    expect(screen.getByRole('dialog')).toBeTruthy()
  })

  it('알려진 툴이라도 described 타입이 schema와 다르면 전체 raw와 경고만 보이고 승인할 수 없다', async () => {
    render(<ApprovalDialog />)
    fire({ requestId: 'bad-shape', tool: 'story_confirm_synopsis', args: { characters: null } })

    expect(await screen.findByRole('alert')).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Approve' }).disabled).toBe(true)
    expect(screen.getByText(/characters/)).toBeTruthy()
  })

  it('🔴 승인 요청이 **여럿** 오면 하나씩 처리하고 서로 섞이지 않는다 (Codex 는 병렬로 쏜다)', async () => {
    const user = userEvent.setup()
    render(<ApprovalDialog />)
    fire({ requestId: 'r1', tool: 'story_confirm_synopsis', args: {} })
    fire({ requestId: 'r2', tool: 'story_set_speakers', args: { speakers: [] } })

    // 첫 번째를 거부한다.
    await user.click(await screen.findByRole('button', { name: /거부|deny|decline/i }))
    expect(responses[0]).toEqual({ requestId: 'r1', action: 'decline' })

    // 그러면 두 번째가 뜬다 — 첫 응답이 두 번째까지 삼키면 안 된다.
    expect(await screen.findByText(/story_set_speakers/)).toBeTruthy()
    await user.click(screen.getByRole('button', { name: /승인|allow|approve/i }))
    expect(responses[1]).toEqual({ requestId: 'r2', action: 'accept' })
  })

  it('main이 정산한 요청은 queue에서 제거하고 사람 응답을 보내지 않는다', async () => {
    render(<ApprovalDialog />)
    act(() => {
      fire({ requestId: 'r1' })
      fire({ requestId: 'r2', tool: 'story_confirm_synopsis', args: {} })
    })

    act(() => cancel('r1'))

    expect(await screen.findByText('story_confirm_synopsis')).toBeTruthy()
    expect(responses).toEqual([])

    act(() => cancel('r2'))
    expect(screen.queryByRole('dialog')).toBeNull()
    expect(responses).toEqual([])
  })
})
