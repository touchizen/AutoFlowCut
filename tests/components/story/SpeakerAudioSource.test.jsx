import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { createRef } from 'react'
import SpeakerAudioSource from '../../../src/components/story/SpeakerAudioSource'

const MP3 = 'C:\\a\\무한야담2.mp3'
const SRT = 'C:\\a\\무한야담2.srt'

/** Electron 36에선 File.path가 없어 preload의 getPathForFile로만 경로를 얻는다 — 주입해서 흉내낸다. */
const fileOf = (name) => ({ name })
const resolvePath = (f) => ({ '무한야담2.mp3': MP3, '무한야담2.srt': SRT, 'x.txt': 'C:\\a\\x.txt' }[f.name] || '')

function drop(el, files) {
  fireEvent.drop(el, { dataTransfer: { files } })
}

function setup(props = {}) {
  const onPick = vi.fn(async ({ kind }) => ({ canceled: false, filePath: kind === 'srt' ? SRT : MP3 }))
  const onChange = vi.fn()
  const utils = render(<SpeakerAudioSource source={null} onPick={onPick} onChange={onChange} resolvePath={resolvePath} {...props} />)
  return { onPick, onChange, ...utils }
}

describe('SpeakerAudioSource', () => {
  beforeEach(() => vi.clearAllMocks())

  it('출처가 없으면 mp3/SRT를 받을 자리를 보여준다', () => {
    setup()
    expect(screen.getByTestId('src-mp3')).toHaveTextContent('mp3')
    expect(screen.getByTestId('src-srt')).toHaveTextContent('SRT')
    expect(screen.queryByTestId('src-clear')).not.toBeInTheDocument()
  })

  // ── drag & drop ──
  it('mp3+SRT를 한 번에 끌어다 놓으면 출처가 된다', () => {
    const { onChange } = setup()
    drop(screen.getByTestId('speaker-audio-source'), [fileOf('무한야담2.mp3'), fileOf('무한야담2.srt')])
    expect(onChange).toHaveBeenCalledWith({ mp3Path: MP3, srtPath: SRT })
  })

  it('하나씩 놓아도 된다 — 둘 다 모였을 때만 올린다', () => {
    const { onChange } = setup()
    const zone = screen.getByTestId('speaker-audio-source')
    drop(zone, [fileOf('무한야담2.mp3')])
    expect(onChange).not.toHaveBeenCalled() // 반쪽 출처를 올리면 ⑤가 "성우 미배정"으로 막힌다
    expect(screen.getByTestId('src-need')).toHaveTextContent('SRT도 필요')
    drop(zone, [fileOf('무한야담2.srt')])
    expect(onChange).toHaveBeenCalledWith({ mp3Path: MP3, srtPath: SRT })
  })

  it('SRT를 먼저 놓아도 된다', () => {
    const { onChange } = setup()
    const zone = screen.getByTestId('speaker-audio-source')
    drop(zone, [fileOf('무한야담2.srt')])
    expect(screen.getByTestId('src-need')).toHaveTextContent('mp3도 필요')
    drop(zone, [fileOf('무한야담2.mp3')])
    expect(onChange).toHaveBeenCalledWith({ mp3Path: MP3, srtPath: SRT })
  })

  it('mp3/SRT가 아닌 파일은 거부한다', () => {
    const { onChange } = setup()
    drop(screen.getByTestId('speaker-audio-source'), [fileOf('x.txt')])
    expect(onChange).not.toHaveBeenCalled()
    expect(screen.getByRole('alert')).toHaveTextContent('mp3와 SRT')
  })

  it('드래그 중임을 표시한다', () => {
    setup()
    const zone = screen.getByTestId('speaker-audio-source')
    fireEvent.dragOver(zone)
    expect(zone.className).toContain('over')
    fireEvent.dragLeave(zone)
    expect(zone.className).not.toContain('over')
  })

  it('실행 중이면 드롭을 무시한다', () => {
    const { onChange } = setup({ disabled: true })
    drop(screen.getByTestId('speaker-audio-source'), [fileOf('무한야담2.mp3'), fileOf('무한야담2.srt')])
    expect(onChange).not.toHaveBeenCalled()
  })

  // ── 행 위임(ref) — 성우 행 전체를 드롭 타깃으로 쓰려고 부모가 takeFiles를 부른다 ──
  it('ref.takeFiles로 파일을 위임받는다 — 넓은 드롭 타깃(행)을 위해', () => {
    const ref = createRef()
    const onChange = vi.fn()
    render(<SpeakerAudioSource ref={ref} source={null} onPick={vi.fn()} onChange={onChange} resolvePath={resolvePath} />)
    ref.current.takeFiles([fileOf('무한야담2.mp3'), fileOf('무한야담2.srt')])
    expect(onChange).toHaveBeenCalledWith({ mp3Path: MP3, srtPath: SRT })
  })

  it('disabled면 ref 위임도 무시한다 — 실행 중 교체 방지', () => {
    const ref = createRef()
    const onChange = vi.fn()
    render(<SpeakerAudioSource ref={ref} source={null} disabled onPick={vi.fn()} onChange={onChange} resolvePath={resolvePath} />)
    ref.current.takeFiles([fileOf('무한야담2.mp3'), fileOf('무한야담2.srt')])
    expect(onChange).not.toHaveBeenCalled()
  })

  // ── 파일 선택 ──
  it('클릭해서 고를 수도 있다', async () => {
    const user = userEvent.setup()
    const { onChange } = setup()
    await user.click(screen.getByTestId('src-mp3'))
    await user.click(screen.getByTestId('src-srt'))
    expect(onChange).toHaveBeenCalledWith({ mp3Path: MP3, srtPath: SRT })
  })

  it('다이얼로그 문구를 함께 보낸다 — main은 번역할 수 없다', async () => {
    const user = userEvent.setup()
    const { onPick } = setup()
    await user.click(screen.getByTestId('src-mp3'))
    expect(onPick).toHaveBeenCalledWith(expect.objectContaining({ kind: 'mp3', title: expect.any(String), filterName: expect.any(String) }))
  })

  it('다이얼로그를 취소하면 아무것도 안 바뀐다', async () => {
    const user = userEvent.setup()
    const onChange = vi.fn()
    render(<SpeakerAudioSource source={null} onPick={vi.fn(async () => ({ canceled: true }))} onChange={onChange} resolvePath={resolvePath} />)
    await user.click(screen.getByTestId('src-mp3'))
    expect(onChange).not.toHaveBeenCalled()
  })

  // ── 지정된 출처 ──
  it('지정된 출처는 파일명과 해제 버튼을 보여준다', () => {
    setup({ source: { mp3Path: MP3, srtPath: SRT } })
    expect(screen.getByTestId('src-mp3')).toHaveTextContent('무한야담2.mp3')
    expect(screen.getByTestId('src-srt')).toHaveTextContent('무한야담2.srt')
    expect(screen.getByTestId('src-clear')).toBeInTheDocument()
    expect(screen.queryByTestId('src-need')).not.toBeInTheDocument()
  })

  it('파일명만 보여주고 전체 경로는 title로 준다', () => {
    setup({ source: { mp3Path: MP3, srtPath: SRT } })
    expect(screen.getByTestId('src-mp3')).toHaveAttribute('title', MP3)
  })

  it('해제하면 null을 올린다 — TTS로 되돌아간다', async () => {
    const user = userEvent.setup()
    const { onChange } = setup({ source: { mp3Path: MP3, srtPath: SRT } })
    await user.click(screen.getByTestId('src-clear'))
    expect(onChange).toHaveBeenCalledWith(null)
  })

  // ── 교체(다시 놓기) ──
  // "다시 하려면 다시 놓으면 된다"가 성립하는지. 지문이 바뀌면 ⑤가 자동으로 다시 자른다.
  it('지정된 출처 위에 새 mp3+SRT를 놓으면 통째로 교체한다', () => {
    const { onChange } = setup({ source: { mp3Path: MP3, srtPath: SRT } })
    const r2 = (f) => ({ 'ep3.mp3': 'C:\\b\\ep3.mp3', 'ep3.srt': 'C:\\b\\ep3.srt' }[f.name] || '')
    render(<SpeakerAudioSource source={{ mp3Path: MP3, srtPath: SRT }} onPick={vi.fn()} onChange={onChange} resolvePath={r2} />)
    drop(screen.getAllByTestId('speaker-audio-source')[1], [{ name: 'ep3.mp3' }, { name: 'ep3.srt' }])
    expect(onChange).toHaveBeenCalledWith({ mp3Path: 'C:\\b\\ep3.mp3', srtPath: 'C:\\b\\ep3.srt' })
  })

  // 한쪽만 바꾸는 건 정당한 사용이다(오디오만 다시 뽑고 자막은 그대로). 짝이 안 맞으면 ⑤가
  // story-audio-import-unmatched로 시끄럽게 막으므로 조용히 틀리진 않는다.
  it('mp3만 놓으면 기존 SRT와 짝지어 올린다 — 한쪽만 교체하는 것도 정당하다', () => {
    const onChange = vi.fn()
    const r2 = (f) => (f.name === 'ep3.mp3' ? 'C:\\b\\ep3.mp3' : '')
    render(<SpeakerAudioSource source={{ mp3Path: MP3, srtPath: SRT }} onPick={vi.fn()} onChange={onChange} resolvePath={r2} />)
    drop(screen.getByTestId('speaker-audio-source'), [{ name: 'ep3.mp3' }])
    expect(onChange).toHaveBeenCalledWith({ mp3Path: 'C:\\b\\ep3.mp3', srtPath: SRT })
  })

  it('경로를 못 얻으면 "파일 종류가 틀렸다"가 아니라 경로 문제라고 말한다', () => {
    const { onChange } = setup()
    drop(screen.getByTestId('speaker-audio-source'), [{ name: '무한야담2.mp3' }]) // resolvePath가 ''를 반환하는 상황
    render(<SpeakerAudioSource source={null} onPick={vi.fn()} onChange={onChange} resolvePath={() => ''} />)
    const zones = screen.getAllByTestId('speaker-audio-source')
    drop(zones[zones.length - 1], [{ name: '무한야담2.mp3' }])
    expect(screen.getAllByRole('alert').at(-1)).toHaveTextContent('파일 경로를 읽지 못했습니다')
  })

  it('I18nProvider 없이 렌더된다 — t는 prop이지 훅이 아니다', () => {
    expect(() => render(<SpeakerAudioSource source={null} onPick={vi.fn()} onChange={vi.fn()} />)).not.toThrow()
  })
})
