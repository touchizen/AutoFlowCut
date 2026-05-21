/**
 * parsers.js 테스트
 */
import { describe, it, expect } from 'vitest'
import {
  parseCSVLine,
  parseSRTTime,
  parseTextToScenes,
  parseCSVToScenes,
  parseSRTToScenes,
  detectFileType,
  detectCSVType,
  parseReferencesCSV,
  mergeReferences,
  findDuplicateReferenceNames,
} from '../../src/utils/parsers'

// ============================================================
// parseCSVLine
// ============================================================
describe('parseCSVLine', () => {
  it('splits simple CSV', () => {
    expect(parseCSVLine('a,b,c')).toEqual(['a', 'b', 'c'])
  })

  it('handles quoted fields with commas', () => {
    expect(parseCSVLine('a,"b,c",d')).toEqual(['a', 'b,c', 'd'])
  })

  it('trims whitespace', () => {
    expect(parseCSVLine(' a , b , c ')).toEqual(['a', 'b', 'c'])
  })

  it('handles empty fields', () => {
    expect(parseCSVLine('a,,c')).toEqual(['a', '', 'c'])
  })
})

// ============================================================
// parseSRTTime
// ============================================================
describe('parseSRTTime', () => {
  it('parses SRT time to seconds', () => {
    expect(parseSRTTime('00:00:00,000')).toBe(0)
    expect(parseSRTTime('00:01:30,000')).toBe(90)
    expect(parseSRTTime('01:01:01,500')).toBeCloseTo(3661.5, 1)
  })

  it('handles dot separator', () => {
    expect(parseSRTTime('00:01:30.500')).toBeCloseTo(90.5, 1)
  })
})

// ============================================================
// parseTextToScenes
// ============================================================
describe('parseTextToScenes', () => {
  it('parses lines into scenes', () => {
    const text = 'scene one\nscene two\nscene three'
    const scenes = parseTextToScenes(text)
    expect(scenes).toHaveLength(3)
    expect(scenes[0].id).toBe('scene_1')
    expect(scenes[0].prompt).toBe('scene one')
    expect(scenes[1].id).toBe('scene_2')
  })

  it('sets default duration (3s)', () => {
    const scenes = parseTextToScenes('hello')
    expect(scenes[0].duration).toBe(3)
    expect(scenes[0].startTime).toBe(0)
    expect(scenes[0].endTime).toBe(3)
  })

  it('uses custom duration', () => {
    const scenes = parseTextToScenes('a\nb', 5)
    expect(scenes[0].duration).toBe(5)
    expect(scenes[1].startTime).toBe(5)
    expect(scenes[1].endTime).toBe(10)
  })

  it('skips empty lines', () => {
    const text = 'scene one\n\n\nscene two'
    const scenes = parseTextToScenes(text)
    expect(scenes).toHaveLength(2)
  })

  it('sets expected fields on each scene', () => {
    const scenes = parseTextToScenes('test prompt')
    const scene = scenes[0]
    expect(scene).toHaveProperty('id')
    expect(scene).toHaveProperty('startTime')
    expect(scene).toHaveProperty('endTime')
    expect(scene).toHaveProperty('duration')
    expect(scene).toHaveProperty('prompt')
    expect(scene).toHaveProperty('subtitle')
    expect(scene).toHaveProperty('status', 'pending')
    expect(scene).toHaveProperty('image', null)
  })
})

// ============================================================
// parseCSVToScenes
// ============================================================
describe('parseCSVToScenes', () => {
  it('parses CSV with headers', () => {
    const csv = 'prompt,duration\nfirst scene,5\nsecond scene,3'
    const scenes = parseCSVToScenes(csv)
    expect(scenes).toHaveLength(2)
    expect(scenes[0].prompt).toBe('first scene')
    expect(scenes[0].duration).toBe(5)
    expect(scenes[1].prompt).toBe('second scene')
  })

  it('returns empty array for too few lines', () => {
    expect(parseCSVToScenes('prompt')).toEqual([])
    expect(parseCSVToScenes('')).toEqual([])
  })

  it('uses default duration when not in CSV', () => {
    const csv = 'prompt\nhello'
    const scenes = parseCSVToScenes(csv)
    expect(scenes[0].duration).toBe(3) // DEFAULTS.scene.duration
  })

  it('parses subtitle and other fields', () => {
    const csv = 'prompt,subtitle,characters,scene_tag,style_tag\ntest,sub,char1,outdoor,anime'
    const scenes = parseCSVToScenes(csv)
    expect(scenes[0].subtitle).toBe('sub')
    expect(scenes[0].characters).toBe('char1')
    expect(scenes[0].scene_tag).toBe('outdoor')
    expect(scenes[0].style_tag).toBe('anime')
  })

  it('handles alternative column names', () => {
    const csv = 'prompt_en,subtitle_ko,character,scene,style\nhello,안녕,char,bg,art'
    const scenes = parseCSVToScenes(csv)
    expect(scenes[0].prompt).toBe('hello')
    expect(scenes[0].subtitle).toBe('안녕')
    expect(scenes[0].characters).toBe('char')
    expect(scenes[0].scene_tag).toBe('bg')
    expect(scenes[0].style_tag).toBe('art')
  })
})

