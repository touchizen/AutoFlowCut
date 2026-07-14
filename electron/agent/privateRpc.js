import { createHash, randomBytes, timingSafeEqual } from 'node:crypto'
import { createServer } from 'node:http'

const HOST = '127.0.0.1'

function authorizationDigest(value) {
  return createHash('sha256').update(value).digest()
}

function errorMessage(error) {
  if (error instanceof Error) return error.message
  if (typeof error === 'string') return error

  try {
    const serialized = JSON.stringify(error)
    return serialized === undefined ? String(error) : serialized
  } catch {
    return String(error)
  }
}

function sendJson(res, status, payload) {
  const body = JSON.stringify(payload)
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' })
  res.end(body)
}

function readJson(req) {
  return new Promise((resolve, reject) => {
    let body = ''
    req.setEncoding('utf8')
    req.on('data', (chunk) => { body += chunk })
    req.once('end', () => {
      try {
        resolve(JSON.parse(body))
      } catch (error) {
        reject(error)
      }
    })
    req.once('error', reject)
    req.once('aborted', () => reject(new Error('request aborted')))
  })
}

/**
 * 별도 adapter process 가 main Tool Core 를 부르는 단방향 통로다.
 *
 * 🔴 loopback 밖에 열리거나 인증 전에 body/Tool Core 를 건드리면, 로컬 웹페이지나 다른
 *    프로세스가 사용자 프로젝트를 조작할 수 있다. 토큰은 세션마다 새로 만들고 CORS 는 열지 않는다.
 */
export function createPrivateRpc({ toolCore, sessionId }) {
  if (!toolCore || typeof toolCore.call !== 'function') {
    throw new TypeError('toolCore.call must be a function')
  }

  const token = randomBytes(32).toString('base64url')
  const expectedAuthorization = authorizationDigest(`Bearer ${token}`)
  let endpoint = null
  let startPromise = null
  let closePromise = null
  let closed = false

  function isAuthorized(header) {
    // 🔴 길이 분기나 prefix 비교는 토큰 정보를 샌다. 같은 길이 digest 끼리만 상수 시간 비교한다.
    const received = authorizationDigest(typeof header === 'string' ? header : '')
    return timingSafeEqual(received, expectedAuthorization)
  }

  async function handleRequest(req, res) {
    // 경로와 method 를 늘리지 않는다. 이 서버는 조회 API 나 범용 로컬 HTTP bridge 가 아니다.
    if (req.url !== '/call') {
      sendJson(res, 404, { error: 'not found' })
      return
    }
    if (req.method !== 'POST') {
      sendJson(res, 405, { error: 'method not allowed' })
      return
    }

    // 인증 실패는 body 파싱보다 먼저 끝내야 공격자 입력이 Tool Core 에 닿을 여지가 없다.
    if (!isAuthorized(req.headers.authorization)) {
      sendJson(res, 401, { error: 'unauthorized' })
      return
    }

    let body
    try {
      body = await readJson(req)
    } catch {
      sendJson(res, 400, { error: 'malformed body' })
      return
    }

    if (typeof body?.tool !== 'string' || body.tool.trim().length === 0) {
      sendJson(res, 400, { error: 'tool is required' })
      return
    }

    // close 와 body 수신이 겹쳐도 세션 종료 뒤 새 Tool Core 호출을 시작하지 않는다.
    if (closed) {
      sendJson(res, 503, { error: 'closed' })
      return
    }

    try {
      const result = await toolCore.call(body.tool, body.args, { sessionId, nonce: body.nonce })
      sendJson(res, 200, { result })
    } catch (error) {
      // 잘못된 툴 하나가 adapter/main process 의 수명까지 끝내면 다음 호출도 모두 잃는다.
      sendJson(res, 200, { error: errorMessage(error) })
    }
  }

  const server = createServer((req, res) => {
    handleRequest(req, res).catch((error) => {
      if (!res.headersSent) sendJson(res, 500, { error: errorMessage(error) })
      else res.destroy(error)
    })
  })

  function start() {
    if (closed) return Promise.reject(new Error('private RPC is closed'))
    if (endpoint) return Promise.resolve(endpoint)
    if (startPromise) return startPromise

    startPromise = new Promise((resolve, reject) => {
      const onError = (error) => {
        startPromise = null
        reject(error)
      }

      server.once('error', onError)
      server.listen(0, HOST, () => {
        server.off('error', onError)
        const address = server.address()
        if (!address || typeof address === 'string') {
          startPromise = null
          reject(new Error('private RPC did not bind a TCP port'))
          return
        }

        endpoint = Object.freeze({ host: HOST, port: address.port, token })
        resolve(endpoint)
      })
    })

    return startPromise
  }

  function close() {
    if (closePromise) return closePromise
    closed = true

    closePromise = (async () => {
      // bind 완료 전 close 가 resolve 하면 listen callback 이 나중에 문을 다시 연다.
      // 시작 성공/실패를 먼저 정산한 뒤 listener 종료까지 기다려야 세션 종료가 경계가 된다.
      if (startPromise) {
        try {
          await startPromise
        } catch {
          // bind 실패 뒤엔 닫을 listener 가 없다.
        }
      }

      if (!server.listening) return

      await new Promise((resolve, reject) => {
        server.close((error) => {
          if (error) reject(error)
          else resolve()
        })
      })
    })()

    return closePromise
  }

  return { start, close }
}
