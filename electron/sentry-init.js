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
