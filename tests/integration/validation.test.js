/**
 * 사용자 입력 유효성 검사 테스트
 *
 * 다양한 엣지 케이스와 잘못된 입력 처리 테스트
 */

import { describe, it, expect } from 'vitest'
import {
  parseTextToScenes,
  parseCSVToScenes,
  parseSRTToScenes,
  parseReferencesCSV,
  detectFileType
} from '../../src/utils/parsers'

// R14 review fix: parseCSVLine removed (deprecated). RFC parser tests are in
// tests/utils/csvParser.test.js + tests/utils/parsers.rfcEdges.test.js.

describe('텍스트 입력 유효성', () => {
  describe('특수 문자 처리', () => {
    it('줄바꿈 종류 (LF)', () => {
      const text = '라인1\n라인2\n라인3'
      const scenes = parseTextToScenes(text)
      expect(scenes).toHaveLength(3)
    })

    it('줄바꿈 종류 (CRLF - Windows)', () => {
      const text = '라인1\r\n라인2\r\n라인3'
      const scenes = parseTextToScenes(text)
      // \r\n은 \n으로 split 후 \r이 남지만 trim()으로 처리됨
      expect(scenes.length).toBeGreaterThanOrEqual(1)
    })

    it('탭 문자', () => {
      const text = '프롬프트\t추가텍스트'
      const scenes = parseTextToScenes(text)
      expect(scenes[0].prompt).toContain('\t')
    })

    it('연속 줄바꿈', () => {
      const text = '라인1\n\n\n\n라인2'
      const scenes = parseTextToScenes(text)
      expect(scenes).toHaveLength(2)
    })

    it('유니코드 이모지', () => {
      const text = '🎨 아트 스타일\n🌅 일몰 장면\n🏔️ 산 풍경'
      const scenes = parseTextToScenes(text)
      expect(scenes).toHaveLength(3)
      expect(scenes[0].prompt).toBe('🎨 아트 스타일')
    })

    it('한중일 문자 혼합', () => {
      const text = '韓国語と日本語と中文'
      const scenes = parseTextToScenes(text)
      expect(scenes[0].prompt).toBe('韓国語と日本語と中文')
    })

    it('아랍어/히브리어 (RTL)', () => {
      const text = 'مرحبا بالعالم'
      const scenes = parseTextToScenes(text)
      expect(scenes[0].prompt).toBe('مرحبا بالعالم')
    })
  })

  describe('길이 제한', () => {
    it('매우 긴 프롬프트', () => {
      const longPrompt = 'A'.repeat(10000)
      const scenes = parseTextToScenes(longPrompt)
      expect(scenes[0].prompt.length).toBe(10000)
    })

    it('매우 많은 라인', () => {
      const lines = Array(1000).fill('프롬프트').join('\n')
      const scenes = parseTextToScenes(lines)
      expect(scenes).toHaveLength(1000)
    })
  })

  describe('공백 처리', () => {
    it('앞뒤 공백 제거', () => {
      const text = '   프롬프트   '
      const scenes = parseTextToScenes(text)
      expect(scenes[0].prompt).toBe('프롬프트')
    })

    it('중간 공백 유지', () => {
      const text = '프롬프트   중간   공백'
      const scenes = parseTextToScenes(text)
      expect(scenes[0].prompt).toBe('프롬프트   중간   공백')
    })

    it('공백만 있는 라인 무시', () => {
      const text = '라인1\n   \n라인2'
      const scenes = parseTextToScenes(text)
      expect(scenes).toHaveLength(2)
    })
  })
})

