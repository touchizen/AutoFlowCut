import { describe, expect, it, vi } from 'vitest'
import {
  MAX_GROUP_CHARS,
  MAX_GROUP_LINES,
  groupSrtLines,
  groupsToScenes,
  resolveSceneText,
  toPromptSceneDTO,
  validateGroupPartition,
  validatePromptScenesExactOnce,
  writeScenePrompts,
} from '../../../../electron/api/llm/srtPrompts.js'
import { checkTagMatch } from '../../../../src/utils/tagMatch.js'

describe('SRT prompt DTO mapping', () => {
  const srtTrack = [
    { id: 'sub_1', startTime: 1, endTime: 2, text: '첫 줄' },
    { id: 'sub_2', startTime: 4, endTime: 5, text: '둘째 줄' },
  ]

  it('srtLineIds 순서로 연결된 SRT 텍스트를 줄바꿈 결합한다', () => {
    expect(resolveSceneText({ srtLineIds: ['sub_2', 'sub_1'], subtitle: 'fallback' }, srtTrack))
      .toBe('둘째 줄\n첫 줄')
  })

  it('연결된 SRT 텍스트가 없으면 subtitle로 폴백한다', () => {
    expect(resolveSceneText({ srtLineIds: ['missing'], subtitle: '  대체 자막  ' }, srtTrack))
      .toBe('대체 자막')
  })

  it('SRT와 subtitle이 모두 비면 null로 skip한다', () => {
    expect(toPromptSceneDTO({ sceneNo: 3, srtLineIds: ['missing'], subtitle: '   ' }, srtTrack))
      .toBeNull()
  })

  it('DTO는 sceneNo/summary/text만 포함하고 prompt/media/timing 키를 내보내지 않는다', () => {
    const scene = {
      sceneNo: 2,
      summary: '그룹 요약',
      srtLineIds: ['sub_1'],
      imagePrompt: 'OLD IMAGE',
      videoPrompt: 'OLD VIDEO',
      prompt: 'OLD APP PROMPT',
      videoT2VPrompt: 'OLD T2V',
      image: { base64: 'secret' },
      startTime: 1,
      endTime: 2,
      duration: 1,
    }

    const dto = toPromptSceneDTO(scene, srtTrack)

    expect(dto).toEqual({ sceneNo: 2, summary: '그룹 요약', text: '첫 줄' })
    expect(Object.keys(dto)).toEqual(['sceneNo', 'summary', 'text'])
    expect(dto).not.toHaveProperty('imagePrompt')
    expect(dto).not.toHaveProperty('videoPrompt')
    expect(dto).not.toHaveProperty('startTime')
    expect(dto).not.toHaveProperty('image')
  })

  it('summary가 없으면 빈 문자열을 사용한다', () => {
    expect(toPromptSceneDTO({ sceneNo: 1, subtitle: '본문' }, []))
      .toEqual({ sceneNo: 1, summary: '', text: '본문' })
  })
})

