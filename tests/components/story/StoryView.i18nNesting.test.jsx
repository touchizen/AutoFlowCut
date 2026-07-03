import { describe, it, expect, beforeEach } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import StoryView from '../../../src/components/story/StoryView.jsx'
import { I18nProvider, useI18n } from '../../../src/hooks/useI18n.jsx'

function pipelineWith(overrides) {
  return { state: { steps: {} }, streamingText: '', start: () => {}, abort: () => {}, scenes: [], openError: null, ...overrides }
}

// 상위 provider 의 changeLang 을 노출하는 언어 스위처(Header 역할 대역).
function LangSwitcher() {
  const { changeLang } = useI18n()
  return <button onClick={() => changeLang('en')}>to-en</button>
}

describe('StoryView 대본 편집기 I18nProvider 중첩', () => {
  beforeEach(() => {
    localStorage.setItem('autoflowcut_lang', 'ko')
  })

  it('상위 provider 언어 전환이 편집기 PromptInput footer 에 전파된다', () => {
    render(
      <I18nProvider>
        <LangSwitcher />
        {/* Task 7: PromptInput 편집기는 editor phase(scriptText 있음)에서 렌더된다 */}
        <StoryView pipeline={pipelineWith({ scriptText: '대본 본문' })} />
      </I18nProvider>,
    )
    // 초기(ko): 대본 편집기는 "N줄" 라벨(countLabelKey=prompt.lineCount)
    expect(screen.getByText('1줄')).toBeInTheDocument()
    // 상위 provider 로 언어 전환
    fireEvent.click(screen.getByText('to-en'))
    // 중첩 provider 가 없으면 상위 전환이 전파돼 영어 라벨로 바뀐다.
    expect(screen.getByText('1 lines')).toBeInTheDocument()
    expect(screen.queryByText('1줄')).toBeNull()
  })
})
