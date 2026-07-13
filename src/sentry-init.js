import * as Sentry from '@sentry/electron/renderer'
import { scrubBreadcrumb } from '../electron/sentry-scrub.js'

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
    // ⚠️ 렌더러에도 같은 스크럽을 건다. 여태 renderer Sentry 에는 beforeBreadcrumb 이 **없었다** —
    //   main 만 막고 여기를 안 봐서, main 이 렌더러 콘솔에 찍는 전체 파일 경로(바탕화면 덤프 경로 =
    //   /Users/<계정>/…)가 그대로 나가고 있었다. 채널이 여럿이면 한 곳에서 막아 전부 통과시킨다.
    beforeBreadcrumb: scrubBreadcrumb,
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
