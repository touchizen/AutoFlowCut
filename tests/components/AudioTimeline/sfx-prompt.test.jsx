/**
 * AudioTimeline SFX prompt metadata 통합 테스트
 *
 * `audioPackage.sfxPromptMap`이 있을 때 SFX file row에 anchor / placement /
 * prompt / duration이 보이는지, 메타데이터가 없는 row는 기존 디스플레이를
 * 유지하는지 검증.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render as rtlRender, screen, fireEvent } from '@testing-library/react'
import AudioTimeline from '../../../src/components/AudioTimeline/AudioTimeline'
import { I18nProvider } from '../../../src/hooks/useI18n'

const render = (ui, options) => rtlRender(<I18nProvider>{ui}</I18nProvider>, options)

// 한 카테고리에 메타데이터 있는 파일 + 없는 파일을 섞어 둠
const audioPackage = {
  folderPath: '/audio',
  media: {
    video: { path: '/audio/narration.mp3', filename: 'narration.mp3', durationMs: 60000 },
  },
  voices: [],
  sfx: [
    {
      category: '_media',
      files: [
        // sfxPromptMap에 stem이 등록된 파일 (디스크 파일명에 _MMSS 접미사)
        { filename: '01_bell_toll_0030.mp3', path: '/sfx/01_bell_toll_0030.mp3', timecodeMs: 30000, durationMs: 3000 },
        // sfxPromptMap에 stem이 없는 파일 (orphan SFX — 폴백 디스플레이)
        { filename: '99_unknown_0100.mp3', path: '/sfx/99_unknown_0100.mp3', timecodeMs: 60000, durationMs: 1000 },
      ],
    },
  ],
  sfxPromptMap: {
    '01_bell_toll': {
      cueNo: 1,
      partName: 'setup',
      anchor: 'the church bell struck',
      placement: 'concurrent',
      offsetSec: 0,
      prompt: 'Distant church bell tolling slowly at dusk',
      durationSec: 3,
    },
  },
}

const scenes = []
const srtEntries = []

beforeEach(() => {
  global.window.electronAPI = {
    readFileAbsolute: vi.fn().mockResolvedValue({ success: false }),
  }
  window.HTMLMediaElement.prototype.play = vi.fn().mockResolvedValue(undefined)
  window.HTMLMediaElement.prototype.pause = vi.fn()
})

describe('AudioTimeline — SFX prompt metadata', () => {
  function expandToFileRows(container) {
    // SFX 트랙 → _media 카테고리 펼치기
    fireEvent.click(screen.getByText('SFX'))
    fireEvent.click(screen.getByText('_media'))
    return container
  }

  it('renders anchor / placement / prompt / duration on rows with sfxPromptMap match', () => {
    const { container } = render(
      <AudioTimeline audioPackage={audioPackage} scenes={scenes} srtEntries={srtEntries} />
    )
    expandToFileRows(container)

    // anchor 텍스트 (큰따옴표로 감싸 렌더)
    expect(screen.getByText('"the church bell struck"')).toBeInTheDocument()
    // placement (concurrent — offset 0이므로 @ 표시 없음)
    expect(screen.getByText(/concurrent/)).toBeInTheDocument()
    // prompt
    expect(screen.getByText('Distant church bell tolling slowly at dusk')).toBeInTheDocument()
    // duration
    expect(screen.getByText('3s')).toBeInTheDocument()
  })

  it('does NOT render metadata on rows with no sfxPromptMap match (orphan SFX)', () => {
    const { container } = render(
      <AudioTimeline audioPackage={audioPackage} scenes={scenes} srtEntries={srtEntries} />
    )
    expandToFileRows(container)

    // 파일명만 표시 (메타데이터 등 없음)
    const orphanRow = container.querySelector('[title="99_unknown_0100.mp3"]')
    expect(orphanRow).not.toBeNull()
    expect(orphanRow.querySelector('.atl-sfx-meta')).toBeNull()
    expect(orphanRow.className).not.toContain('atl-label-file-sfx-meta')
  })

  it('applies atl-label-file-sfx-meta class only to rows with metadata', () => {
    const { container } = render(
      <AudioTimeline audioPackage={audioPackage} scenes={scenes} srtEntries={srtEntries} />
    )
    expandToFileRows(container)

    const metaRows = container.querySelectorAll('.atl-label-file-sfx-meta')
    expect(metaRows.length).toBe(1) // 01_bell_toll만 매치
  })

  it('renders placement offset (e.g. "before @ +0.5s") when offsetSec > 0', () => {
    const pkg = {
      ...audioPackage,
      sfx: [
        {
          category: '_media',
          files: [
            { filename: '02_door_creak_0045.mp3', path: '/sfx/02.mp3', timecodeMs: 45000, durationMs: 2000 },
          ],
        },
      ],
      sfxPromptMap: {
        '02_door_creak': {
          cueNo: 2,
          partName: 'setup',
          anchor: 'the door swung open',
          placement: 'before',
          offsetSec: 0.5,
          prompt: 'Heavy wooden door creaking open',
          durationSec: 2,
        },
      },
    }
    const { container } = render(
      <AudioTimeline audioPackage={pkg} scenes={scenes} srtEntries={srtEntries} />
    )
    fireEvent.click(screen.getByText('SFX'))
    fireEvent.click(screen.getByText('_media'))

    // "▶ before @ +0.5s"
    expect(screen.getByText(/before @ \+0\.5s/)).toBeInTheDocument()
  })

  it('gracefully handles audioPackage with NO sfxPromptMap field (legacy / SFX-skip mode)', () => {
    const pkg = {
      ...audioPackage,
      sfxPromptMap: undefined,
    }
    const { container } = render(
      <AudioTimeline audioPackage={pkg} scenes={scenes} srtEntries={srtEntries} />
    )
    fireEvent.click(screen.getByText('SFX'))
    fireEvent.click(screen.getByText('_media'))

    // 메타데이터 row 없음 — 둘 다 폴백 디스플레이
    const metaRows = container.querySelectorAll('.atl-label-file-sfx-meta')
    expect(metaRows.length).toBe(0)
  })

  it('handles Korean filenames + Korean anchor (UTF-8 stem matching)', () => {
    const pkg = {
      folderPath: '/audio',
      media: { video: { path: '/audio/n.mp3', filename: 'n.mp3', durationMs: 60000 } },
      voices: [],
      sfx: [
        {
          category: '_media',
          files: [
            { filename: '01_주판_구슬_튕기기_0030.mp3', path: '/sfx/abacus.mp3', timecodeMs: 30000, durationMs: 3000 },
          ],
        },
      ],
      sfxPromptMap: {
        '01_주판_구슬_튕기기': {
          cueNo: 1,
          partName: '기',
          anchor: '주판알이 튕기며',
          placement: 'concurrent',
          offsetSec: 0,
          prompt: 'Wooden abacus beads clicking gently',
          durationSec: 3,
        },
      },
    }
    const { container } = render(
      <AudioTimeline audioPackage={pkg} scenes={scenes} srtEntries={srtEntries} />
    )
    fireEvent.click(screen.getByText('SFX'))
    fireEvent.click(screen.getByText('_media'))

    expect(screen.getByText('"주판알이 튕기며"')).toBeInTheDocument()
    expect(screen.getByText('Wooden abacus beads clicking gently')).toBeInTheDocument()
  })

  it('still allows clicking a metadata-bearing file row to jump (existing behavior preserved)', () => {
    const { container } = render(
      <AudioTimeline audioPackage={audioPackage} scenes={scenes} srtEntries={srtEntries} />
    )
    expandToFileRows(container)

    const metaRow = container.querySelector('.atl-label-file-sfx-meta')
    expect(metaRow).not.toBeNull()
    // 클릭 → playhead 이동 (no throw)
    fireEvent.click(metaRow)
    const playhead = container.querySelector('.atl-playhead')
    expect(playhead).not.toBeNull()
  })
})
