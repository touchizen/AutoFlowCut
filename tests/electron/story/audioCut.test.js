import { describe, it, expect, vi } from 'vitest'
import { cutMp3ToWavSegments, encodeWavMono16 } from '../../../electron/story/audioCut.js'

const SR = 48000

/**
 * 가짜 디코더 — 실제 mp3 대신 결정적인 톱니 신호를 낸다. 입력 바이트 1개당 100샘플을 내보내
 * 청크 경계가 세그먼트 경계와 어긋나는 상황(rolling buffer가 청크를 가로질러 읽어야 하는 경우)을
 * 만든다. sample n의 값 = n % 1000 이라 어느 구간이 나왔는지 값만 보고 검증할 수 있다.
 */
function fakeDecoder({ samplesPerByte = 100, sampleRate = SR } = {}) {
  let produced = 0
  return async () => ({
    decode: (bytes) => {
      const n = bytes.length * samplesPerByte
      const L = new Float32Array(n)
      const R = new Float32Array(n)
      for (let i = 0; i < n; i++) {
        // (produced+i) % 1000 을 [-1,1) 로 — int16 변환 후에도 구분 가능한 값
        const v = ((produced + i) % 1000) / 1000
        L[i] = v
        R[i] = v
      }
      produced += n
      return { channelData: [L, R], samplesDecoded: n, sampleRate, errors: [] }
    },
    free: () => {},
  })
}

const wavSamples = (wav) => {
  const n = wav.readUInt32LE(40) / 2
  const out = new Int16Array(n)
  for (let i = 0; i < n; i++) out[i] = wav.readInt16LE(44 + i * 2)
  return out
}

describe('encodeWavMono16', () => {
  it('유효한 RIFF/WAVE 모노 16bit 헤더를 쓴다', () => {
    const wav = encodeWavMono16(new Int16Array([0, 1, -1, 32767]), SR)
    expect(wav.toString('latin1', 0, 4)).toBe('RIFF')
    expect(wav.toString('latin1', 8, 12)).toBe('WAVE')
    expect(wav.readUInt16LE(20)).toBe(1) // PCM
    expect(wav.readUInt16LE(22)).toBe(1) // mono
    expect(wav.readUInt32LE(24)).toBe(SR)
    expect(wav.readUInt16LE(34)).toBe(16) // bits
    expect(wav.readUInt32LE(40)).toBe(8) // data bytes
    expect(wav.length).toBe(44 + 8)
  })

  it('샘플 값을 그대로 싣는다', () => {
    expect(Array.from(wavSamples(encodeWavMono16(new Int16Array([5, -5, 100]), SR)))).toEqual([5, -5, 100])
  })

  it('빈 입력도 유효한 WAV', () => {
    const wav = encodeWavMono16(new Int16Array([]), SR)
    expect(wav.length).toBe(44)
    expect(wav.readUInt32LE(40)).toBe(0)
  })
})

