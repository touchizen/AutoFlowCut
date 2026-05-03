/**
 * formatters.js 테스트
 */
import { describe, it, expect, vi } from 'vitest'
import {
  formatTime,
  formatDuration,
  formatTimeLong,
  formatSRTTime,
  formatDateISO,
  formatDateForFilename,
  getTimestamp,
  formatExpiryDate,
  formatFileSize,
  formatPercent,
  generateProjectName,
  generateSceneFilename,
  getResolutionTag,
  getRatioClass,
  generateRandomSeed,
  getImageSizeFromBase64,
  formatTimestamp,
  formatDate,
  formatDateTimeFull,
  formatDateShort,
  formatNumber,
} from '../../src/utils/formatters'

// ============================================================
// formatTime
// ============================================================
describe('formatTime', () => {
  it('returns "0:00" for falsy values', () => {
    expect(formatTime(0)).toBe('0:00')
    expect(formatTime(null)).toBe('0:00')
    expect(formatTime(undefined)).toBe('0:00')
  })

  it('formats seconds < 60', () => {
    expect(formatTime(5)).toBe('0:05')
    expect(formatTime(59)).toBe('0:59')
  })

  it('formats minutes and seconds', () => {
    expect(formatTime(90)).toBe('1:30')
    expect(formatTime(3661)).toBe('61:01')
  })

  it('floors fractional seconds', () => {
    expect(formatTime(5.9)).toBe('0:05')
  })
})

// ============================================================
// formatDuration
// ============================================================
describe('formatDuration', () => {
  it('returns "0:00" for falsy values', () => {
    expect(formatDuration(0)).toBe('0:00')
    expect(formatDuration(null)).toBe('0:00')
  })

  it('formats m:ss for values < 3600', () => {
    expect(formatDuration(90)).toBe('1:30')
    expect(formatDuration(3599)).toBe('59:59')
  })

  it('formats h:mm:ss for values >= 3600', () => {
    expect(formatDuration(3600)).toBe('1:00:00')
    expect(formatDuration(3661)).toBe('1:01:01')
    expect(formatDuration(7384)).toBe('2:03:04')
  })
})

// ============================================================
// formatTimeLong
// ============================================================
describe('formatTimeLong', () => {
  it('always includes hours', () => {
    expect(formatTimeLong(0)).toBe('00:00:00')
    expect(formatTimeLong(90)).toBe('00:01:30')
    expect(formatTimeLong(3661)).toBe('01:01:01')
  })
})

// ============================================================
// formatSRTTime
// ============================================================
describe('formatSRTTime', () => {
  it('formats milliseconds to SRT time', () => {
    expect(formatSRTTime(0)).toBe('00:00:00,000')
    expect(formatSRTTime(3661500)).toBe('01:01:01,500')
    expect(formatSRTTime(90000)).toBe('00:01:30,000')
    expect(formatSRTTime(123)).toBe('00:00:00,123')
  })
})

// ============================================================
// formatDateISO
// ============================================================
describe('formatDateISO', () => {
  it('formats Date to YYYY-MM-DD', () => {
    const d = new Date(2024, 0, 19) // Jan 19, 2024
    expect(formatDateISO(d)).toBe('2024-01-19')
  })

  it('returns empty string for invalid input', () => {
    expect(formatDateISO(null)).toBe('')
    expect(formatDateISO('invalid')).toBe('')
  })

  it('accepts ISO string', () => {
    expect(formatDateISO('2024-06-15T12:00:00Z')).toBe('2024-06-15')
  })
})

// ============================================================
// formatDateForFilename
// ============================================================
describe('formatDateForFilename', () => {
  it('formats date for filename usage', () => {
    // The function uses toISOString which produces UTC time
    const result = formatDateForFilename('2024-01-19T12:30:45.000Z')
    expect(result).toBe('2024-01-19_12-30-45')
  })

  it('returns empty string for invalid input', () => {
    expect(formatDateForFilename(null)).toBe('')
    expect(formatDateForFilename('invalid')).toBe('')
  })
})

// ============================================================
// getTimestamp
// ============================================================
describe('getTimestamp', () => {
  it('returns a non-empty string in YYYY-MM-DD_HH-MM-SS format', () => {
    const ts = getTimestamp()
    expect(ts).toMatch(/^\d{4}-\d{2}-\d{2}_\d{2}-\d{2}-\d{2}$/)
  })
})

// ============================================================
// formatExpiryDate
// ============================================================
describe('formatExpiryDate', () => {
  it('formats for Korean locale', () => {
    const d = new Date(2025, 11, 25)
    const result = formatExpiryDate(d, 'ko')
    expect(result).toBeTruthy()
    expect(result).toContain('2025')
  })

  it('formats for English locale', () => {
    const d = new Date(2025, 11, 25)
    const result = formatExpiryDate(d, 'en')
    expect(result).toBeTruthy()
    expect(result).toContain('2025')
    expect(result).toContain('Dec')
  })

  it('returns empty string for invalid input', () => {
    expect(formatExpiryDate(null)).toBe('')
  })
})

// ============================================================
// formatFileSize
// ============================================================
describe('formatFileSize', () => {
  it('returns "0 B" for 0 or falsy', () => {
    expect(formatFileSize(0)).toBe('0 B')
    expect(formatFileSize(null)).toBe('0 B')
  })

  it('formats bytes', () => {
    expect(formatFileSize(500)).toBe('500 B')
  })

  it('formats kilobytes', () => {
    expect(formatFileSize(1024)).toBe('1.0 KB')
  })

  it('formats megabytes', () => {
    expect(formatFileSize(1048576)).toBe('1.0 MB')
  })

  it('formats gigabytes', () => {
    expect(formatFileSize(1073741824)).toBe('1.0 GB')
  })

  it('respects decimals parameter', () => {
    expect(formatFileSize(1500, 2)).toBe('1.46 KB')
  })
})

