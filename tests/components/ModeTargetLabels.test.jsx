import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import { readFile } from 'node:fs/promises'
import path from 'node:path'
import ModeToggle from '../../src/components/ModeToggle.jsx'
import SceneTab from '../../src/components/settings/SceneTab.jsx'
import DisplayTab from '../../src/components/settings/DisplayTab.jsx'

const t = (key) => ({
  'modeInfo.flow.name': 'Flow 로그인 모드',
  'modeInfo.api.name': 'API 키 모드',
  'settings.layoutMode': '레이아웃',
  'settings.layoutSplitLeft': 'Flow 왼쪽',
  'settings.layoutSplitRight': 'Flow 오른쪽',
  'settings.layoutSplitTop': 'Flow 상단',
  'settings.layoutSplitBottom': 'Flow 하단',
}[key] || key)

vi.mock('../../src/contexts/ModeContext.jsx', () => ({
  useMode: () => ({ mode: 'flow', setMode: vi.fn() }),
}))
vi.mock('../../src/hooks/useI18n', () => ({ useI18n: () => ({ t }) }))

const settings = {
  generation: { image: { provider: 'google' }, video: { t2v: { provider: 'google' }, i2v: { provider: 'google' } } },
  imageModel: 'image-model', videoModelT2V: 't2v-model', videoModelF2V: 'i2v-model',
  aspectRatio: '16:9', defaultDuration: 5,
}

const imageModels = [{ id: 'image-model', label: 'Image', cost: '$0.04', provider: 'google' }]
const videoModels = [
  { id: 't2v-model', label: 'T2V', cost: '$0.10', provider: 'google' },
  { id: 'i2v-model', label: 'I2V', cost: '$0.40', provider: 'google' },
]

describe('mode/target labels', () => {
  it('ModeToggle says Flow Login Mode', () => {
    render(<ModeToggle />)
    expect(screen.getByText('Flow 로그인 모드')).toBeTruthy()
  })

  it('keeps image, T2V, and I2V on their Flow labels for the Flow route', () => {
    render(<SceneTab localSettings={settings} setLocalSettings={vi.fn()} t={t} appMode="flow" sessionTarget="flow" imageModels={imageModels} videoModels={videoModels} />)

    expect(screen.getByTestId('image-provider-badge')).toHaveTextContent('Google Flow')
    expect(screen.getByTestId('t2v-provider-badge')).toHaveTextContent('Google Flow')
    expect(screen.getByTestId('i2v-provider-badge')).toHaveTextContent('Google Flow')
    expect(document.querySelectorAll('[title="https://one.google.com/about/google-ai-plans/"]')).toHaveLength(3)
  })

  it('does not render empty provider-price spans for the Flow route', () => {
    const unpricedImages = imageModels.map(({ cost: _cost, ...model }) => model)
    const unpricedVideos = videoModels.map(({ cost: _cost, ...model }) => model)
    render(<SceneTab localSettings={settings} setLocalSettings={vi.fn()} t={t} appMode="flow" sessionTarget="flow" imageModels={unpricedImages} videoModels={unpricedVideos} />)

    expect(screen.queryByTestId('image-provider-price')).toBeNull()
    expect(screen.queryByTestId('t2v-provider-price')).toBeNull()
    expect(screen.queryByTestId('i2v-provider-price')).toBeNull()
    expect(screen.getByTestId('image-provider-badge')).toHaveTextContent('Google Flow')
  })

  it('defines presentation for non-empty provider prices alongside the existing badge style', async () => {
    const css = await readFile(path.join(process.cwd(), 'src', 'App.css'), 'utf8')
    expect(css).toMatch(/\.model-mode-badge\s*\{/)
    expect(css).toMatch(/\.model-provider-price\s*\{/)
  })

  it('keeps all three stages on API labels, prices, and price links for the API route', () => {
    render(<SceneTab localSettings={settings} setLocalSettings={vi.fn()} t={t} appMode="api" sessionTarget="flow" imageModels={imageModels} videoModels={videoModels} />)

    expect(screen.getByTestId('image-provider-badge')).toHaveTextContent('API 키 모드')
    expect(screen.getByTestId('t2v-provider-badge')).toHaveTextContent('API 키 모드')
    expect(screen.getByTestId('i2v-provider-badge')).toHaveTextContent('API 키 모드')
    expect(screen.getByTestId('image-provider-price')).toHaveTextContent('$0.04')
    expect(screen.getByTestId('t2v-provider-price')).toHaveTextContent('$0.10')
    expect(screen.getByTestId('i2v-provider-price')).toHaveTextContent('$0.40')
    expect(document.querySelectorAll('[title="https://ai.google.dev/gemini-api/docs/pricing"]')).toHaveLength(3)
  })

  it('falls back to API video pricing metadata when the dynamic catalog has not landed yet', () => {
    const settingsFromFlowRoute = {
      ...settings,
      videoModelT2V: 'Veo 3.1 - Fast',
      videoModelF2V: 'Veo 3.1 - Quality',
    }
    render(<SceneTab localSettings={settingsFromFlowRoute} setLocalSettings={vi.fn()} t={t} appMode="api" sessionTarget="flow" imageModels={[]} videoModels={[]} />)

    expect(screen.getByTestId('t2v-provider-price')).toHaveTextContent('$0.10~')
    expect(screen.getByTestId('i2v-provider-price')).toHaveTextContent('$0.10~')
  })

  it('DisplayTab uses Flow layout labels in login mode', () => {
    window.electronAPI = { getPreventSleep: vi.fn().mockResolvedValue({ enabled: false }), getLayout: vi.fn().mockResolvedValue({ mode: 'split-left' }) }
    render(<DisplayTab t={t} appMode="flow" />)
    expect(screen.getByText('Flow 왼쪽')).toBeTruthy()
  })
})
