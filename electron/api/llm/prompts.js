/** 프롬프트 빌더 — Gemini/Claude 두 엔진 공유. (구 llmGemini.js 내부 빌더 이관) */

// §v2.12: Ref 카드 prompt와 동일한 `${ethnicity}, ${appearance}` 조합 규칙(공유 helper) —
// electron→src import는 stepMachine의 기존 관례(storyCharacter.js는 순수 모듈, 순환 없음).
import { characterVisualPrompt } from '../../../src/services/storyCharacter.js'

const KOREAN_CHARS_PER_MINUTE = 330
const ENGLISH_WORDS_PER_MINUTE = 150

function formatEstimate(value) {
  return String(Math.round(Number(value) || 0)).replace(/\B(?=(\d{3})+(?!\d))/g, ',')
}

function formatMinutes(value) {
  const n = Number(value)
  if (!Number.isFinite(n) || n <= 0) return '10'
  return Number.isInteger(n) ? String(n) : String(n).replace(/\.?0+$/, '')
}

function buildLengthText(opts = {}) {
  const n = opts.lengthValue || 10
  const unit = opts.lengthUnit || 'min'
  if (unit === 'chars') return opts.language === 'en' ? `about ${n} characters` : `약 ${n}자`
  if (unit === 'words') return `about ${n} words`

  const minutes = Number(n) || 10
  const minuteText = formatMinutes(n)
  if (opts.language === 'en') {
    return `about ${minuteText} minutes (about ${formatEstimate(minutes * ENGLISH_WORDS_PER_MINUTE)} words)`
  }
  return `약 ${minuteText}분(대략 ${formatEstimate(minutes * KOREAN_CHARS_PER_MINUTE)}자)`
}

// 등장인물 구조화 스키마(§v2.2 + §v2.12 ethnicity) — 시놉시스 생성/붙여넣기 역추출이 공유하는 JSON 필드 지시.
const CHARACTER_JSON_SHAPE = `[{ "name": "이름", "gender": "male|female|unknown", "age": "나이대(예: 20대)", "role": "극중 역할", "ethnicity": "출신/인종(예: 한국인, Korean, East Asian — 자유 표기)", "appearance": "이미지 생성용 짧은 영어 외형 묘사(나이·성별·헤어·의상·분위기)" }]`

// §v2.8 B2 / §v2.9 MINOR②: 확정 등장인물 명단(roster: {id,name,role})을 씬 분리/검토 프롬프트에 주입.
// roster 미주입(undefined/null)이면 빈 문자열 — 현행 프롬프트 무변경(회귀 고정).
// FIX-7: 확정 빈 명단(roster=[], 나레이션-only)은 "등장인물 없음 — narrator만" 제약을 주입한다.
function buildRosterBlock(roster) {
  const lines = (roster || [])
    .filter((sp) => sp && sp.id && String(sp.id).trim())
    .map((sp) => {
      const name = sp.name && sp.name !== sp.id ? ` (이름: ${sp.name})` : ''
      const role = sp.role ? ` — ${sp.role}` : ''
      return `- id: "${sp.id}"${name}${role}`
    })
  if (!lines.length) {
    if (!Array.isArray(roster)) return ''
    return `확정 등장인물 명단: 없음(나레이션 단독 작품).\nspeaker에는 "narrator"만 사용하라. 명단에 없는 새 인물을 만들지 마라.`
  }
  return [
    `확정 등장인물 명단:`,
    ...lines,
    `speaker에는 이 명단의 id만 문자열 그대로 사용하라. 명단에 없는 새 인물을 만들지 마라. 나레이션은 "narrator"를 쓴다.`,
  ].join('\n')
}

