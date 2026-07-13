import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import ImportModal from '../../src/components/ImportModal'
import { I18nProvider } from '../../src/hooks/useI18n'

const CSV_WITH_DROPPED_ROWS = [
  'scene,prompt,subtitle,speaker,duration',
  '1,,,,',
  ',First prompt,First subtitle,narrator,2',
  ',,,,',
  '2,,,,',
  ',Second prompt,Second subtitle,,2',
].join('\n')

function setup(overrides = {}) {
  localStorage.setItem('autoflowcut_lang', 'en')
  const props = {
    onImport: vi.fn(),
    onImportAudio: vi.fn(),
    onImportImageFirst: vi.fn(async () => ({ success: true })),
    onClose: vi.fn(),
    ...overrides,
  }
  const view = render(<I18nProvider><ImportModal {...props} /></I18nProvider>)
  return { ...view, props }
}

// CSV 는 M1a 필수다 — 확정 버튼은 CSV 없이는 disabled 다.
async function attachCsv(csv = CSV_WITH_DROPPED_ROWS) {
  await userEvent.upload(
    screen.getByLabelText('image-first-storyboard'),
    new File([csv], 'board.csv', { type: 'text/csv' }),
  )
}

async function openImageFirstAndUpload(files) {
  await userEvent.click(screen.getByTestId('image-first-option'))
  const input = screen.getByLabelText('image-first-images')
  await userEvent.upload(input, files)
  return input
}

