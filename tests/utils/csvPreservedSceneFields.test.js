/**
 * CSV 재적용(앱 parseFromCSV 새 형식 · MCP load_csv 의 update-scenes)이 CSV 가 싣지 않는 씬 런타임 필드를 보존하는 **한 목록**.
 * 2026-09-26 실기: MCP 경로는 영상 결과·선택·생성 메타를 전부 버렸고, 앱 경로도 model·seed·생성 시각을 버렸다(이미지 탭 모델명 소실).
 * CSV 가 쓰는 필드(프롬프트·자막·시간)와 옛 형식 별칭(start_time/end_time)은 목록에 없어야 한다 — 실으면 CSV 값을 가린다.
 */
import { describe, it, expect } from 'vitest'
import { CSV_PRESERVED_SCENE_FIELDS, pickPreservedSceneFields } from '../../src/utils/csvPreservedSceneFields'
import { VIDEO_SCENE_FIELD_MAP } from '../../src/hooks/useVideoScenes'

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

  // 리뷰 R2: 제출 상태(status·generationId)만 남기고 같이 읽히는 오류·게이트 필드를 버리면, 배치 시작의 분류가 재적용 전후로 바뀐다
  //   (옛 서버측 실패 → in-flight 로 오분류 → 폴링). 영상 탭이 파생하는 필드는 프롬프트만 빼고 **전부** 보존한다 — 구조로 묶는다.
  it('영상 탭이 파생하는 videoT2V* 필드는 프롬프트(CSV 가 씀)만 빼고 전부 보존한다', () => {
    const targets = Object.values(VIDEO_SCENE_FIELD_MAP).filter((f) => f !== 'videoT2VPrompt')
    expect(targets.length).toBeGreaterThan(15)
    for (const f of targets) expect(CSV_PRESERVED_SCENE_FIELDS).toContain(f)
  })

  it('스토리 연결(storyId)을 보존한다 — 버리면 다음 스토리 반영이 같은 씬을 새로 만든다', () => {
    expect(CSV_PRESERVED_SCENE_FIELDS).toContain('storyId')
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
