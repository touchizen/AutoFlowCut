// @vitest-environment jsdom
import React from 'react'
import { EventEmitter } from 'node:events'
import { act, cleanup, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { createAdapterHandlers } from '../../../electron/agent/codexMcpAdapter.js'
import { decodeApprovalPayload, encodeApprovalPayload } from '../../../electron/agent/approvalPayload.js'
import { createElicitationResponder } from '../../../electron/agent/elicitationResponder.js'
import { createApprovalPrompt } from '../../../electron/agent/approvalPrompt.js'
import { createGrantLedger, hashArgs } from '../../../electron/agent/grantLedger.js'
import { createToolCore } from '../../../electron/agent/toolCore.js'
import ApprovalDialog from '../../../src/components/agent/ApprovalDialog.jsx'
import { __resetFlowHiddenForTests } from '../../../src/hooks/useModalVisibility.js'

const SERVER_NAME = 'autoflowcut'
const SESSION_ID = 'session-1'
const PROJECT_TOKEN = 'project-a'

let closeHarness = () => {}

afterEach(() => {
  closeHarness()
  closeHarness = () => {}
  cleanup()
  __resetFlowHiddenForTests()
  delete window.electronAPI
})

function createHarness({ transformMessage = (message) => message } = {}) {
  const permissionListeners = new Set()
  const cancelListeners = new Set()
  const permissionRequests = []

  const win = new EventEmitter()
  const webContents = new EventEmitter()
  win.isDestroyed = () => false
  webContents.send = (channel, payload) => {
    if (channel === 'agent:permission-request') {
      permissionRequests.push(payload)
      for (const listener of [...permissionListeners]) listener(payload)
    }
    if (channel === 'agent:permission-cancel') {
      for (const listener of [...cancelListeners]) listener(payload)
    }
  }
  win.webContents = webContents

  const prompt = createApprovalPrompt({ getWindow: () => win, timeoutMs: 60_000 })
  window.electronAPI = {
    onAgentPermissionRequest: (cb) => {
      permissionListeners.add(cb)
      return () => permissionListeners.delete(cb)
    },
    onAgentPermissionCancel: (cb) => {
      cancelListeners.add(cb)
      return () => cancelListeners.delete(cb)
    },
    respondAgentPermission: (payload) => prompt.respond(payload),
    setModalVisible: vi.fn(),
  }

  const commands = {
    projectToken: PROJECT_TOKEN,
    hasProject: () => true,
    confirmSynopsis: vi.fn(async (args) => ({ savedSynopsis: args.synopsisMd.length })),
    setSpeakers: vi.fn(async (args) => ({ savedSpeakers: args.speakers.length })),
    start: vi.fn(async (step, params) => ({ started: step, params })),
  }
  const ledger = createGrantLedger({ now: () => 0, ttlMs: 60_000 })
  const grant = vi.spyOn(ledger, 'grant')
  const toolCore = createToolCore({
    grantLedger: ledger,
    sessionId: SESSION_ID,
    projectToken: PROJECT_TOKEN,
  })
  toolCore.use(commands)

  const askUser = vi.fn((params, ctx) => prompt.ask(params, ctx))
  const responder = createElicitationResponder({
    grantLedger: ledger,
    sessionId: SESSION_ID,
    projectToken: PROJECT_TOKEN,
    adapterServerName: SERVER_NAME,
    askUser,
  })
  let requestId = 0
  const elicitInput = vi.fn((params) => responder.handle({
    ...params,
    serverName: SERVER_NAME,
    message: transformMessage(params.message),
  }, { requestId: ++requestId, turnId: null }))
  const rpc = {
    call: vi.fn(({ tool, args, nonce }) => toolCore.call(tool, args, { nonce })),
  }
  let nonce = 0
  const adapter = createAdapterHandlers({
    tools: toolCore.list(),
    rpc,
    elicitInput,
    approvalTimeoutMs: 60_000,
    newNonce: () => `nonce-${++nonce}`,
  })

  render(<ApprovalDialog />)
  closeHarness = () => prompt.close()
  return { adapter, askUser, commands, elicitInput, grant, permissionRequests, rpc }
}

function startToolCall(adapter, tool, args) {
  let result
  act(() => { result = adapter.callTool(tool, args) })
  return result
}

describe('인앱 에이전트 승인 경로 — 실제 제품 배선', () => {
  it('화자 인자를 화면에 보여주고 승인한 동일 인자를 ledger와 Tool Core까지 보낸다', async () => {
    const user = userEvent.setup()
    const { adapter, commands, grant, rpc } = createHarness()
    const args = {
      speakers: [{ id: 'narrator', name: '나레이션', voice: { provider: 'elevenlabs', voiceId: 'voice-1' } }],
    }

    const resultPromise = startToolCall(adapter, 'story_set_speakers', args)
    const dialog = await screen.findByRole('dialog')
    expect(dialog.textContent).toContain('나레이션')

    const raw = dialog.querySelector('.approval-args').textContent
    const displayedArgs = JSON.parse(raw)
    expect(displayedArgs).toEqual(args)

    await user.click(screen.getByRole('button', { name: /승인|allow|approve/i }))

    await expect(resultPromise).resolves.toEqual({ status: 'done', savedSpeakers: 1 })
    expect(commands.setSpeakers).toHaveBeenCalledOnce()
    expect(commands.setSpeakers).toHaveBeenCalledWith(args)
    expect(rpc.call).toHaveBeenCalledOnce()
    expect(grant).toHaveBeenCalledOnce()
    // 사람이 화면에서 읽은 구조화 값과 ledger가 서명한 값이 같은지 직접 증명한다.
    expect(hashArgs(displayedArgs)).toBe(grant.mock.calls[0][0].argsHash)
  })

  it('5000자 synopsis를 끝까지 보여주고 승인 뒤 실행한다', async () => {
    const user = userEvent.setup()
    const { adapter, commands } = createHarness()
    const synopsisMd = `BEGIN-${'긴'.repeat(5000)}-END`
    const args = { synopsisMd, characters: [{ name: '김철수' }] }

    const resultPromise = startToolCall(adapter, 'story_confirm_synopsis', args)
    const raw = (await screen.findByRole('dialog')).querySelector('.approval-args').textContent
    const displayedArgs = JSON.parse(raw)

    expect(displayedArgs).toEqual(args)
    expect(displayedArgs.synopsisMd).toHaveLength(synopsisMd.length)
    expect(displayedArgs.synopsisMd).toContain('-END')

    await user.click(screen.getByRole('button', { name: /승인|allow|approve/i }))
    await expect(resultPromise).resolves.toEqual({ status: 'done', savedSynopsis: synopsisMd.length })
    expect(commands.confirmSynopsis).toHaveBeenCalledWith(args)
  })

  it('audio regenerate의 비용·강제/조건부 재합성을 실제 경로로 보여주고 화면의 동일 args를 실행한다', async () => {
    const user = userEvent.setup()
    const { adapter, commands, grant, rpc } = createHarness()
    const args = { step: 'audio', params: { regenerate: ['seg-1', 'seg-2'] } }

    const resultPromise = startToolCall(adapter, 'story_start_step', args)
    const dialog = await screen.findByRole('dialog')
    const description = dialog.querySelector('.approval-description').textContent
    expect(description).toMatch(/cost/i)
    expect(description).toMatch(/force resynthesis/i)
    expect(description).toContain('seg-1')
    expect(description).toContain('seg-2')
    expect(description).toMatch(/otherwise they are synthesized too/i)
    expect(description).toMatch(/downstream steps \(Prompts\).*reset/i)
    expect(description).not.toMatch(/only (those|these)/i)

    const displayedArgs = JSON.parse(dialog.querySelector('.approval-args').textContent)
    expect(displayedArgs).toEqual(args)
    await user.click(screen.getByRole('button', { name: /승인|allow|approve/i }))

    await expect(resultPromise).resolves.toEqual({ status: 'done', started: 'audio', params: args.params })
    expect(commands.start).toHaveBeenCalledWith('audio', args.params)
    expect(rpc.call).toHaveBeenCalledOnce()
    expect(rpc.call.mock.calls[0][0].args).toEqual(displayedArgs)
    expect(hashArgs(displayedArgs)).toBe(grant.mock.calls[0][0].argsHash)
  })

  it('거부하면 grant와 Tool Core 실행이 모두 0회다', async () => {
    const user = userEvent.setup()
    const { adapter, commands, grant, rpc } = createHarness()
    const args = { speakers: [{ id: 'narrator', name: '거부할 화자' }] }

    const resultPromise = startToolCall(adapter, 'story_set_speakers', args)
    await user.click(await screen.findByRole('button', { name: /거부|deny|decline/i }))

    await expect(resultPromise).resolves.toEqual({ status: 'rejected', reason: 'declined-by-user' })
    expect(grant).not.toHaveBeenCalled()
    expect(rpc.call).not.toHaveBeenCalled()
    expect(commands.setSpeakers).not.toHaveBeenCalled()
  })

  it('message의 args만 바꿔치기하면 승인창 없이 rejected로 닫힌다', async () => {
    const original = { synopsisMd: '원본', characters: [] }
    const tampered = { synopsisMd: '변조', characters: [] }
    const harness = createHarness({
      transformMessage: (message) => {
        const decoded = decodeApprovalPayload(message)
        return encodeApprovalPayload(decoded.tool, tampered)
      },
    })

    const resultPromise = startToolCall(harness.adapter, 'story_confirm_synopsis', original)
    await act(async () => { await Promise.resolve() })

    expect(screen.queryByRole('dialog'), '변조된 값을 사람에게 묻는 창이 떴다').toBeNull()
    expect(harness.permissionRequests, 'ApprovalDialog로 요청이 흘렀다').toHaveLength(0)
    expect(harness.askUser, 'hash가 다른데 사람에게 물었다').not.toHaveBeenCalled()
    expect(harness.grant, '검증 실패인데 grant를 만들었다').not.toHaveBeenCalled()
    expect(harness.rpc.call, '검증 실패인데 Tool Core로 갔다').not.toHaveBeenCalled()
    expect(harness.commands.confirmSynopsis).not.toHaveBeenCalled()
    await expect(resultPromise).resolves.toEqual({ status: 'rejected', reason: 'declined-by-user' })
  })
})
