/**
 * SceneTab — project aspect ratio selector
 *
 * The Scene settings tab exposes the project format (16:9 longform /
 * 9:16 shortform) as a button group, editable after project creation.
 */

import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import SceneTab from '../../../src/components/settings/SceneTab'
import { PRICING_URL, FLOW_PRICING_URL } from '../../../src/config/genModels'

const t = (k) => k
const baseSettings = {
  aspectRatio: '16:9',
  defaultDuration: 3,
  exportThreshold: 50,
  imageBatchCount: 1,
  videoBatchCount: 1,
  imageUpscale: 'off',
  videoResolution: '1080p',
}

describe('SceneTab — aspect ratio', () => {
  it('marks the current aspect ratio button active', () => {
    render(<SceneTab localSettings={{ ...baseSettings, aspectRatio: '9:16' }} setLocalSettings={vi.fn()} t={t} />)

    expect(screen.getByRole('button', { name: /9:16/ }).className).toContain('active')
    expect(screen.getByRole('button', { name: /16:9/ }).className).not.toContain('active')
  })

  it('defaults the active button to 16:9 when aspectRatio is unset', () => {
    render(<SceneTab localSettings={{ ...baseSettings, aspectRatio: undefined }} setLocalSettings={vi.fn()} t={t} />)

    expect(screen.getByRole('button', { name: /16:9/ }).className).toContain('active')
  })

  it('switches the project to 9:16 (shortform) on click', () => {
    const setLocalSettings = vi.fn()
    render(<SceneTab localSettings={baseSettings} setLocalSettings={setLocalSettings} t={t} />)

    fireEvent.click(screen.getByRole('button', { name: /9:16/ }))

    const updater = setLocalSettings.mock.calls[0][0]
    expect(updater(baseSettings)).toMatchObject({ aspectRatio: '9:16' })
  })

  it('switches the project back to 16:9 (longform) on click', () => {
    const setLocalSettings = vi.fn()
    render(<SceneTab localSettings={{ ...baseSettings, aspectRatio: '9:16' }} setLocalSettings={setLocalSettings} t={t} />)

    fireEvent.click(screen.getByRole('button', { name: /16:9/ }))

    const updater = setLocalSettings.mock.calls[0][0]
    expect(updater(baseSettings)).toMatchObject({ aspectRatio: '16:9' })
  })
})

