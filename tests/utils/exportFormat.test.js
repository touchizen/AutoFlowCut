import { describe, it, expect } from 'vitest'
import { normalizeExportFormat, EXPORT_FORMATS, DEFAULT_EXPORT_FORMAT } from '../../src/utils/exportFormat'

describe('normalizeExportFormat', () => {
  it('유효한 포맷은 그대로 반환', () => {
    expect(normalizeExportFormat('capcut')).toBe('capcut')
    expect(normalizeExportFormat('premiere')).toBe('premiere')
    expect(normalizeExportFormat('vrew')).toBe('vrew')
  })

  it('알 수 없는/깨진 값은 기본값으로 좁힌다', () => {
    expect(normalizeExportFormat('bad')).toBe('capcut')
    expect(normalizeExportFormat('')).toBe('capcut')
    expect(normalizeExportFormat(null)).toBe('capcut')
    expect(normalizeExportFormat(undefined)).toBe('capcut')
    expect(normalizeExportFormat('PREMIERE')).toBe('capcut')
  })

  it('EXPORT_FORMATS / DEFAULT_EXPORT_FORMAT 노출', () => {
    expect(EXPORT_FORMATS).toContain('capcut')
    expect(EXPORT_FORMATS).toContain('premiere')
    expect(EXPORT_FORMATS).toContain('vrew')
    expect(DEFAULT_EXPORT_FORMAT).toBe('capcut')
  })
})
