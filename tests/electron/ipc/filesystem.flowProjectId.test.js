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
import { mkdtempSync, rmSync, readFileSync, existsSync } from 'fs'

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

    expect(read().flowProjectId).toBe('flow-abc')
    expect(read().scenes).toHaveLength(1)  // 나머지는 payload 대로 갱신된다
  })

  it('full save 가 flowProjectId 를 명시하면 그 값으로 갱신한다', async () => {
    await save({ schemaVersion: 2, flowProjectId: 'old' })
    await save({ schemaVersion: 2, flowProjectId: 'new' })
    expect(read().flowProjectId).toBe('new')
  })

  it('merge 로 null 을 쓴 뒤(죽은 매핑 제거) full save 가 옛 id 를 되살리지 않는다', async () => {
    await save({ schemaVersion: 2, flowProjectId: 'dead' })
    await merge({ flowProjectId: null })
    await save({ schemaVersion: 2, scenes: [] })
    expect(read().flowProjectId ?? null).toBeNull()
  })

  it('project.json 이 없으면 merge 가 패치로 파일을 만든다(영구 차단 방지)', async () => {
    expect(existsSync(join(tmpDir, 'P', 'project.json'))).toBe(false)

    const res = await merge({ flowProjectId: 'flow-xyz' })

    expect(res.success).toBe(true)
    expect(read().flowProjectId).toBe('flow-xyz')
  })
})
