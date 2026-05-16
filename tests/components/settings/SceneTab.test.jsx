/**
 * SceneTab — project aspect ratio selector
 *
 * The Scene settings tab exposes the project format (16:9 longform /
 * 9:16 shortform) as a button group, editable after project creation.
 */

import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import SceneTab from '../../../src/components/settings/SceneTab'

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
