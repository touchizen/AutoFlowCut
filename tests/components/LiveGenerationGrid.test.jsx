import { describe, it, expect, vi } from 'vitest'
import { render, fireEvent } from '@testing-library/react'
import LiveGenerationGrid, { GenTile } from '../../src/components/LiveGenerationGrid'

const base = { id: 'x', kind: 'image', thumbSrc: 'file:///a.png?v=1', ref: { id: 'x' } }

describe('GenTile', () => {
  it('pending → placeholder (이미지/비디오 없음)', () => {
    const { container } = render(<GenTile item={{ ...base, state: 'pending' }} />)
    expect(container.querySelector('.gentile--pending')).toBeTruthy()
    expect(container.querySelector('img')).toBeNull()
  })

  it('generating → shimmer 클래스', () => {
    const { container } = render(<GenTile item={{ ...base, state: 'generating' }} />)
    expect(container.querySelector('.gentile--generating')).toBeTruthy()
    expect(container.querySelector('.gen-shimmer')).toBeTruthy()
  })

  it('complete (이미지) → img with thumbSrc', () => {
    const { container } = render(<GenTile item={{ ...base, state: 'complete' }} />)
    expect(container.querySelector('img').getAttribute('src')).toBe('file:///a.png?v=1')
  })

  it('complete (비디오) → video with thumbSrc', () => {
    const { container } = render(<GenTile item={{ ...base, kind: 'video', state: 'complete', thumbSrc: 'file:///v.mp4?v=1' }} />)
    expect(container.querySelector('video').getAttribute('src')).toBe('file:///v.mp4?v=1')
  })

  it('error → ⚠️ + error 클래스 + title(tooltip)', () => {
    const { container, getByText } = render(<GenTile item={{ ...base, state: 'error', error: 'boom' }} />)
    expect(container.querySelector('.gentile--error')).toBeTruthy()
    expect(getByText('⚠️')).toBeTruthy()
    expect(container.querySelector('.gentile--error').getAttribute('title')).toBe('boom')
  })

  it('클릭 → onClick(item)', () => {
    const onClick = vi.fn()
    const item = { ...base, state: 'complete' }
    const { container } = render(<GenTile item={item} onClick={onClick} />)
    fireEvent.click(container.querySelector('.gentile'))
    expect(onClick).toHaveBeenCalledWith(item)
  })
})

describe('LiveGenerationGrid', () => {
  const items = [
    { id: 'a', kind: 'image', state: 'complete', thumbSrc: 'file:///a.png', ref: {} },
    { id: 'b', kind: 'image', state: 'generating', ref: {} },
    { id: 'c', kind: 'image', state: 'pending', ref: {} },
  ]

  it('item 당 타일 1개 렌더', () => {
    const { container } = render(<LiveGenerationGrid items={items} onItemSelect={vi.fn()} />)
    expect(container.querySelectorAll('.gentile')).toHaveLength(3)
  })

  it('타일 클릭 → onItemSelect(item)', () => {
    const onItemSelect = vi.fn()
    const { container } = render(<LiveGenerationGrid items={items} onItemSelect={onItemSelect} />)
    fireEvent.click(container.querySelectorAll('.gentile')[1])
    expect(onItemSelect).toHaveBeenCalledWith(items[1])
  })

  it('빈 items → 크래시 없음', () => {
    const { container } = render(<LiveGenerationGrid items={[]} onItemSelect={vi.fn()} />)
    expect(container.querySelectorAll('.gentile')).toHaveLength(0)
  })
})
