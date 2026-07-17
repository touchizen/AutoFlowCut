import { describe, it, expect, beforeEach, vi } from 'vitest'

/**
 * **dynamic-import 창 회귀 테스트** (Fable 3R).
 *
 * 2R 대응은 claude sink 캡처를 `await import` **앞**으로 옮겨, import 가 suspend 된 동안
 * 프로젝트가 전환돼도 A 의 호출이 B 의 sink 를 잡지 않게 했다. 나는 이 창을 "단위로 재현 불가"라
 * 적고 커버리지를 포기했는데 — **거짓이었다.** vi.mock factory 를 async 로 게이트하면 import 를
 * 임의로 suspend 시킬 수 있고, 그 창에서 sink 를 교체해 정확히 이 경로를 찌른다.
 *
 * 이 테스트가 죽이는 뮤테이션(MUTATION-D): defaultQuery 의 `const sink = claudeUsageSink` 를
 * `await import` 뒤로 되돌리는 것 = 2R 이 고친 바로 그 버그. Fable 이 그 뮤테이션이 다른 어떤
 * 테스트로도 안 잡힘을 실측했다.
 */

let releaseImport
let importStarted // factory 진입을 알리는 promise (테스트가 이걸로 창 진입을 동기화)
let signalStarted

vi.mock('@anthropic-ai/claude-agent-sdk', async () => {
  signalStarted?.()
  await new Promise((r) => { releaseImport = r }) // import 를 여기서 suspend — 테스트가 열어준다
  return {
    query: () => (async function* () {
      yield { type: 'result', subtype: 'success', result: '제목', usage: { input_tokens: 100, output_tokens: 9 } }
    })(),
  }
})

const { generateTitle, setClaudeUsageSink } = await import('../../../../electron/api/llm/llmClaude.js')

describe('dynamic-import 창 — 캡처는 import 전이어야 한다', () => {
  beforeEach(() => {
    setClaudeUsageSink(null)
    releaseImport = null
    importStarted = new Promise((r) => { signalStarted = r })
  })

  it('import suspend 중 전역 sink 가 B 로 바뀌어도 usage 는 A 로 간다', async () => {
    const a = []
    const b = []
    setClaudeUsageSink((u) => a.push(u)) // A = 호출 시작 시점의 sink

    const p = generateTitle('# 대본', {}) // defaultQuery → const sink = A → await import(suspend)
    await importStarted // factory 진입 확인 = import 가 suspend 된 상태

    setClaudeUsageSink((u) => b.push(u)) // 이 창에서 프로젝트 전환이 sink 를 B 로 바꾼다
    releaseImport() // import resume → 소비 시작
    await p

    expect(a).toEqual([{ input: 100, output: 9 }]) // import 전에 A 를 잡았다
    expect(b).toEqual([]) // B 는 오염되지 않는다 (MUTATION-D 면 여기로 샌다)
  })
})
