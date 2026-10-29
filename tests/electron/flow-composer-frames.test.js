/**
 * 2026-10-30 I2V — 프레임 모드 컴포저의 시작·끝 칸 판독(readFrameSlots). 픽스처는 크롬 실기 DOM(flow.google.com, 프레임 모드) 그대로:
 *   flow-ingredient-bar > .ingredient-bar-container > .frame-trigger(시작) · 바꾸기 버튼 · .frame-trigger(끝).
 *   빈 칸 = button.empty-chip("시작"/"종료" — 로케일 문구는 보지 않는다), 채운 칸 = flow-image-ingredient-chip > button.chip-container[aria-busy] > img.chip-image
 *   (src https://flow-content.google/image/<mediaId>?… — 칩은 불투명 애셋에서 골라도 id 를 드러낸다; storage.googleapis.com 등 다른 주소면 mediaId null).
 */
import { describe, it, expect, beforeEach } from 'vitest'
import { readFrameSlots, READ_FRAME_SLOTS_JS } from '../../electron/flow-composer-refs.js'
import { idSrc, uuid } from '../fixtures/flow-live-dom-m3.js'

const U = uuid
const chip = (src, busy = false) => `<flow-image-ingredient-chip><button cdkoverlayorigin="" class="chip-container" aria-label="이미지 소재" aria-busy="${busy}"><div class="chip-image-wrapper"><img alt="소재 이미지" class="chip-image cropped" src="${src}"></div><div class="hover-icon-overlay" data-state="closed"><mat-icon class="mat-icon hover-icon">cancel</mat-icon></div></button></flow-image-ingredient-chip>`
const empty = (label) => `<button type="button" class="empty-chip"> ${label} </button>`
const frameBar = (start, end) => `<flow-base-prompt-box><flow-ingredient-bar class="prompt-ingredient-bar"><div class="ingredient-bar-container">`
  + `<div cdkoverlayorigin="" class="frame-trigger">${start}</div>`
  + `<button aria-label="첫 번째 프레임과 마지막 프레임 바꾸기"><mat-icon>swap_horiz</mat-icon></button>`
  + `<div cdkoverlayorigin="" class="frame-trigger">${end}</div>`
  + `</div></flow-ingredient-bar><div class="ProseMirror" contenteditable="true"><p></p></div></flow-base-prompt-box>`

beforeEach(() => { document.body.innerHTML = '' })

describe('readFrameSlots(doc) → {framesMode, slots:[{mediaId, busy, empty}]}', () => {
  it('시작 칸에 id 칩, 끝 칸 비어 있음(실기 — 크롬 프레임 모드)', () => {
    document.body.innerHTML = frameBar(chip(idSrc(U(4))), empty('종료'))
    expect(readFrameSlots(document)).toEqual({
      framesMode: true,
      slots: [{ mediaId: U(4), busy: false, empty: false }, { mediaId: null, busy: false, empty: true }],
    })
  })

  it('두 칸 다 비었으면 empty 둘 · 영어 로케일 문구여도 같다', () => {
    document.body.innerHTML = frameBar(empty('Start'), empty('End'))
    expect(readFrameSlots(document).slots).toEqual([{ mediaId: null, busy: false, empty: true }, { mediaId: null, busy: false, empty: true }])
  })

  it('칩 주소가 id 썸네일이 아니면(storage.googleapis.com 서명 주소) mediaId null · 업로드 중이면 busy', () => {
    document.body.innerHTML = frameBar(chip('https://storage.googleapis.com/x/y.png?X-Goog-Signature=abc', true), chip(idSrc(U(5))))
    expect(readFrameSlots(document).slots).toEqual([{ mediaId: null, busy: true, empty: false }, { mediaId: U(5), busy: false, empty: false }])
  })

  it('소재 모드(.frame-trigger 없음)면 framesMode:false · slots []', () => {
    document.body.innerHTML = '<flow-ingredient-bar><div class="ingredient-bar-container"><button class="add-menu-trigger"></button></div></flow-ingredient-bar>'
    expect(readFrameSlots(document)).toEqual({ framesMode: false, slots: [] })
  })

  it('READ_FRAME_SLOTS_JS 는 같은 결과의 단일 표현식(페이지 주입)', () => {
    document.body.innerHTML = frameBar(chip(idSrc(U(4))), empty('종료'))
    expect(window.eval(READ_FRAME_SLOTS_JS)).toEqual(readFrameSlots(document))
  })
})
