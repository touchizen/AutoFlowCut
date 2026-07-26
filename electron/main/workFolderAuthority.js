import * as fs from 'node:fs/promises'
import path from 'node:path'

async function canonicalDirectory(candidate) {
  if (typeof candidate !== 'string' || !candidate || !path.isAbsolute(candidate)) {
    throw new Error('invalid-work-folder')
  }
  const canonicalPath = await fs.realpath(path.normalize(candidate))
  const info = await exactDirectory(canonicalPath)
  return {
    path: canonicalPath,
    identity: info.identity,
  }
}

function sameIdentity(left, right) {
  return left?.dev === right?.dev && left?.ino === right?.ino
}

async function exactDirectory(candidate) {
  const info = await fs.lstat(candidate)
  if (info.isSymbolicLink() || !info.isDirectory()) throw new Error('invalid-work-folder')
  return { identity: { dev: info.dev, ino: info.ino } }
}

export function createWorkFolderAuthority({ onChange } = {}) {
  let canonicalPath = null
  let identity = null
  let confirmationLock = Promise.resolve()

  return {
    confirm(candidate) {
      const task = confirmationLock.then(async () => {
        const next = await canonicalDirectory(candidate)
        if (canonicalPath && (canonicalPath !== next.path || !sameIdentity(identity, next.identity))) {
          await onChange?.({ previousPath: canonicalPath, nextPath: next.path })
        }
        canonicalPath = next.path
        identity = next.identity
        return canonicalPath
      })
      confirmationLock = task.then(() => undefined, () => undefined)
      return task
    },
    async matches(candidate) {
      if (!canonicalPath) return false
      try {
        const candidateDirectory = await canonicalDirectory(candidate)
        return candidateDirectory.path === canonicalPath
          && sameIdentity(candidateDirectory.identity, identity)
      } catch {
        return false
      }
    },
    getCanonicalPath() {
      return canonicalPath
    },
    async getVerifiedContext() {
      if (!canonicalPath || !identity) throw new Error('invalid-work-folder')
      const current = await exactDirectory(canonicalPath)
      if (!sameIdentity(current.identity, identity)) throw new Error('invalid-work-folder')
      return { path: canonicalPath, identity: { ...identity } }
    },
  }
}
