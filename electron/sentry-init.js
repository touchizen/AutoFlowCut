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

export function buildSentryOptions({ env = process.env, version } = {}) {
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
