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

  // ─── 빈 입력 가드 ──
  // max-driver 모델: 빈 입력은 해당 필드를 전체 씬에서 클리어.
  // 씬 자체 삭제는 하지 않는다. trailing 완전 빈 씬 정리는 useScenes 의 trimTrailingEmptyScenes 에서 처리.
  it('빈 text + fieldName=prompt → 모든 씬의 prompt 클리어, 씬 자체는 보존', () => {
    const existing = [
      { id: 'scene_1', prompt: 'p1', subtitle: 's1', duration: 4 },
      { id: 'scene_2', prompt: 'p2', subtitle: 's2', duration: 5 },
    ]
    const result1 = mergeTextIntoScenes(existing, '', 3)
    expect(result1).toHaveLength(2) // 씬 보존
    expect(result1[0].prompt).toBe('')
    expect(result1[0].subtitle).toBe('s1') // 다른 필드 보존
    expect(result1[1].prompt).toBe('')

    const result2 = mergeTextIntoScenes(existing, '   \n  ', 3) // whitespace only
    expect(result2).toHaveLength(2)
    expect(result2[0].prompt).toBe('')
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

  // ─── truncateToIncoming (PromptInput 직접 편집) ──
  // max-driver 모델: 모든 fieldName 에 max-preserve 시맨틱.
  // prompt 탭에서 줄을 지워도 씬 자체는 보존되고 해당 prompt 만 클리어.
  // trailing 완전 빈 씬 정리는 useScenes 의 trimTrailingEmptyScenes 에서 처리.
  it('truncateToIncoming + fieldName=prompt: 3줄 → 2줄로 줄이면 scenes 유지 + 3번째 prompt 클리어', () => {
    const existing = [
      { id: 'scene_1', prompt: 'p1', subtitle: 's1', duration: 4 },
      { id: 'scene_2', prompt: 'p2', subtitle: 's2', duration: 5 },
      { id: 'scene_3', prompt: 'p3', subtitle: 's3', duration: 6 },
    ]
    const result = mergeTextIntoScenes(existing, 'NEW1\nNEW2', 3, { truncateToIncoming: true })
    // max-preserve: max(3, 2) = 3 — 씬 보존, 범위 밖 prompt 만 클리어
    expect(result).toHaveLength(3)
    expect(result[0].prompt).toBe('NEW1')
    expect(result[0].subtitle).toBe('s1') // 다른 필드 보존
    expect(result[0].duration).toBe(4)
    expect(result[1].prompt).toBe('NEW2')
    expect(result[1].subtitle).toBe('s2')
    // 3번째 씬: prompt 클리어, subtitle/duration 등 다른 데이터 보존
    expect(result[2].prompt).toBe('')
    expect(result[2].subtitle).toBe('s3')
    expect(result[2].duration).toBe(6)
  })

  it('truncateToIncoming + fieldName=prompt: 2줄 → 3줄로 늘리면 scenes 3개', () => {
    const existing = [
      { id: 'scene_1', prompt: 'p1', subtitle: 's1' },
      { id: 'scene_2', prompt: 'p2', subtitle: 's2' },
    ]
    const result = mergeTextIntoScenes(existing, 'A\nB\nC', 3, { truncateToIncoming: true })
    expect(result).toHaveLength(3)
    expect(result[0].subtitle).toBe('s1') // 기존 보존
    expect(result[1].subtitle).toBe('s2')
    expect(result[2].subtitle).toBe('') // 새 씬
    expect(result.map(s => s.prompt)).toEqual(['A', 'B', 'C'])
  })

  it('truncateToIncoming + fieldName=videoT2VPrompt: 3줄 → 2줄로 줄이면 scenes 유지 + 3번째 비디오 prompt 클리어', () => {
    const existing = [
      { id: 'scene_1', prompt: 'img1', videoT2VPrompt: 'v1', subtitle: 's1' },
      { id: 'scene_2', prompt: 'img2', videoT2VPrompt: 'v2', subtitle: 's2' },
      { id: 'scene_3', prompt: 'img3', videoT2VPrompt: 'v3', subtitle: 's3' },
    ]
    const result = mergeTextIntoScenes(existing, 'NEW-V1\nNEW-V2', 3, {
      fieldName: 'videoT2VPrompt', truncateToIncoming: true,
    })
    expect(result).toHaveLength(3) // scenes 자체는 보존
    expect(result[0].videoT2VPrompt).toBe('NEW-V1')
    expect(result[1].videoT2VPrompt).toBe('NEW-V2')
    expect(result[2].videoT2VPrompt).toBe('') // 입력 범위 밖 — 클리어
    // 이미지 prompt / subtitle 등 보존
    expect(result[0].prompt).toBe('img1')
    expect(result[2].prompt).toBe('img3')
  })

  it('truncateToIncoming + fieldName=videoT2VPrompt: 2줄 → 4줄로 늘리면 scenes 도 4개로 늘어남', () => {
    const existing = [
      { id: 'scene_1', prompt: 'img1', videoT2VPrompt: 'v1' },
      { id: 'scene_2', prompt: 'img2', videoT2VPrompt: 'v2' },
    ]
    const result = mergeTextIntoScenes(existing, 'A\nB\nC\nD', 3, {
      fieldName: 'videoT2VPrompt', truncateToIncoming: true,
    })
    expect(result).toHaveLength(4)
    expect(result[2].videoT2VPrompt).toBe('C')
    expect(result[3].videoT2VPrompt).toBe('D')
    expect(result[2].prompt).toBe('') // 새 씬 — 이미지 prompt 빈 칸
  })

  // ─── truncate 새 씬 시간이 누적되는지 (P1: 0~defaultDuration 으로 박힘 회귀 방지) ──
  it('truncate + fieldName=prompt 새 씬 시간이 누적 (cursor 보존)', () => {
    const existing = [
      { id: 'scene_1', prompt: 'p1', startTime: 0, endTime: 5, duration: 5 },
      { id: 'scene_2', prompt: 'p2', startTime: 5, endTime: 8, duration: 3 },
    ]
    const result = mergeTextIntoScenes(existing, 'p1\np2\nNEW3\nNEW4', 3, { truncateToIncoming: true })
    expect(result).toHaveLength(4)
    // 기존 시간 보존
    expect(result[0].endTime).toBe(5)
    expect(result[1].startTime).toBe(5)
    expect(result[1].endTime).toBe(8)
    // 새 씬: 누적 (마지막 기존 endTime 부터)
    expect(result[2].startTime).toBe(8)
    expect(result[2].endTime).toBe(11) // 8 + 3
    expect(result[3].startTime).toBe(11)
    expect(result[3].endTime).toBe(14)
  })

  it('truncate + fieldName=videoT2VPrompt 새 씬 시간도 누적', () => {
    const existing = [
      { id: 'scene_1', prompt: 'p1', videoT2VPrompt: 'v1', startTime: 0, endTime: 4, duration: 4 },
    ]
    const result = mergeTextIntoScenes(existing, 'A\nB\nC', 3, {
      fieldName: 'videoT2VPrompt', truncateToIncoming: true,
    })
    expect(result).toHaveLength(3)
    expect(result[0].endTime).toBe(4)
    expect(result[1].startTime).toBe(4) // 누적
    expect(result[1].endTime).toBe(7)
    expect(result[2].startTime).toBe(7)
    expect(result[2].endTime).toBe(10)
  })

  it('truncate + fieldName=prompt 빈 scenes 에서 시작해도 누적', () => {
    const result = mergeTextIntoScenes([], 'A\nB\nC', 4, { truncateToIncoming: true })
    expect(result).toHaveLength(3)
    expect(result[0].startTime).toBe(0)
    expect(result[0].endTime).toBe(4)
    expect(result[1].startTime).toBe(4)
    expect(result[1].endTime).toBe(8)
    expect(result[2].startTime).toBe(8)
    expect(result[2].endTime).toBe(12)
  })

  // ─── truncate 모드에서 빈 줄 보존 (갭 있는 비디오 prompt 회귀 방지) ──
  it('truncate + 빈 줄 입력 → 그 위치 fieldName 비움 (갭 보존)', () => {
    const existing = [
      { id: 'scene_1', prompt: 'img1', videoT2VPrompt: 'A' },
      { id: 'scene_2', prompt: 'img2', videoT2VPrompt: '' },
      { id: 'scene_3', prompt: 'img3', videoT2VPrompt: 'C' },
    ]
    // 사용자가 입력창에서 'A\n\nC' (가운데 빈 줄) 그대로 — 의도: scene_2 비디오 prompt 비워둠
    const result = mergeTextIntoScenes(existing, 'A\n\nC', 3, {
      fieldName: 'videoT2VPrompt', truncateToIncoming: true,
    })
    expect(result).toHaveLength(3)
    expect(result[0].videoT2VPrompt).toBe('A')
    expect(result[1].videoT2VPrompt).toBe('') // 빈 줄 → 비움 (압축으로 'C' 가 당겨오면 안 됨)
    expect(result[2].videoT2VPrompt).toBe('C') // 자리 보존
    // 이미지 prompt 다 보존
    expect(result[0].prompt).toBe('img1')
    expect(result[1].prompt).toBe('img2')
    expect(result[2].prompt).toBe('img3')
  })

  it('truncate + trailing 빈 줄은 무시 (사용자가 마지막에 \\n 추가 시 새 씬 만들지 않음)', () => {
    const existing = [
      { id: 'scene_1', prompt: 'p1' },
      { id: 'scene_2', prompt: 'p2' },
    ]
    const result = mergeTextIntoScenes(existing, 'A\nB\n\n', 3, { truncateToIncoming: true })
    expect(result).toHaveLength(2) // trailing 빈 줄 제거 → 2줄
    expect(result[0].prompt).toBe('A')
    expect(result[1].prompt).toBe('B')
  })

  it('truncate + fieldName=prompt: 중간 빈 줄도 그 위치 prompt 비움', () => {
    const existing = [
      { id: 'scene_1', prompt: 'p1' },
      { id: 'scene_2', prompt: 'p2' },
      { id: 'scene_3', prompt: 'p3' },
    ]
    const result = mergeTextIntoScenes(existing, 'A\n\nC', 3, { truncateToIncoming: true })
    expect(result).toHaveLength(3) // 빈 줄도 위치 차지
    expect(result[0].prompt).toBe('A')
    expect(result[1].prompt).toBe('') // 빈 줄 → 비움
    expect(result[2].prompt).toBe('C')
  })

  it('non-truncate (import) 는 빈 줄 무시 (기존 동작 유지)', () => {
    const result = mergeTextIntoScenes([], 'A\n\nC', 3)
    expect(result).toHaveLength(2) // import 는 빈 줄 filter
    expect(result.map(s => s.prompt)).toEqual(['A', 'C'])
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

  it('SRT가 더 짧으면: 초과 위치의 subtitle 만 CLEAR, 다른 컬럼은 보존 (max-driver: SRT N = 현재 컬럼 길이)', () => {
    const existing = [
      { id: 'scene_1', prompt: 'p1', subtitle: '', duration: 3 },
      { id: 'scene_2', prompt: 'p2', subtitle: '', duration: 3 },
      { id: 'scene_3', prompt: 'p3', subtitle: 's3', duration: 5, image: 'img3' },
    ]
    const result = mergeSRTIntoScenes(existing, SAMPLE_SRT) // SRT 2개
    expect(result).toHaveLength(3) // max(3, 2) — scene 자체는 prompt/image 가 살림
    // 0, 1 은 SRT subtitle/duration 갱신, prompt 보존
    expect(result[0].subtitle).toBe('첫 번째 자막')
    expect(result[0].prompt).toBe('p1')
    expect(result[1].subtitle).toBe('두 번째 자막')
    expect(result[1].prompt).toBe('p2')
    // 2 는 SRT 범위 밖 → subtitle CLEAR, prompt/image 보존
    expect(result[2].subtitle).toBe('')   // 옛 's3' 사라짐
    expect(result[2].prompt).toBe('p3')
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
