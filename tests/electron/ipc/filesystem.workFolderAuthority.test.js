// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { mkdir, mkdtemp, realpath, rename, rm, stat } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'

const electronMocks = vi.hoisted(() => ({
  userDataPath: '',
  showOpenDialog: vi.fn(),
}))

vi.mock('child_process', () => ({
  execFile: vi.fn((_cmd, _args, _opts, callback) => callback(new Error('no ffprobe'), '', '')),
  execSync: vi.fn(),
}))

vi.mock('electron', () => ({
  app: { getPath: () => electronMocks.userDataPath },
  dialog: { showOpenDialog: electronMocks.showOpenDialog },
}))

import { createWorkFolderAuthority } from '../../../electron/main/workFolderAuthority.js'
import { registerFilesystemIPC } from '../../../electron/ipc/filesystem.js'

function fakeIpcMain() {
  const handlers = new Map()
  return {
    handle: (channel, handler) => handlers.set(channel, handler),
    invoke: (channel, payload) => handlers.get(channel)({}, payload),
  }
}

describe('main-owned work-folder authority', () => {
  let root
  let ipc
  let authority

  beforeEach(async () => {
    root = await mkdtemp(path.join(tmpdir(), 'work-folder-authority-'))
    electronMocks.userDataPath = root
    electronMocks.showOpenDialog.mockReset()
    ipc = fakeIpcMain()
    authority = createWorkFolderAuthority()
    registerFilesystemIPC(ipc, { workFolderAuthority: authority })
  })

  afterEach(async () => {
    await rm(root, { recursive: true, force: true })
  })

  it('renderer가 임의로 보낸 save-work-folder 경로는 authority로 승격하지 않는다', async () => {
    const arbitrary = await mkdtemp(path.join(tmpdir(), 'renderer-work-folder-'))

    const result = await ipc.invoke('fs:save-work-folder', {
      workFolderPath: arbitrary,
      workFolderName: 'forged',
    })

    expect(result).toEqual({ success: false, error: 'unconfirmed-work-folder' })
    expect(authority.getCanonicalPath()).toBeNull()
    await rm(arbitrary, { recursive: true, force: true })
  })

  it('native picker가 고른 directory만 canonical authority로 소유한다', async () => {
    const selected = await mkdtemp(path.join(tmpdir(), 'picker-work-folder-'))
    electronMocks.showOpenDialog.mockResolvedValue({ canceled: false, filePaths: [selected] })

    const result = await ipc.invoke('fs:select-work-folder')

    expect(result).toMatchObject({ success: true, path: await realpath(selected) })
    expect(authority.getCanonicalPath()).toBe(await realpath(selected))
    await rm(selected, { recursive: true, force: true })
  })

  it('confirmed path를 다른 inode의 directory로 재바인드하면 authority match를 거부한다', async () => {
    const selected = path.join(root, 'selected-work-folder')
    const moved = path.join(root, 'moved-original')
    await mkdir(selected)
    await authority.confirm(selected)

    await rename(selected, moved)
    await mkdir(selected)

    expect(await authority.matches(selected)).toBe(false)
  })

  it('verified context는 confirmed dev/ino를 반환하고 재바인드 뒤에는 거부한다', async () => {
    const selected = path.join(root, 'verified-work-folder')
    const moved = path.join(root, 'verified-original')
    await mkdir(selected)
    const selectedInfo = await import('node:fs/promises').then(({ stat }) => stat(selected))
    await authority.confirm(selected)

    await expect(authority.getVerifiedContext()).resolves.toEqual({
      path: await realpath(selected),
      identity: { dev: selectedInfo.dev, ino: selectedInfo.ino },
    })

    await rename(selected, moved)
    await mkdir(selected)
    await expect(authority.getVerifiedContext()).rejects.toThrow('invalid-work-folder')
  })

  it('authority 변경은 onChange 호출 전에 새 path와 identity를 publish한다', async () => {
    const previous = path.join(root, 'previous-work-folder')
    const next = path.join(root, 'next-work-folder')
    await mkdir(previous)
    await mkdir(next)
    const nextInfo = await stat(next)
    let observedContext
    let localAuthority
    const onChange = vi.fn(async () => {
      observedContext = await localAuthority.getVerifiedContext()
    })
    localAuthority = createWorkFolderAuthority({ onChange })
    await localAuthority.confirm(previous)

    await localAuthority.confirm(next)

    expect(onChange).toHaveBeenCalledWith({
      previousPath: await realpath(previous),
      nextPath: await realpath(next),
    })
    expect(observedContext).toEqual({
      path: await realpath(next),
      identity: { dev: nextInfo.dev, ino: nextInfo.ino },
    })
  })

  it('authority가 채워진 뒤 renderer가 보낸 다른 경로는 저장하지 않는다', async () => {
    const selected = path.join(root, 'selected-work-folder')
    const forged = path.join(root, 'renderer-forged-folder')
    await mkdir(selected)
    await mkdir(forged)
    await authority.confirm(selected)

    const result = await ipc.invoke('fs:save-work-folder', {
      workFolderPath: forged,
      workFolderName: 'forged',
    })

    expect(result).toEqual({ success: false, error: 'unconfirmed-work-folder' })
    expect(authority.getCanonicalPath()).toBe(await realpath(selected))
  })
})
