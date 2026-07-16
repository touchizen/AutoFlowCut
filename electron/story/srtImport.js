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
 * @returns {{scenes: Array, aligned: number, missed: number, total: number}}
 *   missed = 이 출처 담당인데 자막에서 못 찾은 세그먼트 수(호출측이 정책을 정한다).
 */
export function alignSegmentsToSource(scenes, cues, { belongsToSource }) {
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

  const next = (scenes || []).map((sc) => ({
    ...sc,
    segments: (sc.segments || []).map((seg) => {
      if ((seg.type || 'narration') !== 'narration') return seg // sfx 등은 자막에 없다
      const mine = belongsToSource(seg)
      if (mine) total += 1
      const n = normalizeForAlign(seg.text)
      // 글자가 없는 세그먼트(예: "……")는 스트림에서 찾을 수 없다. 이 출처 담당이면 못 자른다는
      // 뜻이므로 missed로 센다 — 안 그러면 TTS 목록으로 흘러가 "성우 미배정"이라는 엉뚱한
      // 오류로 막힌다(이 모듈이 isImportProvider 라우팅으로 없애려던 바로 그 혼란).
      if (!n) { if (mine) missed += 1; return seg }

      const at = stream.indexOf(n, cursor)
      if (at < 0) {
        // 이 출처의 자막에 없는 텍스트 — 커서는 그대로 둔다(다른 화자 mp3면 정상이다).
        if (mine) { missed += 1; if (!missedIds.length || missedIds.length < 5) missedIds.push(seg.id) }
        else otherMiss += 1
        return seg
      }
      if (at > cursor && firstHole === null) firstHole = { atMs: Math.round(rangeOf(cursor, at).startMs), text: stream.slice(cursor, Math.min(at, cursor + 24)) }
      skipped += at - cursor // 이 매칭 앞에 아무도 안 가져간 자막 구간
      const { startMs, endMs } = rangeOf(at, at + n.length)
      cursor = at + n.length
      if (!mine) { otherHit += 1; return seg } // 자리는 소비했지만 이 출처의 오디오는 안 쓴다
      const s = Math.round(startMs)
      const e = Math.round(endMs)
      if (!(e > s)) { missed += 1; return seg } // 반올림 후 폭이 0이면 자를 수 없다
      aligned += 1
      return { ...seg, srcStartMs: s, srcEndMs: e }
    }),
  }))

  // ── 어긋남 감지 ──
  // 신호는 **아무 세그먼트도 안 가져간 자막 구간(skipped)**이다. 정상인 두 경우는 둘 다 0이다:
  //   - 나레이터 mp3: 모든 세그먼트(남의 대사 포함)가 순서대로 매칭돼 스트림을 빈틈없이 소비한다.
  //   - 인물 mp3: 자막에 그 인물 대사만 있고 내 세그먼트가 그걸 순서대로 다 가져간다. 남의
  //     세그먼트는 애초에 매칭이 안 돼 커서를 안 건드린다.
  // 어긋나야만 구멍이 생긴다.
  //
  // ── 한계 (divergent === false를 보장으로 읽지 말 것) ──
  // 완벽한 감지가 아니다. 어긋난 남의 자막이 **뒤따르는 내 세그먼트의 텍스트를 커서 위치에서
  // 통째로 포함**하면, 그 세그먼트는 남의 큐 안에 딱 붙어버려 구멍이 안 생긴다(skipped=0).
  // 탐욕적 최초매칭의 본질적 한계라 소비량 기반 신호로는 못 잡는다 — 커서 자리의 글자가 실제로
  // 같기 때문이다. 피해는 제한적이다(같은 나레이터 목소리로 거의 같은 말을 읽은 구간). 잡으려면
  // 길이/속도 같은 직교 신호가 필요한데, 그 값어치가 알고리즘을 뒤엎을 만큼 크지 않다고 봤다.
  //
  // 왜 이게 중요한가: 매칭 못 한 남의 세그먼트는 커서를 안 민다. 그러면 뒤따르는 내 세그먼트가
  // 그 미소비 구간에서 자기 텍스트를 찾아 **남의 오디오를 물어온다** — 짧거나 반복되는
  // 텍스트("어제……")면 실제로 걸리고, missed는 0이라 오류도 안 난다(다른 목소리가 영상에
  // 들어가는데 조용하다). skipped>0이면 그 상태일 수 있으니 호출측이 세운다.
  //
  // (otherHit/otherMiss만으로는 못 잡는다: 대사가 하나뿐인데 그게 어긋나면 otherHit=0,
  //  otherMiss=1이라 "깨끗한 인물 전용 자막"과 구분되지 않는다.)
  const divergent = skipped > 0
  return { scenes: next, aligned, missed, total, otherHit, otherMiss, skipped, divergent, firstHole, missedIds }
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
