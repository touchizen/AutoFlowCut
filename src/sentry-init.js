import * as Sentry from '@sentry/electron/renderer'

export function buildSentryRendererOptions({ env = import.meta.env, version } = {}) {
  const dsn = env.VITE_SENTRY_DSN || ''
  const isProd = env.VITE_FUNCTION_ENV === 'prod'
  const enabled = env.VITE_ENABLE_SENTRY === '1' && isProd && !!dsn

  return {
    enabled,
    dsn,
    environment: env.VITE_FUNCTION_ENV || 'development',
    release: `autoflowcut@${version || (typeof __APP_VERSION__ !== 'undefined' ? __APP_VERSION__ : '0.0.0')}`,
    tracesSampleRate: Number(env.VITE_SENTRY_TRACES_SAMPLE_RATE || 0.1),
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

export function initSentryRenderer({ sentry = Sentry, env = import.meta.env } = {}) {
  const options = buildSentryRendererOptions({ env })
  if (!options.enabled) {
    console.log(`[Sentry/renderer] disabled (env=${env.VITE_FUNCTION_ENV || 'dev'}, prod-only)`)
    return { initialized: false, options }
  }
  const { enabled, ...initOptions } = options
  sentry.init(initOptions)
  console.log(`[Sentry/renderer] initialized (env=${options.environment}, release=${options.release})`)
  return { initialized: true, options }
}
