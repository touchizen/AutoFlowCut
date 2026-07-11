// @vitest-environment jsdom
//
// 캐릭터 상세 페이지(/project/{pid}/character/{entityId})의 이름 입력칸을 찾는다.
//
// 서버 진실은 PATCH /v1/flow/entities 가 이미 쓴다(entityInfo.displayName). 문제는 SPA 가 그 사실을
// 모른 채 페이지 로드 시점의 값('제목 없는 캐릭터')을 캐시하고 있어, 프로젝트를 나갔다 재진입해야
// 이름이 보인다는 것. 이 input 에 타이핑하면 SPA 스토어가 갱신돼 refresh 가 필요 없어진다
// (라이브 캡처 2026-07-10: 타이핑은 네트워크 요청을 내지 않는 순수 로컬 갱신).
//
// 셀렉터 제약(실측 마크업):
//   <form novalidate>…<input placeholder="캐릭터 이름" class="sc-43d80680-5 dQKPMK" value="제목 없는 캐릭터">
//                      <button type="button"><i class="google-symbols">edit</i></button>
//   - class 는 styled-components 해시(sc-43d80680-…) — 배포마다 바뀌므로 못 쓴다.
//   - placeholder 는 로케일 의존(URL 이 /fx/ko/) — 못 쓴다.
//   - 언어·빌드 무관한 앵커는 "바로 뒤에 edit 아이콘 버튼을 달고 있는 form 안의 input" 뿐이다.
import { describe, it, expect } from 'vitest'
import { findCharacterNameInput, findCharacterBackButton } from '../../electron/flow-character-name.js'

const html = (inner) => {
  document.body.innerHTML = inner
  return document
}

const NAME_FIELD = `
  <form novalidate class="sc-43d80680-0 TGPlg">
    <div class="sc-43d80680-1"><div class="sc-43d80680-3">
      <input placeholder="캐릭터 이름" class="sc-43d80680-5 dQKPMK" value="제목 없는 캐릭터">
      <button type="button" class="sc-43d80680-4"><i class="google-symbols">edit</i></button>
    </div></div>
    <textarea placeholder="캐릭터의 행동을 설명해 주세요…"></textarea>
    <input type="file" accept="image/*">
  </form>`

describe('findCharacterNameInput', () => {
  it('edit 아이콘 버튼을 뒤에 단 input 을 찾는다', () => {
    const el = findCharacterNameInput(html(NAME_FIELD))
    expect(el).toBeTruthy()
    expect(el.getAttribute('placeholder')).toBe('캐릭터 이름')
  })

  it('로케일이 달라도 찾는다 (placeholder 에 의존하지 않는다)', () => {
    const el = findCharacterNameInput(html(NAME_FIELD.replace('캐릭터 이름', 'Character name')))
    expect(el?.getAttribute('placeholder')).toBe('Character name')
  })

  it('styled-components 해시 클래스가 바뀌어도 찾는다', () => {
    const el = findCharacterNameInput(html(NAME_FIELD.replace(/sc-43d80680-\d/g, 'sc-deadbeef-9')))
    expect(el).toBeTruthy()
  })

  it('파일 input 이나 설명 textarea 를 고르지 않는다', () => {
    const el = findCharacterNameInput(html(NAME_FIELD))
    expect(el.tagName).toBe('INPUT')
    expect(el.getAttribute('type')).toBeNull()
  })

  it('edit 버튼이 없는 form 의 input 은 고르지 않는다 (엉뚱한 칸에 타이핑 금지)', () => {
    const el = findCharacterNameInput(html(`
      <form><input placeholder="검색"><button type="button"><i>search</i></button></form>`))
    expect(el).toBeNull()
  })

  it('컴포저 페이지처럼 name input 이 없으면 null (호출측이 refresh 로 폴백)', () => {
    expect(findCharacterNameInput(html('<textarea></textarea>'))).toBeNull()
  })

  it('disabled/readonly 인 input 은 고르지 않는다', () => {
    const el = findCharacterNameInput(html(NAME_FIELD.replace('<input placeholder', '<input disabled placeholder')))
    expect(el).toBeNull()
  })
})

// 타이핑만 하고 상세 페이지에 남아 있으면, 다음 동작의 ensureOnCharactersPage 가 loadURL(전체 로드)
// 로 SPA 스토어를 통째로 다시 받아 우리가 갱신한 이름이 날아간다. back 버튼은 SPA 클라이언트
// 라우팅이라 스토어를 유지한 채 목록으로 돌아간다 — 이름이 살아서 멘션 피커까지 간다.
// (덤: 다음 캐릭터 생성이 시작할 /characters 에 이미 도착해 있어 이동 한 번이 줄어든다.)
const HEADER = `
  <header>
    <div>
      <button class="sc-e8425ea6-0"><i class="google-symbols">arrow_back</i><span>뒤로</span></button>
    </div>
    <div>
      <button><i class="google-symbols">favorite</i><span>즐겨찾기</span></button>
      <button><i class="google-symbols">delete</i><span>캐릭터 삭제</span></button>
      <button>완료</button>
    </div>
  </header>`

describe('findCharacterBackButton', () => {
  it('arrow_back 아이콘 버튼을 찾는다', () => {
    const el = findCharacterBackButton(html(HEADER))
    expect(el?.tagName).toBe('BUTTON')
    expect(el.querySelector('i').textContent).toBe('arrow_back')
  })

  it('로케일이 달라도 찾는다 (아이콘 ligature 는 번역되지 않는다)', () => {
    const el = findCharacterBackButton(html(HEADER.replace('뒤로', 'Back')))
    expect(el).toBeTruthy()
  })

  it('삭제·즐겨찾기 같은 다른 아이콘 버튼을 고르지 않는다', () => {
    const el = findCharacterBackButton(html(HEADER))
    expect(el.querySelector('i').textContent).not.toBe('delete')
  })

  it("'완료' 텍스트 버튼을 고르지 않는다 (로케일 의존)", () => {
    const el = findCharacterBackButton(html(HEADER))
    expect(el.textContent).toContain('arrow_back')
  })

  it('없으면 null (호출측이 refresh 로 폴백)', () => {
    expect(findCharacterBackButton(html('<header><button>완료</button></header>'))).toBeNull()
  })
})
