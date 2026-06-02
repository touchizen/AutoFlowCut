/**
 * Shell - Electron Desktop 외부 쉘
 *
 * 구 Flow(WebContentsView) 시절엔 좌/우 split 으로 네이티브 Flow 뷰와 App 을
 * 나눠 배치했으나, 공식 API(BYOK) 전환으로 Flow 뷰가 사라져 split 의 한쪽이
 * 빈 공간이 됐다. 이제 App 을 전체폭으로 렌더링한다. 생성 자산 라이브
 * 프리뷰(좌측 패널)는 모든 상태를 가진 App 내부에서 처리한다.
 */

import { I18nProvider } from './hooks/useI18n'
import { AuthProvider } from './contexts/AuthContext'
import { ToastProvider } from './components/Toast'
import { QuotaExhaustedModalProvider } from './components/QuotaExhaustedModal'
import App from './App'

function ShellContent() {
  return (
    <div
      className="shell-root"
      style={{ position: 'relative', height: '100vh', overflow: 'hidden' }}
    >
      <div className="app-content-full" style={{ position: 'absolute', inset: 0, overflow: 'auto' }}>
        <App />
      </div>
    </div>
  )
}

export default function Shell() {
  return (
    <I18nProvider>
      <AuthProvider>
        <ToastProvider>
          <QuotaExhaustedModalProvider>
            <ShellContent />
          </QuotaExhaustedModalProvider>
        </ToastProvider>
      </AuthProvider>
    </I18nProvider>
  )
}
