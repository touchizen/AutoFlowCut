/**
 * ExportModal — pending 포함/배제 3버튼 모달과 시도 상태기계 (스펙 v9 §4.3 / §7.3-a(b) / §7.4)
 *
 * 하드 제약: useExport 의 어떤 핸들러도 사용자 입력을 기다리면 안 된다 —
 * handleExportConfirm 은 MCP 진입점이기도 해서 거기서 모달을 await 하면
 * /api/export-capcut 이 영원히 응답하지 않는다. 그래서 분류와 모달은 이 컴포넌트가
 * 소유하고, includePending 은 오직 데이터로만 핸들러에 전달된다.
 *
 * 모달은 unmount 되지 않고 `if (!isOpen) return null` 일 뿐이라 state 가 살아남고,
 * preflight 가 전부 비동기라 그 사이에 닫히거나 다시 열릴 수 있다.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, cleanup, act } from '@testing-library/react'

vi.mock('../../src/contexts/AuthContext', () => ({
  useAuth: () => ({ isAuthenticated: true, subscription: { status: 'active', canExport: true } })
}))
const saveSettings = vi.fn()
vi.mock('../../src/hooks/useExportSettings', () => ({
  useExportSettings: () => ({ settings: {}, isLoaded: true, saveSettings })
}))
vi.mock('../../src/hooks/useModalVisibility', () => ({ useModalVisibility: () => {} }))
vi.mock('../../src/hooks/useFileSystem', () => ({
  fileSystemAPI: { ensurePermission: vi.fn().mockResolvedValue({ hasPermission: true }) }
}))
vi.mock('../../src/hooks/useI18n', () => ({
  useI18n: () => ({
    // 실제 문구 대신 키+보간을 그대로 뱉어 "어느 카운트를 썼는가"를 관찰한다.
    t: (k, vars) => (vars ? `${k}|${JSON.stringify(vars)}` : k),
    lang: 'ko'
  })
}))

import { ExportModal } from '../../src/components/ExportModal'

const onExport = vi.fn()
const onExportPremiere = vi.fn()
const onExportVrew = vi.fn()
const onClose = vi.fn()

const baseProps = () => ({
  isOpen: true, onClose,
  onExport, onExportPremiere, onExportVrew,
  initialFormat: 'capcut',
  projectName: 'P',
  loading: false, exportPhase: null, hasSubtitles: true,
  onUpgradeClick: vi.fn(),
  totalSceneCount: 7, readyCount: 2, pendingWithImageCount: 3,
})

/** 설치확인 promise 를 손으로 붙잡는다. */
function deferred() {
  let resolve, reject
  const promise = new Promise((res, rej) => { resolve = res; reject = rej })
  return { promise, resolve, reject }
}

beforeEach(() => {
  vi.clearAllMocks()
  window.electronAPI = {
    // CapCut 경로가 비면 preflight 가 pathRequired alert 에서 빠진다 — 자동 감지를 채워준다.
    getSystemInfo: vi.fn().mockResolvedValue({ success: true, username: 'u', platform: 'darwin' }),
    detectCapcutPath: vi.fn().mockResolvedValue({ success: true, basePath: '/drafts' }),
    getNextProjectNumber: vi.fn().mockResolvedValue({ success: true, folderName: '1400' }),
    checkCapcutInstalled: vi.fn().mockResolvedValue({ installed: true }),
    checkPremiereInstalled: vi.fn().mockResolvedValue({ installed: true }),
    checkVrewInstalled: vi.fn().mockResolvedValue({ installed: true }),
    checkFolderExists: vi.fn().mockResolvedValue({ exists: false }),
    openExternal: vi.fn(),
  }
  localStorage.setItem('workFolderPath', '/work')
})
afterEach(cleanup)

// autoDetect 가 비동기라 렌더 직후엔 CapCut 경로가 아직 비어 있다 — 정착시킨다.
const renderModal = async (props) => {
  const utils = render(<ExportModal {...props} />)
  await act(async () => { await Promise.resolve(); await Promise.resolve(); await Promise.resolve() })
  return utils
}

const clickExport = async () => {
  await act(async () => { fireEvent.click(screen.getByText(/exportModal\.export$/)) })
}
const modalShown = () => screen.queryByRole('dialog') !== null
// 취소 버튼이 둘이다(본체 footer + 3버튼 모달) — 모달 안쪽만 고른다.
const choiceCancel = () =>
  screen.getByRole('dialog').querySelector('.export-btn-cancel')

