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
  return [
    `아래 대본을 씬으로 분리하라. 각 씬은 낭독 시 6~10초(${opts.language === 'ko' ? '한국어 기준 약 33~55자' : 'about 90~150 chars in English'}) 분량이어야 한다. 초과하면 씬을 분할하라.`,
    `각 씬의 세그먼트마다 speaker(나레이션은 "narrator", 대사는 인물 식별자)와 emotion(normal/happy/sad/angry)을 지정하라.`,
    `등장 화자 전체 목록을 speakers로 반환하라.`,
    `--- 대본 ---`,
    scriptMd,
  ].join('\n')
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
