/**
 * FrameToVideoPanel — image prompt single-source-of-truth (scene.prompt)
 *
 * 회귀 가드:
 *   - 행 생성 시 pair.prompt 는 scene.prompt 스냅샷이지만, 이후 scene 본체에서 prompt 가 바뀌면
 *     image 모드 input value 는 scene 의 최신 prompt 를 따라간다.
 *   - image input 편집은 onScenePromptUpdate (scene 본체) 로 라우팅. updatePair 는 호출 X.
 *   - gallery-rooted (ownerSceneId=null) 행은 여전히 pair.prompt 사용 + updatePair 로 갱신.
 */

import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import FrameToVideoPanel from '../../src/components/FrameToVideoPanel'

const t = (key) => key

function renderPanel({ scenes, videoScenes, framePairs, onUpdate, onScenePromptUpdate, onSceneVideoPromptUpdate, promptSource = 'image' } = {}) {
  const _onUpdate = onUpdate ?? vi.fn()
  const _onSceneUpdate = onScenePromptUpdate ?? vi.fn()
  const _onSceneVideoUpdate = onSceneVideoPromptUpdate ?? vi.fn()
  const utils = render(
    <FrameToVideoPanel
      scenes={scenes ?? []}
      videoScenes={videoScenes ?? []}
      framePairs={framePairs ?? []}
      onUpdate={_onUpdate}
      onScenePromptUpdate={_onSceneUpdate}
      onSceneVideoPromptUpdate={_onSceneVideoUpdate}
      promptSource={promptSource}
      onPromptSourceChange={() => {}}
      onShowSceneDetail={() => {}}
      onVideoRetry={() => {}}
      disabled={false}
      t={t}
      galleryItems={[]}
      galleryLoading={false}
      onLoadGallery={() => {}}
    />
  )
  return {
    ...utils,
    onUpdate: _onUpdate,
    onScenePromptUpdate: _onSceneUpdate,
    onSceneVideoPromptUpdate: _onSceneVideoUpdate,
  }
}

describe('FrameToVideoPanel — image prompt single source of truth', () => {
  it('scene-bound 행: scene.prompt 가 input value (pair.prompt 스냅샷 무시)', () => {
    const scenes = [{ id: 'sc1', mediaId: 'm1', prompt: 'CURRENT image prompt' }]
    const framePairs = [{
      id: 'fp_1',
      ownerSceneId: 'sc1',
      startSceneId: 'sc1',
      endSceneId: '',
      prompt: 'STALE snapshot',  // 행 생성 시 옛 값
      status: 'waiting',
    }]

    renderPanel({ scenes, framePairs })

    // prompt input 에 scene 의 현재값이 표시돼야 함 (스냅샷 아님)
    const input = screen.getByPlaceholderText('frameToVideo.promptPlaceholder')
    expect(input.value).toBe('CURRENT image prompt')
  })

  it('scene-bound 행: input 편집 시 onScenePromptUpdate 호출 (updatePair 호출 X)', () => {
    const scenes = [{ id: 'sc1', mediaId: 'm1', prompt: 'old' }]
    const framePairs = [{
      id: 'fp_1', ownerSceneId: 'sc1', startSceneId: 'sc1', endSceneId: '',
      prompt: 'old', status: 'waiting',
    }]
    const onUpdate = vi.fn()
    const onScenePromptUpdate = vi.fn()

    renderPanel({ scenes, framePairs, onUpdate, onScenePromptUpdate })

    const input = screen.getByPlaceholderText('frameToVideo.promptPlaceholder')
    fireEvent.change(input, { target: { value: 'new image prompt' } })

    // scene 본체로 라우팅
    expect(onScenePromptUpdate).toHaveBeenCalledWith('sc1', 'new image prompt')
    // framePairs 자체에는 prompt 갱신을 안 함 (다른 onUpdate 호출들은 auto-add 등으로 발생 가능하나,
    // 이 input 의 onChange 결과로 추가 호출은 없어야 함)
    const promptUpdateCalls = onUpdate.mock.calls.filter(c => {
      const arg = typeof c[0] === 'function' ? c[0](framePairs) : c[0]
      // 이 framePair 의 prompt 가 'new image prompt' 로 변경된 호출이 있는지
      return Array.isArray(arg) && arg.some(p => p?.id === 'fp_1' && p?.prompt === 'new image prompt')
    })
    expect(promptUpdateCalls.length).toBe(0)
  })

  it('gallery-rooted 행(ownerSceneId=null): pair.prompt 가 input value, 편집은 updatePair', () => {
    const scenes = []
    const framePairs = [{
      id: 'fp_1',
      ownerSceneId: null,  // gallery-rooted
      startSceneId: 'gallery::media_xxx',
      endSceneId: '',
      prompt: 'GALLERY prompt',
      status: 'waiting',
    }]
    const onUpdate = vi.fn()
    const onScenePromptUpdate = vi.fn()

    renderPanel({ scenes, framePairs, onUpdate, onScenePromptUpdate })

    const input = screen.getByPlaceholderText('frameToVideo.promptPlaceholder')
    expect(input.value).toBe('GALLERY prompt')

    fireEvent.change(input, { target: { value: 'gallery edited' } })

    // scene 진실 소스가 없는 행이므로 scene 호출 안 함
    expect(onScenePromptUpdate).not.toHaveBeenCalled()
    // updatePair 경로 — onUpdate 가 호출되고 fp_1 의 prompt 가 갱신돼야 함
    const promptUpdateCalls = onUpdate.mock.calls.filter(c => {
      const arg = typeof c[0] === 'function' ? c[0](framePairs) : c[0]
      return Array.isArray(arg) && arg.some(p => p?.id === 'fp_1' && p?.prompt === 'gallery edited')
    })
    expect(promptUpdateCalls.length).toBeGreaterThan(0)
  })
})

