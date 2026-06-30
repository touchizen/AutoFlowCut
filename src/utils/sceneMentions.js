// src/utils/sceneMentions.js
/**
 * B1: scene ref 프롬프트의 `@이름` 토큰을 등록된 character ref 와 매칭하는 순수 함수.
 *
 * Flow 장면 생성은 컴포저에서 캐릭터를 `@멘션` 으로 참조해 인물 일관성을 얻는다(spec §1.2).
 * 멘션 토큰은 ref.name(=Flow displayName, F7)으로 표기하고, 이 함수가 프롬프트를
 * 멘션/텍스트 segment 로 쪼개 IPC 엔진의 주입 순서를 결정한다.
 *
 * 멘션 후보 precondition(F9): type==='character' + entityId + name.trim() + flowNameSyncStatus==='synced'.
 * (미동기화면 Flow 에서 그 이름으로 멘션 불가 — 후보 제외 → 일반 텍스트로 흘림.)
 *
 * @param {string} prompt
 * @param {Array<{type?:string,name?:string,entityId?:string,flowNameSyncStatus?:string}>} characterRefs
 * @returns {{hasMention:boolean, mentions:Array<{name:string,entityId:string}>, segments:Array<{type:'mention',name:string,entityId:string}|{type:'text',text:string}>}}
 */
