import ShoppingPanel from './shopping/ShoppingPanel.jsx'

export default function ProjectWorkflowPanel({
  workflowType,
  shoppingProjectPath,
  shoppingPipeline,
  storyContent,
}) {
  if (workflowType === 'shopping-short') {
    return shoppingProjectPath ? (
      <div className="main-panel">
        <ShoppingPanel pipeline={shoppingPipeline} />
      </div>
    ) : (
      <div className="story-guard">
        <p>📁 폴더 저장 모드에서만 쇼핑 숏츠 기능을 사용할 수 있습니다. 설정에서 저장 모드를 폴더로 변경해주세요.</p>
      </div>
    )
  }

  return storyContent
}