describe('ExportModal — 게이트 (§7.3-a(b))', () => {
  it('pending 이 있으면 3버튼 모달이 뜨고 콜백은 아직 안 불린다', async () => {
    await renderModal(baseProps())

    await clickExport()

    expect(modalShown()).toBe(true)
    expect(onExport).not.toHaveBeenCalled()
  })

  it('pending 0 이면 모달 없이 즉시 발사한다 (종전 흐름)', async () => {
    await renderModal({ ...baseProps(), pendingWithImageCount: 0 })

    await clickExport()

    expect(modalShown()).toBe(false)
    expect(onExport).toHaveBeenCalledWith(expect.objectContaining({ includePending: false }))
  })

  it('Vrew 탭에서는 pending 이 있어도 모달이 안 뜬다 (§3.4 스코프 컷)', async () => {
    await renderModal({ ...baseProps(), initialFormat: 'vrew' })

    await clickExport()

    expect(modalShown()).toBe(false)
    expect(onExportVrew).toHaveBeenCalledWith(expect.objectContaining({ includePending: false }))
  })
})

describe('ExportModal — 문구가 어느 카운트를 쓰는가', () => {
  it('total 은 totalSceneCount, pending 은 pendingWithImageCount 다', async () => {
    // ready(2) + pending(3) = 5 ≠ total(7) — 금지된 식이 여기서 갈린다.
    await renderModal(baseProps())

    await clickExport()

    const msg = screen.getByText(/pendingChoiceMessage/)
    expect(msg.textContent).toContain('"total":7')
    expect(msg.textContent).toContain('"pending":3')
    expect(msg.textContent).not.toContain('"total":5')
  })

  it('로케일 플레이스홀더가 컴포넌트가 넘기는 이름과 맞는다', async () => {
    // i18n 을 mock 해서 vars 를 관찰하므로, ko.js 의 `{total}` 이 `{count}` 로
    // 개명되면 화면에 리터럴 중괄호가 나가는데 다른 테스트는 아무것도 안 죽는다.
    const ko = (await import('../../src/locales/ko.js')).default
    const en = (await import('../../src/locales/en.js')).default
    for (const m of [ko, en]) {
      expect(m.exportModal.pendingChoiceMessage).toContain('{total}')
      expect(m.exportModal.pendingChoiceMessage).toContain('{pending}')
    }
  })

  it('문구 키가 로케일에 실재한다 (raw key 노출 금지)', async () => {
    const ko = await import('../../src/locales/ko.js')
    const en = await import('../../src/locales/en.js')
    for (const mod of [ko, en]) {
      const m = mod.default || mod
      const em = m.exportModal
      for (const k of ['pendingChoiceMessage', 'pendingChoiceCaveat', 'pendingChoiceInclude', 'pendingChoiceExclude']) {
        expect(typeof em[k]).toBe('string')
        expect(em[k].length).toBeGreaterThan(0)
      }
    }
  })
})

