/**
 * CSV 재적용(앱 parseFromCSV 새 형식 · MCP load_csv 의 update-scenes)이 CSV 가 싣지 않는 씬 런타임 필드를 보존하는 **한 목록**.
 * 2026-09-26 실기: MCP 경로는 영상 결과·선택·생성 메타를 전부 버렸고, 앱 경로도 model·seed·생성 시각을 버렸다(이미지 탭 모델명 소실).
 * CSV 가 쓰는 필드(프롬프트·자막·시간)와 옛 형식 별칭(start_time/end_time)은 목록에 없어야 한다 — 실으면 CSV 값을 가린다.
 */
import { describe, it, expect } from 'vitest'
import { CSV_PRESERVED_SCENE_FIELDS, pickPreservedSceneFields } from '../../src/utils/csvPreservedSceneFields'

describe('CSV_PRESERVED_SCENE_FIELDS', () => {
  it('이미지·영상 탭이 보여 주는 생성 메타를 보존한다', () => {
    for (const k of ['model', 'seed', 'generatedAt', 'generatingEndedAt', 'videoT2VModel', 'videoT2VSeed', 'videoT2VGeneratedAt', 'videoT2VSaveId']) {
      expect(CSV_PRESERVED_SCENE_FIELDS).toContain(k)
    }
  })

  it('parseFromCSV 가 늘 보존하던 결과 포인터·런타임 상태를 그대로 담는다', () => {
    for (const k of [
      'image', 'imagePath', 'mediaId', 'generatingStartedAt', 'image_size', 'donePrompt',
      'videoT2V', 'videoT2VPath', 'videoI2V', 'videoI2VPath', 'videoT2VDuration', 'videoI2VDuration',
      'videoT2VDisabled', 'videoI2VDisabled',
      'videoT2VStatus', 'videoT2VMediaId', 'videoT2VGenerationId', 'videoT2VSelected',
      'videoT2VGeneratingStartedAt', 'videoT2VGeneratingEndedAt',
      'videoI2VStatus', 'videoI2VGeneratingStartedAt', 'videoI2VGeneratingEndedAt',
    ]) {
      expect(CSV_PRESERVED_SCENE_FIELDS).toContain(k)
    }
  })

  it('CSV 가 쓰는 필드·옛 형식 별칭·식별자는 담지 않는다(실으면 CSV 값을 가린다)', () => {
    for (const k of ['prompt', 'prompt_ko', 'subtitle', 'characters', 'scene_tag', 'style_tag', 'videoT2VPrompt', 'videoI2VPrompt',
      'startTime', 'endTime', 'duration', 'start_time', 'end_time', 'srtLineIds', 'status', 'id', '_sceneNum']) {
      expect(CSV_PRESERVED_SCENE_FIELDS).not.toContain(k)
    }
  })
})

describe('pickPreservedSceneFields', () => {
  it('목록의 키만 정확히 옮긴다', () => {
    const existing = { prompt: 'p', start_time: 1, model: 'Nano Banana 2', videoT2VPath: '/v.mp4', extra: 'x' }
    const picked = pickPreservedSceneFields(existing)
    expect(Object.keys(picked).sort()).toEqual([...CSV_PRESERVED_SCENE_FIELDS].sort())
    expect(picked.model).toBe('Nano Banana 2')
    expect(picked.videoT2VPath).toBe('/v.mp4')
    expect('prompt' in picked || 'start_time' in picked || 'extra' in picked).toBe(false)
  })
})
