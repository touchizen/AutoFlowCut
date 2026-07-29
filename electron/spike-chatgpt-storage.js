import path from 'node:path'

export function spikeDir(app) {
  return path.join(app.getPath('userData'), 'spike-chatgpt')
}

export function dumpFilename(name) {
  return `dom-dump-${name}.json`
}

// mkdir(recursive) 후 write — spike-chatgpt 하위 디렉토리는 신규라 mkdir 없으면 ENOENT.
export function saveDump(app, name, data, fs) {
  const dir = spikeDir(app)
  fs.mkdirSync(dir, { recursive: true })
  const p = path.join(dir, dumpFilename(name))
  fs.writeFileSync(p, JSON.stringify(data, null, 2))
  return p
}