// 리서치 §3.8 (M2/Q5): 검증된 리서치 컨텍스트 블록 — opts.research(research.json: analysis +
// verifiedClaims) 있으면 검증된 구조/논점/사실을 주입한다. 없으면 빈 문자열(현행 무변경, §D14 회귀 고정).
// B1(R1): research.json.verifiedClaims는 commit이 이미 큐레이션한 "채택 목록"이다(개선4 —
// 사용자가 미검증/반박도 채택 가능). 여기서 verdict로 재필터하면 채택이 프롬프트 단계에서
// no-op이 되므로, 재필터하지 않고 저장된 채택 주장을 그대로 신뢰한다. 원문 문장 복사 금지 명시(§7).
function buildResearchBlock(research) {
  if (!research || typeof research !== 'object') return ''
  const structure = (research.analysis?.structure || [])
    .filter((b) => b && (b.beat || b.summary))
    .map((b) => `- ${[b.beat, b.summary].filter(Boolean).join(': ')}`)
  const themes = (research.analysis?.commonThemes || []).filter(Boolean).map((t) => `- ${t}`)
  const claims = (research.verifiedClaims || [])
    .filter((c) => c && c.claim)
    .map((c) => `- ${c.claim}`)
  if (!structure.length && !themes.length && !claims.length) return ''
  return [
    `아래는 인기 영상 리서치로 검증한 컨텍스트다. 참고·재구성 용도로만 사용하고, 원본 자막의 문장을 그대로 복사하지 마라:`,
    structure.length ? `[공통 서사 구조]\n${structure.join('\n')}` : '',
    themes.length ? `[공통 논점]\n${themes.join('\n')}` : '',
    claims.length ? `[검증된 사실]\n${claims.join('\n')}` : '',
  ].filter(Boolean).join('\n')
}

export function buildScriptPrompt(input, opts) {
  const meta = opts.metaPrompt ? `## CUSTOM INSTRUCTIONS\n${opts.metaPrompt}\n` : ''
  const lengthText = buildLengthText(opts)
  // §v2.8 M3: 확정 등장인물 명단 주입 — 대본 첫 소비자부터 이름 어긋남 차단.
  const charLines = (opts.characters || [])
    .filter((c) => c && c.name && String(c.name).trim())
    .map((c) => {
      // §v2.12: ethnicity(출신/인종)도 있으면 표기 — 인물 배경 일관성.
      const traits = [c.gender, c.age, c.role, c.ethnicity].filter(Boolean).join('/')
      return `- ${c.name}${traits ? ` (${traits})` : ''}${c.appearance ? `: ${c.appearance}` : ''}`
    })
  return [
    meta,
    `당신은 유튜브 스토리 채널 작가다. 아래 제목으로 ${lengthText} 분량의 나레이션 대본을 ${opts.language === 'ko' ? '한국어' : '영어'}로 작성하라.`,
    opts.language === 'ko'
      ? `첫 문장(첫 3초)에서 강력한 훅으로 시청자를 사로잡고, 기승전결(설정→갈등 전개→반전·절정→해소·여운)의 리듬으로 긴장과 몰입을 끝까지 유지하라.`
      : `Grab the viewer with a strong hook in the very first sentence (first 3 seconds), and sustain tension and immersion throughout with a clear story arc: setup → rising conflict → climax/twist → resolution.`,
    opts.genre ? `장르: ${opts.genre}` : '',
    opts.tone ? `톤: ${opts.tone}` : '',
    `제목: ${input.title}`,
    // §3.2: 시놉시스 게이트에서 확정한 줄거리를 따라 작성.
    // (리서치 블록은 synopsis 전용(D12) — script 경로엔 opts.research 주입 호출자가 없어 m1에서 제거.)
    opts.synopsis ? `아래 시놉시스를 따라 대본을 작성하라:\n--- 시놉시스 ---\n${opts.synopsis}\n--- 시놉시스 끝 ---` : '',
    charLines.length ? `등장인물은 아래 명단과 정확한 이름만 사용하라. 명단에 없는 새 인물을 만들거나 이름을 바꾸지 마라:\n${charLines.join('\n')}` : '',
    `마크다운으로, 챕터 구분과 (대사가 있으면) 화자 표기를 포함하라.`,
  ].filter(Boolean).join('\n')
}

