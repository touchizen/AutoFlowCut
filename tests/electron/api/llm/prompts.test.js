import { describe, it, expect } from 'vitest'
import { buildScriptPrompt, buildSplitPrompt, buildPromptsPrompt, buildTitlePrompt, buildContinuePrompt, buildReviewPrompt, buildRevisePrompt, buildScenesRevisePrompt, buildSynopsisPrompt, buildCharacterExtractPrompt } from '../../../../electron/api/llm/prompts.js'

describe('buildScriptPrompt 길이 단위', () => {
  it('min 단위는 "약 N분"', () => {
    const p = buildScriptPrompt({ title: 'T' }, { lengthValue: 8, lengthUnit: 'min', language: 'ko', genre: 'yadam' })
    expect(p).toContain('약 8분')
    expect(p).toContain('대략 2,640자')
    expect(p).toContain('제목: T')
  })
  it('영어 min 단위는 시간과 예상 단어수를 함께 지시한다', () => {
    const p = buildScriptPrompt({ title: 'T' }, { lengthValue: 10, lengthUnit: 'min', language: 'en' })
    expect(p).toContain('about 10 minutes')
    expect(p).toContain('about 1,500 words')
  })
  it('1분 미만 min 단위는 소수 분량을 유지한다', () => {
    const ko = buildScriptPrompt({ title: 'T' }, { lengthValue: '0.67', lengthUnit: 'min', language: 'ko' })
    expect(ko).toContain('약 0.67분')
    expect(ko).toContain('대략 221자')
    const en = buildScriptPrompt({ title: 'T' }, { lengthValue: '0.67', lengthUnit: 'min', language: 'en' })
    expect(en).toContain('about 0.67 minutes')
    expect(en).toContain('about 101 words')
  })
  it('chars 단위는 "약 N자"', () => {
    const p = buildScriptPrompt({ title: 'T' }, { lengthValue: 6000, lengthUnit: 'chars', language: 'ko' })
    expect(p).toContain('약 6000자')
  })
  it('영어 chars 단위는 "about N characters"', () => {
    const p = buildScriptPrompt({ title: 'T' }, { lengthValue: 6000, lengthUnit: 'chars', language: 'en' })
    expect(p).toContain('about 6000 characters')
  })
  it('words 단위는 "about N words"', () => {
    const p = buildScriptPrompt({ title: 'T' }, { lengthValue: 1500, lengthUnit: 'words', language: 'en' })
    expect(p).toContain('about 1500 words')
  })
  it('길이 미지정 시 기본 10분', () => {
    const p = buildScriptPrompt({ title: 'T' }, { language: 'ko' })
    expect(p).toContain('약 10분')
  })
})

describe('buildScriptPrompt', () => {
  it('metaPrompt가 있으면 CUSTOM INSTRUCTIONS 블록을 앞에 넣는다', () => {
    const p = buildScriptPrompt({ title: 'T' }, { language: 'ko', metaPrompt: 'META-XYZ' })
    expect(p).toContain('## CUSTOM INSTRUCTIONS')
    expect(p).toContain('META-XYZ')
    expect(p.indexOf('META-XYZ')).toBeLessThan(p.indexOf('제목: T'))
  })
  it('metaPrompt가 없으면 CUSTOM INSTRUCTIONS 블록이 없다', () => {
    expect(buildScriptPrompt({ title: 'T' }, { language: 'ko' })).not.toContain('CUSTOM INSTRUCTIONS')
  })
})

describe('buildSplitPrompt / buildPromptsPrompt', () => {
  it('split은 대본 본문을 포함', () => {
    expect(buildSplitPrompt('SCRIPT-BODY', { language: 'ko' })).toContain('SCRIPT-BODY')
  })
  it('prompts는 씬 요약을 포함', () => {
    const p = buildPromptsPrompt([{ sceneNo: 1, summary: 'S1', segments: [{ text: 'hi' }] }], {}, { language: 'en' })
    expect(p).toContain('1. S1')
  })
})

describe('buildTitlePrompt', () => {
  it('대본을 포함하고 한 줄 제목을 지시', () => {
    const p = buildTitlePrompt('대본 본문', { language: 'ko' })
    expect(p).toContain('대본 본문')
    expect(p).toContain('한 줄')
  })
})
describe('buildContinuePrompt', () => {
  it('기존 대본을 포함하고 이어쓰기를 지시', () => {
    const p = buildContinuePrompt('앞부분', { genre: 'yadam' })
    expect(p).toContain('앞부분')
    expect(p).toContain('이어서')
  })
})
describe('buildSplitPrompt 5~10초', () => {
  it('5~10초 기준을 포함', () => {
    expect(buildSplitPrompt('S', { language: 'ko' })).toContain('5~10초')
  })
})

