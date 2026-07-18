// @vitest-environment node
import crypto from 'node:crypto'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'

import { stageFfmpegForPack } from '../../scripts/afterPack.cjs'
import { verifyBinaryArch } from '../../scripts/verifyBinaryArch.cjs'

const tempDirs = []

function makeProject(cpuType = 0x0100000c) {
  const projectDir = fs.mkdtempSync(path.join(os.tmpdir(), 'afc-pack-'))
  tempDirs.push(projectDir)
  const vendorDir = path.join(projectDir, 'vendor', 'ffmpeg', 'darwin-arm64')
  fs.mkdirSync(vendorDir, { recursive: true })
  const binary = Buffer.alloc(32)
  binary.writeUInt32LE(0xfeedfacf, 0)
  binary.writeUInt32LE(cpuType, 4)
  const binaryPath = path.join(vendorDir, 'ffmpeg')
  fs.writeFileSync(binaryPath, binary)
  fs.writeFileSync(
    `${binaryPath}.sha256`,
    `${crypto.createHash('sha256').update(binary).digest('hex')}  ffmpeg\n`,
  )
  return projectDir
}

afterEach(() => {
  for (const directory of tempDirs.splice(0)) {
    fs.rmSync(directory, { recursive: true, force: true })
  }
})

describe('afterPack ffmpeg staging', () => {
  it('copies the target-arch binary into resources/ffmpeg and makes it executable', () => {
    const projectDir = makeProject()
    const resourcesDir = path.join(projectDir, 'packed', 'resources')

    const output = stageFfmpegForPack({ projectDir, resourcesDir, platform: 'darwin', arch: 'arm64' })

    expect(output).toBe(path.join(resourcesDir, 'ffmpeg', 'ffmpeg'))
    expect(fs.readFileSync(output)).toEqual(
      fs.readFileSync(path.join(projectDir, 'vendor', 'ffmpeg', 'darwin-arm64', 'ffmpeg')),
    )
    expect(fs.statSync(output).mode & 0o111).not.toBe(0)
  })

  it('throws before shipping a swapped-architecture binary', () => {
    const projectDir = makeProject(0x01000007)
    const resourcesDir = path.join(projectDir, 'packed', 'resources')

    expect(() => stageFfmpegForPack({
      projectDir,
      resourcesDir,
      platform: 'darwin',
      arch: 'arm64',
    })).toThrow(/architecture mismatch/i)
    expect(fs.existsSync(path.join(resourcesDir, 'ffmpeg', 'ffmpeg'))).toBe(false)
  })

  it('rejects a staged binary whose pinned checksum no longer matches', () => {
    const projectDir = makeProject()
    const binaryPath = path.join(projectDir, 'vendor', 'ffmpeg', 'darwin-arm64', 'ffmpeg')
    fs.appendFileSync(binaryPath, Buffer.from([0]))

    expect(() => stageFfmpegForPack({
      projectDir,
      resourcesDir: path.join(projectDir, 'packed', 'resources'),
      platform: 'darwin',
      arch: 'arm64',
    })).toThrow(/checksum mismatch/i)
  })

  it('configures fonts and licenses as extraResources without duplicating ffmpeg', () => {
    const rootDir = path.resolve(__dirname, '..', '..')
    const packageJson = JSON.parse(fs.readFileSync(path.join(rootDir, 'package.json'), 'utf8'))
    const resources = packageJson.build.extraResources

    expect(resources).toEqual(expect.arrayContaining([
      expect.objectContaining({ from: 'assets/fonts', to: 'fonts' }),
      expect.objectContaining({ from: 'LICENSES', to: 'LICENSES' }),
    ]))
    expect(resources.some(resource => String(resource.from).includes('ffmpeg'))).toBe(false)
    expect(packageJson.scripts['dist:win']).toContain('install:platform-binaries')
    expect(packageJson.scripts['dist:linux']).toContain('install:platform-binaries')
  })

  it('ships a Korean font, its license, and a verified darwin-arm64 development ffmpeg', () => {
    const rootDir = path.resolve(__dirname, '..', '..')
    const fontPath = path.join(rootDir, 'assets', 'fonts', 'NanumGothic.ttc')
    const fontLicense = path.join(rootDir, 'LICENSES', 'NanumGothic-OFL.txt')
    const binaryPath = path.join(rootDir, 'vendor', 'ffmpeg', 'darwin-arm64', 'ffmpeg')
    const checksumPath = `${binaryPath}.sha256`

    expect(fs.statSync(fontPath).size).toBeGreaterThan(100_000)
    expect(fs.readFileSync(fontLicense, 'utf8')).toContain('SIL OPEN FONT LICENSE')
    expect(verifyBinaryArch(binaryPath, { platform: 'darwin', arch: 'arm64' })).toBe(true)
    expect(fs.readFileSync(checksumPath, 'utf8')).toMatch(/^[a-f0-9]{64}\s+ffmpeg\s*$/i)
    expect(fs.readdirSync(path.join(rootDir, 'LICENSES', 'ffmpeg', 'darwin-arm64')).length)
      .toBeGreaterThan(0)
  })
})