// §v2.4: 시놉시스 게이트(제목 경로) — 줄거리 개요 + 등장인물[] 구조화 JSON을 함께 산출.
export function buildSynopsisPrompt(input, opts = {}) {
  const meta = opts.metaPrompt ? `## CUSTOM INSTRUCTIONS\n${opts.metaPrompt}\n` : ''
  const lengthText = buildLengthText(opts)
  return [
    meta,
    `당신은 유튜브 스토리 채널 작가다. 아래 제목으로 만들 ${lengthText} 분량 영상의 시놉시스를 ${opts.language === 'ko' ? '한국어' : '영어'}로 써라.`,
    // 서사 구조는 언어권에 맞춘다 — 한국어는 기승전결, 영어권은 서구식 story arc.
    opts.language === 'ko'
      ? [
          `아래를 순서대로, 각 항목을 소제목(예: "## 훅")으로 구분해 써라(대사·씬 번호 없이 줄글):`,
          `1) 로그라인: 한 줄.`,
          `2) 훅(Hook): 시청자를 초반 3초에 붙잡을 강력한 도입 1~2문장 — 충격·미스터리·강한 공감 중 하나로, 답을 미뤄 궁금증을 남긴다.`,
          `3) 기승전결: 기(인물·상황 설정) → 승(갈등 전개) → 전(반전·최대 위기) → 결(해소·여운)을 각 1~2문장.`,
        ].join('\n')
      : [
          `Write the following in order, each as its own subheading (no dialogue or scene numbers, prose outline):`,
          `1) Logline: one line.`,
          `2) Hook: a 1-2 sentence opening that grabs the viewer in the first 3 seconds (shock, mystery, or deep empathy; leave a question open).`,
          `3) Story arc: setup (characters & situation) → rising conflict → climax/twist → resolution, 1-2 sentences each.`,
        ].join('\n'),
    opts.genre ? `장르: ${opts.genre}` : '',
    opts.tone ? `톤: ${opts.tone}` : '',
    `제목: ${input.title}`,
    // 리서치 §3.8 (M2/Q5): generateSynopsis({useResearch:true})가 주입한 검증 컨텍스트(있으면).
    buildResearchBlock(opts.research),
    `줄거리를 다 쓴 뒤 마지막에 CHARACTERS_JSON 이라고 한 줄 쓰고, 다음 줄부터 등장인물 전체를 아래 형식의 JSON 배열로만 출력하라(설명·코드펜스 금지):`,
    CHARACTER_JSON_SHAPE,
    `gender는 male/female/unknown 중 하나만 쓴다. 나레이션(narrator)은 등장인물에 넣지 않는다.`,
  ].filter(Boolean).join('\n')
}

// §v2.4 / §v2.8 M4: 붙여넣기 경로 — 붙여넣은 대본에서 등장인물[]만 같은 스키마로 역추출(줄거리 생성 없음).
export function buildCharacterExtractPrompt(pastedScript, opts = {}) {
  return [
    `아래 대본에 등장하는 인물 전체를 추출하라. 요약이나 설명 없이 아래 형식의 JSON 배열만 출력하라(코드펜스 금지):`,
    CHARACTER_JSON_SHAPE,
    `gender는 male/female/unknown 중 하나만 쓴다. name은 대본 표기 그대로 쓴다. 나레이션(narrator)은 인물에 넣지 않는다.`,
    `--- 대본 ---`,
    pastedScript,
  ].join('\n')
}

