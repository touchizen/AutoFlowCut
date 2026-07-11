// @vitest-environment node
//
// fs:save-resource 는 파일명을 정규화해 쓴다: '석준의 딸' → '석준의_딸_2026-…_flow.jpg'.
// fs:get-history 는 원본 이름으로 prefix 매칭을 해서, 공백·특수문자가 든 이름은 history 가
// 통째로 안 보인다. 이미지는 디스크에 멀쩡히 있는데 앱에서만 사라진 것처럼 보인다.
//
// 두 핸들러가 같은 정규화를 써야 한다.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { tmpdir } from 'os'
import { join } from 'path'
import { mkdtempSync, rmSync } from 'fs'

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

const PNG = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg=='

describe('fs:get-history — 저장과 동일한 파일명 정규화', () => {
  let tmpDir, ipc
  beforeEach(async () => {
    tmpDir = mkdtempSync(join(tmpdir(), 'fs-hist-'))
    ipc = makeIpcMain()
    const mod = await import('../../../electron/ipc/filesystem.js')
    mod.registerFilesystemIPC(ipc)
  })
  afterEach(() => rmSync(tmpDir, { recursive: true, force: true }))

  const save = (name) => ipc.invoke('fs:save-resource', {
    workFolder: tmpDir, project: 'P', resourceType: 'references', name, data: PNG, engine: 'flow',
  })
  const history = (name) => ipc.invoke('fs:get-history', {
    workFolder: tmpDir, project: 'P', resourceType: 'references', baseName: name,
  })

  it('공백 없는 이름은 history 를 찾는다 (기존 동작)', async () => {
    await save('김석준')
    const r = await history('김석준')
    expect(r.success).toBe(true)
    expect(r.histories).toHaveLength(1)
  })

  it('공백이 든 이름도 history 를 찾는다', async () => {
    await save('석준의 딸')
    const r = await history('석준의 딸')
    expect(r.histories).toHaveLength(1)
    expect(r.histories[0].filename.startsWith('석준의_딸_')).toBe(true)
  })

  it('점·괄호 등 특수문자가 든 이름도 찾는다', async () => {
    await save('준호 (어머니)')
    expect((await history('준호 (어머니)')).histories).toHaveLength(1)
  })

  it('다른 카드의 history 를 섞어 오지 않는다', async () => {
    await save('석준의 딸')
    await save('석준')
    expect((await history('석준')).histories).toHaveLength(1)
    expect((await history('석준의 딸')).histories).toHaveLength(1)
  })

  it('history 가 없으면 빈 배열', async () => {
    expect((await history('없는 이름')).histories).toEqual([])
  })
})
