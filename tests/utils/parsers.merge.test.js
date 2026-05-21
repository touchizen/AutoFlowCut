/**
 * parsers.js — 머지 파서 테스트
 * mergeTextIntoScenes / mergeSRTIntoScenes / mergeCSVIntoScenes
 */
import { describe, it, expect } from 'vitest'
import {
  mergeTextIntoScenes,
  mergeSRTIntoScenes,
  mergeCSVIntoScenes,
} from '../../src/utils/parsers'

// ============================================================
// mergeTextIntoScenes
// ============================================================

describe('mergeTextIntoScenes', () => {
  it('빈 scenes에서 호출하면 통째 생성과 동일', () => {
    const result = mergeTextIntoScenes([], 'A\nB\nC', 3)
    expect(result).toHaveLength(3)
    expect(result.map(s => s.prompt)).toEqual(['A', 'B', 'C'])
    expect(result[0].duration).toBe(3)
    expect(result[0].subtitle).toBe('')
  })

  it('같은 길이일 때: prompt만 갱신, subtitle/duration 보존', () => {
    const existing = [
      { id: 'scene_1', prompt: '자막1', subtitle: '자막1', duration: 6.5, image: 'img1' },
      { id: 'scene_2', prompt: '자막2', subtitle: '자막2', duration: 2.7, image: 'img2' },
    ]
    const result = mergeTextIntoScenes(existing, 'NEW_A\nNEW_B', 3)
    expect(result).toHaveLength(2)
    expect(result[0].prompt).toBe('NEW_A')
    expect(result[0].subtitle).toBe('자막1')
    expect(result[0].duration).toBe(6.5)
    expect(result[0].image).toBe('img1')
    expect(result[1].prompt).toBe('NEW_B')
    expect(result[1].subtitle).toBe('자막2')
    expect(result[1].duration).toBe(2.7)
  })

  it('입력이 더 길면: 부족분 새 씬 추가', () => {
    const existing = [{ id: 'scene_1', prompt: 'old', subtitle: '자막', duration: 5 }]
    const result = mergeTextIntoScenes(existing, 'A\nB\nC', 3)
    expect(result).toHaveLength(3)
    expect(result[0].prompt).toBe('A')
    expect(result[0].subtitle).toBe('자막') // 보존
    expect(result[0].duration).toBe(5) // 보존
    expect(result[1].prompt).toBe('B')
    expect(result[1].subtitle).toBe('') // 새 씬
    expect(result[1].duration).toBe(3)
  })

  it('입력이 더 짧으면: 초과 씬 *보존* (max 길이 정책)', () => {
    const existing = [
      { id: 'scene_1', prompt: 'a', subtitle: 'sa', duration: 5 },
      { id: 'scene_2', prompt: 'b', subtitle: 'sb', duration: 5 },
      { id: 'scene_3', prompt: 'c', subtitle: 'sc', duration: 5 },
    ]
    const result = mergeTextIntoScenes(existing, 'X\nY', 3)
    expect(result).toHaveLength(3) // max(3, 2) = 3
    expect(result[0].prompt).toBe('X')
    expect(result[0].subtitle).toBe('sa') // 보존
    expect(result[1].prompt).toBe('Y')
    expect(result[1].subtitle).toBe('sb') // 보존
    // 3번째 씬은 incoming에 없으므로 통째 보존 (prompt 도 'c' 그대로)
    expect(result[2].prompt).toBe('c')
    expect(result[2].subtitle).toBe('sc')
  })

  it('빈 줄 무시', () => {
    const result = mergeTextIntoScenes([], 'A\n\n  \nB', 3)
    expect(result).toHaveLength(2)
    expect(result.map(s => s.prompt)).toEqual(['A', 'B'])
  })

  it('fieldName=videoT2VPrompt: videoT2VPrompt만 갱신, prompt 보존', () => {
    const existing = [
      { id: 'scene_1', prompt: '이미지 프롬프트', videoT2VPrompt: '', subtitle: '자막', duration: 5 },
    ]
    const result = mergeTextIntoScenes(existing, '비디오 프롬프트', 3, { fieldName: 'videoT2VPrompt' })
    expect(result[0].videoT2VPrompt).toBe('비디오 프롬프트')
    expect(result[0].prompt).toBe('이미지 프롬프트') // 보존
    expect(result[0].subtitle).toBe('자막') // 보존
  })

  it('fieldName=videoT2VPrompt: 빈 scenes에서 호출 시 비디오 prompt만 채우고 image prompt는 빈 칸', () => {
    const result = mergeTextIntoScenes([], 'V1\nV2', 3, { fieldName: 'videoT2VPrompt' })
    expect(result).toHaveLength(2)
    expect(result[0].videoT2VPrompt).toBe('V1')
    expect(result[0].prompt).toBe('') // 이미지 prompt는 빈 칸
    expect(result[1].videoT2VPrompt).toBe('V2')
    expect(result[1].prompt).toBe('')
  })

  it('fieldName=videoI2VPrompt: I2V prompt 만 갱신, image / T2V prompt 보존', () => {
    const existing = [
      { id: 'scene_1', prompt: '이미지', videoT2VPrompt: 'T2V', videoI2VPrompt: '', subtitle: 's', duration: 4 },
    ]
    const result = mergeTextIntoScenes(existing, 'I2V-NEW', 3, { fieldName: 'videoI2VPrompt' })
    expect(result[0].videoI2VPrompt).toBe('I2V-NEW')
    expect(result[0].prompt).toBe('이미지') // 보존
    expect(result[0].videoT2VPrompt).toBe('T2V') // 보존
    expect(result[0].subtitle).toBe('s') // 보존
    expect(result[0].duration).toBe(4) // 보존
  })

  it('fieldName=videoI2VPrompt: 빈 scenes에서 호출 시 videoI2VPrompt 만 채움', () => {
    const result = mergeTextIntoScenes([], 'I1\nI2', 3, { fieldName: 'videoI2VPrompt' })
    expect(result).toHaveLength(2)
    expect(result[0].videoI2VPrompt).toBe('I1')
    expect(result[0].prompt).toBe('')
    expect(result[0].videoT2VPrompt).toBe('')
  })

  // ─── 빈 입력 가드 (PromptInput 통째 삭제 회귀 방지) ──
  it('빈 text + fieldName=prompt → scenes 통째 삭제 (이미지 워크플로우 리셋)', () => {
    const existing = [
      { id: 'scene_1', prompt: 'p1', subtitle: 's1', duration: 4 },
      { id: 'scene_2', prompt: 'p2', subtitle: 's2', duration: 5 },
    ]
    expect(mergeTextIntoScenes(existing, '', 3)).toEqual([])
    expect(mergeTextIntoScenes(existing, '   \n  ', 3)).toEqual([]) // whitespace only
  })

  it('빈 text + fieldName=videoT2VPrompt → scenes 보존, videoT2VPrompt 만 클리어', () => {
    const existing = [
      { id: 'scene_1', prompt: 'image1', videoT2VPrompt: 'v1', subtitle: 's1', duration: 4 },
      { id: 'scene_2', prompt: 'image2', videoT2VPrompt: 'v2', subtitle: 's2' },
    ]
    const result = mergeTextIntoScenes(existing, '', 3, { fieldName: 'videoT2VPrompt' })
    expect(result).toHaveLength(2) // scenes 보존
    expect(result[0].prompt).toBe('image1') // 이미지 prompt 보존
    expect(result[0].subtitle).toBe('s1') // 자막 보존
    expect(result[0].videoT2VPrompt).toBe('') // 비디오 만 클리어
    expect(result[1].videoT2VPrompt).toBe('')
  })

  it('빈 text + fieldName=videoI2VPrompt → scenes 보존, videoI2VPrompt 만 클리어', () => {
    const existing = [
      { id: 'scene_1', prompt: 'p', videoI2VPrompt: 'i', duration: 3 },
    ]
    const result = mergeTextIntoScenes(existing, '', 3, { fieldName: 'videoI2VPrompt' })
    expect(result).toHaveLength(1)
    expect(result[0].prompt).toBe('p')
    expect(result[0].videoI2VPrompt).toBe('')
  })
})