// 붙여넣기 경로 — 대본을 분석해 시놉시스(로그라인/훅/구조)를 역추출하고 등장인물 JSON도 함께
// 산출한다(buildSynopsisPrompt 출력 계약과 동일: 줄글 + CHARACTERS_JSON + JSON 배열 → splitSynopsisOutput).
export function buildSynopsisFromScriptPrompt(pastedScript, opts = {}) {
  const meta = opts.metaPrompt ? `## CUSTOM INSTRUCTIONS\n${opts.metaPrompt}\n` : ''
  const ko = opts.language === 'ko'
  return [
    meta,
    ko
      ? `아래 대본을 분석해 그 대본의 시놉시스를 한국어로 정리하라(대본을 새로 쓰지 말고 요약·분석).`
      : `Analyze the script below and write a synopsis of it in English (summarize/analyze — do not rewrite the script).`,
    ko
      ? [
          `아래를 순서대로, 각 항목을 소제목(예: "## 훅")으로 구분해 써라(대사·씬 번호 없이 줄글):`,
          `1) 로그라인: 한 줄.`,
          `2) 훅(Hook): 대본 도입이 시청자를 붙잡는 방식 1~2문장(약하면 보완 제안).`,
          `3) 기승전결: 기·승·전·결로 대본의 흐름을 각 1~2문장 요약.`,
        ].join('\n')
      : [
          `Write the following in order, each as its own subheading (no dialogue or scene numbers, prose):`,
          `1) Logline: one line.`,
          `2) Hook: how the opening grabs the viewer, 1-2 sentences (suggest an improvement if weak).`,
          `3) Story arc: setup → rising conflict → climax/twist → resolution, summarizing the script, 1-2 sentences each.`,
        ].join('\n'),
    ko
      ? `그 뒤 마지막에 CHARACTERS_JSON 이라고 한 줄 쓰고, 다음 줄부터 대본 등장인물 전체를 아래 형식의 JSON 배열로만 출력하라(설명·코드펜스 금지):`
      : `Then write CHARACTERS_JSON on its own line, followed by all characters from the script as a JSON array in the format below (no prose, no code fence):`,
    CHARACTER_JSON_SHAPE,
    ko
      ? `gender는 male/female/unknown 중 하나만. name은 대본 표기 그대로. 나레이션(narrator)은 인물에 넣지 않는다.`
      : `gender must be one of male/female/unknown. Use the exact names from the script. Do not include the narrator.`,
    `--- 대본 ---`,
    pastedScript,
  ].filter(Boolean).join('\n')
}

export function buildSplitPrompt(scriptMd, opts) {
  // 입도 옵션: 'segment' = 문장(대사/나레이션 한 줄)마다 개별 씬(이미지/비디오 1:1),
  // 그 외/'scene'(기본) = min~max초 의미 단위 묶음. UI setup 의 sceneGranularity·sceneMinSec·
  // sceneMaxSec 로 전달된다(초 미지정 시 5~10초 — 기존 기본값 유지). 초→글자수 환산:
  // 한국어 ≈ 5.5자/초, 영어 ≈ 15자/초(기본 5/10초가 정확히 28~55자 / 75~150 chars 를 재현).
  const ko = opts.language === 'ko'
  const clampSec = (v, fallback) => {
    const n = Math.round(Number(v))
    return Number.isFinite(n) && n >= 1 ? Math.min(120, n) : fallback
  }
  const minSec = clampSec(opts.sceneMinSec, 5)
  const maxSec = Math.max(minSec, clampSec(opts.sceneMaxSec, 10))
  const toChars = (s) => Math.round(s * (ko ? 5.5 : 15))
  const rangeChars = ko ? `한국어 기준 약 ${toChars(minSec)}~${toChars(maxSec)}자` : `about ${toChars(minSec)}~${toChars(maxSec)} chars in English`
  const overChars = ko ? `한국어 약 ${toChars(maxSec)}자` : `about ${toChars(maxSec)} chars in English`
  const splitRule = opts.sceneGranularity === 'segment'
    ? `아래 대본을 문장 단위로 나눠 각 문장(대사·나레이션)을 개별 씬으로 만들어라. 화자가 바뀌면 새 씬으로 나눈다. 다만 한 단어·감탄사·말줄임표(예: "…", "에잇.")처럼 그 자체로 너무 짧은 조각은 마침표만으로 쪼개지 말고 앞뒤 문장과 한 씬으로 합쳐라(단, 화자가 다르면 짧아도 나눈다). 반대로 한 문장이 낭독 ${maxSec}초(${overChars})를 넘을 만큼 길면 의미 단위로 더 분할하라.`
    : `아래 대본을 의미 단위로 나누되 각 씬은 낭독 시 ${minSec}~${maxSec}초(${rangeChars}) 분량이어야 한다. 의미가 바뀌거나 길이를 초과하면 씬을 분할하라.`
  return [
    splitRule,
    `각 나레이션/대사 세그먼트마다 speaker(나레이션은 "narrator", 대사는 인물 식별자)와 text, emotion(normal/happy/sad/angry)을 지정하라.`,
    // §v2.8 B2: 확정 명단이 있으면 배정을 명단에 묶는다(새 인물 생성 금지).
    buildRosterBlock(opts.roster),
    // V2: 가시 등장인물의 외형을 speakers에 담아 캐릭터 레퍼런스로 등록 → 씬 이미지 일관성.
    `화면에 보이는 등장인물(narrator 제외)은 speakers 항목에 appearance(이미지 생성용 짧은 영어 외형/생김새 묘사: 나이·성별·헤어·의상·분위기)를 넣어라. narrator나 화면에 안 나오는 화자는 appearance를 생략한다.`,
    // M2b: 효과음 큐를 세그먼트 단위로 삽입. 단어 단위(문장 내부) 금지 — 시퀀스의 한 자리를 차지한다.
    `대본 흐름상 효과음(문 여는 소리·천둥·발소리·비명 등)이 꼭 필요한 지점에는 그 자리에 { "type": "sfx", "description": "..." } 세그먼트를 삽입하라. description은 효과음을 생성할 짧은 영어 묘사(예: "door creaking open", "distant thunder")로 쓴다. sfx 세그먼트에는 speaker/text/emotion을 넣지 않는다. 나레이션/대사 세그먼트는 type을 생략해도 된다(기본 narration).`,
    `효과음은 꼭 필요한 순간(장면 전환·긴장·중요한 사건)에만 절제해서 넣어라 — 과도하게 넣으면 흐름을 해친다.`,
    `등장 화자 전체 목록을 speakers로 반환하라. narrator(나레이션)도 반드시 speakers에 포함한다(narrator는 appearance 없이).`,
    `--- 대본 ---`,
    scriptMd,
  ].filter(Boolean).join('\n')
}

