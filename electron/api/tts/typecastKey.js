/**
 * Typecast API 키 로더 — CLAUDE.md 보안 규칙: env → ~/.typecast/credentials → 명시적 에러.
 * silent fallback 금지. 동기 계약(typecast 어댑터가 getKey()를 동기 호출).
 * readFile/homedir/env 주입으로 단위 테스트.
 */
import os from 'node:os'
import path from 'node:path'
import { readFileSync } from 'node:fs'

export function getTypecastKey({ env = process.env, readFile = readFileSync, homedir = os.homedir } = {}) {
  if (env.TYPECAST_API_KEY) return env.TYPECAST_API_KEY
  const credPath = path.join(homedir(), '.typecast', 'credentials')
  let raw
  try {
    raw = readFile(credPath, 'utf8')
  } catch {
    throw new Error('Typecast API key not found: set TYPECAST_API_KEY or ~/.typecast/credentials')
  }
  // dotenv(KEY=VALUE) 또는 raw 키 한 줄. 주석/빈 줄 skip.
  for (const line of String(raw).split(/\r?\n/)) {
    const trimmed = line.trim()
    if (!trimmed || trimmed.startsWith('#')) continue
    const m = trimmed.match(/^(?:TYPECAST_API_KEY\s*=\s*)?(.+)$/)
    if (m && m[1]) return m[1].trim().replace(/^["']|["']$/g, '')
  }
  throw new Error('Typecast API key empty in ~/.typecast/credentials')
}
