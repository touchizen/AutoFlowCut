/** 프롬프트 빌더 — Gemini/Claude 두 엔진 공유. (구 llmGemini.js 내부 빌더 이관) */

export function buildScriptPrompt(input, opts) {
  const meta = opts.metaPrompt ? `## CUSTOM INSTRUCTIONS\n${opts.metaPrompt}\n` : ''
  const n = opts.lengthValue || 10
  const unit = opts.lengthUnit || 'min'
  const lengthText =
    unit === 'chars' ? `약 ${n}자` :
    unit === 'words' ? `about ${n} words` :
    `약 ${n}분`
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
    // M2b: 효과음 큐를 세그먼트 단위로 삽입. 단어 단위(문장 내부) 금지 — 시퀀스의 한 자리를 차지한다.
    `대본 흐름상 효과음(문 여는 소리·천둥·발소리·비명 등)이 꼭 필요한 지점에는 그 자리에 { "type": "sfx", "description": "..." } 세그먼트를 삽입하라. description은 효과음을 생성할 짧은 영어 묘사(예: "door creaking open", "distant thunder")로 쓴다. sfx 세그먼트에는 speaker/text/emotion을 넣지 않는다. 나레이션/대사 세그먼트는 type을 생략해도 된다(기본 narration).`,
    `효과음은 꼭 필요한 순간(장면 전환·긴장·중요한 사건)에만 절제해서 넣어라 — 과도하게 넣으면 흐름을 해친다.`,
    `등장 화자 전체 목록을 speakers로 반환하라.`,
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

export function buildPromptsPrompt(scenes, context, opts) {
  const sceneLines = scenes.map((s) => `${s.sceneNo}. ${s.summary} :: ${(s.segments || []).map((g) => g.text).join(' ')}`)
  return [
    `아래 씬들에 대해 이미지 생성 프롬프트(imagePrompt)와 비디오 생성 프롬프트(videoPrompt)를 영어로 작성하라.`,
    `캐릭터가 등장하면 외형 묘사를 프롬프트에 직접 포함해 씬 간 일관성을 유지하라 (레퍼런스 참조 문법 금지 — 플레인 텍스트).`,
    context.style ? `스타일: ${context.style}` : '',
    `--- 씬 목록 ---`,
    ...sceneLines,
  ].filter(Boolean).join('\n')
}
