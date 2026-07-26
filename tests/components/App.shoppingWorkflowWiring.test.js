// @vitest-environment node
import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { deriveWorkflowPaths } from '../../src/utils/workflowPaths.js'

const source = readFileSync(new URL('../../src/App.jsx', import.meta.url), 'utf8')

describe('App shopping workflow wiring', () => {
  it.each([
    ['story', '/work/project', { storyProjectPath: '/work/project', shoppingProjectPath: null }],
    ['shopping-short', '/work/project', { storyProjectPath: null, shoppingProjectPath: '/work/project' }],
    [undefined, '/work/project', { storyProjectPath: null, shoppingProjectPath: null }],
    ['story', null, { storyProjectPath: null, shoppingProjectPath: null }],
  ])('deriveWorkflowPaths(%s)는 workflow path를 상호 배타적으로 만든다', (workflowType, root, expected) => {
    expect(deriveWorkflowPaths(workflowType, root)).toEqual(expected)
  })

  it('workflowType으로 Story path/listener와 Shopping path/open을 상호 배타적으로 gate한다', () => {
    expect(source).toMatch(/workflowType[^}]*\} = useProjectData\(/)
    expect(source).toMatch(/const isStoryWorkflow = workflowType === 'story'/)
    expect(source).toMatch(/const isShoppingWorkflow = workflowType === 'shopping-short'/)
    expect(source).toMatch(/deriveWorkflowPaths\(workflowType, projectRootPath\)/)
    expect(source).toMatch(/useStoryPipeline\(\{[\s\S]*?enabled: isStoryWorkflow,[\s\S]*?projectPath: storyProjectPath,/)
    expect(source).toMatch(/useStoryAutoOpen\(\{ activeView, projectPath: storyProjectPath, open: storyPipeline\.open \}\)/)
    expect(source).toMatch(/useShoppingPipeline\(\{ projectPath: shoppingProjectPath, enabled: isShoppingWorkflow \}\)/)
    expect(source).toMatch(/shoppingPipeline\.open\(\)/)
    expect(source).toMatch(/useWorkflowProjectChange\(\{[\s\S]*?changeProject: handleProjectChange,[\s\S]*?setActiveView,[\s\S]*?\}\)/)
    expect(source).toMatch(/onProjectChange=\{handleWorkflowProjectChange\}/)
    expect(source).toMatch(/onOpenProject: handleWorkflowProjectChange/)
    expect(source).toMatch(/workflowType=\{workflowType\}/)
  })
})