describe('SRT group partition and scene factory', () => {
  const validGroups = [
    { fromLine: 1, toLine: 2, summary: '도입' },
    { fromLine: 3, toLine: 3, summary: '결말' },
  ]

  it('1..N을 정확히 한 번 연속 커버하는 파티션만 허용한다', () => {
    expect(validateGroupPartition(validGroups, 3)).toBe(true)

    expect(() => validateGroupPartition([
      { fromLine: 1, toLine: 1, summary: 'a' },
      { fromLine: 3, toLine: 3, summary: 'b' },
    ], 3)).toThrow(/partition/i)
    expect(() => validateGroupPartition([
      { fromLine: 1, toLine: 2, summary: 'a' },
      { fromLine: 2, toLine: 3, summary: 'b' },
    ], 3)).toThrow(/partition/i)
    expect(() => validateGroupPartition([
      { fromLine: 2, toLine: 1, summary: 'a' },
      { fromLine: 2, toLine: 3, summary: 'b' },
    ], 3)).toThrow(/partition/i)
    expect(() => validateGroupPartition([
      { fromLine: 1, toLine: 3, summary: '   ' },
    ], 3)).toThrow(/summary/i)
  })

  it('gap을 재배치하지 않고 captured SRT의 절대 시작/끝 시간을 보존한다', () => {
    const srtTrack = [
      { id: 'sub_1', startTime: 10, endTime: 11.5, text: '첫 줄' },
      { id: 'sub_2', startTime: 15, endTime: 17, text: '둘째 줄' },
      { id: 'sub_3', startTime: 30, endTime: 31, text: '셋째 줄' },
    ]
    let id = 0

    const scenes = groupsToScenes(validGroups, srtTrack, {
      allocateSceneId: (...args) => {
        expect(args).toEqual([])
        return `allocated_${++id}`
      },
    })

    expect(scenes).toEqual([
      {
        id: 'allocated_1',
        startTime: 10,
        endTime: 17,
        duration: 7,
        prompt: '',
        videoT2VPrompt: '',
        videoI2VPrompt: '',
        subtitle: '첫 줄\n둘째 줄',
        characters: '',
        scene_tag: '',
        style_tag: '',
        status: 'pending',
        image: null,
        srtLineIds: ['sub_1', 'sub_2'],
      },
      {
        id: 'allocated_2',
        startTime: 30,
        endTime: 31,
        duration: 1,
        prompt: '',
        videoT2VPrompt: '',
        videoI2VPrompt: '',
        subtitle: '셋째 줄',
        characters: '',
        scene_tag: '',
        style_tag: '',
        status: 'pending',
        image: null,
        srtLineIds: ['sub_3'],
      },
    ])
    expect(scenes[0].startTime).toBe(10)
    expect(scenes[0].endTime).toBe(17)
  })

  it("factory의 characters:''는 checkTagMatch에서 예외를 내지 않는다", () => {
    const scenes = groupsToScenes(
      [{ fromLine: 1, toLine: 1, summary: '한 씬' }],
      [{ id: 'sub_1', startTime: 2, endTime: 3, text: '본문' }],
    )

    expect(scenes[0].characters).toBe('')
    expect(() => checkTagMatch(scenes[0].characters, [], 'character')).not.toThrow()
    expect(() => checkTagMatch(scenes[0].scene_tag, [], 'scene')).not.toThrow()
    expect(() => checkTagMatch(scenes[0].style_tag, [], 'style')).not.toThrow()
  })

  it('각 SRT 라인과 파생 scene의 타이밍이 finite이고 end >= start여야 한다', () => {
    expect(() => groupsToScenes(
      [{ fromLine: 1, toLine: 1, summary: 'bad' }],
      [{ id: 'sub_1', startTime: Number.NaN, endTime: 3, text: '본문' }],
    )).toThrow(/timing/i)
    expect(() => groupsToScenes(
      [{ fromLine: 1, toLine: 1, summary: 'bad' }],
      [{ id: 'sub_1', startTime: 2, endTime: Number.POSITIVE_INFINITY, text: '본문' }],
    )).toThrow(/timing/i)
    expect(() => groupsToScenes(
      [{ fromLine: 1, toLine: 1, summary: 'bad' }],
      [{ id: 'sub_1', startTime: 4, endTime: 3, text: '본문' }],
    )).toThrow(/timing/i)
    expect(() => groupsToScenes(
      [{ fromLine: 1, toLine: 2, summary: 'bad derived range' }],
      [
        { id: 'sub_1', startTime: 10, endTime: 11, text: '첫 줄' },
        { id: 'sub_2', startTime: 8, endTime: 9, text: '둘째 줄' },
      ],
    )).toThrow(/timing/i)
  })

  it('그룹 envelope가 유효해도 내부 SRT 라인의 endTime < startTime을 거부한다', () => {
    expect(() => groupsToScenes(
      [{ fromLine: 1, toLine: 2, summary: '내부 라인 역전' }],
      [
        { id: 'sub_1', startTime: 0, endTime: 5, text: 'a' },
        { id: 'sub_2', startTime: 10, endTime: 8, text: 'b' },
      ],
    )).toThrow(/SRT line timing/i)
  })
})

