// @vitest-environment node
import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'

const source = readFileSync(new URL('../../src/App.jsx', import.meta.url), 'utf8')

describe('App shopping workflow wiring', () => {
  it('workflowType으로 Story path/listener와 Shopping path/open을 상호 배타적으로 gate한다', () => {
    expect(source).toMatch(/workflowType[^}]*\} = useProjectData\(/)
    expect(source).toMatch(/const isStoryWorkflow = workflowType === 'story'/)
    expect(source).toMatch(/const isShoppingWorkflow = workflowType === 'shopping-short'/)
    expect(source).toMatch(/const storyProjectPath = isStoryWorkflow \? projectRootPath : null/)
    expect(source).toMatch(/const shoppingProjectPath = isShoppingWorkflow \? projectRootPath : null/)
    expect(source).toMatch(/useStoryPipeline\(\{[\s\S]*?enabled: isStoryWorkflow,[\s\S]*?projectPath: storyProjectPath,/)
    expect(source).toMatch(/useStoryAutoOpen\(\{ activeView, projectPath: storyProjectPath, open: storyPipeline\.open \}\)/)
    expect(source).toMatch(/useShoppingPipeline\(\{ projectPath: shoppingProjectPath, enabled: isShoppingWorkflow \}\)/)
    expect(source).toMatch(/shoppingPipeline\.open\(\)/)
  })
})
