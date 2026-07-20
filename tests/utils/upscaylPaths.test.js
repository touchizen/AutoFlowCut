import { describe, expect, it } from 'vitest'
import {
  guessBinaryCandidates,
  modelsDirFor,
  parseModelPairs,
  parseScaledLine,
  pngDimsFromBuffer,
} from '../../src/utils/upscaylPaths.js'

describe('guessBinaryCandidates', () => {
  it('macOS 시스템/사용자 Applications 경로를 순서대로 반환한다', () => {
    expect(guessBinaryCandidates('darwin', { home: '/Users/tester' })).toEqual([
      '/Applications/Upscayl.app/Contents/Resources/bin/upscayl-bin',
      '/Users/tester/Applications/Upscayl.app/Contents/Resources/bin/upscayl-bin',
    ])
  })

  it('Windows LOCALAPPDATA/Program Files 경로를 순서대로 반환한다', () => {
    expect(guessBinaryCandidates('win32', {
      localAppData: 'C:\\Users\\tester\\AppData\\Local',
      programFiles: 'C:\\Program Files',
    })).toEqual([
      'C:\\Users\\tester\\AppData\\Local\\Programs\\Upscayl\\resources\\bin\\upscayl-bin.exe',
      'C:\\Program Files\\Upscayl\\resources\\bin\\upscayl-bin.exe',
    ])
  })

  it('Linux 설치형 경로를 고정 순서로 반환한다', () => {
    expect(guessBinaryCandidates('linux', {})).toEqual([
      '/opt/Upscayl/resources/bin/upscayl-bin',
      '/usr/lib/upscayl/resources/bin/upscayl-bin',
    ])
  })
})

describe('modelsDirFor', () => {
  it.each([
    ['/Applications/Upscayl.app/Contents/Resources/bin/upscayl-bin', '/Applications/Upscayl.app/Contents/Resources/models'],
    ['C:\\Program Files\\Upscayl\\resources\\bin\\upscayl-bin.exe', 'C:\\Program Files\\Upscayl\\resources\\models'],
  ])('%s의 형제 models 디렉터리를 계산한다', (binPath, expected) => {
    expect(modelsDirFor(binPath)).toBe(expected)
  })
})

describe('parseModelPairs', () => {
  it('param/bin이 모두 있는 모델만 이름순으로 반환한다', () => {
    expect(parseModelPairs([
      'zeta.bin',
      'orphan-param.param',
      'alpha.param',
      'notes.txt',
      'zeta.param',
      'orphan-bin.bin',
      'alpha.bin',
    ])).toEqual(['alpha', 'zeta'])
  })
})

describe('parseScaledLine', () => {
  it('Upscayl stderr 성공 라인에서 출력 크기를 읽는다', () => {
    expect(parseScaledLine('info\n🏞️ Scaled image from 64x64 to 256x192\ndone')).toEqual({
      width: 256,
      height: 192,
    })
  })

  it('형식이 맞지 않으면 null을 반환한다', () => {
    expect(parseScaledLine('upscale failed')).toBeNull()
  })
})

describe('pngDimsFromBuffer', () => {
  it('PNG IHDR의 256x256 크기를 읽는다', () => {
    const png = Buffer.alloc(24)
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]).copy(png, 0)
    Buffer.from('IHDR').copy(png, 12)
    png.writeUInt32BE(256, 16)
    png.writeUInt32BE(256, 20)

    expect(pngDimsFromBuffer(png)).toEqual({ width: 256, height: 256 })
  })

  it('PNG가 아니면 null을 반환한다', () => {
    expect(pngDimsFromBuffer(Buffer.from('not a png'))).toBeNull()
  })
})
