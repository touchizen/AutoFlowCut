import { render } from '@testing-library/react'
import { I18nProvider } from '../../src/hooks/useI18n'
import PromptInput from '../../src/components/PromptInput.jsx'

// hideTip=true면 tip 미표시, 기본은 표시
it('hideTip=true면 tip을 숨긴다', () => {
  const { container } = render(<I18nProvider><PromptInput value="x" onChange={()=>{}} hideTip /></I18nProvider>)
  expect(container.querySelector('.hint')).toBeNull()
})

it('기본은 tip 표시', () => {
  const { container } = render(<I18nProvider><PromptInput value="x" onChange={()=>{}} /></I18nProvider>)
  expect(container.querySelector('.hint')).not.toBeNull()
})
