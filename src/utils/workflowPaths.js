export function deriveWorkflowPaths(workflowType, projectRootPath) {
  if (!projectRootPath) return { storyProjectPath: null, shoppingProjectPath: null }
  return {
    storyProjectPath: workflowType === 'story' ? projectRootPath : null,
    shoppingProjectPath: workflowType === 'shopping-short' ? projectRootPath : null,
  }
}