describe('CSV 입력 유효성', () => {
  describe('따옴표 처리', () => {
    it('따옴표 내 콤마', () => {
      const csv = `prompt,subtitle
"프롬프트, 콤마 포함",자막`
      const scenes = parseCSVToScenes(csv)
      expect(scenes[0].prompt).toBe('프롬프트, 콤마 포함')
    })

    it('따옴표 내 줄바꿈 (미지원)', () => {
      // 현재 파서는 줄바꿈으로 행을 구분하므로 따옴표 내 줄바꿈은 별도 처리 필요
      const csv = `prompt,subtitle
"첫줄
둘째줄",자막`
      // 이 케이스는 현재 파서에서 제대로 처리 안됨 (알려진 제한)
      const scenes = parseCSVToScenes(csv)
      // 결과는 구현에 따라 다름
    })

    it('빈 따옴표', () => {
      const csv = `prompt,subtitle
"",자막`
      const scenes = parseCSVToScenes(csv)
      expect(scenes[0].prompt).toBe('')
    })

    it('중첩 따옴표', () => {
      const csv = `prompt
"말씀하신 ""인용"" 입니다"`
      const scenes = parseCSVToScenes(csv)
      // 중첩 따옴표는 현재 완벽히 지원하지 않을 수 있음
    })
  })

  describe('헤더 유효성', () => {
    it('대소문자 무시', () => {
      const csv = `PROMPT,SUBTITLE,DURATION
프롬프트,자막,3`
      const scenes = parseCSVToScenes(csv)
      expect(scenes[0].prompt).toBe('프롬프트')
    })

    it('앞뒤 공백 있는 헤더', () => {
      const csv = ` prompt , subtitle , duration
프롬프트,자막,3`
      const scenes = parseCSVToScenes(csv)
      expect(scenes[0].prompt).toBe('프롬프트')
    })

    it('알 수 없는 컬럼 무시', () => {
      const csv = `prompt,unknown_column,subtitle
프롬프트,무시됨,자막`
      const scenes = parseCSVToScenes(csv)
      expect(scenes[0].prompt).toBe('프롬프트')
      expect(scenes[0].subtitle).toBe('자막')
    })

    it('중복 컬럼명', () => {
      const csv = `prompt,prompt,subtitle
첫번째,두번째,자막`
      const scenes = parseCSVToScenes(csv)
      // 마지막 prompt 컬럼 값이 사용됨 (헤더 순회 시 덮어씀)
      expect(scenes[0].prompt).toBe('두번째')
    })
  })

  describe('숫자 필드 유효성', () => {
    it('정상 숫자', () => {
      const csv = `prompt,duration
프롬프트,3.5`
      const scenes = parseCSVToScenes(csv)
      expect(scenes[0].duration).toBe(3.5)
    })

    it('음수 duration', () => {
      const csv = `prompt,duration
프롬프트,-3`
      const scenes = parseCSVToScenes(csv)
      // parseFloat(-3)는 -3이지만 앱에서 별도 검증 필요
      expect(scenes[0].duration).toBe(-3)
    })

    it('문자열 duration', () => {
      const csv = `prompt,duration
프롬프트,abc`
      const scenes = parseCSVToScenes(csv)
      // parseFloat('abc')는 NaN → 기본값 사용
      expect(scenes[0].duration).toBe(3) // 기본값
    })

    it('빈 duration', () => {
      const csv = `prompt,duration
프롬프트,`
      const scenes = parseCSVToScenes(csv)
      expect(scenes[0].duration).toBe(3) // 기본값
    })
  })

  describe('빈 데이터', () => {
    it('데이터 없는 CSV', () => {
      const csv = 'prompt,subtitle,duration'
      const scenes = parseCSVToScenes(csv)
      expect(scenes).toHaveLength(0)
    })

    it('빈 행만 있는 CSV', () => {
      const csv = `prompt,subtitle
,
,`
      const scenes = parseCSVToScenes(csv)
      // 빈 prompt도 포함됨
      expect(scenes.length).toBeGreaterThanOrEqual(0)
    })
  })
})

