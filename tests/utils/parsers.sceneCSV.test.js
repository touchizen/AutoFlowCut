/**
 * parseSceneCSVToTracks — 새 CSV 형식 (scene 컬럼) → { srtTrack, scenes }
 *
 * Phase 3 of docs/superpowers/plans/2026-05-25-srt-csv-track-separation.md
 *
 * 새 형식 규칙:
 *   - 같은 scene 번호 = 같은 씬에 묶임
 *   - 씬 속성 (prompt, prompt_ko, characters, scene_tag, style_tag, shot_type) 은 그룹 첫 행만
 *   - subtitle / start_time / end_time 은 행마다 (자막 1개씩)
 */
import { describe, it, expect } from 'vitest'
import { parseSceneCSVToTracks, isNewSceneCSVFormat } from '../../src/utils/parsers'

// ============================================================
// isNewSceneCSVFormat — 헤더 감지
// ============================================================

describe('isNewSceneCSVFormat', () => {
  it('scene 컬럼 + 정수값 → 새 형식', () => {
    const csv = `scene,subtitle\n1,abc\n1,def\n2,ghi`
    expect(isNewSceneCSVFormat(csv)).toBe(true)
  })

  it('scene 컬럼 없으면 false', () => {
    const csv = `prompt,subtitle\na,xx`
    expect(isNewSceneCSVFormat(csv)).toBe(false)
  })

  it('scene 컬럼 있지만 비정수 값이면 false (옛 scene_tag alias 케이스)', () => {
    const csv = `scene,prompt\ncourtyard,xx`
    expect(isNewSceneCSVFormat(csv)).toBe(false)
  })

  it('빈 CSV → false', () => {
    expect(isNewSceneCSVFormat('')).toBe(false)
  })

  it('헤더만 있는 CSV → false', () => {
    expect(isNewSceneCSVFormat('scene,subtitle')).toBe(false)
  })

  it('헤더 대소문자 무시 (Scene 도 인식)', () => {
    const csv = `Scene,Subtitle\n1,abc`
    expect(isNewSceneCSVFormat(csv)).toBe(true)
  })
})

// ============================================================
// parseSceneCSVToTracks
// ============================================================

const SAMPLE_NEW_CSV = `scene,prompt,prompt_ko,subtitle,characters,scene_tag,style_tag,start_time,end_time
1,"A wealthy nobleman bowing","장부 든 소녀 앞에 고개 숙인 양반","문중 어른들 앞에서, 거상이 고개를 숙였습니다","장대인,소은",courtyard,"Korean historical",0.000,3.500
1,,,"예순이 넘은 사내가, 열네 살 소녀 앞에 허리를 굽혔지요",,,,3.500,7.000
1,,,"이 늙은이가 눈이 멀었었구나.",,,,7.000,11.830
2,"Close-up of hands clutching ledgers","장부와 주판을 쥔 소녀의 두 손","소녀의 손에는 장부 두 권이 들려 있었습니다",소은,courtyard,"Korean historical",11.830,15.500
2,,,"품속에서는 낡은 주판이 달그락거렸지요",,,,15.500,19.500
2,,,"구슬 몇 개가 빠진 아버지가 쥐여준 것이었습니다",,,,19.500,23.840`