describe('SceneTab — image provider 선택 (M1 §5.8)', () => {
  const provSettings = {
    ...baseSettings,
    imageModel: 'gemini-3.1-flash-image',
    generation: { image: { provider: 'google' } },
    modelsByProvider: { google: 'gemini-3.1-flash-image' },
  }

  it('현재 provider(google) 버튼이 active', () => {
    render(<SceneTab localSettings={provSettings} setLocalSettings={vi.fn()} t={t} />)
    expect(screen.getByRole('button', { name: 'settings.imageProvider_google' }).className).toContain('active')
    expect(screen.getByRole('button', { name: 'settings.imageProvider_openai' }).className).not.toContain('active')
  })

  it('OpenAI 클릭 → provider 전환 + gpt-image-1 모델 복원(현재 google 모델 기억)', () => {
    const setLocalSettings = vi.fn()
    render(<SceneTab localSettings={provSettings} setLocalSettings={setLocalSettings} t={t} />)
    fireEvent.click(screen.getByRole('button', { name: 'settings.imageProvider_openai' }))
    const updater = setLocalSettings.mock.calls[0][0]
    const next = updater(provSettings)
    expect(next.generation.image.provider).toBe('openai')
    expect(next.imageModel).toBe('gpt-image-1')
    expect(next.modelsByProvider.google).toBe('gemini-3.1-flash-image')
  })

  it('모델 변경 → modelsByProvider 를 현재 provider 슬롯에 갱신 (google)', () => {
    const setLocalSettings = vi.fn()
    render(<SceneTab localSettings={provSettings} setLocalSettings={setLocalSettings} t={t} />)
    const selects = screen.getAllByRole('combobox')
    fireEvent.change(selects[0], { target: { value: 'gemini-3-pro-image' } })
    const updater = setLocalSettings.mock.calls.at(-1)[0]
    const next = updater(provSettings)
    expect(next.imageModel).toBe('gemini-3-pro-image')
    expect(next.modelsByProvider.google).toBe('gemini-3-pro-image')
  })

  it('모델 변경 → 활성 provider(openai) 슬롯에 갱신 (F5: 슬롯 키 상수 아님)', () => {
    const openaiSettings = {
      ...baseSettings,
      imageModel: 'gpt-image-1',
      generation: { image: { provider: 'openai' } },
      modelsByProvider: { google: 'gemini-3.1-flash-image', openai: 'gpt-image-1' },
    }
    const setLocalSettings = vi.fn()
    render(<SceneTab localSettings={openaiSettings} setLocalSettings={setLocalSettings} t={t} />)
    const selects = screen.getAllByRole('combobox')
    fireEvent.change(selects[0], { target: { value: 'gpt-image-1' } })
    const updater = setLocalSettings.mock.calls.at(-1)[0]
    const next = updater(openaiSettings)
    // openai 슬롯에 기록돼야 (google 슬롯 오염 금지)
    expect(next.modelsByProvider.openai).toBe('gpt-image-1')
    expect(next.modelsByProvider.google).toBe('gemini-3.1-flash-image')
  })

  it('Flow 모드에서는 provider 셀렉터 숨김 (F4: Flow 는 google 전용)', () => {
    render(<SceneTab localSettings={provSettings} setLocalSettings={vi.fn()} t={t} appMode="flow" />)
    expect(screen.queryByRole('button', { name: 'settings.imageProvider_openai' })).toBeNull()
  })
})

