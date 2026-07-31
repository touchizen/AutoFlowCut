import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import ModeToggle from '../../src/components/ModeToggle.jsx'
import SceneTab from '../../src/components/settings/SceneTab.jsx'
import DisplayTab from '../../src/components/settings/DisplayTab.jsx'

const t = (key) => ({
  'modeInfo.flow.name': '로그인 모드',
  'modeInfo.api.name': 'API 키 모드',
  'sessionTarget.flow': 'Google Flow',
  'sessionTarget.chatgpt': 'ChatGPT',
  'settings.layoutMode': '세션 화면 배치',
  'settings.layoutSplitLeft': '세션 화면 왼쪽',
  'settings.layoutSplitRight': '세션 화면 오른쪽',
  'settings.layoutSplitTop': '세션 화면 상단',
  'settings.layoutSplitBottom': '세션 화면 하단',
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
  it('ModeToggle says Login Mode, not Flow', () => {
    render(<ModeToggle />)
    expect(screen.getByText('로그인 모드')).toBeTruthy()
  })

  it('renders separate image, T2V, and I2V provider badges and prices', () => {
    render(<SceneTab localSettings={settings} setLocalSettings={vi.fn()} t={t} appMode="flow" sessionTarget="chatgpt" imageModels={imageModels} videoModels={videoModels} />)

    expect(screen.getByTestId('image-provider-badge')).toHaveTextContent('ChatGPT')
    expect(screen.getByTestId('t2v-provider-badge')).toHaveTextContent('API 키 모드')
    expect(screen.getByTestId('i2v-provider-badge')).toHaveTextContent('API 키 모드')
    expect(screen.getByTestId('image-provider-price')).toHaveTextContent('ChatGPT plan')
    expect(screen.getByTestId('t2v-provider-price')).toHaveTextContent('$0.10')
    expect(screen.getByTestId('i2v-provider-price')).toHaveTextContent('$0.40')
    expect(document.querySelector('[title*="one.google.com"]')).toBeNull()
  })

  it('keeps image, T2V, and I2V on their Flow labels for the existing Flow route', () => {
    render(<SceneTab localSettings={settings} setLocalSettings={vi.fn()} t={t} appMode="flow" sessionTarget="flow" imageModels={imageModels} videoModels={videoModels} />)

    expect(screen.getByTestId('image-provider-badge')).toHaveTextContent('Google Flow')
    expect(screen.getByTestId('t2v-provider-badge')).toHaveTextContent('Google Flow')
    expect(screen.getByTestId('i2v-provider-badge')).toHaveTextContent('Google Flow')
    expect(document.querySelectorAll('[title="https://one.google.com/about/google-ai-plans/"]')).toHaveLength(3)
  })

  it('keeps all three stages on API labels, prices, and price links for the existing API route', () => {
    render(<SceneTab localSettings={settings} setLocalSettings={vi.fn()} t={t} appMode="api" sessionTarget="flow" imageModels={imageModels} videoModels={videoModels} />)

    expect(screen.getByTestId('image-provider-badge')).toHaveTextContent('API 키 모드')
    expect(screen.getByTestId('t2v-provider-badge')).toHaveTextContent('API 키 모드')
    expect(screen.getByTestId('i2v-provider-badge')).toHaveTextContent('API 키 모드')
    expect(screen.getByTestId('image-provider-price')).toHaveTextContent('$0.04')
    expect(screen.getByTestId('t2v-provider-price')).toHaveTextContent('$0.10')
    expect(screen.getByTestId('i2v-provider-price')).toHaveTextContent('$0.40')
    expect(document.querySelectorAll('[title="https://ai.google.dev/gemini-api/docs/pricing"]')).toHaveLength(3)
  })

  it('falls back to API video pricing metadata when the ChatGPT catalog has not landed yet', () => {
    const settingsFromFlowRoute = {
      ...settings,
      videoModelT2V: 'Veo 3.1 - Fast',
      videoModelF2V: 'Veo 3.1 - Quality',
    }
    render(<SceneTab localSettings={settingsFromFlowRoute} setLocalSettings={vi.fn()} t={t} appMode="flow" sessionTarget="chatgpt" imageModels={[]} videoModels={[]} />)

    expect(screen.getByTestId('image-provider-price')).toHaveTextContent('ChatGPT plan')
    expect(screen.getByTestId('t2v-provider-price')).toHaveTextContent('$0.10~')
    expect(screen.getByTestId('i2v-provider-price')).toHaveTextContent('$0.10~')
    expect(document.querySelectorAll('[title="https://ai.google.dev/gemini-api/docs/pricing"]')).toHaveLength(2)
  })

  it('DisplayTab uses neutral session view labels in login mode', () => {
    window.electronAPI = { getPreventSleep: vi.fn().mockResolvedValue({ enabled: false }), getLayout: vi.fn().mockResolvedValue({ mode: 'split-left' }) }
    render(<DisplayTab t={t} appMode="flow" />)
    expect(screen.getByText('세션 화면 왼쪽')).toBeTruthy()
  })
})
