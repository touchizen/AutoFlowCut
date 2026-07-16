import { fireEvent, render, screen, within } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import EmptyReferenceGateModal from '../../src/components/EmptyReferenceGateModal'
import { I18nProvider } from '../../src/hooks/useI18n'

const cards = [
  {
    key: 'id:hero-1',
    ref: {
      id: 'hero-1',
      name: 'Alex',
      type: 'character',
      prompt: 'cinematic portrait',
    },
    hasPrompt: true,
    occurrences: [
      { sceneId: 'scene-1', sceneIndex: 0 },
      { sceneId: 'scene-3', sceneIndex: 2 },
    ],
  },
  {
    key: 'id:place-2',
    ref: {
      id: 'place-2',
      name: 'Empty Place',
      type: 'scene',
      prompt: '',
    },
    hasPrompt: false,
    occurrences: [{ sceneId: 'scene-2', sceneIndex: 1 }],
  },
]

function renderModal(props = {}) {
  localStorage.setItem('autoflowcut_lang', 'ko')
  return render(
    <I18nProvider>
      <EmptyReferenceGateModal
        phase="confirm"
        items={cards}
        failure={null}
        onChoose={vi.fn()}
        onAcknowledge={vi.fn()}
        {...props}
      />
    </I18nProvider>
  )
}

const closeAffordances = ['✕ 닫기 버튼', '오버레이']

function dismissThroughSharedModal(affordance) {
  if (affordance === '✕ 닫기 버튼') {
    fireEvent.click(screen.getByRole('button', { name: '✕' }))
    return
  }

  const overlay = document.body.querySelector('.modal-overlay')
  expect(overlay).not.toBeNull()
  fireEvent.click(overlay)
}