// ============================================================
// mergeSRTIntoScenes
// ============================================================

const SAMPLE_SRT = `1
00:00:00,000 --> 00:00:04,157
첫 번째 자막

2
00:00:04,157 --> 00:00:06,501
두 번째 자막`

describe('mergeSRTIntoScenes', () => {
  it('빈 scenes에서 호출하면 통째 생성, prompt는 비워둠 (자막 전용 정책)', () => {
    const result = mergeSRTIntoScenes([], SAMPLE_SRT)
    expect(result).toHaveLength(2)
    expect(result[0].subtitle).toBe('첫 번째 자막')
    expect(result[0].prompt).toBe('') // SRT는 prompt에 자막 복사하지 않음
    expect(result[0].startTime).toBe(0)
    expect(result[0].endTime).toBeCloseTo(4.157, 3)
    expect(result[0].duration).toBeCloseTo(4.157, 3)
  })

  it('같은 길이일 때: subtitle/duration/시간 갱신, 기존 prompt 보존', () => {
    const existing = [
      { id: 'scene_1', prompt: '이미지 프롬프트 1', subtitle: '', duration: 3 },
      { id: 'scene_2', prompt: '이미지 프롬프트 2', subtitle: '', duration: 3 },
    ]
    const result = mergeSRTIntoScenes(existing, SAMPLE_SRT)
    expect(result).toHaveLength(2)
    expect(result[0].subtitle).toBe('첫 번째 자막')
    expect(result[0].prompt).toBe('이미지 프롬프트 1') // 보존
    expect(result[0].duration).toBeCloseTo(4.157, 3)
    expect(result[1].subtitle).toBe('두 번째 자막')
    expect(result[1].prompt).toBe('이미지 프롬프트 2') // 보존
  })

  it('기존 prompt가 빈 칸이면 그대로 둠 (자막 복사 X — 책임 분리)', () => {
    const existing = [{ id: 'scene_1', prompt: '', subtitle: '', duration: 3 }]
    const result = mergeSRTIntoScenes(existing, SAMPLE_SRT)
    expect(result[0].prompt).toBe('') // 빈 prompt 유지
    expect(result[0].subtitle).toBe('첫 번째 자막') // 자막만 갱신
  })

  it('SRT가 더 길면: 새 씬 추가 (새 씬도 prompt 빈 칸)', () => {
    const existing = [{ id: 'scene_1', prompt: 'old', subtitle: '', duration: 3, image: 'i' }]
    const result = mergeSRTIntoScenes(existing, SAMPLE_SRT)
    expect(result).toHaveLength(2)
    expect(result[0].prompt).toBe('old')
    expect(result[0].image).toBe('i')
    expect(result[1].prompt).toBe('') // 새 씬도 prompt 빈 칸
    expect(result[1].subtitle).toBe('두 번째 자막') // 자막만
  })

  it('SRT가 더 짧으면: 초과 scenes 통째 보존 (max 길이 정책)', () => {
    const existing = [
      { id: 'scene_1', prompt: 'p1', subtitle: '', duration: 3 },
      { id: 'scene_2', prompt: 'p2', subtitle: '', duration: 3 },
      { id: 'scene_3', prompt: 'p3', subtitle: 's3', duration: 5, image: 'img3' },
    ]
    const result = mergeSRTIntoScenes(existing, SAMPLE_SRT) // SRT 2개
    expect(result).toHaveLength(3) // max(3, 2)
    // 0, 1 은 SRT subtitle/duration 갱신, prompt 보존
    expect(result[0].subtitle).toBe('첫 번째 자막')
    expect(result[0].prompt).toBe('p1')
    expect(result[1].subtitle).toBe('두 번째 자막')
    expect(result[1].prompt).toBe('p2')
    // 2 는 SRT 없음 → 통째 보존
    expect(result[2].prompt).toBe('p3')
    expect(result[2].subtitle).toBe('s3')
    expect(result[2].image).toBe('img3')
  })

  it('ep02 시연 시나리오: SRT(8) → prompts.txt(6) → 8씬 유지, 뒤 2는 SRT 데이터만', () => {
    // SRT 8라인 가져오기 후 .txt 6라인 (이미지 prompt) 가져옴
    const eightSRT = Array.from({ length: 8 }, (_, i) => {
      const start = `00:00:${String(i * 4).padStart(2, '0')},000`
      const end = `00:00:${String((i + 1) * 4).padStart(2, '0')},000`
      return `${i + 1}\n${start} --> ${end}\n자막 ${i + 1}`
    }).join('\n\n')

    let scenes = mergeSRTIntoScenes([], eightSRT)
    expect(scenes).toHaveLength(8)

    // .txt 6 라인으로 머지 (이미지 prompt, fieldName 기본 'prompt')
    const sixPrompts = Array.from({ length: 6 }, (_, i) => `이미지 ${i + 1}`).join('\n')
    scenes = mergeTextIntoScenes(scenes, sixPrompts, 3)

    expect(scenes).toHaveLength(8) // 8 유지 (max 길이)
    expect(scenes[0].prompt).toBe('이미지 1')
    expect(scenes[0].subtitle).toBe('자막 1')
    expect(scenes[5].prompt).toBe('이미지 6')
    expect(scenes[5].subtitle).toBe('자막 6')
    // 6, 7 번 — image prompt 없음, subtitle 만
    expect(scenes[6].prompt).toBe('')
    expect(scenes[6].subtitle).toBe('자막 7')
    expect(scenes[7].prompt).toBe('')
    expect(scenes[7].subtitle).toBe('자막 8')
  })
})

