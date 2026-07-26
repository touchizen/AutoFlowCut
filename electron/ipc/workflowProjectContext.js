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

function workflowTypeMismatch(expectedWorkflowType, workflowType) {
  if (expectedWorkflowType === 'story' && workflowType !== 'story') {
    return 'shopping-workflow-requires-plan-machine'
  }
  if (expectedWorkflowType === 'shopping-short' && workflowType !== 'shopping-short') {
    return 'story-workflow-requires-step-machine'
  }
  return null
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

  // getActiveWorkFolder 는 getVerifiedContext 로 승격되면서 미확정/ENOENT(폴더 삭제)/identity
  // 불일치에 throw 한다. open 의 `await validate()` 와 IPC 핸들러엔 catch 가 없어, throw 가 그대로
  // 새어나가면 story:open/shopping:open invoke 가 reject → renderer unhandled rejection + openError
  // 미설정으로 "침묵하는 죽은 뷰"가 된다(R3 F1). throw 를 {error} 계약으로 되돌려 fail-closed 유지.
  let activeWorkFolder
  try {
    activeWorkFolder = await getActiveWorkFolder?.()
  } catch {
    return { error: 'project-context-not-ready' }
  }
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

  // readWorkflowType 은 ENOENT 만 'story' 로 흡수하고 손상 JSON(SyntaxError)/EACCES/EISDIR 등은 throw 한다.
  // 이 호출은 realpath try 밖이라, throw 가 새면 F1 과 동일하게 open reject → 침묵 죽은 뷰가 된다(R4).
  // revalidate(아래)는 이미 try 안에서 {error} 로 변환하므로 resolve 도 대칭으로 fail-closed 한다.
  let workflowType
  try {
    workflowType = await readWorkflowType(canonicalProjectPath)
  } catch {
    return { error: 'invalid-project-path' }
  }
  const workflowTypeError = workflowTypeMismatch(expectedWorkflowType, workflowType)
  if (workflowTypeError) return { error: workflowTypeError }

  return {
    projectPath: canonicalProjectPath,
    workFolder: canonicalWorkFolder,
    projectIdentity,
    workFolderIdentity,
    workflowType,
    expectedWorkflowType,
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
    const [projectIdentity, workFolderIdentity, workflowType] = await Promise.all([
      inspectExactDirectory(context.projectPath),
      inspectExactDirectory(context.workFolder),
      readWorkflowType(context.projectPath),
    ])
    if (
      !sameIdentity(projectIdentity, context.projectIdentity)
      || !sameIdentity(workFolderIdentity, context.workFolderIdentity)
      || !isWithinWorkFolder(context.projectPath, context.workFolder)
    ) return { error: 'invalid-project-path' }
    if (
      workflowType !== context.workflowType
      || workflowType !== context.expectedWorkflowType
    ) {
      return {
        error: workflowTypeMismatch(context.expectedWorkflowType, workflowType)
          || 'invalid-project-path',
      }
    }
  } catch {
    return { error: 'invalid-project-path' }
  }

  return context
}
