import { defineConfig } from 'vitest/config'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  define: {
    // 빌드 시 vite.config.js가 이 상수를 치환함. 테스트에서도 동일하게 정의해야 함.
    '__FUNCTION_SUFFIX__': JSON.stringify('_test'),
    '__APP_VERSION__': JSON.stringify('test')
  },
  test: {
    globals: true,
    environment: 'jsdom',
    setupFiles: ['./tests/setup.js'],
    include: ['tests/**/*.test.{js,jsx}'],
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
