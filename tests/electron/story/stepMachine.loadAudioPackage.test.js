/**
 * M2a-4a IP-A2 — stepMachine.loadAudioPackage()
 *
 * export(renderer)가 story 나레이션을 배치하려면 audio manifest 와 정합 기준
 * (lastPushedRevision)이 필요하다. renderer 엔 없으므로 main 이 한 번에 로드해 준다.
 *   - manifest(story/audio/manifest.json) + state.lastPushedRevision → { manifest, lastPushedRevision }
 *   - manifest 없으면(audio 미실행) null → 오디오 없이 export
 *   - 정합 판단(pushRevision 일치)은 renderer(prepareCloudRequest)가 함. 여기선 raw 값만 실어 줌.
 */
import { describe, it, expect, beforeEach } from 'vitest'
import { mkdtemp, mkdir, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { createStepMachine } from '../../../electron/story/stepMachine.js'
import { defaultStoryState } from '../../../electron/story/storyStore.js'

async function tmpProject() { return await mkdtemp(path.join(tmpdir(), 'story-loadaudio-')) }

function makeMachine(projectPath) {
  return createStepMachine({ projectPath, llm: {}, emit: () => {}, getApiKey: () => 'k' })
}

// manifest 가 있다는 건 audio 스텝이 성공해 조립까지 갔다는 뜻이다 — 그 상태(done)를 기본으로
// 쓴다. done 이 아닌데 manifest 가 남아 있는 경우는 아래 전용 테스트가 따로 세운다.
async function writeStory(projectPath, { lastPushedRevision, manifest, audioStatus = 'done', partial = false }) {
  const dir = path.join(projectPath, 'story')
  await mkdir(path.join(dir, 'audio'), { recursive: true })
  const base = defaultStoryState()
  const state = { ...base, lastPushedRevision, steps: { ...base.steps, audio: { ...base.steps.audio, status: audioStatus, ...(partial ? { partial: true } : {}) } } }
  await writeFile(path.join(dir, 'story.json'), JSON.stringify(state))
  if (manifest) await writeFile(path.join(dir, 'audio', 'manifest.json'), JSON.stringify(manifest))
}

describe('stepMachine.loadAudioPackage', () => {
  let projectPath
  beforeEach(async () => { projectPath = await tmpProject() })

  it('manifest + story.json 있으면 { manifest, lastPushedRevision } 반환', async () => {
    await writeStory(projectPath, {
      lastPushedRevision: 5,
      manifest: { version: 1, pushRevision: 5, segments: [{ id: 's1', type: 'narration', audioPath: '/p/story/audio/segments/s1.wav', startMs: 0, durationMs: 1000 }] },
    })
    const machine = makeMachine(projectPath)
    await machine.open()
    const pkg = await machine.loadAudioPackage()
    expect(pkg.manifest.pushRevision).toBe(5)
    expect(pkg.lastPushedRevision).toBe(5)
    expect(pkg.manifest.segments).toHaveLength(1)
  })

  it('manifest 없으면 null (audio 미실행 story)', async () => {
    // "미실행" 이 이 테스트의 전제다 — audio 가 done 인데 manifest 만 없으면 그건 어긋남이라
    // 별도 테스트가 throw 를 요구한다(아래).
    await writeStory(projectPath, { lastPushedRevision: 0, manifest: null, audioStatus: 'pending' })
    const machine = makeMachine(projectPath)
    await machine.open()
    expect(await machine.loadAudioPackage()).toBeNull()
  })

  it('open 전에 호출해도 state 를 로드해 lastPushedRevision 반영', async () => {
    await writeStory(projectPath, {
      lastPushedRevision: 3,
      manifest: { version: 1, pushRevision: 3, segments: [] },
    })
    const machine = makeMachine(projectPath)
    const pkg = await machine.loadAudioPackage()
    expect(pkg.lastPushedRevision).toBe(3)
  })

  // Codex finding 1(재검토): mismatch 를 null 로 뭉개면 현재 프로젝트의 manifest 가 조용히
  // 누락된다. machine 상태와 무관하게 "요청된 projectPath 의 디스크"를 직접 읽어야 교차 주입도
  // 막고(요청 경로 것만) 누락도 없다.
  it('요청 projectPath 의 manifest 를 직접 읽는다 (machine 상태 독립)', async () => {
    const other = await tmpProject()
    await writeStory(other, {
      lastPushedRevision: 9,
      manifest: { version: 1, pushRevision: 9, segments: [{ id: 'b1', type: 'narration', audioPath: '/p/story/audio/segments/b1.wav', startMs: 0, durationMs: 100 }] },
    })
    await writeStory(projectPath, {
      lastPushedRevision: 2,
      manifest: { version: 1, pushRevision: 2, segments: [{ id: 'a1', type: 'narration', audioPath: '/p/story/audio/segments/a1.wav', startMs: 0, durationMs: 200 }] },
    })
    const machine = makeMachine(projectPath) // machine 은 projectPath(A) 로 열림
    await machine.open()
    // B 경로 요청 → B manifest(9, b1) — A 것이 새지 않는다
    const pkgB = await machine.loadAudioPackage(other)
    expect(pkgB.manifest.pushRevision).toBe(9)
    expect(pkgB.manifest.segments[0].id).toBe('b1')
    expect(pkgB.lastPushedRevision).toBe(9)
    // 인자 없으면 자기(A)
    const pkgA = await machine.loadAudioPackage()
    expect(pkgA.manifest.pushRevision).toBe(2)
    expect(pkgA.manifest.segments[0].id).toBe('a1')
  })

  it('요청 projectPath 에 manifest 가 없으면 null', async () => {
    const other = await tmpProject() // manifest 없음
    await writeStory(projectPath, { lastPushedRevision: 1, manifest: { version: 1, pushRevision: 1, segments: [] } })
    const machine = makeMachine(projectPath)
    await machine.open()
    expect(await machine.loadAudioPackage(other)).toBeNull()
  })

  // audio 스텝이 done 이 아닌데 manifest 가 남아 있으면 그 manifest 는 **지금 오디오를 설명하지
  // 않는다**. 손상 manifest 와 같은 부류라 같은 처방(fail-fast)을 쓴다.
  //
  // 실제로 벌어지는 두 경로:
  //   - import 절단이 도중에 실패: 새 wav 는 이미 최종 경로에 덮어써졌는데 예외가 부분재시도
  //     병합보다 먼저 빠져나가 scenes.json/manifest 는 옛 실행 그대로다 → **옛 타이밍으로 새
  //     오디오를 export**한다. pushRevision 가드는 이걸 못 잡는다(둘 다 안 건드리므로 일치).
  //   - ③/④ 재실행: DOWNSTREAM 이 audio 를 pending 으로 되돌리지만 manifest 파일은 남는다
  //     → 바뀐 대본에 옛 오디오를 붙인다.
  it('audio 스텝이 done 이 아니면 throw — 옛 manifest 로 새 오디오를 내보내면 안 된다', async () => {
    await writeStory(projectPath, {
      lastPushedRevision: 5,
      manifest: { version: 1, pushRevision: 5, segments: [{ id: 's1', type: 'narration', audioPath: '/p/story/audio/segments/s1.wav', startMs: 0, durationMs: 1000 }] },
      audioStatus: 'error', // 절단이 도중에 실패한 상태
    })
    const machine = makeMachine(projectPath)
    await machine.open()
    await expect(machine.loadAudioPackage()).rejects.toThrow(/stale|out of date|audio/i)
  })

  it('③/④ 재실행으로 audio 가 pending 이 되면 남은 manifest 를 쓰지 않는다', async () => {
    await writeStory(projectPath, {
      lastPushedRevision: 5,
      manifest: { version: 1, pushRevision: 5, segments: [{ id: 's1', type: 'narration', audioPath: '/p/story/audio/segments/s1.wav', startMs: 0, durationMs: 1000 }] },
      audioStatus: 'pending',
    })
    const machine = makeMachine(projectPath)
    await machine.open()
    await expect(machine.loadAudioPackage()).rejects.toThrow()
  })

  // 게이트가 "manifest 없음"(= audio 미실행) 경로를 삼키면 안 된다 — 그건 오디오 없이 export 하는
  // 정상 흐름이라 여전히 null 이어야 한다. status 도 pending 이라 위 게이트와 겹친다.
  it('audio 미실행(manifest 없음 + pending)은 여전히 null — 오디오 없이 export', async () => {
    await writeStory(projectPath, { lastPushedRevision: 0, manifest: null, audioStatus: 'pending' })
    const machine = makeMachine(projectPath)
    await machine.open()
    expect(await machine.loadAudioPackage()).toBeNull()
  })

  // null 은 **"audio 미실행"** 하나만 뜻해야 한다 — 그래야 "오디오 없이 export" 가 맞는 처방이다.
  // loadText 는 모든 읽기 실패(EACCES/EISDIR/EIO…)를 null 로 접으므로, manifest 가 있는데 못 읽은
  // 경우까지 "audio 미실행" 으로 둔갑해 **오디오가 통째로 빠진 채 조용히 export** 된다.
  it('manifest 가 있는데 읽을 수 없으면 throw — 오디오 없이 조용히 export 되면 안 된다', async () => {
    await writeStory(projectPath, { lastPushedRevision: 1, manifest: null }) // audioStatus 기본 done
    // manifest.json 자리에 디렉토리를 둔다 → readFile 이 EISDIR. (chmod 는 root 에서 무력하다.)
    await mkdir(path.join(projectPath, 'story', 'audio', 'manifest.json'), { recursive: true })
    const machine = makeMachine(projectPath)
    await machine.open()
    // errorKind 가 있어야 renderer 가 번역한다 — 없으면 한국어 UI에 내부 영문 + 로컬 경로가 뜬다.
    await expect(machine.loadAudioPackage()).rejects.toMatchObject({ errorKind: 'story-audio-manifest-corrupt' })
  })

  it('읽기 실패 오류에 파일 경로를 싣지 않는다 — 오류는 IPC 를 건너가고 경로엔 계정명이 있다', async () => {
    await writeStory(projectPath, { lastPushedRevision: 1, manifest: null })
    await mkdir(path.join(projectPath, 'story', 'audio', 'manifest.json'), { recursive: true })
    const machine = makeMachine(projectPath)
    await machine.open()
    await expect(machine.loadAudioPackage()).rejects.toThrow(
      expect.not.stringContaining(projectPath)
    )
  })

  // audio 가 done 이라는 건 조립까지 갔다는 뜻이고, 조립은 manifest 를 쓴다. 그런데 manifest 가
  // 없다면 상태와 산출물이 어긋난 것이다. 여기서 null 을 주면 renderer 는 "audio 미실행" 으로 읽어
  // **나레이션 없이 조용히 export** 한다 — 사용자는 오디오를 만들었는데.
  it('audio 가 done 인데 manifest 가 없으면 throw — 오디오 미실행으로 뭉개면 안 된다', async () => {
    await writeStory(projectPath, { lastPushedRevision: 1, manifest: null, audioStatus: 'done' })
    const machine = makeMachine(projectPath)
    await machine.open()
    await expect(machine.loadAudioPackage()).rejects.toMatchObject({ errorKind: 'story-audio-stale-manifest' })
  })

  // "이 화자만 생성"은 오디오를 **만들고도** 조립을 건너뛰어 manifest 없이 pending 으로 끝난다.
  // 그 조합을 "미실행"으로 읽으면 방금 만든 나레이션이 **통째로 빠진 채 export 된다** — 사용자는
  // 만들었는데. pending + manifest 없음이 미실행인지 부분 실행인지는 **scenes.json 에 오디오가
  // 있나**로 갈린다.
  it('부분 실행으로 오디오가 만들어졌으면 pending 이어도 미실행으로 뭉개지 않는다', async () => {
    await writeStory(projectPath, { lastPushedRevision: 0, manifest: null, audioStatus: 'pending', partial: true })
    // onlySpeaker 가 남기는 모양: audioPath 는 있고 startMs 는 없다(조립 건너뜀).
    await writeFile(path.join(projectPath, 'story', 'scenes.json'), JSON.stringify({ scenes: [{ segments: [
      { id: 'n1', type: 'narration', speaker: 'narrator', status: 'done', audioPath: '/p/story/audio/segments/n1.wav', durationMs: 1000 },
    ] }] }))
    const machine = makeMachine(projectPath)
    await expect(machine.loadAudioPackage()).rejects.toMatchObject({ errorKind: 'story-audio-stale-manifest' })
  })

  // 세그먼트 미리듣기(synthPreview)도 scenes.json 에 status:'done'+audioPath 를 쓰면서 steps.audio 는
  // 안 건드린다 — pending + 오디오 존재의 **세 번째 생산자**다(부분 실행/부분재시도 말고).
  // 성우 고르며 몇 개 들어본 사용자가 (오디오는 나중에) export 하면 "부분 실행"이라며 막힌다 —
  // 오진단이고, diff 이전엔 오디오 없이 export 되던 흐름이다.
  // 디스크 모양으론 못 가른다: 둘 다 `pending + audioPath + startMs 없음`으로 **동일하다**.
  // 그래서 부분 실행이 스스로 표식(steps.audio.partial)을 남긴다 — 그게 유일하게 정직한 신호다.
  it('미리듣기만 한 프로젝트는 막지 않는다 — 부분 실행이 아니다', async () => {
    await writeStory(projectPath, { lastPushedRevision: 0, manifest: null, audioStatus: 'pending' })
    await writeFile(path.join(projectPath, 'story', 'scenes.json'), JSON.stringify({ scenes: [{ segments: [
      // synthPreview 산출물: audioPath 는 있고 startMs 는 없다 — 부분 실행과 모양이 같다.
      { id: 'n1', type: 'narration', speaker: 'narrator', status: 'done', audioPath: '/p/story/audio/segments/n1.wav', durationMs: 1000 },
    ] }] }))
    const machine = makeMachine(projectPath)
    expect(await machine.loadAudioPackage()).toBeNull()
  })

  it('오디오가 하나도 없으면 여전히 null — 진짜 미실행이다', async () => {
    await writeStory(projectPath, { lastPushedRevision: 0, manifest: null, audioStatus: 'pending' })
    await writeFile(path.join(projectPath, 'story', 'scenes.json'), JSON.stringify({ scenes: [{ segments: [
      { id: 'n1', type: 'narration', speaker: 'narrator', text: 't' }, // audioPath 없음
    ] }] }))
    const machine = makeMachine(projectPath)
    expect(await machine.loadAudioPackage()).toBeNull()
  })

  // null 은 **진짜 미실행**(pending) 하나만 뜻해야 한다. 첫 실행이 실패하면 status='error' 인데
  // manifest 는 아직 없다 — 그걸 null 로 주면 renderer 는 "오디오 없는 프로젝트" 로 읽어
  // **나레이션이 통째로 빠진 채** export 한다. 사용자는 오디오를 만들려다 실패한 것인데.
  // running 도 같다: 만드는 중인 산출물로 내보내면 안 된다.
  it.each(['error', 'running'])('audio 가 %s 이고 manifest 가 없어도 throw — 미실행이 아니다', async (status) => {
    await writeStory(projectPath, { lastPushedRevision: 0, manifest: null, audioStatus: status })
    const machine = makeMachine(projectPath)
    await machine.open()
    await expect(machine.loadAudioPackage()).rejects.toMatchObject({ errorKind: 'story-audio-stale-manifest' })
  })

  // story.json 이 유효 JSON 이지만 steps 가 없으면 status 는 undefined 다 — defaultStoryState 폴백은
  // 파일이 **없을 때만** 걸린다. "값이 없다"를 미실행으로 통과시키면 그 구멍으로 무음 export 가 샌다.
  // 통과는 **명시적 'pending'** 하나뿐이어야 한다.
  // open() 없이 부른다 — export 는 fresh session(story view 미진입)에서도 projectPath 만으로
  // 이 경로를 탄다. 그래서 steps 가 깨진 story.json 도 여기까지 도달한다(open 은 그 전에 죽는다).
  it('story.json 에 audio 상태가 아예 없으면 미실행으로 통과시키지 않는다', async () => {
    await mkdir(path.join(projectPath, 'story', 'audio'), { recursive: true })
    await writeFile(path.join(projectPath, 'story', 'story.json'), JSON.stringify({ version: 1 })) // steps 없음
    const machine = makeMachine(projectPath)
    await expect(machine.loadAudioPackage()).rejects.toMatchObject({ errorKind: 'story-audio-stale-manifest' })
  })

  // store.load() 는 story.json 의 읽기 실패·파싱 실패까지 defaultStoryState() 로 접는다 — 즉
  // **'pending' 을 위조한다**. 그러면 "명시적 pending 만 통과" 가 무의미해지고 무음 export 가 샌다.
  // state 를 못 믿으면 export 를 막아야 한다.
  it('story.json 이 손상됐으면 pending 으로 위조되지 않는다 — 무음 export 가 새면 안 된다', async () => {
    await mkdir(path.join(projectPath, 'story', 'audio'), { recursive: true })
    await writeFile(path.join(projectPath, 'story', 'story.json'), '{ 깨진 json ')
    const machine = makeMachine(projectPath)
    await expect(machine.loadAudioPackage()).rejects.toMatchObject({ errorKind: 'story-audio-state-corrupt' })
  })

  it('story.json 이 0바이트여도 pending 으로 위조되지 않는다', async () => {
    await mkdir(path.join(projectPath, 'story', 'audio'), { recursive: true })
    await writeFile(path.join(projectPath, 'story', 'story.json'), '')
    const machine = makeMachine(projectPath)
    await expect(machine.loadAudioPackage()).rejects.toMatchObject({ errorKind: 'story-audio-state-corrupt' })
  })

  it('story.json 이 아예 없으면(비-story 프로젝트) 여전히 null — 오디오 없이 export', async () => {
    const machine = makeMachine(projectPath) // story 디렉토리조차 없다
    expect(await machine.loadAudioPackage()).toBeNull()
  })

  // JSON 파싱만 통과하면 끝이 아니다 — segments 가 없는 manifest 는 구조적으로 못 쓴다.
  // 그대로 통과시키면 prepareCloudRequest 가 `segments || []` 로 받아 **나레이션 없이** export 를
  // 성공시키고, storyAudio 가 있다는 이유로 기존 audioPackage 까지 억눌러 오디오가 통째로 빠진다.
  it.each([
    ['segments 가 없는 manifest', { version: 1, pushRevision: 5 }],
    ['segments 가 배열이 아닌 manifest', { version: 1, pushRevision: 5, segments: null }],
    // 배열이기만 하면 끝이 아니다 — 원소가 못 쓰는 모양이면 exporter 가 조용히 건너뛰고,
    // storyAudio 가 truthy 라는 이유로 기존 audioPackage 까지 억눌러 오디오가 통째로 빠진다.
    ['원소가 빈 객체', { version: 1, pushRevision: 5, segments: [{}] }],
    ['원소가 null', { version: 1, pushRevision: 5, segments: [null] }], // 지금은 kind 없는 TypeError
    ['id 가 없는 원소', { version: 1, pushRevision: 5, segments: [{ startMs: 0, durationMs: 100 }] }],
    ['timing 이 없는 원소', { version: 1, pushRevision: 5, segments: [{ id: 's1', type: 'narration' }] }],
    // narration 은 오디오가 **반드시** 있다 — 조립이 그걸 보장한다(narration/imported 가 results 에
    // 없으면 throw). audioPath 가 null 인 narration 은 손상이다. exporter 는 그걸 조용히 건너뛰고,
    // storyAudio 가 truthy 라 기존 audioPackage 까지 억눌러 나레이션이 통째로 빠진다.
    ['audioPath 가 null 인 narration', { version: 1, pushRevision: 5, segments: [{ id: 'n1', type: 'narration', audioPath: null, startMs: 0, durationMs: 1000 }] }],
    ['audioPath 가 빈 문자열인 narration', { version: 1, pushRevision: 5, segments: [{ id: 'n1', type: 'narration', audioPath: '', startMs: 0, durationMs: 1000 }] }],
    ['durationMs 가 0 인 narration', { version: 1, pushRevision: 5, segments: [{ id: 'n1', type: 'narration', audioPath: '/a.wav', startMs: 0, durationMs: 0 }] }],
  ])('%s 는 손상으로 본다 — 나레이션 없이 export 되면 안 된다', async (_label, manifest) => {
    await writeStory(projectPath, { lastPushedRevision: 5, manifest })
    const machine = makeMachine(projectPath)
    await machine.open()
    await expect(machine.loadAudioPackage()).rejects.toMatchObject({ errorKind: 'story-audio-manifest-corrupt' })
  })

  // 0바이트 manifest 는 "없음"이 아니라 **못 쓰는 파일**이다. loadTextStrict 는 빈 파일에 '' 를
  // 주는데 `!raw` 로 보면 ENOENT 와 같아져, pending 프로젝트에선 파싱까지 가지도 않고 null 이 된다.
  it('0바이트 manifest 는 없음이 아니라 손상으로 본다', async () => {
    await writeStory(projectPath, { lastPushedRevision: 0, manifest: null, audioStatus: 'pending' })
    await writeFile(path.join(projectPath, 'story', 'audio', 'manifest.json'), '')
    const machine = makeMachine(projectPath)
    await machine.open()
    await expect(machine.loadAudioPackage()).rejects.toMatchObject({ errorKind: 'story-audio-manifest-corrupt' })
  })

  // Codex finding 3: manifest 는 있지만 손상(파싱 실패)이면 조용히 null(오디오 누락) 대신
  // fail-fast 로 throw 해 export 를 막는다.
  it('manifest 가 손상(파싱 불가)이면 throw (fail-fast)', async () => {
    const dir = path.join(projectPath, 'story', 'audio')
    await mkdir(dir, { recursive: true })
    await writeFile(path.join(projectPath, 'story', 'story.json'),
      JSON.stringify({ ...defaultStoryState(), lastPushedRevision: 1 }))
    await writeFile(path.join(dir, 'manifest.json'), '{ not valid json ')
    const machine = makeMachine(projectPath)
    await machine.open()
    await expect(machine.loadAudioPackage()).rejects.toThrow(/manifest|corrupt|parse|손상/i)
  })
})
