const isGenerating = (scene) => (
  scene?.status === 'generating'
  || scene?.videoT2VStatus === 'generating'
  || scene?.videoI2VStatus === 'generating'
)

export function busyPromptLines(scenes, { field, trimTrailing }) {
  const promptParts = scenes.map((scene) => String(scene?.[field] || ''))
  const joined = promptParts.join('\n')
  const value = trimTrailing ? joined.replace(/\n+$/, '') : joined
  const paragraphLimit = value.split('\n').length
  const busyLines = new Set()
  let paragraphOffset = 0

  scenes.forEach((scene, index) => {
    // trimTrailing 탭에서는 꼬리 빈 씬의 문단 자체가 없다. 단, value가 완전히 비어도
    // Lexical의 단일 문단은 첫 씬 소유라 offset 0만 상한 안에 남는다.
    if (isGenerating(scene) && paragraphOffset < paragraphLimit) {
      busyLines.add(paragraphOffset)
    }

    paragraphOffset += promptParts[index].split('\n').length
  })

  return busyLines
}
