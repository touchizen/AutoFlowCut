import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import StoryView from '../../../src/components/story/StoryView.jsx'

const pipeline = (over = {}) => ({
  state: {
    steps: {
      script: { status: 'pending' }, scenes: { status: 'pending' },
      audio: { status: 'pending' }, prompts: { status: 'pending' },
    },
    speakers: [],
  },
  scenes: [],
  streamingText: '',
  start: vi.fn(), abort: vi.fn(),
  ...over,
})

describe('StoryView', () => {
  it('스텝퍼에 4단계와 상태 뱃지를 렌더한다', () => {
    render(<StoryView pipeline={pipeline()} />)
    expect(screen.getByText(/대본/)).toBeTruthy()
    expect(screen.getByText(/씬 분리/)).toBeTruthy()
    expect(screen.getByText(/오디오/)).toBeTruthy()
    expect(screen.getByText(/프롬프트/)).toBeTruthy()
  })
  it('제목 입력 후 시작하면 start("script")가 stepMachine이 기대하는 shape로 호출된다', () => {
    const p = pipeline()
    render(<StoryView pipeline={p} />)
    fireEvent.change(screen.getByPlaceholderText(/제목/), { target: { value: '운수 좋은 날' } })
    fireEvent.change(screen.getByPlaceholderText(/장르/), { target: { value: '단편' } })
    fireEvent.change(screen.getByPlaceholderText(/길이/), { target: { value: '5' } })
    fireEvent.change(screen.getByPlaceholderText(/언어/), { target: { value: 'ko' } })
    fireEvent.click(screen.getByRole('button', { name: /대본 생성/ }))
    // stepMachine.steps.script는 params.input(type/title)과 params.options(genre/targetMinutes/language)를
    // 분리해서 읽는다 — input에 genre/length/language를 섞어 넣으면 LLM opts로 전달되지 않아 무시된다.
    expect(p.start).toHaveBeenCalledWith('script', {
      input: { type: 'title', title: '운수 좋은 날' },
      options: { genre: '단편', targetMinutes: 5, language: 'ko' },
    })
  })

  it('장르/길이 미입력 시 options에서 해당 필드가 undefined로 빠진다', () => {
    const p = pipeline()
    render(<StoryView pipeline={p} />)
    fireEvent.change(screen.getByPlaceholderText(/제목/), { target: { value: '제목만' } })
    fireEvent.click(screen.getByRole('button', { name: /대본 생성/ }))
    expect(p.start).toHaveBeenCalledWith('script', {
      input: { type: 'title', title: '제목만' },
      options: { genre: undefined, targetMinutes: undefined, language: 'ko' },
    })
  })
  it('script running이면 스트리밍 텍스트를 표시한다', () => {
    const p = pipeline({ streamingText: '옛날 옛적에...' })
    p.state.steps.script.status = 'running'
    render(<StoryView pipeline={p} />)
    expect(screen.getByText(/옛날 옛적에/)).toBeTruthy()
  })
  it('script done이면 다음 단계(씬 분리) 버튼이 활성화된다', () => {
    const p = pipeline()
    p.state.steps.script.status = 'done'
    render(<StoryView pipeline={p} />)
    const btn = screen.getByRole('button', { name: /씬 분리 실행/ })
    fireEvent.click(btn)
    expect(p.start).toHaveBeenCalledWith('scenes', expect.anything())
  })
  // M1 스펙 §1 2번 경로: 대본을 직접 붙여넣어 LLM 없이 바로 시작할 수 있어야 한다.
  it('대본 붙여넣기 후 "대본으로 시작" 클릭하면 pastedScript로 start된다', () => {
    const p = pipeline()
    render(<StoryView pipeline={p} />)
    fireEvent.change(screen.getByPlaceholderText(/직접 붙여넣기/), { target: { value: '내가 쓴 대본' } })
    fireEvent.click(screen.getByRole('button', { name: /대본으로 시작/ }))
    expect(p.start).toHaveBeenCalledWith('script', {
      pastedScript: '내가 쓴 대본',
      options: { language: 'ko' },
    })
  })

  it('붙여넣기 텍스트가 비어 있으면 "대본으로 시작" 버튼이 비활성화된다', () => {
    const p = pipeline()
    render(<StoryView pipeline={p} />)
    expect(screen.getByRole('button', { name: /대본으로 시작/ })).toBeDisabled()
  })

  // Important: state.scenes/state.prompts는 존재하지 않는 필드였다 — pipeline.scenes(파생
  // 데이터, scenes.json 내용)를 별도로 받아 ②/④ 패널을 채운다.
  it('씬 분리 단계에서 scenes의 세그먼트(화자/텍스트) 행을 렌더한다', () => {
    const p = pipeline({
      scenes: [{ storyId: 's1', segments: [{ speaker: '나레이션', text: '어느 날' }] }],
    })
    p.state.steps.script.status = 'done'
    render(<StoryView pipeline={p} />)
    expect(screen.getByText('나레이션')).toBeTruthy()
    expect(screen.getByText('어느 날')).toBeTruthy()
  })

  it('프롬프트 단계에서 scenes의 imagePrompt/videoPrompt를 렌더한다', () => {
    const p = pipeline({
      scenes: [{ storyId: 's1', imagePrompt: 'IMG-1', videoPrompt: 'VID-1' }],
    })
    p.state.steps.script.status = 'done'
    p.state.steps.scenes.status = 'done'
    render(<StoryView pipeline={p} />)
    expect(screen.getByText('IMG-1')).toBeTruthy()
    expect(screen.getByText('VID-1')).toBeTruthy()
  })

  it('에러 단계는 error 뱃지 + 재실행 버튼', () => {
    const p = pipeline()
    p.state.steps.script.status = 'error'
    p.state.steps.script.error = '429'
    render(<StoryView pipeline={p} />)
    expect(screen.getByText(/429/)).toBeTruthy()
    expect(screen.getByRole('button', { name: /재실행/ })).toBeTruthy()
  })

  // Minor 7-⑴: done 상태 스텝은 스텝퍼에서 클릭해 해당 패널로 돌아가 볼 수 있어야 한다(현재
  // currentStep이 더 앞선 단계로 진행돼 있어도). 미완료 스텝은 아직 데이터가 없으므로 클릭 불가.
  it('스텝퍼에서 done 상태 스텝을 클릭하면 해당 패널을 표시하고, 미완료 스텝은 클릭할 수 없다', () => {
    const p = pipeline({ scenes: [{ storyId: 's1', imagePrompt: 'IMG-1', videoPrompt: 'VID-1' }] })
    p.state.steps.script.status = 'done'
    p.state.steps.scenes.status = 'done'
    render(<StoryView pipeline={p} />)

    // currentStep은 prompts이므로 기본으로 프롬프트 패널이 보인다
    expect(screen.getByText('IMG-1')).toBeTruthy()

    // 미완료(pending) 스텝인 '오디오'는 클릭 가능한 요소가 아니다
    expect(screen.queryByRole('button', { name: '오디오' })).toBeNull()

    // done 상태인 '대본' 스텝 클릭 → 대본 패널로 전환
    fireEvent.click(screen.getByRole('button', { name: '대본' }))
    expect(screen.getByPlaceholderText(/제목/)).toBeTruthy()

    // done 상태인 '씬 분리' 스텝 클릭 → 씬 분리 패널로 전환 (프롬프트 패널 고유 헤더가 사라진다)
    fireEvent.click(screen.getByRole('button', { name: '씬 분리' }))
    expect(screen.queryByText('이미지 프롬프트')).toBeNull()
    expect(screen.getByText('화자')).toBeTruthy()
  })

  // Minor 7-⑵: useStoryPipeline.open()이 실패(예: invalid-project-path)하면 pipeline.openError로
  // 노출되고, StoryView는 안내 배너를 렌더해 사용자가 원인을 알 수 있어야 한다.
  it('open 실패(openError) 시 안내 배너를 표시한다', () => {
    const p = pipeline({ openError: 'invalid-project-path' })
    render(<StoryView pipeline={p} />)
    expect(screen.getByText(/프로젝트 폴더를 열 수 없습니다/)).toBeTruthy()
    expect(screen.getByText(/invalid-project-path/)).toBeTruthy()
  })

  it('openError가 없으면 안내 배너를 렌더하지 않는다', () => {
    render(<StoryView pipeline={pipeline()} />)
    expect(screen.queryByText(/프로젝트 폴더를 열 수 없습니다/)).toBeNull()
  })
})