describe('EmptyReferenceGateModal', () => {
  it('confirm에서 coordinator 카드의 이름, 타입, ID와 참조 씬 번호를 표시한다', () => {
    renderModal()

    expect(screen.getByText('Alex')).toBeInTheDocument()
    expect(screen.getByText('character · ID: hero-1')).toBeInTheDocument()
    expect(screen.getByText('참조 씬: #1, #3')).toBeInTheDocument()
  })

  it('confirm에서 프롬프트 없는 카드에 자동 생성 제외 경고를 표시한다', () => {
    renderModal()

    const row = screen.getByText('Empty Place').closest('li')
    expect(row).not.toBeNull()
    expect(within(row).getByText('⚠ 프롬프트 없음 — 자동 생성 제외')).toBeInTheDocument()
  })

  it('생성 가능한 카드가 없으면 먼저 생성 버튼을 비활성화하고 안내한다', () => {
    renderModal({ items: [cards[1]] })

    expect(screen.getByRole('button', {
      name: '빈카드 먼저 생성 → 씬 생성',
    })).toBeDisabled()
    expect(screen.getByText(
      '자동 생성 가능한 빈카드가 없습니다. 프롬프트를 추가하거나 "제외하고 씬만 생성"을 선택하세요.'
    )).toBeInTheDocument()
  })

  it('confirm의 세 버튼은 각 선택 값을 onChoose로 전달한다', () => {
    const onChoose = vi.fn()
    renderModal({ onChoose })

    fireEvent.click(screen.getByRole('button', {
      name: '빈카드 먼저 생성 → 씬 생성',
    }))
    fireEvent.click(screen.getByRole('button', {
      name: '제외하고 씬만 생성',
    }))
    fireEvent.click(screen.getByRole('button', { name: '취소' }))

    expect(onChoose.mock.calls.map(([choice]) => choice)).toEqual([
      'generate-first',
      'exclude',
      'cancel',
    ])
  })

  it('busy에서는 세 선택 버튼을 모두 비활성화한다', () => {
    renderModal({ phase: 'busy' })

    const buttons = [
      screen.getByRole('button', { name: '빈카드 먼저 생성 → 씬 생성' }),
      screen.getByRole('button', { name: '제외하고 씬만 생성' }),
      screen.getByRole('button', { name: '취소' }),
    ]
    for (const button of buttons) {
      expect(button).toBeDisabled()
    }
  })

  it('busy에서 연속 클릭해도 onChoose를 추가 호출하지 않는다', () => {
    const onChoose = vi.fn()
    const { rerender } = renderModal({ onChoose })

    fireEvent.click(screen.getByRole('button', {
      name: '빈카드 먼저 생성 → 씬 생성',
    }))
    expect(onChoose).toHaveBeenCalledTimes(1)

    rerender(
      <I18nProvider>
        <EmptyReferenceGateModal
          phase="busy"
          items={cards}
          failure={null}
          onChoose={onChoose}
          onAcknowledge={vi.fn()}
        />
      </I18nProvider>
    )

    const buttons = [
      screen.getByRole('button', { name: '빈카드 먼저 생성 → 씬 생성' }),
      screen.getByRole('button', { name: '제외하고 씬만 생성' }),
      screen.getByRole('button', { name: '취소' }),
    ]
    for (const button of buttons) {
      fireEvent.click(button)
      fireEvent.click(button)
    }

    expect(onChoose).toHaveBeenCalledTimes(1)
  })

  it('failure에서 카드별 stage와 원인, 씬 미시작 안내와 확인 버튼을 표시한다', () => {
    renderModal({
      phase: 'failure',
      failure: {
        outcome: 'failed',
        failures: [
          { key: 'id:hero-1', stage: 'save', error: 'disk full' },
          { key: 'id:place-2', stage: 'postcondition', error: 'missing-prompt' },
        ],
      },
    })

    const alexFailure = screen.getByText('Alex').closest('li')
    const placeFailure = screen.getByText('Empty Place').closest('li')
    expect(within(alexFailure).getByText('저장')).toBeInTheDocument()
    expect(within(alexFailure).getByText('disk full')).toBeInTheDocument()
    expect(within(placeFailure).getByText('후속 검증')).toBeInTheDocument()
    expect(within(placeFailure).getByText('missing-prompt')).toBeInTheDocument()
    expect(screen.getByText('씬 배치는 시작되지 않았습니다.')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '확인' })).toBeInTheDocument()
  })

  it('failure의 확인 버튼은 onAcknowledge를 한 번 호출한다', () => {
    const onAcknowledge = vi.fn()
    renderModal({
      phase: 'failure',
      failure: {
        outcome: 'stopped',
        failures: [],
      },
      onAcknowledge,
    })

    fireEvent.click(screen.getByRole('button', { name: '확인' }))

    expect(onAcknowledge).toHaveBeenCalledTimes(1)
  })

  it('동명 카드는 ref의 타입과 ID를 함께 표시해 구분한다', () => {
    renderModal({
      items: [
        {
          key: 'id:char-1',
          ref: { id: 'char-1', name: 'Echo', type: 'character', prompt: 'p' },
          hasPrompt: true,
          occurrences: [{ sceneId: 'scene-1', sceneIndex: 0 }],
        },
        {
          key: 'id:scene-2',
          ref: { id: 'scene-2', name: 'Echo', type: 'scene', prompt: 'p' },
          hasPrompt: true,
          occurrences: [{ sceneId: 'scene-2', sceneIndex: 1 }],
        },
      ],
    })

    expect(screen.getAllByText('Echo')).toHaveLength(2)
    expect(screen.getByText('character · ID: char-1')).toBeInTheDocument()
    expect(screen.getByText('scene · ID: scene-2')).toBeInTheDocument()
  })

  it.each(closeAffordances)(
    'confirm의 %s 닫기는 coordinator confirm promise를 cancel로 resolve해 latch 데드락을 막는다',
    affordance => {
      const onChoose = vi.fn()
      const onAcknowledge = vi.fn()
      renderModal({ phase: 'confirm', onChoose, onAcknowledge })

      dismissThroughSharedModal(affordance)

      expect(onChoose).toHaveBeenCalledTimes(1)
      expect(onChoose).toHaveBeenCalledWith('cancel')
      expect(onAcknowledge).not.toHaveBeenCalled()
    }
  )

  // busy 는 ref 배치가 in-flight 라 coordinator 에게 돌려줄 안전한 답이 없다 → 닫기 자체를 없앤다.
  // ✕ 를 그려놓고 무반응으로 두면(공용 Modal 의 옛 동작) 사용자는 앱이 멈춘 줄 안다.
  it('busy에는 닫기(✕)가 아예 없다 — 눌러도 반응 없는 죽은 컨트롤을 두지 않는다', () => {
    renderModal({ phase: 'busy' })

    expect(screen.queryByText('✕')).not.toBeInTheDocument()
    expect(screen.getByText('레퍼런스 생성 중...')).toBeInTheDocument()
  })

  it('busy의 오버레이 클릭은 coordinator promise를 잘못 resolve하지 않는다', () => {
    const onChoose = vi.fn()
    const onAcknowledge = vi.fn()
    renderModal({ phase: 'busy', onChoose, onAcknowledge })

    dismissThroughSharedModal('오버레이')

    expect(onChoose).not.toHaveBeenCalled()
    expect(onAcknowledge).not.toHaveBeenCalled()
    expect(screen.getByText('레퍼런스 생성 중...')).toBeInTheDocument()
  })

  it.each(closeAffordances)(
    'failure의 %s 닫기는 coordinator failure promise를 acknowledge해 latch 데드락을 막는다',
    affordance => {
      const onChoose = vi.fn()
      const onAcknowledge = vi.fn()
      renderModal({
        phase: 'failure',
        failure: {
          outcome: 'failed',
          failures: [],
        },
        onChoose,
        onAcknowledge,
      })

      dismissThroughSharedModal(affordance)

      expect(onAcknowledge).toHaveBeenCalledTimes(1)
      expect(onChoose).not.toHaveBeenCalled()
    }
  )
})
