/**
 * electron/api/youtube/ytDlp.js
 *
 * yt-dlp 바이너리 경로 해석 + child_process 실행 러너 (spec §3.1/§3.3 공통).
 *
 * 방향 확정(2026-07-07): YouTube 자막·검색은 전부 시스템 yt-dlp 바이너리로 처리한다
 * (webContents/poToken/YouTube Data API 전면 폐기). 유일한 외부 의존은 yt-dlp 바이너리.
 *
 * 바이너리 경로: 시스템 PATH(`which`/`where`) 우선. 없으면 알려진 설치 위치 몇 곳 탐색.
 * 그래도 없으면 'binary-not-found' 에러(호출부가 설치 안내). Electron GUI 앱은 로그인
 * 셸 PATH가 없을 수 있어 `execFile('yt-dlp')` 직접 호출은 실패할 수 있으므로 절대경로를 쓴다.
 */
import { execFile } from 'node:child_process'
import { existsSync } from 'node:fs'

// GUI 앱 PATH 누락 대비 후보 경로(macOS/Linux 주요 위치 + pyenv shim).
const COMMON_PATHS = [
  '/opt/homebrew/bin/yt-dlp',
  '/usr/local/bin/yt-dlp',
  '/usr/bin/yt-dlp',
  `${process.env.HOME || ''}/.local/bin/yt-dlp`,
  `${process.env.HOME || ''}/.pyenv/shims/yt-dlp`,
]

let cachedPath // '' = 탐색했으나 없음, string = 발견

/**
 * yt-dlp 절대경로 해석. 발견 실패 시 null.
 * @param {object} [deps]
 * @param {(cmd:string,args:string[])=>Promise<string>} [deps.whichImpl] - 테스트 주입
 */
export async function resolveYtDlpPath(deps = {}) {
  if (cachedPath !== undefined) return cachedPath || null
  const { whichImpl = defaultWhich, existsImpl = existsSync } = deps
  // 1) PATH 조회
  try {
    const found = (await whichImpl(process.platform === 'win32' ? 'where' : 'which', ['yt-dlp'])).trim().split('\n')[0].trim()
    if (found && existsImpl(found)) {
      cachedPath = found
      return found
    }
  } catch {
    /* which 실패 → 후보 경로 탐색 */
  }
  // 2) 알려진 위치
  for (const p of COMMON_PATHS) {
    if (p && existsImpl(p)) {
      cachedPath = p
      return p
    }
  }
  cachedPath = ''
  return null
}

/** 테스트에서 캐시 리셋용. */
export function _resetYtDlpPathCache() {
  cachedPath = undefined
}

function defaultWhich(cmd, args) {
  return new Promise((resolve, reject) => {
    execFile(cmd, args, { timeout: 5000 }, (err, stdout) => {
      if (err) reject(err)
      else resolve(stdout || '')
    })
  })
}

/**
 * yt-dlp 실행. 성공 시 { stdout, stderr, code }. 바이너리 부재 시 Error('binary-not-found'),
 * 타임아웃 시 Error('timeout').
 * @param {string[]} args
 * @param {object} [opts]
 * @param {number} [opts.timeoutMs=60000]
 * @param {object} [deps] - { resolvePath, execFileImpl } 테스트 주입
 */
export async function runYtDlp(args, opts = {}, deps = {}) {
  const { timeoutMs = 60000 } = opts
  const { resolvePath = resolveYtDlpPath, execFileImpl = execFile } = deps
  const bin = await resolvePath()
  if (!bin) throw new Error('binary-not-found')
  return new Promise((resolve, reject) => {
    execFileImpl(bin, args, { timeout: timeoutMs, maxBuffer: 32 * 1024 * 1024 }, (err, stdout, stderr) => {
      if (err) {
        if (err.killed || err.signal === 'SIGTERM') return reject(new Error('timeout'))
        // yt-dlp가 자막 없음 등으로 non-zero exit이어도 stdout/stderr는 유효 → 전달
        return resolve({ stdout: stdout || '', stderr: stderr || String(err.message || err), code: err.code ?? 1 })
      }
      resolve({ stdout: stdout || '', stderr: stderr || '', code: 0 })
    })
  })
}
