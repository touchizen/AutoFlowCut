// @vitest-environment node
//
// flowProjectId 는 "저장이 성공했으면 디스크에 있다"가 전제인 유일한 키다 — renderer 의
// flowProjectReady 게이트가 그 전제 위에서 열린다(저장 실패면 다음 실행에 또 새 Flow
// 프로젝트를 만들어 빈 프로젝트가 쌓인다). 그 전제를 main 쪽에서 지키는 두 가지:
//
//  1. autosave 의 full save 는 flowProjectId 를 payload 에 안 실을 수 있다(state 가 아직
//     null 일 때 만들어진 payload). 그게 merge 뒤에 write-lock 을 잡으면 방금 저장된 id 를
//     지운다 — merge 성공을 보고 게이트를 연 renderer 는 그걸 모른다.
//  2. project.json 이 없으면 merge 가 영원히 실패한다. 최초 저장이 실패한 프로젝트는
//     저장 재시도가 통과할 길이 없어 생성이 영구 차단된다.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { tmpdir } from 'os'
import { join } from 'path'
import { mkdtempSync, rmSync, readFileSync, writeFileSync, mkdirSync, existsSync } from 'fs'

vi.mock('child_process', () => ({
  execFile: vi.fn((cmd, args, opts, cb) => { cb(new Error('no ffprobe'), '', '') }),
}))
vi.mock('electron', () => ({
  app: { getPath: () => tmpdir() },
  dialog: { showOpenDialog: vi.fn() },
}))

function makeIpcMain() {
  const handlers = new Map()
  return {
    handle: (name, fn) => handlers.set(name, fn),
    invoke: async (name, payload) => handlers.get(name)({}, payload),
  }
}

describe('project.json 의 flowProjectId 보존', () => {
  let tmpDir, ipc
  beforeEach(async () => {
    tmpDir = mkdtempSync(join(tmpdir(), 'fs-flowid-'))
    ipc = makeIpcMain()
    const mod = await import('../../../electron/ipc/filesystem.js')
    mod.registerFilesystemIPC(ipc)
  })
  afterEach(() => rmSync(tmpDir, { recursive: true, force: true }))

  const save = (data) => ipc.invoke('fs:save-project-data', { workFolder: tmpDir, project: 'P', data })
  const merge = (patch) => ipc.invoke('fs:merge-project-data', { workFolder: tmpDir, project: 'P', patch })
  const read = () => JSON.parse(readFileSync(join(tmpDir, 'P', 'project.json'), 'utf-8'))

  it('flowProjectId 없는 full save 는 디스크의 flowProjectId 를 지우지 않는다', async () => {
    await save({ schemaVersion: 2, scenes: [] })
    await merge({ flowProjectId: 'flow-abc' })

    // autosave 가 state 에 id 가 없던 시점의 payload 로 뒤늦게 쓰는 상황.
    await save({ schemaVersion: 2, scenes: [{ id: 1 }] })

    expect(read()).toHaveProperty('flowProjectId', 'flow-abc')
    expect(read().scenes).toHaveLength(1)  // 나머지는 payload 대로 갱신된다
  })

  // payload 의 값도 renderer 가 payload 를 만든 시점의 것이라, 그 사이 merge 로 바뀐 최신
  // 매핑을 되돌릴 수 있다. 파일이 이미 있으면 디스크 값이 이긴다(설정/해제는 merge 전용).
  it('full save 가 옛 flowProjectId 를 명시해도 디스크의 최신 값을 되돌리지 않는다', async () => {
    await save({ schemaVersion: 2, flowProjectId: 'old' })   // 파일 없음 → payload 로 부트스트랩
    await merge({ flowProjectId: 'new' })

    await save({ schemaVersion: 2, flowProjectId: 'old' })   // 뒤늦게 도착한 stale autosave

    expect(read()).toHaveProperty('flowProjectId', 'new')
  })

  it('merge 로 null 을 쓴 뒤(죽은 매핑 제거) full save 가 옛 id 를 되살리지 않는다', async () => {
    await save({ schemaVersion: 2, flowProjectId: 'dead' })
    await merge({ flowProjectId: null })
    // payload 가 옛 id 를 들고 와도 해제 상태(null)가 유지돼야 한다.
    await save({ schemaVersion: 2, flowProjectId: 'dead' })
    expect(read()).toHaveProperty('flowProjectId', null)
  })

  // 디스크에 키가 아예 없으면(매핑 없는 프로젝트), stale payload 가 들고 온 죽은 id 를
  // 되살리면 안 된다 — 그 프로젝트의 생성이 남의 Flow 프로젝트로 향한다.
  it('디스크에 flowProjectId 가 없으면 full save 의 값도 쓰지 않는다', async () => {
    await save({ schemaVersion: 2 })                          // 매핑 없는 프로젝트
    await save({ schemaVersion: 2, flowProjectId: 'stale' })  // 옛 payload 가 뒤늦게 도착
    expect(read()).not.toHaveProperty('flowProjectId')
  })

  it('project.json 이 없으면 merge 가 패치로 파일을 만든다(영구 차단 방지)', async () => {
    expect(existsSync(join(tmpDir, 'P', 'project.json'))).toBe(false)

    const res = await merge({ flowProjectId: 'flow-xyz' })

    expect(res.success).toBe(true)
    expect(read().flowProjectId).toBe('flow-xyz')
  })

  // "없음"과 "깨짐"은 다르다. 깨진 파일을 패치만 든 파일로 덮으면 씬·레퍼런스가 통째로 날아간다.
  it('project.json 이 깨져 있으면 merge 는 실패하고 파일을 덮지 않는다', async () => {
    mkdirSync(join(tmpDir, 'P'), { recursive: true })
    writeFileSync(join(tmpDir, 'P', 'project.json'), '{"scenes": [1,2,3', 'utf-8')

    const res = await merge({ flowProjectId: 'flow-xyz' })

    expect(res.success).toBe(false)
    expect(readFileSync(join(tmpDir, 'P', 'project.json'), 'utf-8')).toBe('{"scenes": [1,2,3')
  })
})
