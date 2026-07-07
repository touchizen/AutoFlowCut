/** 프롬프트 빌더 — Gemini/Claude 두 엔진 공유. (구 llmGemini.js 내부 빌더 이관) */

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

export function buildScriptPrompt(input, opts) {
  const meta = opts.metaPrompt ? `## CUSTOM INSTRUCTIONS\n${opts.metaPrompt}\n` : ''
  const lengthText = buildLengthText(opts)
  return [
    meta,
    `당신은 유튜브 스토리 채널 작가다. 아래 제목으로 ${lengthText} 분량의 나레이션 대본을 ${opts.language === 'ko' ? '한국어' : '영어'}로 작성하라.`,
    opts.genre ? `장르: ${opts.genre}` : '',
    opts.tone ? `톤: ${opts.tone}` : '',
    `제목: ${input.title}`,
    `마크다운으로, 챕터 구분과 (대사가 있으면) 화자 표기를 포함하라.`,
  ].filter(Boolean).join('\n')
}

export function buildSplitPrompt(scriptMd, opts) {
  // 입도 옵션: 'segment' = 문장(대사/나레이션 한 줄)마다 개별 씬(이미지/비디오 1:1),
  // 그 외/'scene'(기본) = 5~10초 의미 단위 묶음. UI setup 의 sceneGranularity 로 전달된다.
  const splitRule = opts.sceneGranularity === 'segment'
    ? `아래 대본을 문장 단위로 나눠 각 문장(대사·나레이션)을 개별 씬으로 만들어라. 화자가 바뀌면 새 씬으로 나눈다. 다만 한 단어·감탄사·말줄임표(예: "…", "에잇.")처럼 그 자체로 너무 짧은 조각은 마침표만으로 쪼개지 말고 앞뒤 문장과 한 씬으로 합쳐라(단, 화자가 다르면 짧아도 나눈다). 반대로 한 문장이 낭독 10초(${opts.language === 'ko' ? '한국어 약 55자' : 'about 150 chars in English'})를 넘을 만큼 길면 의미 단위로 더 분할하라.`
    : `아래 대본을 의미 단위로 나누되 각 씬은 낭독 시 5~10초(${opts.language === 'ko' ? '한국어 기준 약 28~55자' : 'about 75~150 chars in English'}) 분량이어야 한다. 의미가 바뀌거나 길이를 초과하면 씬을 분할하라.`
  return [
    splitRule,
    `각 나레이션/대사 세그먼트마다 speaker(나레이션은 "narrator", 대사는 인물 식별자)와 text, emotion(normal/happy/sad/angry)을 지정하라.`,
    // V2: 가시 등장인물의 외형을 speakers에 담아 캐릭터 레퍼런스로 등록 → 씬 이미지 일관성.
    `화면에 보이는 등장인물(narrator 제외)은 speakers 항목에 appearance(이미지 생성용 짧은 영어 외형/생김새 묘사: 나이·성별·헤어·의상·분위기)를 넣어라. narrator나 화면에 안 나오는 화자는 appearance를 생략한다.`,
    // M2b: 효과음 큐를 세그먼트 단위로 삽입. 단어 단위(문장 내부) 금지 — 시퀀스의 한 자리를 차지한다.
    `대본 흐름상 효과음(문 여는 소리·천둥·발소리·비명 등)이 꼭 필요한 지점에는 그 자리에 { "type": "sfx", "description": "..." } 세그먼트를 삽입하라. description은 효과음을 생성할 짧은 영어 묘사(예: "door creaking open", "distant thunder")로 쓴다. sfx 세그먼트에는 speaker/text/emotion을 넣지 않는다. 나레이션/대사 세그먼트는 type을 생략해도 된다(기본 narration).`,
    `효과음은 꼭 필요한 순간(장면 전환·긴장·중요한 사건)에만 절제해서 넣어라 — 과도하게 넣으면 흐름을 해친다.`,
    `등장 화자 전체 목록을 speakers로 반환하라. narrator(나레이션)도 반드시 speakers에 포함한다(narrator는 appearance 없이).`,
    `--- 대본 ---`,
    scriptMd,
  ].join('\n')
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
    `--- critique ---`,
    critique,
    `--- 대본 ---`,
    scriptMd,
    `--- 현재 scenes ---`,
    JSON.stringify({ scenes, speakers }, null, 2),
  ].join('\n')
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

export function buildPromptsPrompt(scenes, context, opts) {
  const sceneLines = scenes.map((s) => `${s.sceneNo}. ${s.summary} :: ${(s.segments || []).map((g) => g.text).join(' ')}`)
  // V2: 캐릭터별 정본 외형(appearance)을 컨텍스트로 줘서 씬마다 외형을 새로 지어내지 않고 일관 서술.
  const charLines = (context.speakers || [])
    .filter((sp) => sp && sp.appearance && String(sp.appearance).trim())
    .map((sp) => `- ${sp.name}: ${sp.appearance}`)
  return [
    `아래 씬들에 대해 이미지 생성 프롬프트(imagePrompt)와 비디오 생성 프롬프트(videoPrompt)를 영어로 작성하라.`,
    `캐릭터가 등장하면 외형 묘사를 프롬프트에 직접 포함해 씬 간 일관성을 유지하라 (레퍼런스 참조 문법 금지 — 플레인 텍스트).`,
    charLines.length ? `등장인물 외형(이 묘사를 일관되게 사용):\n${charLines.join('\n')}` : '',
    context.style ? `스타일: ${context.style}` : '',
    `--- 씬 목록 ---`,
    ...sceneLines,
  ].filter(Boolean).join('\n')
}