export function buildTitlePrompt(scriptMd, opts = {}) {
  const lang = opts.language === 'en' ? '영어' : '한국어'
  return [
    `아래 나레이션 대본에 어울리는 유튜브 영상 제목을 ${lang}로 한 줄만 출력하라. 따옴표·설명·번호 없이 제목 텍스트만.`,
    `--- 대본 ---`,
    scriptMd,
  ].join('\n')
}

export function buildContinuePrompt(existingScript, opts = {}) {
  return [
    `아래는 지금까지 작성된 나레이션 대본이다. 이 대본의 톤·문체·흐름을 그대로 유지하며 자연스럽게 이어서 계속 써라.`,
    `이미 쓴 앞부분을 반복하지 말고, 이어지는 새 내용만 출력하라(전체 대본을 다시 출력하지 말 것).`,
    opts.genre ? `장르: ${opts.genre}` : '',
    `--- 지금까지의 대본 ---`,
    existingScript,
  ].filter(Boolean).join('\n')
}

// M3: 대본 자체검토 — 몰입도/궁금증/기대감 중심 루브릭, verdict(pass/revise)+critique 반환.
// 검수 채점 — 몰입감 단일 지표. verdict/critique와 독립이라 pass여도 점수는 낸다.
const SCORE_INSTRUCTION = `score에는 몰입감을 0~100 정수로 담아라 — 후킹·긴장 유지·감정이입을 냉정하게 평가한다(관대한 점수 금지). verdict와 무관하게 항상 채점한다.`

export function buildReviewPrompt(scriptMd, opts = {}) {
  return [
    `당신은 유튜브 스토리 채널의 냉정한 대본 편집자다. 아래 대본을 몰입도 중심으로 검토하라:`,
    `- 궁금증: 도입과 각 비트가 시청자가 답을 알고 싶어지는 질문을 만드는가`,
    `- 기대감: 다음 장면/다음 고백/다음 사건을 기다리게 만드는가`,
    `- 추진력: 설명이 늘어지거나 긴장이 식는 구간이 없는가`,
    `- 명료성: 누가 무엇을 원하고 왜 움직이는지 따라갈 수 있는가`,
    `- 보상감: 결말이 도입의 궁금증을 충분히 회수하거나 더 깊은 여운을 남기는가`,
    opts.genre ? `장르(약한 참고용): ${opts.genre}` : '',
    `심각하게 개선이 필요하면 verdict="revise"와 구체적이고 실행 가능한 critique(무엇을 어떻게 고칠지)를 내라.`,
    `충분히 좋으면 verdict="pass". 사소한 취향 차이나 경미한 문제로 revise를 남발하지 마라.`,
    SCORE_INSTRUCTION,
    `--- 대본 ---`,
    scriptMd,
  ].filter(Boolean).join('\n')
}