describe('ExportModal — 3버튼 동작', () => {
  it('포함 → includePending:true', async () => {
    await renderModal(baseProps())
    await clickExport()

    await act(async () => { fireEvent.click(screen.getByText('exportModal.pendingChoiceInclude')) })

    expect(onExport).toHaveBeenCalledWith(expect.objectContaining({ includePending: true }))
    expect(modalShown()).toBe(false)
  })

  it('배제 → includePending:false', async () => {
    await renderModal(baseProps())
    await clickExport()

    await act(async () => { fireEvent.click(screen.getByText('exportModal.pendingChoiceExclude')) })

    expect(onExport).toHaveBeenCalledWith(expect.objectContaining({ includePending: false }))
  })

  it('취소 → 어떤 콜백도 안 불리고 ExportModal 은 열린 채', async () => {
    await renderModal(baseProps())
    await clickExport()

    await act(async () => { fireEvent.click(choiceCancel()) })

    expect(onExport).not.toHaveBeenCalled()
    expect(onClose).not.toHaveBeenCalled()
    expect(modalShown()).toBe(false)
    expect(screen.getByText(/exportModal\.export$/)).toBeTruthy()   // 본체는 살아있다
  })

  it('취소하면 설정을 저장하지 않는다 (발사 직전에만 저장)', async () => {
    await renderModal(baseProps())
    await clickExport()
    await act(async () => { fireEvent.click(choiceCancel()) })
    expect(saveSettings).not.toHaveBeenCalled()

    await clickExport()
    await act(async () => { fireEvent.click(screen.getByText('exportModal.pendingChoiceInclude')) })
    expect(saveSettings).toHaveBeenCalled()
  })

  it('고른 뒤 포맷이 바뀌어도 고를 때의 포맷으로 발사된다', async () => {
    // pendingChoice.kind 대신 live format 을 읽으면 여기서 갈린다. 탭은 choosing
    // 중에 잠기지만, 잠금이 약해지는 회귀와 독립적으로 kind 를 고정해야 한다.
    const props = { ...baseProps(), initialFormat: 'premiere' }
    const { rerender } = await renderModal(props)
    await clickExport()

    // 진입 포맷이 바뀌면서 리렌더 — 모달이 열린 채라 format state 는 유지되지만,
    // 구현이 live format 을 읽는다면 이 리렌더가 그것을 바꿀 수 있다.
    await act(async () => { rerender(<ExportModal {...props} initialFormat="capcut" />) })
    await act(async () => { fireEvent.click(screen.getByText('exportModal.pendingChoiceInclude')) })

    expect(onExportPremiere).toHaveBeenCalled()
    expect(onExport).not.toHaveBeenCalled()
  })

  it('포맷 전환: 모달 안에서 프리미어로 바꾸면 프리미어 콜백이 불린다', async () => {
    await renderModal(baseProps())

    await act(async () => { fireEvent.click(screen.getByText(/Premiere/)) })
    await clickExport()
    await act(async () => { fireEvent.click(screen.getByText('exportModal.pendingChoiceInclude')) })

    expect(onExportPremiere).toHaveBeenCalledWith(expect.objectContaining({ includePending: true }))
    expect(onExport).not.toHaveBeenCalled()
  })
})

describe('ExportModal — 잠금', () => {
  it('choosing 동안 Export 버튼과 포맷 탭이 disabled 다', async () => {
    await renderModal(baseProps())
    await clickExport()

    expect(screen.getByText(/exportModal\.export$/).closest('button').disabled).toBe(true)
    expect(screen.getByText(/Premiere/).closest('button').disabled).toBe(true)
  })

  it('preflight 중에도 포맷 탭이 잠긴다 — 보이는 포맷과 발사되는 포맷이 갈리면 안 된다', async () => {
    const d = deferred()
    window.electronAPI.checkPremiereInstalled = vi.fn().mockReturnValue(d.promise)
    await renderModal({ ...baseProps(), initialFormat: 'premiere' })

    await act(async () => { fireEvent.click(screen.getByText(/exportModal\.export$/)) })
    expect(screen.getByText(/Vrew/).closest('button').disabled).toBe(true)

    await act(async () => { d.resolve({ installed: true }) })
    await act(async () => { fireEvent.click(screen.getByText('exportModal.pendingChoiceInclude')) })
    expect(onExportPremiere).toHaveBeenCalled()
    expect(onExportVrew).not.toHaveBeenCalled()
  })

  it('dispatch 중에도 잠긴다', async () => {
    const d = deferred()
    onExport.mockReturnValue(d.promise)
    await renderModal({ ...baseProps(), pendingWithImageCount: 0 })

    await act(async () => { fireEvent.click(screen.getByText(/exportModal\.export$/)) })
    expect(screen.getByText(/exportModal\.export$/).closest('button').disabled).toBe(true)
    expect(screen.getByText(/Premiere/).closest('button').disabled).toBe(true)

    await act(async () => { d.resolve({ success: true }) })
    expect(screen.getByText(/exportModal\.export$/).closest('button').disabled).toBe(false)
  })

  it('동기 이중 클릭 → preflight 가 한 번만 시작된다', async () => {
    await renderModal(baseProps())

    await act(async () => {
      const btn = screen.getByText(/exportModal\.export$/)
      fireEvent.click(btn)
      fireEvent.click(btn)
    })

    expect(window.electronAPI.checkCapcutInstalled).toHaveBeenCalledTimes(1)
  })
})

// ── stale 가드: 사이트별 전수 ─────────────────────────────────────────
// 인스턴스를 하나씩 추가하면 사이트 하나당 라운드가 하나씩 든다. 표로 돌린다.
const STALE_SITES = [
  ['CapCut 설치확인', 'capcut', 'checkCapcutInstalled', { installed: false }],
  ['프리미어 설치확인', 'premiere', 'checkPremiereInstalled', { installed: false }],
  ['프리미어 폴더확인', 'premiere', 'checkFolderExists', { exists: true }],
]