describe('SceneTab — video provider 선택 (M2-pre §5.8)', () => {
  const provSettings = {
    ...baseSettings,
    videoModelT2V: 'veo-3.1-fast-generate-preview',
    videoModelF2V: 'veo-3.1-generate-preview',
    generation: {
      image: { provider: 'google' },
      video: {
        t2v: { provider: 'google' },
        i2v: { provider: 'google' },
      },
    },
    modelsByProviderVideo: {
      t2v: { google: 'veo-3.1-fast-generate-preview', grok: 'grok-t2v-model' },
      i2v: { google: 'veo-3.1-generate-preview', grok: 'grok-i2v-model' },
    },
  }

  it('실제 등록 provider가 google 하나면 단일 옵션 토글을 숨김', () => {
    render(<SceneTab localSettings={provSettings} setLocalSettings={vi.fn()} t={t} appMode="api" />)
    expect(screen.queryByRole('group', { name: 'settings.videoProviderT2VTitle' })).toBeNull()
    expect(screen.queryByRole('group', { name: 'settings.videoProviderI2VTitle' })).toBeNull()
  })

  it('미래 provider 목록이 있으면 T2V/I2V를 독립 노출하고 기억 모델을 복원', () => {
    const setLocalSettings = vi.fn()
    render(
      <SceneTab
        localSettings={provSettings}
        setLocalSettings={setLocalSettings}
        t={t}
        appMode="api"
        videoProviders={['google', 'grok']}
      />,
    )

    const t2vGroup = screen.getByRole('group', { name: 'settings.videoProviderT2VTitle' })
    const i2vGroup = screen.getByRole('group', { name: 'settings.videoProviderI2VTitle' })
    fireEvent.click(t2vGroup.querySelector('button:nth-child(2)'))
    const afterT2V = setLocalSettings.mock.calls[0][0](provSettings)
    expect(afterT2V.generation.video.t2v.provider).toBe('grok')
    expect(afterT2V.generation.video.i2v.provider).toBe('google')
    expect(afterT2V.videoModelT2V).toBe('grok-t2v-model')

    fireEvent.click(i2vGroup.querySelector('button:nth-child(2)'))
    const afterI2V = setLocalSettings.mock.calls[1][0](provSettings)
    expect(afterI2V.generation.video.i2v.provider).toBe('grok')
    expect(afterI2V.generation.video.t2v.provider).toBe('google')
    expect(afterI2V.videoModelF2V).toBe('grok-i2v-model')
  })

  it('T2V/I2V 모델 변경을 각 현재 provider stage 슬롯에 기억', () => {
    const setLocalSettings = vi.fn()
    const { container } = render(
      <SceneTab localSettings={provSettings} setLocalSettings={setLocalSettings} t={t} appMode="api" />,
    )
    const selects = container.querySelectorAll('select.model-select')

    fireEvent.change(selects[1], { target: { value: 'veo-3.1-generate-preview' } })
    const afterT2V = setLocalSettings.mock.calls[0][0](provSettings)
    expect(afterT2V.modelsByProviderVideo.t2v.google).toBe('veo-3.1-generate-preview')
    expect(afterT2V.modelsByProviderVideo.i2v.google).toBe('veo-3.1-generate-preview')

    fireEvent.change(selects[2], { target: { value: 'veo-3.1-fast-generate-preview' } })
    const afterI2V = setLocalSettings.mock.calls[1][0](provSettings)
    expect(afterI2V.modelsByProviderVideo.i2v.google).toBe('veo-3.1-fast-generate-preview')
    expect(afterI2V.modelsByProviderVideo.t2v.google).toBe('veo-3.1-fast-generate-preview')
  })

  it('Flow 모드에서는 여러 video provider가 주입돼도 셀렉터를 숨김', () => {
    render(
      <SceneTab
        localSettings={provSettings}
        setLocalSettings={vi.fn()}
        t={t}
        appMode="flow"
        videoProviders={['google', 'grok']}
      />,
    )
    expect(screen.queryByRole('group', { name: 'settings.videoProviderT2VTitle' })).toBeNull()
    expect(screen.queryByRole('group', { name: 'settings.videoProviderI2VTitle' })).toBeNull()
  })
})