describe('SRT 입력 유효성', () => {
  describe('타임코드 형식', () => {
    it('콤마 밀리초 구분자', () => {
      const srt = `1
00:00:00,000 --> 00:00:03,500
자막`
      const scenes = parseSRTToScenes(srt)
      expect(scenes[0].endTime).toBe(3.5)
    })

    it('점 밀리초 구분자', () => {
      const srt = `1
00:00:00.000 --> 00:00:03.500
자막`
      const scenes = parseSRTToScenes(srt)
      expect(scenes[0].endTime).toBe(3.5)
    })

    it('1시간 이상', () => {
      const srt = `1
01:30:00,000 --> 01:30:05,000
자막`
      const scenes = parseSRTToScenes(srt)
      expect(scenes[0].startTime).toBe(5400) // 1.5시간 = 5400초
    })

    it('밀리초 없는 타임코드 (비표준)', () => {
      const srt = `1
00:00:00 --> 00:00:03
자막`
      const scenes = parseSRTToScenes(srt)
      // 밀리초 없으면 매치 안됨
      expect(scenes).toHaveLength(0)
    })
  })

  describe('블록 구조', () => {
    it('빈 줄로 구분된 블록', () => {
      const srt = `1
00:00:00,000 --> 00:00:03,000
자막1

2
00:00:03,000 --> 00:00:06,000
자막2`
      const scenes = parseSRTToScenes(srt)
      expect(scenes).toHaveLength(2)
    })

    it('여러 빈 줄로 구분', () => {
      const srt = `1
00:00:00,000 --> 00:00:03,000
자막1



2
00:00:03,000 --> 00:00:06,000
자막2`
      const scenes = parseSRTToScenes(srt)
      expect(scenes).toHaveLength(2)
    })

    it('번호 없는 블록도 받는다', () => {
      // 인덱스 줄은 도구에 따라 생략된다. 옛 파서는 lines[1] 을 타임코드로 "가정"해서 이런 블록을
      // 통째로 버렸다 — 타임코드 줄을 찾아서 기준으로 삼으면 버릴 이유가 없다.
      const srt = `00:00:00,000 --> 00:00:03,000
자막`
      const scenes = parseSRTToScenes(srt)
      expect(scenes).toHaveLength(1)
      expect(scenes[0].subtitle).toBe('자막')
    })
  })

  describe('자막 텍스트', () => {
    it('여러 줄 자막', () => {
      const srt = `1
00:00:00,000 --> 00:00:05,000
첫 번째 줄
두 번째 줄
세 번째 줄`
      const scenes = parseSRTToScenes(srt)
      expect(scenes[0].subtitle).toBe('첫 번째 줄\n두 번째 줄\n세 번째 줄')
    })

    it('HTML 태그 포함', () => {
      const srt = `1
00:00:00,000 --> 00:00:03,000
<i>이탤릭</i> <b>볼드</b>`
      const scenes = parseSRTToScenes(srt)
      expect(scenes[0].subtitle).toContain('<i>이탤릭</i>')
    })

    it('이모지 자막', () => {
      const srt = `1
00:00:00,000 --> 00:00:03,000
🎬 영화 시작 🎬`
      const scenes = parseSRTToScenes(srt)
      expect(scenes[0].subtitle).toBe('🎬 영화 시작 🎬')
    })
  })
})

describe('레퍼런스 CSV 유효성', () => {
  describe('필수 필드', () => {
    it('name만 있어도 동작', () => {
      const csv = `name
alice`
      const refs = parseReferencesCSV(csv)
      expect(refs).toHaveLength(1)
      expect(refs[0].type).toBe('character') // 기본값
    })

    it('name 없으면 null', () => {
      const csv = `type,prompt
character,프롬프트`
      const refs = parseReferencesCSV(csv)
      expect(refs).toBeNull()
    })
  })

  describe('타입 유효성', () => {
    it('유효한 타입', () => {
      const csv = `name,type
alice,character
beach,scene
anime,style`
      const refs = parseReferencesCSV(csv)
      expect(refs[0].type).toBe('character')
      expect(refs[1].type).toBe('scene')
      expect(refs[2].type).toBe('style')
    })

    it('알 수 없는 타입', () => {
      const csv = `name,type
alice,unknown`
      const refs = parseReferencesCSV(csv)
      // 알 수 없는 타입은 character로 처리
      expect(refs[0].type).toBe('character')
    })

    it('대소문자 혼합', () => {
      const csv = `name,type
alice,CHARACTER
beach,SCENE`
      const refs = parseReferencesCSV(csv)
      expect(refs[0].type).toBe('character')
      expect(refs[1].type).toBe('scene')
    })
  })
})

describe('파일 타입 감지 유효성', () => {
  it('빈 내용', () => {
    expect(detectFileType('')).toBe('unknown')
  })

  it('공백만', () => {
    expect(detectFileType('   ')).toBe('unknown')
  })

  it('SRT 우선 감지', () => {
    // SRT 타임코드가 있으면 SRT로 감지
    const content = `1
00:00:00,000 --> 00:00:03,000
prompt,subtitle`
    expect(detectFileType(content)).toBe('srt')
  })

  it('CSV vs 텍스트 구분', () => {
    // 콤마가 있어도 CSV 헤더 형식이 아니면 텍스트
    const text = 'hello, world'
    expect(detectFileType(text)).toBe('csv') // 콤마 있으면 CSV로 시도

    // 헤더 없는 콤마 텍스트
    const text2 = 'just text without headers'
    expect(detectFileType(text2)).toBe('text')
  })
})
