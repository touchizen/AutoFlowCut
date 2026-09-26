import { spawn as nodeSpawn } from 'node:child_process'

const NO_AUDIO_STREAM = /matches no streams/
const STDERR_TAIL_LINES = 20

export function createVideoAudioProbe(opts = {}, deps = {}) {
  const spawn = deps.spawn || nodeSpawn
  const { ffmpegPath, signal } = opts
  const probes = new Map()

  return function probeVideoAudio(videoPath) {
    if (!probes.has(videoPath)) {
      // Promise 자체를 캐시해야 같은 파일의 동시 참조도 ffmpeg 1회로 합쳐진다.
      probes.set(videoPath, runProbe(videoPath, { ffmpegPath, signal, spawn }))
    }
    return probes.get(videoPath)
  }
}

function runProbe(videoPath, { ffmpegPath, signal, spawn }) {
  if (signal?.aborted) return Promise.reject(new Error('ffmpeg audio probe cancelled'))

  return new Promise((resolve, reject) => {
    let child
    try {
      child = spawn(ffmpegPath, [
        '-nostdin', '-i', videoPath,
        '-map', '0:a:0', '-c:a', 'copy', '-t', '0', '-f', 'null', '-',
      ], { windowsHide: true })
    } catch (error) {
      reject(audioProbeSpawnError(error, ffmpegPath))
      return
    }

    let lineBuffer = ''
    let tailLines = []
    let settled = false
    let aborted = false

    const rememberLine = (line) => {
      if (!line) return
      tailLines.push(line)
      if (tailLines.length > STDERR_TAIL_LINES) tailLines = tailLines.slice(-STDERR_TAIL_LINES)
    }

    const onStderrData = (buffer) => {
      const lines = `${lineBuffer}${buffer.toString()}`.split(/\r?\n/)
      lineBuffer = lines.pop() || ''
      for (const line of lines) rememberLine(line)
    }

    const finish = (error, value) => {
      if (settled) return
      settled = true
      signal?.removeEventListener?.('abort', onAbort)
      error ? reject(error) : resolve(value)
    }

    const onAbort = () => {
      aborted = true
      try { child.kill('SIGKILL') } catch {}
      // kill 직후 resolve하지 않는다. close까지 기다려 파일 핸들이 풀린 뒤 취소를 전파한다.
    }

    // corrupt 입력의 대량 진단도 ffmpegRunner 와 같은 최근 20줄만 보존한다.
    child.stderr?.on('data', onStderrData)
    child.once('error', error => {
      if (!aborted) finish(audioProbeSpawnError(error, ffmpegPath))
    })
    child.once('close', code => {
      if (lineBuffer) rememberLine(lineBuffer)
      const stderrTail = tailLines.join('\n')
      if (aborted || signal?.aborted) {
        finish(new Error('ffmpeg audio probe cancelled'))
        return
      }
      if (code === 0) {
        finish(null, true)
        return
      }
      if (NO_AUDIO_STREAM.test(stderrTail)) {
        finish(null, false)
        return
      }
      finish(new Error(`ffmpeg audio probe exit ${code}: ${stderrTail.trim()}`))
    })

    if (signal?.aborted) onAbort()
    else signal?.addEventListener?.('abort', onAbort, { once: true })
  })
}

function audioProbeSpawnError(error, ffmpegPath) {
  return new Error(`ffmpeg audio probe spawn failed (${ffmpegPath}): ${error?.message || error}`)
}