describe('ImportModal image-first flow', () => {
  it('shows a multi-image picker and ordered preview', async () => {
    setup()
    const files = [
      new File(['a'], 'a.png', { type: 'image/png' }),
      new File(['b'], 'b.jpg', { type: 'image/jpeg' }),
    ]

    const input = await openImageFirstAndUpload(files)

    expect(input).toHaveAttribute('multiple')
    expect(input).toHaveAttribute('accept', 'image/png,image/jpeg,.png,.jpg,.jpeg')
    expect(screen.getAllByTestId('image-first-file-row').map((row) => row.textContent))
      .toEqual([expect.stringContaining('a.png'), expect.stringContaining('b.jpg')])
  })

  it('commits preview order and maps a rejection to the exact parsed board row', async () => {
    const onImportImageFirst = vi.fn(async () => ({
      success: false,
      error: 'storyboard-speaker-missing',
      sourceRowIds: ['storyboard-row-2'],
      committed: true,
    }))
    const { props } = setup({ onImportImageFirst })
    const a = new File(['a'], 'a.png', { type: 'image/png' })
    const b = new File(['b'], 'b.png', { type: 'image/png' })
    await openImageFirstAndUpload([a, b])

    await userEvent.click(screen.getByLabelText('Move a.png down'))
    const csv = new File([CSV_WITH_DROPPED_ROWS], 'board.csv', { type: 'text/csv' })
    await userEvent.upload(screen.getByLabelText('image-first-storyboard'), csv)
    await screen.findByText('Second prompt')

    await userEvent.click(screen.getByRole('button', { name: 'Confirm image-first import' }))

    await waitFor(() => expect(onImportImageFirst).toHaveBeenCalledTimes(1))
    const payload = onImportImageFirst.mock.calls[0][0]
    expect(payload.imageRows.map((row) => row.file.name)).toEqual(['b.png', 'a.png'])
    expect(payload.imageFirstVariant).toBe('storyboard')
    expect(payload.storyboardCsv).toBe(CSV_WITH_DROPPED_ROWS)

    const firstParsedRow = screen.getByTestId('storyboard-row-1')
    const secondParsedRow = screen.getByTestId('storyboard-row-2')
    expect(firstParsedRow).toHaveTextContent('First prompt')
    expect(secondParsedRow).toHaveTextContent('Second prompt')
    expect(within(firstParsedRow).queryByRole('alert')).not.toBeInTheDocument()
    expect(within(secondParsedRow).getByRole('alert')).toHaveTextContent(/speaker/i)
    expect(screen.getByLabelText('Move b.png down')).toBeDisabled()
    expect(props.onClose).not.toHaveBeenCalled()
  })

  it('keeps a mid-stage PNG rejection on the exact file row and leaves the modal open', async () => {
    const onImportImageFirst = vi.fn(async () => ({
      success: false,
      error: 'scene-image-not-png',
      fileRowId: 'image-row-3',
    }))
    const { props } = setup({ onImportImageFirst })
    await openImageFirstAndUpload([
      new File(['1'], 'one.png', { type: 'image/png' }),
      new File(['2'], 'two.png', { type: 'image/png' }),
      new File(['3'], 'three.jpg', { type: 'image/jpeg' }),
    ])
    await attachCsv()

    await userEvent.click(screen.getByRole('button', { name: 'Confirm image-first import' }))

    const rows = screen.getAllByTestId('image-first-file-row')
    await waitFor(() => expect(within(rows[2]).getByRole('alert')).toHaveTextContent(/PNG/i))
    expect(within(rows[0]).queryByRole('alert')).not.toBeInTheDocument()
    expect(props.onClose).not.toHaveBeenCalled()
  })

  // M1a 는 D24a(storyboard) 만 ship 한다. D24b(image-only) 는 M0-S17 blind gate 뒤이고
  // prompt-sync 가 fail-closed 라, CSV 없이 확정되면 사용자가 빠져나올 수 없는 모드에 갇힌다.
  it('refuses to confirm without a storyboard CSV — image-only is not shippable in M1a', async () => {
    const onImportImageFirst = vi.fn(async () => ({ success: true }))
    setup({ onImportImageFirst })
    await openImageFirstAndUpload([new File(['1'], 'one.png', { type: 'image/png' })])

    const confirm = screen.getByRole('button', { name: 'Confirm image-first import' })
    expect(confirm).toBeDisabled()

    await userEvent.click(confirm)
    expect(onImportImageFirst).not.toHaveBeenCalled()
  })

  it('always stages the storyboard variant once a CSV is attached', async () => {
    const onImportImageFirst = vi.fn(async () => ({ success: true }))
    setup({ onImportImageFirst })
    await openImageFirstAndUpload([new File(['1'], 'one.png', { type: 'image/png' })])
    await userEvent.upload(
      screen.getByLabelText('image-first-storyboard'),
      new File([CSV_WITH_DROPPED_ROWS], 'board.csv', { type: 'text/csv' }),
    )

    await userEvent.click(screen.getByRole('button', { name: 'Confirm image-first import' }))

    await waitFor(() => expect(onImportImageFirst).toHaveBeenCalledWith(expect.objectContaining({
      imageFirstVariant: 'storyboard',
    })))
  })

  it('renders header rejection as a storyboard file alert', async () => {
    setup({
      onImportImageFirst: vi.fn(async () => ({
        success: false,
        error: 'storyboard-header-duplicate',
        committed: true,
      })),
    })
    await openImageFirstAndUpload([new File(['1'], 'one.png', { type: 'image/png' })])
    await userEvent.upload(
      screen.getByLabelText('image-first-storyboard'),
      new File(['scene,prompt,prompt\n1,A,B'], 'bad.csv', { type: 'text/csv' }),
    )

    await userEvent.click(screen.getByRole('button', { name: 'Confirm image-first import' }))

    expect(await screen.findByTestId('storyboard-file-alert')).toHaveAttribute('role', 'alert')
  })

  it('marks a violation-promoted parsed row and renders a human-readable image/scene count mismatch', async () => {
    const csv = [
      'scene,prompt,duration',
      '1,Sunrise,3',
      '2,Noon,3',
      '3,Sunset,3',
    ].join('\n')
    setup({
      onImportImageFirst: vi.fn(async () => ({
        success: false,
        error: 'fixed-scenes-invalid',
        sourceRowIds: ['storyboard-row-3'],
        violations: [{
          code: 'storyboard-source-slot-mismatch',
          sourceRowId: 'storyboard-row-3',
          expected: 2,
          actual: 3,
        }],
        countMismatch: { imageCount: 2, storyboardSceneCount: 3 },
        committed: true,
      })),
    })
    await openImageFirstAndUpload([
      new File(['1'], 'one.png', { type: 'image/png' }),
      new File(['2'], 'two.png', { type: 'image/png' }),
    ])
    await attachCsv(csv)

    await userEvent.click(screen.getByRole('button', { name: 'Confirm image-first import' }))

    const first = screen.getByTestId('storyboard-row-1')
    const third = screen.getByTestId('storyboard-row-3')
    expect(within(first).queryByRole('alert')).not.toBeInTheDocument()
    expect(await within(third).findByRole('alert')).toHaveTextContent('2 images')
    expect(within(third).getByRole('alert')).toHaveTextContent('3 storyboard scenes')
  })

  it('maps an ordinal-only validator violation to the matching parsed scene group', async () => {
    setup({
      onImportImageFirst: vi.fn(async () => ({
        success: false,
        error: 'fixed-scenes-invalid',
        violations: [{ code: 'visual-only-prompt-empty', ordinal: 2 }],
        committed: true,
      })),
    })
    await openImageFirstAndUpload([
      new File(['1'], 'one.png', { type: 'image/png' }),
      new File(['2'], 'two.png', { type: 'image/png' }),
    ])
    await attachCsv('scene,prompt,duration\n10,Sunrise,3\n20,,3')

    await userEvent.click(screen.getByRole('button', { name: 'Confirm image-first import' }))

    const first = screen.getByTestId('storyboard-row-1')
    const second = screen.getByTestId('storyboard-row-2')
    expect(within(first).queryByRole('alert')).not.toBeInTheDocument()
    // raw 코드('fixed-scenes-invalid')가 아니라 사람이 읽는 문구여야 한다.
    const alert = await within(second).findByRole('alert')
    expect(alert).toHaveTextContent('The image set and the storyboard do not match.')
    expect(alert).not.toHaveTextContent('fixed-scenes-invalid')
  })

  it('turns close during confirm into a cancellation request and closes after rollback', async () => {
    let resolveImport
    const onImportImageFirst = vi.fn(() => new Promise((resolve) => { resolveImport = resolve }))
    const { props } = setup({ onImportImageFirst })
    await openImageFirstAndUpload([new File(['1'], 'one.png', { type: 'image/png' })])
    await attachCsv()
    await userEvent.click(screen.getByRole('button', { name: 'Confirm image-first import' }))
    await waitFor(() => expect(onImportImageFirst).toHaveBeenCalledTimes(1))

    await userEvent.click(screen.getByRole('button', { name: '✕' }))
    expect(onImportImageFirst.mock.calls[0][0].isCancelled()).toBe(true)
    expect(props.onClose).not.toHaveBeenCalled()

    resolveImport({ success: false, error: 'image-first-import-cancelled' })
    await waitFor(() => expect(props.onClose).toHaveBeenCalledTimes(1))
  })
})

