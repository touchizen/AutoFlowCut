/**
 * MediaMetaBar — 상세 모달 메타 정보 한 줄 표시 + expand 토글
 *
 * 검증:
 *   - 데이터 없으면 자동 숨김 (필드별)
 *   - 모든 데이터 누락 시 컴포넌트 자체 null 반환
 *   - model 있을 때만 expand 토글 노출
 *   - 토글 클릭으로 secondary 영역 보였다 사라짐
 *   - seed 클릭 시 클립보드 복사
 *   - i18n: t() 가 키 자체를 반환할 때 fallback 작동 (회귀 방지)
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'

// toast 모킹 — clipboard 성공/실패 알림
const mockToastSuccess = vi.fn()
const mockToastError = vi.fn()
vi.mock('../../src/components/Toast', () => ({
  toast: {
    success: (...a) => mockToastSuccess(...a),
    error: (...a) => mockToastError(...a)
  }
}))

import MediaMetaBar from '../../src/components/MediaMetaBar'

beforeEach(() => {
  vi.clearAllMocks()
  // navigator.clipboard 모킹
  Object.defineProperty(navigator, 'clipboard', {
    value: { writeText: vi.fn().mockResolvedValue(undefined) },
    writable: true,
    configurable: true
  })
})

describe('MediaMetaBar — 데이터 없을 때 자동 숨김', () => {
  it('모든 필드가 비어있으면 컴포넌트 자체 null 반환', () => {
    const { container } = render(<MediaMetaBar />)
    expect(container.firstChild).toBeNull()
  })

  it('size 만 있으면 size 만 표시', () => {
    render(<MediaMetaBar width={1280} height={720} />)
    expect(screen.getByText('1280 × 720')).toBeInTheDocument()
    // 다른 필드 없음
    expect(screen.queryByText(/🌱/)).not.toBeInTheDocument()
    expect(screen.queryByText(/🕒/)).not.toBeInTheDocument()
  })

  it('size 없이 seed 만 있어도 정상 렌더', () => {
    render(<MediaMetaBar seed={12345} />)
    expect(screen.getByText(/12345/)).toBeInTheDocument()
  })

  it('width 가 0 이면 size 안 그림', () => {
    render(<MediaMetaBar width={0} height={720} />)
    expect(screen.queryByText(/× 720/)).not.toBeInTheDocument()
  })

  it('duration 이 0 이면 안 그림', () => {
    render(<MediaMetaBar duration={0} />)
    expect(screen.queryByText(/0s/)).not.toBeInTheDocument()
  })
})

describe('MediaMetaBar — 정상 표시', () => {
  it('size + duration + fileSize + seed + time 모두 표시', () => {
    render(
      <MediaMetaBar
        width={1280}
        height={720}
        duration={3.2}
        fileSize="1.8 MB"
        seed={12345}
        generatedAt={Date.now() - 60_000}
      />
    )
    expect(screen.getByText('1280 × 720')).toBeInTheDocument()
    expect(screen.getByText('3.2s')).toBeInTheDocument()
    expect(screen.getByText('1.8 MB')).toBeInTheDocument()
    expect(screen.getByText(/12345/)).toBeInTheDocument()
    expect(screen.getByText(/🕒/)).toBeInTheDocument()
  })

  it('seed click 시 navigator.clipboard.writeText + toast.success', async () => {
    render(<MediaMetaBar seed={777} />)
    const seedBtn = screen.getByText(/777/)

    await fireEvent.click(seedBtn)
    // microtask flush
    await new Promise(r => setTimeout(r, 0))

    expect(navigator.clipboard.writeText).toHaveBeenCalledWith('777')
    expect(mockToastSuccess).toHaveBeenCalled()
  })

  it('onCopySeed prop 우선 사용 (clipboard 직접 호출 안 함)', async () => {
    const onCopySeed = vi.fn()
    render(<MediaMetaBar seed={999} onCopySeed={onCopySeed} />)
    fireEvent.click(screen.getByText(/999/))

    expect(onCopySeed).toHaveBeenCalledWith(999)
    expect(navigator.clipboard.writeText).not.toHaveBeenCalled()
  })
})

describe('MediaMetaBar — expand 토글 (model)', () => {
  it('model 없으면 toggle 버튼 노출 안 됨', () => {
    render(<MediaMetaBar width={100} height={100} seed={1} />)
    expect(screen.queryByText('▼')).not.toBeInTheDocument()
    expect(screen.queryByText('▲')).not.toBeInTheDocument()
  })

  it('model 있으면 ▼ 토글 노출', () => {
    render(<MediaMetaBar width={100} height={100} model="flow" />)
    expect(screen.getByText('▼')).toBeInTheDocument()
  })

  it('▼ 클릭 시 model 표시 + ▲ 로 변경', () => {
    render(<MediaMetaBar width={100} height={100} model="flow" />)

    // 초기엔 model 안 보임
    expect(screen.queryByText(/flow/)).not.toBeInTheDocument()

    fireEvent.click(screen.getByText('▼'))

    // 펼쳐진 후 보임
    expect(screen.getByText(/flow/)).toBeInTheDocument()
    expect(screen.getByText('▲')).toBeInTheDocument()

    // 다시 누르면 닫힘
    fireEvent.click(screen.getByText('▲'))
    expect(screen.queryByText(/flow/)).not.toBeInTheDocument()
    expect(screen.getByText('▼')).toBeInTheDocument()
  })

  it('veo 모델은 name + version 분리 표시', () => {
    render(<MediaMetaBar width={1} height={1} model="veo_3_1_t2v_fast" />)
    fireEvent.click(screen.getByText('▼'))
    expect(screen.getByText(/veo \/ t2v fast/)).toBeInTheDocument()
    expect(screen.getByText(/v3\.1/)).toBeInTheDocument()
  })

  it('primary 다 비고 model 만 있어도 toggle 표시', () => {
    const { container } = render(<MediaMetaBar model="flow" />)
    expect(container.firstChild).not.toBeNull()
    expect(screen.getByText('▼')).toBeInTheDocument()
  })
})

describe('MediaMetaBar — i18n fallback (회귀 방지)', () => {
  // 회귀 방지: t() 가 키를 못 찾을 때 키 자체를 반환하면
  // `${20}${'mediaMeta.hrAgo'}` 같이 깨진 텍스트가 노출되던 버그 방어.
  it('t() 가 키를 그대로 반환해도 fallback 으로 정상 표시', () => {
    const tEchoesKey = (key) => key  // 키 → 키 (i18n 미존재 시 동작)

    render(
      <MediaMetaBar
        seed={42}
        generatedAt={Date.now() - 2 * 60 * 60 * 1000}  // 2시간 전
        t={tEchoesKey}
      />
    )

    // "20mediaMeta.hrAgo" 같은 깨진 출력이 없어야 함
    const text = document.body.textContent
    expect(text).not.toMatch(/mediaMeta\.[a-zA-Z]+/)
    // 영어 fallback 으로 떨어져야
    expect(text).toMatch(/h ago|m ago|just now/)
  })

  it('t() 가 정상 번역 반환 시 그 번역 사용', () => {
    const tKorean = (key) => {
      const dict = {
        'mediaMeta.justNow': '방금 전',
        'mediaMeta.hrAgo': '시간 전',
        'mediaMeta.minAgo': '분 전',
        'mediaMeta.dayAgo': '일 전',
        'mediaMeta.copySeed': 'Seed 복사'
      }
      return dict[key] || key
    }

    render(
      <MediaMetaBar
        generatedAt={Date.now() - 2 * 60 * 60 * 1000}
        t={tKorean}
      />
    )
    expect(document.body.textContent).toMatch(/시간 전/)
  })

  it('t prop 자체 미주입 시에도 안전 (fallback 만 사용)', () => {
    render(<MediaMetaBar generatedAt={Date.now() - 30_000} />)
    // "just now" (영어 폴백)
    expect(document.body.textContent).toMatch(/just now/)
  })
})

describe('MediaMetaBar — 시간 포맷', () => {
  it('< 60초 → just now', () => {
    render(<MediaMetaBar generatedAt={Date.now() - 30_000} />)
    expect(document.body.textContent).toMatch(/just now/)
  })

  it('< 60분 → Nm ago', () => {
    render(<MediaMetaBar generatedAt={Date.now() - 5 * 60 * 1000} />)
    expect(document.body.textContent).toMatch(/5m ago/)
  })

  it('< 24시간 → Nh ago', () => {
    render(<MediaMetaBar generatedAt={Date.now() - 10 * 60 * 60 * 1000} />)
    expect(document.body.textContent).toMatch(/10h ago/)
  })

  it('< 7일 → Nd ago', () => {
    render(<MediaMetaBar generatedAt={Date.now() - 3 * 24 * 60 * 60 * 1000} />)
    expect(document.body.textContent).toMatch(/3d ago/)
  })

  it('> 7일 → ISO date (YYYY-MM-DD)', () => {
    render(<MediaMetaBar generatedAt={Date.now() - 30 * 24 * 60 * 60 * 1000} />)
    expect(document.body.textContent).toMatch(/\d{4}-\d{2}-\d{2}/)
  })

  it('미래 timestamp → null (시간 표시 자체 안 함)', () => {
    render(<MediaMetaBar generatedAt={Date.now() + 60_000} />)
    expect(screen.queryByText(/🕒/)).not.toBeInTheDocument()
  })
})
