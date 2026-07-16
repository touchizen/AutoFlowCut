/**
 * mp3 → 세그먼트별 WAV 절단. 디코드 후 **샘플 단위**로 자른다.
 *
 * ── 왜 무손실 바이트 절단이 아닌가 (측정으로 폐기한 접근) ──
 * mp3 프레임은 직전 프레임들의 데이터를 최대 511바이트까지 참조한다(bit reservoir). 프레임
 * 경계에서 바이트만 복사해 떼어내면 참조 대상이 조각에 없어 앞부분이 복원되지 않는다.
 * 무한야담2.mp3 실측(48kHz/128kbps CBR):
 *   frame 0 (0-24ms) : 오차 0.0 dB — 디코더가 1152/1152 샘플 전부 0으로 출력(완전 무음)
 *   frame 1 (24-48ms): 오차 0.1 dB — 완전 파괴
 *   frame 2 (48-72ms): 오차 -13.7 dB — 부분 손상
 *   frame 3+         : 오차 -∞ dB — 비트 단위 완전 일치
 * 즉 조각마다 앞 ~60ms가 망가진다. 375개 자막 줄 × 60ms ≈ 22초가 첫 음절 어택에서 사라진다.
 * `ffmpeg -c copy`도 동일하게 깨진다 — 도구가 아니라 포맷 구조의 문제라 우회로가 없다.
 *
 * 디코드해서 자르면 이 문제가 원천 소멸하고, 덤으로 프레임(24ms) 스냅도 없어져 SRT 타임스탬프를
 * 샘플 단위로 정확히 지킨다.
 *
 * ── 모노 ──
 * 나레이션 mp3는 dual-mono다(무한야담2.mp3 실측: 53,023,727 샘플 전부 L===R, max|L-R|=0).
 * (L+R)/2는 그 경우 원본과 비트 단위로 같다 — 정보 손실 없이 용량이 절반이 된다. 진짜 스테레오
 * 소스라면 다운믹스되지만, 이 경로의 입력은 성우 나레이션이라 모노가 맞는 표현이다.
 *
 * ── 메모리 ──
 * 통째로 디코드하면 18분 파일이 Float32 스테레오로 424MB다. 청크로 흘려보내며 이미 다 쓴
 * 앞부분을 버려서(ranges는 정렬돼 있고 겹치지 않는다) 상주 메모리를 세그먼트 몇 개분으로 묶는다.
 */
import { readFile } from 'node:fs/promises'

const CHUNK_BYTES = 65536

/** 기본 디코더 팩토리 — mpg123(wasm). 테스트는 createDecoder를 주입해 대체한다. */
async function defaultCreateDecoder() {
  const { MPEGDecoder } = await import('mpg123-decoder')
  const dec = new MPEGDecoder()
  await dec.ready
  return {
    decode: (bytes) => dec.decode(bytes),
    free: () => dec.free(),
  }
}

/** 16bit PCM 모노 → WAV 버퍼 (RIFF/44바이트 헤더). */
export function encodeWavMono16(samples, sampleRate) {
  const dataLen = samples.length * 2
  const buf = Buffer.alloc(44 + dataLen)
  buf.write('RIFF', 0)
  buf.writeUInt32LE(36 + dataLen, 4)
  buf.write('WAVE', 8)
  buf.write('fmt ', 12)
  buf.writeUInt32LE(16, 16) // PCM fmt chunk size
  buf.writeUInt16LE(1, 20) // format = PCM
  buf.writeUInt16LE(1, 22) // channels = 1
  buf.writeUInt32LE(sampleRate, 24)
  buf.writeUInt32LE(sampleRate * 2, 28) // byte rate
  buf.writeUInt16LE(2, 32) // block align
  buf.writeUInt16LE(16, 34) // bits per sample
  buf.write('data', 36)
  buf.writeUInt32LE(dataLen, 40)
  for (let i = 0; i < samples.length; i++) buf.writeInt16LE(samples[i], 44 + i * 2)
  return buf
}

