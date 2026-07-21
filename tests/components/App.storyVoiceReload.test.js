// @vitest-environment node
/**
 * M3b 리뷰 Finding 1 — StoryView의 오디오 키 게이트 onKeySaved가 App의 handleTtsVoiceSearch로
 * "재조회"를 흉내내던 문제(그 함수는 query.length<2면 no-op하는 원격 검색이라 실제로는 아무 일도
 * 안 함, prod no-op). App.jsx가 별도의 provider 슬라이스 재로드 함수(reloadTtsVoicesForProvider)를
 * 갖고 그걸 StoryView에 onReloadVoices로 꽂는지 확인한다.
 *
 * M3b 2R 리뷰 Finding5 — 예전엔 이 파일이 reloadTtsVoicesForProvider의 "merge" 동작을 소스
 * 문자열(`mergeTtsVoices(vs.map(...))`)로 grep해 고정했다. 포매팅이 조금만 바뀌어도 깨지고,
 * 실행되지 않아 로직이 바뀌어도 안 잡히는 죽은 체크였다(Finding2가 그 merge를 REPLACE로 바꾸면서
 * 실제로 이 assertion을 못 쓰게 됐다). REPLACE 시맨틱과 elevenlabs 전용 list 파라미터의 실제
 * 동작 검증은 App.jsx가 쓰는 순수 함수(src/utils/ttsVoiceReload.js)를 직접 import해 실행하는
 * tests/utils/ttsVoiceReload.test.js로 옮겼다 — 이 파일은 "App이 그 함수들을 쓰고 StoryView에
 * 제대로 꽂았는지"(배선)만 남긴다.
 *
 * App.jsx는 3000줄 넘는 단일 컴포넌트라(다른 App.*.test.js들도 같은 접근 — 예:
 * App.emptyRefGateWiring.test.js) 여기서도 전체 렌더 대신 소스 슬라이스로 배선을 검증한다.
 * 실제 게이트 동작(onKeySaved→onReloadVoices 호출 계약)은
 * tests/components/story/storyAudioGate.test.jsx가 StoryView를 직접 렌더해서 검증한다.
 */
import fs from 'node:fs'
import { describe, expect, it } from 'vitest'
import { ttsListVoicesReloadParams, replaceTtsVoicesForProvider } from '../../src/utils/ttsVoiceReload.js'

const source = fs.readFileSync(new URL('../../src/App.jsx', import.meta.url), 'utf8')

const sliceBetween = (startToken, endToken, from = 0) => {
  const start = source.indexOf(startToken, from)
  const end = source.indexOf(endToken, start)
  return source.slice(start, end)
}

const reloadImpl = sliceBetween(
  'const reloadTtsVoicesForProvider = useCallback(',
  '// Flow 프로젝트가 준비되면',
)
const storyViewJsx = sliceBetween('<StoryView', '/>')

describe('App story voice reload wiring (Finding 1 / Finding 2 / Finding 5)', () => {
  it('reloadTtsVoicesForProvider가 존재하고 ttsListVoices 재조회 후 REPLACE 헬퍼로 반영한다(배선만 — 로직은 ttsVoiceReload.test.js가 직접 실행해 검증)', () => {
    expect(reloadImpl).toContain('window.electronAPI?.ttsListVoices?.(ttsListVoicesReloadParams(provider))')
    expect(reloadImpl).toContain('setTtsVoices((prev) => replaceTtsVoicesForProvider(prev, provider, vs))')
  })

  it('<StoryView>는 onReloadVoices=reloadTtsVoicesForProvider를 꽂는다', () => {
    expect(storyViewJsx).toContain('onReloadVoices={reloadTtsVoicesForProvider}')
  })

  it('onVoiceSearch(검색 전용, query<2 no-op)는 여전히 유지된다 — 재조회와는 별개 채널', () => {
    expect(storyViewJsx).toContain('onVoiceSearch={handleTtsVoiceSearch}')
  })

  // App.jsx가 실제로 import해서 쓰는 그 함수들이 맞는지(경로 스킴 불일치로 다른 구현을 테스트하고
  // 있는 게 아닌지) — 여기서도 직접 실행해서 확인한다. 전체 동작 매트릭스는 ttsVoiceReload.test.js.
  it('App.jsx가 쓰는 헬퍼는 실제로 REPLACE 시맨틱을 실행한다(스모크)', () => {
    expect(ttsListVoicesReloadParams('elevenlabs').maxSharedPages).toBe(10)
    const prev = [{ provider: 'typecast', id: 'stale' }]
    expect(replaceTtsVoicesForProvider(prev, 'typecast', [{ id: 'fresh' }])).toEqual([
      { provider: 'typecast', id: 'fresh' },
    ])
  })
})
