/**
 * 화자별 오디오 출처 — 성우 TTS로 만드는 대신, 이미 있는 (mp3, SRT) 짝에서 그 화자의 대사
 * 구간을 찾아 잘라 쓴다.
 *
 *   speaker.voice = { provider: 'typecast', voiceId: 'tc_x' }   → ⑤가 TTS로 생성
 *   speaker.voice = { provider: 'import', mp3Path, srtPath }    → ⑤가 이 파일에서 잘라 씀
 *
 * 나레이터든 등장인물이든 똑같이 적용된다 — 화자마다 자기 mp3/SRT를 가질 수 있다.
 *
 * ── 파이프라인 어디에도 안 끼어든다 ──
 * ④ 씬 분리는 평소대로 LLM이 한다(인물·SFX·감정 전부 그대로). 이 모듈은 ⑤가 "이 세그먼트는
 * 그 mp3의 몇 초~몇 초"를 알아내게 해줄 뿐이다. 그래서 출처가 없는 화자는 기존 TTS 경로가
 * 그대로 돌고, SFX도 평소대로 생성된다.
 *
 * 한때 "SRT 큐 = 세그먼트, 전부 narrator"로 만들었다가 폐기했다. 소스 오디오가 전부 나레이터
 * 낭독이라는 사실을 근거로 삼았지만, 그러면 인물 목소리와 SFX가 통째로 사라진다 — 기존
 * 파이프라인이 주던 것을 빼앗는 설계였다.
 *
 * ── 정렬 ──
 * 큐 텍스트와 대본은 같은 원본에서 나왔다(무한야담2 실측: 큐 375개가 ep02 대본에 100% 순서대로
 * 존재). 그래서 구두점/공백을 없앤 문자 스트림 위에서 세그먼트를 순서대로 훑으면 결정론적으로
 * 위치가 잡힌다. 시간은 큐 구간 안에서 문자 비율로 보간한다.
 *
 * ── 나레이터 mp3가 인물 대사까지 읽은 경우 ──
 * 무한야담2.mp3 실측: 대사 구간과 나레이션 구간의 F0가 138~144Hz로 동일 — 여성 인물 대사도
 * 나레이터 목소리다. 그 자리의 mp3 오디오는 **쓰지 않고 버리고** 인물 TTS가 채운다. 앱의 메인
 * 임포트 플로우가 나레이션에 구멍을 뚫고 인물 목소리를 끼워 넣는 것과 같은 모델이다.
 */

// src/utils/parsers.js에도 SRT 파서(parseSRTBlocks)가 있지만 그건 renderer용이라
// DEFAULTS(style_presets.json)와 csvParser를 함께 끌고 온다 — main process가 자막 시간을
// 읽자고 스타일 프리셋을 로드할 이유는 없다. 파싱 규칙(아래)만 같게 유지한다.
const SRT_TIME_RE = /(\d{1,2}:\d{2}:\d{2}[,.]\d{1,3})\s*-->\s*(\d{1,2}:\d{2}:\d{2}[,.]\d{1,3})/

/** "00:01:02,345" → ms */
function srtTimeToMs(s) {
  const [hms, frac = '0'] = s.replace(',', '.').split('.')
  const [h, m, sec] = hms.split(':').map(Number)
  return (h * 3600 + m * 60 + sec) * 1000 + Math.round(Number(`0.${frac}`) * 1000)
}

/**
 * SRT 텍스트 → 큐 목록.
 *   - BOM 제거: 없으면 첫 블록 인덱스 줄이 "﻿1"이 되어 깨진다.
 *   - CRLF/CR → LF: Windows SRT의 블록 구분자는 "\r\n\r\n"이라 /\n\n/로는 안 걸려
 *     파일 전체가 블록 하나가 된다.
 *   - 인덱스 줄 유무에 의존하지 않고 타임코드 줄을 *찾아서* 기준으로 삼는다(도구마다 다르다).
 * 빈 텍스트·역전 구간은 버린다.
 * @returns {Array<{index:number, startMs:number, endMs:number, text:string}>}
 */