// M3: 검토 critique를 반영해 대본 전체를 재작성. 톤·언어·길이·화자 표기 유지, 전체 대본만 출력.
export function buildRevisePrompt(scriptMd, critique, opts = {}) {
  return [
    `아래 대본을 비평(critique)을 반영해 개선하라. 톤·문체·언어·분량·화자 표기는 그대로 유지한다.`,
    `설명이나 머리말 없이 개선된 대본 전체만 출력하라.`,
    `--- 비평(critique) ---`,
    critique,
    `--- 대본 ---`,
    scriptMd,
  ].join('\n')
}

// 시놉시스 검수(spec 2026-07-10): 산문 다듬기가 아니라 '전제(premise)'를 본다. 등장인물 카드가
// 본문에서 파생되므로 둘의 정합성도 함께 검토한다.
export function buildSynopsisReviewPrompt(synopsisMd, characters = [], opts = {}) {
  return [
    `당신은 유튜브 스토리 채널의 냉정한 기획 편집자다. 아래 시놉시스를 '이야기 전제'로서 검토하라:`,
    `- 훅: 전제가 한 편을 끝까지 볼 만한 질문을 만드는가`,
    `- 스테이크: 누가 무엇을 잃거나 얻는지 분명한가`,
    `- 구조: 상황만 있는 게 아니라 시작·전환·보상이 있는가`,
    `- 인물 근거: 등장인물마다 원하는 것이 있고, 시놉시스가 그 존재 이유를 설명하는가`,
    `- 정합성: 등장인물 카드(이름·외형·성별·역할)가 본문과 일치하는가`,
    `- 제작 범위: 설정된 분량으로 만들 수 있는가, 3부작짜리 플롯은 아닌가`,
    opts.genre ? `장르(약한 참고용): ${opts.genre}` : '',
    `심각하게 개선이 필요하면 verdict="revise"와 구체적이고 실행 가능한 critique를 내라.`,
    `충분히 좋으면 verdict="pass". 사소한 취향 차이로 revise를 남발하지 마라.`,
    SCORE_INSTRUCTION,
    `--- 시놉시스 ---`,
    synopsisMd,
    `--- 등장인물 ---`,
    JSON.stringify(characters),
  ].filter(Boolean).join('\n')
}

// 비평 반영 재작성. 출력 계약은 buildSynopsisPrompt와 동일 — 줄거리 + CHARACTERS_JSON 마커 + JSON 배열.
// (시놉시스는 구조화 스키마가 없다. splitSynopsisOutput이 이 마커로 분해한다.)
export function buildSynopsisRevisePrompt(synopsisMd, characters = [], critique, opts = {}) {
  const ko = opts.language !== 'en'
  return [
    `아래 시놉시스를 비평(critique)을 반영해 개선하라. 언어·소제목 구성·분량은 그대로 유지한다.`,
    `본문을 고치면서 등장인물이 달라졌다면 등장인물 배열도 함께 갱신하라.`,
    `설명이나 머리말 없이 개선된 시놉시스 전체만 출력하라.`,
    `--- 비평(critique) ---`,
    critique,
    `--- 시놉시스 ---`,
    synopsisMd,
    `--- 등장인물 ---`,
    JSON.stringify(characters),
    ko
      ? `줄거리를 다 쓴 뒤 마지막에 CHARACTERS_JSON 이라고 한 줄 쓰고, 다음 줄부터 등장인물 전체를 아래 형식의 JSON 배열로만 출력하라(설명·코드펜스 금지):`
      : `After the synopsis, write CHARACTERS_JSON on its own line, followed by all characters as a JSON array in the format below (no prose, no code fence):`,
    CHARACTER_JSON_SHAPE,
    `gender는 male/female/unknown 중 하나만 쓴다. 나레이션(narrator)은 등장인물에 넣지 않는다.`,
  ].filter(Boolean).join('\n')
}

