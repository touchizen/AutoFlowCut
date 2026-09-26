import { describe, expect, it, vi } from 'vitest'
import { createGatewayClient } from '../../../../electron/api/providers/gatewayClient.js'

function jsonResponse(payload, status = 200) {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: vi.fn().mockResolvedValue(payload),
  }
}

describe('shared raw-REST gateway client', () => {
  it('parameterizes base URL, auth headers, submit path, poll path, and error classifier', async () => {
    const classifyError = vi.fn(() => 'quota')
    const client = createGatewayClient({
      providerName: 'Fixture',
      baseUrl: 'https://api.fixture.example',
      buildAuthHeaders: (creds) => ({ Authorization: `Fixture ${creds}` }),
      submitPath: (modelId) => `/submit/${encodeURIComponent(modelId)}`,
      pollPath: (taskId) => `/jobs/${encodeURIComponent(taskId)}`,
      validatePath: '/models',
      classifyError,
      downloadPolicy: {
        origins: [{ origin: 'https://cdn.fixture.example', authMode: 'provider-key' }],
        buildAuthHeaders: (creds) => ({ Authorization: `Fixture ${creds}` }),
      },
    })
    const fetchImpl = vi.fn()
      .mockResolvedValueOnce(jsonResponse({ data: { id: 'job-1' } }))
      .mockResolvedValueOnce(jsonResponse({ code: 402, message: 'payment required' }, 200))

    await expect(client.submitTask({
      apiKey: 'pair',
      modelId: 'model/a',
      input: { prompt: 'fixture' },
    }, { fetchImpl })).resolves.toMatchObject({ success: true })
    expect(fetchImpl).toHaveBeenNthCalledWith(1, 'https://api.fixture.example/submit/model%2Fa', {
      method: 'POST',
      headers: {
        Authorization: 'Fixture pair',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ prompt: 'fixture' }),
    })

    await expect(client.pollTask({
      apiKey: 'pair',
      taskId: 'job/1',
    }, { fetchImpl })).resolves.toEqual({
      success: false,
      error: 'payment required',
      errorKind: 'quota',
    })
    expect(fetchImpl).toHaveBeenNthCalledWith(2, 'https://api.fixture.example/jobs/job%2F1', {
      method: 'GET',
      headers: { Authorization: 'Fixture pair' },
    })
    expect(classifyError).toHaveBeenCalledWith(200, { code: 402, message: 'payment required' })
  })
})