describe('parseSceneCSVToTracks', () => {
  it('빈 CSV → 빈 결과', () => {
    expect(parseSceneCSVToTracks('')).toEqual({ srtTrack: [], scenes: [] })
  })

  it('헤더만 있는 CSV → 빈 결과', () => {
    expect(parseSceneCSVToTracks('scene,subtitle')).toEqual({ srtTrack: [], scenes: [] })
  })

  it('같은 scene 번호 행들이 1개 씬으로 묶임', () => {
    const result = parseSceneCSVToTracks(SAMPLE_NEW_CSV)
    expect(result.scenes).toHaveLength(2)
    expect(result.scenes[0].srtLineIds).toHaveLength(3) // scene=1 has 3 rows
    expect(result.scenes[1].srtLineIds).toHaveLength(3) // scene=2 has 3 rows
  })

  it('srtTrack 은 총 행수 만큼 라인 가짐', () => {
    const result = parseSceneCSVToTracks(SAMPLE_NEW_CSV)
    expect(result.srtTrack).toHaveLength(6)
    expect(result.srtTrack[0].text).toBe('문중 어른들 앞에서, 거상이 고개를 숙였습니다')
    expect(result.srtTrack[5].text).toBe('구슬 몇 개가 빠진 아버지가 쥐여준 것이었습니다')
  })

  it('srtTrack 라인의 시간은 행의 start_time/end_time 사용', () => {
    const result = parseSceneCSVToTracks(SAMPLE_NEW_CSV)
    expect(result.srtTrack[0].startTime).toBe(0)
    expect(result.srtTrack[0].endTime).toBe(3.5)
    expect(result.srtTrack[2].startTime).toBe(7.0)
    expect(result.srtTrack[2].endTime).toBe(11.83)
  })

  it('씬 속성은 그룹 첫 행에서만 추출', () => {
    const result = parseSceneCSVToTracks(SAMPLE_NEW_CSV)
    expect(result.scenes[0].prompt).toBe('A wealthy nobleman bowing')
    expect(result.scenes[0].prompt_ko).toBe('장부 든 소녀 앞에 고개 숙인 양반')
    expect(result.scenes[0].characters).toBe('장대인,소은')
    expect(result.scenes[0].scene_tag).toBe('courtyard')
    expect(result.scenes[0].style_tag).toBe('Korean historical')

    expect(result.scenes[1].prompt).toBe('Close-up of hands clutching ledgers')
    expect(result.scenes[1].characters).toBe('소은')
  })

  it('씬의 srtLineIds 는 srtTrack 의 ID 가리킴', () => {
    const result = parseSceneCSVToTracks(SAMPLE_NEW_CSV)
    // 첫 씬은 srtTrack[0,1,2] 가리킴
    expect(result.scenes[0].srtLineIds).toEqual([
      result.srtTrack[0].id,
      result.srtTrack[1].id,
      result.srtTrack[2].id,
    ])
    expect(result.scenes[1].srtLineIds).toEqual([
      result.srtTrack[3].id,
      result.srtTrack[4].id,
      result.srtTrack[5].id,
    ])
  })

  it('씬 시간 = 그룹 첫 행 start ~ 마지막 행 end', () => {
    const result = parseSceneCSVToTracks(SAMPLE_NEW_CSV)
    expect(result.scenes[0].startTime).toBe(0)
    expect(result.scenes[0].endTime).toBe(11.83)
    expect(result.scenes[0].duration).toBeCloseTo(11.83, 5)

    expect(result.scenes[1].startTime).toBe(11.83)
    expect(result.scenes[1].endTime).toBe(23.84)
  })

  it('options.allocateSceneId 사용', () => {
    let counter = 100
    const allocate = () => `scene_${counter++}`
    const result = parseSceneCSVToTracks(SAMPLE_NEW_CSV, { allocateSceneId: allocate })
    expect(result.scenes[0].id).toBe('scene_100')
    expect(result.scenes[1].id).toBe('scene_101')
  })

  it('단일 씬, 단일 행도 동작', () => {
    const csv = `scene,prompt,subtitle,start_time,end_time\n1,"P","S",0,3`
    const result = parseSceneCSVToTracks(csv)
    expect(result.scenes).toHaveLength(1)
    expect(result.scenes[0].prompt).toBe('P')
    expect(result.scenes[0].srtLineIds).toHaveLength(1)
    expect(result.srtTrack[0].text).toBe('S')
  })

  it('시간 정보 없으면 cursor 사용 (전 행 end 이어서)', () => {
    const csv = `scene,prompt,subtitle\n1,"P1","S1"\n1,,"S2"\n2,"P2","S3"`
    const result = parseSceneCSVToTracks(csv)
    expect(result.srtTrack[0].startTime).toBe(0)
    expect(result.srtTrack[0].endTime).toBeGreaterThan(0) // default duration
    expect(result.srtTrack[1].startTime).toBe(result.srtTrack[0].endTime)
  })

  it('비연속 scene 번호 (1, 3) 도 그룹화', () => {
    const csv = `scene,subtitle,start_time,end_time\n1,"A",0,1\n3,"B",1,2\n3,"C",2,3`
    const result = parseSceneCSVToTracks(csv)
    expect(result.scenes).toHaveLength(2)
    expect(result.scenes[0].srtLineIds).toHaveLength(1)
    expect(result.scenes[1].srtLineIds).toHaveLength(2)
  })

  it('씬 첫 행 이후 prompt 가 채워져 있어도 무시 (첫 행 우선)', () => {
    const csv = `scene,prompt,subtitle\n1,"FIRST","S1"\n1,"IGNORED","S2"`
    const result = parseSceneCSVToTracks(csv)
    expect(result.scenes).toHaveLength(1)
    expect(result.scenes[0].prompt).toBe('FIRST')
  })

  it('빈 subtitle 인 행은 srtTrack 에서 제외 (review C12 fix — ghost line 방지)', () => {
    const csv = `scene,subtitle,start_time,end_time\n1,"A",0,1\n1,,1,2`
    const result = parseSceneCSVToTracks(csv)
    expect(result.srtTrack).toHaveLength(1)
    expect(result.srtTrack[0].text).toBe('A')
  })

  it('헤더 케이스 무시 (Scene, Subtitle, Prompt)', () => {
    const csv = `Scene,Subtitle,Prompt\n1,"A","P"`
    const result = parseSceneCSVToTracks(csv)
    expect(result.scenes).toHaveLength(1)
    expect(result.scenes[0].prompt).toBe('P')
    expect(result.srtTrack[0].text).toBe('A')
  })
})