describe.each(STALE_SITES)('ExportModal — stale 가드 (%s)', (_label, fmt, api, resolved) => {
  // ⚠️ "발사되지 않는다" 만 보면 개별 가드를 지워도 **뒤의 가드나 최종 백스톱이 대신
  // 잡아서** 뮤턴트가 산다. 각 가드가 실제로 막는 것은 *그 다음 단계의 부작용* 이다 —
  // 닫힌 시도가 confirm/alert/openExternal 을 띄우거나 폴더를 더 조회하면 안 된다.
  it('붙잡은 지점 이후의 부작용이 일어나지 않는다', async () => {
    const d = deferred()
    window.electronAPI[api] = vi.fn().mockReturnValue(d.promise)
    const confirmSpy = vi.spyOn(window, 'confirm').mockReturnValue(true)
    const alertSpy = vi.spyOn(window, 'alert').mockImplementation(() => {})
    const props = { ...baseProps(), initialFormat: fmt }
    const { rerender } = await renderModal(props)

    await act(async () => { fireEvent.click(screen.getByText(/exportModal\.export$/)) })
    await act(async () => { rerender(<ExportModal {...props} isOpen={false} />) })
    await act(async () => { rerender(<ExportModal {...props} isOpen />) })
    await act(async () => { d.resolve(resolved) })

    // resolve 값은 살아있는 시도라면 반드시 대화상자를 띄우는 것들이다
    // (미설치 안내 / 덮어쓰기 확인). 닫힌 시도는 아무것도 띄우면 안 된다.
    expect(confirmSpy).not.toHaveBeenCalled()
    expect(alertSpy).not.toHaveBeenCalled()
    expect(window.electronAPI.openExternal).not.toHaveBeenCalled()
    expect(onExport).not.toHaveBeenCalled()
    expect(onExportPremiere).not.toHaveBeenCalled()
    confirmSpy.mockRestore(); alertSpy.mockRestore()
  })

  it('살아있는 시도였다면 그 대화상자가 실제로 뜬다 (위 단언이 공허하지 않다는 증거)', async () => {
    window.electronAPI[api] = vi.fn().mockResolvedValue(resolved)
    const confirmSpy = vi.spyOn(window, 'confirm').mockReturnValue(false)
    const alertSpy = vi.spyOn(window, 'alert').mockImplementation(() => {})
    await renderModal({ ...baseProps(), initialFormat: fmt })

    await clickExport()

    expect(confirmSpy.mock.calls.length + alertSpy.mock.calls.length).toBeGreaterThan(0)
    confirmSpy.mockRestore(); alertSpy.mockRestore()
  })

  it('붙잡기 → 닫기 → 재오픈 → resolve 면 발사되지 않는다', async () => {
    const d = deferred()
    window.electronAPI[api] = vi.fn().mockReturnValue(d.promise)
    const props = { ...baseProps(), initialFormat: fmt }
    const { rerender } = await renderModal(props)

    await act(async () => { fireEvent.click(screen.getByText(/exportModal\.export$/)) })

    // 외부 닫힘(업그레이드 버튼 경로) → 재오픈. 재오픈 뒤에는 isOpenRef 가 다시
    // true 라 **attempt 토큰만이** stale 을 가른다.
    await act(async () => { rerender(<ExportModal {...props} isOpen={false} />) })
    await act(async () => { rerender(<ExportModal {...props} isOpen />) })
    await act(async () => { d.resolve(resolved) })

    expect(onExport).not.toHaveBeenCalled()
    expect(onExportPremiere).not.toHaveBeenCalled()
    expect(modalShown()).toBe(false)
  })
})

