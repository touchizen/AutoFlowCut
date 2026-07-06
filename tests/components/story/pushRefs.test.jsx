/**
 * BUG #1 회귀 — src/App.jsx onPushScenes(~line 512-545).
 *
 * 시나리오: onPushCharacters가 먼저 캐릭터 레퍼런스를 저장하고 referencesRef.current를
 * 갱신한다. 뒤이은 onPushScenes가 같은 storyCharacters를 받으면
 * upsertStoryCharacterRefs(referencesRef.current, payload.storyCharacters)의 결과가
 * referencesRef.current와 참조 동일(=이미 반영됨)해서 `nextReferences`가 undefined로
 * 남는다. 버그 버전은 그 undefined를 그대로 saveCurrentProjectWithPayload({ references:
 * nextReferences })에 넘겼는데, useProjectData.buildProjectPayload(~line 1120-1124)는
 * references 인자가 undefined면 훅의 render-closure `references`(리렌더 전이라 여전히
 * 옛 값)로 폴백한다 — 그 결과 방금 추가된 캐릭터 카드가 저장에서 빠진다(재로드 시 소실).
 * 고침은 `nextReferences ?? referencesRef.current`로 항상 최신 스냅샷을 넘기는 것.
 *
 * App.jsx는 2800+ 줄에 훅 20개 이상을 조립하는 컴포넌트라 전체 렌더 하네스는 이 저장소
 * 관례에서도 쓰지 않는다(tests/components/AppFlowSplitLayout.test.jsx 참고 — App.jsx와
 * 같은 순수 헬퍼를 뽑아 그 헬퍼만 검증). onPushScenes는 별도로 export된 순수 함수가
 * 아니라 App() 클로저 내부에 인라인돼 있어 동일하게 추출할 수 없다. 그래서 이 테스트는
 * App.jsx가 실제로 사용하는 두 real 모듈 — upsertStoryCharacterRefs(실 유틸)과
 * useProjectData(실 훅, saveCurrentProjectWithPayload/buildProjectPayload 실 폴백 로직) —
 * 를 그대로 사용해 onPushCharacters→onPushScenes 시퀀스를 재현하고, App.jsx의 정확한
 * save 호출 표현식(버그 버전 vs 고침 버전)이 저장 payload에 미치는 실제 효과를 검증한다.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { renderHook, act } from '@testing-library/react'
import { useProjectData } from '../../../src/hooks/useProjectData'
import { fileSystemAPI } from '../../../src/hooks/useFileSystem'
import { upsertStoryCharacterRefs } from '../../../src/utils/storyCharacterRefs'

vi.mock('../../../src/hooks/useFileSystem', () => ({
  fileSystemAPI: {
    loadProjectData: vi.fn(),
    getResourcePath: vi.fn(),
    readResource: vi.fn(),
    readHistoryMetadata: vi.fn(),
    getHistory: vi.fn(),
    projectExists: vi.fn(),
    saveProjectData: vi.fn(),
  },
}))

vi.mock('../../../src/services/mediaSync', () => ({
  syncVideosIntoScenes: vi.fn(),
}))

vi.mock('../../../src/services/videoRecovery', () => ({
  recoverInFlightVideos: vi.fn(),
}))

describe('onPushScenes references 스냅샷 (App.jsx BUG #1 회귀)', () => {
  beforeEach(() => {
    vi.resetAllMocks()
    localStorage.clear()
    fileSystemAPI.projectExists.mockResolvedValue(true)
    fileSystemAPI.saveProjectData.mockResolvedValue({ success: true })
  })

  function setup() {
    // App.jsx 마운트 시점의 렌더 클로저 references — onPushCharacters가 저장한 뒤에도
    // (mock setReferences는 실제 리렌더를 일으키지 않으므로) 이 값은 그대로 stale하게 남는다.
    const { result } = renderHook(() =>
      useProjectData({
        settings: { projectName: 'p', saveMode: 'folder', aspectRatio: '16:9', defaultDuration: 3 },
        setSettings: vi.fn(),
        scenes: [], references: [], setScenes: vi.fn(), setReferences: vi.fn(),
        videoScenes: [], setVideoScenes: vi.fn(),
        framePairs: [], setFramePairs: vi.fn(),
        selectedStyleRefId: null, setSelectedStyleRefId: vi.fn(),
        srtTrack: [], setSrtTrack: vi.fn(),
        openSettings: vi.fn(), onAudioSwitch: vi.fn(), genAPI: null,
      }),
    )
    return { result }
  }

  const storyCharacters = [{ name: '민수', appearance: 'tall man in black coat' }]

  it('버그 재현: nextReferences를 그대로 넘기면(App.jsx 수정 전 코드) 방금 저장한 캐릭터 카드가 저장 payload에서 빠진다', async () => {
    const { result } = setup()

    // 1) onPushCharacters — referencesRef.current를 최신 refs로 갱신(App.jsx L497-506).
    const referencesRef = { current: [] }
    const { references: afterCharacters } = upsertStoryCharacterRefs(referencesRef.current, storyCharacters)
    await act(async () => {
      await result.current.saveCurrentProjectWithPayload({ references: afterCharacters })
    })
    referencesRef.current = afterCharacters

    // 2) onPushScenes — 같은 storyCharacters이므로 upsert 결과가 referencesRef.current와
    //    참조 동일 → nextReferences는 undefined로 남는다(App.jsx L521-527).
    const { references: upserted } = upsertStoryCharacterRefs(referencesRef.current, storyCharacters)
    expect(upserted).toBe(referencesRef.current) // 전제 확인: 참조 동일(변경 없음)
    let nextReferences
    if (upserted !== referencesRef.current) nextReferences = upserted

    // 버그 버전 호출: App.jsx 수정 전 L540과 동일한 인자.
    await act(async () => {
      await result.current.saveCurrentProjectWithPayload({ scenes: [{ id: 's1' }], srtTrack: [], references: nextReferences })
    })

    const lastCall = fileSystemAPI.saveProjectData.mock.calls.at(-1)
    const payload = lastCall[1]
    // 버그: buildProjectPayload가 undefined references를 훅의 stale closure(빈 배열)로
    // 폴백해서, 방금 추가된 '민수' 카드가 두 번째 저장에서 사라진다.
    expect(payload.references.some((r) => r.name === '민수')).toBe(false)
  })

  it('고침 확인: nextReferences ?? referencesRef.current를 넘기면 캐릭터 카드가 저장 payload에 계속 남는다', async () => {
    const { result } = setup()

    const referencesRef = { current: [] }
    const { references: afterCharacters } = upsertStoryCharacterRefs(referencesRef.current, storyCharacters)
    await act(async () => {
      await result.current.saveCurrentProjectWithPayload({ references: afterCharacters })
    })
    referencesRef.current = afterCharacters

    const { references: upserted } = upsertStoryCharacterRefs(referencesRef.current, storyCharacters)
    let nextReferences
    if (upserted !== referencesRef.current) nextReferences = upserted

    // 고침 버전 호출: App.jsx 수정 후 L540과 동일한 인자 — nextReferences ?? referencesRef.current.
    await act(async () => {
      await result.current.saveCurrentProjectWithPayload({
        scenes: [{ id: 's1' }],
        srtTrack: [],
        references: nextReferences ?? referencesRef.current,
      })
    })

    const lastCall = fileSystemAPI.saveProjectData.mock.calls.at(-1)
    const payload = lastCall[1]
    expect(payload.references.some((r) => r.name === '민수')).toBe(true)
  })
})