function toInt16Mono(channelData, n) {
  const L = channelData[0]
  const R = channelData.length > 1 ? channelData[1] : null
  const out = new Int16Array(n)
  for (let i = 0; i < n; i++) {
    const v = R ? (L[i] + R[i]) / 2 : L[i]
    // float[-1,1] → int16. 클리핑 방어(디코더가 미세하게 1을 넘길 수 있다).
    const s = Math.round(v * 32768)
    out[i] = s > 32767 ? 32767 : s < -32768 ? -32768 : s
  }
  return out
}

/**
 * mp3를 구간별로 잘라 WAV로 낸다. 구간은 startMs 오름차순이어야 하고 겹치면 안 된다.
 *
 * @param {object} o
 * @param {Buffer|string} o.mp3  mp3 버퍼 또는 파일 경로
 * @param {Array<{id:string, startMs:number, endMs:number}>} o.ranges
 * @param {(seg:{id:string, wav:Buffer, startMs:number, endMs:number, durationMs:number, samples:number}) => any} o.onSegment
 *        각 구간이 준비되는 즉시 호출(순서 보장). await 된다 — 여기서 파일에 쓰면 메모리가 안 쌓인다.
 * @param {AbortSignal} [o.signal]
 * @param {Function} [o.createDecoder] 테스트 주입
 * @returns {Promise<{sampleRate:number, totalSamples:number, totalMs:number}>}
 */