describe('FrameToVideoPanel — video prompt single source of truth', () => {
  it('scene-bound 행: owner T2V prompt 가 input value (pair.videoPrompt legacy 무시)', () => {
    // 회귀: pair.videoPrompt 가 채워진 legacy 상태에서도 T2V 탭에서 prompt 바꾸면 sync 돼야 함.
    // ID 컨벤션: scene_N ↔ vscene_N — useVideoScenes 의 deriveVideoScene 가 매핑.
    const scenes = [{ id: 'scene_1', mediaId: 'm1', prompt: 'image', videoT2VPrompt: 'CURRENT T2V prompt' }]
    const videoScenes = [{ id: 'vscene_1', prompt: 'CURRENT T2V prompt' }]
    const framePairs = [{
      id: 'fp_1', ownerSceneId: 'scene_1', startSceneId: 'scene_1', endSceneId: '',
      prompt: 'image', videoPrompt: 'LEGACY override', status: 'waiting',
    }]

    renderPanel({ scenes, videoScenes, framePairs, promptSource: 'video' })

    const input = screen.getByPlaceholderText('frameToVideo.videoPromptPlaceholder')
    // owner T2V 가 우선 — legacy pair.videoPrompt 무시
    expect(input.value).toBe('CURRENT T2V prompt')
  })

  it('scene-bound 행: video input 편집은 onSceneVideoPromptUpdate 로 라우팅 (updatePair 호출 X)', () => {
    const scenes = [{ id: 'scene_1', mediaId: 'm1', prompt: 'image', videoT2VPrompt: 'old' }]
    const videoScenes = [{ id: 'vscene_1', prompt: 'old' }]
    const framePairs = [{
      id: 'fp_1', ownerSceneId: 'scene_1', startSceneId: 'scene_1', endSceneId: '',
      prompt: 'image', videoPrompt: '', status: 'waiting',
    }]
    const onUpdate = vi.fn()
    const onSceneVideoPromptUpdate = vi.fn()

    renderPanel({
      scenes, videoScenes, framePairs, onUpdate, onSceneVideoPromptUpdate,
      promptSource: 'video',
    })

    const input = screen.getByPlaceholderText('frameToVideo.videoPromptPlaceholder')
    fireEvent.change(input, { target: { value: 'new T2V' } })

    expect(onSceneVideoPromptUpdate).toHaveBeenCalledWith('scene_1', 'new T2V')
    // framePair.videoPrompt 갱신 호출 없음
    const videoPromptUpdateCalls = onUpdate.mock.calls.filter(c => {
      const arg = typeof c[0] === 'function' ? c[0](framePairs) : c[0]
      return Array.isArray(arg) && arg.some(p => p?.id === 'fp_1' && p?.videoPrompt === 'new T2V')
    })
    expect(videoPromptUpdateCalls.length).toBe(0)
  })

  it('gallery-rooted 행(ownerSceneId=null): pair.videoPrompt 가 value, 편집은 updatePair', () => {
    const framePairs = [{
      id: 'fp_1', ownerSceneId: null, startSceneId: 'gallery::xxx', endSceneId: '',
      prompt: '', videoPrompt: 'gallery video', status: 'waiting',
    }]
    const onUpdate = vi.fn()
    const onSceneVideoPromptUpdate = vi.fn()

    renderPanel({
      scenes: [], videoScenes: [], framePairs, onUpdate, onSceneVideoPromptUpdate,
      promptSource: 'video',
    })

    const input = screen.getByPlaceholderText('frameToVideo.videoPromptPlaceholder')
    expect(input.value).toBe('gallery video')

    fireEvent.change(input, { target: { value: 'gallery video edited' } })

    expect(onSceneVideoPromptUpdate).not.toHaveBeenCalled()
    const calls = onUpdate.mock.calls.filter(c => {
      const arg = typeof c[0] === 'function' ? c[0](framePairs) : c[0]
      return Array.isArray(arg) && arg.some(p => p?.id === 'fp_1' && p?.videoPrompt === 'gallery video edited')
    })
    expect(calls.length).toBeGreaterThan(0)
  })

  it('scene-bound 행: scene.videoT2VPrompt="" (deletion) → 빈 input, legacy pair.videoPrompt 부활 X', () => {
    // 회귀 (P2 review): useVideoScenes 의 truthy 필터 때문에 빈 문자열이면 vscene 이 사라져,
    // matchedV 기반 lookup 으로는 사용자가 prompt 를 "지워도" legacy pair.videoPrompt 가 다시 보임.
    // owner scene 의 videoT2VPrompt 필드 존재 여부로 authoritative 판단해야 진짜 비워짐.
    const scenes = [{ id: 'scene_1', mediaId: 'm1', prompt: 'image', videoT2VPrompt: '' }]
    // useVideoScenes 가 truthy filter 후 빈 videoScenes 산출
    const videoScenes = []
    const framePairs = [{
      id: 'fp_1', ownerSceneId: 'scene_1', startSceneId: 'scene_1', endSceneId: '',
      prompt: 'image', videoPrompt: 'LEGACY-LEAK', status: 'waiting',
    }]

    renderPanel({ scenes, videoScenes, framePairs, promptSource: 'video' })

    const input = screen.getByPlaceholderText('frameToVideo.videoPromptPlaceholder')
    expect(input.value).toBe('')  // legacy 'LEGACY-LEAK' 부활하면 안 됨
  })

  it('scene-bound 행 + scene 에 videoT2VPrompt 필드 자체 없음 → pair.videoPrompt 폴백', () => {
    // 이미지만 만든 scene (legacy/T2V 미정의) — 사용자 데이터 보존 위해 pair fallback.
    const scenes = [{ id: 'scene_1', mediaId: 'm1', prompt: 'image' }]  // videoT2VPrompt 미정의
    const framePairs = [{
      id: 'fp_1', ownerSceneId: 'scene_1', startSceneId: 'scene_1', endSceneId: '',
      prompt: 'image', videoPrompt: 'LEGACY pair video', status: 'waiting',
    }]

    renderPanel({ scenes, videoScenes: [], framePairs, promptSource: 'video' })

    const input = screen.getByPlaceholderText('frameToVideo.videoPromptPlaceholder')
    expect(input.value).toBe('LEGACY pair video')
  })
})