describe('cutMp3ToWavSegments', () => {
  const run = async (ranges, opts = {}) => {
    const got = []
    const res = await cutMp3ToWavSegments({
      mp3: Buffer.alloc(1000), // 1000바이트 × 100샘플 = 100,000샘플 ≈ 2083ms
      ranges,
      createDecoder: fakeDecoder(),
      onSegment: (s) => { got.push(s) },
      ...opts,
    })
    return { got, res }
  }

  it('구간마다 세그먼트를 하나씩, 요청 순서대로 낸다', async () => {
    const { got } = await run([
      { id: 'a', startMs: 0, endMs: 100 },
      { id: 'b', startMs: 100, endMs: 200 },
      { id: 'c', startMs: 200, endMs: 300 },
    ])
    expect(got.map((s) => s.id)).toEqual(['a', 'b', 'c'])
  })

  it('샘플 단위로 정확히 자른다 — 프레임 스냅이 없다', async () => {
    // 100ms @48kHz = 정확히 4800샘플
    const { got } = await run([{ id: 'a', startMs: 0, endMs: 100 }])
    expect(got[0].samples).toBe(4800)
    expect(got[0].durationMs).toBeCloseTo(100, 6)
  })

  it('요청 구간의 실제 오디오를 낸다 (오프셋이 맞다)', async () => {
    // 10ms = 480샘플. startMs 10 → 절대 샘플 480부터. fake 신호는 값 = n % 1000.
    const { got } = await run([{ id: 'x', startMs: 10, endMs: 20 }])
    const s = wavSamples(got[0].wav)
    expect(s).toHaveLength(480)
    expect(s[0]).toBe(Math.round((480 % 1000) / 1000 * 32768))
    expect(s[1]).toBe(Math.round((481 % 1000) / 1000 * 32768))
  })

  it('청크 경계를 가로지르는 구간도 이어 붙여 읽는다', async () => {
    const { got } = await run([{ id: 'big', startMs: 0, endMs: 2000 }])
    const s = wavSamples(got[0].wav)
    expect(s).toHaveLength(96000)
    // 중간 지점의 값이 연속적인지 — 이어붙이기가 깨지면 여기서 어긋난다
    expect(s[50000]).toBe(Math.round((50000 % 1000) / 1000 * 32768))
  })

  // ── 멀티 청크 ──
  // CHUNK_BYTES(65536)를 넘는 mp3라야 decode()가 여러 번 불리고 rolling buffer(read 교차 청크 +
  // dropBefore + 중간 flush)가 실제로 돈다. 위 테스트들은 1000바이트라 항상 1회 호출이었다 —
  // 즉 가장 위험한 경로가 통째로 미검증이었다.
  const runBig = async (ranges, opts = {}) => {
    const got = []
    // 200,000바이트 × 1샘플/바이트 = 200,000샘플 ≈ 4166ms, decode() 4회 호출
    const res = await cutMp3ToWavSegments({
      mp3: Buffer.alloc(200000),
      ranges,
      createDecoder: fakeDecoder({ samplesPerByte: 1 }),
      onSegment: (s) => { got.push(s) },
      ...opts,
    })
    return { got, res }
  }

  it('여러 디코드 청크에 걸쳐도 각 구간의 오디오가 정확하다', async () => {
    // 65536바이트 = 65536샘플 = 1365.33ms 지점이 첫 청크 경계. 그 경계를 가로지르는 구간을 잡는다.
    const { got } = await runBig([{ id: 'cross', startMs: 1300, endMs: 1400 }])
    const s = wavSamples(got[0].wav)
    const startSample = Math.round((1300 / 1000) * SR) // 62400
    expect(s).toHaveLength(Math.round((1400 / 1000) * SR) - startSample)
    expect(s[0]).toBe(Math.round((startSample % 1000) / 1000 * 32768))
    // 청크 경계(65536) 이후 샘플도 이어져야 한다
    expect(s[65536 - startSample + 5]).toBe(Math.round(((65541) % 1000) / 1000 * 32768))
  })

  it('멀티 청크에서 연속 구간들이 빈틈없이 타일링된다', async () => {
    const ranges = Array.from({ length: 20 }, (_, i) => ({ id: `t${i}`, startMs: i * 200, endMs: (i + 1) * 200 }))
    const { got } = await runBig(ranges)
    expect(got.map((g) => g.id)).toEqual(ranges.map((r) => r.id))
    // 이어붙이면 원본과 같아야 한다 — 중복도 누락도 없이
    const all = got.flatMap((g) => Array.from(wavSamples(g.wav)))
    expect(all).toHaveLength(Math.round((4000 / 1000) * SR))
    for (const i of [0, 1, 9599, 9600, 100000, all.length - 1]) {
      expect(all[i]).toBe(Math.round((i % 1000) / 1000 * 32768))
    }
  })

  it('구간이 앞부분에만 있으면 뒤쪽을 디코드하지 않는다 — 메모리/CPU 낭비 방지', async () => {
    let calls = 0
    const counting = ({ samplesPerByte = 1 } = {}) => {
      let produced = 0
      return async () => ({
        decode: (bytes) => {
          calls++
          const n = bytes.length * samplesPerByte
          const L = new Float32Array(n); const R = new Float32Array(n)
          for (let i = 0; i < n; i++) { const v = ((produced + i) % 1000) / 1000; L[i] = v; R[i] = v }
          produced += n
          return { channelData: [L, R], samplesDecoded: n, sampleRate: SR, errors: [] }
        },
        free: () => {},
      })
    }
    await cutMp3ToWavSegments({
      mp3: Buffer.alloc(600000), // 12.5초 분량, decode 10회가 필요한 크기
      ranges: [{ id: 'head', startMs: 0, endMs: 100 }], // 첫 청크 안에서 끝난다
      createDecoder: counting(),
      onSegment: () => {},
    })
    expect(calls).toBe(1) // 나머지 9회는 돌 이유가 없다
  })

  it('구간 사이에 틈이 있어도 각자 제 구간을 낸다', async () => {
    const { got } = await run([
      { id: 'a', startMs: 0, endMs: 10 },
      { id: 'b', startMs: 1000, endMs: 1010 },
    ])
    expect(wavSamples(got[1].wav)[0]).toBe(Math.round(((48000 % 1000)) / 1000 * 32768))
  })

  it('정렬되지 않은 입력도 startMs 순으로 처리한다', async () => {
    const { got } = await run([
      { id: 'b', startMs: 100, endMs: 200 },
      { id: 'a', startMs: 0, endMs: 100 },
    ])
    expect(got.map((s) => s.id)).toEqual(['a', 'b'])
  })

  it('겹치는 구간은 거부한다 — 스트리밍으로 되짚어 읽을 수 없다', async () => {
    await expect(run([
      { id: 'a', startMs: 0, endMs: 200 },
      { id: 'b', startMs: 100, endMs: 300 },
    ])).rejects.toThrow(/overlap/)
  })

  it('시작점이 오디오 밖이면 던진다 — 짝이 틀린 SRT는 드러나야 한다', async () => {
    // 오디오는 ~2083ms. 메시지는 영어 진단문이고 사용자 문구는 renderer가 kind로 찾는다
    // (noKoreanIpcErrors 계약) — 테스트는 안정적인 kind를 붙든다.
    await expect(run([{ id: 'x', startMs: 5000, endMs: 6000 }]))
      .rejects.toMatchObject({ errorKind: 'story-srt-longer-than-audio' })
  })

  it('끝이 오디오를 조금 넘으면 있는 데까지 낸다 (인코더 패딩 허용)', async () => {
    const { got } = await run([{ id: 'tail', startMs: 2000, endMs: 9999 }])
    expect(got).toHaveLength(1)
    expect(got[0].samples).toBeGreaterThan(0)
    expect(got[0].samples).toBeLessThan(4800 * 2)
  })

  it('디코더 오류를 전파한다 — 조용히 무음을 내면 안 된다', async () => {
    const bad = async () => ({ decode: () => ({ channelData: [], samplesDecoded: 0, sampleRate: SR, errors: [{ message: 'bad frame' }] }), free: () => {} })
    await expect(cutMp3ToWavSegments({ mp3: Buffer.alloc(10), ranges: [{ id: 'a', startMs: 0, endMs: 10 }], createDecoder: bad, onSegment: () => {} }))
      .rejects.toThrow(/bad frame/)
  })

  it('dual-mono를 모노로 무손실 다운믹스한다 ((L+R)/2 = L)', async () => {
    const { got } = await run([{ id: 'a', startMs: 0, endMs: 10 }])
    // fake는 L===R이므로 (L+R)/2 === L — 값이 그대로여야 한다
    expect(wavSamples(got[0].wav)[3]).toBe(Math.round((3 % 1000) / 1000 * 32768))
  })

  it('abort되면 중간에 멈춘다', async () => {
    const ac = new AbortController()
    ac.abort()
    const { got } = await run([{ id: 'a', startMs: 0, endMs: 10 }], { signal: ac.signal })
    expect(got).toHaveLength(0)
  })

  it('디코더를 항상 해제한다 (실패해도)', async () => {
    const free = vi.fn()
    const dec = async () => ({ decode: () => { throw new Error('boom') }, free })
    await expect(cutMp3ToWavSegments({ mp3: Buffer.alloc(10), ranges: [], createDecoder: dec, onSegment: () => {} })).rejects.toThrow('boom')
    expect(free).toHaveBeenCalled()
  })

  it('onSegment를 await한다 — 파일 쓰기가 밀리면 메모리가 쌓인다', async () => {
    const order = []
    await cutMp3ToWavSegments({
      mp3: Buffer.alloc(1000),
      ranges: [{ id: 'a', startMs: 0, endMs: 10 }, { id: 'b', startMs: 10, endMs: 20 }],
      createDecoder: fakeDecoder(),
      onSegment: async (s) => {
        order.push(`start:${s.id}`)
        await new Promise((r) => setTimeout(r, 1))
        order.push(`end:${s.id}`)
      },
    })
    expect(order).toEqual(['start:a', 'end:a', 'start:b', 'end:b'])
  })
})
