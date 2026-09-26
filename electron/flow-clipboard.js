/**
 * electron/flow-clipboard.js
 *
 * M3-5 — 레퍼런스 업로드(편집기 붙여넣기)가 잠깐 빌려 쓰는 사용자 클립보드의 스냅샷·쓰기·복원(계획서 2026-09-25 M3 D4-c · 사용자 결정 4).
 * Electron `clipboard` 는 인자로 주입한다(테스트는 가짜). 순수 동기 함수 — 타이밍(관찰 즉시 복원, 붙여넣기 뒤 ≤5s 백스톱)은 호출자(flow-reference-driver.js) 몫.
 *
 *   스냅샷  availableFormats 에 text/uri-list(Finder 파일 복사 — 복원할 수 없다)가 있으면 fileCopy:true(호출자가 업로드를 멈춘다, 내용은 읽지 않는다).
 *           그 밖엔 text·html·rtf·image(비지 않으면) 중 있는 것만 보관한다. 앱 전용 형식(AutoFlowCut 자신의 텍스트창이 싣는
 *           application/x-lexical-editor 등)은 보관하지 않고 멈추지도 않는다 — 복원 뒤 앱에 붙이면 text/html 로 붙는다(§6 #11, 의도된 손실).
 *   쓰기    writeImage 1회 + 서명 sig = sha256(readImage().toPNG()) + 쓴 뒤의 형식 목록 fmts.
 *   복원    지금 형식·이미지 서명이 쓴 것과 같을 때만 clear() 뒤 write(보관한 것)(빈 스냅샷이면 clear 만). 다르면 사용자가 그 사이 복사한 것 —
 *           건드리지 않는다. throw 는 로그만(업로드·항목은 계속).
 * 로그는 개수·불리언·상태어만 — 클립보드 내용(텍스트·html·rtf·이미지)은 절대 싣지 않는다(PR P1d · 로그 규칙).
 * tests/electron/flow-clipboard.test.js
 */
import { createHash } from 'node:crypto'

const FILE_COPY_FORMAT = 'text/uri-list'
const sha256 = (buf) => createHash('sha256').update(buf).digest('hex')
const imageSig = (img) => (img && !img.isEmpty() ? sha256(img.toPNG()) : '')
const sameList = (a, b) => [...a].sort().join('\n') === [...b].sort().join('\n')

/**
 * @param {{platform?:string}} [opts] platform 은 HTML 판정 방식을 고른다(기본 process.platform — 테스트가 주입).
 * @returns {{formats:number, fileCopy:boolean, keep:{text?:string, html?:string, rtf?:string, image?:object}}}
 *   formats 는 개수(로그용). fileCopy 면 keep 은 비어 있다(내용을 읽지 않는다).
 */
export function snapshotClipboard(clipboard, { platform = process.platform } = {}) {
  let list
  try { list = clipboard.availableFormats() } catch (_e) {
    // 형식을 못 읽으면 파일 복사인지 판정할 수 없다 — 쓰지 않는 쪽으로(fail-closed).
    return { formats: 0, fileCopy: true, keep: {} }
  }
  const fmts = Array.isArray(list) ? list : []
  if (fmts.includes(FILE_COPY_FORMAT)) return { formats: fmts.length, fileCopy: true, keep: {} }
  const keep = {}
  const read = (fn) => { try { return fn() } catch (_e) { return null } }
  const t = read(() => clipboard.readText())
  if (t) keep.text = t
  // HTML 은 진짜로 있을 때만 보관한다. macOS(Chromium)는 HTML 을 두 겹으로 지어낸다 — availableFormats() 는 public.rtf 만 있어도
  //   text/html 을 올리고, readHTML() 은 HTML 이 없으면 RTF 변환본·plain 문자열로 채운다(실기 G1: plain 복사·TextEdit 복사 둘 다
  //   복원 뒤 없던 public.html 이 생겼다). 그래서 macOS 는 원시 public.html 바이트(readBuffer — 폴백 없음)로, 그 밖은 형식 목록으로 판정한다.
  const rawHtml = platform === 'darwin' ? read(() => clipboard.readBuffer('public.html')) : null
  const htmlPresent = platform === 'darwin' ? !!(rawHtml && rawHtml.length > 0) : fmts.includes('text/html')
  const h = htmlPresent ? read(() => clipboard.readHTML()) : null
  if (h) keep.html = h
  const r = read(() => clipboard.readRTF())
  if (r) keep.rtf = r
  const img = read(() => clipboard.readImage())
  if (img && !img.isEmpty()) keep.image = img
  return { formats: fmts.length, fileCopy: false, keep }
}

/** 업로드 이미지를 클립보드에 — writeImage 1회. 반환: 서명과 쓴 뒤의 형식 목록(복원 때 "아직 우리 것인가"를 본다). */
export function writeUploadImage(clipboard, img) {
  clipboard.writeImage(img)
  return { sig: imageSig(clipboard.readImage()), fmts: clipboard.availableFormats() }
}

/**
 * 조건부 복원. 반환 {restored:true} | {restored:false, reason:'changed-by-user'|'restore-threw'}. 절대 throw 하지 않는다.
 * @param {{keep:object}} saved snapshotClipboard 결과
 * @param {{sig:string, fmts:string[]}} written writeUploadImage 결과
 */
export function restoreClipboard(clipboard, saved, written) {
  try {
    const nowFmts = clipboard.availableFormats()
    const nowSig = imageSig(clipboard.readImage())
    if (!written || !Array.isArray(nowFmts) || !sameList(nowFmts, written.fmts || []) || nowSig !== written.sig) {
      console.warn('[Flow Upload] clipboard changed during upload — not restored')
      return { restored: false, reason: 'changed-by-user' }
    }
    const keep = (saved && saved.keep) || {}
    clipboard.clear()
    if (Object.keys(keep).length > 0) clipboard.write({ ...keep })
    console.log('[Flow Upload] clipboard restored')
    return { restored: true }
  } catch (e) {
    // safe-log: e.name 은 예외 클래스 이름 — 클립보드 내용이 아니다
    console.warn(`[Flow Upload] clipboard restore failed — continuing reason=${(e && e.name) || 'Error'}`)
    return { restored: false, reason: 'restore-threw' }
  }
}
