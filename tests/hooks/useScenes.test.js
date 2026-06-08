/**
 * useScenes hook tests
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { renderHook, act } from '@testing-library/react'
import { useScenes } from '../../src/hooks/useScenes'

// Mock fileSystemAPI
vi.mock('../../src/hooks/useFileSystem', () => ({
  fileSystemAPI: {
    readFileByPath: vi.fn().mockResolvedValue({ success: false }),
  }
}))

describe('useScenes', () => {
  // ============================================================
  // parseFromText
  // ============================================================
  describe('parseFromText', () => {
    it('parses lines into scenes with default duration', () => {
      const { result } = renderHook(() => useScenes())

      let scenes
      act(() => {
        scenes = result.current.parseFromText('scene one\nscene two\nscene three')
      })

      expect(scenes).toHaveLength(3)
      expect(scenes[0].id).toBe('scene_1')
      expect(scenes[0].prompt).toBe('scene one')
      expect(scenes[0].status).toBe('pending')
      expect(scenes[0].image).toBeNull()
      expect(scenes[1].id).toBe('scene_2')
      expect(scenes[1].prompt).toBe('scene two')
      expect(scenes[2].id).toBe('scene_3')
      expect(scenes[2].prompt).toBe('scene three')
    })

    it('sets sequential timing with default duration', () => {
      const { result } = renderHook(() => useScenes())

      let scenes
      act(() => {
        scenes = result.current.parseFromText('a\nb')
      })

      // default duration = 3
      expect(scenes[0].startTime).toBe(0)
      expect(scenes[0].endTime).toBe(3)
      expect(scenes[0].duration).toBe(3)
      expect(scenes[1].startTime).toBe(3)
      expect(scenes[1].endTime).toBe(6)
    })

    it('uses custom duration', () => {
      const { result } = renderHook(() => useScenes())

      let scenes
      act(() => {
        scenes = result.current.parseFromText('a\nb', 5)
      })

      expect(scenes[0].duration).toBe(5)
      expect(scenes[0].endTime).toBe(5)
      expect(scenes[1].startTime).toBe(5)
      expect(scenes[1].endTime).toBe(10)
    })

    it('ignores empty lines', () => {
      const { result } = renderHook(() => useScenes())

      let scenes
      act(() => {
        scenes = result.current.parseFromText('hello\n\n\nworld\n')
      })

      expect(scenes).toHaveLength(2)
      expect(scenes[0].prompt).toBe('hello')
      expect(scenes[1].prompt).toBe('world')
    })

    it('updates hook state', () => {
      const { result } = renderHook(() => useScenes())

      act(() => {
        result.current.parseFromText('line one')
      })

      expect(result.current.scenes).toHaveLength(1)
      expect(result.current.scenes[0].prompt).toBe('line one')
    })
  })

  // ============================================================
  // parseFromCSV
  // ============================================================
  describe('parseFromCSV', () => {
    it('parses CSV with headers into scenes', () => {
      const csv = 'prompt,subtitle,characters,scene_tag,style_tag,duration\n"A cat",Meow,cat,forest,cartoon,4'
      const { result } = renderHook(() => useScenes())

      let scenes
      act(() => {
        scenes = result.current.parseFromCSV(csv)
      })

      expect(scenes).toHaveLength(1)
      expect(scenes[0].prompt).toBe('A cat')
      expect(scenes[0].subtitle).toBe('Meow')
      expect(scenes[0].characters).toBe('cat')
      expect(scenes[0].scene_tag).toBe('forest')
      expect(scenes[0].style_tag).toBe('cartoon')
      expect(scenes[0].duration).toBe(4)
    })

    it('returns empty array for header-only CSV', () => {
      const { result } = renderHook(() => useScenes())

      let scenes
      act(() => {
        scenes = result.current.parseFromCSV('prompt,subtitle')
      })

      expect(scenes).toHaveLength(0)
    })

    it('uses default duration when not specified', () => {
      const csv = 'prompt\nhello world'
      const { result } = renderHook(() => useScenes())

      let scenes
      act(() => {
        scenes = result.current.parseFromCSV(csv, 7)
      })

      expect(scenes[0].duration).toBe(7)
    })
  })

  // ============================================================
  // parseFromSRT
  // ============================================================
  describe('parseFromSRT', () => {
    it('parses SRT text into scenes', () => {
      const srt = `1
00:00:00,000 --> 00:00:03,000
Hello world

2
00:00:03,000 --> 00:00:06,500
Goodbye world`

      const { result } = renderHook(() => useScenes())

      let scenes
      act(() => {
        scenes = result.current.parseFromSRT(srt)
      })

      expect(scenes).toHaveLength(2)
      expect(scenes[0].subtitle).toBe('Hello world')
      expect(scenes[0].prompt).toBe('') // SRT 는 prompt 채우지 않음 (책임 분리)
      expect(scenes[0].startTime).toBe(0)
      expect(scenes[0].endTime).toBe(3)
      expect(scenes[0].duration).toBe(3)
      expect(scenes[1].subtitle).toBe('Goodbye world')
      expect(scenes[1].startTime).toBe(3)
      expect(scenes[1].endTime).toBe(6.5)
    })
  })

  // ============================================================
  // updateScene
  // ============================================================
  describe('updateScene', () => {
    it('immutably updates a specific scene', () => {
      const { result } = renderHook(() => useScenes())

      act(() => {
        result.current.parseFromText('a\nb\nc')
      })

      const beforeScenes = result.current.scenes

      act(() => {
        result.current.updateScene('scene_2', { prompt: 'updated', status: 'done' })
      })

      // Original reference should differ (immutable)
      expect(result.current.scenes).not.toBe(beforeScenes)
      expect(result.current.scenes[1].prompt).toBe('updated')
      expect(result.current.scenes[1].status).toBe('done')
      // Others unchanged
      expect(result.current.scenes[0].prompt).toBe('a')
      expect(result.current.scenes[2].prompt).toBe('c')
    })

    it('does nothing if scene id not found', () => {
      const { result } = renderHook(() => useScenes())

      act(() => {
        result.current.parseFromText('a')
      })

      act(() => {
        result.current.updateScene('scene_999', { prompt: 'nope' })
      })

      expect(result.current.scenes[0].prompt).toBe('a')
    })
  })

  // ============================================================
  // deleteScene
  // ============================================================
  describe('deleteScene', () => {
    it('removes scene but does NOT renumber surviving IDs', () => {
      const { result } = renderHook(() => useScenes())

      act(() => {
        result.current.parseFromText('a\nb\nc')
      })

      act(() => {
        result.current.deleteScene('scene_2')
      })

      expect(result.current.scenes).toHaveLength(2)
      // scene_1 and scene_3 survive with their original IDs (no renumber)
      expect(result.current.scenes[0].id).toBe('scene_1')
      expect(result.current.scenes[0].prompt).toBe('a')
      expect(result.current.scenes[1].id).toBe('scene_3')
      expect(result.current.scenes[1].prompt).toBe('c')
    })

    it('handles deleting first scene (survivor keeps its original ID)', () => {
      const { result } = renderHook(() => useScenes())

      act(() => {
        result.current.parseFromText('first\nsecond')
      })

      act(() => {
        result.current.deleteScene('scene_1')
      })

      expect(result.current.scenes).toHaveLength(1)
      // scene_2 keeps its ID — no renumber
      expect(result.current.scenes[0].id).toBe('scene_2')
      expect(result.current.scenes[0].prompt).toBe('second')
    })

    it('handles deleting non-existent scene', () => {
      const { result } = renderHook(() => useScenes())

      act(() => {
        result.current.parseFromText('a')
      })

      act(() => {
        result.current.deleteScene('scene_999')
      })

      expect(result.current.scenes).toHaveLength(1)
    })
  })

  // ============================================================
  // addScene
  // ============================================================
  describe('addScene', () => {
    it('appends scene at end by default', () => {
      const { result } = renderHook(() => useScenes())

      act(() => {
        result.current.parseFromText('a\nb')
      })

      act(() => {
        result.current.addScene()
      })

      expect(result.current.scenes).toHaveLength(3)
      expect(result.current.scenes[2].id).toBe('scene_3')
      expect(result.current.scenes[2].prompt).toBe('')
      expect(result.current.scenes[2].status).toBe('pending')
    })

    it('inserts scene after specified index', () => {
      const { result } = renderHook(() => useScenes())

      act(() => {
        result.current.parseFromText('a\nb\nc')
      })

      act(() => {
        result.current.addScene(0)
      })

      expect(result.current.scenes).toHaveLength(4)
      expect(result.current.scenes[0].prompt).toBe('a')
      expect(result.current.scenes[1].prompt).toBe('')  // inserted
      expect(result.current.scenes[2].prompt).toBe('b')
      expect(result.current.scenes[3].prompt).toBe('c')
    })

    it('uses next allocated ID for inserted scene, existing IDs unchanged', () => {
      const { result } = renderHook(() => useScenes())

      act(() => {
        result.current.parseFromText('a\nb')
      })

      act(() => {
        result.current.addScene(0)
      })

      // parseFromText allocated scene_1 and scene_2; next addScene gets scene_3
      // Order after insert-after-index-0: [scene_1(a), scene_3(new), scene_2(b)]
      expect(result.current.scenes[0].id).toBe('scene_1')
      expect(result.current.scenes[1].id).toBe('scene_3')
      expect(result.current.scenes[2].id).toBe('scene_2')
    })

    it('recalculates timing after insert', () => {
      const { result } = renderHook(() => useScenes())

      act(() => {
        result.current.parseFromText('a\nb')
      })

      act(() => {
        result.current.addScene(0)
      })

      // All scenes should have sequential timing
      const scenes = result.current.scenes
      expect(scenes[0].startTime).toBe(0)
      expect(scenes[1].startTime).toBe(scenes[0].endTime)
      expect(scenes[2].startTime).toBe(scenes[1].endTime)
    })
  })

  // ============================================================
  // moveScene
  // ============================================================
  describe('moveScene', () => {
    it('moves scene from one position to another', () => {
      const { result } = renderHook(() => useScenes())

      act(() => {
        result.current.parseFromText('a\nb\nc')
      })

      act(() => {
        result.current.moveScene(2, 0)
      })

      expect(result.current.scenes[0].prompt).toBe('c')
      expect(result.current.scenes[1].prompt).toBe('a')
      expect(result.current.scenes[2].prompt).toBe('b')
    })

    it('keeps original IDs after move (positions shift, IDs do not renumber)', () => {
      const { result } = renderHook(() => useScenes())

      act(() => {
        result.current.parseFromText('a\nb\nc')
      })

      act(() => {
        result.current.moveScene(0, 2)
      })

      // scene_1(a) moved to end: order becomes scene_2(b), scene_3(c), scene_1(a)
      expect(result.current.scenes[0].id).toBe('scene_2')
      expect(result.current.scenes[1].id).toBe('scene_3')
      expect(result.current.scenes[2].id).toBe('scene_1')
    })

    it('does nothing when same index', () => {
      const { result } = renderHook(() => useScenes())

      act(() => {
        result.current.parseFromText('a\nb')
      })

      const before = result.current.scenes

      act(() => {
        result.current.moveScene(0, 0)
      })

      // Same reference when no change
      expect(result.current.scenes).toBe(before)
    })

    it('recalculates timing after move', () => {
      const { result } = renderHook(() => useScenes())

      act(() => {
        result.current.parseFromText('a\nb\nc')
      })

      act(() => {
        result.current.moveScene(2, 0)
      })

      const scenes = result.current.scenes
      expect(scenes[0].startTime).toBe(0)
      expect(scenes[1].startTime).toBe(scenes[0].endTime)
      expect(scenes[2].startTime).toBe(scenes[1].endTime)
    })
  })

  // ============================================================
  // clearScenes
  // ============================================================
  describe('clearScenes', () => {
    it('resets scenes to empty array', () => {
      const { result } = renderHook(() => useScenes())

      act(() => {
        result.current.parseFromText('a\nb\nc')
      })

      expect(result.current.scenes).toHaveLength(3)

      act(() => {
        result.current.clearScenes()
      })

      expect(result.current.scenes).toHaveLength(0)
    })
  })

  // ============================================================
  // updateReferences
  // ============================================================
  describe('updateReferences', () => {
    it('sets references array', () => {
      const { result } = renderHook(() => useScenes())

      const refs = [
        { name: 'hero', type: 'character', category: 'MEDIA_CATEGORY_SUBJECT' },
        { name: 'forest', type: 'scene', category: 'MEDIA_CATEGORY_SCENE' },
      ]

      act(() => {
        result.current.updateReferences(refs)
      })

      expect(result.current.references).toEqual(refs)
    })

    it('replaces existing references', () => {
      const { result } = renderHook(() => useScenes())

      act(() => {
        result.current.updateReferences([{ name: 'old' }])
      })

      act(() => {
        result.current.updateReferences([{ name: 'new' }])
      })

      expect(result.current.references).toEqual([{ name: 'new' }])
    })
  })

  // ============================================================
  // getMatchingReferences
  // ============================================================
  describe('getMatchingReferences', () => {
    function setupWithRefs() {
      const { result } = renderHook(() => useScenes())

      act(() => {
        result.current.updateReferences([
          { name: 'Hero', type: 'character' },
          { name: 'Villain', type: 'character' },
          { name: '철수', type: 'character' },
          { name: 'Forest', type: 'scene' },
          { name: 'Castle', type: 'scene' },
          { name: 'Anime', type: 'style' },
          { name: 'Watercolor', type: 'style' },
        ])
      })

      return result
    }

    it('matches character tags (case-insensitive)', () => {
      const result = setupWithRefs()

      const scene = { characters: 'hero', scene_tag: '', style_tag: '' }
      const matched = result.current.getMatchingReferences(scene)

      expect(matched).toHaveLength(1)
      expect(matched[0].name).toBe('Hero')
    })

    it('matches scene tags', () => {
      const result = setupWithRefs()

      const scene = { characters: '', scene_tag: 'forest', style_tag: '' }
      const matched = result.current.getMatchingReferences(scene)

      expect(matched).toHaveLength(1)
      expect(matched[0].name).toBe('Forest')
    })

    it('matches style tags', () => {
      const result = setupWithRefs()

      const scene = { characters: '', scene_tag: '', style_tag: 'anime' }
      const matched = result.current.getMatchingReferences(scene)

      expect(matched).toHaveLength(1)
      expect(matched[0].name).toBe('Anime')
    })

    it('matches category-only style references', () => {
      const { result } = renderHook(() => useScenes())

      act(() => {
        result.current.updateReferences([
          { name: 'Noir', category: 'MEDIA_CATEGORY_STYLE', prompt: 'noir lighting' },
        ])
      })

      const matched = result.current.getMatchingReferences({ characters: '', scene_tag: '', style_tag: 'noir' })
      expect(matched).toHaveLength(1)
      expect(matched[0].name).toBe('Noir')
    })

    it('matches multiple tags with comma delimiter', () => {
      const result = setupWithRefs()

      const scene = { characters: 'hero,villain', scene_tag: '', style_tag: '' }
      const matched = result.current.getMatchingReferences(scene)

      expect(matched).toHaveLength(2)
    })

    it('matches tags with semicolon delimiter', () => {
      const result = setupWithRefs()

      const scene = { characters: 'hero;villain', scene_tag: '', style_tag: '' }
      const matched = result.current.getMatchingReferences(scene)

      expect(matched).toHaveLength(2)
    })

    it('matches tags with colon delimiter', () => {
      const result = setupWithRefs()

      const scene = { characters: 'hero:villain', scene_tag: '', style_tag: '' }
      const matched = result.current.getMatchingReferences(scene)

      expect(matched).toHaveLength(2)
    })

    it('matches across all three tag types', () => {
      const result = setupWithRefs()

      const scene = { characters: 'hero', scene_tag: 'forest', style_tag: 'anime' }
      const matched = result.current.getMatchingReferences(scene)

      expect(matched).toHaveLength(3)
    })

    it('returns empty for null scene', () => {
      const result = setupWithRefs()
      expect(result.current.getMatchingReferences(null)).toEqual([])
    })

    it('returns empty when no references set', () => {
      const { result } = renderHook(() => useScenes())

      const scene = { characters: 'hero', scene_tag: '', style_tag: '' }
      expect(result.current.getMatchingReferences(scene)).toEqual([])
    })

    it('returns empty when tags do not match', () => {
      const result = setupWithRefs()

      const scene = { characters: 'unknown', scene_tag: 'beach', style_tag: 'abstract' }
      expect(result.current.getMatchingReferences(scene)).toEqual([])
    })

    it('handles whitespace in tag strings', () => {
      const result = setupWithRefs()

      const scene = { characters: ' hero , villain ', scene_tag: '', style_tag: '' }
      const matched = result.current.getMatchingReferences(scene)

      expect(matched).toHaveLength(2)
    })

    it('also matches @name inline mentions in scene.prompt', () => {
      const result = setupWithRefs()

      const scene = { prompt: 'A wizard @hero fighting @villain in @forest', characters: '', scene_tag: '', style_tag: '' }
      const matched = result.current.getMatchingReferences(scene)

      expect(matched.map((r) => r.name).sort()).toEqual(['Forest', 'Hero', 'Villain'])
    })

    it('also matches @name inline mentions with attached Hangul particles', () => {
      const result = setupWithRefs()

      const scene = { prompt: 'A wizard @hero가 @forest에서 걷는다', characters: '', scene_tag: '', style_tag: '' }
      const matched = result.current.getMatchingReferences(scene)

      expect(matched.map((r) => r.name).sort()).toEqual(['Forest', 'Hero'])
    })

    it('also matches Hangul @name inline mentions with attached particles', () => {
      const result = setupWithRefs()

      const scene = { prompt: '@철수가 숲으로 간다', characters: '', scene_tag: '', style_tag: '' }
      const matched = result.current.getMatchingReferences(scene)

      expect(matched.map((r) => r.name)).toEqual(['철수'])
    })

    it('dedupes @mention with CSV tag pointing at the same ref', () => {
      const result = setupWithRefs()

      const scene = { prompt: 'A wizard @hero appears', characters: 'hero', scene_tag: '', style_tag: '' }
      const matched = result.current.getMatchingReferences(scene)

      expect(matched).toHaveLength(1)
      expect(matched[0].name).toBe('Hero')
    })
  })

  // ============================================================
  // sceneStats & computed queries
  // ============================================================
  describe('sceneStats and query helpers', () => {
    it('computes stats correctly', () => {
      const { result } = renderHook(() => useScenes())

      act(() => {
        result.current.parseFromText('a\nb\nc\nd\ne')
      })

      // Mark some statuses
      act(() => {
        result.current.updateScene('scene_1', { status: 'done' })
        result.current.updateScene('scene_2', { status: 'done' })
        result.current.updateScene('scene_3', { status: 'error' })
        result.current.updateScene('scene_4', { status: 'generating' })
        // scene_5 stays 'pending'
      })

      expect(result.current.getCompletedCount()).toBe(2)
      expect(result.current.getErrorCount()).toBe(1)
      expect(result.current.getErrorScenes()).toHaveLength(1)
      expect(result.current.getErrorScenes()[0].prompt).toBe('c')
      expect(result.current.getPendingScenes()).toHaveLength(1)
      expect(result.current.getPendingScenes()[0].prompt).toBe('e')
    })

    it('returns zeros for empty scenes', () => {
      const { result } = renderHook(() => useScenes())

      expect(result.current.getCompletedCount()).toBe(0)
      expect(result.current.getErrorCount()).toBe(0)
      expect(result.current.getErrorScenes()).toEqual([])
      expect(result.current.getPendingScenes()).toEqual([])
    })
  })

  // ============================================================
  // 머지 모드 — ep02 시연 흐름: SRT 가져오기 → .txt 가져오기 → subtitle·duration 보존
  // ============================================================
  describe('merge mode (sequential imports preserve fields)', () => {
    const SRT = `1
00:00:00,000 --> 00:00:04,157
미국이 진 빚, 약 39조 달러. 우리 돈으로 5경 원이 넘습니다.

2
00:00:04,157 --> 00:00:06,501
지금 이 순간에도 빠르게 늘어나고 있습니다.`

    it('SRT 후 .txt 가져오기: subtitle/duration 보존, prompt만 갱신', () => {
      const { result } = renderHook(() => useScenes())

      // STEP 3: SRT 가져오기
      act(() => {
        result.current.parseFromSRT(SRT)
      })
      expect(result.current.scenes).toHaveLength(2)
      expect(result.current.scenes[0].subtitle).toBe('미국이 진 빚, 약 39조 달러. 우리 돈으로 5경 원이 넘습니다.')
      expect(result.current.scenes[0].duration).toBeCloseTo(4.157, 3)
      // SRT 머지: prompt 는 자막을 복사하지 않음 (책임 분리). 빈 prompt 그대로.
      expect(result.current.scenes[0].prompt).toBe('')

      // STEP 4: prompts.txt 가져오기
      act(() => {
        result.current.parseFromText('거대한 디지털 숫자판\n빌딩 높이만큼 솟아오른 달러')
      })

      expect(result.current.scenes).toHaveLength(2)
      // prompt는 새 값으로 갱신
      expect(result.current.scenes[0].prompt).toBe('거대한 디지털 숫자판')
      expect(result.current.scenes[1].prompt).toBe('빌딩 높이만큼 솟아오른 달러')
      // subtitle 보존 ✅
      expect(result.current.scenes[0].subtitle).toBe('미국이 진 빚, 약 39조 달러. 우리 돈으로 5경 원이 넘습니다.')
      expect(result.current.scenes[1].subtitle).toBe('지금 이 순간에도 빠르게 늘어나고 있습니다.')
      // duration 보존 ✅
      expect(result.current.scenes[0].duration).toBeCloseTo(4.157, 3)
      expect(result.current.scenes[1].duration).toBeCloseTo(2.344, 3)
    })

    it('.txt 후 SRT 가져오기: prompt 보존, subtitle·duration 갱신', () => {
      const { result } = renderHook(() => useScenes())

      // 먼저 prompts.txt 가져오기
      act(() => {
        result.current.parseFromText('이미지 프롬프트 1\n이미지 프롬프트 2')
      })

      // 그 후 SRT 가져오기
      act(() => {
        result.current.parseFromSRT(SRT)
      })

      expect(result.current.scenes).toHaveLength(2)
      // prompt 보존 ✅
      expect(result.current.scenes[0].prompt).toBe('이미지 프롬프트 1')
      expect(result.current.scenes[1].prompt).toBe('이미지 프롬프트 2')
      // subtitle/duration 갱신 ✅
      expect(result.current.scenes[0].subtitle).toBe('미국이 진 빚, 약 39조 달러. 우리 돈으로 5경 원이 넘습니다.')
      expect(result.current.scenes[0].duration).toBeCloseTo(4.157, 3)
    })

    it('parseFromText는 PromptInput onChange와 동일한 머지 동작 (입력창=가져오기 일관성)', () => {
      const { result } = renderHook(() => useScenes())

      // 초기: SRT
      act(() => {
        result.current.parseFromSRT(SRT)
      })

      // PromptInput에서 prompt 텍스트 편집 (handleTextChange 시뮬레이션)
      act(() => {
        result.current.parseFromText('수정된 프롬프트 A\n수정된 프롬프트 B')
      })

      // subtitle, duration 보존 — *입력창 동작도 가져오기와 동일* 보장
      expect(result.current.scenes[0].subtitle).toBeTruthy()
      expect(result.current.scenes[0].duration).toBeCloseTo(4.157, 3)
      expect(result.current.scenes[0].prompt).toBe('수정된 프롬프트 A')
    })
  })
})