describe('buildSplitPrompt sfx 큐(M2b-2)', () => {
  it('sfx 세그먼트 지시(type:"sfx"/description)를 포함', () => {
    const p = buildSplitPrompt('S', { language: 'ko' })
    expect(p).toContain('sfx')
    expect(p).toContain('description')
  })
  it('segment 입도에서도 sfx 지시를 포함', () => {
    const p = buildSplitPrompt('S', { language: 'ko', sceneGranularity: 'segment' })
    expect(p).toContain('sfx')
  })
})

describe('buildSplitPrompt 입도 옵션(sceneGranularity)', () => {
  it('기본(미지정)은 5~10초 씬 기준', () => {
    expect(buildSplitPrompt('S', { language: 'ko' })).toContain('5~10초')
  })
  it("'scene'도 5~10초 씬 기준", () => {
    expect(buildSplitPrompt('S', { language: 'ko', sceneGranularity: 'scene' })).toContain('5~10초')
  })
  it("'segment'면 문장(세그먼트)마다 개별 씬으로 분할 지시하고 5~10초 기준은 쓰지 않는다", () => {
    const p = buildSplitPrompt('S', { language: 'ko', sceneGranularity: 'segment' })
    expect(p).toContain('문장')
    expect(p).not.toContain('5~10초')
  })
})

describe('buildSplitPrompt 씬 길이 min/max(sceneMinSec/sceneMaxSec)', () => {
  it('커스텀 min/max 초를 씬 기준에 반영(한국어 ≈5.5자/초 환산)', () => {
    const p = buildSplitPrompt('S', { language: 'ko', sceneMinSec: 3, sceneMaxSec: 8 })
    expect(p).toContain('3~8초')
    expect(p).toContain('약 17~44자')   // round(3*5.5)=17, round(8*5.5)=44
  })
  it('영어는 15자/초로 환산', () => {
    const p = buildSplitPrompt('S', { language: 'en', sceneMinSec: 4, sceneMaxSec: 6 })
    expect(p).toContain('4~6초')
    expect(p).toContain('about 60~90 chars')   // 4*15=60, 6*15=90
  })
  it('기본(미지정)은 5~10초(28~55자) — 하위호환', () => {
    const p = buildSplitPrompt('S', { language: 'ko' })
    expect(p).toContain('5~10초')
    expect(p).toContain('28~55자')
  })
  it("segment 모드는 max초를 '너무 길면 분할' 기준으로 사용", () => {
    const p = buildSplitPrompt('S', { language: 'ko', sceneGranularity: 'segment', sceneMaxSec: 7 })
    expect(p).toContain('7초')
  })
  it('max < min 이면 max를 min으로 보정(역전 방지)', () => {
    const p = buildSplitPrompt('S', { language: 'ko', sceneMinSec: 9, sceneMaxSec: 4 })
    expect(p).toContain('9~9초')
  })
  it('잘못된 값(0/음수/NaN)은 기본 5/10으로 폴백', () => {
    const p = buildSplitPrompt('S', { language: 'ko', sceneMinSec: 0, sceneMaxSec: 'x' })
    expect(p).toContain('5~10초')
  })
})

describe('buildReviewPrompt (M3 검토)', () => {
  it('내장 루브릭 관점 + 본문 포함', () => {
    const p = buildReviewPrompt('대본-본문-XYZ', { language: 'ko' })
    expect(p).toContain('대본-본문-XYZ')
    expect(p).toMatch(/몰입도/)
    expect(p).toMatch(/궁금증/)
    expect(p).toMatch(/기대감/)
    expect(p).toMatch(/pass/)
    expect(p).toMatch(/revise/)
  })
  it('metaPrompt(장르)는 검수 컨텍스트에 포함하지 않는다', () => {
    const p = buildReviewPrompt('S', { language: 'ko', metaPrompt: 'GENRE-META-123' })
    expect(p).not.toContain('GENRE-META-123')
  })
  it('사소한 취향으로 revise 남발 금지 지시', () => {
    expect(buildReviewPrompt('S', {})).toMatch(/취향|사소|남발|경미/)
  })
})

