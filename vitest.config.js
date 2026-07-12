import { defineConfig } from 'vitest/config'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  define: {
    // 빌드 시 vite.config.js가 이 상수를 치환함. 테스트에서도 동일하게 정의해야 함.
    '__FUNCTION_SUFFIX__': JSON.stringify('_test'),
    '__APP_VERSION__': JSON.stringify('test'),
    '__BUILD_TARGET__': JSON.stringify('nsis')
  },
  test: {
    globals: true,
    environment: 'jsdom',
    setupFiles: ['./tests/setup.js'],
    include: ['tests/**/*.test.{js,jsx}'],
    // 라이브 스파이크(실제 CLI/네트워크/최대 60분)는 일반 실행과 CI 에서 제외한다.
    // `npm run test:spike` (SPIKE=1 + vitest.spike.config.js) 로만 돈다. (M-1)
    exclude: ['**/node_modules/**', '**/dist/**', '**/dist-electron/**', 'tests/spike/**', 'tests/e2e/**'],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'html'],
      include: ['src/**/*.{js,jsx}'],
      exclude: [
        'src/main.jsx',
        'src/firebase/config.js',
        'src/stripe/**'
      ]
    }
  },
  resolve: {
    alias: {
      '@': '/src'
    }
  }
})
