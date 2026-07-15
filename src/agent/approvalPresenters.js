function pointerToken(value) {
  return String(value).replace(/~/g, '~0').replace(/\//g, '~1')
}

const expectedTypes = (...types) => Object.freeze(types)
const decision = (described, passthrough = [], types = {}, required = []) => Object.freeze({
  described: Object.freeze(described),
  passthrough: Object.freeze(passthrough),
  types: Object.freeze(Object.fromEntries(Object.entries(types)
    .map(([key, value]) => [key, Object.freeze(value)]))),
  required: Object.freeze(required),
})

/**
 * 스키마 키를 추가할 때 "문장으로 설명할지, raw로 넘길지"를 먼저 결정하게 만드는 목록이다.
 * 테스트가 Tool Core의 실제 inputSchema와 직접 비교하므로 여기에 없는 새 키는 출하되지 않는다.
 */
export const APPROVAL_KEY_DECISIONS = Object.freeze({
  story_set_speakers: Object.freeze({
    root: decision(['speakers'], [], { speakers: expectedTypes('array') }, ['speakers']),
    speaker: decision(
      ['id', 'name', 'voice', 'role', 'gender', 'age', 'appearance'],
      [],
      {
        id: expectedTypes('string'), name: expectedTypes('string'), voice: expectedTypes('object', 'null'),
        role: expectedTypes('string'), gender: expectedTypes('string'), age: expectedTypes('string'),
        appearance: expectedTypes('string'),
      },
      ['id', 'name'],
    ),
    voice: decision(
      ['provider', 'voiceId'],
      [],
      { provider: expectedTypes('string'), voiceId: expectedTypes('string') },
      ['provider', 'voiceId'],
    ),
  }),
  story_confirm_synopsis: Object.freeze({
    root: decision(
      ['synopsisMd', 'characters'],
      ['sceneMode', 'imageFirstVariant', 'fixedSceneRevision'],
      { synopsisMd: expectedTypes('string'), characters: expectedTypes('array') },
    ),
    character: decision(
      ['id', 'name', 'gender', 'age', 'role', 'ethnicity', 'appearance'],
      [],
      {
        id: expectedTypes('string'), name: expectedTypes('string'), gender: expectedTypes('string'),
        age: expectedTypes('string'), role: expectedTypes('string'), ethnicity: expectedTypes('string'),
        appearance: expectedTypes('string'),
      },
      ['name'],
    ),
  }),
  story_start_step: Object.freeze({
    root: decision(
      ['step', 'params'],
      [],
      { step: expectedTypes('string'), params: expectedTypes('object') },
      ['step'],
    ),
    params: Object.freeze({
      script: decision(
        ['reviewOnly', 'scriptOverride', 'continue', 'pastedScript', 'synopsis', 'title'],
        ['options', 'review'],
        {
          reviewOnly: expectedTypes('boolean'), scriptOverride: expectedTypes('string'),
          continue: expectedTypes('string'), pastedScript: expectedTypes('string'), synopsis: expectedTypes('string'),
          title: expectedTypes('string'),
        },
      ),
      scenes: decision(
        ['reviewOnly', 'scriptOverride', 'title'],
        ['options', 'review'],
        {
          reviewOnly: expectedTypes('boolean'), scriptOverride: expectedTypes('string'), title: expectedTypes('string'),
        },
      ),
      audio: decision(
        ['regenerate', 'sfxSources'],
        [],
        { regenerate: expectedTypes('array'), sfxSources: expectedTypes('object') },
      ),
      prompts: decision(
        ['reviewOnly', 'style'],
        ['options', 'review'],
        { reviewOnly: expectedTypes('boolean'), style: expectedTypes('string') },
      ),
    }),
  }),
  update_visual_review: Object.freeze({
    root: decision(
      ['sceneNumbers', 'status', 'reason'],
      [],
      {
        sceneNumbers: expectedTypes('array'),
        status: expectedTypes('string'),
        reason: expectedTypes('string'),
      },
      ['sceneNumbers'],
    ),
  }),
  export_capcut: Object.freeze({
    root: decision(['force'], [], { force: expectedTypes('boolean') }),
  }),
  export_premiere: Object.freeze({
    root: decision(['force'], [], { force: expectedTypes('boolean') }),
  }),
})

/**
 * args의 모든 leaf JSON path. 빈 배열/빈 객체도 "아무 값도 없음"이라는 값이라 leaf로 센다.
 * @returns {string[]}
 */
export function leafPaths(value) {
  const paths = []

  function visit(node, path) {
    if (node === null || typeof node !== 'object') {
      paths.push(path)
      return
    }

    const entries = Array.isArray(node)
      ? node.map((item, index) => [index, item])
      : Object.entries(node)
    if (!entries.length) {
      paths.push(path)
      return
    }

    for (const [key, child] of entries) visit(child, `${path}/${pointerToken(key)}`)
  }

  visit(value, '')
  return paths
}

/**
 * 선언 path는 그 subtree만 설명한 것으로 친다. 형제까지 숨기면 미래 인자가 화면에서 사라진다.
 * @returns {string[]}
 */
export function residualPaths(args, coveredPaths = []) {
  return leafPaths(args).filter((leaf) => !coveredPaths.some((covered) => (
    covered === '' || leaf === covered || leaf.startsWith(`${covered}/`)
  )))
}

const hasOwn = (value, key) => value !== null && typeof value === 'object' && Object.hasOwn(value, key)
const isPlainObject = (value) => value !== null && typeof value === 'object' && !Array.isArray(value)
const valueType = (value) => {
  if (value === null) return 'null'
  if (Array.isArray(value)) return 'array'
  return typeof value
}
const displayValue = (value) => {
  if (value === '') return '""'
  return value !== null && typeof value === 'object' ? JSON.stringify(value) : String(value)
}
const quotedValue = (value) => `"${value === '' ? '' : displayValue(value)}"`
const LONG_VALUE_LENGTH = 160
const needsBlock = (value) => typeof value === 'string'
  && (value.includes('\n') || value.includes('\r') || value.length > LONG_VALUE_LENGTH)

function matchesDecision(value, node) {
  if (!isPlainObject(value)) return false
  if (node.required.some((key) => !hasOwn(value, key))) return false
  return node.described.every((key) => !hasOwn(value, key)
    || node.types[key]?.includes(valueType(value[key])))
}

function addRawBlock(presentation, { label, path, text }) {
  presentation.blocks.push({ label, path, text })
}

function addRosterValue(presentation, fields, paths, { label, path, value, blockLabel }) {
  if (needsBlock(value)) {
    addRawBlock(presentation, { label: blockLabel, path, text: value })
    return
  }
  fields.push(`${label}: ${displayValue(value)}`)
  paths.push(path)
}

function describedObjectLine({ presentation, value, basePath, decisionNode, t, translationKey, index, entryLabel }) {
  const fields = []
  const paths = []
  const identity = []
  const identityPaths = []

  for (const key of ['name', 'id']) {
    if (!hasOwn(value, key)) continue
    const path = `${basePath}/${key}`
    if (needsBlock(value[key])) {
      addRawBlock(presentation, {
        label: t('agent.approvalRosterFieldBlock', { entry: entryLabel, index, field: t(`agent.approvalField.${key}`) }),
        path,
        text: value[key],
      })
    } else {
      identity.push(displayValue(value[key]))
      identityPaths.push(path)
    }
  }
  let identityText = identity[0] ?? ''
  if (identity.length > 1) identityText = `${identity[0]} (${identity[1]})`
  paths.push(...identityPaths)

  for (const key of decisionNode.described) {
    if (key === 'id' || key === 'name') continue
    if (!hasOwn(value, key)) continue
    if (key === 'voice' && value.voice !== null) {
      const provider = value.voice.provider
      const voiceId = value.voice.voiceId
      const providerPath = `${basePath}/voice/provider`
      const voiceIdPath = `${basePath}/voice/voiceId`
      if (!needsBlock(provider) && !needsBlock(voiceId)) {
        fields.push(`${t('agent.approvalField.voice')}: ${displayValue(provider)} / ${displayValue(voiceId)}`)
        paths.push(providerPath, voiceIdPath)
      } else {
        addRosterValue(presentation, fields, paths, {
          label: t('agent.approvalField.voiceProvider'), path: providerPath, value: provider,
          blockLabel: t('agent.approvalRosterFieldBlock', { entry: entryLabel, index, field: t('agent.approvalField.voiceProvider') }),
        })
        addRosterValue(presentation, fields, paths, {
          label: t('agent.approvalField.voiceId'), path: voiceIdPath, value: voiceId,
          blockLabel: t('agent.approvalRosterFieldBlock', { entry: entryLabel, index, field: t('agent.approvalField.voiceId') }),
        })
      }
    } else {
      addRosterValue(presentation, fields, paths, {
        label: t(`agent.approvalField.${key}`),
        path: `${basePath}/${pointerToken(key)}`,
        value: value[key],
        blockLabel: t('agent.approvalRosterFieldBlock', { entry: entryLabel, index, field: t(`agent.approvalField.${key}`) }),
      })
    }
  }

  if (!identityText && !fields.length) return null
  return {
    text: t(translationKey, {
      index,
      identity: identityText ? `: ${identityText}` : '',
      details: fields.length ? ` — ${fields.join(' · ')}` : '',
    }),
    paths,
  }
}

function presentSetSpeakers(args, t) {
  const presentation = { lines: [], blocks: [] }
  const speakers = args.speakers

  // stepMachine.js mergeSpeakers + setSpeakers — 기존 항목을 base로 병합하고 누락 항목은 보존한다.
  // 🔴 headline 이다 — 경고보다 **무엇을 하는지**가 먼저 와야 한다 (start_step 과 같은 계약).
  presentation.lines.push({
    text: t('agent.approvalMergeSpeakers', {
      count: speakers.length,
      empty: speakers.length ? '' : '([])',
    }),
    paths: speakers.length ? [] : ['/speakers'],
    headline: true,
  })
  // stepMachine.js setSpeakers roster-incomplete guard — 요청 명단이 씬 참조 화자를 빠뜨리면 merge 전에 거부한다.
  presentation.lines.push({ text: t('agent.approvalRosterIncomplete'), paths: [] })
  // stepMachine.js mergeSpeakers 두 분기 — 기존 구조화 필드/외모 보존은 공통이고, rosterEnforced면 이름/신규 화자도 제한한다.
  presentation.lines.push({ text: t('agent.approvalConfirmedRosterSpeakerLimits'), paths: [], danger: true })
  speakers.forEach((speaker, index) => {
    // stepMachine.js mergeSpeakers input loop — 실제 제출된 speaker/voice 필드만 verbatim 노출한다.
    const line = describedObjectLine({
      presentation,
      value: speaker,
      basePath: `/speakers/${index}`,
      decisionNode: APPROVAL_KEY_DECISIONS.story_set_speakers.speaker,
      t,
      translationKey: 'agent.approvalSpeakerEntry',
      index: index + 1,
      entryLabel: t('agent.approvalSpeakerNoun'),
    })
    if (line) presentation.lines.push(line)
  })
  return presentation
}

function presentConfirmSynopsis(args, t) {
  const lines = []
  const blocks = []
  const characters = args && !hasOwn(args, 'characters') ? [] : args?.characters

  if (Array.isArray(characters)) {
    // stepMachine.js speakersFromCharacters + confirmSynopsis — 중복/narrator를 제외해 새 roster를 만들고 전체 대입한다.
    lines.push({
      text: t('agent.approvalReplaceCharacters', {
        count: characters.length,
        empty: characters.length ? '' : '([])',
      }),
      paths: hasOwn(args, 'characters') && !characters.length ? ['/characters'] : [],
      danger: true,
    })
    characters.forEach((character, index) => {
      // stepMachine.js speakersFromCharacters — normalizeStoryCharacter가 소비하는 제출 필드를 빠짐없이 그대로 보여준다.
      const line = describedObjectLine({
        presentation: { lines, blocks },
        value: character,
        basePath: `/characters/${index}`,
        decisionNode: APPROVAL_KEY_DECISIONS.story_confirm_synopsis.character,
        t,
        translationKey: 'agent.approvalCharacterEntry',
        index: index + 1,
        entryLabel: t('agent.approvalCharacterNoun'),
      })
      if (line) lines.push(line)
    })
  }

  if (typeof args?.synopsisMd === 'string') {
    if (args.synopsisMd.trim()) {
      // stepMachine.js confirmSynopsis synopsisMd save guard — 공백이 아닌 값만 synopsis.md 정본을 덮어쓴다.
      lines.push({ text: t('agent.approvalOverwriteSynopsis'), paths: [], danger: true })
      blocks.push({ label: t('agent.approvalSynopsisBlock'), path: '/synopsisMd', text: args.synopsisMd })
    } else {
      // stepMachine.js confirmSynopsis synopsisMd save guard — 빈 문자열은 저장하지 않고 값은 그대로 남긴다.
      if (needsBlock(args.synopsisMd)) {
        lines.push({ text: t('agent.approvalKeepSynopsisBlock'), paths: [] })
        blocks.push({ label: t('agent.approvalSynopsisRawBlock'), path: '/synopsisMd', text: args.synopsisMd })
      } else {
        lines.push({
          text: t('agent.approvalKeepSynopsis', { value: quotedValue(args.synopsisMd) }),
          paths: ['/synopsisMd'],
        })
      }
    }
  }

  // stepMachine.js confirmSynopsis finalization — 성공한 확정은 charactersConfirmed를 세우고 renderer gate를 갱신한다.
  lines.push({ text: t('agent.approvalOpenNextSteps'), paths: [] })
  return { lines, blocks }
}

export const APPROVAL_DOWNSTREAM = Object.freeze({
  script: Object.freeze(['scenes', 'audio', 'prompts']),
  scenes: Object.freeze(['audio', 'prompts']),
  audio: Object.freeze(['prompts']),
  prompts: Object.freeze([]),
})
const DOWNSTREAM = APPROVAL_DOWNSTREAM

function presentStartParam(presentation, params, key, t, { ignored = false } = {}) {
  if (!hasOwn(params, key)) return
  // stepMachine.js steps dispatch branches — 실제 전달값을 효과로 확대 해석하지 않고 verbatim 노출한다.
  const path = `/params/${pointerToken(key)}`
  if (needsBlock(params[key])) {
    presentation.lines.push({
      text: t(ignored ? 'agent.approvalStepParamIgnoredBlock' : 'agent.approvalStepParamBlock', { key }),
      paths: [],
    })
    presentation.blocks.push({ label: t('agent.approvalArgumentBlock', { key }), path, text: params[key] })
  } else {
    presentation.lines.push({
      text: t(ignored ? 'agent.approvalStepParamIgnored' : 'agent.approvalStepParam', {
        key,
        value: quotedValue(params[key]),
      }),
      paths: [path],
    })
  }
}

function presentDangerParam(presentation, params, key, t, translationKey) {
  const path = `/params/${pointerToken(key)}`
  if (needsBlock(params[key])) {
    presentation.lines.push({ text: t(`${translationKey}Block`), paths: [], danger: true })
    presentation.blocks.push({ label: t('agent.approvalArgumentBlock', { key }), path, text: params[key] })
  } else {
    presentation.lines.push({
      text: t(translationKey, { value: quotedValue(params[key]) }),
      paths: [path],
      danger: true,
    })
  }
}

function presentPastedInputReplacement(presentation, params, t) {
  // stepMachine.js steps.script pastedScript branch — state.input을 wholesale 교체하므로 두 필드를 독립적으로 설명한다.
  if (hasOwn(params, 'title')) {
    presentDangerParam(presentation, params, 'title', t, 'agent.approvalPasteReplacesTitle')
  } else {
    presentation.lines.push({ text: t('agent.approvalPasteClearsTitle'), paths: [], danger: true })
  }

  if (hasOwn(params, 'options')) {
    presentation.lines.push({
      text: t('agent.approvalPasteReplacesOptions', { value: displayValue(params.options) }),
      paths: ['/params/options'],
      danger: true,
    })
  } else {
    presentation.lines.push({ text: t('agent.approvalPasteClearsOptions'), paths: [], danger: true })
  }
}

function presentScriptParams(presentation, params, t, knownParams) {
  const reviewOnly = params.reviewOnly === true
  const nonBlankReviewOverride = reviewOnly && typeof params.scriptOverride === 'string'
    && Boolean(params.scriptOverride.trim())
  const invalidBlankReviewOverride = reviewOnly && hasOwn(params, 'scriptOverride')
    && typeof params.scriptOverride === 'string' && !params.scriptOverride.trim()
  const continues = !reviewOnly && Boolean(params.continue)
  const pastes = !reviewOnly && !continues && Boolean(params.pastedScript)
  const generates = !reviewOnly && !continues && !pastes
  const isIgnored = (key) => {
    if (key === 'scriptOverride') return !reviewOnly
    if (key === 'continue') return !continues
    if (key === 'pastedScript') return !pastes
    if (key === 'synopsis') return !generates
    if (key === 'title') return !pastes
    return false
  }

  for (const key of knownParams.described) {
    if (!hasOwn(params, key)) continue
    if (key === 'title' && pastes) continue
    if (key === 'continue' && continues) {
      // stepMachine.js steps.script continue branch — 외부 LLM의 이어쓰기 결과 전체로 script.md를 덮어쓴다.
      presentDangerParam(presentation, params, key, t, 'agent.approvalContinueScript')
    } else if (key === 'pastedScript' && pastes) {
      // stepMachine.js steps.script pastedScript branch — truthy pastedScript를 그대로 script.md에 저장한다.
      presentDangerParam(presentation, params, key, t, 'agent.approvalOverwriteScriptWithPaste')
    } else if (key === 'synopsis' && generates && typeof params.synopsis === 'string' && params.synopsis.trim()) {
      // stepMachine.js steps.script generation synopsis branch — nonblank synopsis를 synopsis.md에 먼저 저장한다.
      presentDangerParam(presentation, params, key, t, 'agent.approvalOverwriteSynopsisParam')
    } else if (key === 'scriptOverride' && nonBlankReviewOverride) {
      // stepMachine.js steps.script reviewOnly branch — 후보가 저장본과 다르면 review 결과와 무관하게 changed가 true다.
      presentDangerParam(presentation, params, key, t, 'agent.approvalReviewScriptOverride')
    } else {
      presentStartParam(presentation, params, key, t, { ignored: isIgnored(key) })
    }
  }

  if (pastes) {
    presentPastedInputReplacement(presentation, params, t)
    // stepMachine.js steps.script pastedScript branch + start unconfirmed gates — 확정 마커를 되감아 하류 실행을 막는다.
    presentation.lines.push({ text: t('agent.approvalPasteResetsConfirmation'), paths: [], danger: true })
  }

  if (reviewOnly && !invalidBlankReviewOverride) {
    // stepMachine.js steps.script reviewOnly branch — 후보가 없을 때만 review 변경이 유일한 저장 조건이다.
    presentation.lines.push({
      text: t(nonBlankReviewOverride ? 'agent.approvalReviewScriptWithOverride' : 'agent.approvalReviewScript'),
      paths: [],
      danger: true,
    })
  } else if (generates) {
    // stepMachine.js steps.script generation branch — 새 대본을 외부 LLM으로 생성하고 script.md 정본을 저장한다.
    presentation.lines.push({ text: t('agent.approvalGenerateScript'), paths: [], danger: true })
  }
}

function presentScenesParams(presentation, params, t, knownParams) {
  const reviewOnly = params.reviewOnly === true
  const invalidBlankOverride = !reviewOnly && hasOwn(params, 'scriptOverride')
    && typeof params.scriptOverride === 'string' && !params.scriptOverride.trim()
  const nonBlankOverride = !reviewOnly && typeof params.scriptOverride === 'string'
    && Boolean(params.scriptOverride.trim())
  const isIgnored = (key) => {
    if (key === 'scriptOverride') return reviewOnly
    if (key === 'title') return reviewOnly || !nonBlankOverride || !params.title
    return false
  }
  for (const key of knownParams.described) {
    if (!hasOwn(params, key)) continue
    if (key === 'scriptOverride' && !reviewOnly
      && typeof params.scriptOverride === 'string' && params.scriptOverride.trim()) {
      // stepMachine.js steps.scenes scriptOverride branch — nonblank 대본을 script.md에 저장한 뒤 씬 분리를 시작한다.
      presentDangerParam(presentation, params, key, t, 'agent.approvalOverwriteScriptBeforeScenes')
    } else {
      presentStartParam(presentation, params, key, t, { ignored: isIgnored(key) })
    }
  }

  if (reviewOnly) {
    // stepMachine.js steps.scenes reviewOnly branch — 검수 변경 또는 rosterEnforced 재기록이 scenes.json을 저장한다.
    presentation.lines.push({ text: t('agent.approvalReviewScenes'), paths: [], danger: true })
  } else if (!invalidBlankOverride) {
    // stepMachine.js steps.scenes generation branch — 외부 LLM으로 씬을 다시 나누고 scenes.json 정본을 저장한다.
    presentation.lines.push({ text: t('agent.approvalGenerateScenes'), paths: [], danger: true })
  }
  // stepMachine.js steps.scenes save paths — 생성은 항상, 검수는 changed가 true일 때 state.speakers도 갱신한다.
  if (reviewOnly || !invalidBlankOverride) {
    presentation.lines.push({ text: t('agent.approvalScenesSpeakers'), paths: [], danger: true })
  }
}

function presentAudioParams(presentation, params, t) {
  // stepMachine.js steps.audio synthesis queue — 캐시를 못 쓰고 합성까지 진행한 narration/SFX만 외부 provider를 호출한다.
  presentation.lines.push({ text: t('agent.approvalAudioCost'), paths: [], danger: true })
  // stepMachine.js steps.audio non-timingOnly regroup — 씬 객체 재구성 뒤 프롬프트를 재병합하지 않아 정본 내용이 소실될 수 있다.
  presentation.lines.push({ text: t('agent.approvalAudioSceneRewrite'), paths: [], danger: true })

  if (Array.isArray(params.regenerate)) {
    // stepMachine.js steps.audio force-regenerate set — 지정 id는 narration과 SFX 모두 캐시 재사용을 강제로 막는다.
    const uniqueCount = new Set(params.regenerate).size
    const inlineIds = []
    const inlinePaths = []
    params.regenerate.forEach((id, index) => {
      const path = `/params/regenerate/${index}`
      if (needsBlock(id)) {
        presentation.blocks.push({
          label: t('agent.approvalRegenerateIdBlock', { index: index + 1 }), path, text: id,
        })
      } else {
        inlineIds.push(quotedValue(id))
        inlinePaths.push(path)
      }
    })
    presentation.lines.push({
      text: t(uniqueCount === params.regenerate.length
        ? 'agent.approvalForceRegenerate'
        : 'agent.approvalForceRegenerateDuplicates', {
        uniqueCount,
        inputCount: params.regenerate.length,
        ids: params.regenerate.length ? inlineIds.join(', ') : '[]',
      }),
      paths: params.regenerate.length ? inlinePaths : ['/params/regenerate'],
      danger: true,
    })
    // stepMachine.js steps.audio cache eligibility + synthesis queues — 지정 밖 세그먼트도 검증 실패면 합성 큐에 들어간다.
    presentation.lines.push({ text: t('agent.approvalAudioReuse'), paths: [], danger: true })
  }

  if (params.sfxSources && typeof params.sfxSources === 'object' && !Array.isArray(params.sfxSources)) {
    const entries = Object.entries(params.sfxSources)
    if (!entries.length) {
      // stepMachine.js steps.audio sfxSources lookup — 빈 override 객체도 실제 전달된 sfxSources 값 그대로다.
      presentation.lines.push({
        text: t('agent.approvalStepParam', { key: 'sfxSources', value: '"{}"' }),
        paths: ['/params/sfxSources'],
      })
    } else {
      for (const [segmentId, source] of entries) {
        // stepMachine.js steps.audio SFX provider routing — segment별 source override가 실제 provider 선택에 쓰인다.
        presentation.lines.push({
          text: t('agent.approvalSfxSource', { id: segmentId, source: quotedValue(source) }),
          paths: [`/params/sfxSources/${pointerToken(segmentId)}`],
        })
      }
    }
  }
}

function presentPromptsParams(presentation, params, t, knownParams) {
  for (const key of knownParams.described) presentStartParam(presentation, params, key, t)
  if (params.reviewOnly === true) {
    // stepMachine.js steps.prompts image-first early branch — 고정 산출물을 저장하고 reviewOnly를 소비하지 않는다.
    presentation.lines.push({ text: t('agent.approvalReviewPrompts'), paths: [], danger: true })
  } else {
    // stepMachine.js steps.prompts image-first + normal branches — 모드에 따라 고정 산출물 저장 또는 LLM 재작성을 한다.
    presentation.lines.push({ text: t('agent.approvalGeneratePrompts'), paths: [], danger: true })
  }
}

export function presentStartStep(args, t) {
  const presentation = { lines: [], blocks: [] }
  const { lines } = presentation
  const step = args.step

  const knownParams = APPROVAL_KEY_DECISIONS.story_start_step.params[step]
  if (!knownParams) return null

  // stepMachine.js start + steps dispatch — 검증을 통과한 지정 step을 running으로 바꾸고 해당 함수를 호출한다.
  lines.push({ text: t('agent.approvalStartStep', { step }), paths: ['/step'], headline: true })
  const suppliedParams = args?.params
  const params = suppliedParams && typeof suppliedParams === 'object' && !Array.isArray(suppliedParams)
    ? suppliedParams
    : (!hasOwn(args, 'params') ? {} : null)
  if (params) {
    if (!Object.keys(params).length) {
      if (hasOwn(args, 'params')) {
        // stepMachine.js start(step, params = {}) — 기본값과 같아도 path는 실제로 제출된 경우에만 선언한다.
        lines.push({
          text: t('agent.approvalStepParam', { key: 'params', value: '{}' }),
          paths: ['/params'],
        })
      }
      if (step === 'audio') presentAudioParams(presentation, params, t)
      else if (step === 'script') presentScriptParams(presentation, params, t, knownParams)
      else if (step === 'scenes') presentScenesParams(presentation, params, t, knownParams)
      else if (step === 'prompts') presentPromptsParams(presentation, params, t, knownParams)
      else return null
    } else if (step === 'audio') {
      presentAudioParams(presentation, params, t)
    } else if (step === 'script') {
      presentScriptParams(presentation, params, t, knownParams)
    } else if (step === 'scenes') {
      presentScenesParams(presentation, params, t, knownParams)
    } else if (step === 'prompts') {
      presentPromptsParams(presentation, params, t, knownParams)
    } else {
      return null
    }

    const downstream = DOWNSTREAM[step]
    const downstreamLabels = downstream.map((name) => t(`story.step.${name}`)).join(', ')
    if (downstream.length) {
      if (params.reviewOnly === true) {
        const scriptCandidateMayReplaceStored = step === 'script'
          && typeof params.scriptOverride === 'string' && Boolean(params.scriptOverride.trim())
        // stepMachine.js steps.script reviewOnly + start deferred reset — 후보 차이도 changed라 하류를 pending으로 만든다.
        lines.push({
          text: t(step === 'scenes'
            ? 'agent.approvalReviewDownstreamReset'
            : scriptCandidateMayReplaceStored
              ? 'agent.approvalReviewScriptOverrideDownstreamReset'
              : 'agent.approvalReviewChangedDownstreamReset', { steps: downstreamLabels }),
          paths: [],
          danger: true,
        })
      } else {
        // stepMachine.js start eager downstream reset — reviewOnly가 아니면 실행 전에 모든 하류 상태를 pending으로 바꾼다.
        lines.push({
          text: t('agent.approvalDownstreamReset', { steps: downstreamLabels }),
          paths: [],
          danger: true,
        })
      }
    }
  }
  return presentation
}

function presentUpdateVisualReview(args, t) {
  const lines = []
  const sceneNumbers = args.sceneNumbers
  // status 생략 시 tool 은 reject 로 기록한다 — 승인창도 그 기본을 그대로 보여 준다.
  const status = hasOwn(args, 'status') ? args.status : 'rejected'
  // status 를 실제로 넘겼을 때만 path 를 선언한다 (없는 키를 덮은 척하면 유령 path 다).
  const paths = hasOwn(args, 'status') ? ['/sceneNumbers', '/status'] : ['/sceneNumbers']
  // 🔴 headline — 경고보다 "무엇을 하는지"가 먼저다.
  lines.push({
    text: t('agent.approvalVisualReview', { ordinals: sceneNumbers.join(', '), status }),
    paths,
    headline: true,
  })
  if (hasOwn(args, 'reason')) {
    lines.push({ text: t('agent.approvalVisualReviewReason', { reason: args.reason }), paths: ['/reason'] })
  }
  // danger — 프로젝트에 지속되는 상태를 남긴다.
  lines.push({ text: t('agent.approvalVisualReviewPersist'), paths: [], danger: true })
  return { lines, blocks: [] }
}

function presentExport(args, t, format) {
  const lines = []
  // headline — 어떤 도구로 내보내는지.
  lines.push({
    text: t(format === 'capcut' ? 'agent.approvalExportCapcut' : 'agent.approvalExportPremiere'),
    paths: [],
    headline: true,
  })
  if (hasOwn(args, 'force')) {
    // force=true 는 배치 실행 중에도 강제 export 다 — 사람이 반드시 봐야 할 결정.
    lines.push({
      text: t('agent.approvalExportForce', { force: String(args.force) }),
      paths: ['/force'],
      danger: args.force === true,
    })
  }
  return { lines, blocks: [] }
}

/**
 * tool/args만으로 승인 문장을 만드는 순수 함수. 모르는 툴은 fail-closed UI가 처리하도록 null을 준다.
 * @returns {null|{lines: Array<{text:string, paths:string[], danger?:boolean}>, blocks: Array<{label:string, path:string, text:string}>}}
 */
export function presentApproval(tool, args, t) {
  const toolDecision = APPROVAL_KEY_DECISIONS[tool]
  if (!toolDecision || !matchesDecision(args, toolDecision.root)) return null
  if (tool === 'story_set_speakers') {
    if (!args.speakers.every((speaker) => matchesDecision(speaker, toolDecision.speaker)
      && (!hasOwn(speaker, 'voice') || speaker.voice === null || matchesDecision(speaker.voice, toolDecision.voice)))) return null
    return presentSetSpeakers(args, t)
  }
  if (tool === 'story_confirm_synopsis') {
    const characters = hasOwn(args, 'characters') ? args.characters : []
    if (!characters.every((character) => matchesDecision(character, toolDecision.character))) return null
    return presentConfirmSynopsis(args, t)
  }
  if (tool === 'story_start_step') {
    const paramsDecision = toolDecision.params[args.step]
    if (!paramsDecision) return null
    const params = hasOwn(args, 'params') ? args.params : {}
    if (!matchesDecision(params, paramsDecision)) return null
    return presentStartStep(args, t)
  }
  if (tool === 'update_visual_review') {
    return presentUpdateVisualReview(args, t)
  }
  if (tool === 'export_capcut') return presentExport(args, t, 'capcut')
  if (tool === 'export_premiere') return presentExport(args, t, 'premiere')
  return null
}
