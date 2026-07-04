/**
 * provider별 API 키 파일 로더(폴백) — env → ~/.{service}/credentials.
 * typecastKey와 동일 형식(dotenv KEY=VALUE 또는 raw 키 한 줄, 주석/빈 줄 skip)이되, 없으면
 * throw가 아니라 null 반환한다 — keychain(multiKeyStore) 우선 뒤 폴백 체인용(최종 판단은 어댑터).
 * CLAUDE.md 보안: 키는 소스에 박지 않고 env/credentials 파일에서만 로드.
 */
import os from 'node:os'
import path from 'node:path'
import { readFileSync } from 'node:fs'

export function readCredentialsKey(service, envVar, { env = process.env, readFile = readFileSync, homedir = os.homedir } = {}) {
  if (envVar && env[envVar]) return env[envVar]
  const credPath = path.join(homedir(), `.${service}`, 'credentials')
  let raw
  try {
    raw = readFile(credPath, 'utf8')
  } catch {
    return null
  }
  const prefix = envVar ? `(?:${envVar}\\s*=\\s*)?` : ''
  const re = new RegExp(`^${prefix}(.+)$`)
  for (const line of String(raw).split(/\r?\n/)) {
    const trimmed = line.trim()
    if (!trimmed || trimmed.startsWith('#')) continue
    const m = trimmed.match(re)
    if (m && m[1]) return m[1].trim().replace(/^["']|["']$/g, '')
  }
  return null
}

export default { readCredentialsKey }
