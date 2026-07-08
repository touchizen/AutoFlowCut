/**
 * VideoDetailModal 단위 테스트 — 영상 카드 더블클릭 상세 모달(2026-07-08).
 * 상세 조회 로딩/성공/에러, 유튜브 임베드 자동재생(소리 ON), Mute/Volume postMessage 제어,
 * binary-not-found 시 OS별 설치 안내를 고정한다.
 */
import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import VideoDetailModal, { playerCommand } from '../../../src/components/story/VideoDetailModal.jsx'

const t = (key, fallback, params = {}) =>
  String(fallback ?? key).replace(/\{(\w+)\}/g, (m, k) => (params[k] !== undefined ? params[k] : m))

const DETAILS = {
  videoId: 'dQw4w9WgXcQ',
  title: 'Never Gonna Give You Up',
  channelTitle: 'Rick Astley',
  subscribers: 4520000,
  uploadDate: '20091025',
  viewCount: 1790462958,
  likeCount: 19235402,
  durationSec: 213,
  durationString: '3:33',
  viral: { ratio: 396.1, tier: 'explosive', viewsPerDay: 125000, engagement: 0.0107 },
}

describe('playerCommand', () => {
  it('posts a YouTube iframe API command to the embed', () => {
    const postMessage = vi.fn()
    const iframe = { contentWindow: { postMessage } }
    expect(playerCommand(iframe, 'mute')).toBe(true)
    expect(postMessage).toHaveBeenCalledWith(
      JSON.stringify({ event: 'command', func: 'mute', args: [] }),
      'https://www.youtube.com',
    )
    expect(playerCommand(iframe, 'setVolume', [40])).toBe(true)
    expect(postMessage).toHaveBeenLastCalledWith(
      JSON.stringify({ event: 'command', func: 'setVolume', args: [40] }),
      'https://www.youtube.com',
    )
  })
  it('is a no-op (false) when iframe/contentWindow missing', () => {
    expect(playerCommand(null, 'mute')).toBe(false)
    expect(playerCommand({}, 'mute')).toBe(false)
  })
})