export function parseSrtCues(srtText) {
  const normalized = String(srtText || '').replace(/^﻿/, '').replace(/\r\n?/g, '\n')
  const out = []
  for (const block of normalized.trim().split(/\n\s*\n+/)) {
    const lines = block.split('\n').map((l) => l.trim()).filter(Boolean)
    const ti = lines.findIndex((l) => SRT_TIME_RE.test(l))
    if (ti === -1) continue
    const [, start, end] = lines[ti].match(SRT_TIME_RE)
    const startMs = srtTimeToMs(start)
    const endMs = srtTimeToMs(end)
    const text = lines.slice(ti + 1).join(' ').trim()
    if (!text || !(endMs > startMs)) continue
    out.push({ index: out.length + 1, startMs, endMs, text })
  }
  return out
}

/**
 * 큐 목록이 이 오디오와 짝이 맞는지 검사. 짝이 틀린 SRT/mp3 조합은 조용히 이상한 오디오를
 * 만들어내는 대신 여기서 드러나야 한다.
 *
 * 반환은 **안정적인 kind 코드**다 — 사람이 읽을 문장이 아니다. main process의 오류는 IPC를
 * 건너오면서 useI18n을 부를 수 없으므로, 문구는 renderer의 로케일이 kind로 찾아 붙인다
 * (tests/electron/noKoreanIpcErrors.test.js가 강제하는 계약).
 *
 * @param {number} audioDurationMs 실측 오디오 길이
 * @param {number} toleranceMs 마지막 큐가 오디오 끝을 넘어도 봐줄 여유(인코더 패딩 등)
 * @returns {Array<{kind: string}>} 빈 배열이면 정상
 */
export function validateCues(cues, { audioDurationMs, toleranceMs = 1000 } = {}) {
  const errors = []
  if (!cues.length) errors.push({ kind: 'story-srt-no-cues' })
  for (let i = 1; i < cues.length; i++) {
    if (cues[i].startMs < cues[i - 1].endMs) {
      errors.push({ kind: 'story-srt-cues-overlap' })
      break
    }
  }
  if (audioDurationMs > 0 && cues.length) {
    const last = cues[cues.length - 1].endMs
    if (last > audioDurationMs + toleranceMs) errors.push({ kind: 'story-srt-longer-than-audio' })
  }
  return errors
}

/**
 * 큐가 오디오를 얼마나 덮는지 — 큐 사이 간격 총량과 앞뒤로 자막이 없는 구간.
 * ⑤가 이걸 로그로 알려 "SRT가 오디오와 안 맞는다"가 조용히 지나가지 않게 한다.
 */
export function cueCoverage(cues, { audioDurationMs = 0 } = {}) {
  let gapMs = 0
  for (let i = 1; i < cues.length; i++) gapMs += Math.max(0, cues[i].startMs - cues[i - 1].endMs)
  const leadingMs = cues.length ? cues[0].startMs : 0
  const trailingMs = cues.length && audioDurationMs > 0 ? Math.max(0, audioDurationMs - cues[cues.length - 1].endMs) : 0
  return { gapMs, leadingMs, trailingMs }
}

/**
 * 정렬용 텍스트 정규화 — 공백/구두점/기호를 전부 없앤다.
 * 자막과 대본은 같은 원본에서 나왔지만 줄바꿈·따옴표·말줄임(——, …) 표기가 갈린다. 글자만 남기면
 * 그 차이가 사라져 결정론적으로 겹쳐진다.
 *
 * NFC 정규화가 먼저다: macOS 계열 도구가 만든 자막은 한글이 자모 분해(NFD)돼 있을 수 있는데,
 * 그러면 눈에 똑같아 보여도 코드포인트가 달라 indexOf가 전부 실패한다 — 짝이 맞는 파일인데도
 * 전 세그먼트가 missed로 나와 "다른 회차 아니냐"는 엉뚱한 안내를 받게 된다.
 */
const normalizeForAlign = (s) => String(s || '').normalize('NFC').replace(/[\s\p{P}\p{S}]/gu, '').toLowerCase()

