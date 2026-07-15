/**
 * Task 8 — StoryView 설정 화면(setup) 마크업.
 * 세로 옵션+설명, 제목, 대본 임포트(drag&drop / 붙여넣기), [✨ 시작] 분기.
 */
import { afterEach, describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import StoryView from '../../../src/components/story/StoryView.jsx'
import { I18nProvider } from '../../../src/hooks/useI18n.jsx'

const pipeline = (over = {}) => ({
  state: { steps: { script: { status: 'pending' } } },
  scenes: [],
  streamingText: '',
  scriptText: '',
  start: vi.fn().mockResolvedValue({}), abort: vi.fn(), openError: null,
  // 슬라이스5(§v2.8 B1): [시작]은 synopsis 게이트로 진입 — 제목 경로는 generateSynopsis,
  // 붙여넣기 경로는 start('script') 선행 후 역추출 + [등장인물 확정] 게이트.
  generateSynopsis: vi.fn().mockResolvedValue({}),
  confirmSynopsis: vi.fn().mockResolvedValue({}),
  ...over,
})

const completedPipeline = (over = {}) => pipeline({
  scriptText: '완성된 대본',
  state: {
    input: {
      title: '완성된 제목',
      options: {
        genre: 'bespoke',
        language: 'ko',
        engine: 'claude',
        model: 'claude-opus-4-8',
        reasoningEffort: 'off',
        lengthValue: '10',
        lengthUnit: 'min',
        sceneGranularity: 'scene',
        reviewLoop: false,
      },
    },
    steps: {
      script: { status: 'done' },
      scenes: { status: 'done' },
      audio: { status: 'done' },
      prompts: { status: 'done' },
    },
  },
  scenes: [{ storyId: 's1', imagePrompt: 'IMG', videoPrompt: 'VID', segments: [] }],
  ...over,
})

afterEach(() => {
  localStorage.removeItem('autoflowcut_lang')
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
    expect(screen.getByLabelText('대본 분량 값')).toBeInTheDocument()
    expect(screen.getByLabelText('대본 분량 단위')).toBeInTheDocument()
    // 설명
    expect(screen.getByText(/이야기 유형/)).toBeInTheDocument()
    expect(screen.getByText('생성 AI')).toBeInTheDocument()
    expect(screen.getByText('출력 언어')).toBeInTheDocument()
    expect(screen.getByText('대본 분량')).toBeInTheDocument()
  })

  // 레이아웃: 라벨(제목)이 왼쪽, 값(컨트롤)이 오른쪽. DOM 순서로 라벨이 컨트롤보다 앞에 오게 해
  // CSS 그리드(라벨 열 | 값 열)가 성립하도록 한다. 설명이 컨트롤 뒤(오른쪽)에 흩어져 있던 구조 회귀 방지.
  it('레이아웃: 각 옵션 행에서 라벨(.story-opt-label)이 컨트롤보다 앞에 온다', () => {
    render(<StoryView pipeline={pipeline()} />)
    const cases = [
      ['장르', 'select'],
      ['모델', 'select'],
      ['언어', 'select'],
      ['대본 분량 값', 'input'],
    ]
    for (const [aria, tag] of cases) {
      const row = screen.getByLabelText(aria).closest('.story-opt-row')
      const label = row.querySelector('.story-opt-label')
      const control = row.querySelector(tag)
      expect(label).toBeTruthy()
      // 라벨이 컨트롤보다 문서상 앞(=왼쪽 열)에 있어야 한다
      expect(label.compareDocumentPosition(control) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    }
  })

  it('씬 분리 단위 드롭다운을 렌더한다(기본 scene)', () => {
    render(<StoryView pipeline={pipeline()} />)
    const sel = screen.getByLabelText('씬 분리 단위')
    expect(sel.tagName).toBe('SELECT')
    expect(sel).toHaveValue('scene')
  })

  it('씬 분리 단위 segment 선택 후 분리시작하면 start options에 sceneGranularity=segment 가 실린다', async () => {
    const p = pipeline()
    render(<StoryView pipeline={p} />)
    fireEvent.change(screen.getByPlaceholderText('제목'), { target: { value: 'T' } })
    fireEvent.change(screen.getByTestId('story-import-drop').querySelector('textarea'), { target: { value: '대본 본문' } })
    fireEvent.change(screen.getByLabelText('씬 분리 단위'), { target: { value: 'segment' } })
    // 붙여넣기 시작 → synopsis 게이트(등장인물 확정) → editor, 이어서 분리시작 → start('scenes')
    fireEvent.click(screen.getByRole('button', { name: '시작' }))
    await waitFor(() => expect(screen.getByTestId('story-synopsis')).toBeInTheDocument())
    fireEvent.click(screen.getByRole('button', { name: '등장인물 확정' }))
    await waitFor(() => expect(screen.getByTestId('story-editor')).toBeInTheDocument())
    fireEvent.click(screen.getByRole('button', { name: '분리시작' }))
    await waitFor(() => {
      expect(p.start).toHaveBeenCalledWith('scenes', expect.objectContaining({
        options: expect.objectContaining({ sceneGranularity: 'segment' }),
      }))
    })
  })

  it('씬 기준(scene)이면 min/max 초 입력을 렌더(기본 5/10), segment면 숨긴다', () => {
    render(<StoryView pipeline={pipeline()} />)
    expect(screen.getByLabelText('씬 최소 길이(초)')).toHaveValue('5')
    expect(screen.getByLabelText('씬 최대 길이(초)')).toHaveValue('10')
    fireEvent.change(screen.getByLabelText('씬 분리 단위'), { target: { value: 'segment' } })
    expect(screen.queryByLabelText('씬 최소 길이(초)')).toBeNull()
    expect(screen.queryByLabelText('씬 최대 길이(초)')).toBeNull()
  })

  it('min/max 초를 바꿔 시작하면 options에 sceneMinSec/sceneMaxSec가 실린다', () => {
    const p = pipeline()
    render(<StoryView pipeline={p} />)
    fireEvent.change(screen.getByPlaceholderText('제목'), { target: { value: 'T' } })
    fireEvent.change(screen.getByLabelText('씬 최소 길이(초)'), { target: { value: '3' } })
    fireEvent.change(screen.getByLabelText('씬 최대 길이(초)'), { target: { value: '8' } })
    fireEvent.click(screen.getByRole('button', { name: '시작' }))
    expect(p.generateSynopsis).toHaveBeenCalledWith(expect.objectContaining({
      options: expect.objectContaining({ sceneMinSec: 3, sceneMaxSec: 8 }),
    }))
  })

  it('max < min 이면 옵션에서 max를 min으로 보정한다(역전 방지)', () => {
    const p = pipeline()
    render(<StoryView pipeline={p} />)
    fireEvent.change(screen.getByPlaceholderText('제목'), { target: { value: 'T' } })
    fireEvent.change(screen.getByLabelText('씬 최소 길이(초)'), { target: { value: '9' } })
    fireEvent.change(screen.getByLabelText('씬 최대 길이(초)'), { target: { value: '4' } })
    fireEvent.click(screen.getByRole('button', { name: '시작' }))
    expect(p.generateSynopsis).toHaveBeenCalledWith(expect.objectContaining({
      options: expect.objectContaining({ sceneMinSec: 9, sceneMaxSec: 9 }),
    }))
  })

  it('언어는 ko/en select 이고 기본 ko', () => {
    render(<StoryView pipeline={pipeline()} />)
    const lang = screen.getByLabelText('언어')
    expect(lang.tagName).toBe('SELECT')
    expect(lang).toHaveValue('ko')
    fireEvent.change(lang, { target: { value: 'en' } })
    expect(lang).toHaveValue('en')
  })

  it('대본 분량은 값 combobox와 언어별 단위 select를 함께 렌더한다', () => {
    const { container } = render(<StoryView pipeline={pipeline()} />)
    const input = screen.getByLabelText('대본 분량 값')
    const unit = screen.getByLabelText('대본 분량 단위')
    expect(input).toHaveAttribute('list', 'story-length-minutes')
    expect(input).toHaveAttribute('inputmode', 'numeric')
    expect(input).toHaveValue('10')
    expect(unit.tagName).toBe('SELECT')
    expect(unit).toHaveValue('min')
    expect([...unit.querySelectorAll('option')].map((el) => [el.value, el.textContent])).toEqual([
      ['min', '분'],
      ['chars', '자수'],
    ])
    const options = [...container.querySelectorAll('#story-length-minutes option')].map((el) => el.value)
    expect(options[0]).toBe('1')
    expect(options.at(-1)).toBe('60')
    expect(options).toHaveLength(60)
    const optionLabels = [...container.querySelectorAll('#story-length-minutes option')].map((el) => (
      el.getAttribute('label') || el.textContent
    ))
    expect(optionLabels[0]).toBe('1분')
    expect(optionLabels.at(-1)).toBe('60분')

    fireEvent.change(input, { target: { value: '42' } })
    expect(input).toHaveValue('42')
  })

  it('I18nProvider가 있어도 대본 분량 접근성 라벨은 새 라벨로 렌더한다', () => {
    localStorage.setItem('autoflowcut_lang', 'ko')
    render(
      <I18nProvider>
        <StoryView pipeline={pipeline()} />
      </I18nProvider>,
    )
    expect(screen.getByLabelText('대본 분량 값')).toBeInTheDocument()
    expect(screen.getByLabelText('대본 분량 단위')).toBeInTheDocument()
  })

  it('한국어 단위를 자수로 바꾸면 같은 분량의 자수 값과 추천값으로 바뀐다', () => {
    const { container } = render(<StoryView pipeline={pipeline()} />)
    const input = screen.getByLabelText('대본 분량 값')
    fireEvent.change(screen.getByLabelText('대본 분량 단위'), { target: { value: 'chars' } })
    expect(input).toHaveValue('3300')

    const options = [...container.querySelectorAll('#story-length-minutes option')]
    expect(options[0]).toHaveValue('330')
    expect(options[0].getAttribute('label')).toBe('330자')
    expect(options.at(-1)).toHaveValue('19800')
    expect(options.at(-1).getAttribute('label')).toBe('19800자')
    expect(options).toHaveLength(60)
  })

  it('영어에서는 단위를 min/words/chars로 고를 수 있다', () => {
    const { container } = render(<StoryView pipeline={pipeline()} />)
    fireEvent.change(screen.getByLabelText('언어'), { target: { value: 'en' } })
    const unit = screen.getByLabelText('대본 분량 단위')
    expect([...unit.querySelectorAll('option')].map((el) => [el.value, el.textContent])).toEqual([
      ['min', 'min'],
      ['words', 'words'],
      ['chars', 'chars'],
    ])

    fireEvent.change(unit, { target: { value: 'words' } })
    expect(screen.getByLabelText('대본 분량 값')).toHaveValue('1500')
    const options = [...container.querySelectorAll('#story-length-minutes option')]
    expect(options[0]).toHaveValue('150')
    expect(options[0].getAttribute('label')).toBe('150 words')
    expect(options.at(-1)).toHaveValue('9000')
    expect(options.at(-1).getAttribute('label')).toBe('9000 words')

    fireEvent.change(unit, { target: { value: 'chars' } })
    expect(screen.getByLabelText('대본 분량 값')).toHaveValue('3300')
    const charOptions = [...container.querySelectorAll('#story-length-minutes option')]
    expect(charOptions[0]).toHaveValue('330')
    expect(charOptions[0].getAttribute('label')).toBe('330 chars')
    expect(charOptions.at(-1)).toHaveValue('19800')
    expect(charOptions.at(-1).getAttribute('label')).toBe('19800 chars')
  })

  it('자수 단위로 시작하면 자수 값을 그대로 저장한다', () => {
    const p = pipeline()
    render(<StoryView pipeline={p} />)
    fireEvent.change(screen.getByPlaceholderText('제목'), { target: { value: 'T' } })
    fireEvent.change(screen.getByLabelText('대본 분량 단위'), { target: { value: 'chars' } })
    fireEvent.change(screen.getByLabelText('대본 분량 값'), { target: { value: '4200' } })
    fireEvent.click(screen.getByRole('button', { name: '시작' }))
    expect(p.generateSynopsis).toHaveBeenCalledWith(expect.objectContaining({
      options: expect.objectContaining({ lengthValue: '4200', lengthUnit: 'chars', lengthMode: 'unit' }),
    }))
  })

  it.each([
    ['42', '42'],
    ['', '10'],
    ['   ', '10'],
    ['abc', '10'],
    ['7abc', '10'],
    ['0', '10'],
    ['-3', '10'],
    ['7.4', '7'],
    ['7.5', '8'],
    ['60.6', '60'],
    ['99', '60'],
  ])('대본 분량 "%s" 입력 후 시작하면 "%s"분으로 정규화해 저장한다', (raw, expected) => {
    const p = pipeline()
    render(<StoryView pipeline={p} />)
    fireEvent.change(screen.getByPlaceholderText('제목'), { target: { value: 'T' } })
    fireEvent.change(screen.getByLabelText('대본 분량 값'), { target: { value: raw } })
    fireEvent.click(screen.getByRole('button', { name: '시작' }))
    expect(p.generateSynopsis).toHaveBeenCalledWith(expect.objectContaining({
      options: expect.objectContaining({ lengthValue: expected, lengthUnit: 'min' }),
    }))
  })

  it('제목 input(placeholder "제목")을 렌더한다', () => {
    render(<StoryView pipeline={pipeline()} />)
    expect(screen.getByPlaceholderText('제목')).toBeInTheDocument()
  })

  it('[✨ 시작] — 제목만 있으면 synopsis 게이트로 진입해 generateSynopsis를 호출한다(§v2.8 B1)', () => {
    const p = pipeline()
    render(<StoryView pipeline={p} />)
    fireEvent.change(screen.getByPlaceholderText('제목'), { target: { value: '운수 좋은 날' } })
    fireEvent.click(screen.getByRole('button', { name: '시작' }))
    expect(p.generateSynopsis).toHaveBeenCalledWith({
      type: 'title',
      title: '운수 좋은 날',
      options: { genre: 'bespoke', language: 'ko', engine: 'claude', model: 'claude-opus-4-8', reasoningEffort: 'off', lengthValue: '10', lengthUnit: 'min', sceneGranularity: 'scene', sceneMinSec: 5, sceneMaxSec: 10, reviewLoop: false },
    })
    expect(p.start).not.toHaveBeenCalled()
    expect(screen.getByTestId('story-synopsis')).toBeInTheDocument()
  })

  it('[✨ 시작] — scriptText 있으면 pastedScript 경로로 전체 옵션+제목을 실어 start 하고 synopsis 게이트로 전환한다', async () => {
    const p = pipeline()
    render(<StoryView pipeline={p} />)
    fireEvent.change(screen.getByPlaceholderText('제목'), { target: { value: '가져온 제목' } })
    fireEvent.change(screen.getByLabelText('장르'), { target: { value: 'yadam' } })
    fireEvent.change(screen.getByTestId('story-import-drop').querySelector('textarea'), {
      target: { value: '내가 쓴 대본' },
    })
    fireEvent.click(screen.getByRole('button', { name: '시작' }))
    // 임포트/붙여넣기 시작도 현재 설정(genre/length/…)과 제목을 버리지 않고 그대로 커밋한다.
    expect(p.start).toHaveBeenCalledWith('script', {
      pastedScript: '내가 쓴 대본',
      input: { type: 'pasted', title: '가져온 제목' },
      options: { genre: 'yadam', language: 'ko', engine: 'claude', model: 'claude-opus-4-8', reasoningEffort: 'off', lengthValue: '10', lengthUnit: 'min', sceneGranularity: 'scene', sceneMinSec: 5, sceneMaxSec: 10, reviewLoop: false },
    })
    // §v2.8 B1: 대본 영속 직후 등장인물 역추출 게이트로.
    await waitFor(() => expect(screen.getByTestId('story-synopsis')).toBeInTheDocument())
    expect(p.generateSynopsis).toHaveBeenCalledWith(expect.objectContaining({ type: 'pasted', pastedScript: '내가 쓴 대본' }))
  })

  it('[✨ 시작] — 제목·scriptText 둘 다 없으면 비활성', () => {
    render(<StoryView pipeline={pipeline()} />)
    expect(screen.getByRole('button', { name: '시작' })).toBeDisabled()
  })

  it('설정 primary 버튼은 패널 안이 아니라 하단 컨트롤에 하나만 렌더된다', () => {
    const { container } = render(<StoryView pipeline={pipeline()} />)
    const start = screen.getByRole('button', { name: '시작' })
    expect(container.querySelector('.story-controls')).toContainElement(start)
    expect(screen.getByTestId('story-setup')).not.toContainElement(start)
    expect(screen.getAllByRole('button', { name: '시작' })).toHaveLength(1)
  })

  it('완료된 설정은 변경 전엔 닫기만 보이고, 설정을 바꾸면 "변경사항으로 다시 시작"과 닫기를 같이 보여준다', () => {
    const p = completedPipeline()
    const onClose = vi.fn()
    render(<StoryView pipeline={p} onClose={onClose} />)
    fireEvent.click(screen.getByRole('button', { name: '설정' }))

    expect(screen.queryByRole('button', { name: '완료됨' })).toBeNull()
    expect(screen.queryByRole('button', { name: '시작' })).toBeNull()
    expect(screen.queryByRole('button', { name: /프롬프트 실행/ })).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: '닫기' }))
    expect(onClose).toHaveBeenCalledTimes(1)

    fireEvent.change(screen.getByLabelText('대본 분량 값'), { target: { value: '12' } })
    const changed = screen.getByRole('button', { name: '변경사항으로 다시 시작' })
    expect(changed).not.toBeDisabled()
    expect(screen.getByRole('button', { name: '닫기' })).not.toBeDisabled()

    fireEvent.click(changed)
    // 슬라이스5: 제목 경로 재시작도 synopsis 게이트로 진입한다.
    expect(p.generateSynopsis).toHaveBeenCalledWith(expect.objectContaining({
      type: 'title',
      title: '완성된 제목',
      options: expect.objectContaining({ lengthValue: '12' }),
    }))
  })

  it('파일 선택 버튼과 숨김 file input을 렌더한다', () => {
    render(<StoryView pipeline={pipeline()} />)
    expect(screen.getByRole('button', { name: /파일 선택/ })).toBeInTheDocument()
    expect(screen.getByTestId('story-file-input')).toBeInTheDocument()
  })

  it('파일 선택(input change)으로 .txt 파일을 고르면 scriptText 에 채워진다', async () => {
    render(<StoryView pipeline={pipeline()} />)
    const input = screen.getByTestId('story-file-input')
    const file = new File(['고른 대본 내용'], 'a.txt', { type: 'text/plain' })
    fireEvent.change(input, { target: { files: [file] } })
    await waitFor(() => {
      expect(screen.getByTestId('story-import-drop').querySelector('textarea')).toHaveValue('고른 대본 내용')
    })
  })

  it('파일 선택도 지원하지 않는 확장자는 무시한다', () => {
    render(<StoryView pipeline={pipeline()} />)
    const input = screen.getByTestId('story-file-input')
    const file = new File(['bin'], 'a.pdf', { type: 'application/pdf' })
    fireEvent.change(input, { target: { files: [file] } })
    expect(screen.getByTestId('story-import-drop').querySelector('textarea')).toHaveValue('')
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

  it('파일 읽기 실패 시 기존 scriptText 를 지우지 않는다', async () => {
    // 읽기가 실패해도 붙여넣어 둔 대본이 날아가면 안 된다.
    //   (읽기는 이제 FileReader 가 아니라 file.arrayBuffer() → 인코딩 감지 경로다. Windows 에서
    //    저장한 CP949/UTF-16 대본이 UTF-8 로 강제 해석돼 깨지던 것을 고치면서 바뀌었다.)
    render(<StoryView pipeline={pipeline()} />)
    const drop = screen.getByTestId('story-import-drop')
    fireEvent.change(drop.querySelector('textarea'), { target: { value: '기존 붙여넣은 대본' } })

    const file = new File(['x'], 'script.txt', { type: 'text/plain' })
    file.arrayBuffer = () => Promise.reject(new Error('read-fail'))
    fireEvent.drop(drop, { dataTransfer: { files: [file] } })
    await new Promise((r) => setTimeout(r, 0))

    expect(drop.querySelector('textarea')).toHaveValue('기존 붙여넣은 대본')
  })

  it('Windows 에서 저장한 CP949 대본도 깨지지 않고 들어온다', async () => {
    render(<StoryView pipeline={pipeline()} />)
    const drop = screen.getByTestId('story-import-drop')

    // "안녕하세요" (CP949) — UTF-8 로 읽으면 깨진 글자가 된다.
    const cp949 = Uint8Array.from([0xbe, 0xc8, 0xb3, 0xe7, 0xc7, 0xcf, 0xbc, 0xbc, 0xbf, 0xe4])
    const file = new File(['ignored'], 'script.txt', { type: 'text/plain' })
    file.arrayBuffer = () => Promise.resolve(cp949.buffer)
    fireEvent.drop(drop, { dataTransfer: { files: [file] } })
    await new Promise((r) => setTimeout(r, 0))

    expect(drop.querySelector('textarea')).toHaveValue('안녕하세요')
  })
})
