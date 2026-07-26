import * as fs from 'node:fs/promises'
import path from 'node:path'

async function canonicalDirectory(candidate) {
  if (typeof candidate !== 'string' || !candidate || !path.isAbsolute(candidate)) {
    throw new Error('invalid-work-folder')
  }
  const canonicalPath = await fs.realpath(path.normalize(candidate))
  const info = await fs.stat(canonicalPath)
  if (!info.isDirectory()) throw new Error('invalid-work-folder')
  return canonicalPath
}

export function createWorkFolderAuthority({ onChange } = {}) {
  let canonicalPath = null
  let confirmationLock = Promise.resolve()

  return {
    confirm(candidate) {
      const task = confirmationLock.then(async () => {
        const nextPath = await canonicalDirectory(candidate)
        if (canonicalPath && canonicalPath !== nextPath) {
          await onChange?.({ previousPath: canonicalPath, nextPath })
        }
        canonicalPath = nextPath
        return canonicalPath
      })
      confirmationLock = task.then(() => undefined, () => undefined)
      return task
    },
    async matches(candidate) {
      if (!canonicalPath) return false
      try {
        return (await canonicalDirectory(candidate)) === canonicalPath
      } catch {
        return false
      }
    },
    getCanonicalPath() {
      return canonicalPath
    },
  }
}
