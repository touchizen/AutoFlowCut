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

// 자격증명/PII — 소스에서 안 찍는 게 1차 방어지만, console.log 하나만 빠뜨려도 자격증명이
//   Sentry 로 나간다. 실제로 Flow 세션 응답이 access_token 과 이메일을 통째로 찍고 있었다.
const SECRET_BEARING = [
  /(["']?access_?token["']?\s*[:=]\s*["']?)[A-Za-z0-9._~+/-]{12,}/gi,
  /\bya29\.[A-Za-z0-9._~+/-]{8,}/g,                       // Google OAuth 토큰
  /\bBearer\s+[A-Za-z0-9._~+/-]{12,}/gi,
  /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g,      // 이메일
  // 절대 경로 — 사용자 이름이 들어간다. 소스마다 쫓아다니는 건 수렴하지 않지만(다운로드 폴더, 덤프
  //   파일, 저장 경로…), 모양이 규칙적이라 경계에서 한 번에 막을 수 있다.
  //   경로엔 공백이 들어갈 수 있고("/Users/Gordon Ahn/…"), Windows 경로는 JSON 안에서
  //   이스케이프돼 나온다("C:\\Users\\…") — 둘 다 덮는다.
  /\/(?:Users|home)\/[^"'`,)\]}]*/g,
  /[A-Za-z]:(?:\\{1,2})Users(?:\\{1,2})[^"'`,)\]}]*/g,
]

export function scrubBreadcrumbMessage(message) {
  let out = String(message)
  for (const re of PROMPT_BEARING) out = out.replace(re, '$1<redacted>')
  for (const re of SECRET_BEARING) out = out.replace(re, (m, p1) => (p1 ? `${p1}<redacted>` : '<redacted>'))
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
      if (breadcrumb?.category === 'console') {
        if (breadcrumb.message) breadcrumb.message = scrubBreadcrumbMessage(breadcrumb.message)
        // consoleIntegration 은 원본 인자를 data.arguments 에 그대로 보관한다 — message 만 씻으면
        //   가려진 텍스트가 인자로 다시 나간다. 그리고 자유 형식 콘텐츠(캐릭터 이름, 캡션, 폴더 경로)는
        //   정규식으로 못 덮는다. 그래서 원본 인자는 아예 내보내지 않는다. 우리가 읽는 건 message 다.
        if (breadcrumb.data) delete breadcrumb.data.arguments
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

/**
 * ⚠️ env 에 기본값을 주지 않는다. `env = process.env` 로 두면 그 런타임 객체가
 *    buildSentryOptions 의 defaultEnv() 를 덮어써서, 빌드 시점에 인라인된 상수가 무용지물이 된다.
 *    (패키징 앱의 process.env 엔 아무것도 없다 → 영구 disabled. 실제로 그렇게 죽어 있었다.)
 *    undefined 를 그대로 넘겨 defaultEnv() 가 살아나게 한다.
 */
export function initSentryMain({ sentry = Sentry, env } = {}) {
  const options = buildSentryOptions({ env })
  if (!options.enabled) {
    console.log(`[Sentry] disabled (env=${options.environment}, prod-only)`)
    return { initialized: false, options }
  }
  const { enabled, ...initOptions } = options
  sentry.init(initOptions)
  console.log(`[Sentry] initialized (env=${options.environment}, release=${options.release})`)
  return { initialized: true, options }
}
