// electron/asyncMutex.js
/**
 * 간단한 async mutex (acquire/release).
 *
 * R14-P1: DOM 비디오 다운로드/이미지 업스케일은 공유 Flow session 의 `will-download` 에 무필터로
 *   리스너를 붙여 setSavePath 를 건다. 동시에 여러 개가 돌면 한 다운로드 이벤트에 모든 리스너가
 *   호출돼 "마지막에 붙은" setSavePath 가 이겨, 다른 media 의 파일이 엉뚱한 폴더로 저장되거나
 *   timeout 난다. 이 mutex 로 다운로드/업스케일을 직렬화한다.
 *
 * 사용:
 *   const release = await mutex.acquire()
 *   try { ... } finally { release() }
 */
export function createMutex() {
  let tail = Promise.resolve()
  return {
    async acquire() {
      let release = () => {}
      const next = new Promise((res) => { release = res })
      const prev = tail
      tail = tail.then(() => next)   // 다음 acquire 는 이번 release 까지 대기
      await prev                      // 내 차례까지 대기
      return release
    },
  }
}
