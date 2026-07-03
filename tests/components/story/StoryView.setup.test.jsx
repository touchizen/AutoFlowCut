/**
 * Task 8 — StoryView 설정 화면(setup) 마크업.
 * 세로 옵션+설명, 제목, 대본 임포트(drag&drop / 붙여넣기), [✨ 시작] 분기.
 */
import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import StoryView from '../../../src/components/story/StoryView.jsx'

const pipeline = (over = {}) => ({
  state: { steps: { script: { status: 'pending' } } },
  scenes: [],
  streamingText: '',
  scriptText: '',
  start: vi.fn(), abort: vi.fn(), openError: null,
  ...over,
})

describe('StoryView 설정 화면(setup)', () => {
  it('세로 옵션 각 항목에 라벨+설명을 렌더한다', () => {
    render(<StoryView pipeline={pipeline()} />)
    const setup = screen.getByTestId('story-setup')
    expect(setup).toBeInTheDocument()
    // 옵션 컨트롤
    expect(screen.getByLabelText('장르')).toBeInTheDocument()
    expect(screen.getByLabelText('모델')).toBeInTheDocument()
    expect(screen.getByLabelText('언어')).toBeInTheDocument()
    expect(screen.getByLabelText('길이 값')).toBeInTheDocument()
    expect(screen.getByLabelText('길이 단위')).toBeInTheDocument()
    // 설명
    expect(screen.getByText(/이야기 유형/)).toBeInTheDocument()
    expect(screen.getByText('생성 AI')).toBeInTheDocument()
    expect(screen.getByText('출력 언어')).toBeInTheDocument()
    expect(screen.getByText('대본 분량')).toBeInTheDocument()
  })

  it('언어는 ko/en select 이고 기본 ko', () => {
    render(<StoryView pipeline={pipeline()} />)
    const lang = screen.getByLabelText('언어')
    expect(lang.tagName).toBe('SELECT')
    expect(lang).toHaveValue('ko')
    fireEvent.change(lang, { target: { value: 'en' } })
    expect(lang).toHaveValue('en')
  })

  it('제목 input(placeholder "제목")을 렌더한다', () => {
    render(<StoryView pipeline={pipeline()} />)
    expect(screen.getByPlaceholderText('제목')).toBeInTheDocument()
  })

  it('[✨ 시작] — 제목만 있으면 title 생성 경로로 start 하고 editor로 전환한다', () => {
    const p = pipeline()
    render(<StoryView pipeline={p} />)
    fireEvent.change(screen.getByPlaceholderText('제목'), { target: { value: '운수 좋은 날' } })
    fireEvent.click(screen.getByRole('button', { name: '시작' }))
    expect(p.start).toHaveBeenCalledWith('script', {
      input: { type: 'title', title: '운수 좋은 날' },
      options: { genre: 'bespoke', language: 'ko', model: 'claude-opus-4-8', lengthValue: '10', lengthUnit: 'min' },
    })
    expect(screen.getByTestId('story-editor')).toBeInTheDocument()
  })

  it('[✨ 시작] — scriptText 있으면 pastedScript 경로로 start 하고 editor로 전환한다', () => {
    const p = pipeline()
    render(<StoryView pipeline={p} />)
    fireEvent.change(screen.getByTestId('story-import-drop').querySelector('textarea'), {
      target: { value: '내가 쓴 대본' },
    })
    fireEvent.click(screen.getByRole('button', { name: '시작' }))
    expect(p.start).toHaveBeenCalledWith('script', expect.objectContaining({ pastedScript: '내가 쓴 대본' }))
    expect(screen.getByTestId('story-editor')).toBeInTheDocument()
  })

  it('[✨ 시작] — 제목·scriptText 둘 다 없으면 비활성', () => {
    render(<StoryView pipeline={pipeline()} />)
    expect(screen.getByRole('button', { name: '시작' })).toBeDisabled()
  })

  it('drag&drop 으로 .txt 파일을 놓으면 scriptText 에 채워진다', async () => {
    const p = pipeline()
    render(<StoryView pipeline={p} />)
    const drop = screen.getByTestId('story-import-drop')
    const file = new File(['드롭한 대본 내용'], 'script.txt', { type: 'text/plain' })
    fireEvent.drop(drop, { dataTransfer: { files: [file] } })
    await waitFor(() => {
      expect(drop.querySelector('textarea')).toHaveValue('드롭한 대본 내용')
    })
    // 채워진 뒤 시작 버튼 활성화
    expect(screen.getByRole('button', { name: '시작' })).not.toBeDisabled()
  })

  it('drag&drop 으로 .md 파일도 읽어들인다', async () => {
    render(<StoryView pipeline={pipeline()} />)
    const drop = screen.getByTestId('story-import-drop')
    const file = new File(['# 마크다운 대본'], 'story.md', { type: 'text/markdown' })
    fireEvent.drop(drop, { dataTransfer: { files: [file] } })
    await waitFor(() => {
      expect(drop.querySelector('textarea')).toHaveValue('# 마크다운 대본')
    })
  })

  it('drag&drop 으로 지원하지 않는 확장자는 무시한다', () => {
    render(<StoryView pipeline={pipeline()} />)
    const drop = screen.getByTestId('story-import-drop')
    const file = new File(['bin'], 'a.pdf', { type: 'application/pdf' })
    fireEvent.drop(drop, { dataTransfer: { files: [file] } })
    expect(drop.querySelector('textarea')).toHaveValue('')
  })
})
