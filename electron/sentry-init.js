import * as Sentry from '@sentry/electron/main'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))

function readAppVersion() {
  try {
    const pkgPath = path.join(__dirname, '..', 'package.json')
    const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8'))
    return pkg.version || '0.0.0'
  } catch {
    return '0.0.0'
  }
}

// @sentry/electron enables node.consoleIntegration() by default, so EVERY main-process
// console.log becomes a breadcrumb and ships with any captured event. The Flow generation
// path logs the user's prompt text, so without this their prompts would leave the machine.
// beforeSend only filters event.extra — it never sees breadcrumbs.
//
// Redact the value, keep the line: "prompt: '<lighthouse keeper…>'" tells us nothing we
// need, but knowing that generate-image ran, and when, is the whole point of the trail.
const PROMPT_BEARING = [
  // [Flow API] generate-image: { prompt: '…', model: … }
  /(prompt:\s*)('[^']*'|"[^"]*"|[^,}]+)/gi,
  // [DOM IPC] dom-send-prompt called: …
  /(dom-send-prompt called:\s*)(.*)$/gi,
]

export function scrubBreadcrumbMessage(message) {
  let out = String(message)
  for (const re of PROMPT_BEARING) out = out.replace(re, '$1<redacted>')
  return out
}

/**
 * ⚠️ 각 값을 리터럴 `process.env.X` 로 읽어야 한다 — 별칭(`env.X`, env = process.env)으로 읽으면
 *    안 된다. 패키징된 앱은 .env 를 싣지 않으므로(build.files 에 없음) 런타임 process.env 에는
 *    이 값들이 없다. 대신 vite.config 의 define 이 빌드 시점에 값을 박아 넣는데, define 은 소스에
 *    문자 그대로 쓰인 `process.env.ENABLE_SENTRY` 만 치환한다. 별칭으로 읽으면 치환이 일어나지
 *    않아 배포 빌드에서 Sentry 가 영구히 꺼진다 — 그리고 prod 는 console 도 제거하므로
 *    "[Sentry] disabled" 로그조차 안 남아 눈치챌 방법이 없다. 실제로 그렇게 죽어 있었다.
 */
function defaultEnv() {
  return {
    SENTRY_DSN: process.env.SENTRY_DSN,
    VITE_SENTRY_DSN: process.env.VITE_SENTRY_DSN,
    ENABLE_SENTRY: process.env.ENABLE_SENTRY,
    VITE_FUNCTION_ENV: process.env.VITE_FUNCTION_ENV,
    SENTRY_TRACES_SAMPLE_RATE: process.env.SENTRY_TRACES_SAMPLE_RATE,
  }
}

export function buildSentryOptions({ env = defaultEnv(), version } = {}) {
  const dsn = env.SENTRY_DSN || env.VITE_SENTRY_DSN || ''
  const isProd = env.VITE_FUNCTION_ENV === 'prod'
  const enabled = env.ENABLE_SENTRY === '1' && isProd && !!dsn

  return {
    enabled,
    dsn,
    environment: env.VITE_FUNCTION_ENV || 'development',
    release: `autoflowcut@${version || readAppVersion()}`,
    tracesSampleRate: Number(env.SENTRY_TRACES_SAMPLE_RATE || 0.1),
    beforeBreadcrumb(breadcrumb) {
      if (breadcrumb?.category === 'console' && breadcrumb.message) {
        breadcrumb.message = scrubBreadcrumbMessage(breadcrumb.message)
      }
      return breadcrumb
    },
    beforeSend(event) {
      if (event.user) {
        delete event.user.ip_address
        delete event.user.email
      }
      if (event.request?.data) delete event.request.data
      if (event.extra) {
        for (const k of Object.keys(event.extra)) {
          if (/prompt|input|filename|path/i.test(k)) delete event.extra[k]
        }
      }
      return event
    },
  }
}

export function initSentryMain({ sentry = Sentry, env = process.env } = {}) {
  const options = buildSentryOptions({ env })
  if (!options.enabled) {
    console.log(`[Sentry] disabled (env=${env.VITE_FUNCTION_ENV || 'dev'}, prod-only)`)
    return { initialized: false, options }
  }
  const { enabled, ...initOptions } = options
  sentry.init(initOptions)
  console.log(`[Sentry] initialized (env=${options.environment}, release=${options.release})`)
  return { initialized: true, options }
}
