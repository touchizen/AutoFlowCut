/**
 * provider 레지스트리 (스펙 §5.10, R1 MAJOR: prototype lookup + 조용한 폴백 방지).
 *
 * null-proto 맵 + Object.hasOwn 으로 조회 — 미등록 id 는 null(조용한 google 폴백 금지).
 * capability 조건부 등록: 각 게이트웨이는 해당 마일스톤에서 검증한 모달리티에만 등록.
 * M0b 는 google 만 등록(image/video). 신규 provider(openai/grok/...)는 M1+ 에서 한 줄 슬롯인.
 */
import { googleImageProvider } from './image/google.js'
import { openaiImageProvider } from './image/openai.js'
import { falImageProvider } from './image/fal.js'
import { falVideoProvider } from './video/fal.js'
import { grokVideoProvider } from './video/grok.js'
import { wavespeedVideoProvider } from './video/wavespeed.js'
import { higgsfieldVideoProvider } from './video/higgsfield.js'
import { googleVideoProvider } from './video/google.js'

const imageRegistry = Object.assign(Object.create(null), {
  google: googleImageProvider,
  openai: openaiImageProvider,
  fal: falImageProvider,
})
const videoRegistry = Object.assign(Object.create(null), {
  google: googleVideoProvider,
  grok: grokVideoProvider,
  fal: falVideoProvider,
  wavespeed: wavespeedVideoProvider,
  higgsfield: higgsfieldVideoProvider,
})

/** @returns {object|null} 이미지 provider 객체 또는 미등록 시 null */
export function getImageProvider(id) {
  if (id && Object.hasOwn(imageRegistry, id)) return imageRegistry[id]
  return null
}

/** @returns {object|null} 비디오 provider 객체 또는 미등록 시 null */
export function getVideoProvider(id) {
  if (id && Object.hasOwn(videoRegistry, id)) return videoRegistry[id]
  return null
}

/** @returns {{image: Array<{id:string}>, video: Array<{id:string}>}} 등록된 provider id 목록 */
export function listProviders() {
  return {
    image: Object.keys(imageRegistry).map((id) => ({ id })),
    video: Object.keys(videoRegistry).map((id) => ({ id })),
  }
}
