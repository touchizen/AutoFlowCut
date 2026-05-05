/**
 * useAudioImport — concurrency regression tests.
 *
 *  importByPath:  latest-wins via version token. Project switch (different paths)
 *                 must always commit the newest call's result, never silently drop.
 *  refreshReviews: dedupe in-flight duplicates (same folder, double-click).
 *  Issue-D playback stop is covered in AudioTimeline tests.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { renderHook, act, waitFor } from '@testing-library/react'
import { useAudioImport } from '../../src/hooks/useAudioImport'

const t = (k) => k

// Queue of pending scan promise resolvers — each rescanAudioPackage call grabs its own.
let scanResolvers = []
const nextScan = () => new Promise(r => { scanResolvers.push(r) })

beforeEach(() => {
  scanResolvers = []
  localStorage.clear()
  global.window.electronAPI = {
    scanAudioPackage: vi.fn(() => nextScan()),
    rescanAudioPackage: vi.fn(() => nextScan()),
    readFileAbsolute: vi.fn().mockResolvedValue({ success: false, data: null }),
    writeFileAbsolute: vi.fn().mockResolvedValue({ success: true }),
  }
})

const mockResult = (folderPath = '/mock/audio') => ({
  success: true,
  folderPath,
  media: { video: { path: `${folderPath}/n.mp3`, filename: 'n.mp3', durationMs: 60000 } },
  voices: [],
  sfx: [],
  srtContent: '',
  sfxMdContent: '',
  summary: {},
})

describe('useAudioImport concurrency', () => {
  it('importByPath (latest-wins): 두 번째 호출이 첫 번째를 supersede — 두 번 다 rescan 호출됨', async () => {
    const { result } = renderHook(() => useAudioImport(t))

    let firstPromise, secondPromise
    act(() => { firstPromise = result.current.importByPath('/mock/audio/A') })
    act(() => { secondPromise = result.current.importByPath('/mock/audio/B') })

    // 두 호출 모두 rescan 호출 (이전 boolean lock 패턴과 다름)
    expect(window.electronAPI.rescanAudioPackage).toHaveBeenCalledTimes(2)

    // 첫 번째 먼저 응답 → superseded라 null 반환되어야 함
    await act(async () => {
      scanResolvers[0](mockResult('/mock/audio/A'))
      await firstPromise
    })
    await expect(firstPromise).resolves.toBeNull()

    // 두 번째 응답 → 자기가 최신이라 commit
    await act(async () => {
      scanResolvers[1](mockResult('/mock/audio/B'))
      await secondPromise
    })
    const winner = await secondPromise
    expect(winner).toBeTruthy()
    expect(winner.folderPath).toBe('/mock/audio/B')

    // 최종 audioPackage는 두 번째 (B)
    expect(result.current.audioPackage?.folderPath).toBe('/mock/audio/B')
  })

  it('importByPath: 두 번째가 먼저 응답해도 자기가 최신이면 살아남고 첫 번째는 supersede됨', async () => {
    // 응답 순서가 호출 순서와 달라도 latest-wins 동작 보장
    const { result } = renderHook(() => useAudioImport(t))

    let firstPromise, secondPromise
    act(() => { firstPromise = result.current.importByPath('/mock/audio/A') })
    act(() => { secondPromise = result.current.importByPath('/mock/audio/B') })

    // 두 번째 먼저 resolve → 자기가 최신이라 commit, audioPackage = B
    await act(async () => {
      scanResolvers[1](mockResult('/mock/audio/B'))
      await secondPromise
    })
    expect(result.current.audioPackage?.folderPath).toBe('/mock/audio/B')

    // 첫 번째 늦게 resolve → 이미 superseded이므로 무시되어 audioPackage 변경 안 됨
    await act(async () => {
      scanResolvers[0](mockResult('/mock/audio/A'))
      await firstPromise
    })
    expect(result.current.audioPackage?.folderPath).toBe('/mock/audio/B')  // 여전히 B
  })

  it('refreshReviews: 진행 중 두 번째 호출은 무시 (같은 path 중복 방지)', async () => {
    const { result } = renderHook(() => useAudioImport(t))

    let initial
    await act(async () => {
      initial = result.current.importByPath('/mock/audio')
      scanResolvers[0](mockResult('/mock/audio'))
      await initial
    })
    expect(window.electronAPI.rescanAudioPackage).toHaveBeenCalledTimes(1)

    // refreshReviews 동시 호출
    let r1, r2
    act(() => { r1 = result.current.refreshReviews() })
    act(() => { r2 = result.current.refreshReviews() })

    await act(async () => {
      scanResolvers[1](mockResult('/mock/audio'))
      await Promise.all([r1, r2])
    })

    // refresh는 dedup되어 한 번만 추가 (총 2회: initial 1 + refresh 1)
    expect(window.electronAPI.rescanAudioPackage).toHaveBeenCalledTimes(2)
  })

  it('audioLoading은 import 중 true, 끝나면 false', async () => {
    const { result } = renderHook(() => useAudioImport(t))
    expect(result.current.audioLoading).toBe(false)

    let p
    act(() => { p = result.current.importByPath('/mock/audio') })
    await waitFor(() => expect(result.current.audioLoading).toBe(true))

    await act(async () => {
      scanResolvers[0](mockResult())
      await p
    })
    expect(result.current.audioLoading).toBe(false)
  })

  // Regression (Issue E): _processScanResult 안의 mutation도 토큰 가드 받아야 함.
  // 첫 번째 import의 rescan이 끝난 뒤 _processScanResult 진행 중에 두 번째 import가
  // 들어오면, 첫 번째의 setAudioPackage / localStorage write가 차단되어야 한다.
  it('importByPath: 응답이 늦은 첫 번째는 setAudioPackage를 호출하지 않음 (mutation gated)', async () => {
    const { result } = renderHook(() => useAudioImport(t))

    // import A 시작 → rescan promise 0 발급
    let pA, pB
    act(() => { pA = result.current.importByPath('/mock/audio/A') })
    // import B 시작 → rescan promise 1 발급, opVersion 증가
    act(() => { pB = result.current.importByPath('/mock/audio/B') })

    // B 응답 먼저 → B가 commit, audioPackage = B
    await act(async () => {
      scanResolvers[1](mockResult('/mock/audio/B'))
      await pB
    })
    expect(result.current.audioPackage?.folderPath).toBe('/mock/audio/B')

    // A 응답 늦게 → _processScanResult 들어가도 shouldCommit이 false라 mutation skip
    // 핵심 검증: audioPackage가 A로 덮어쓰이지 않아야 함
    await act(async () => {
      scanResolvers[0](mockResult('/mock/audio/A'))
      await pA
    })
    expect(result.current.audioPackage?.folderPath).toBe('/mock/audio/B')  // 여전히 B
    // 추가: localStorage도 A로 안 바뀌어야 함
    expect(localStorage.getItem('audioFolderPath')).toBe('/mock/audio/B')
  })

  // Regression (Issue G): import 종류가 다를 때 (importAudioPackage vs importByPath)
  // loading flag가 stuck되지 않아야 함. 카운터 기반 + 무조건 정리 패턴 검증.
  it('Issue G: importAudioPackage + importByPath 동시 — 둘 다 끝나면 audioLoading=false', async () => {
    const { result } = renderHook(() => useAudioImport(t))

    // importAudioPackage 시작 → scan promise 0
    let pImport
    act(() => { pImport = result.current.importAudioPackage() })
    // importByPath 시작 → scan promise 1, opVersion 증가 → importAudioPackage는 stale
    let pPath
    act(() => { pPath = result.current.importByPath('/mock/audio/B') })

    expect(result.current.audioLoading).toBe(true)

    // path import 먼저 끝남 → refreshing counter 0 → setRefreshing(false)
    await act(async () => {
      scanResolvers[1](mockResult('/mock/audio/B'))
      await pPath
    })
    // 아직 importAudioPackage가 importing=true 유지 → audioLoading 여전히 true
    expect(result.current.audioLoading).toBe(true)

    // importAudioPackage 끝남 (stale이지만 finally는 importing 무조건 정리)
    await act(async () => {
      scanResolvers[0]({ success: true, ...mockResult('/mock/audio/A') })
      await pImport
    })
    // 둘 다 정리되어 audioLoading=false
    expect(result.current.audioLoading).toBe(false)
  })

  // Regression (Issue H): _processScanResult 안의 review load도 stale일 때 commit되면 안 됨.
  // pure _readReviewsFile + 가드된 updateReviews 패턴 검증.
  it('Issue H: superseded import이 audioReviews를 다른 프로젝트 리뷰로 덮어쓰지 않음', async () => {
    const reviewsForB = JSON.stringify({ 'b/specific/file.mp3': { status: 'flagged', reason: 'B project flag' } })
    const encodeData = (json) => `data:application/json;base64,${btoa(json)}`

    // readFileAbsolute mock — path별로 다른 reviews 반환
    global.window.electronAPI.readFileAbsolute = vi.fn(({ filePath }) => {
      if (filePath.includes('/B/') || filePath.includes('/B.audio_review')) {
        return Promise.resolve({ success: true, data: encodeData(reviewsForB) })
      }
      return Promise.resolve({ success: false })
    })

    const { result } = renderHook(() => useAudioImport(t))

    // import B 시작
    let pB
    act(() => { pB = result.current.importByPath('/mock/audio/B') })
    // 즉시 import C로 supersede
    let pC
    act(() => { pC = result.current.importByPath('/mock/audio/C') })

    // C 먼저 끝 → audioReviews = {} (C path는 readFileAbsolute가 success:false)
    await act(async () => {
      scanResolvers[1](mockResult('/mock/audio/C'))
      await pC
    })

    // B 늦게 끝 → stale, 여기서 _readReviewsFile은 호출되어 reviewsForB 읽지만
    // shouldCommit이 false라 updateReviews 호출 안 됨
    await act(async () => {
      scanResolvers[0](mockResult('/mock/audio/B'))
      await pB
    })

    // audioReviews가 B의 리뷰로 덮어씌워지지 않아야 함
    expect(result.current.audioReviews).not.toHaveProperty('b/specific/file.mp3')
  })

  // Regression: import는 refresh보다 의미적으로 우선. import in-flight 중 refresh 시도는
  // (UI에선 disabled로 막지만 MCP는 우회) silently 종료되어야 함.
  // 그러지 않으면 refresh가 새 import의 토큰을 supersede해서 사용자 전환이 drop됨.
  it('refresh는 import in-flight 중 silently 종료 (MCP 시나리오 — import 우선)', async () => {
    const { result } = renderHook(() => useAudioImport(t))

    // Setup: 프로젝트 A 로드
    let initial
    await act(async () => {
      initial = result.current.importByPath('/mock/audio/A')
      scanResolvers[0](mockResult('/mock/audio/A'))
      await initial
    })

    // 진행 중 import B
    let pB
    act(() => { pB = result.current.importByPath('/mock/audio/B') })
    expect(window.electronAPI.rescanAudioPackage).toHaveBeenCalledTimes(2) // initial + B

    // MCP 우회 refresh 시도 — import in-flight라 즉시 종료, rescan 호출 안 됨
    let refreshP
    act(() => { refreshP = result.current.refreshReviews() })
    await expect(refreshP).resolves.toBeUndefined()
    expect(window.electronAPI.rescanAudioPackage).toHaveBeenCalledTimes(2) // 여전히 2 — refresh가 rescan 호출 안 함

    // B import 완료 → audioPackage = B
    await act(async () => {
      scanResolvers[1](mockResult('/mock/audio/B'))
      await pB
    })
    expect(result.current.audioPackage?.folderPath).toBe('/mock/audio/B')
  })

  // Regression: clearAudioPackage가 in-flight import의 stale commit을 막아야 함.
  // 프로젝트 전환 path: clearAudioPackage() → importByPath('/B'). 그 사이 이전 import가
  // 늦게 resolve하면 shouldCommit이 여전히 true라 옛 데이터를 다시 commit할 수 있음.
  it('clearAudioPackage: opVersion bump으로 in-flight import의 stale commit 차단', async () => {
    const { result } = renderHook(() => useAudioImport(t))

    // import A 시작 → 아직 응답 안 옴
    let pA
    act(() => { pA = result.current.importByPath('/mock/audio/A') })

    // 사용자가 프로젝트 전환 시작 → clearAudioPackage 호출
    act(() => { result.current.clearAudioPackage() })
    expect(result.current.audioPackage).toBeNull()

    // A의 응답이 늦게 옴 — clearAudioPackage가 version bump 했으므로 stale
    await act(async () => {
      scanResolvers[0](mockResult('/mock/audio/A'))
      await pA
    })

    // audioPackage가 A로 부활하면 안 됨
    expect(result.current.audioPackage).toBeNull()
  })

  // Regression (Issue F): 진행 중 refresh가 새 import에게 supersede되어야 함.
  // refresh 결과로 이전 프로젝트 데이터를 새 프로젝트 위에 덮어쓰면 안 됨.
  it('refreshReviews: 진행 중 새 importByPath가 들어오면 stale refresh가 commit 못 함', async () => {
    const { result } = renderHook(() => useAudioImport(t))

    // 초기 셋업: 프로젝트 A 로드
    let initial
    await act(async () => {
      initial = result.current.importByPath('/mock/audio/A')
      scanResolvers[0](mockResult('/mock/audio/A'))
      await initial
    })
    expect(result.current.audioPackage?.folderPath).toBe('/mock/audio/A')

    // refresh 시작 (A를 위해) — rescan promise 1 발급
    let refreshP
    act(() => { refreshP = result.current.refreshReviews() })
    // 새 import B 시작 → rescan promise 2 발급, opVersion 증가
    let pB
    act(() => { pB = result.current.importByPath('/mock/audio/B') })

    // B 먼저 응답 → B commit
    await act(async () => {
      scanResolvers[2](mockResult('/mock/audio/B'))
      await pB
    })
    expect(result.current.audioPackage?.folderPath).toBe('/mock/audio/B')

    // A의 refresh 응답 늦게 → 새 op로 가드되어 mutation 차단
    await act(async () => {
      scanResolvers[1](mockResult('/mock/audio/A'))
      await refreshP
    })
    // audioPackage가 A로 되돌아가지 않아야 함
    expect(result.current.audioPackage?.folderPath).toBe('/mock/audio/B')
    // localStorage도 마찬가지
    expect(localStorage.getItem('audioFolderPath')).toBe('/mock/audio/B')
  })
})
