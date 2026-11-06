/** Only the exact gallery URL is fetched. Generation RPCs never originate here. */
export function downloadFlowImage(net, session, item, { signal, timeoutMs = 30000, maxBytes = 32 * 1024 * 1024 } = {}) {
  return new Promise((resolve, reject) => {
    let u
    try { u = new URL(item.src) } catch { reject(new Error('download-url')); return }
    const allowed = (['flow.google.com', 'labs.google'].includes(u.hostname) && /\/(?:media\.)?getMediaUrlRedirect$/.test(u.pathname) && u.searchParams.get('name') === item.mediaId)
      || (u.hostname === 'flow-content.google' && u.pathname === `/image/${item.mediaId}`)
      || (['flow.google.com', 'lh3.googleusercontent.com'].includes(u.hostname) && /^\/asb\/[A-Za-z0-9_-]+(?:=|$)/.test(u.pathname))
    if (!allowed || u.protocol !== 'https:' || u.username || u.password || u.port || signal?.aborted) { reject(new Error('download-unavailable')); return }
    let req, response, timer, ended = false, bytes = 0, mime
    const chunks = []
    const cleanup = () => {
      clearTimeout(timer)
      signal?.removeEventListener('abort', onAbort)
      req?.removeListener('response', onResponse)
      req?.removeListener('error', onError)
      req?.removeListener('abort', onAbort)
      req?.removeListener('close', onClose)
      response?.removeListener('data', onData)
      response?.removeListener('end', onEnd)
      response?.removeListener('error', onError)
      response?.removeListener('aborted', onAbort)
      response?.removeListener('close', onClose)
    }
    const finish = error => {
      if (ended) return
      ended = true
      // Electron abort can synchronously emit abort/close; ended prevents reentry.
      if (error) { try { req?.abort() } catch { /* already closed */ } }
      cleanup()
      if (error) { chunks.length = 0; reject(error) }
      else resolve({ mediaId: item.mediaId, width: item.width, height: item.height,
        base64: `data:${mime};base64,${Buffer.concat(chunks).toString('base64')}` })
    }
    const onError = () => finish(new Error('download-network'))
    const onAbort = () => finish(new Error('download-aborted'))
    const onClose = () => { if (!ended) finish(new Error('download-incomplete')) }
    const onData = chunk => {
      bytes += chunk.length
      if (bytes > maxBytes) return finish(new Error('download-size'))
      chunks.push(Buffer.from(chunk))
    }
    const onEnd = () => finish(bytes ? null : new Error('download-empty'))
    const onResponse = res => {
      response = res
      const type = res.headers?.['content-type']
      mime = String(Array.isArray(type) ? type[0] : type || '').split(';')[0].trim().toLowerCase()
      if (res.statusCode !== 200 || !['image/png', 'image/jpeg', 'image/webp'].includes(mime)) return finish(new Error('download-response'))
      res.on('data', onData); res.on('end', onEnd); res.on('error', onError); res.on('aborted', onAbort); res.on('close', onClose)
    }
    try {
      // asb is a thumbnail rendition, never the exported image. Resolve its
      // explicit media ID through the same redirect used by legacy image cards.
      const url = u.pathname.startsWith('/asb/')
        ? `https://labs.google/fx/api/trpc/media.getMediaUrlRedirect?name=${encodeURIComponent(item.mediaId)}` : u.href
      req = net.request({ url, method: 'GET', session, useSessionCookies: true })
      req.on('response', onResponse); req.on('error', onError); req.on('abort', onAbort); req.on('close', onClose)
      signal?.addEventListener('abort', onAbort, { once: true })
      timer = setTimeout(() => finish(new Error('download-timeout')), timeoutMs)
      req.end()
    } catch { finish(new Error('download-start')) }
  })
}