describe('buildRevisePrompt (M3 수정)', () => {
  it('critique와 본문을 포함하고 톤·언어·길이 유지 지시', () => {
    const p = buildRevisePrompt('원본-대본-ABC', '지적사항-DEF', { language: 'ko' })
    expect(p).toContain('원본-대본-ABC')
    expect(p).toContain('지적사항-DEF')
    expect(p).toMatch(/유지/)
  })
  it('전체 대본만 출력(설명 금지) 지시', () => {
    expect(buildRevisePrompt('S', 'C', {})).toMatch(/전체|설명|만 출력/)
  })
})

describe('buildSplitPrompt appearance(V2)', () => {
  it('등장인물 appearance(외형)를 speakers에 넣으라는 지시 포함', () => {
    const p = buildSplitPrompt('S', { language: 'ko' })
    expect(p).toContain('appearance')
    expect(p).toMatch(/외형|생김새/)
  })
})

describe('buildPromptsPrompt appearance 컨텍스트(V2)', () => {
  it('speakers[].appearance를 프롬프트 컨텍스트로 포함', () => {
    const scenes = [{ sceneNo: 1, summary: 'S1', segments: [{ speaker: 'a', text: 'hi' }] }]
    const p = buildPromptsPrompt(scenes, { style: null, speakers: [{ id: 'a', name: '민수', appearance: 'tall man in black coat' }] }, { language: 'en' })
    expect(p).toContain('tall man in black coat')
    expect(p).toContain('민수')
  })

  it('§v2.12: speakers[].ethnicity가 있으면 외형 앞에 조합해 씬 프롬프트에 인종을 반영한다', () => {
    const scenes = [{ sceneNo: 1, summary: 'S1', segments: [{ speaker: 'a', text: 'hi' }] }]
    const p = buildPromptsPrompt(scenes, {
      style: null,
      speakers: [{ id: 'a', name: '민수', ethnicity: 'Korean', appearance: 'tall man in black coat' }],
    }, { language: 'en' })
    expect(p).toContain('민수: Korean, tall man in black coat')
  })

  it('§v2.12: ethnicity가 없으면 appearance만(현행 동일)', () => {
    const scenes = [{ sceneNo: 1, summary: 'S1', segments: [{ speaker: 'a', text: 'hi' }] }]
    const p = buildPromptsPrompt(scenes, { style: null, speakers: [{ id: 'a', name: '민수', appearance: 'tall man in black coat' }] }, { language: 'en' })
    expect(p).toContain('민수: tall man in black coat')
  })

  // §v2.12 코드리뷰 FIX(MAJOR): appearance truthy에만 묶인 필터는 ethnicity-only 캐릭터를
  // 씬 프롬프트 컨텍스트에서 누락시킨다(Ref 카드엔 있는데 씬엔 없음 — 인종 미반영).
  it('§v2.12 FIX: appearance가 비어도 ethnicity만 있으면 등장인물 컨텍스트에 포함한다', () => {
    const scenes = [{ sceneNo: 1, summary: 'S1', segments: [{ speaker: 'a', text: 'hi' }] }]
    const p = buildPromptsPrompt(scenes, { style: null, speakers: [{ id: 'a', name: '민수', ethnicity: 'Korean', appearance: '' }] }, { language: 'en' })
    expect(p).toContain('민수: Korean')
  })

  it('§v2.12 FIX: ethnicity/appearance 둘 다 빈 값이면 기존대로 제외(회귀 고정)', () => {
    const scenes = [{ sceneNo: 1, summary: 'S1', segments: [{ speaker: 'a', text: 'hi' }] }]
    const p = buildPromptsPrompt(scenes, { style: null, speakers: [{ id: 'a', name: '민수', ethnicity: '', appearance: '' }] }, { language: 'en' })
    expect(p).not.toContain('민수:')
    expect(p).not.toContain('등장인물 외형')
  })
})

