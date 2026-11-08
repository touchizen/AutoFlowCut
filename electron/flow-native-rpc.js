// Reuse only the read-RPC context of requests made by this document. Keep it
// in memory, discard it on navigation, never copy a submit body or replay one.
import { buildRpcRequest } from './flow-rpc-client.js'
import { FlowRpcError, parseBatchexecuteResponse } from './flow-rpc-protocol.js'
const base = 'https://flow.google.com',
  endpoint = '/_/AiSandboxAngularFrontend/data/batchexecute'
// A project media list is a native read only; it is intentionally unavailable
// to the legacy serialized page client. Derive its payload from the bound URL.
function buildProjectListRequest({ sourcePath, wiz, hl, reqid }) {
  const project = /^\/project\/([0-9a-f-]{36})\/?$/.exec(sourcePath)?.[1]
  if (!project) throw new Error('invalid project lookup')
  const query = new URLSearchParams({
    rpcids: 'Zzl0ze',
    'source-path': sourcePath,
    bl: wiz.bl,
    'f.sid': wiz.sid,
    hl: hl || 'en',
    _reqid: String(reqid),
    rt: 'c',
  })
  const payload = JSON.stringify(['projects/' + project, null, null, null, [1]])
  const body = new URLSearchParams({
    'f.req': JSON.stringify([[['Zzl0ze', payload, null, 'generic']]]),
    at: wiz.at,
  })
  return {
    url: endpoint + '?' + query,
    body: body.toString(),
    headers: { 'Content-Type': 'application/x-www-form-urlencoded;charset=utf-8', 'X-Same-Domain': '1' },
  }
}
export function nativeFlowReads(wc) {
  let context = null,
    seq = 0,
    epoch = 0
  for (const event of ['did-start-navigation', 'render-process-gone', 'destroyed'])
    wc.on(event, (_event, _url, _same, isMain) => {
      if (isMain !== false) {
        context = null
        epoch++
      }
    })
  return {
    observe(d) {
      if (d.webContentsId !== wc.id || d.method !== 'POST') return
      let u, current
      try {
        u = new URL(d.url)
        current = new URL(wc.getURL())
      } catch {
        return
      }
      if (
        u.origin !== base ||
        u.pathname !== endpoint ||
        current.origin !== base ||
        !/^\/project\/[a-f0-9-]{36}\/?$/.test(current.pathname) ||
        u.searchParams.get('source-path')?.replace(/\/$/, '') !== current.pathname.replace(/\/$/, '')
      )
        return
      if (
        !Array.isArray(d.uploadData) ||
        d.uploadData.some((x) => !x.bytes) ||
        d.uploadData.reduce((n, x) => n + x.bytes.length, 0) > 16 * 1024 * 1024
      )
        return
      // Extract the token only; do not parse or retain image bytes or prompts.
      const match = /(?:^|&)at=([^&]{1,8192})(?:&|$)/.exec(
        Buffer.concat(d.uploadData.map((x) => x.bytes)).toString(),
      )
      const sid = u.searchParams.get('f.sid'),
        bl = u.searchParams.get('bl')
      if (match && sid && bl) {
        let at
        try {
          at = decodeURIComponent(match[1])
        } catch {
          return
        }
        context = { url: current.href, wiz: { at, sid, bl }, hl: u.searchParams.get('hl') }
      }
    },
    async read(id, payload) {
      if (!['jwpduf', 'as29s', 'nzlxg', 'Zzl0ze'].includes(id)) throw new Error('rpcid not allowed')
      const ctx = context,
        atEpoch = epoch
      if (!ctx || wc.getURL() !== ctx.url)
        throw new FlowRpcError('network', { reason: 'read-context-unavailable' })
      const build = id === 'Zzl0ze' ? buildProjectListRequest : buildRpcRequest
      const r = build({
        rpcid: id,
        payload,
        wiz: ctx.wiz,
        hl: ctx.hl,
        sourcePath: new URL(ctx.url).pathname,
        reqid: ++seq,
      })
      const response = await wc.session.fetch(base + r.url, {
        method: 'POST',
        headers: r.headers,
        body: r.body,
        credentials: 'include',
        redirect: 'error',
        signal: AbortSignal.timeout(30000),
      })
      if (response.status !== 200) throw new FlowRpcError('http', { status: response.status })
      const body = await response.text()
      if (epoch !== atEpoch || context?.url !== ctx.url || wc.getURL() !== ctx.url)
        throw new FlowRpcError('network', { reason: 'read-document-changed' })
      return parseBatchexecuteResponse(body, id)
    },
  }
}