// ============================================================
// mergeCSVIntoScenes
// ============================================================

describe('mergeCSVIntoScenes', () => {
  it('빈 scenes에서 호출하면 통째 생성', () => {
    const csv = 'prompt,subtitle\nA,sa\nB,sb'
    const result = mergeCSVIntoScenes([], csv, 3)
    expect(result).toHaveLength(2)
    expect(result[0].prompt).toBe('A')
    expect(result[0].subtitle).toBe('sa')
  })

  it('CSV가 prompt만 주면: subtitle/duration 보존', () => {
    const existing = [
      { id: 'scene_1', prompt: 'old_a', subtitle: '자막A', duration: 5 },
      { id: 'scene_2', prompt: 'old_b', subtitle: '자막B', duration: 5 },
    ]
    const csv = 'prompt\nNEW_A\nNEW_B'
    const result = mergeCSVIntoScenes(existing, csv, 3)
    expect(result[0].prompt).toBe('NEW_A')
    expect(result[0].subtitle).toBe('자막A') // 보존
    expect(result[0].duration).toBe(5) // 보존
    expect(result[1].prompt).toBe('NEW_B')
    expect(result[1].subtitle).toBe('자막B') // 보존
  })

  it('CSV가 subtitle만 주면 (prompt 컬럼 없음): prompt 보존', () => {
    // parseCSVToScenes는 prompt 컬럼 없으면 row.prompt=''로 → 머지 시 빈문자열은 무시
    const existing = [{ id: 'scene_1', prompt: '이미지 프롬프트', subtitle: '', duration: 3 }]
    const csv = 'prompt,subtitle\n,새자막'
    const result = mergeCSVIntoScenes(existing, csv, 3)
    expect(result[0].prompt).toBe('이미지 프롬프트') // 빈 prompt는 무시, 보존
    expect(result[0].subtitle).toBe('새자막')
  })

  it('CSV에 duration 컬럼 있으면 갱신', () => {
    const existing = [{ id: 'scene_1', prompt: 'a', subtitle: 's', duration: 3 }]
    const csv = 'prompt,duration\nA,7.5'
    const result = mergeCSVIntoScenes(existing, csv, 3)
    expect(result[0].duration).toBe(7.5)
    expect(result[0].subtitle).toBe('s') // 보존
  })

  // ─── P1 회귀: video prompt 컬럼 인식 ────────────────────
  it('video_t2v_prompt 컬럼이 videoT2VPrompt 로 라우팅됨', () => {
    const csv = 'video_t2v_prompt\nT2V-A\nT2V-B'
    const result = mergeCSVIntoScenes([], csv, 3)
    expect(result).toHaveLength(2)
    expect(result[0].videoT2VPrompt).toBe('T2V-A')
    expect(result[1].videoT2VPrompt).toBe('T2V-B')
    expect(result[0].prompt).toBe('') // image prompt 안 채움
  })

  it('video_prompt 별칭도 videoT2VPrompt 로 인식', () => {
    const csv = 'video_prompt\nALT-A'
    const result = mergeCSVIntoScenes([], csv, 3)
    expect(result[0].videoT2VPrompt).toBe('ALT-A')
  })

  it('video_i2v_prompt 컬럼이 videoI2VPrompt 로 라우팅됨', () => {
    const csv = 'video_i2v_prompt\nI2V-A'
    const result = mergeCSVIntoScenes([], csv, 3)
    expect(result[0].videoI2VPrompt).toBe('I2V-A')
  })

  it('CSV 비디오 컬럼 머지: 기존 image prompt 보존', () => {
    const existing = [
      { id: 'scene_1', prompt: '이미지 그대로', subtitle: '자막', duration: 5 },
    ]
    const csv = 'video_t2v_prompt\n비디오 새로'
    const result = mergeCSVIntoScenes(existing, csv, 3)
    expect(result[0].prompt).toBe('이미지 그대로') // 보존
    expect(result[0].subtitle).toBe('자막') // 보존
    expect(result[0].duration).toBe(5) // 보존
    expect(result[0].videoT2VPrompt).toBe('비디오 새로')
  })
})
