import * as fs from 'node:fs/promises'
import path from 'node:path'

function hasParentSegment(value) {
  return value.split(/[\\/]/).includes('..')
}

function isWithinWorkFolder(projectPath, workFolder) {
  const relative = path.relative(workFolder, projectPath)
  return relative !== '' && !relative.startsWith('..') && !path.isAbsolute(relative)
}

function identityOf(info) {
  return { dev: info.dev, ino: info.ino }
}

function sameIdentity(left, right) {
  return left?.dev === right?.dev && left?.ino === right?.ino
}

async function inspectExactDirectory(candidate) {
  const info = await fs.lstat(candidate)
  if (info.isSymbolicLink() || !info.isDirectory()) throw new Error('invalid-project-path')
  return identityOf(info)
}

async function readWorkflowType(projectPath) {
  try {
    const raw = await fs.readFile(path.join(projectPath, 'project.json'), 'utf8')
    const data = JSON.parse(raw)
    return Object.hasOwn(data, 'workflowType') ? data.workflowType : 'story'
  } catch (error) {
    if (error?.code === 'ENOENT') return 'story'
    throw error
  }
}

export async function resolveWorkflowProjectContext({
  projectPath,
  getActiveWorkFolder,
  expectedWorkflowType,
}) {
  if (
    typeof projectPath !== 'string'
    || !projectPath
    || !path.isAbsolute(projectPath)
    || hasParentSegment(projectPath)
  ) return { error: 'invalid-project-path' }

  const activeWorkFolder = await getActiveWorkFolder?.()
  const workFolder = typeof activeWorkFolder === 'string'
    ? activeWorkFolder
    : activeWorkFolder?.path
  const confirmedWorkFolderIdentity = typeof activeWorkFolder === 'object'
    ? activeWorkFolder?.identity
    : null
  if (typeof workFolder !== 'string' || !workFolder) {
    return { error: 'project-context-not-ready' }
  }

  let canonicalProjectPath
  let canonicalWorkFolder
  let projectIdentity
  let workFolderIdentity
  try {
    const canonicalPaths = await Promise.all([
      fs.realpath(path.normalize(projectPath)),
      fs.realpath(path.normalize(workFolder)),
    ])
    canonicalProjectPath = canonicalPaths[0]
    canonicalWorkFolder = canonicalPaths[1]
    const [projectStat, workFolderStat] = await Promise.all([
      inspectExactDirectory(canonicalProjectPath),
      inspectExactDirectory(canonicalWorkFolder),
    ])
    if (confirmedWorkFolderIdentity && !sameIdentity(workFolderStat, confirmedWorkFolderIdentity)) {
      return { error: 'invalid-project-path' }
    }
    projectIdentity = projectStat
    workFolderIdentity = workFolderStat
  } catch {
    return { error: 'invalid-project-path' }
  }

  if (!isWithinWorkFolder(canonicalProjectPath, canonicalWorkFolder)) {
    return { error: 'invalid-project-path' }
  }

  const workflowType = await readWorkflowType(canonicalProjectPath)
  if (expectedWorkflowType === 'story' && workflowType !== 'story') {
    return { error: 'shopping-workflow-requires-plan-machine' }
  }
  if (expectedWorkflowType === 'shopping-short' && workflowType !== 'shopping-short') {
    return { error: 'story-workflow-requires-step-machine' }
  }

  return {
    projectPath: canonicalProjectPath,
    workFolder: canonicalWorkFolder,
    projectIdentity,
    workFolderIdentity,
    workflowType,
  }
}

export async function revalidateWorkflowProjectContext(context) {
  if (
    typeof context?.projectPath !== 'string'
    || typeof context?.workFolder !== 'string'
    || !context.projectIdentity
    || !context.workFolderIdentity
  ) return { error: 'invalid-project-path' }

  try {
    const [projectIdentity, workFolderIdentity] = await Promise.all([
      inspectExactDirectory(context.projectPath),
      inspectExactDirectory(context.workFolder),
    ])
    if (
      !sameIdentity(projectIdentity, context.projectIdentity)
      || !sameIdentity(workFolderIdentity, context.workFolderIdentity)
      || !isWithinWorkFolder(context.projectPath, context.workFolder)
    ) return { error: 'invalid-project-path' }
  } catch {
    return { error: 'invalid-project-path' }
  }

  return context
}
