import { describe, it, expect } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
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
  // SyncPlugin 은 $applyTextToRoot 를 queueMicrotask 로 defer 하므로 render 직후엔
  // 에디터에 텍스트 노드가 아직 하나도 없다. 따라서 hydrate 를 waitFor 로 기다린 뒤에
  // 검증해야 plain 분기가 실제로 unknown 노드를 차단하는지 확인할 수 있다.
  // 양성 대조군(disableMentions=false)이 함께 통과해야 tautology 가 아님이 보증된다.
  it('disableMentions=true면 미해결 @가 빨간 unknown-mention 노드가 되지 않는다', async () => {
    const { container } = renderPI({ value: '@ghost 이야기', disableMentions: true, references: [] })
    // 먼저 텍스트가 hydrate 될 때까지 대기 (plain 분기라 단일 TextNode 로 들어옴).
    await waitFor(() => {
      expect(screen.getByTestId('prompt-textarea').textContent).toContain('@ghost')
    })
    // hydrate 된 뒤에도 unknown-mention(.unknown-mention) 밑줄 노드는 없어야 한다.
    expect(container.querySelector('.unknown-mention')).toBeNull()
  })
  it('양성 대조군: disableMentions 없이 동일 입력이면 미해결 @ghost가 unknown-mention 노드가 된다', async () => {
    const { container } = renderPI({ value: '@ghost 이야기', references: [] })
    // references 에 없는 @ghost → 미해결 멘션 → UnknownMentionTextNode(.unknown-mention).
    await waitFor(() => {
      expect(container.querySelector('.unknown-mention')).not.toBeNull()
    })
    expect(container.querySelector('.unknown-mention').textContent).toContain('@ghost')
  })
})
