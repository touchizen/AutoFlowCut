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

describe('EmptyReferenceGateModal — busy 는 Flow 뷰를 가리면 안 된다', () => {
  // Flow 생성은 WebContentsView 의 DOM 을 sendInputEvent 로 태워서 동작한다. 그런데 모달이
  // 열리면 electron/ipc/layout.js:25-27 이 Flow 뷰를 0×0 으로 줄인다 — 찍을 좌표가 사라져
  // 자동화가 죽는다. busy 모달을 띄우면 자기가 기다리는 생성을 자기가 막는 데드락이 되고,
  // Stop 도 Flow 드라이버 안에 매달린 await 를 깨지 못해 무반응이 된다.
  // 그래서 busy 동안엔 아무것도 렌더하지 않는다 — 진행 상황은 레퍼런스 카드가, 중지는 앱의
  // Stop 버튼이 담당한다. (jsdom 엔 WebContentsView 가 없어 실앱 눈검증에서만 드러났다.)
  it('busy 에서는 모달을 렌더하지 않는다', () => {
    renderModal({ phase: 'busy' })

    expect(document.body.querySelector('.modal-overlay')).toBeNull()
  })

  it('busy 에서는 Flow 뷰 숨김을 획득하지 않는다', () => {
    const setModalVisible = vi.fn()
    window.electronAPI.setModalVisible = setModalVisible

    renderModal({ phase: 'busy' })

    expect(setModalVisible).not.toHaveBeenCalledWith({ visible: true })
  })

  it('confirm 과 failure 는 정상적으로 렌더된다 (그때는 자동화가 안 돌아 숨겨도 안전)', () => {
    const setModalVisible = vi.fn()
    window.electronAPI.setModalVisible = setModalVisible

    renderModal({ phase: 'confirm' })

    expect(document.body.querySelector('.modal-overlay')).not.toBeNull()
    expect(setModalVisible).toHaveBeenCalledWith({ visible: true })
  })
})

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
