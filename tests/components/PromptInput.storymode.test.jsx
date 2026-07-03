import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import PromptInput from '../../src/components/PromptInput.jsx'
import { I18nProvider } from '../../src/hooks/useI18n'

function renderPI(props) {
  return render(<I18nProvider><PromptInput value={props.value ?? ''} onChange={() => {}} {...props} /></I18nProvider>)
}

describe('PromptInput story mode', () => {
  it('showCharCount=true면 문자 수를 표시한다', () => {
    renderPI({ value: '가나다', showCharCount: true })
    expect(screen.getByTestId('char-count')).toHaveTextContent('3')
  })
  it('showCharCount=false(기본)면 문자 수 미표시', () => {
    renderPI({ value: '가나다' })
    expect(screen.queryByTestId('char-count')).toBeNull()
  })
  it('disableMentions=true면 미해결 @가 빨간 unknown-mention 노드가 되지 않는다', () => {
    const { container } = renderPI({ value: '@ghost 이야기', disableMentions: true, references: [] })
    // UnknownMentionTextNode는 특정 클래스로 렌더된다 — disableMentions면 없어야 함
    expect(container.querySelector('.unknown-mention')).toBeNull()
  })
})
