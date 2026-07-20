import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import UpscaylDialog from '../../src/components/UpscaylDialog.jsx'
import { I18nProvider } from '../../src/hooks/useI18n.jsx'

const scene = (id, extra = {}) => ({
  id,
  status: 'done',
  imagePath: `/scenes/${id}.png`,
  ...extra,
})

const scenes = [
  scene('eligible'),
  scene('already', { upscaledAt: 123 }),
  scene('base64-only', { imagePath: null, image: 'BASE64' }),
  scene('pending', { status: 'pending' }),
]

function upscayl(extra = {}) {
  return {
    scenes,
    running: false,
    current: 0,
    total: 0,
    currentSceneId: null,
    failures: [],
    skipped: 0,
    startBatch: vi.fn().mockResolvedValue({ ok: true }),
    cancel: vi.fn().mockResolvedValue({ ok: true }),
    ...extra,
  }
}

function renderDialog(props = {}) {
  return render(
    <I18nProvider>
      <UpscaylDialog
        isOpen
        onClose={vi.fn()}
        targetSceneIds={null}
        upscayl={upscayl()}
        detectState={{
          ok: true,
          platform: 'darwin',
          models: ['ultrasharp-4x', 'remacri-4x'],
        }}
        onDetect={vi.fn()}
        onLocate={vi.fn()}
        {...props}
      />
    </I18nProvider>,
  )
}

describe('UpscaylDialog 감지 상태', () => {
  beforeEach(() => {
    window.electronAPI.openExternal.mockResolvedValue({ ok: true })
  })

  it.each([
    ['missing', 'Upscayl is not installed'],
    ['no-models', 'Upscayl models were not found'],
  ])('%s 상태에서 설치 안내와 Locate/Re-check를 제공한다', (reason, message) => {
    const onLocate = vi.fn()
    const onDetect = vi.fn()
    renderDialog({ detectState: { ok: false, reason, platform: 'darwin' }, onLocate, onDetect })

    expect(screen.getByText(message)).toBeInTheDocument()
    expect(screen.getByText(/brew install --cask upscayl/)).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Open upscayl.org' }))
    fireEvent.click(screen.getByRole('button', { name: 'Locate' }))
    fireEvent.click(screen.getByRole('button', { name: 'Re-check' }))

    expect(window.electronAPI.openExternal).toHaveBeenCalledWith('https://upscayl.org')
    expect(onLocate).toHaveBeenCalledTimes(1)
    expect(onDetect).toHaveBeenCalledTimes(1)
  })
})

describe('UpscaylDialog 준비 상태', () => {
  it('동적 모델과 대상/업스케일/파일없음 카운트를 표시한다', () => {
    renderDialog()

    expect(screen.getAllByRole('option').map((option) => option.textContent)).toEqual([
      'ultrasharp-4x',
      'remacri-4x',
    ])
    expect(screen.getByText('1 target · 1 already upscaled · 1 skipped (no file)')).toBeInTheDocument()
  })

  it('기억한 모델이 없으면 첫 모델로 폴백하고 선택/배율을 기억해 Start에 전달한다', async () => {
    localStorage.setItem('upscaylOptions', JSON.stringify({ model: 'missing-model', scale: 2 }))
    const batch = upscayl()
    renderDialog({
      upscayl: batch,
      detectState: { ok: true, platform: 'linux', models: ['realesrgan-x4plus', 'remacri-4x'] },
    })

    const select = screen.getByLabelText('Model')
    expect(select).toHaveValue('realesrgan-x4plus')
    expect(screen.getByLabelText('2x')).toBeChecked()

    fireEvent.change(select, { target: { value: 'remacri-4x' } })
    fireEvent.click(screen.getByLabelText('4x'))
    fireEvent.click(screen.getByRole('button', { name: 'Start' }))

    expect(batch.startBatch).toHaveBeenCalledWith(null, { model: 'remacri-4x', scale: 4 })
    await waitFor(() => {
      expect(JSON.parse(localStorage.getItem('upscaylOptions'))).toEqual({
        model: 'remacri-4x',
        scale: 4,
      })
    })
  })
})

describe('UpscaylDialog 실행과 완료 상태', () => {
  it('실행 중 진행/현재 씬을 표시하고 Cancel을 연결한다', () => {
    const batch = upscayl({ running: true, current: 2, total: 3, currentSceneId: 'scene_2' })
    renderDialog({ upscayl: batch })

    expect(screen.getByText('2 / 3')).toBeInTheDocument()
    expect(screen.getByText(/scene_2/)).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }))
    expect(batch.cancel).toHaveBeenCalledTimes(1)
  })

  it('시작한 배치가 끝나면 성공/실패 요약을 표시한다', () => {
    const batch = upscayl()
    const view = renderDialog({ upscayl: batch })
    fireEvent.click(screen.getByRole('button', { name: 'Start' }))

    view.rerender(
      <I18nProvider>
        <UpscaylDialog
          isOpen
          onClose={vi.fn()}
          targetSceneIds={null}
          upscayl={upscayl({ total: 3, current: 3, failures: [{ sceneId: 'scene_2', error: 'GPU' }] })}
          detectState={{ ok: true, platform: 'darwin', models: ['ultrasharp-4x'] }}
          onDetect={vi.fn()}
          onLocate={vi.fn()}
        />
      </I18nProvider>,
    )

    expect(screen.getByText('2 succeeded · 1 failed')).toBeInTheDocument()
  })
})
