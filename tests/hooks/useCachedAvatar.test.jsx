/**
 * useCachedAvatar — 24h base64 캐싱 hook 테스트
 *
 * 검증:
 *   1. 캐시 hit 시 첫 렌더에서 동기적으로 src 노출 (네트워크 X)
 *   2. 캐시 miss 시 fetch → 캐시 저장 → src 갱신
 *   3. fetch 실패 시 failed=true
 *   4. url 변경 시 새로 조회 (cleanup 동작)
 *   5. url null 시 src/failed 모두 reset
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { renderHook, render, waitFor, act } from '@testing-library/react'

const mockFetchAsBase64 = vi.fn()
const mockGetCachedEntry = vi.fn()
const mockSetCachedEntry = vi.fn()
const mockClearCachedEntry = vi.fn()

vi.mock('../../src/utils/avatarCache', () => ({
  getCachedEntry: (...args) => mockGetCachedEntry(...args),
  setCachedEntry: (...args) => mockSetCachedEntry(...args),
  clearCachedEntry: (...args) => mockClearCachedEntry(...args),
  fetchAsBase64: (...args) => mockFetchAsBase64(...args)
}))

import { useCachedAvatar } from '../../src/hooks/useCachedAvatar'

beforeEach(() => {
  vi.clearAllMocks()
  // 기본: 캐시 miss
  mockGetCachedEntry.mockReturnValue(null)
})

describe('useCachedAvatar — 캐시 hit', () => {
  it('첫 렌더에 동기적으로 src 노출 (fetch 호출 안 됨)', () => {
    mockGetCachedEntry.mockReturnValue({ data: 'data:image/png;base64,cached', cachedAt: Date.now() })

    const { result } = renderHook(() => useCachedAvatar('http://x/avatar'))

    // 첫 렌더에서 이미 src 가 있어야 함
    expect(result.current.src).toBe('data:image/png;base64,cached')
    expect(result.current.failed).toBe(false)
    expect(mockFetchAsBase64).not.toHaveBeenCalled()
  })
})

describe('useCachedAvatar — 캐시 miss', () => {
  it('fetch 후 src 갱신 + 캐시 저장', async () => {
    mockGetCachedEntry.mockReturnValue(null)
    mockFetchAsBase64.mockResolvedValue('data:image/jpeg;base64,fetched')

    const { result } = renderHook(() => useCachedAvatar('http://x/avatar'))

    // 처음엔 src null (loading)
    expect(result.current.src).toBeNull()

    await waitFor(() => {
      expect(result.current.src).toBe('data:image/jpeg;base64,fetched')
    })

    expect(mockFetchAsBase64).toHaveBeenCalledWith('http://x/avatar')
    expect(mockSetCachedEntry).toHaveBeenCalledWith('http://x/avatar', 'data:image/jpeg;base64,fetched')
    expect(result.current.failed).toBe(false)
  })

  it('fetch 실패 시 failed=true, src 는 null 유지', async () => {
    mockFetchAsBase64.mockRejectedValue(new Error('429'))

    const { result } = renderHook(() => useCachedAvatar('http://x/avatar'))

    await waitFor(() => {
      expect(result.current.failed).toBe(true)
    })
    expect(result.current.src).toBeNull()
    expect(mockSetCachedEntry).not.toHaveBeenCalled()
  })
})

describe('useCachedAvatar — url 변경', () => {
  it('url 이 바뀌면 새 fetch', async () => {
    mockFetchAsBase64
      .mockResolvedValueOnce('data:image/png;base64,A')
      .mockResolvedValueOnce('data:image/png;base64,B')

    const { result, rerender } = renderHook(({ url }) => useCachedAvatar(url), {
      initialProps: { url: 'http://x/A' }
    })

    await waitFor(() => {
      expect(result.current.src).toBe('data:image/png;base64,A')
    })

    rerender({ url: 'http://x/B' })

    await waitFor(() => {
      expect(result.current.src).toBe('data:image/png;base64,B')
    })

    expect(mockFetchAsBase64).toHaveBeenNthCalledWith(1, 'http://x/A')
    expect(mockFetchAsBase64).toHaveBeenNthCalledWith(2, 'http://x/B')
  })

  it('url 이 null 이 되면 src/failed 둘 다 리셋', async () => {
    mockFetchAsBase64.mockRejectedValue(new Error('boom'))

    const { result, rerender } = renderHook(({ url }) => useCachedAvatar(url), {
      initialProps: { url: 'http://x/A' }
    })

    await waitFor(() => {
      expect(result.current.failed).toBe(true)
    })

    rerender({ url: null })

    await waitFor(() => {
      expect(result.current.src).toBeNull()
      expect(result.current.failed).toBe(false)
    })
  })

  it('이전 fetch 가 진행 중에 url 이 바뀌면 stale 응답이 새 url 의 src 를 덮지 않는다', async () => {
    let resolveA
    mockFetchAsBase64
      .mockImplementationOnce(() => new Promise(r => { resolveA = r }))
      .mockResolvedValueOnce('data:image/png;base64,B')

    const { result, rerender } = renderHook(({ url }) => useCachedAvatar(url), {
      initialProps: { url: 'http://x/A' }
    })

    rerender({ url: 'http://x/B' })

    await waitFor(() => {
      expect(result.current.src).toBe('data:image/png;base64,B')
    })

    // A 의 응답이 뒤늦게 도착 — 무시되어야 함
    resolveA('data:image/png;base64,A_late')
    await new Promise(r => setTimeout(r, 20))

    expect(result.current.src).toBe('data:image/png;base64,B')
  })
})

describe('useCachedAvatar — onImageError (캐시된 base64 디코드 실패 시)', () => {
  // 회귀 방지: fetch 단계에서 정상으로 캐시됐어도, <img> 가 렌더 시점에 못 디코드하면
  // 그 캐시 엔트리는 무효이므로 clearCachedEntry 로 제거하여 다음 mount 에서 재시도해야 한다.
  it('호출 시 캐시 invalidate + failed=true', () => {
    mockGetCachedEntry.mockReturnValue({ data: 'data:image/png;base64,broken', cachedAt: Date.now() })

    const { result } = renderHook(() => useCachedAvatar('http://x/avatar'))
    expect(result.current.failed).toBe(false)

    act(() => {
      result.current.onImageError()
    })

    expect(mockClearCachedEntry).toHaveBeenCalledWith('http://x/avatar')
    expect(result.current.failed).toBe(true)
  })

  it('url 이 null 이면 clearCachedEntry 호출 안 함', () => {
    const { result } = renderHook(() => useCachedAvatar(null))

    act(() => {
      result.current.onImageError()
    })

    expect(mockClearCachedEntry).not.toHaveBeenCalled()
    expect(result.current.failed).toBe(true)
  })
})

describe('useCachedAvatar — URL 전환 시 frame leak 차단 (계정 전환/로그아웃 누수 방지)', () => {
  // 회귀 방지: state 가 url 로 태깅되지 않으면 props A→B 변경 직후 한 프레임 동안
  // 이전 사용자(A)의 src 가 새 사용자(B) 이름과 함께 노출된다.
  // 매 렌더의 결과를 기록해 그 frame 에서 A 의 데이터가 새지 않는지 직접 검증.
  it('url 변경 직후 어떤 렌더 프레임에서도 이전 url 의 data 가 노출되지 않는다', async () => {
    // A 는 캐시 hit, B 는 캐시 hit 다른 데이터 — 둘 다 동기적으로 결정 가능한 상황으로 단순화
    mockGetCachedEntry.mockImplementation((url) => {
      if (url === 'http://x/A') return { data: 'data:image/png;base64,A_data', cachedAt: Date.now() }
      if (url === 'http://x/B') return { data: 'data:image/png;base64,B_data', cachedAt: Date.now() }
      return null
    })

    // 렌더링되는 모든 src 값을 캡처
    const rendered = []
    const TestProbe = ({ url }) => {
      const { src } = useCachedAvatar(url)
      rendered.push({ url, src })
      return null
    }

    const { rerender } = render(<TestProbe url="http://x/A" />)

    // url 을 B 로 전환 — props 변경 직후의 렌더 프레임 포함 모든 렌더에서 누수 X 검증
    rerender(<TestProbe url="http://x/B" />)

    // 핵심 검증:
    //   url=B 인 어떤 렌더 프레임에서도 src 가 'A_data' 면 안 된다.
    //   (tagged state 없으면 첫 B 프레임에서 A_data 가 새어나온다)
    const bRenders = rendered.filter(r => r.url === 'http://x/B')
    expect(bRenders.length).toBeGreaterThan(0)
    for (const frame of bRenders) {
      expect(frame.src).not.toBe('data:image/png;base64,A_data')
    }
  })

  it('A → B 전환 시 최종적으로는 B 데이터로 안착한다', async () => {
    mockGetCachedEntry.mockImplementation((url) => {
      if (url === 'http://x/A') return { data: 'data:image/png;base64,A', cachedAt: Date.now() }
      if (url === 'http://x/B') return { data: 'data:image/png;base64,B', cachedAt: Date.now() }
      return null
    })

    const { result, rerender } = renderHook(({ url }) => useCachedAvatar(url), {
      initialProps: { url: 'http://x/A' }
    })

    expect(result.current.src).toBe('data:image/png;base64,A')

    rerender({ url: 'http://x/B' })

    await waitFor(() => {
      expect(result.current.src).toBe('data:image/png;base64,B')
    })
  })

  it('A 가 캐시 hit 이고 B 가 miss 면 B 의 fetch 완료 전까지 src 는 null (A 의 데이터 절대 안 보임)', async () => {
    let resolveB
    mockGetCachedEntry.mockImplementation((url) => {
      if (url === 'http://x/A') return { data: 'data:image/png;base64,A', cachedAt: Date.now() }
      return null
    })
    mockFetchAsBase64.mockImplementation(() => new Promise(r => { resolveB = r }))

    const { result, rerender } = renderHook(({ url }) => useCachedAvatar(url), {
      initialProps: { url: 'http://x/A' }
    })

    expect(result.current.src).toBe('data:image/png;base64,A')

    rerender({ url: 'http://x/B' })

    // B 의 fetch 보류 중 — src 는 null (A 데이터 절대 노출 X)
    expect(result.current.src).toBeNull()
    expect(result.current.src).not.toBe('data:image/png;base64,A')

    // B fetch 완료 후 안착
    await act(async () => {
      resolveB('data:image/png;base64,B_fetched')
      await new Promise(r => setTimeout(r, 10))
    })

    expect(result.current.src).toBe('data:image/png;base64,B_fetched')
  })
})