/**
 * 큐 목록 → 정규화 문자 스트림 + 문자 인덱스에서 시각을 얻는 함수.
 * 문자 하나하나가 어느 큐의 몇 번째 글자인지 기억해, 임의의 문자 위치를 그 큐 구간 안에서
 * 비율로 보간한다.
 */
function buildCueStream(cues) {
  const parts = []
  const cueOf = []
  const posOf = []
  const lenOf = []
  for (let i = 0; i < cues.length; i++) {
    const n = normalizeForAlign(cues[i].text)
    lenOf.push(n.length)
    parts.push(n)
    for (let j = 0; j < n.length; j++) { cueOf.push(i); posOf.push(j) }
  }
  const stream = parts.join('')

  /** 문자 인덱스 → 그 글자가 *시작하는* 시각(ms). 스트림 끝이면 마지막 큐의 끝. */
  const startOf = (idx) => {
    if (!cues.length) return 0
    if (idx >= cueOf.length) return cues[cues.length - 1].endMs
    const ci = cueOf[idx]
    const c = cues[ci]
    const len = lenOf[ci] || 1
    return c.startMs + (posOf[idx] / len) * (c.endMs - c.startMs)
  }

  /**
   * [a, b) 글자 구간 → [startMs, endMs).
   *
   * 끝을 startOf(b)로 잡으면 안 된다. 세그먼트가 큐 경계에서 딱 끝나는 흔한 경우(자막은 문장
   * 단위다) b는 *다음 큐의 첫 글자*라, 그 사이의 간격을 통째로 삼킨다 — 소스에 10초짜리 음악이
   * 끼어 있으면 2초 대사가 12초로 잘린다(그 음악이 나레이션에 섞여 들어가고, 파이프라인은 그
   * 자리에 자기 SFX를 또 얹는다). 마지막 글자가 속한 큐의 끝을 쓰면 그 간격은 아무도 안 가져간다.
   */
  const rangeOf = (a, b) => {
    if (!cues.length || b <= a) return { startMs: 0, endMs: 0 }
    const startMs = startOf(a)
    const lastIdx = Math.min(b, cueOf.length) - 1
    const lastCue = cueOf[lastIdx]
    // b가 같은 큐 안이면 큐 안에서 보간, 큐를 넘어가면 그 큐의 끝에서 끊는다.
    const endMs = (b < cueOf.length && cueOf[b] === lastCue) ? startOf(b) : cues[lastCue].endMs
    return { startMs, endMs }
  }
  return { stream, rangeOf }
}

/**
 * 세그먼트를 스트림에서 찾는다 — 먼저 정확히, 안 되면 **자막에 낀 삽입을 건너뛰며** 맞춘다.
 *
 * 흔한 오탐의 정체: 자막(=오디오)이 대본보다 글자가 더 많다. 나레이터가 대본에 없는 토막을
 * 덧읽는다(무한야담2 실측: "짖었지요 [컹컹] 두 번", "머리를 [한 번] 흔들고", "제 부하 넷과
 * [몽둥이를 늘어뜨린 채] 다가오는"). 세그먼트 텍스트가 통째로 자막 안에 있는데 중간이 갈라져
 * indexOf가 실패하고, 227/230이 맞았는데 3개 때문에 전체가 막힌다.
 *
 * 삽입된 오디오는 그 세그먼트가 실제로 소리 낸 부분이라 잘라낼 구간에 **포함**되는 게 맞다
 * (rangeOf가 [at,end)를 통으로 주므로 자동으로 들어간다). 대본 글자는 하나도 빠짐없이 순서대로
 * 자막에 있어야 한다 — 오디오에만 덧붙는 건 허용하되, 대본에 있는데 오디오에서 빠지는 건 불허한다
 * (그건 LLM이 문장을 바꾼 진짜 어긋남이라 missed로 남겨 사용자에게 드러나야 한다).
 *
 * 안전장치 — 우연 일치로 엉뚱한 곳을 잡지 않게:
 *   - 시작 앵커: 커서 이후에서 세그먼트 앞머리(anchor 글자)가 **연속으로** 맞는 첫 위치에서만 시작.
 *   - 삽입 예산(maxGap): 이만큼까지만 건너뛴다. 넘으면 실패(진짜 다른 텍스트).
 *
 * 예산은 **대본 길이에 비례한다 — 고정 하한을 두지 않는다.** 한때 `Math.max(12, …)`였는데,
 * 그러면 5글자 세그먼트가 자막 12글자를 삼킨다: 대본 `문을 열었다`가 자막
 * `문을 열었지만 들어가지는 않았다`에 붙어 **의미가 반대인 5초를 조용히 가져갔다**(divergent도 false).
 * 하한을 없애도 잃는 게 없다는 건 실측이다 — ep02 나레이터 237 세그먼트가 **전부 exact**로 붙어
 * 삽입 매칭이 한 번도 안 쓰였다(애드리브는 세그먼트 사이로 떨어져 skipped로 처리된다).
 * 즉 이 경로는 드물게 쓰이는 추측이므로, 싸게 얻는 이득보다 조용한 오매칭이 비싸다.
 *
 * @returns {{at:number, end:number}|null} at=시작 인덱스, end=끝(삽입 포함, 배타적). 못 맞추면 null.
 */