describe('ImportModal legacy modes', () => {
  it.each([
    ['text', 'Prompt Text File', 'plain.txt', 'hello'],
    ['csv', 'Scene CSV File', 'scenes.csv', 'scene,prompt\n1,hello'],
    ['reference', 'Reference CSV File', 'refs.csv', 'name,type,prompt\nA,character,hello'],
    ['srt', 'Subtitle SRT File', 'sub.srt', '1\n00:00:00,000 --> 00:00:01,000\nhello'],
  ])('keeps the %s callback path unchanged', async (type, title, filename, content) => {
    const { props } = setup()
    await userEvent.click(screen.getByText(title))
    const input = document.querySelector('input[type="file"]')
    fireEvent.change(input, { target: { files: [new File([content], filename)] } })

    await waitFor(() => expect(props.onImport).toHaveBeenCalledWith(type, content, 'image'))
  })
})

describe('사용자에게 raw 에러코드를 보여주지 않는다', () => {
  // errorText 는 locale key 가 없으면 원본 코드를 그대로 렌더한다 — 사용자는 'fixed-scenes-invalid'
  // 같은 걸 보게 된다. t() 를 mock 하는 테스트로는 절대 안 잡히므로 locale 을 직접 검사한다.
  it('image-first 가 반환할 수 있는 모든 에러 코드에 ko/en 문구가 있다', async () => {
    const ko = (await import('../../src/locales/ko.js')).default
    const en = (await import('../../src/locales/en.js')).default
    const camel = (code) => code.replace(/-([a-z])/g, (_, c) => c.toUpperCase())

    const CODES = [
      'scene-image-not-png', 'scene-image-read-failed',
      'fixed-scenes-invalid', 'fixed-scenes-stale',
      'storyboard-header-duplicate', 'storyboard-header-unknown',
      'storyboard-scene-invalid', 'storyboard-scene-order-invalid',
      'storyboard-prompt-ambiguous', 'storyboard-field-ambiguous',
      'storyboard-prompt-missing', 'storyboard-duration-missing',
      'storyboard-speaker-missing', 'storyboard-speaker-unknown',
      'storyboard-speaker-ambiguous', 'storyboard-time-invalid',
      'image-first-import-failed', 'image-first-import-cancelled',
      'story-open-failed',
    ]

    const missing = CODES.filter((c) => !ko.import?.[camel(c)] || !en.import?.[camel(c)])
    expect(missing).toEqual([])
  })

  it('한국어 문구에 개발자 용어가 남아 있지 않다', async () => {
    const ko = (await import('../../src/locales/ko.js')).default
    const JARGON = ['binding', 'safe integer', 'collapse', 'roster', 'narrator alias', 'visual-only slot', 'storyboard field']
    const offenders = Object.entries(ko.import || {})
      .filter(([k]) => k.startsWith('storyboard') || k.startsWith('fixed') || k.startsWith('sceneImage'))
      .filter(([, v]) => typeof v === 'string' && JARGON.some((j) => v.includes(j)))
      .map(([k, v]) => `${k}: ${v}`)

    expect(offenders).toEqual([])
  })
})
