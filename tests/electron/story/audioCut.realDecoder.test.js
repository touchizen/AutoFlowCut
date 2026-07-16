import { describe, it, expect, beforeAll } from 'vitest'
import { execFileSync } from 'node:child_process'
import { mkdtemp, readFile, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { cutMp3ToWavSegments } from '../../../electron/story/audioCut.js'

/**
 * 실제 mpg123-decoder(wasm) 계약 고정 — 다른 테스트는 전부 디코더를 mock하므로 wasm의 실제
 * 청크/sampleRate/오류 동작은 아무것도 검증하지 않는다. 여기서 진짜 mp3 하나로 그 계약을 못박는다.
 *
 * 픽스처는 ffmpeg로 만든다(테스트 도구로만 쓴다 — 앱은 ffmpeg에 의존하지 않는다). ffmpeg가 없는
 * 환경에선 스킵한다.
 */
const SR = 48000
const hasFfmpeg = (() => {
  try { execFileSync('ffmpeg', ['-version'], { stdio: 'ignore' }); return true } catch { return false }
})()

describe.skipIf(!hasFfmpeg)('audioCut + 실제 mpg123 디코더', () => {
  let mp3Path
  let dir

  beforeAll(async () => {
    dir = await mkdtemp(path.join(tmpdir(), 'audiocut-real-'))
    mp3Path = path.join(dir, 'tone.mp3')
    // 3초짜리 결정적 신호: 0-1s 440Hz, 1-2s 무음, 2-3s 880Hz — 구간별로 무엇이 나왔는지
    // 주파수/에너지로 구분할 수 있다. 48kHz/128kbps CBR = 실제 나레이션 mp3와 같은 규격.
    execFileSync('ffmpeg', ['-y', '-v', 'error',
      '-f', 'lavfi', '-i', 'sine=frequency=440:duration=1:sample_rate=48000',
      '-f', 'lavfi', '-i', 'anullsrc=r=48000:cl=mono:duration=1',
      '-f', 'lavfi', '-i', 'sine=frequency=880:duration=1:sample_rate=48000',
      '-filter_complex', '[0][1][2]concat=n=3:v=0:a=1[a]', '-map', '[a]',
      '-ar', '48000', '-ac', '2', '-b:a', '128k', mp3Path])
  })

  const rms = (s, a, b) => {
    let x = 0
    for (let i = a; i < b; i++) x += s[i] * s[i]
    return Math.sqrt(x / (b - a))
  }
  const wavSamples = (wav) => {
    const n = wav.readUInt32LE(40) / 2
    const out = new Int16Array(n)
    for (let i = 0; i < n; i++) out[i] = wav.readInt16LE(44 + i * 2)
    return out
  }

  it('실제 mp3를 디코드해 구간별 WAV를 낸다', async () => {
    const got = []
    const res = await cutMp3ToWavSegments({
      mp3: mp3Path,
      ranges: [
        { id: 'tone1', startMs: 100, endMs: 900 },
        { id: 'silence', startMs: 1100, endMs: 1900 },
        { id: 'tone2', startMs: 2100, endMs: 2900 },
      ],
      onSegment: (s) => got.push(s),
    })
    expect(res.sampleRate).toBe(SR)
    expect(got.map((s) => s.id)).toEqual(['tone1', 'silence', 'tone2'])

    // 소리 구간엔 에너지가 있고, 무음 구간엔 없다 — 엉뚱한 구간을 자르면 여기서 뒤집힌다
    expect(rms(wavSamples(got[0].wav), 0, 30000)).toBeGreaterThan(1000)
    expect(rms(wavSamples(got[1].wav), 0, 30000)).toBeLessThan(50)
    expect(rms(wavSamples(got[2].wav), 0, 30000)).toBeGreaterThan(1000)
  })

  it('샘플 단위로 정확히 자른다 (프레임 스냅 없음)', async () => {
    const got = []
    await cutMp3ToWavSegments({ mp3: mp3Path, ranges: [{ id: 'a', startMs: 137, endMs: 611 }], onSegment: (s) => got.push(s) })
    // 474ms @48kHz = 22752샘플. 프레임(24ms) 스냅이 있으면 절대 안 맞는 수다.
    expect(got[0].samples).toBe(22752)
    expect(got[0].durationMs).toBeCloseTo(474, 6)
  })

  it('이어붙인 조각이 원본 전체 디코드와 샘플 단위로 같다 — 절단이 오디오를 바꾸지 않는다', async () => {
    const parts = []
    await cutMp3ToWavSegments({
      mp3: mp3Path,
      ranges: Array.from({ length: 10 }, (_, i) => ({ id: `p${i}`, startMs: i * 250, endMs: (i + 1) * 250 })),
      onSegment: (s) => parts.push(wavSamples(s.wav)),
    })
    const joined = parts.flatMap((p) => Array.from(p))

    const whole = []
    await cutMp3ToWavSegments({ mp3: mp3Path, ranges: [{ id: 'all', startMs: 0, endMs: 2500 }], onSegment: (s) => whole.push(wavSamples(s.wav)) })

    expect(joined).toHaveLength(whole[0].length)
    // 10조각으로 나눠 자른 것과 통째로 자른 것이 비트 단위로 같아야 한다.
    // 바이트 절단(구버전)이었다면 조각마다 앞 60ms가 무음이라 여기서 대량 불일치가 났다.
    let mismatches = 0
    for (let i = 0; i < joined.length; i++) if (joined[i] !== whole[0][i]) mismatches++
    expect(mismatches).toBe(0)
  })

  it('mp3가 아니면 실패한다 — 조용히 무음을 내면 안 된다', async () => {
    const junk = path.join(dir, 'junk.mp3')
    await writeFile(junk, Buffer.alloc(50000, 0x41))
    await expect(cutMp3ToWavSegments({ mp3: junk, ranges: [{ id: 'a', startMs: 0, endMs: 100 }], onSegment: () => {} }))
      .rejects.toThrow()
  })

  it('오디오 길이를 넘는 시작점은 실패한다 — 짝이 틀린 SRT', async () => {
    await expect(cutMp3ToWavSegments({ mp3: mp3Path, ranges: [{ id: 'x', startMs: 9000, endMs: 9500 }], onSegment: () => {} }))
      .rejects.toMatchObject({ errorKind: 'story-srt-longer-than-audio' })
  })

  it('실제 mp3에서도 상주 메모리가 묶인다', async () => {
    const before = process.memoryUsage().heapUsed
    let peak = before
    await cutMp3ToWavSegments({
      mp3: mp3Path,
      ranges: Array.from({ length: 30 }, (_, i) => ({ id: `m${i}`, startMs: i * 100, endMs: (i + 1) * 100 })),
      onSegment: () => { peak = Math.max(peak, process.memoryUsage().heapUsed) },
    })
    // 3초 파일 전체를 Float32 스테레오로 물면 ~1.1MB — 작아서 상한만 헐겁게 건다.
    // (실측 18분 파일에서 +1.4MB였다. 여기선 회귀 감지용 가드레일.)
    expect((peak - before) / 1e6).toBeLessThan(50)
  })
})
