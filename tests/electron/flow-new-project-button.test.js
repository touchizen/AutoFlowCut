// @vitest-environment jsdom
//
// flow:new-project 의 "새 프로젝트" 버튼 파인더.
//
// 2026-09-23: Flow 가 flow.google.com 으로 옮기면서 홈의 새 프로젝트 버튼이
//   <button><i>add_2</i></button>  →  <button mat-fab extended class="… new-project-button …">
//                                        <span class="material-symbols-outlined">add</span> 새 프로젝트
//                                      </button>
// 로 바뀌었고, 옛 셀렉터(i 태그의 add_2)는 not-found 로 실패해 Flow 프로젝트 자동 생성이
// 막혔다(Desktop flow-diag-20260923-170017.json). 앵커는 번역되지 않는 것만 쓴다:
// 아이콘 리거처(add / add_2)와 DOM 구조. 라벨("새 프로젝트"/"New project")은 보지 않는다.
import { describe, it, expect } from 'vitest'
import { findNewProjectButton, FIND_NEW_PROJECT_BUTTON_JS } from '../../electron/flow-new-project-button.js'

// 2026-09-23 flow.google.com 홈 DOM 덤프(flow-dom-dump-20260923-173104.json)의 요소 구조를 재현.
const NEW_HOME = `
  <a aria-label="프로젝트 열기" class="project-thumbnail-container" href="/project/f22c8373-c2a3-482d-a66f-848759dbb8e3"></a>
  <button class="mdc-icon-button footer-button"><span class="material-symbols-outlined">edit</span></button>
  <button class="mdc-icon-button footer-button"><span class="material-symbols-outlined">delete</span></button>
  <button class="mdc-icon-button"><span class="material-symbols-outlined">more_vert</span></button>
  <button mat-fab extended class="mdc-fab mat-mdc-fab-base mat-mdc-fab mat-mdc-button-base new-project-button mat-accent mdc-fab--extended mat-mdc-extended-fab">
    <span class="material-symbols-outlined">add</span>새 프로젝트
  </button>
`

describe('findNewProjectButton', () => {
  it('새 도메인 홈: add 리거처를 가진 FAB 를 찾는다 (라벨 언어와 무관)', () => {
    document.body.innerHTML = NEW_HOME
    const btn = findNewProjectButton(document)
    expect(btn).toBeTruthy()
    expect(btn.classList.contains('new-project-button')).toBe(true)
  })

  it('영어 계정(라벨 "New project")에서도 같은 버튼을 찾는다', () => {
    document.body.innerHTML = NEW_HOME.replace('새 프로젝트', 'New project')
    expect(findNewProjectButton(document)?.classList.contains('new-project-button')).toBe(true)
  })

  it('옛 도메인 마크업(<i>add_2</i>)도 계속 찾는다', () => {
    document.body.innerHTML = `
      <button><i class="google-symbols">edit</i></button>
      <button id="legacy"><i class="google-symbols">add_2</i></button>
    `
    expect(findNewProjectButton(document)?.id).toBe('legacy')
  })

  it('edit/delete 만 있고 add 가 없으면 null — 아무 버튼이나 집지 않는다', () => {
    document.body.innerHTML = NEW_HOME.replace(/<button mat-fab[\s\S]*?<\/button>/, '')
    expect(findNewProjectButton(document)).toBeNull()
  })

  it('FIND_NEW_PROJECT_BUTTON_JS 는 페이지에 그대로 주입 가능한 단일 표현식이다 (trusted-click 의 `const el = …`)', () => {
    document.body.innerHTML = NEW_HOME
    // eslint-disable-next-line no-new-func
    const el = new Function('document', `return ${FIND_NEW_PROJECT_BUTTON_JS}`)(document)
    expect(el?.classList.contains('new-project-button')).toBe(true)
  })
})