export async function cutMp3ToWavSegments({ mp3, ranges, onSegment, signal, createDecoder = defaultCreateDecoder }) {
  let src
  if (Buffer.isBuffer(mp3)) src = mp3
  else {
    // 날 ENOENT는 전체 경로를 실은 채 IPC를 건너간다 — errorKind 계약으로 바꿔 잡는다.
    try { src = await readFile(mp3) } catch {
      const err = new Error('audio import: narration mp3 is missing or unreadable')
      err.errorKind = 'story-audio-import-missing'
      throw err
    }
  }
  const sorted = [...(ranges || [])].sort((a, b) => a.startMs - b.startMs)
  for (let i = 1; i < sorted.length; i++) {
    if (sorted[i].startMs < sorted[i - 1].endMs) {
      throw new Error(`audioCut: ranges overlap at ${sorted[i].id} (${sorted[i].startMs}ms < ${sorted[i - 1].endMs}ms)`)
    }
  }

  const dec = await createDecoder()
  try {
    /** @type {Array<{start:number, data:Int16Array}>} 디코드된 모노 PCM 청크 (start = 절대 샘플 index) */
    let chunks = []
    let produced = 0 // 지금까지 디코드된 총 샘플 수
    let sampleRate = 0
    let ri = 0

    const msToSample = (ms) => Math.round((ms / 1000) * sampleRate)

    // [a,b) 구간을 청크들에서 모아 하나의 Int16Array로. 청크 경계를 가로질러도 된다.
    // 요청 구간이 청크로 완전히 덮이지 않으면 던진다 — 안 덮인 부분은 0으로 남아 조용히 무음이
    // 되는데, 그게 바로 이 모듈이 존재하는 이유인 실패 모드다(dropBefore가 잘못 버리면 여기서 걸린다).
    const read = (a, b) => {
      const out = new Int16Array(Math.max(0, b - a))
      let covered = 0
      for (const c of chunks) {
        const cEnd = c.start + c.data.length
        if (cEnd <= a || c.start >= b) continue
        const from = Math.max(a, c.start)
        const to = Math.min(b, cEnd)
        out.set(c.data.subarray(from - c.start, to - c.start), from - a)
        covered += to - from
      }
      if (covered !== b - a) throw new Error(`audioCut: internal — samples [${a},${b}) only ${covered}/${b - a} covered`)
      return out
    }
    // 다음 구간이 시작하는 지점보다 앞선 청크는 다시 볼 일이 없다 — 버려서 메모리를 묶는다.
    const dropBefore = (sample) => { chunks = chunks.filter((c) => c.start + c.data.length > sample) }
    // 아직 못 낸 첫 구간의 시작 — 그보다 앞선 청크는 전부 불필요. 매 청크마다 호출해 첫 flush
    // 전(구간 시작 전 구간)과 구간 사이 큰 틈에서도 메모리가 쌓이지 않게 한다.
    const dropConsumed = () => { if (ri < sorted.length && sampleRate) dropBefore(msToSample(sorted[ri].startMs)) }

    const flushReady = async () => {
      while (ri < sorted.length) {
        const r = sorted[ri]
        const endS = msToSample(r.endMs)
        if (endS > produced) break // 아직 이 구간의 끝까지 안 왔다
        const startS = msToSample(r.startMs)
        const pcm = read(startS, endS)
        await onSegment({
          id: r.id,
          wav: encodeWavMono16(pcm, sampleRate),
          startMs: r.startMs,
          endMs: r.endMs,
          durationMs: (pcm.length / sampleRate) * 1000,
          samples: pcm.length,
        })
        ri += 1
        dropBefore(ri < sorted.length ? msToSample(sorted[ri].startMs) : produced)
      }
    }

    for (let o = 0; o < src.length; o += CHUNK_BYTES) {
      if (signal?.aborted) return { aborted: true, sampleRate, totalSamples: produced, totalMs: sampleRate ? (produced / sampleRate) * 1000 : 0 }
      const { channelData, samplesDecoded, sampleRate: sr, errors } = dec.decode(
        new Uint8Array(src.subarray(o, Math.min(o + CHUNK_BYTES, src.length))),
      )
      if (errors?.length) throw new Error(`mp3 decode failed: ${errors[0]?.message || JSON.stringify(errors[0])}`)
      // 스트림 중간에 sampleRate가 바뀌면 절대 샘플 위치 계산이 전부 어긋난다 — 조용히 따라가지 않는다.
      if (sr && sampleRate && sr !== sampleRate) throw new Error(`audioCut: sample rate changed mid-stream (${sampleRate} → ${sr})`)
      if (sr) sampleRate = sr
      if (samplesDecoded > 0) {
        chunks.push({ start: produced, data: toInt16Mono(channelData, samplesDecoded) })
        produced += samplesDecoded
        await flushReady()
      }
      // 남은 구간이 없으면 나머지는 디코드할 이유가 없다 — 뒤쪽 전체를 디코드하며 청크를 쌓던
      // 낭비(구간이 앞부분에만 있는 파일이면 상주 메모리가 수백 MB까지 갔다)를 없앤다.
      if (ri >= sorted.length) break
      dropConsumed()
    }

    // 남은 구간: 오디오 끝을 넘어서는 요청이면 있는 데까지만 준다(마지막 큐가 인코더 패딩만큼
    // 넘치는 건 정상). 시작점 자체가 오디오 밖이면 짝이 틀린 SRT다 — 드러나야 한다.
    while (ri < sorted.length) {
      const r = sorted[ri]
      const startS = msToSample(r.startMs)
      if (startS >= produced) {
        // errorKind + 영어 content-free 메시지 — main의 오류는 IPC를 건너오며 번역될 수 없다
        // (renderer가 kind로 문구를 찾는다). tests/electron/noKoreanIpcErrors.test.js 계약.
        const err = new Error('audio import: subtitle range starts past the end of the audio')
        err.errorKind = 'story-srt-longer-than-audio'
        throw err
      }
      const pcm = read(startS, Math.min(msToSample(r.endMs), produced))
      await onSegment({
        id: r.id,
        wav: encodeWavMono16(pcm, sampleRate),
        startMs: r.startMs,
        endMs: r.endMs,
        durationMs: (pcm.length / sampleRate) * 1000,
        samples: pcm.length,
      })
      ri += 1
      dropBefore(ri < sorted.length ? msToSample(sorted[ri].startMs) : produced)
    }

    return { sampleRate, totalSamples: produced, totalMs: sampleRate ? (produced / sampleRate) * 1000 : 0 }
  } finally {
    try { dec.free() } catch { /* 디코더 해제 실패는 결과에 영향 없음 */ }
  }
}
