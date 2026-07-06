// @vitest-environment node
// 버그: 세그먼트가 참조하는 화자(특히 narrator)가 state.speakers에 없으면 오디오 탭 성우 매핑에
// 그 화자가 누락된다. open 시 scenes.json 기준으로 self-heal해 재분리 없이 살아나야 한다.
import { describe, it, expect, beforeEach } from 'vitest'
import { mkdtemp, mkdir, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { createStepMachine } from '../../../electron/story/stepMachine.js'

async function seed(dir, story, scenes) {
  await mkdir(path.join(dir, 'story'), { recursive: true })
  await writeFile(path.join(dir, 'story', 'story.json'), JSON.stringify(story))
  await writeFile(path.join(dir, 'story', 'scenes.json'), JSON.stringify({ scenes }))
  await writeFile(path.join(dir, 'story', 'script.md'), '# 대본')
}

describe('open 시 참조 화자 self-heal (narrator 누락 복구)', () => {
  let dir
  beforeEach(async () => { dir = await mkdtemp(path.join(tmpdir(), 'sm-heal-')) })

  const doneSteps = { script: { status: 'done' }, scenes: { status: 'done' }, audio: { status: 'done' }, prompts: { status: 'done' } }

  it('scenes가 narrator를 참조하는데 state.speakers엔 없으면 open 후 narrator가 채워진다', async () => {
    await seed(dir,
      { steps: doneSteps, speakers: [{ id: 'seojun', name: '서준', voice: { provider: 'elevenlabs', voiceId: 'x' } }] },
      [{ segments: [{ speaker: 'narrator', text: '한밤중', id: 's1' }, { speaker: 'seojun', text: '누구세요', id: 's2' }] }],
    )
    const machine = createStepMachine({ projectPath: dir, llm: {}, emit: () => {}, getApiKey: () => 'k' })
    const r = await machine.open()
    const narr = r.state.speakers.find((sp) => sp.id === 'narrator' || sp.name === '나레이션')
    expect(narr).toBeTruthy()
    // 기존 화자(voice 배정)는 보존
    expect(r.state.speakers.find((sp) => sp.id === 'seojun')?.voice?.voiceId).toBe('x')
  })

  it('이미 모든 참조 화자가 있으면 speakers를 바꾸지 않는다', async () => {
    await seed(dir,
      { steps: doneSteps, speakers: [{ id: 'narrator', name: '나레이션' }, { id: 'seojun', name: '서준' }] },
      [{ segments: [{ speaker: 'narrator', text: 'a', id: 's1' }, { speaker: 'seojun', text: 'b', id: 's2' }] }],
    )
    const machine = createStepMachine({ projectPath: dir, llm: {}, emit: () => {}, getApiKey: () => 'k' })
    const r = await machine.open()
    expect(r.state.speakers).toHaveLength(2)
  })
})