describe('validatePromptScenesExactOnce', () => {
  const prompt = (sceneNo, imagePrompt = 'image', videoPrompt = 'video') => ({
    sceneNo,
    imagePrompt,
    videoPrompt,
  })

  it('순서와 무관하게 정확히 같은 sceneNo 집합을 한 번씩 반환하면 통과한다', () => {
    expect(validatePromptScenesExactOnce([1, 2], [prompt(2), prompt(1)])).toBe(true)
  })

  it('입력 sceneNo는 positive integer인 non-empty unique 집합이어야 한다', () => {
    expect(() => validatePromptScenesExactOnce([], [])).toThrow(/input/i)
    expect(() => validatePromptScenesExactOnce([1, 1], [prompt(1), prompt(1)])).toThrow(/input/i)
    expect(() => validatePromptScenesExactOnce([0], [prompt(0)])).toThrow(/input/i)
    expect(() => validatePromptScenesExactOnce([1.5], [prompt(1.5)])).toThrow(/input/i)
  })

  it('응답은 array이고 length가 입력 N과 같아야 한다', () => {
    expect(() => validatePromptScenesExactOnce([1], null)).toThrow(/response/i)
    expect(() => validatePromptScenesExactOnce([1, 2], [prompt(1)])).toThrow(/scene 2|length/i)
    expect(() => validatePromptScenesExactOnce([1], [prompt(1), prompt(2)])).toThrow(/length|extra/i)
  })

  it('raw 응답의 duplicate와 같은 길이의 extra/missing을 Map 전에 거부한다', () => {
    expect(() => validatePromptScenesExactOnce([1, 2], [prompt(1), prompt(1)])).toThrow(/duplicate/i)
    expect(() => validatePromptScenesExactOnce([1, 2], [prompt(1), prompt(3)])).toThrow(/extra|sceneNo/i)
  })

  it('응답 sceneNo도 positive integer여야 한다', () => {
    expect(() => validatePromptScenesExactOnce([1], [prompt(0)])).toThrow(/sceneNo/i)
    expect(() => validatePromptScenesExactOnce([1], [prompt(1.25)])).toThrow(/sceneNo/i)
  })

  it('imagePrompt와 videoPrompt는 각각 trim 후 non-empty여야 한다', () => {
    expect(() => validatePromptScenesExactOnce([1], [prompt(1, '   ', 'video')])).toThrow(/scene 1.*prompt/i)
    expect(() => validatePromptScenesExactOnce([1], [prompt(1, 'image', '\n')])).toThrow(/scene 1.*prompt/i)
  })
})

