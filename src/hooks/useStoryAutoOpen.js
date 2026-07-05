/**
 * Story 프로젝트 경로가 준비되면 세션을 여는 effect 훅.
 *
 * 버그: projectPath가 바뀌었는데도 이전 프로젝트에서 이미 open되어 state가 채워져
 * 있으면(non-null) 재open을 건너뛰는 조건(`!state`)을 쓰면, main의 story 스텝 머신이
 * 이전 프로젝트 경로에 계속 바인딩된 채 새 프로젝트 화면에서 대본을 생성해 이전 프로젝트
 * 폴더에 쓰는 크로스 프로젝트 데이터 오염이 발생한다.
 *
 * 수정: state 유무와 무관하게 projectPath 값 자체의 변경을 ref로 추적해, 경로가 바뀌면
 * 무조건 open()을 다시 부른다. 이전 머신의 abort는 main의 story:open이 자체 처리한다.
 *
 * 일반 타임라인도 story audio/SFX를 프리뷰하려면 디스크의 story scenes를 renderer state에
 * hydrate해야 하므로, Story 화면 진입 여부와 무관하게 projectPath가 있으면 한 번 연다.
 */
import { useEffect, useRef } from 'react'

export function useStoryAutoOpen({ activeView, projectPath, open }) {
  const openedPathRef = useRef(null)

  useEffect(() => {
    if (!projectPath) {
      openedPathRef.current = null
      return
    }
    if (openedPathRef.current === projectPath) return
    openedPathRef.current = projectPath
    open()
  }, [activeView, projectPath, open])
}
