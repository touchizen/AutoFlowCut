// @vitest-environment node
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { normalizeArch, verifyBinaryArch } from '../../scripts/verifyBinaryArch.cjs'

const tempDirs = []

function fixture(buffer, name) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'afc-arch-'))
  tempDirs.push(directory)
  const filePath = path.join(directory, name)
  fs.writeFileSync(filePath, buffer)
  return filePath
}

function mach64(cpuType) {
  const buffer = Buffer.alloc(32)
  buffer.writeUInt32LE(0xfeedfacf, 0)
  buffer.writeUInt32LE(cpuType, 4)
  return buffer
}

function pe64(machine) {
  const buffer = Buffer.alloc(128)
  buffer.write('MZ', 0, 'ascii')
  buffer.writeUInt32LE(64, 0x3c)
  buffer.write('PE\0\0', 64, 'binary')
  buffer.writeUInt16LE(machine, 68)
  return buffer
}

function elf64(machine) {
  const buffer = Buffer.alloc(64)
  buffer.set([0x7f, 0x45, 0x4c, 0x46, 2, 1], 0)
  buffer.writeUInt16LE(machine, 18)
  return buffer
}

afterEach(() => {
  vi.restoreAllMocks()
  for (const directory of tempDirs.splice(0)) {
    fs.rmSync(directory, { recursive: true, force: true })
  }
})

describe('verifyBinaryArch', () => {
  it('normalizes every supported host/build alias in one place', () => {
    expect(normalizeArch('amd64')).toBe('x64')
    expect(normalizeArch('x86_64')).toBe('x64')
    expect(normalizeArch('aarch64')).toBe('arm64')
    expect(normalizeArch('arm64')).toBe('arm64')
  })

  it('distinguishes Mach-O x86_64 and arm64 by cputype, not magic bytes', () => {
    const x64 = fixture(mach64(0x01000007), 'ffmpeg-x64')
    const arm64 = fixture(mach64(0x0100000c), 'ffmpeg-arm64')

    expect(verifyBinaryArch(x64, { platform: 'darwin', arch: 'x64' })).toBe(true)
    expect(verifyBinaryArch(x64, { platform: 'darwin', arch: 'arm64' })).toBe(false)
    expect(verifyBinaryArch(arm64, { platform: 'darwin', arch: 'arm64' })).toBe(true)
    expect(verifyBinaryArch(arm64, { platform: 'darwin', arch: 'x64' })).toBe(false)
  })

  it('parses PE Machine for Windows x64 and arm64', () => {
    expect(verifyBinaryArch(fixture(pe64(0x8664), 'x64.exe'), { platform: 'win32', arch: 'x64' })).toBe(true)
    expect(verifyBinaryArch(fixture(pe64(0xaa64), 'arm64.exe'), { platform: 'win32', arch: 'arm64' })).toBe(true)
    expect(verifyBinaryArch(fixture(pe64(0x8664), 'wrong.exe'), { platform: 'win32', arch: 'arm64' })).toBe(false)
  })

  it('parses ELF class and e_machine for Linux', () => {
    expect(verifyBinaryArch(fixture(elf64(62), 'x64'), { platform: 'linux', arch: 'x64' })).toBe(true)
    expect(verifyBinaryArch(fixture(elf64(183), 'arm64'), { platform: 'linux', arch: 'arm64' })).toBe(true)
    expect(verifyBinaryArch(fixture(elf64(62), 'wrong'), { platform: 'linux', arch: 'arm64' })).toBe(false)
  })

  it('warns once with path and code when a non-ENOENT read failure is swallowed', () => {
    const filePath = '/fixtures/unreadable-ffmpeg'
    const failure = Object.assign(new Error('permission denied'), { code: 'EACCES' })
    vi.spyOn(fs, 'openSync').mockImplementation(() => { throw failure })
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})

    expect(verifyBinaryArch(filePath, { platform: 'darwin', arch: 'arm64' })).toBe(false)
    expect(warn).toHaveBeenCalledTimes(1)
    expect(warn).toHaveBeenCalledWith(expect.stringMatching(
      /verifyBinaryArch.*\/fixtures\/unreadable-ffmpeg.*EACCES/i,
    ))
  })
})