export function parseSceneMentions(prompt, characterRefs = []) {
  const empty = { hasMention: false, mentions: [], segments: [], unresolved: [] }
  if (!prompt || typeof prompt !== 'string') return empty

  const allChars = (characterRefs || []).filter(r => r && r.type === 'character' && r.name && r.name.trim())
  // 후보 캐릭터 — 긴 이름 우선(접두 충돌 시 "회사원3" 이 "회사원" 보다 먼저 매칭).
  const eligible = allChars
    .filter(r => r.entityId && r.flowNameSyncStatus === 'synced')
    .map(r => ({ name: r.name, entityId: r.entityId }))
    .sort((a, b) => b.name.length - a.name.length)
  // 미동기화/미등록 character (멘션 의도지만 해결 불가) — 토큰경계 매칭용. 긴 이름 우선.
  const inelligibleNames = allChars
    .filter(r => !(r.entityId && r.flowNameSyncStatus === 'synced'))
    .map(r => r.name)
    .sort((a, b) => b.length - a.length)

  // P1-6: 토큰경계 — name 뒤 글자가 영숫자면 더 긴 이름의 일부이므로 부분일치를 거부한다
  //   ("회사원" 이 "@회사원3" 을 가로채지 않게).
  // 한글 조사 분리: name 뒤가 "한국어 조사"(이/가/을/를/은/는…)면 공백 없이 붙은 조사로 보고
  //   경계를 인정한다(@queen이→queen, @철수가→철수). 단, 임의의 한글이 아니라 조사 화이트리스트로
  //   제한한다 — 그렇지 않으면 synced "철수" 가 미등록 더 긴 한글이름 "@철수빈" 을 가로채(빈=조사로 오인)
  //   엉뚱한 캐릭터로 해석된다. eligible/inelligible 은 longest-first 정렬돼 있어 실제 더 긴 이름이
  //   ref 면 그게 먼저 매칭된다. mentionParser.resolveMentionPrefix 와 동일한 멘탈모델.
  // 화이트리스트는 긴 조사 우선(에게서 > 에게 > 의) — startsWith 로 가장 긴 조사부터 맞춘다.
  const PARTICLES = [
    '에게서', '에게', '한테', '으로', '로서', '로써', '까지', '부터', '처럼', '보다', '에서',
    '이', '가', '을', '를', '은', '는', '와', '과', '의', '에', '도', '만', '로',
  ].sort((a, b) => b.length - a.length)
  const isWordChar = (ch) => !!ch && /[0-9A-Za-z가-힣]/.test(ch)
  const followedByParticleBoundary = (after) => {
    for (const p of PARTICLES) {
      if (after.startsWith(p) && !isWordChar(after[p.length])) return true
    }
    return false
  }
  // 캡처한 한글 run 끝에 조사가 붙어 있으면 떼낸다(없으면 그대로). 영문/숫자 run 은 건드리지 않음.
  const stripTrailingParticle = (run) => {
    for (const p of PARTICLES) {
      if (run.length > p.length && run.endsWith(p)) return run.slice(0, run.length - p.length)
    }
    return run
  }
  const matchesAt = (rest, name) => {
    if (!rest.startsWith(name)) return false
    const next = rest[name.length]
    if (!isWordChar(next)) return true    // 깨끗한 경계(공백/구두점/끝)
    if (followedByParticleBoundary(rest.slice(name.length))) return true  // 한국어 조사가 뒤따름 → 경계 인정
    return false                          // 그 외 이름글자 연속 = 더 긴 토큰의 일부
  }

  const segments = []
  const unresolved = []
  let buf = ''
  const flushText = () => { if (buf) { segments.push({ type: 'text', text: buf }); buf = '' } }

  // 프로젝트에 character ref 가 하나라도 있으면 "@" 는 멘션 sigil 로 본다(Flow UI 와 동일 멘탈모델).
  //   그런 프로젝트에서 @토큰이 해결 안 되면(미동기화/오타/없는 이름) 조용히 텍스트로 흘리지 않고
  //   unresolved 로 보고 → plan 이 block. character ref 가 전혀 없으면 @ 는 일반 텍스트로 둔다.
  const mentionsActive = allChars.length > 0
  for (let i = 0; i < prompt.length;) {
    if (prompt[i] === '@') {
      // R5-P2: 앞 경계 = 시작 또는 "이름글자가 아님". whitespace 만 허용하면 "(@회사원3)" 같은
      //   정상 멘션이 텍스트로 떨어진다. 이메일(a@b)은 prev='a'(이름글자)라 여전히 제외.
      const prevOk = i === 0 || !isWordChar(prompt[i - 1])
      const rest = prompt.slice(i + 1)
      // R4-P2: eligible 매칭에도 prevOk 적용 — "mail a@회사원3.com" 의 단어중간 @ 가 멘션으로
      //   둔갑하지 않게(이전엔 unresolved 에만 prevOk 적용됐음).
      const hit = prevOk ? eligible.find(c => matchesAt(rest, c.name)) : null
      if (hit) {
        flushText()
        segments.push({ type: 'mention', name: hit.name, entityId: hit.entityId })
        i += 1 + hit.name.length
        continue
      }
      // P1-5/P2: 멘션 시도(@ 가 경계 + 다음이 이름글자)인데 해결 안 되면 unresolved 로 보고.
      //   기존 이름 매칭(stale) 우선, 아니면 @ 뒤 이름글자 run 을 시도 토큰으로.
      if (mentionsActive && prevOk && isWordChar(rest[0])) {
        const stale = inelligibleNames.find(n => matchesAt(rest, n))
        const run = (rest.match(/^[0-9A-Za-z가-힣]+/) || [''])[0]
        // run 끝에 조사가 붙어 있으면 떼서 보고(@철수빈이 → 철수빈). @queen이→queen 과 동일 멘탈모델.
        const attempted = stale || stripTrailingParticle(run)
        if (attempted && !unresolved.some(u => u.name === attempted)) unresolved.push({ name: attempted })
      }
    }
    buf += prompt[i]
    i++
  }
  flushText()

  const mentionSegs = segments.filter(s => s.type === 'mention')
  // mentions: 첫 등장 순서 보존 + 중복 제거(entityId 기준).
  const seen = new Set()
  const mentions = []
  for (const m of mentionSegs) {
    if (seen.has(m.entityId)) continue
    seen.add(m.entityId)
    mentions.push({ name: m.name, entityId: m.entityId })
  }

  return { hasMention: mentionSegs.length > 0, mentions, segments, unresolved }
}
