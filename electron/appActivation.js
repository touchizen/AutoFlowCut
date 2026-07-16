/**
 * app 'activate' 이벤트에서 창을 새로 만들어야 하는지 판정 (순수).
 *
 * macOS 의 'activate' 는 app 이 ready 되기 전에도 발생할 수 있다 — 콜드 스타트 중 Dock/아이콘
 * 재클릭 등. 그 시점에 창이 0개라고 곧장 createWindow() → new BrowserWindow() 를 부르면
 * "Cannot create BrowserWindow before app is ready" 로 크래시한다(Sentry 실측).
 * 그래서 ready 이후 + 열린 창이 0개일 때만 생성한다.
 *
 * @param {{ isReady: boolean, openWindowCount: number }} params
 * @returns {boolean}
 */
export function shouldCreateWindowOnActivate({ isReady, openWindowCount } = {}) {
  return isReady === true && openWindowCount === 0
}