describe('buildSynopsisPrompt (시놉시스 게이트 §v2.4)', () => {
  it('제목·로그라인·훅·기승전결·몰입감 점수 지시를 포함', () => {
    const p = buildSynopsisPrompt({ title: '사라진 왕의 반지' }, { language: 'ko' })
    expect(p).toContain('제목: 사라진 왕의 반지')
    expect(p).toContain('로그라인')
    expect(p).toContain('훅')
    expect(p).toContain('기승전결')
    expect(p).toContain('몰입감 점수')
    expect(p).toContain('한국어')
  })
  it('영어 지정 시 영어 작성 지시', () => {
    expect(buildSynopsisPrompt({ title: 'T' }, { language: 'en' })).toContain('영어')
  })
  it('서사 구조는 언어권에 맞춘다 — 한국어는 기승전결, 영어는 서구식 story arc', () => {
    const ko = buildSynopsisPrompt({ title: 'T' }, { language: 'ko' })
    expect(ko).toContain('기승전결')
    const en = buildSynopsisPrompt({ title: 'T' }, { language: 'en' })
    expect(en).not.toContain('기승전결')
    expect(en).toContain('Story arc')
    expect(en).toContain('Immersion score')
  })
  it('대사·씬 번호 없이 줄글 개요만 지시', () => {
    const p = buildSynopsisPrompt({ title: 'T' }, { language: 'ko' })
    expect(p).toMatch(/대사/)
    expect(p).toMatch(/씬 번호/)
    expect(p).toMatch(/줄글/)
  })
  it('등장인물 구조화 필드(name/gender/age/role/ethnicity/appearance) JSON 산출 지시', () => {
    const p = buildSynopsisPrompt({ title: 'T' }, { language: 'ko' })
    expect(p).toContain('CHARACTERS_JSON')
    expect(p).toContain('"name"')
    expect(p).toContain('"gender"')
    expect(p).toContain('"age"')
    expect(p).toContain('"role"')
    expect(p).toContain('"ethnicity"')
    expect(p).toContain('"appearance"')
    expect(p).toMatch(/male.*female.*unknown/)
  })
  it('장르·톤·길이를 반영', () => {
    const p = buildSynopsisPrompt({ title: 'T' }, { language: 'ko', genre: 'yadam', tone: '음산한', lengthValue: 8, lengthUnit: 'min' })
    expect(p).toContain('장르: yadam')
    expect(p).toContain('톤: 음산한')
    expect(p).toContain('약 8분')
  })
  it('metaPrompt가 있으면 CUSTOM INSTRUCTIONS 블록을 앞에 넣는다', () => {
    const p = buildSynopsisPrompt({ title: 'T' }, { language: 'ko', metaPrompt: 'META-SYN-1' })
    expect(p).toContain('## CUSTOM INSTRUCTIONS')
    expect(p).toContain('META-SYN-1')
    expect(p.indexOf('META-SYN-1')).toBeLessThan(p.indexOf('제목: T'))
  })
  it('metaPrompt가 없으면 CUSTOM INSTRUCTIONS 블록이 없다', () => {
    expect(buildSynopsisPrompt({ title: 'T' }, { language: 'ko' })).not.toContain('CUSTOM INSTRUCTIONS')
  })
})

describe('buildCharacterExtractPrompt (붙여넣기 역추출 §v2.4/§v2.8 M4)', () => {
  it('붙여넣은 대본 본문을 포함', () => {
    expect(buildCharacterExtractPrompt('PASTED-SCRIPT-BODY', { language: 'ko' })).toContain('PASTED-SCRIPT-BODY')
  })
  it('같은 구조화 스키마(name/gender/age/role/ethnicity/appearance)로 JSON 배열만 반환 지시', () => {
    const p = buildCharacterExtractPrompt('S', { language: 'ko' })
    expect(p).toContain('"name"')
    expect(p).toContain('"gender"')
    expect(p).toContain('"age"')
    expect(p).toContain('"role"')
    expect(p).toContain('"ethnicity"')
    expect(p).toContain('"appearance"')
    expect(p).toMatch(/male.*female.*unknown/)
    expect(p).toContain('JSON')
  })
  it('줄거리(시놉시스) 생성 지시를 포함하지 않는다', () => {
    const p = buildCharacterExtractPrompt('S', { language: 'ko' })
    expect(p).not.toContain('로그라인')
    expect(p).not.toContain('시놉시스')
    expect(p).not.toContain('줄거리')
  })
})

describe('buildScriptPrompt synopsis 주입(§3.2)', () => {
  it('opts.synopsis가 있으면 시놉시스 컨텍스트 블록을 포함', () => {
    const p = buildScriptPrompt({ title: 'T' }, { language: 'ko', synopsis: 'SYNOPSIS-BODY-42' })
    expect(p).toContain('SYNOPSIS-BODY-42')
    expect(p).toMatch(/시놉시스를 따라/)
  })
  it('opts.synopsis가 없으면 현행과 동일(시놉시스 미언급)', () => {
    const p = buildScriptPrompt({ title: 'T' }, { language: 'ko' })
    expect(p).not.toContain('시놉시스')
  })
})