function matchSegment(stream, n, cursor) {
  const exact = stream.indexOf(n, cursor)
  if (exact >= 0) return { at: exact, end: exact + n.length }
  // 앵커를 세울 만큼 길지 않으면 정확 매칭만 신뢰한다 — 짧은 텍스트는 우연 일치가 너무 쉽다.
  const anchor = Math.min(n.length, 4)
  if (anchor < 4) return null
  const at = stream.indexOf(n.slice(0, anchor), cursor)
  if (at < 0) return null

  const maxGap = Math.ceil(n.length * 0.5)
  let i = anchor // 앵커 글자는 indexOf가 이미 연속 확인
  let j = at + anchor
  let gap = 0
  while (i < n.length && j < stream.length) {
    if (stream[j] === n[i]) { i += 1; j += 1 } // 대본 글자 소비
    else { j += 1; gap += 1; if (gap > maxGap) return null } // 자막에만 있는 삽입을 건너뜀
  }
  if (i < n.length) return null // 대본 글자가 자막에서 빠짐 — 진짜 어긋남, missed로 남긴다
  return { at, end: j }
}

/**
 * 어떤 화자의 (mp3, SRT) 출처에 대해, **그 화자의 세그먼트가 mp3의 몇 초~몇 초인지** 찾는다.
 *
 * 씬 구조·화자·SFX·감정은 건드리지 않는다. ⑤가 이 구간으로 mp3를 잘라 그 화자의 오디오를 만들고,
 * 출처가 없는 화자는 평소대로 TTS로 만든다. 나레이터든 등장인물이든 같은 함수를 쓴다 —
 * 화자마다 자기 mp3/SRT를 가질 수 있다.
 *
 * ── 커서를 미는 규칙 (여기가 핵심) ──
 * 이 출처의 SRT가 **무엇을 덮는지에 따라 자동으로 맞춰진다**:
 *   - 나레이터 mp3 (SRT가 대본 전체를 덮음 — 나레이터가 인물 대사까지 읽었다):
 *     인물 대사 세그먼트도 스트림에서 매칭돼 커서가 전진한다. 그래서 그 뒤의 나레이터 세그먼트가
 *     엉뚱한 자리에 붙지 않는다. 대사 자리의 mp3 오디오는 구간을 안 붙여 그냥 버린다 —
 *     그 자리는 인물 TTS가 채운다.
 *   - 인물 mp3 (SRT가 그 인물 대사만 덮음):
 *     나레이터 텍스트는 이 스트림에 없어 매칭이 안 되고 커서도 안 움직인다. 그 인물 것만 잡힌다.
 * 즉 "매칭되면 커서 전진, 대상 화자면 구간 부여" 하나로 두 경우가 다 돌아간다.
 *
 * @param {Array} scenes 씬 (segments[].{type,speaker,text,...}) — 불변
 * @param {Array} cues 이 출처의 parseSrtCues 결과
 * @param {(seg:object)=>boolean} belongsToSource 이 세그먼트가 이 출처 담당인지 (보통 화자 일치)
 * @param {boolean} [coversOtherSpeakers] 이 출처의 자막이 **남의 대사까지** 덮는가(나레이터 mp3).
 *   dangerous 판정에만 쓴다 — 아래 "두 신호를 구분한다" 참고. 호출측이 안다: 이 모듈의 모델상
 *   나레이터 mp3는 대본 전체를, 인물 mp3는 그 인물 대사만 덮는다(위 "커서를 미는 규칙").
 * @returns {{scenes: Array, aligned: number, missed: number, total: number}}
 *   missed = 이 출처 담당인데 자막에서 못 찾은 세그먼트 수(호출측이 정책을 정한다).
 */