export function buildScenesReviewPrompt(scriptMd, scenes, speakers, opts = {}) {
  return [
    `당신은 유튜브 스토리 영상의 씬 분리 감수자다. 대본과 현재 scenes JSON을 비교해 씬 분리 자체를 검토하라.`,
    `검토 기준: 중요한 대본 비트 누락 여부, 의미/행동 전환에 맞는 씬 경계, 설정된 분리 단위(${opts.sceneGranularity || 'scene'}), 화자 식별, 캐릭터 외형 일관성, SFX 위치의 필요성, 씬 흐름의 궁금증과 기대감.`,
    `수정이 필요하면 verdict="revise"와 구체적인 critique를 반환하라. 충분하면 verdict="pass".`,
    `--- 대본 ---`,
    scriptMd,
    `--- 현재 scenes ---`,
    JSON.stringify({ scenes, speakers }, null, 2),
  ].join('\n')
}

export function buildScenesRevisePrompt(scriptMd, scenes, speakers, critique, opts = {}) {
  return [
    `아래 critique를 반영해 scenes JSON 전체를 수정하라.`,
    `반드시 SCENES_SCHEMA 형태의 JSON만 반환하라. 설명/코드펜스 금지.`,
    `sceneNo, summary, segments, speakers를 포함하고, narration 세그먼트는 speaker/text/emotion을 유지하며, sfx 세그먼트는 description을 유지한다.`,
    `장르 공식보다 대본의 몰입도, 궁금증, 기대감 흐름을 우선한다.`,
    // §v2.9 MINOR②: 검토루프에도 roster 제약 — 검토 중 명단 밖 인물 재유입 차단.
    buildRosterBlock(opts.roster),
    `--- critique ---`,
    critique,
    `--- 대본 ---`,
    scriptMd,
    `--- 현재 scenes ---`,
    JSON.stringify({ scenes, speakers }, null, 2),
  ].filter(Boolean).join('\n')
}

export function buildPromptsReviewPrompt(scenes, context = {}, opts = {}) {
  return [
    `당신은 이미지/비디오 생성 프롬프트 감수자다. 현재 프롬프트가 각 씬의 핵심 사건과 캐릭터 일관성을 잘 담는지 검토하라.`,
    `검토 기준: 모든 씬의 imagePrompt/videoPrompt 존재, 영어 프롬프트 품질, 캐릭터 외형 일관성, imagePrompt와 videoPrompt의 역할 구분, videoPrompt의 움직임/행동성, 씬의 궁금증과 기대감 표현.`,
    `프롬프트만 검토하라. 씬 구조, 세그먼트, 화자, storyId 변경은 금지다.`,
    `수정이 필요하면 verdict="revise"와 구체적인 critique를 반환하라. 충분하면 verdict="pass".`,
    context.scriptMd ? `--- 대본 ---\n${context.scriptMd}` : '',
    `--- 현재 scenes/prompts ---`,
    JSON.stringify({ scenes }, null, 2),
  ].filter(Boolean).join('\n')
}

export function buildPromptsRevisePrompt(scenes, context = {}, critique, opts = {}) {
  return [
    `아래 critique를 반영해 imagePrompt/videoPrompt만 수정하라.`,
    `반드시 PROMPTS_SCHEMA 형태의 JSON만 반환하라. sceneNo, imagePrompt, videoPrompt만 포함한다. 설명/코드펜스 금지.`,
    `씬 구조, 세그먼트, 화자, storyId는 변경하지 않는다.`,
    `--- critique ---`,
    critique,
    context.scriptMd ? `--- 대본 ---\n${context.scriptMd}` : '',
    `--- 현재 scenes/prompts ---`,
    JSON.stringify({ scenes }, null, 2),
  ].filter(Boolean).join('\n')
}

