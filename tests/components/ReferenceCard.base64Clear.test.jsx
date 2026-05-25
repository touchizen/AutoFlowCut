/**
 * ReferenceCard — #3 base64 메모리 해제 테스트
 *
 * 디스크 저장 성공 시 onUpdate 최종 호출의 data 필드가 null 이어야 한다.
 * useAutomation.js 는 ref.data 없으면 ref.filePath 에서 읽는 fallback 이 이미 있어서 안전.
 * 디스크 저장 실패 시에는 기존처럼 data: base64 로 유지한다.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, act } from '@testing-library/react'

// vi.mock factory 안에서 변수 참조 금지 (hoisting) → 모듈 인스턴스를 import 후 spy
vi.mock('../../src/hooks/useFileSystem', () => ({
  fileSystemAPI: {
    checkPermission: vi.fn(),
    saveReference: vi.fn(),
  },
}))

vi.mock('../../src/hooks/useI18n', () => ({
  default: () => ({ t: (k) => k }),
  useI18n: () => ({ t: (k) => k }),
}))

vi.mock('../../src/components/Toast', () => ({
  toast: { success: vi.fn(), error: vi.fn(), warning: vi.fn(), info: vi.fn() },
}))

vi.mock('../../src/components/HoverImageBalloon', () => ({
  default: () => null,
}))

// FileReader stub — readAsDataURL 호출 시 즉시 onloadend 실행
class FakeFileReader {
  readAsDataURL() {
    this.result = 'data:image/png;base64,FAKEBASE64'
    this.onloadend?.()
  }
}
global.FileReader = FakeFileReader

import { fileSystemAPI } from '../../src/hooks/useFileSystem'
import ReferenceCard from '../../src/components/ReferenceCard'

const fakeFile = new File(['x'], 'photo.png', { type: 'image/png' })

const baseRef = {
  id: 1,
  name: 'hero',
  category: 'character',
  data: null,
  filePath: null,
  mediaId: null,
  status: null,
}

async function triggerFileInput(container) {
  const input = container.querySelector('input[type="file"]')
  await act(async () => {
    Object.defineProperty(input, 'files', { value: [fakeFile], configurable: true })
    input.dispatchEvent(new Event('change', { bubbles: true }))
    // async 체인 flush (readAsDataURL 동기 → 이후 await 들)
    for (let i = 0; i < 5; i++) await Promise.resolve()
  })
}

describe('ReferenceCard — base64 clear after disk save (#3)', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    fileSystemAPI.checkPermission.mockResolvedValue({ hasPermission: true })
  })

  it('디스크 저장 성공 시 최종 onUpdate 는 data: null 을 전달한다', async () => {
    fileSystemAPI.saveReference.mockResolvedValue({ success: true, path: '/proj/refs/hero.png' })
    const onUpdate = vi.fn()

    const { container } = render(
      <ReferenceCard
        reference={baseRef}
        index={0}
        onUpdate={onUpdate}
        onRemove={vi.fn()}
        onUpload={vi.fn().mockResolvedValue({ success: false })}
        t={(k) => k}
        projectName="MyProject"
      />
    )

    await triggerFileInput(container)

    // onUpdate 는 최소 2번: 즉시표시 + 최종
    const calls = onUpdate.mock.calls
    expect(calls.length).toBeGreaterThanOrEqual(2)

    // 최종 호출의 data 가 null 이어야 함
    const lastCall = calls[calls.length - 1][1]
    expect(lastCall.data).toBeNull()
    expect(lastCall.filePath).toBe('/proj/refs/hero.png')
    expect(lastCall.dataStorage).toBe('file')
  })

  it('디스크 저장 실패 시 최종 onUpdate 는 data: base64 를 유지한다', async () => {
    fileSystemAPI.saveReference.mockResolvedValue({ success: false, error: 'permission denied' })
    const onUpdate = vi.fn()

    const { container } = render(
      <ReferenceCard
        reference={baseRef}
        index={0}
        onUpdate={onUpdate}
        onRemove={vi.fn()}
        onUpload={vi.fn().mockResolvedValue({ success: false })}
        t={(k) => k}
        projectName="MyProject"
      />
    )

    await triggerFileInput(container)

    const calls = onUpdate.mock.calls
    const lastCall = calls[calls.length - 1][1]
    expect(lastCall.data).toBe('data:image/png;base64,FAKEBASE64')
    expect(lastCall.filePath).toBeNull()
  })

  it('projectName 없으면 저장 시도 안 하고 data: base64 유지', async () => {
    const onUpdate = vi.fn()

    const { container } = render(
      <ReferenceCard
        reference={baseRef}
        index={0}
        onUpdate={onUpdate}
        onRemove={vi.fn()}
        onUpload={vi.fn().mockResolvedValue({ success: false })}
        t={(k) => k}
        projectName={null}
      />
    )

    await triggerFileInput(container)

    const calls = onUpdate.mock.calls
    const lastCall = calls[calls.length - 1][1]
    expect(lastCall.data).toBe('data:image/png;base64,FAKEBASE64')
    expect(fileSystemAPI.saveReference).not.toHaveBeenCalled()
  })
})