describe('writeScenePrompts', () => {
  it('DTO를 exact adapterScenes로 변환하고 prompt/media/timing 키를 전달하지 않는다', async () => {
    const dtoScenes = [
      {
        sceneNo: 1,
        summary: '',
        text: '첫 본문',
        imagePrompt: 'LEAK_IMAGE',
        videoPrompt: 'LEAK_VIDEO',
        startTime: 10,
        image: { base64: 'LEAK_MEDIA' },
      },
      { sceneNo: 2, summary: '둘째 요약', text: '둘째 본문', endTime: 20 },
    ]
    const context = { style: 'cinematic' }
    const opts = { language: 'ko', onlyEmpty: true }
    const writePrompts = vi.fn(async (adapterScenes, receivedContext, receivedOpts) => {
      expect(adapterScenes).toEqual([
        { sceneNo: 1, summary: '', segments: [{ text: '첫 본문' }] },
        { sceneNo: 2, summary: '둘째 요약', segments: [{ text: '둘째 본문' }] },
      ])
      expect(Object.keys(adapterScenes[0])).toEqual(['sceneNo', 'summary', 'segments'])
      expect(adapterScenes[0]).not.toHaveProperty('imagePrompt')
      expect(adapterScenes[0]).not.toHaveProperty('videoPrompt')
      expect(adapterScenes[0]).not.toHaveProperty('startTime')
      expect(adapterScenes[0]).not.toHaveProperty('image')
      expect(receivedContext).toBe(context)
      expect(receivedOpts).toBe(opts)
      return {
        scenes: [
          { sceneNo: 1, imagePrompt: 'IMG1', videoPrompt: 'VID1', ignored: 'x' },
          { sceneNo: 2, imagePrompt: 'IMG2', videoPrompt: 'VID2', storyId: 'y' },
        ],
      }
    })

    await expect(writeScenePrompts(dtoScenes, context, opts, { writePrompts })).resolves.toEqual([
      { sceneNo: 1, imagePrompt: 'IMG1', videoPrompt: 'VID1' },
      { sceneNo: 2, imagePrompt: 'IMG2', videoPrompt: 'VID2' },
    ])
    expect(writePrompts).toHaveBeenCalledTimes(1)
  })

  it.each([
    ['empty input', []],
    ['duplicate sceneNo', [{ sceneNo: 1, text: 'a' }, { sceneNo: 1, text: 'b' }]],
    ['zero sceneNo', [{ sceneNo: 0, text: 'a' }]],
    ['non-integer sceneNo', [{ sceneNo: 1.5, text: 'a' }]],
  ])('%s은 어댑터 호출 전에 거부한다', async (_label, dtoScenes) => {
    const writePrompts = vi.fn()
    await expect(writeScenePrompts(dtoScenes, {}, {}, { writePrompts })).rejects.toThrow(/input/i)
    expect(writePrompts).not.toHaveBeenCalled()
  })

  it('deps 반환에도 exact-once 경계 검증을 다시 적용한다', async () => {
    const writePrompts = vi.fn(async () => ({
      scenes: [
        { sceneNo: 1, imagePrompt: 'IMG1', videoPrompt: 'VID1' },
        { sceneNo: 1, imagePrompt: 'IMG2', videoPrompt: 'VID2' },
      ],
    }))
    await expect(writeScenePrompts(
      [{ sceneNo: 1, summary: '', text: '본문' }],
      {},
      {},
      { writePrompts },
    )).rejects.toThrow(/duplicate/i)
  })
})