// 리서치 §3.4: 선택된 다수 영상 자막을 종합해 공통 서사 구조 + 핵심 주장 + 공통 논점 추출.
// 교차검증은 프롬프트로 흡수(여러 영상에 공통으로 나오는 주장 가중). 원문 문장 복사 금지(§7).
export function buildResearchAnalyzePrompt(transcripts = [], opts = {}) {
  const lang = opts.language === 'en' ? '영어' : '한국어'
  const blocks = (transcripts || []).map((t, i) => [
    `--- 자막 ${i + 1} (videoId: ${t.videoId}${t.title ? ` / 제목: ${t.title}` : ''}) ---`,
    t.plainText || t.text || '',
  ].join('\n'))
  return [
    `당신은 유튜브 스토리 채널의 리서치 분석가다. 아래 여러 영상의 자막을 하나로 종합해 공통 서사 구조와 핵심 논점을 ${lang}로 분석하라.`,
    `- structure: 영상들이 공유하는 서사 구조를 순서대로 beat(구간 이름)와 summary(그 구간에서 벌어지는 일 요약)로 정리하라.`,
    `- claims: 영상들이 제시하는 핵심 사실 주장(인물·연도·사건·수치 등 검증 가능한 진술)을 추출하라. 각 주장의 sources에는 그 주장이 등장한 videoId를 모두 넣는다. 여러 영상에 공통으로 나오는 주장을 우선하라(교차검증).`,
    `- commonThemes: 여러 영상에 반복해서 나타나는 공통 논점/테마를 정리하라.`,
    `자막 원문 문장을 그대로 복사하지 말고 반드시 재구성해 서술하라(참고·재구성 용도).`,
    ...blocks,
  ].join('\n')
}

// 리서치 §3.5: 구조분석이 뽑은 핵심 주장을 웹검색(WebSearch)으로 검증 — 주장별
// verdict(supported/refuted/unverified) + evidence(url/note) 산출 지시.
export function buildFactCheckPrompt(claims = [], opts = {}) {
  const lang = opts.language === 'en' ? '영어' : '한국어'
  const lines = (claims || []).map((c, i) => `${i + 1}. ${typeof c === 'string' ? c : c?.claim || ''}`)
  return [
    `당신은 팩트체커다. 아래 각 주장(claim)을 웹검색(WebSearch 도구)으로 검증하라.`,
    `주장마다 신뢰할 수 있는 출처를 검색해 확인한 뒤 verdict를 판정한다:`,
    `- supported: 신뢰할 수 있는 출처가 주장을 뒷받침함`,
    `- refuted: 신뢰할 수 있는 출처가 주장과 모순됨`,
    `- unverified: 출처를 찾지 못했거나 근거가 불충분함`,
    `각 주장의 evidence에는 판정 근거를 { url: 출처 URL, note: 근거 요약(${lang}) } 배열로 넣는다. 출처 원문 문장을 그대로 복사하지 말고 요약하라.`,
    `주장 텍스트(claim)는 입력 그대로 유지하고, 모든 주장에 대해 결과를 반환하라.`,
    `--- 주장 목록 ---`,
    ...lines,
  ].join('\n')
}

export function buildPromptsPrompt(scenes, context, opts) {
  const sceneLines = scenes.map((s) => `${s.sceneNo}. ${s.summary} :: ${(s.segments || []).map((g) => g.text).join(' ')}`)
  // V2: 캐릭터별 정본 외형(appearance)을 컨텍스트로 줘서 씬마다 외형을 새로 지어내지 않고 일관 서술.
  // §v2.12 FIX(MAJOR): 포함 기준·조합 모두 characterVisualPrompt(ethnicity, appearance 조합,
  // 빈 쪽 콤마 생략) — ethnicity-only 캐릭터도 Ref 카드와 동일하게 씬 프롬프트에 반영.
  const charLines = (context.speakers || [])
    .map((sp) => ({ sp, desc: characterVisualPrompt(sp) }))
    .filter(({ sp, desc }) => sp && desc)
    .map(({ sp, desc }) => `- ${sp.name}: ${desc}`)
  return [
    `아래 씬들에 대해 이미지 생성 프롬프트(imagePrompt)와 비디오 생성 프롬프트(videoPrompt)를 영어로 작성하라.`,
    `캐릭터가 등장하면 외형 묘사를 프롬프트에 직접 포함해 씬 간 일관성을 유지하라 (레퍼런스 참조 문법 금지 — 플레인 텍스트).`,
    charLines.length ? `등장인물 외형(이 묘사를 일관되게 사용):\n${charLines.join('\n')}` : '',
    context.style ? `스타일: ${context.style}` : '',
    `--- 씬 목록 ---`,
    ...sceneLines,
  ].filter(Boolean).join('\n')
}