// ============================================================
// parseSRTToScenes
// ============================================================
describe('parseSRTToScenes', () => {
  const srtSample = `1
00:00:00,000 --> 00:00:03,000
First subtitle

2
00:00:03,000 --> 00:00:06,500
Second subtitle`

  it('parses SRT blocks', () => {
    const scenes = parseSRTToScenes(srtSample)
    expect(scenes).toHaveLength(2)
  })

  it('sets times correctly', () => {
    const scenes = parseSRTToScenes(srtSample)
    expect(scenes[0].startTime).toBe(0)
    expect(scenes[0].endTime).toBe(3)
    expect(scenes[1].startTime).toBe(3)
    expect(scenes[1].endTime).toBeCloseTo(6.5, 1)
  })

  it('leaves prompt empty — subtitle is independent (책임 분리)', () => {
    const scenes = parseSRTToScenes(srtSample)
    expect(scenes[0].prompt).toBe('') // SRT 는 자막만, prompt 는 비워둠
    expect(scenes[0].subtitle).toBe('First subtitle')
  })

  it('handles multi-line subtitles', () => {
    const srt = `1
00:00:00,000 --> 00:00:03,000
Line one
Line two`
    const scenes = parseSRTToScenes(srt)
    expect(scenes[0].subtitle).toBe('Line one\nLine two')
  })

  it('skips invalid blocks', () => {
    const srt = `1
invalid time line
Some text

2
00:00:00,000 --> 00:00:03,000
Valid subtitle`
    const scenes = parseSRTToScenes(srt)
    expect(scenes).toHaveLength(1)
    expect(scenes[0].subtitle).toBe('Valid subtitle')
  })
})

// ============================================================
// detectFileType
// ============================================================
describe('detectFileType', () => {
  it('detects SRT files', () => {
    const srt = `1\n00:00:00,000 --> 00:00:03,000\nHello`
    expect(detectFileType(srt)).toBe('srt')
  })

  it('detects CSV scene files', () => {
    const csv = 'prompt,subtitle,duration\ntest,sub,3'
    expect(detectFileType(csv)).toBe('csv')
  })

  it('detects reference CSV files', () => {
    const csv = 'name,type\nChar1,character'
    expect(detectFileType(csv)).toBe('reference')
  })

  it('detects plain text', () => {
    expect(detectFileType('just some text')).toBe('text')
  })

  it('returns unknown for empty', () => {
    expect(detectFileType('')).toBe('unknown')
    expect(detectFileType('   ')).toBe('unknown')
  })
})

// ============================================================
// detectCSVType
// ============================================================
describe('detectCSVType', () => {
  it('detects scene CSV', () => {
    expect(detectCSVType('prompt,subtitle,duration\ntest,sub,3')).toBe('scene')
  })

  it('detects reference CSV', () => {
    expect(detectCSVType('name,type\nChar1,character')).toBe('reference')
  })

  it('detects scene CSV with prompt only', () => {
    expect(detectCSVType('prompt\nhello')).toBe('scene')
  })

  it('returns unknown for unrecognized headers', () => {
    expect(detectCSVType('foo,bar\n1,2')).toBe('unknown')
  })

  it('returns unknown for empty', () => {
    expect(detectCSVType('')).toBe('unknown')
  })
})

