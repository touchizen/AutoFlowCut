import { describe, it, expect, vi } from 'vitest'
import { EventEmitter } from 'node:events'
import { createVideoAudioProbe } from '../../../electron/render/videoAudioProbe.js'

function fakeChild() {
  const child = new EventEmitter()
  child.stderr = new EventEmitter()
  child.kill = vi.fn()
  return child
}

function makeProbe(child, overrides = {}) {
  const spawn = vi.fn(() => child)
  return {
    probe: createVideoAudioProbe(
      { ffmpegPath: '/bundled/ffmpeg', ...overrides },
      { spawn },
    ),
    spawn,
  }
}

describe('createVideoAudioProbe', () => {
  it('returns true when ffmpeg exits 0 and uses the measured stream-map command', async () => {
    const child = fakeChild()
    const { probe, spawn } = makeProbe(child)
    const result = probe('/media/with-audio.mp4')

    expect(spawn).toHaveBeenCalledWith('/bundled/ffmpeg', [
      '-nostdin', '-i', '/media/with-audio.mp4',
      '-map', '0:a:0', '-c:a', 'copy', '-t', '0', '-f', 'null', '-',
    ], { windowsHide: true })
    child.emit('close', 0)

    await expect(result).resolves.toBe(true)
  })

  it('returns false only when stderr says the audio stream map matches no streams', async () => {
    const child = fakeChild()
    const { probe } = makeProbe(child)
    const result = probe('/media/silent.mp4')

    child.stderr.emit('data', Buffer.from("Stream map '0:a:0' matches no streams.\n"))
    child.emit('close', 234)

    await expect(result).resolves.toBe(false)
  })

  it('still detects a no-audio marker near the end of huge stderr', async () => {
    const child = fakeChild()
    const { probe } = makeProbe(child)
    const result = probe('/media/huge-silent.mp4')

    child.stderr.emit('data', Buffer.from(
      `${'diagnostic noise\n'.repeat(2_000)}Stream map '0:a:0' matches no streams.\n`,
    ))
    child.emit('close', 234)

    await expect(result).resolves.toBe(false)
  })

  it('keeps only the last 20 stderr lines in a probe error', async () => {
    const child = fakeChild()
    const { probe } = makeProbe(child)
    const result = probe('/media/huge-corrupt.mp4')
    const lines = Array.from({ length: 100 }, (_, index) => `diagnostic-${String(index).padStart(3, '0')}`)

    child.stderr.emit('data', Buffer.from(`${lines.join('\n')}\n`))
    child.emit('close', 1)

    const error = await result.catch(value => value)
    expect(error).toBeInstanceOf(Error)
    expect(error.message).toContain('diagnostic-080')
    expect(error.message).toContain('diagnostic-099')
    expect(error.message).not.toContain('diagnostic-079')
    expect(error.message.length).toBeLessThan(500)
  })

  it('throws on another non-zero ffmpeg exit', async () => {
    const child = fakeChild()
    const { probe } = makeProbe(child)
    const result = probe('/media/corrupt.mp4')

    child.stderr.emit('data', Buffer.from('Invalid data found when processing input\n'))
    child.emit('close', 1)

    await expect(result).rejects.toThrow(/ffmpeg audio probe exit 1.*Invalid data/s)
  })

  it('throws when ffmpeg cannot be spawned', async () => {
    const spawnError = Object.assign(new Error('spawn ENOENT'), { code: 'ENOENT' })
    const spawn = vi.fn(() => { throw spawnError })
    const probe = createVideoAudioProbe({ ffmpegPath: '/missing/ffmpeg' }, { spawn })

    await expect(probe('/media/video.mp4')).rejects.toThrow(/audio probe.*spawn ENOENT/i)
  })

  it('kills ffmpeg on abort and rejects after the child closes', async () => {
    const child = fakeChild()
    const controller = new AbortController()
    const { probe } = makeProbe(child, { signal: controller.signal })
    const result = probe('/media/video.mp4')
    const rejection = expect(result).rejects.toThrow(/cancel/i)

    controller.abort()
    expect(child.kill).toHaveBeenCalledWith('SIGKILL')
    child.emit('close', null, 'SIGKILL')

    await rejection
  })

  it('still rejects when close reports exit 0 AFTER an abort (guard order)', async () => {
    // aborted 가드가 code===0 검사보다 먼저 와야 취소된 probe 가 audio=true 로 오판되지 않는다.
    const child = fakeChild()
    const controller = new AbortController()
    const { probe } = makeProbe(child, { signal: controller.signal })
    const result = probe('/media/video.mp4')
    const rejection = expect(result).rejects.toThrow(/cancel/i)

    controller.abort()
    child.emit('close', 0)   // 취소 직후 프로세스가 0 으로 닫혀도 취소로 전파돼야 한다

    await rejection
  })

  it('swallows an error event that fires after abort (settles via close)', async () => {
    const child = fakeChild()
    const controller = new AbortController()
    const { probe } = makeProbe(child, { signal: controller.signal })
    const result = probe('/media/video.mp4')
    const rejection = expect(result).rejects.toThrow(/cancel/i)

    controller.abort()
    child.emit('error', new Error('killed'))  // abort 후 error 는 무시(=중복 settle 없음)
    child.emit('close', null, 'SIGKILL')

    await rejection
  })

  it('memoizes the in-flight promise for the same video path', async () => {
    const child = fakeChild()
    const { probe, spawn } = makeProbe(child)

    const first = probe('/media/reused.mp4')
    const second = probe('/media/reused.mp4')

    expect(second).toBe(first)
    expect(spawn).toHaveBeenCalledTimes(1)
    child.emit('close', 0)
    await expect(Promise.all([first, second])).resolves.toEqual([true, true])
  })
})
