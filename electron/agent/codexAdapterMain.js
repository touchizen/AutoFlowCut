// 번들의 **엔트리**. 로직은 `codexAdapterEntry.js` 에 있다 — 그래야 프로세스를 띄우지 않고 테스트할 수 있다.
// (전에는 import 만 해도 뜨는 env 가드였는데, 그건 테스트가 실수로 서버를 띄우게 만든다.)
import { main } from './codexAdapterEntry.js'

main().catch((err) => {
  process.stderr.write(`[codex-adapter] ${err?.stack ?? err}\n`)
  process.exit(1)
})
