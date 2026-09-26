import { describe, expect, it, vi } from 'vitest'
import { genaiFetch } from '../../../../electron/api/providers/http.js'

const jsonResponse = (payload, status = 200) => ({
  ok: status >= 200 && status < 300,
  status,
  json: vi.fn().mockResolvedValue(payload),
})

const abortError = () => Object.assign(new Error('transport aborted'), { name: 'AbortError' })

describe('genaiFetch cancellation', () => {
  it('signal을 RequestInit에 전달하고 실제 signal abort fetch 예외는 재시도하지 않는다', async () => {
    const controller = new AbortController()
    const fetchImpl = vi.fn((_url, init) => {
      expect(init.signal).toBe(controller.signal)
      controller.abort()
      return Promise.reject(abortError())
    })
    const sleepImpl = vi.fn()

    await expect(genaiFetch('https://example.test', {
      apiKey: 'key',
      signal: controller.signal,
    }, { fetchImpl, sleepImpl })).rejects.toMatchObject({ name: 'AbortError' })
    expect(fetchImpl).toHaveBeenCalledTimes(1)
    expect(sleepImpl).not.toHaveBeenCalled()
  })

  it('signal 없는 bare AbortError는 기존대로 재시도하고 init에 signal own-property를 만들지 않는다', async () => {
    const fetchImpl = vi.fn((_url, init) => {
      expect(init).not.toHaveProperty('signal')
      return Promise.reject(abortError())
    })
    const sleepImpl = vi.fn().mockResolvedValue(undefined)

    await expect(genaiFetch('https://example.test', { apiKey: 'key' }, {
      fetchImpl,
      sleepImpl,
    })).rejects.toMatchObject({ name: 'AbortError' })
    expect(fetchImpl).toHaveBeenCalledTimes(3)
    expect(sleepImpl).toHaveBeenCalledTimes(2)
    expect(sleepImpl.mock.calls.every((args) => args.length === 1)).toBe(true)
  })

  it('429/503 retry sleep를 signal과 race하고 abort 뒤 listener를 정리한다', async () => {
    const controller = new AbortController()
    const addSpy = vi.spyOn(controller.signal, 'addEventListener')
    const removeSpy = vi.spyOn(controller.signal, 'removeEventListener')
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse({ error: { status: 'UNAVAILABLE' } }, 503))
    const sleepImpl = vi.fn(() => new Promise(() => {}))

    const operation = genaiFetch('https://example.test', {
      apiKey: 'key',
      signal: controller.signal,
    }, { fetchImpl, sleepImpl })
    await vi.waitFor(() => expect(sleepImpl).toHaveBeenCalledTimes(1))
    controller.abort()

    await expect(operation).rejects.toMatchObject({ name: 'AbortError' })
    expect(fetchImpl).toHaveBeenCalledTimes(1)
    expect(addSpy).toHaveBeenCalledWith('abort', expect.any(Function), { once: true })
    const abortHandler = addSpy.mock.calls.find(([type]) => type === 'abort')[1]
    expect(removeSpy).toHaveBeenCalledWith('abort', abortHandler)
  })

  it('signal 없는 retry sleep는 sleepImpl(ms)를 정확히 인자 하나로 직접 호출한다', async () => {
    const fetchImpl = vi.fn()
      .mockResolvedValueOnce(jsonResponse({ error: { status: 'UNAVAILABLE' } }, 503))
      .mockResolvedValueOnce(jsonResponse({ ok: true }))
    const sleepImpl = vi.fn().mockResolvedValue(undefined)

    await expect(genaiFetch('https://example.test', { apiKey: 'key' }, {
      fetchImpl,
      sleepImpl,
    })).resolves.toMatchObject({ data: { ok: true } })
    expect(sleepImpl).toHaveBeenCalledTimes(1)
    expect(sleepImpl.mock.calls[0]).toHaveLength(1)
    expect(sleepImpl).toHaveBeenCalledWith(1000)
  })
})
