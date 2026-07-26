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

export function createWorkFolderAuthority() {
  let canonicalPath = null

  return {
    async confirm(candidate) {
      canonicalPath = await canonicalDirectory(candidate)
      return canonicalPath
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