describe('SceneTab — model selectors (T2I/T2V/F2V)', () => {
  it('3개 모델 섹션(T2I/T2V/F2V) 렌더', () => {
    render(<SceneTab localSettings={baseSettings} setLocalSettings={vi.fn()} t={t} />)
    expect(screen.getByText('settings.modelImageTitle')).toBeTruthy()
    expect(screen.getByText('settings.modelVideoT2VTitle')).toBeTruthy()
    expect(screen.getByText('settings.modelVideoF2VTitle')).toBeTruthy()
  })

  it('API 모드: pricing 링크 = Gemini API 과금 페이지', () => {
    const { container } = render(<SceneTab localSettings={baseSettings} setLocalSettings={vi.fn()} t={t} appMode="api" />)
    const links = container.querySelectorAll('.model-pricing-link')
    expect(links.length).toBeGreaterThan(0)
    links.forEach(l => expect(l.getAttribute('title')).toBe(PRICING_URL))
  })

  it('Flow 모드: pricing 링크 = Gemini 구독 페이지(API 과금 아님)', () => {
    const { container } = render(<SceneTab localSettings={baseSettings} setLocalSettings={vi.fn()} t={t} appMode="flow" />)
    const links = container.querySelectorAll('.model-pricing-link')
    expect(links.length).toBeGreaterThan(0)
    links.forEach(l => {
      expect(l.getAttribute('title')).toBe(FLOW_PRICING_URL)
      expect(l.getAttribute('title')).not.toBe(PRICING_URL)
    })
  })

  it('Flow 모드: Flow Agent 토글 표시 + ON 클릭 → setLocalSettings(flowAgentOn:true)', () => {
    const setLocalSettings = vi.fn()
    render(<SceneTab localSettings={{ ...baseSettings, flowAgentOn: false }} setLocalSettings={setLocalSettings} t={t} appMode="flow" />)
    expect(screen.getByText('settings.flowAgentMode')).toBeInTheDocument()
    const onBtn = screen.getByTestId('flow-agent-on')
    fireEvent.click(onBtn)
    expect(setLocalSettings.mock.calls[0][0]({ ...baseSettings })).toMatchObject({ flowAgentOn: true })
  })

  it('API 모드: Flow Agent 토글 숨김', () => {
    render(<SceneTab localSettings={baseSettings} setLocalSettings={vi.fn()} t={t} appMode="api" />)
    expect(screen.queryByText('settings.flowAgentMode')).toBeNull()
  })

  it('API 모드: Image/Video concurrency 슬라이더 표시', () => {
    render(<SceneTab localSettings={baseSettings} setLocalSettings={vi.fn()} t={t} appMode="api" />)
    expect(screen.queryByLabelText('settings.concurrency')).toBeInTheDocument()
    expect(screen.queryByLabelText('settings.videoConcurrency')).toBeInTheDocument()
  })

  it('Flow 모드: concurrency 슬라이더 숨김 (20~40초 페이싱이 throttle)', () => {
    render(<SceneTab localSettings={baseSettings} setLocalSettings={vi.fn()} t={t} appMode="flow" />)
    expect(screen.queryByLabelText('settings.concurrency')).toBeNull()
    expect(screen.queryByLabelText('settings.videoConcurrency')).toBeNull()
  })

  it('이미지 모델 select 변경 → setLocalSettings(imageModel)', () => {
    const setLocalSettings = vi.fn()
    const { container } = render(<SceneTab localSettings={baseSettings} setLocalSettings={setLocalSettings} t={t} />)
    const t2iSelect = container.querySelectorAll('select.model-select')[0] // T2I 가 첫 셀렉터
    fireEvent.change(t2iSelect, { target: { value: 'gemini-3.1-flash-image' } })
    expect(setLocalSettings.mock.calls[0][0](baseSettings).imageModel).toBe('gemini-3.1-flash-image')
  })

  it('imageModel 미지정 시 기본(Nano Banana 2 = gemini-3.1-flash-image)이 select 현재값', () => {
    const { container } = render(<SceneTab localSettings={{ ...baseSettings, imageModel: undefined }} setLocalSettings={vi.fn()} t={t} />)
    const t2iSelect = container.querySelectorAll('select.model-select')[0]
    expect(t2iSelect.value).toBe('gemini-3.1-flash-image')
  })

  it('imageModels/videoModels prop 주면 동적 옵션 사용 (없으면 정적 카탈로그 폴백)', () => {
    const imageModels = [{ id: 'dyn-img', label: 'Dynamic Img', cost: '$9' }]
    const videoModels = [{ id: 'dyn-vid', label: 'Dynamic Vid', cost: '$8' }]
    // 저장된 모델이 제공된 동적 목록 안에 있는 정상 케이스 (없으면 합성 옵션이 붙음).
    const ls = { ...baseSettings, imageModel: 'dyn-img', videoModelT2V: 'dyn-vid', videoModelF2V: 'dyn-vid' }
    const { container } = render(
      <SceneTab localSettings={ls} setLocalSettings={vi.fn()} t={t} imageModels={imageModels} videoModels={videoModels} />
    )
    const selects = container.querySelectorAll('select.model-select')
    expect([...selects[0].querySelectorAll('option')].map(o => o.value)).toEqual(['dyn-img'])
    // T2V, F2V 둘 다 비디오 동적 목록
    expect([...selects[1].querySelectorAll('option')].map(o => o.value)).toEqual(['dyn-vid'])
    expect([...selects[2].querySelectorAll('option')].map(o => o.value)).toEqual(['dyn-vid'])
  })
})

