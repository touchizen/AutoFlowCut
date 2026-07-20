// @vitest-environment node
/**
 * M3b 리뷰 Finding 1 — StoryView의 오디오 키 게이트 onKeySaved가 App의 handleTtsVoiceSearch로
 * "재조회"를 흉내내던 문제(그 함수는 query.length<2면 no-op하는 원격 검색이라 실제로는 아무 일도
 * 안 함, prod no-op). App.jsx가 별도의 provider 슬라이스 재로드 함수(reloadTtsVoicesForProvider)를
 * 갖고 그걸 StoryView에 onReloadVoices로 꽂는지 소스 레벨로 확인한다.
 *
 * App.jsx는 3000줄 넘는 단일 컴포넌트라(다른 App.*.test.js들도 같은 접근 — 예:
 * App.emptyRefGateWiring.test.js) 여기서도 전체 렌더 대신 소스 슬라이스로 배선을 검증한다.
 * 실제 게이트 동작(onKeySaved→onReloadVoices 호출 계약)은
 * tests/components/story/storyAudioGate.test.jsx가 StoryView를 직접 렌더해서 검증한다.
 */
import fs from 'node:fs'
import { describe, expect, it } from 'vitest'

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

describe('App story voice reload wiring (Finding 1)', () => {
  it('reloadTtsVoicesForProvider가 존재하고 ttsListVoices 전체 재조회 후 mergeTtsVoices로 병합한다', () => {
    expect(reloadImpl).toContain('window.electronAPI?.ttsListVoices?.(')
    expect(reloadImpl).toContain('provider,')
    expect(reloadImpl).toContain('mergeTtsVoices(vs.map((v) => ({ ...v, provider })))')
  })

  it('<StoryView>는 onReloadVoices=reloadTtsVoicesForProvider를 꽂는다', () => {
    expect(storyViewJsx).toContain('onReloadVoices={reloadTtsVoicesForProvider}')
  })

  it('onVoiceSearch(검색 전용, query<2 no-op)는 여전히 유지된다 — 재조회와는 별개 채널', () => {
    expect(storyViewJsx).toContain('onVoiceSearch={handleTtsVoiceSearch}')
  })
})