describe('ExportModal — 소프트락 방지', () => {
  it('preflight 조기 return(덮어쓰기 거절) 후 재시도가 된다', async () => {
    window.electronAPI.checkFolderExists = vi.fn().mockResolvedValue({ exists: true })
    vi.spyOn(window, 'confirm').mockReturnValue(false)
    await renderModal({ ...baseProps(), initialFormat: 'premiere' })

    await clickExport()
    await clickExport()

    expect(window.electronAPI.checkPremiereInstalled).toHaveBeenCalledTimes(2)
    window.confirm.mockRestore()
  })

  it('pending 0 으로 성공 → 재오픈 → 다시 내보내기가 된다', async () => {
    const props = { ...baseProps(), pendingWithImageCount: 0 }
    const { rerender } = await renderModal(props)

    await clickExport()
    expect(onExport).toHaveBeenCalledTimes(1)

    await act(async () => { rerender(<ExportModal {...props} isOpen={false} />) })
    await act(async () => { rerender(<ExportModal {...props} isOpen />) })
    await clickExport()

    expect(onExport).toHaveBeenCalledTimes(2)
  })

  it('dispatch 중 닫기 → settle → 재오픈 → 다시 내보내기가 된다', async () => {
    const d = deferred()
    onExport.mockReturnValue(d.promise)
    const props = { ...baseProps(), pendingWithImageCount: 0 }
    const { rerender } = await renderModal(props)

    await act(async () => { fireEvent.click(screen.getByText(/exportModal\.export$/)) })
    await act(async () => { rerender(<ExportModal {...props} isOpen={false} />) })
    await act(async () => { d.resolve({ success: true }) })
    await act(async () => { rerender(<ExportModal {...props} isOpen />) })
    await clickExport()

    expect(onExport).toHaveBeenCalledTimes(2)
  })

  it('콜백이 reject 해도 phase 가 풀린다', async () => {
    onExport.mockRejectedValueOnce(new Error('boom'))
    await renderModal({ ...baseProps(), pendingWithImageCount: 0 })

    await clickExport()
    await clickExport()

    expect(onExport).toHaveBeenCalledTimes(2)
  })
})

describe('ExportModal — latch 수명 (A/B 인터리브)', () => {
  // 가드 없이도 B 는 결국 dispatch 하므로 "B 가 산다" 만 보면 안 죽는다.
  // 관찰 가능한 건 **세 번째 클릭이 막히는가** 뿐이다.
  it('A 가 늦게 resolve 해도 B 의 latch 를 풀지 않는다', async () => {
    const a = deferred(); const b = deferred()
    window.electronAPI.checkCapcutInstalled = vi.fn()
      .mockReturnValueOnce(a.promise)
      .mockReturnValueOnce(b.promise)
      .mockResolvedValue({ installed: true })
    const props = baseProps()
    const { rerender } = await renderModal(props)

    await act(async () => { fireEvent.click(screen.getByText(/exportModal\.export$/)) })   // A
    await act(async () => { rerender(<ExportModal {...props} isOpen={false} />) })
    await act(async () => { rerender(<ExportModal {...props} isOpen />) })
    await act(async () => { fireEvent.click(screen.getByText(/exportModal\.export$/)) })   // B
    await act(async () => { a.resolve({ installed: true }) })                              // A 늦게 도착

    // B 가 아직 preflight 중이므로 세 번째 클릭은 막혀야 한다.
    await act(async () => { fireEvent.click(screen.getByText(/exportModal\.export$/)) })
    expect(window.electronAPI.checkCapcutInstalled).toHaveBeenCalledTimes(2)
    b.resolve({ installed: true })
  })

  it('dispatch 중 닫아도 콜백이 settle 하기 전엔 재진입이 안 된다', async () => {
    const d = deferred()
    onExport.mockReturnValue(d.promise)
    const props = { ...baseProps(), pendingWithImageCount: 0 }
    const { rerender } = await renderModal(props)

    await act(async () => { fireEvent.click(screen.getByText(/exportModal\.export$/)) })
    await act(async () => { rerender(<ExportModal {...props} isOpen={false} />) })
    await act(async () => { rerender(<ExportModal {...props} isOpen />) })
    // 아직 pending — 여기서 또 누르면 이중 내보내기가 된다.
    await act(async () => { fireEvent.click(screen.getByText(/exportModal\.export$/)) })

    expect(onExport).toHaveBeenCalledTimes(1)
    await act(async () => { d.resolve({ success: true }) })
  })
})

describe('ExportModal — 닫기 일원화', () => {
  it('3버튼 모달 중 닫았다 재오픈하면 모달이 안 떠 있다', async () => {
    const props = baseProps()
    const { rerender } = await renderModal(props)
    await clickExport()
    expect(modalShown()).toBe(true)

    await act(async () => { fireEvent.click(screen.getByText('✕')) })
    await act(async () => { rerender(<ExportModal {...props} isOpen={false} />) })
    await act(async () => { rerender(<ExportModal {...props} isOpen />) })

    expect(modalShown()).toBe(false)
    expect(onClose).toHaveBeenCalled()
  })

  it('dispatch(loading) 중 백드롭 클릭은 무시된다', async () => {
    const { container } = await renderModal({ ...baseProps(), loading: true })

    fireEvent.click(container.ownerDocument.querySelector('.export-modal-overlay'))

    expect(onClose).not.toHaveBeenCalled()
  })
})
