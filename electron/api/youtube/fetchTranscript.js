/**
 * electron/api/youtube/fetchTranscript.js
 *
 * yt-dlp로 YouTube 자막을 취득하는 오케스트레이터 (spec §3.1, 방향 확정 2026-07-07).
 *
 * webContents/poToken/offscreen 플레이어 재생 방식은 전면 폐기됨 — yt-dlp가 봇차단·
 * poToken을 자체 처리하고 재생 없이(조용히) 자막 텍스트를 취득한다. main에서 child_process로
 * yt-dlp를 실행 → 임시 폴더에 srv3(또는 vtt)를 받아 순수 파서로 세그먼트/SRT/평문 생성.
 *
 * 언어 우선순위 ko→en→auto (§Q3): `--sub-langs ko,en` + `--write-subs --write-auto-subs`.
 * yt-dlp가 수동 자막 우선, 없으면 자동생성을 받는다. 받은 파일명(<id>.<lang>.<ext>)에서
 * lang/포맷을 읽어 최우선 트랙을 고른다.
 */
import { readdirSync, readFileSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { runYtDlp as defaultRunYtDlp } from './ytDlp.js'
import { parseSubtitle, segmentsToSrt, segmentsToPlainText } from './transcriptParse.js'

const SUB_FORMAT = 'srv3/json3/vtt/best'

/** yt-dlp 자막 취득 인자 구성 (테스트 계약). */
export function buildYtDlpSubArgs({ videoId, outDir, langs = ['ko', 'en'] }) {
  return [
    '--write-subs',
    '--write-auto-subs',
    '--skip-download',
    '--sub-langs',
    langs.join(','),
    '--sub-format',
    SUB_FORMAT,
    '--no-warnings',
    '-o',
    path.join(outDir, `${videoId}.%(ext)s`),
    `https://www.youtube.com/watch?v=${videoId}`,
  ]
}

/** 파일명 `<id>.<lang>.<ext>`에서 lang/ext 추출. */
function parseSubFileName(fileName, videoId) {
  // <id>.<lang>.<ext> — lang은 'ko', 'en', 'ko-orig', 'en-US' 등 가능
  const rest = fileName.startsWith(`${videoId}.`) ? fileName.slice(videoId.length + 1) : fileName
  const parts = rest.split('.')
  if (parts.length < 2) return null
  const ext = parts.pop()
  const lang = parts.join('.')
  return { lang, ext, baseLang: lang.split('-')[0] }
}

/**
 * 취득한 자막 파일 중 언어 우선순위(langs)에 맞는 최우선 파일 선택.
 * @returns {{fileName, lang, ext, isAuto}|null}
 */
function pickSubFile(files, videoId, langs, autoLangs) {
  const parsed = files
    .map((f) => ({ fileName: f, ...parseSubFileName(f, videoId) }))
    .filter((p) => p.ext && /^(srv3|srv1|vtt|json3|xml)$/i.test(p.ext))
  if (!parsed.length) return null
  for (const lang of langs) {
    const hit = parsed.find((p) => p.baseLang === lang)
    if (hit) return { ...hit, isAuto: autoLangs.includes(hit.baseLang) || /orig/.test(hit.lang) }
  }
  // 우선순위 밖이면 첫 파일
  const first = parsed[0]
  return { ...first, isAuto: autoLangs.includes(first.baseLang) || /orig/.test(first.lang) }
}

/**
 * 자막 취득 실행.
 * @param {string} videoId
 * @param {object} [deps]
 * @param {(args:string[],opts?:object)=>Promise<{stdout,stderr,code}>} [deps.runYtDlp]
 * @param {string[]} [deps.langs=['ko','en']] - §Q3
 * @param {string[]} [deps.autoLangs=[]] - 자동생성으로 판정할 baseLang(테스트 힌트; 실제론 파일명 -orig로 판정)
 * @param {string} [deps.tmpBase] - 임시 폴더 베이스(테스트 주입)
 * @param {number} [deps.timeoutMs=90000]
 * @returns {Promise<{videoId, ok, lang?, isAuto?, format?, segments?, srt?, plainText?, error?}>}
 */
export async function fetchTranscript(videoId, deps = {}) {
  const {
    runYtDlp = defaultRunYtDlp,
    langs = ['ko', 'en'],
    autoLangs = [],
    tmpBase,
    timeoutMs = 90000,
  } = deps
  const outDir = tmpBase || mkdtempSync(path.join(tmpdir(), 'yt-sub-'))
  try {
    const args = buildYtDlpSubArgs({ videoId, outDir, langs })
    try {
      await runYtDlp(args, { timeoutMs })
    } catch (e) {
      const msg = String((e && e.message) || e)
      if (msg === 'binary-not-found' || msg === 'timeout') return { videoId, ok: false, error: msg }
      return { videoId, ok: false, error: msg }
    }

    let files = []
    try { files = readdirSync(outDir) } catch { files = [] }
    const picked = pickSubFile(files, videoId, langs, autoLangs)
    if (!picked) return { videoId, ok: false, error: 'no-transcript' }

    let content = ''
    try { content = readFileSync(path.join(outDir, picked.fileName), 'utf8') } catch {
      return { videoId, ok: false, error: 'read-failed' }
    }
    const segments = parseSubtitle(content, picked.ext)
    if (!segments.length) return { videoId, ok: false, error: 'parse-failed', lang: picked.baseLang }

    return {
      videoId,
      ok: true,
      lang: picked.baseLang,
      isAuto: picked.isAuto,
      format: picked.ext.toLowerCase(),
      segments,
      srt: segmentsToSrt(segments),
      plainText: segmentsToPlainText(segments),
    }
  } finally {
    // 테스트가 tmpBase를 주입한 경우 정리는 호출자 책임(파일 검증 위해). 자체 생성한 임시만 정리.
    if (!tmpBase) {
      try { rmSync(outDir, { recursive: true, force: true }) } catch {}
    }
  }
}
