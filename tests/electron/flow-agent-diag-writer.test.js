// @vitest-environment node
//
// The diagnostic sink runs on EVERY not_found. A failing batch fails every scene, so a
// naive writer drops 20 JSON files on the user's Desktop and they have no idea which to
// send. Write once per session.
//
// Desktop also isn't always writable: the Windows Store (AppX) build runs in an
// AppContainer where Desktop writes are redirected or denied. Fall back to userData
// rather than losing the one piece of evidence we need.
import { describe, it, expect, vi } from 'vitest'
import { createAgentDiagWriter } from '../../electron/flow-agent-diag.js'

const DIAG = { caller: 'ensureAgentOff', candidates: [], context: {} }

function makeWriter({ writeFile = vi.fn(), desktopDir = '/Desktop', userDataDir = '/userData' } = {}) {
  const writer = createAgentDiagWriter({
    writeFile,
    desktopDir,
    userDataDir,
    now: () => new Date('2026-07-12T18:34:12'),
  })
  return { writer, writeFile }
}

describe('createAgentDiagWriter', () => {
  it('writes the diagnostic to the Desktop', async () => {
    const { writer, writeFile } = makeWriter()

    const p = await writer(DIAG)

    expect(writeFile).toHaveBeenCalledTimes(1)
    const [path, body] = writeFile.mock.calls[0]
    expect(path).toBe('/Desktop/flow-agent-diag-20260712-183412.json')
    expect(JSON.parse(body)).toMatchObject({ caller: 'ensureAgentOff' })
    expect(p).toBe(path)
  })

  it('writes only once per session — a 20-scene batch must not bury the Desktop', async () => {
    const { writer, writeFile } = makeWriter()

    const first = await writer(DIAG)
    const second = await writer(DIAG)
    const third = await writer(DIAG)

    expect(writeFile).toHaveBeenCalledTimes(1)
    // Later failures report the already-written file rather than a new one.
    expect(second).toBe(first)
    expect(third).toBe(first)
  })

  it('falls back to userData when the Desktop is not writable (AppX sandbox)', async () => {
    const writeFile = vi.fn((path) => {
      if (path.startsWith('/Desktop')) throw new Error('EPERM: operation not permitted')
    })
    const { writer } = makeWriter({ writeFile })

    const p = await writer(DIAG)

    expect(writeFile).toHaveBeenCalledTimes(2)
    expect(p).toBe('/userData/flow-agent-diag-20260712-183412.json')
  })

  it('returns null when both locations fail, without throwing into the caller', async () => {
    const writeFile = vi.fn(() => { throw new Error('EPERM') })
    const { writer } = makeWriter({ writeFile })

    await expect(writer(DIAG)).resolves.toBeNull()
  })
})