// ============================================================
// formatPercent
// ============================================================
describe('formatPercent', () => {
  it('formats 0-1 range to percent', () => {
    expect(formatPercent(0.755, 1)).toBe('75.5%')
    expect(formatPercent(1, 0)).toBe('100%')
  })

  it('handles > 1 as already percent', () => {
    expect(formatPercent(75)).toBe('75%')
    expect(formatPercent(100)).toBe('100%')
  })
})

// ============================================================
// generateProjectName
// ============================================================
describe('generateProjectName', () => {
  it('starts with default prefix', () => {
    const name = generateProjectName()
    expect(name).toMatch(/^autoflowcut_\d+$/)
  })

  it('uses custom prefix', () => {
    const name = generateProjectName('test')
    expect(name).toMatch(/^test_\d+$/)
  })
})

// ============================================================
// generateSceneFilename
// ============================================================
describe('generateSceneFilename', () => {
  it('includes sceneId and extension', () => {
    const filename = generateSceneFilename('scene_1', 'myproject')
    expect(filename).toMatch(/^scene_1_\d{4}-\d{2}-\d{2}_\d{2}-\d{2}-\d{2}\.png$/)
  })

  it('uses custom extension', () => {
    const filename = generateSceneFilename('scene_2', 'proj', 'jpg')
    expect(filename).toMatch(/\.jpg$/)
  })
})

// ============================================================
// getResolutionTag
// ============================================================
describe('getResolutionTag', () => {
  it('returns SD for small images', () => {
    expect(getResolutionTag(1920, 1080)).toBe('SD')
    expect(getResolutionTag(1000, 500)).toBe('SD')
  })

  it('returns HD for >= 2000', () => {
    expect(getResolutionTag(2000, 1080)).toBe('HD')
  })

  it('returns HD+ for >= 3500', () => {
    expect(getResolutionTag(3500, 2000)).toBe('HD+')
  })

  it('returns QHD for >= 5000', () => {
    expect(getResolutionTag(5000, 3000)).toBe('QHD')
  })

  it('returns 4K for >= 7000', () => {
    expect(getResolutionTag(7680, 4320)).toBe('4K')
  })

  it('returns 8K for >= 14000', () => {
    expect(getResolutionTag(15360, 8640)).toBe('8K')
  })

  it('handles null/undefined dimensions', () => {
    expect(getResolutionTag(undefined, undefined)).toBe('SD')
    expect(getResolutionTag(null, null)).toBe('SD')
  })
})

// ============================================================
// getRatioClass
// ============================================================
describe('getRatioClass', () => {
  it('returns ratio-landscape for 16:9', () => {
    expect(getRatioClass('16:9')).toBe('ratio-landscape')
  })

  it('returns ratio-portrait for 9:16', () => {
    expect(getRatioClass('9:16')).toBe('ratio-portrait')
  })

  it('returns ratio-square for 1:1', () => {
    expect(getRatioClass('1:1')).toBe('ratio-square')
  })

  it('returns ratio-square for unknown ratio', () => {
    expect(getRatioClass('4:3')).toBe('ratio-square')
  })
})

// ============================================================
// generateRandomSeed
// ============================================================
describe('generateRandomSeed', () => {
  it('returns a string', () => {
    const seed = generateRandomSeed()
    expect(typeof seed).toBe('string')
  })

  it('returns a value in valid range', () => {
    const seed = Number(generateRandomSeed())
    expect(seed).toBeGreaterThanOrEqual(0)
    expect(seed).toBeLessThan(2147483647)
  })
})

// ============================================================
// getImageSizeFromBase64
// ============================================================
describe('getImageSizeFromBase64', () => {
  it('returns a promise', () => {
    // jsdom doesn't have real Image loading; just verify it returns a promise
    const result = getImageSizeFromBase64('data:image/png;base64,iVBOR')
    expect(result).toBeInstanceOf(Promise)
  })
})

// ============================================================
// formatTimestamp / formatDate / formatDateTimeFull / formatDateShort
// ============================================================
describe('formatTimestamp', () => {
  it('returns empty string for null', () => {
    expect(formatTimestamp(null)).toBe('')
  })

  it('formats a valid date', () => {
    const result = formatTimestamp(new Date(2024, 0, 19, 6, 20))
    expect(result).toBeTruthy()
  })
})

describe('formatDate', () => {
  it('returns empty string for null', () => {
    expect(formatDate(null)).toBe('')
  })

  it('formats a valid date', () => {
    const result = formatDate(new Date(2024, 0, 19))
    expect(result).toBeTruthy()
    expect(result).toContain('2024')
  })
})

describe('formatDateTimeFull', () => {
  it('returns empty string for null', () => {
    expect(formatDateTimeFull(null)).toBe('')
  })
})

describe('formatDateShort', () => {
  it('returns M/D HH:MM format', () => {
    const result = formatDateShort(new Date(2024, 0, 19, 14, 5))
    expect(result).toBe('1/19 14:05')
  })

  it('returns empty string for invalid', () => {
    expect(formatDateShort(null)).toBe('')
  })
})

describe('formatNumber', () => {
  it('formats with locale separators', () => {
    const result = formatNumber(1234567)
    expect(result).toBeTruthy()
    // The exact format depends on locale, but the number should be there
    expect(result.replace(/[^0-9]/g, '')).toBe('1234567')
  })
})
