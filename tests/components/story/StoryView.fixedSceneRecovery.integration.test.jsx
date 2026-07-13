import { fireEvent, render, screen } from '@testing-library/react'
import { mkdir, mkdtemp, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'

vi.mock('../../../src/components/LiveTimeline', () => ({ default: () => <div data-testid="lt" /> }))
vi.mock('../../../src/components/Toast', () => ({ toast: { success: vi.fn(), error: vi.fn() } }))

import StoryView from '../../../src/components/story/StoryView.jsx'
import { createStepMachine } from '../../../electron/story/stepMachine.js'
import { defaultStoryState } from '../../../electron/story/storyStore.js'

const revision = 'recovery-revision'
const fixedScenes = [
  { ordinal: 1, storyId: 'story-a', rendererSceneId: 'scene-a' },
  { ordinal: 2, storyId: 'story-b', rendererSceneId: 'scene-b' },
]
const invalidBoard = [
  'scene,prompt,subtitle,speaker,duration',
  '1,Sunrise,Opening,narrator,3',
  '2,Sunset,Closing,,3',
].join('\n')

async function writeJson(filePath, value) {
  await mkdir(path.dirname(filePath), { recursive: true })
  await writeFile(filePath, JSON.stringify(value, null, 2), 'utf-8')
}

async function rejectedState(kind) {
  const projectPath = await mkdtemp(path.join(tmpdir(), `story-recovery-${kind}-`))
  await writeJson(path.join(projectPath, 'project.json'), {})
  if (kind === 'fully-synced') {
    const done = { status: 'done', updatedAt: '2026-07-13T00:00:00.000Z' }
    await writeJson(path.join(projectPath, 'story', 'story.json'), {
      ...defaultStoryState(),
      input: { type: 'manual', options: { language: 'ko' } },
      steps: { script: done, scenes: done, audio: done, prompts: done },
      pendingPushRevision: 4,
      lastPushedRevision: 4,
    })
    await writeFile(path.join(projectPath, 'story', 'script.md'), '# old story', 'utf-8')
    await writeJson(path.join(projectPath, 'story', 'scenes.json'), { scenes: [] })
  }
  const machine = createStepMachine({
    projectPath,
    llm: {},
    emit: vi.fn(),
    getApiKey: () => 'test-key',
  })
  await machine.open()
  await writeJson(path.join(projectPath, 'project.json'), {
    sceneMode: 'image-first',
    imageFirstVariant: 'storyboard',
    fixedSceneRevision: revision,
    fixedScenes,
  })

  await expect(machine.stageImageFirst({
    fixedSceneRevision: revision,
    imageFirstVariant: 'storyboard',
    fixedScenes,
    storyboardCsv: invalidBoard,
  })).resolves.toMatchObject({ success: false, error: 'storyboard-speaker-missing' })

  return machine.getState()
}

function pipeline(payload) {
  return {
    state: payload,
    scenes: payload.scenes || [],
    streamingText: '',
    scriptText: payload.scriptText || '',
    start: vi.fn(),
    abort: vi.fn(),
    openError: null,
    ttsPreview: vi.fn(),
    generateTitle: vi.fn(),
    generateSynopsis: vi.fn(),
    reviewSynopsis: vi.fn(),
    confirmSynopsis: vi.fn(),
    charactersConfirmed: payload.charactersConfirmed,
    characters: payload.characters || [],
    synopsisText: payload.synopsisText || '',
  }
}

describe('committed-but-unstaged recovery integration', () => {
  it.each([
    ['brand-new story', 'fresh'],
    ['fully-synced story (pending === last)', 'fully-synced'],
  ])('%s stage rejection renders a working recovery route', async (_label, kind) => {
    const state = await rejectedState(kind)
    const onReissueImageFirst = vi.fn()
    render(
      <StoryView
        pipeline={pipeline(state)}
        voices={[]}
        onClose={vi.fn()}
        onReissueImageFirst={onReissueImageFirst}
      />,
    )

    expect(screen.getByTestId('story-fixed-scene-alert')).toHaveAttribute('role', 'alert')
    fireEvent.click(screen.getByRole('button', { name: /이미지 세트 다시 임포트/ }))
    expect(onReissueImageFirst).toHaveBeenCalledTimes(1)
  })
})
