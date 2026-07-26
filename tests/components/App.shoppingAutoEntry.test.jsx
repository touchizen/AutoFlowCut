import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'

import { useWorkflowProjectChange } from '../../src/hooks/useWorkflowProjectChange.js'

function ProjectSwitchProbe({ changeProject, setActiveView }) {
  const switchProject = useWorkflowProjectChange({ changeProject, setActiveView })
  return <button onClick={() => switchProject('shopping-project')}>쇼핑 프로젝트 전환</button>
}

describe('Shopping project automatic workflow entry', () => {
  it('성공한 쇼핑 프로젝트 생성/전환은 workflow view로 자동 진입한다', async () => {
    const changeProject = vi.fn(async () => ({
      success: true,
      workflowType: 'shopping-short',
      aspectRatio: '9:16',
    }))
    const setActiveView = vi.fn()
    render(<ProjectSwitchProbe changeProject={changeProject} setActiveView={setActiveView} />)

    fireEvent.click(screen.getByRole('button', { name: '쇼핑 프로젝트 전환' }))

    await waitFor(() => expect(changeProject).toHaveBeenCalledWith('shopping-project'))
    expect(setActiveView).toHaveBeenCalledWith('story')
  })

  it('실패한 전환은 현재 view를 바꾸지 않는다', async () => {
    const changeProject = vi.fn(async () => ({ success: false, workflowType: 'shopping-short' }))
    const setActiveView = vi.fn()
    render(<ProjectSwitchProbe changeProject={changeProject} setActiveView={setActiveView} />)

    fireEvent.click(screen.getByRole('button', { name: '쇼핑 프로젝트 전환' }))

    await waitFor(() => expect(changeProject).toHaveBeenCalledTimes(1))
    expect(setActiveView).not.toHaveBeenCalled()
  })
})
