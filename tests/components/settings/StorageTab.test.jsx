/**
 * StorageTab — New Project format selector
 *
 * Creating a project picks its format up-front (16:9 longform / 9:16 shortform).
 * The chosen ratio is handed to the project-change handler so it lands in the
 * new project's project.json and drives generation / cards / export.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'

vi.mock('../../../src/hooks/useFileSystem', () => ({
  fileSystemAPI: {
    listProjects: vi.fn().mockResolvedValue({ success: true, projects: ['existing'] }),
    getProjectFolder: vi.fn().mockResolvedValue({ success: true }),
    projectExists: vi.fn().mockResolvedValue(true),
    renameProject: vi.fn(),
  },
}))
vi.mock('../../../src/utils/formatters', () => ({
  generateProjectName: () => 'auto_generated',
}))
vi.mock('../../../src/components/Toast', () => ({
  toast: { warning: vi.fn(), error: vi.fn(), success: vi.fn(), info: vi.fn() },
}))

import StorageTab from '../../../src/components/settings/StorageTab'
import { fileSystemAPI } from '../../../src/hooks/useFileSystem'
import { toast } from '../../../src/components/Toast'

const t = (k) => k

function renderStorageTab(onProjectChange = vi.fn()) {
  const setLocalSettings = vi.fn()
  render(
    <StorageTab
      localSettings={{ saveMode: 'folder', aspectRatio: '16:9', projectName: 'existing' }}
      setLocalSettings={setLocalSettings}
      workFolder={{ name: 'WorkFolder', error: null }}
      onSelectFolder={vi.fn()}
      onProjectChange={onProjectChange}
      highlight={false}
      t={t}
    />,
  )
  return { onProjectChange, setLocalSettings }
}

beforeEach(() => {
  vi.clearAllMocks()
  fileSystemAPI.listProjects.mockResolvedValue({ success: true, projects: ['existing'] })
  fileSystemAPI.getProjectFolder.mockResolvedValue({ success: true })
  fileSystemAPI.projectExists.mockResolvedValue(false) // name is free unless a test overrides
})

describe('StorageTab — New Project aspect ratio', () => {
  it('shows the 16:9 / 9:16 selector in the create form', async () => {
    renderStorageTab()
    fireEvent.click(await screen.findByTitle('settings.createProject'))

    expect(screen.getByRole('button', { name: /16:9/ })).toBeTruthy()
    expect(screen.getByRole('button', { name: /9:16/ })).toBeTruthy()
  })

  it('creates a project with the chosen 9:16 (shortform) ratio', async () => {
    const { onProjectChange } = renderStorageTab()
    fireEvent.click(await screen.findByTitle('settings.createProject'))

    fireEvent.click(screen.getByRole('button', { name: /9:16/ }))
    fireEvent.change(screen.getByPlaceholderText('settings.projectNamePlaceholder'), {
      target: { value: 'my_short' },
    })
    fireEvent.click(screen.getByRole('button', { name: 'settings.create' }))

    await waitFor(() => {
      expect(onProjectChange).toHaveBeenCalledWith('my_short', { aspectRatio: '9:16', isNewProject: true })
    })
  })

  it('defaults a new project to 16:9 (longform) when the ratio is left untouched', async () => {
    const { onProjectChange } = renderStorageTab()
    fireEvent.click(await screen.findByTitle('settings.createProject'))

    fireEvent.change(screen.getByPlaceholderText('settings.projectNamePlaceholder'), {
      target: { value: 'my_long' },
    })
    fireEvent.click(screen.getByRole('button', { name: 'settings.create' }))

    await waitFor(() => {
      expect(onProjectChange).toHaveBeenCalledWith('my_long', { aspectRatio: '16:9', isNewProject: true })
    })
  })

  it('blocks creating a project whose name already exists (no ratio override)', async () => {
    // Regression: an existing name typed into New Project must NOT be treated
    // as a fresh create — otherwise the chosen ratio would overwrite the
    // existing project's project.json aspect ratio.
    fileSystemAPI.projectExists.mockResolvedValue(true)
    const { onProjectChange } = renderStorageTab()
    fireEvent.click(await screen.findByTitle('settings.createProject'))

    fireEvent.change(screen.getByPlaceholderText('settings.projectNamePlaceholder'), {
      target: { value: 'existing' },
    })
    fireEvent.click(screen.getByRole('button', { name: 'settings.create' }))

    await waitFor(() => {
      expect(toast.warning).toHaveBeenCalledWith('settings.projectExists')
    })
    expect(onProjectChange).not.toHaveBeenCalled()
    expect(fileSystemAPI.getProjectFolder).not.toHaveBeenCalled()
  })

  it('rolls back the optimistic project selection when the switch fails', async () => {
    // handleProjectChange returning { success:false } means the app did NOT
    // switch. The optimistically-updated localSettings.projectName must roll
    // back, else the modal shows a different project than the app is on.
    const onProjectChange = vi.fn().mockResolvedValue({ success: false })
    const { setLocalSettings } = renderStorageTab(onProjectChange)
    fireEvent.click(await screen.findByTitle('settings.createProject'))

    fireEvent.change(screen.getByPlaceholderText('settings.projectNamePlaceholder'), {
      target: { value: 'my_new' },
    })
    fireEvent.click(screen.getByRole('button', { name: 'settings.create' }))

    // wait until the rollback setLocalSettings call lands
    await waitFor(() => {
      const lastUpdater = setLocalSettings.mock.calls.at(-1)?.[0]
      expect(lastUpdater?.({ projectName: 'my_new', aspectRatio: '9:16' }))
        .toMatchObject({ projectName: 'existing', aspectRatio: '16:9' })
    })
  })
})
