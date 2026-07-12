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

    await userEvent.click(screen.getByRole('button', { name: 'Confirm image-first import' }))

    const rows = screen.getAllByTestId('image-first-file-row')
    await waitFor(() => expect(within(rows[2]).getByRole('alert')).toHaveTextContent(/PNG/i))
    expect(within(rows[0]).queryByRole('alert')).not.toBeInTheDocument()
    expect(props.onClose).not.toHaveBeenCalled()
  })

  it('treats an absent storyboard CSV as the legal image-only variant', async () => {
    const onImportImageFirst = vi.fn(async () => ({ success: true }))
    setup({ onImportImageFirst })
    await openImageFirstAndUpload([new File(['1'], 'one.png', { type: 'image/png' })])

    await userEvent.click(screen.getByRole('button', { name: 'Confirm image-first import' }))

    await waitFor(() => expect(onImportImageFirst).toHaveBeenCalledWith(expect.objectContaining({
      imageFirstVariant: 'image-only',
      storyboardCsv: '',
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

  it('turns close during confirm into a cancellation request and closes after rollback', async () => {
    let resolveImport
    const onImportImageFirst = vi.fn(() => new Promise((resolve) => { resolveImport = resolve }))
    const { props } = setup({ onImportImageFirst })
    await openImageFirstAndUpload([new File(['1'], 'one.png', { type: 'image/png' })])
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