// ============================================================
// parseReferencesCSV
// ============================================================
describe('parseReferencesCSV', () => {
  it('parses reference CSV', () => {
    const csv = 'name,type,prompt\nHero,character,A brave hero\nForest,scene,Deep forest'
    const refs = parseReferencesCSV(csv)
    expect(refs).toHaveLength(2)
    expect(refs[0].name).toBe('Hero')
    expect(refs[0].type).toBe('character')
    expect(refs[0].category).toBe('MEDIA_CATEGORY_SUBJECT')
    expect(refs[0].prompt).toBe('A brave hero')
    expect(refs[1].type).toBe('scene')
    expect(refs[1].category).toBe('MEDIA_CATEGORY_SCENE')
  })

  it('returns null for too few lines', () => {
    expect(parseReferencesCSV('name,type')).toBeNull()
  })

  it('returns null when name column is missing', () => {
    expect(parseReferencesCSV('type,prompt\ncharacter,test')).toBeNull()
  })

  it('handles style type', () => {
    const csv = 'name,type\nAnime,style'
    const refs = parseReferencesCSV(csv)
    expect(refs[0].type).toBe('style')
    expect(refs[0].category).toBe('MEDIA_CATEGORY_STYLE')
  })

  it('handles background type mapped to scene', () => {
    const csv = 'name,type\nCity,background'
    const refs = parseReferencesCSV(csv)
    expect(refs[0].type).toBe('scene')
    expect(refs[0].category).toBe('MEDIA_CATEGORY_SCENE')
  })

  it('defaults type to character when no type column', () => {
    const csv = 'name,prompt\nHero,A hero'
    const refs = parseReferencesCSV(csv)
    expect(refs[0].type).toBe('character')
    expect(refs[0].category).toBe('MEDIA_CATEGORY_SUBJECT')
  })

  it('skips rows with empty name', () => {
    const csv = 'name,type\n,character\nHero,character'
    const refs = parseReferencesCSV(csv)
    expect(refs).toHaveLength(1)
    expect(refs[0].name).toBe('Hero')
  })

  it('returns null if all rows have empty names', () => {
    const csv = 'name,type\n,character\n,style'
    const refs = parseReferencesCSV(csv)
    expect(refs).toBeNull()
  })

  it('supports description as alias for prompt', () => {
    const csv = 'name,type,description\nHero,character,A hero desc'
    const refs = parseReferencesCSV(csv)
    expect(refs[0].prompt).toBe('A hero desc')
  })

  it('supports image column as alias for image_path', () => {
    const csv = 'name,type,image\nHero,character,/path/to/img.png'
    const refs = parseReferencesCSV(csv)
    expect(refs[0].imagePath).toBe('/path/to/img.png')
  })
})

// ============================================================
// mergeReferences
// ============================================================
describe('mergeReferences', () => {
  const existing = [
    { name: 'Hero', type: 'character', category: 'MEDIA_CATEGORY_SUBJECT', prompt: 'old', mediaId: 'mid1', data: 'oldData' }
  ]

  it('adds new references', () => {
    const newRefs = [{ name: 'Villain', type: 'character', category: 'MEDIA_CATEGORY_SUBJECT', prompt: 'bad guy' }]
    const merged = mergeReferences(existing, newRefs)
    expect(merged).toHaveLength(2)
    expect(merged[1].name).toBe('Villain')
    expect(merged[1]).toHaveProperty('id')
    expect(merged[1]).toHaveProperty('mediaId', null)
  })

  it('updates existing when updateExisting is true (default)', () => {
    const newRefs = [{ name: 'Hero', type: 'style', category: 'MEDIA_CATEGORY_STYLE', prompt: 'new prompt' }]
    const merged = mergeReferences(existing, newRefs, true)
    expect(merged).toHaveLength(1)
    expect(merged[0].type).toBe('style')
    expect(merged[0].prompt).toBe('new prompt')
    // mediaId should be preserved from original
    expect(merged[0].mediaId).toBe('mid1')
  })

  it('skips duplicates when updateExisting is false', () => {
    const newRefs = [{ name: 'Hero', type: 'style', category: 'MEDIA_CATEGORY_STYLE', prompt: 'new prompt' }]
    const merged = mergeReferences(existing, newRefs, false)
    expect(merged).toHaveLength(1)
    expect(merged[0].prompt).toBe('old') // unchanged
  })

  it('does not mutate original arrays', () => {
    const newRefs = [{ name: 'Villain', type: 'character', category: 'MEDIA_CATEGORY_SUBJECT', prompt: '' }]
    const merged = mergeReferences(existing, newRefs)
    expect(existing).toHaveLength(1) // original unchanged
    expect(merged).toHaveLength(2)
  })
})

// ============================================================
// findDuplicateReferenceNames
// ============================================================
describe('findDuplicateReferenceNames', () => {
  const existing = [
    { name: 'Hero' },
    { name: 'Villain' }
  ]

  it('finds duplicates', () => {
    const newRefs = [{ name: 'Hero' }, { name: 'NewChar' }]
    const dupes = findDuplicateReferenceNames(existing, newRefs)
    expect(dupes).toEqual(['Hero'])
  })

  it('returns empty array when no duplicates', () => {
    const newRefs = [{ name: 'NewChar' }]
    const dupes = findDuplicateReferenceNames(existing, newRefs)
    expect(dupes).toEqual([])
  })

  it('finds multiple duplicates', () => {
    const newRefs = [{ name: 'Hero' }, { name: 'Villain' }, { name: 'New' }]
    const dupes = findDuplicateReferenceNames(existing, newRefs)
    expect(dupes).toEqual(['Hero', 'Villain'])
  })
})
