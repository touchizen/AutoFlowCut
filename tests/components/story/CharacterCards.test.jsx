/**
 * 슬라이스5(spec §v2.5) — CharacterCards 단위 테스트.
 * 시놉시스 게이트의 등장인물 카드 편집: name/gender/age/role/appearance 필드,
 * gender enum select(male/female/unknown), 행 추가/삭제. controlled(onChange) 컴포넌트.
 */
import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import CharacterCards from '../../../src/components/story/CharacterCards.jsx'

const char = (over = {}) => ({
  id: '리안', name: '리안', gender: 'unknown', age: '20대', role: '주인공', ethnicity: '한국인', appearance: 'young woman', ...over,
})

describe('CharacterCards 렌더', () => {
  it('각 카드에 이름/성별/출신/나이/역할/외모 필드를 값과 함께 렌더한다', () => {
    render(<CharacterCards characters={[char()]} onChange={vi.fn()} />)
    expect(screen.getByLabelText('이름')).toHaveValue('리안')
    expect(screen.getByLabelText('성별')).toHaveValue('unknown')
    expect(screen.getByLabelText('출신')).toHaveValue('한국인')
    expect(screen.getByLabelText('나이')).toHaveValue('20대')
    expect(screen.getByLabelText('역할')).toHaveValue('주인공')
    expect(screen.getByLabelText('외모')).toHaveValue('young woman')
  })

  it('성별 select는 male/female/unknown 3개 enum 값을 가진다(표시만 한국어)', () => {
    render(<CharacterCards characters={[char()]} onChange={vi.fn()} />)
    const options = [...screen.getByLabelText('성별').querySelectorAll('option')]
    expect(options.map((o) => o.value)).toEqual(['male', 'female', 'unknown'])
    expect(options.map((o) => o.textContent)).toEqual(['남성', '여성', '미상'])
  })

  it('빈 목록이어도 행 추가 버튼은 렌더한다', () => {
    render(<CharacterCards characters={[]} onChange={vi.fn()} />)
    expect(screen.getByRole('button', { name: /행 추가/ })).toBeInTheDocument()
  })
})

describe('CharacterCards 편집', () => {
  it('성별 변경 시 onChange에 해당 카드만 바뀐 배열이 전달된다', () => {
    const onChange = vi.fn()
    render(<CharacterCards characters={[char(), char({ id: '강산', name: '강산' })]} onChange={onChange} />)
    fireEvent.change(screen.getAllByLabelText('성별')[0], { target: { value: 'female' } })
    expect(onChange).toHaveBeenCalledWith([
      expect.objectContaining({ name: '리안', gender: 'female' }),
      expect.objectContaining({ name: '강산', gender: 'unknown' }),
    ])
  })

  it('§v2.12: 출신(ethnicity) 자유입력 변경 시 onChange에 반영된다', () => {
    const onChange = vi.fn()
    render(<CharacterCards characters={[char()]} onChange={onChange} />)
    fireEvent.change(screen.getByLabelText('출신'), { target: { value: 'East Asian' } })
    expect(onChange).toHaveBeenCalledWith([
      expect.objectContaining({ name: '리안', ethnicity: 'East Asian' }),
    ])
  })

  it('이름 변경 시 id도 새 이름(trim)으로 재파생된다(§v2.9 — 이름 변경=신규 인물)', () => {
    const onChange = vi.fn()
    render(<CharacterCards characters={[char()]} onChange={onChange} />)
    fireEvent.change(screen.getByLabelText('이름'), { target: { value: ' 강리안 ' } })
    expect(onChange).toHaveBeenCalledWith([
      expect.objectContaining({ name: ' 강리안 ', id: '강리안' }),
    ])
  })

  it('행 추가 클릭 → 기본값(gender unknown) 카드가 뒤에 추가된다', () => {
    const onChange = vi.fn()
    render(<CharacterCards characters={[char()]} onChange={onChange} />)
    fireEvent.click(screen.getByRole('button', { name: /행 추가/ }))
    expect(onChange).toHaveBeenCalledWith([
      expect.objectContaining({ name: '리안' }),
      expect.objectContaining({ id: '', name: '', gender: 'unknown', age: '', role: '', ethnicity: '', appearance: '' }),
    ])
  })

  it('행 삭제 클릭 → 그 카드만 제거된 배열이 전달된다', () => {
    const onChange = vi.fn()
    render(<CharacterCards characters={[char(), char({ id: '강산', name: '강산' })]} onChange={onChange} />)
    fireEvent.click(screen.getAllByRole('button', { name: '행 삭제' })[0])
    expect(onChange).toHaveBeenCalledWith([expect.objectContaining({ name: '강산' })])
  })

  it('disabled면 모든 필드/버튼이 비활성', () => {
    render(<CharacterCards characters={[char()]} onChange={vi.fn()} disabled />)
    expect(screen.getByLabelText('이름')).toBeDisabled()
    expect(screen.getByLabelText('성별')).toBeDisabled()
    expect(screen.getByLabelText('출신')).toBeDisabled()
    expect(screen.getByRole('button', { name: /행 추가/ })).toBeDisabled()
    expect(screen.getByRole('button', { name: '행 삭제' })).toBeDisabled()
  })
})
