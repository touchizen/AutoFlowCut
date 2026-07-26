import * as fs from 'node:fs/promises'
import path from 'node:path'

function hasParentSegment(value) {
  return value.split(/[\\/]/).includes('..')
}

function isWithinWorkFolder(projectPath, workFolder) {
  const relative = path.relative(workFolder, projectPath)
  return relative !== '' && !relative.startsWith('..') && !path.isAbsolute(relative)
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

  const workFolder = await getActiveWorkFolder?.()
  if (typeof workFolder !== 'string' || !workFolder) {
    return { error: 'project-context-not-ready' }
  }

  let canonicalProjectPath
  let canonicalWorkFolder
  try {
    const canonicalPaths = await Promise.all([
      fs.realpath(path.normalize(projectPath)),
      fs.realpath(path.normalize(workFolder)),
    ])
    canonicalProjectPath = canonicalPaths[0]
    canonicalWorkFolder = canonicalPaths[1]
    const [projectStat, workFolderStat] = await Promise.all([
      fs.stat(canonicalProjectPath),
      fs.stat(canonicalWorkFolder),
    ])
    if (!projectStat.isDirectory() || !workFolderStat.isDirectory()) {
      return { error: 'invalid-project-path' }
    }
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
    workflowType,
  }
}