describe('VideoDetailModal', () => {
  it('shows loading then renders details + viral index', async () => {
    const fetchDetails = vi.fn().mockResolvedValue({ details: DETAILS })
    render(<VideoDetailModal videoId="dQw4w9WgXcQ" t={t} fetchDetails={fetchDetails} onClose={vi.fn()} />)
    expect(screen.getByText('상세 정보를 불러오는 중…')).toBeTruthy()
    await waitFor(() => expect(screen.getByText('Never Gonna Give You Up')).toBeTruthy())
    // 바이럴 지수(폭발) + 구독자/게시일/조회수 표시
    expect(screen.getByText(/바이럴 폭발/)).toBeTruthy()
    expect(screen.getByText(/4,520,000/)).toBeTruthy()
    expect(screen.getByText(/2009\.10\.25/)).toBeTruthy()
    expect(screen.getByText(/1,790,462,958/)).toBeTruthy()
  })

  it('embeds the YouTube player with autoplay + jsapi, sound ON', async () => {
    const fetchDetails = vi.fn().mockResolvedValue({ details: DETAILS })
    render(<VideoDetailModal videoId="dQw4w9WgXcQ" t={t} fetchDetails={fetchDetails} onClose={vi.fn()} />)
    const iframe = await screen.findByTestId('video-embed')
    expect(iframe.getAttribute('src')).toContain('/embed/dQw4w9WgXcQ')
    expect(iframe.getAttribute('src')).toContain('autoplay=1')
    expect(iframe.getAttribute('src')).toContain('enablejsapi=1')
    expect(iframe.getAttribute('src')).not.toContain('mute=1') // 소리 ON 시작
    expect(iframe.getAttribute('allow')).toContain('autoplay')
  })

  it('Mute 버튼이 iframe에 mute/unMute 커맨드를 보낸다', async () => {
    const fetchDetails = vi.fn().mockResolvedValue({ details: DETAILS })
    render(<VideoDetailModal videoId="dQw4w9WgXcQ" t={t} fetchDetails={fetchDetails} onClose={vi.fn()} />)
    const iframe = await screen.findByTestId('video-embed')
    const postMessage = vi.fn()
    Object.defineProperty(iframe, 'contentWindow', { value: { postMessage }, configurable: true })
    fireEvent.click(screen.getByRole('button', { name: '음소거' }))
    expect(postMessage).toHaveBeenCalledWith(
      JSON.stringify({ event: 'command', func: 'mute', args: [] }),
      'https://www.youtube.com',
    )
    // 다시 누르면 unMute + 라벨 토글
    fireEvent.click(screen.getByRole('button', { name: '음소거 해제' }))
    expect(postMessage).toHaveBeenLastCalledWith(
      JSON.stringify({ event: 'command', func: 'unMute', args: [] }),
      'https://www.youtube.com',
    )
  })

  it('볼륨 슬라이더가 setVolume 커맨드를 보낸다', async () => {
    const fetchDetails = vi.fn().mockResolvedValue({ details: DETAILS })
    render(<VideoDetailModal videoId="dQw4w9WgXcQ" t={t} fetchDetails={fetchDetails} onClose={vi.fn()} />)
    const iframe = await screen.findByTestId('video-embed')
    const postMessage = vi.fn()
    Object.defineProperty(iframe, 'contentWindow', { value: { postMessage }, configurable: true })
    fireEvent.change(screen.getByRole('slider', { name: '볼륨' }), { target: { value: '30' } })
    expect(postMessage).toHaveBeenCalledWith(
      JSON.stringify({ event: 'command', func: 'setVolume', args: [30] }),
      'https://www.youtube.com',
    )
  })

  it('플레이어 onReady 메시지에서 현재 mute/volume을 재적용한다(준비 전 드롭 보정)', async () => {
    const fetchDetails = vi.fn().mockResolvedValue({ details: DETAILS })
    render(<VideoDetailModal videoId="dQw4w9WgXcQ" t={t} fetchDetails={fetchDetails} onClose={vi.fn()} />)
    const iframe = await screen.findByTestId('video-embed')
    const postMessage = vi.fn()
    Object.defineProperty(iframe, 'contentWindow', { value: { postMessage }, configurable: true })
    // 사용자가 음소거(준비 전이면 실제로 드롭될 수 있음). 상태는 muted=true.
    fireEvent.click(screen.getByRole('button', { name: '음소거' }))
    postMessage.mockClear()
    // 플레이어 준비 회신 → 현재 상태(mute + volume 100) 재적용
    window.dispatchEvent(new MessageEvent('message', { data: JSON.stringify({ event: 'onReady' }) }))
    expect(postMessage).toHaveBeenCalledWith(
      JSON.stringify({ event: 'command', func: 'mute', args: [] }),
      'https://www.youtube.com',
    )
    expect(postMessage).toHaveBeenCalledWith(
      JSON.stringify({ event: 'command', func: 'setVolume', args: [100] }),
      'https://www.youtube.com',
    )
    // 이후 infoDelivery 반복에는 재적용하지 않는다(1회만).
    postMessage.mockClear()
    window.dispatchEvent(new MessageEvent('message', { data: JSON.stringify({ event: 'infoDelivery' }) }))
    expect(postMessage).not.toHaveBeenCalled()
  })

  it('binary-not-found 시 OS별 설치 안내를 보여준다', async () => {
    const fetchDetails = vi.fn().mockResolvedValue({ error: 'binary-not-found' })
    render(<VideoDetailModal videoId="abc" t={t} fetchDetails={fetchDetails} onClose={vi.fn()} nav={{ platform: 'Win32' }} />)
    await waitFor(() => expect(screen.getByText(/winget install yt-dlp/)).toBeTruthy())
  })

  it('닫기(✕) 버튼과 Escape가 onClose를 호출한다', async () => {
    const onClose = vi.fn()
    const fetchDetails = vi.fn().mockResolvedValue({ details: DETAILS })
    render(<VideoDetailModal videoId="dQw4w9WgXcQ" t={t} fetchDetails={fetchDetails} onClose={onClose} />)
    await screen.findByTestId('video-embed')
    // 공용 Modal이 제공하는 ✕ 닫기 버튼
    fireEvent.click(screen.getByRole('button', { name: '✕' }))
    expect(onClose).toHaveBeenCalledTimes(1)
    fireEvent.keyDown(window, { key: 'Escape' })
    expect(onClose).toHaveBeenCalledTimes(2)
  })
})