describe('SceneTab — Flow batch count (회귀 가드: Flow 생성이 imageBatchCount/videoBatchCount 를 실제 사용)', () => {
  // ⚠️ 이 컨트롤은 한 번 "API 모드에선 no-op"이라는 이유로 통째 제거됐다가(5d8a349),
  //   dual-mode 로 Flow 가 돌아오며 복원됐다. Flow 경로(useSceneGeneration/engineFlow/
  //   useReferenceGeneration)는 settings.imageBatchCount 를 x1~x4 로 그대로 쓰므로
  //   Flow 모드에서 이 셀렉터가 사라지면 안 된다. 아래 테스트가 그 재삭제를 막는다.
  it('Flow 모드: 이미지/비디오 batch count 컨트롤(x1~x4) 표시', () => {
    render(<SceneTab localSettings={baseSettings} setLocalSettings={vi.fn()} t={t} appMode="flow" />)
    expect(screen.getByTestId('image-batch-1')).toBeInTheDocument()
    expect(screen.getByTestId('image-batch-4')).toBeInTheDocument()
    expect(screen.getByTestId('video-batch-1')).toBeInTheDocument()
    expect(screen.getByTestId('video-batch-4')).toBeInTheDocument()
  })

  it('Flow 모드: 현재 imageBatchCount 버튼이 active', () => {
    render(<SceneTab localSettings={{ ...baseSettings, imageBatchCount: 3 }} setLocalSettings={vi.fn()} t={t} appMode="flow" />)
    expect(screen.getByTestId('image-batch-3').className).toContain('active')
    expect(screen.getByTestId('image-batch-1').className).not.toContain('active')
  })

  it('Flow 모드: 이미지 x2 클릭 → setLocalSettings(imageBatchCount:2)', () => {
    const setLocalSettings = vi.fn()
    render(<SceneTab localSettings={baseSettings} setLocalSettings={setLocalSettings} t={t} appMode="flow" />)
    fireEvent.click(screen.getByTestId('image-batch-2'))
    expect(setLocalSettings.mock.calls[0][0](baseSettings)).toMatchObject({ imageBatchCount: 2 })
  })

  it('Flow 모드: 비디오 x3 클릭 → setLocalSettings(videoBatchCount:3)', () => {
    const setLocalSettings = vi.fn()
    render(<SceneTab localSettings={baseSettings} setLocalSettings={setLocalSettings} t={t} appMode="flow" />)
    fireEvent.click(screen.getByTestId('video-batch-3'))
    expect(setLocalSettings.mock.calls[0][0](baseSettings)).toMatchObject({ videoBatchCount: 3 })
  })

  it('API 모드: batch count 숨김 (Gemini 1장/호출 · Veo 1개/op — no-op)', () => {
    render(<SceneTab localSettings={baseSettings} setLocalSettings={vi.fn()} t={t} appMode="api" />)
    expect(screen.queryByTestId('image-batch-1')).toBeNull()
    expect(screen.queryByTestId('video-batch-1')).toBeNull()
  })
})

describe('SceneTab — concurrency', () => {
  it('renders the current concurrency value', () => {
    render(<SceneTab localSettings={{ ...baseSettings, concurrency: 5 }} setLocalSettings={vi.fn()} t={t} />)
    expect(screen.getByLabelText('settings.concurrency').value).toBe('5')
  })

  it('falls back to 5 when concurrency is unset', () => {
    render(<SceneTab localSettings={{ ...baseSettings, concurrency: undefined }} setLocalSettings={vi.fn()} t={t} />)
    expect(screen.getByLabelText('settings.concurrency').value).toBe('5')
  })

  it('updates concurrency on change', () => {
    const setLocalSettings = vi.fn()
    render(<SceneTab localSettings={{ ...baseSettings, concurrency: 5 }} setLocalSettings={setLocalSettings} t={t} />)
    fireEvent.change(screen.getByLabelText('settings.concurrency'), { target: { value: '8' } })
    expect(setLocalSettings.mock.calls[0][0](baseSettings).concurrency).toBe(8)
  })
})
