import { defineConfig, loadEnv } from 'vite'
import react from '@vitejs/plugin-react'
// 'simple' 대신 일반 vite-plugin-electron 사용 — 'simple' 은 preload 에
// inlineDynamicImports: true 를 강제해서 multiple input (preload + flow-preload) 빌드 시 실패함.
// 일반 plugin 은 entries 배열을 받아 각 entry 를 single input 으로 빌드 (호환).
import electron from 'vite-plugin-electron'
import renderer from 'vite-plugin-electron-renderer'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'

const __dirname = dirname(fileURLToPath(import.meta.url))
const pkg = JSON.parse(readFileSync(resolve(__dirname, 'package.json'), 'utf8'))
const BUILD_NUMBER = Number(pkg.buildNumber ?? 0)

export default defineConfig(({ command, mode }) => {
  // 환경변수 로드 (mode에 따라 .env 또는 .env.production)
  const env = loadEnv(mode, process.cwd(), '')
  const functionEnv = env.VITE_FUNCTION_ENV || 'test'

  console.log(`\n🔧 Build mode: ${mode}, Function env: ${functionEnv} (${functionEnv === 'prod' ? '_prod' : '_test'} suffix)\n`)

  const isProduction = mode === 'production'

  // Sentry env vars to inline into main process bundle so packaged builds
  // (which don't ship .env) still get the DSN/toggle at runtime. Renderer
  // already gets VITE_* via import.meta.env automatically.
  const mainDefine = {
    'process.env.SENTRY_DSN': JSON.stringify(env.SENTRY_DSN || ''),
    'process.env.ENABLE_SENTRY': JSON.stringify(env.ENABLE_SENTRY || '0'),
    'process.env.SENTRY_TRACES_SAMPLE_RATE': JSON.stringify(env.SENTRY_TRACES_SAMPLE_RATE || '0.1'),
    'process.env.VITE_FUNCTION_ENV': JSON.stringify(functionEnv),
  }

  return {
    plugins: [
      react(),
      // main process 만 vite-plugin-electron 으로. preload 들은 esbuild script 로 (vite-plugin-electron
      // 이 rollupOptions.output.format 을 override 해서 ESM 으로 출력하는 문제 회피).
      electron([
        {
          entry: 'electron/main.js',
          onstart(args) { args.startup() },
          vite: {
            define: mainDefine,
            build: {
              outDir: 'dist-electron',
              // vite-plugin-electron 은 emptyOutDir 기본값이 false 라, 빌드마다 해시가 바뀌는
              // main-<hash>.js 청크가 계속 쌓인다 (실측: 196개 / 645MB). files 글롭이
              // dist-electron/** 을 통째로 넣으므로 그 잔해가 전부 패키지에 실린다.
              // dev(serve) 에서는 켜면 안 된다 — vite 기동 전에 esbuild 로 만들어 둔
              // preload.cjs / flow-preload.cjs 가 main 리빌드마다 지워진다.
              emptyOutDir: command === 'build',
              rollupOptions: {
                external: ['electron']
              }
            },
            // ⚠️ main 프로세스에서는 console 을 지우지 않는다. @sentry/electron 은
            //   node.consoleIntegration() 을 기본 탑재해 main 의 console 출력을 breadcrumb 으로
            //   수집하는데, drop 하면 그 재료가 사라져 Sentry 이벤트에 [Flow API]/[TrustedClick]
            //   로그 트레일이 하나도 안 붙는다 — 사용자에게 로그를 요청하지 않아도 되게 만드는
            //   바로 그 부분이다. 패키징 앱은 터미널이 없어 main stdout 이 사용자에게 보이지도
            //   않으므로 지울 이유가 없다. (renderer 는 아래에서 계속 drop 한다 — DevTools 로
            //   사용자에게 노출되므로.) 프롬프트 등 사용자 콘텐츠는 로그에 찍지 않으며,
            //   sentry-init 의 beforeBreadcrumb 이 2차 방어선이다.
            esbuild: isProduction ? { drop: ['debugger'] } : {}
          }
        },
      ]),
      renderer()
      // preload (electron/preload.js) + flow-preload (electron/flow-preload.js) 둘 다
      // package.json scripts 의 esbuild step 으로 CJS 빌드.
    ],
    // renderer (React) — production에서 console/debugger 제거
    esbuild: isProduction ? { drop: ['console', 'debugger'] } : {},
    define: {
      '__APP_VERSION__': JSON.stringify(process.env.npm_package_version || pkg.version || '0.1.0'),
      '__BUILD_NUMBER__': JSON.stringify(BUILD_NUMBER),
      '__BUILD_TARGET__': JSON.stringify(process.env.VITE_BUILD_TARGET || 'nsis'),
      // Compile-time constant — replaces `__FUNCTION_SUFFIX__` in source with
      // the resolved "_prod" or "_test" string. Keeps the unused branch out
      // of the production bundle entirely, so a grep for "_test" on a prod
      // build finds nothing (vs. leaving an if/else in code where the dead
      // branch's string literal would still land in the output).
      '__FUNCTION_SUFFIX__': JSON.stringify(functionEnv === 'prod' ? '_prod' : '_test')
    }
  }
})