export function alignSegmentsToSource(scenes, cues, { belongsToSource, coversOtherSpeakers = false }) {
  const { stream, rangeOf } = buildCueStream(cues)
  let cursor = 0
  let aligned = 0
  let missed = 0
  let total = 0
  // 이 출처 담당이 *아닌* 세그먼트의 매칭 통계 — 아래 divergent 판정에 쓴다.
  let otherHit = 0
  let otherMiss = 0
  // 어떤 세그먼트도 가져가지 않고 커서가 뛰어넘은 자막 글자 수. 아래 divergent 판정의 핵심.
  let skipped = 0
  // 진단용 — 개수만 주면 사용자가 어디를 봐야 할지 모른다. 첫 구멍의 시각/내용과 못 찾은 id 몇 개.
  let firstHole = null
  const missedIds = []
  // 삽입을 건너뛰며 맞춘 세그먼트 — exact와 달리 **추측**이다. 예산 안이라 통과시키되 조용하면
  // 안 된다: 맞을 수도, 의미가 다른 문장을 삼킨 것일 수도 있고 구분할 방법이 여기엔 없다.
  let gapped = 0
  const gappedIds = []
  // 남의 대사가 어긋난 **직후**의 내 세그먼트 — 커서가 안 밀린 채라 그 자리(남의 구간)를 물어온다.
  // 의심 대상은 그것뿐이다. 화자 전체를 의심하면 무고한 조각에 거짓 경고가 붙는다.
  // missed의 대략적인 자리를 정하려면 뒤쪽 매칭까지 알아야 한다. 1패스 결과를 순서대로 남겨
  // exact 경로는 그대로 두고, 아래 2패스에서 비어 있는 내 세그먼트만 채운다.
  const alignmentRecords = []

  const next = (scenes || []).map((sc, sceneIndex) => ({
    ...sc,
    segments: (sc.segments || []).map((seg, segmentIndex) => {
      if ((seg.type || 'narration') !== 'narration') return seg // sfx 등은 자막에 없다
      const mine = belongsToSource(seg)
      if (mine) total += 1
      // 이 자막이 남의 대사를 안 덮는다면(인물 mp3) 남의 세그먼트는 **이 스트림 소관이 아니다** —
      // 아예 건드리지 않는다. "남의 텍스트는 스트림에 없으니 매칭이 안 돼 커서도 안 움직인다"에
      // 기대면 안 된다: 남이 우연히 같은 말을 하면(인사·추임새는 흔하다) 그 세그먼트가 **내 자막을
      // 먹고** 커서를 밀어, 뒤따르는 내 대사가 제자리를 못 찾고 missed가 된다 → 멀쩡한 import가
      // 통째로 차단된다. 나레이터 mp3(coversOtherSpeakers)는 반대다 — 남의 대사도 이 자막에 있으니
      // 소비해야 뒤가 안 밀린다(위 "커서를 미는 규칙").
      if (!mine && !coversOtherSpeakers) return seg
      const n = normalizeForAlign(seg.text)
      const record = { sceneIndex, segmentIndex, mine, weight: Math.max(1, n.length), match: null }
      alignmentRecords.push(record)
      // 글자가 없는 세그먼트(예: "……")는 스트림에서 찾을 수 없다. 이 출처 담당이면 못 자른다는
      // 뜻이므로 missed로 센다 — 안 그러면 TTS 목록으로 흘러가 "성우 미배정"이라는 엉뚱한
      // 오류로 막힌다(이 모듈이 isImportProvider 라우팅으로 없애려던 바로 그 혼란).
      if (!n) {
        if (mine) { missed += 1; if (missedIds.length < 5) missedIds.push(seg.id) }
        return seg
      }

      const m = matchSegment(stream, n, cursor)
      if (!m) {
        // 이 출처의 자막에 없는 텍스트 — 커서는 그대로 둔다(다른 화자 mp3면 정상이다).
        if (mine) { missed += 1; if (missedIds.length < 5) missedIds.push(seg.id) }
        else otherMiss += 1
        return seg
      }
      const { at, end } = m
      // 덮은 자막이 대본보다 길면 삽입을 건너뛰며 맞춘 것 — 추측이므로 호출측이 알아야 한다.
      if (mine && end - at > n.length) { gapped += 1; if (gappedIds.length < 5) gappedIds.push(seg.id) }
      if (at > cursor && firstHole === null) firstHole = { atMs: Math.round(rangeOf(cursor, at).startMs), text: stream.slice(cursor, Math.min(at, cursor + 24)) }
      skipped += at - cursor // 이 매칭 앞에 아무도 안 가져간 자막 구간
      const { startMs, endMs } = rangeOf(at, end)
      cursor = end
      const s = Math.round(startMs)
      const e = Math.round(endMs)
      if (!mine) {
        record.match = { startMs: s, endMs: e }
        otherHit += 1
        return seg // 자리는 소비했지만 이 출처의 오디오는 안 쓴다
      }
      if (!(e > s)) {
        missed += 1
        if (missedIds.length < 5) missedIds.push(seg.id)
        return seg // 반올림 후 폭이 0이면 자를 수 없다
      }
      record.match = { startMs: s, endMs: e }
      aligned += 1
      const exact = { ...seg, srcStartMs: s, srcEndMs: e }
      delete exact.approx
      return exact
    }),
  }))

  // 안 쓰인 **꼬리**도 아무도 안 가져간 자막이다 — 커서 앞의 구멍만 세면 놓친다.
  skipped += stream.length - cursor

  // ── missed 보간 ──
  // 주어진 import 출처를 고른 사용자의 의도를 지키려면 TTS로 새게 하지 않고 실제 SRT 시각을
  // 붙여야 한다. 정확히 잡힌 내/남의 세그먼트를 앵커로 두고, 그 사이의 빈 구간을 내 missed끼리
  // 대본 글자 수 비례로 나눈다.
  //
  // 앵커가 **하나도 없으면 보간하지 않는다.** 보간의 근거는 앞뒤로 잡힌 이웃이다 — 그 사이라면
  // "비슷한 그 근처"가 맞다. 하나도 안 잡혔다는 건 대략 맞는 파일이 아니라 **다른 회차 파일**이라는
  // 뜻이고, 그때 SRT 전체를 글자 수로 쪼개 붙이면 완전히 엉뚱한 오디오가 들어간다.
  // "대략 잘라 놓고 경고" 정책은 *비슷한 게 있을 때* 성립한다 — 없으면 짝이 틀린 입력이라
  // 호출측이 막아야 한다(unpaired).
  // 보간 구간의 경계는 **잡힌 세그먼트 아무거나**(남의 것 포함)가 준다 — 순서가 보장되므로 남의
  // 매칭도 유효한 위치 기준이다.
  const anchorIndexes = alignmentRecords
    .map((record, index) => (record.match ? index : -1))
    .filter((index) => index >= 0)
  // 다만 "붙일 근거가 있나"는 **내 매칭**으로 판정한다(aligned). 남의 대사가 우연히 맞았다고 내
  // 세그먼트를 보간할 근거가 생기는 게 아니다 — 내 오디오가 이 자막에 하나도 없다는 뜻이니까.
  // 남의 매칭만 보고 보간하면 내 세그먼트 전부가 **남의 자리**를 물어오고, 사이 폭이 0이라
  // 서로 겹치기까지 한다(실측: 나레이터 2개가 똑같이 과부 구간 0-3000을 받았다).
  const unpaired = aligned === 0 && total > 0
  const whole = stream.length
    ? rangeOf(0, stream.length)
    : { startMs: cues?.[0]?.startMs || 0, endMs: cues?.[cues.length - 1]?.endMs || 0 }
  const sourceStartMs = Math.round(whole.startMs)
  const sourceEndMs = Math.round(whole.endMs)
  const approximateRanges = new Map()
  let approximated = 0
  const approximatedIds = []
  let previousAnchorIndex = -1
  for (let ai = 0; !unpaired && ai <= anchorIndexes.length; ai++) {
    const nextAnchorIndex = ai < anchorIndexes.length ? anchorIndexes[ai] : alignmentRecords.length
    const run = alignmentRecords
      .slice(previousAnchorIndex + 1, nextAnchorIndex)
      .filter((record) => record.mine && !record.match)
    if (run.length) {
      const previous = previousAnchorIndex >= 0 ? alignmentRecords[previousAnchorIndex].match : null
      const following = nextAnchorIndex < alignmentRecords.length ? alignmentRecords[nextAnchorIndex].match : null
      const startMs = previous ? previous.endMs : sourceStartMs
      const endMs = following ? following.startMs : sourceEndMs
      // 폭이 0이면 **그 줄의 오디오가 존재하지 않는다** — 앵커가 맞닿았다는 건 나레이터가 그 줄을
      // 안 읽고 넘어갔다는 뜻이다. 구간을 주지 않는다.
      //
      // 한때 "폭 0이면 인접 앵커까지 넓혀 겹침을 허용"했는데 두 가지로 틀렸다:
      //   1) cutAudio가 겹치는 range를 throw한다(audioCut.js) — 나레이터 자막은 **연속 큐가 기본**이라
      //      "대본 한 줄 안 읽음"(missed의 전형)이 곧 폭 0이다. 이 정책이 구하려던 바로 그 케이스에서
      //      절단기가 죽었다. 그것도 errorKind 없는 내부 영문으로.
      //   2) 의미도 틀렸다 — 이웃 구간을 갖다 붙이면 앞뒤 대사가 **두 번 들린다**. "가장 맞는 부분"이
      //      아니라 엉뚱한 것이다. 없는 건 없다고 두고 호출측이 경고한다(missed에 남는다).
      if (endMs > startMs) {
        const totalWeight = run.reduce((sum, record) => sum + record.weight, 0)
        let consumedWeight = 0
        for (const record of run) {
          const s = Math.round(startMs + ((endMs - startMs) * consumedWeight) / totalWeight)
          consumedWeight += record.weight
          const e = Math.round(startMs + ((endMs - startMs) * consumedWeight) / totalWeight)
          // ms 폭보다 세그먼트가 많으면 비례 분할만으로 0폭이 생긴다(예: 5개를 2ms에). 그 조각은
          // 자를 게 없으므로 건너뛴다 — 한때 여기서 같은 범위를 겹쳐 썼는데, 그러면 cutAudio가
          // 겹침으로 throw해 실행 전체가 죽는다. 못 준 건 missed로 남아 호출측이 경고한다.
          if (!(e > s)) continue
          approximateRanges.set(`${record.sceneIndex}:${record.segmentIndex}`, { startMs: s, endMs: e })
          approximated += 1
          const id = next[record.sceneIndex]?.segments?.[record.segmentIndex]?.id
          if (approximatedIds.length < 5) approximatedIds.push(id)
        }
      }
    }
    previousAnchorIndex = nextAnchorIndex
  }
  const withApproximations = next.map((sc, sceneIndex) => ({
    ...sc,
    segments: (sc.segments || []).map((seg, segmentIndex) => {
      const range = approximateRanges.get(`${sceneIndex}:${segmentIndex}`)
      return range ? { ...seg, srcStartMs: range.startMs, srcEndMs: range.endMs, approx: true } : seg
    }),
  }))

  // ── 두 신호를 구분한다 ──
  //
  // divergent(=skipped>0): "대본이 안 가져간 자막이 있다". 대부분 정상이다 — 나레이터 애드리브,
  //   의성어, 아웃트로. 그 오디오는 그냥 버리면 되므로 **경고**용이다(실측 ep02: 60자 전부 그런
  //   것). 이걸 차단 신호로 쓰면 안 된다.
  //
  // dangerous: 내 세그먼트가 **남의 자리 오디오를 물어왔을 수 있다**. 이 자막이 남의 대사를
  //   덮는데(그게 전제다) 그중 하나가 대본과 어긋나 매칭에 실패하면 커서가 안 밀린다 → 뒤따르는
  //   내 세그먼트가 그 미소비 구간에서 자기 텍스트를 찾아 남의 자리를 물어온다. missed는 0인 채라
  //   조용하다. 그래서 otherMiss>0 + "이 자막이 남의 대사를 덮는다"가 조건이다.
  //
  //   덮는지는 **호출측이 안다**(coversOtherSpeakers): 나레이터 mp3는 대본 전체를 읽었고 인물
  //   mp3는 그 인물 대사만 덮는다. 그게 이 모듈의 모델이다.
  //
  //   한때 `|| otherHit > 0`을 얹어 "호출측이 안 알려줘도 증거로 선다"고 했는데 뺐다. 알려주는
  //   호출자가 유일하니 얻는 게 없고, otherHit은 증거로도 부실하다: 인물 전용 SRT의 애드리브가
  //   남의 짧은 대사와 **우연히 일치**하면 otherHit=1이 서서, 정확히 false로 알려준 호출측 정보를
  //   뒤집고 멀쩡한 import를 막는다.
  //
  // 왜 skipped를 차단 조건에서 뺐나: 인물 전용 mp3에선 otherMiss>0이 **기본값**이다(나레이터
  // 세그먼트는 애초에 이 자막에 없다). 거기에 애드리브가 하나라도 섞이면 skipped>0이 되어,
  // 옛 조건 `otherMiss>0 && skipped>0`은 **멀쩡한 인물 mp3를 통째로 막았다** — 두 정상 현상의
  // 곱을 위험으로 읽은 것이다.
  //
  // ── 한계 (dangerous === false를 보장으로 읽지 말 것) ──
  // 어긋난 남의 자막이 뒤따르는 내 세그먼트 텍스트를 커서 위치에서 통째로 포함하면 흔적이 안
  // 남는다 — 탐욕적 최초매칭의 본질적 한계다. 피해는 제한적이다(같은 나레이터 목소리로 거의 같은
  // 말을 읽은 구간).
  const divergent = skipped > 0
  const dangerous = coversOtherSpeakers && otherMiss > 0
  return { scenes: withApproximations, aligned, missed, approximated, total, otherHit, otherMiss, skipped, divergent, dangerous, unpaired, firstHole, missedIds, approximatedIds, gapped, gappedIds }
}

/**
 * 이 화자를 파일에서 가져오기로 **의도**했는가. 경로가 온전한지는 안 본다 — 그건 ⑤가 검사해
 * 경로 오류로 알려준다. 라우팅(TTS로 보낼지 말지)은 이 술어로 한다: 경로가 이상하다고 조용히
 * TTS로 흘려보내면 "성우 미배정" 같은 엉뚱한 오류가 나거나 resolveTts('import')로 죽는다.
 */
export function isImportProvider(voice) {
  return voice?.provider === 'import'
}

/** 실제로 쓸 수 있는 출처인가 — 짝(mp3+SRT)이 다 있어야 어느 구간인지 알 수 있다. */
export function isImportVoice(voice) {
  return isImportProvider(voice) && !!voice.mp3Path && !!voice.srtPath
}

/** 정렬로 mp3 구간이 붙은 세그먼트인지 — ⑤가 TTS 대신 잘라 쓸 대상. */
export function isImportedSegment(seg) {
  return Number.isFinite(seg?.srcStartMs) && Number.isFinite(seg?.srcEndMs) && seg.srcEndMs > seg.srcStartMs
}