describe('groupSrtLines orchestration', () => {
  const validResult = (count) => ({
    groups: count === 0 ? [] : [{ fromLine: 1, toLine: count, summary: '전체 요약' }],
  })

  it.each([
    ['0-based', [{ lineNo: 0, text: 'a' }, { lineNo: 1, text: 'b' }]],
    ['gap', [{ lineNo: 1, text: 'a' }, { lineNo: 3, text: 'b' }]],
  ])('%s lineNo 입력은 LLM 호출 전에 거부한다', async (_label, lines) => {
    const adapter = vi.fn(async () => validResult(lines.length))
    await expect(groupSrtLines(lines, {}, { groupSrtLines: adapter }))
      .rejects.toThrow('SRT_GROUP_LINE_NUMBERING_INVALID')
    expect(adapter).not.toHaveBeenCalled()
  })

  it.each([
    ['empty', []],
    ['null', null],
  ])('%s 입력은 LLM 호출 전에 거부한다', async (_label, lines) => {
    const adapter = vi.fn(async () => validResult(0))
    await expect(groupSrtLines(lines, {}, { groupSrtLines: adapter }))
      .rejects.toThrow('SRT_GROUP_INPUT_EMPTY')
    expect(adapter).not.toHaveBeenCalled()
  })

  it('라인 수 경계는 허용하고 초과는 LLM 호출 전에 명시 에러로 중단한다', async () => {
    const atBoundary = Array.from({ length: MAX_GROUP_LINES }, (_, i) => ({ lineNo: i + 1, text: 'x' }))
    const allowed = vi.fn(async () => validResult(atBoundary.length))
    await expect(groupSrtLines(atBoundary, {}, { groupSrtLines: allowed }))
      .resolves.toEqual(validResult(atBoundary.length))
    expect(allowed).toHaveBeenCalledTimes(1)

    const overBoundary = [...atBoundary, { lineNo: MAX_GROUP_LINES + 1, text: 'x' }]
    const blocked = vi.fn()
    await expect(groupSrtLines(overBoundary, {}, { groupSrtLines: blocked }))
      .rejects.toMatchObject({ message: 'SRT_GROUP_INPUT_TOO_LARGE', code: 'SRT_GROUP_INPUT_TOO_LARGE' })
    expect(blocked).not.toHaveBeenCalled()
  })

  it('전체 text 문자수 경계는 허용하고 초과는 LLM을 호출하지 않는다', async () => {
    const allowed = vi.fn(async () => validResult(1))
    await expect(groupSrtLines(
      [{ lineNo: 1, text: 'x'.repeat(MAX_GROUP_CHARS) }],
      {},
      { groupSrtLines: allowed },
    )).resolves.toEqual(validResult(1))

    const blocked = vi.fn()
    await expect(groupSrtLines(
      [{ lineNo: 1, text: 'x'.repeat(MAX_GROUP_CHARS + 1) }],
      {},
      { groupSrtLines: blocked },
    )).rejects.toThrow('SRT_GROUP_INPUT_TOO_LARGE')
    expect(blocked).not.toHaveBeenCalled()
  })

  it('라인 수와 문자 수가 동시에 초과해도 LLM을 호출하지 않는다', async () => {
    const lines = Array.from({ length: MAX_GROUP_LINES + 1 }, (_, i) => ({
      lineNo: i + 1,
      text: 'x'.repeat(Math.ceil((MAX_GROUP_CHARS + 1) / (MAX_GROUP_LINES + 1))),
    }))
    const adapter = vi.fn()
    await expect(groupSrtLines(lines, {}, { groupSrtLines: adapter }))
      .rejects.toThrow('SRT_GROUP_INPUT_TOO_LARGE')
    expect(adapter).not.toHaveBeenCalled()
  })

  it('adapter에는 lineNo/text whitelist만 전달하고 타임코드를 제거한다', async () => {
    const opts = { language: 'ko' }
    const adapter = vi.fn(async (lines, receivedOpts) => {
      expect(lines).toEqual([{ lineNo: 1, text: '본문' }])
      expect(Object.keys(lines[0])).toEqual(['lineNo', 'text'])
      expect(receivedOpts).toBe(opts)
      return validResult(1)
    })
    await groupSrtLines(
      [{ lineNo: 1, text: '본문', startTime: 10, endTime: 20, timing: 'LEAK' }],
      opts,
      { groupSrtLines: adapter },
    )
  })

  it('파티션 오류면 딱 한 번 재요청하고 두 번째 정상 결과를 반환한다', async () => {
    const adapter = vi.fn()
      .mockResolvedValueOnce({ groups: [{ fromLine: 2, toLine: 2, summary: 'gap' }] })
      .mockResolvedValueOnce(validResult(2))

    await expect(groupSrtLines(
      [{ lineNo: 1, text: 'a' }, { lineNo: 2, text: 'b' }],
      {},
      { groupSrtLines: adapter },
    )).resolves.toEqual(validResult(2))
    expect(adapter).toHaveBeenCalledTimes(2)
  })

  it('두 번째 결과도 잘못되면 2회 호출 뒤 명확히 실패한다', async () => {
    const adapter = vi.fn(async () => ({
      groups: [{ fromLine: 1, toLine: 1, summary: '누락' }],
    }))
    await expect(groupSrtLines(
      [{ lineNo: 1, text: 'a' }, { lineNo: 2, text: 'b' }],
      {},
      { groupSrtLines: adapter },
    )).rejects.toThrow(/partition/i)
    expect(adapter).toHaveBeenCalledTimes(2)
  })
})