describe('buildScriptPrompt characters 주입(§v2.8 M3)', () => {
  it('opts.characters가 있으면 명단과 정확한 이름만 사용 지시를 포함', () => {
    const p = buildScriptPrompt({ title: 'T' }, {
      language: 'ko',
      characters: [
        { name: '강리안', gender: 'male', age: '20대', role: '주인공', appearance: 'young man in hanbok' },
        { name: '월향', gender: 'female', age: '30대', role: '기생', appearance: 'woman in silk dress' },
      ],
    })
    expect(p).toContain('강리안')
    expect(p).toContain('월향')
    expect(p).toMatch(/정확한 이름/)
    expect(p).toMatch(/새 인물|새로운 인물/)
  })
  it('§v2.12: characters에 ethnicity가 있으면 명단 블록에 표기한다', () => {
    const p = buildScriptPrompt({ title: 'T' }, {
      language: 'ko',
      characters: [
        { name: '강리안', gender: 'male', age: '20대', role: '주인공', ethnicity: '한국인', appearance: 'young man in hanbok' },
      ],
    })
    expect(p).toContain('한국인')
  })
  it('opts.characters가 없으면 현행과 동일(명단 블록 없음)', () => {
    const p = buildScriptPrompt({ title: 'T' }, { language: 'ko' })
    expect(p).not.toMatch(/정확한 이름/)
    expect(p).not.toContain('명단')
  })
  it('opts.characters가 빈 배열이면 명단 블록을 넣지 않는다', () => {
    const p = buildScriptPrompt({ title: 'T' }, { language: 'ko', characters: [] })
    expect(p).not.toMatch(/정확한 이름/)
  })
})

describe('buildSplitPrompt roster 주입(§v2.8 B2)', () => {
  const roster = [
    { id: '강리안', name: '강리안', role: '주인공' },
    { id: 'narrator', name: '나레이션' },
  ]
  it('opts.roster가 있으면 명단 id만 speaker로 사용·새 인물 금지 지시를 포함', () => {
    const p = buildSplitPrompt('S', { language: 'ko', roster })
    expect(p).toContain('강리안')
    expect(p).toMatch(/명단/)
    expect(p).toMatch(/id만/)
    expect(p).toMatch(/새 인물/)
  })
  it('roster의 id를 문자열 그대로 쓰라고 지시(id 표기 포함)', () => {
    const p = buildSplitPrompt('S', { language: 'ko', roster })
    expect(p).toContain('"강리안"')
    expect(p).toContain('그대로')
  })
  it('opts.roster가 없으면 현행과 동일(명단 블록 없음)', () => {
    const p = buildSplitPrompt('S', { language: 'ko' })
    expect(p).not.toMatch(/명단/)
  })
  // FIX-7: 확정 빈 명단(나레이션-only)은 roster=[]로 주입된다 — "등장인물 없음, narrator만" 제약.
  it('opts.roster가 빈 배열(확정 빈 명단)이면 narrator-only 제약을 넣는다', () => {
    const p = buildSplitPrompt('S', { language: 'ko', roster: [] })
    expect(p).toMatch(/명단.*없음/)
    expect(p).toContain('"narrator"만')
    expect(p).toMatch(/새 인물을 만들지 마라/)
  })
})

describe('buildScenesRevisePrompt roster 주입(§v2.9 MINOR②)', () => {
  const args = ['SCRIPT-MD', [{ sceneNo: 1 }], [{ id: 'a', name: 'A' }], 'CRITIQUE-1']
  it('critique·대본·scenes를 포함(현행 유지)', () => {
    const p = buildScenesRevisePrompt(...args, { language: 'ko' })
    expect(p).toContain('CRITIQUE-1')
    expect(p).toContain('SCRIPT-MD')
    expect(p).toContain('SCENES_SCHEMA')
  })
  it('opts.roster가 있으면 명단 id 제약을 포함', () => {
    const p = buildScenesRevisePrompt(...args, { language: 'ko', roster: [{ id: '강리안', role: '주인공' }] })
    expect(p).toContain('"강리안"')
    expect(p).toMatch(/명단/)
    expect(p).toMatch(/새 인물/)
  })
  it('opts.roster가 없으면 명단 블록 없음(회귀)', () => {
    const p = buildScenesRevisePrompt(...args, { language: 'ko' })
    expect(p).not.toMatch(/명단/)
  })
  it('opts.roster가 빈 배열이면 narrator-only 제약 포함 (FIX-7)', () => {
    const p = buildScenesRevisePrompt(...args, { language: 'ko', roster: [] })
    expect(p).toMatch(/명단.*없음/)
    expect(p).toContain('"narrator"만')
  })
})
