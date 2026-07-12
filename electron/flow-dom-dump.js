/**
 * electron/flow-dom-dump.js
 *
 * 범용 진단: 현재 Flow 화면의 "인터랙티브 요소"를 통째로 긁는다.
 *
 * flow-settings-dumper 는 "에이전트 설정" 패널만 타겟이라 사이드바 nav / 카드 /
 * 입력창을 못 잡는다. 캐릭터·장면 페이지의 진입(사이드바·신규카드)·생성(에디터·
 * Format·제출)·편집(연필·이름·완료) 요소 셀렉터를 추측 없이 확보하려고, 화면에 보이는
 * a / button / [role] / input / textarea / [contenteditable] / [tabindex] 카드 후보를
 * 모든 속성 + 텍스트 + 아이콘과 함께 수집한다.
 *
 * scanInteractiveElements(doc) 는 순수 함수(jsdom 테스트)이며, FLOW_DOM_DUMP_PROBE 로
 * 페이지에 그대로 주입된다(Function.prototype.toString — 단일 소스). 화면을 바꿔가며
 * (목록 → 신규 → 편집) 호출하면 각 화면의 요소가 잡힌다.
 */

export function scanInteractiveElements(doc) {
  const SEL = [
    'a', 'button', 'select', 'input', 'textarea',
    '[role="button"]', '[role="tab"]', '[role="menuitem"]', '[role="option"]', '[role="combobox"]',
    '[contenteditable="true"]', '[tabindex]',
  ].join(', ')
  const out = []
  const seen = new Set()
  for (const el of doc.querySelectorAll(SEL)) {
    if (seen.has(el)) continue
    seen.add(el)
    const o = { tag: el.tagName.toLowerCase() }
    if (el.attributes) {
      for (const a of el.attributes) o[a.name] = a.value
    }
    o.role = el.getAttribute ? (el.getAttribute('role') || undefined) : undefined
    o.text = (el.textContent || '').trim().slice(0, 80)
    o.icons = Array.from(el.querySelectorAll('i, [class*="google-symbols"], [class*="material-symbols"], [class*="material-icons"]'))
      .map(i => (i.textContent || '').trim()).filter(Boolean)
    // 위치(rect) — 우측 패널(에이전트 챗) 닫기 버튼처럼 "화면 어느 쪽" 컨트롤인지 구분용.
    const r = el.getBoundingClientRect ? el.getBoundingClientRect() : null
    o.rect = r ? { x: Math.round(r.left), y: Math.round(r.top), w: Math.round(r.width), h: Math.round(r.height) } : null
    out.push(o)
  }
  return out
}

/**
 * Scan <img> elements (result-image collection diagnostics). The Agent-ON result
 * renders as <img> in the chat panel; we need its real src/alt/size to fix
 * scanGeneratedImages. hasName flags the media.getMediaUrlRedirect?name=<uuid> shape.
 */
export function scanImages(doc) {
  const out = []
  for (const im of doc.querySelectorAll('img')) {
    const src = im.currentSrc || im.src || ''
    const r = im.getBoundingClientRect ? im.getBoundingClientRect() : { width: 0, height: 0, left: 0, top: 0 }
    out.push({
      src: String(src).slice(0, 240),
      hasName: /[?&]name=([a-f0-9-]{36})/.test(src),
      alt: im.getAttribute ? im.getAttribute('alt') : null,
      naturalWidth: im.naturalWidth,
      naturalHeight: im.naturalHeight,
      rect: { x: Math.round(r.left), y: Math.round(r.top), w: Math.round(r.width), h: Math.round(r.height) },
      parentTestid: (im.parentElement && im.parentElement.getAttribute) ? im.parentElement.getAttribute('data-testid') : null,
    })
  }
  return out
}

/**
 * Scan <video> elements (result-video collection diagnostics). The Agent-ON
 * video result renders as <video> (not <img>), so scanImages misses it. We
 * capture src/currentSrc/poster + child <source> srcs + size to learn the real
 * markup before building scanGeneratedVideos. hasName flags the
 * media.getMediaUrlRedirect?name=<uuid> shape on any of those URLs.
 */
export function scanVideos(doc) {
  const out = []
  for (const v of doc.querySelectorAll('video')) {
    const src = v.currentSrc || v.src || ''
    const sources = Array.from(v.querySelectorAll('source'))
      .map(s => (s.getAttribute ? s.getAttribute('src') : '') || '')
      .filter(Boolean)
    const poster = v.getAttribute ? v.getAttribute('poster') : null
    const r = v.getBoundingClientRect ? v.getBoundingClientRect() : { width: 0, height: 0, left: 0, top: 0 }
    const nameRe = /[?&]name=([a-f0-9-]{36})/
    const hasName = nameRe.test(src) || sources.some(s => nameRe.test(s)) || (poster ? nameRe.test(poster) : false)
    out.push({
      src: String(src).slice(0, 240),
      currentSrc: String(v.currentSrc || '').slice(0, 240),
      sources: sources.map(s => String(s).slice(0, 240)),
      poster: poster ? String(poster).slice(0, 240) : null,
      hasName,
      videoWidth: v.videoWidth,
      videoHeight: v.videoHeight,
      rect: { x: Math.round(r.left), y: Math.round(r.top), w: Math.round(r.width), h: Math.round(r.height) },
      parentTestid: (v.parentElement && v.parentElement.getAttribute) ? v.parentElement.getAttribute('data-testid') : null,
    })
  }
  return out
}

/** Timestamped dump filename: flow-dom-dump-YYYYMMDD-HHmmss.json (local time). */
export function buildDomDumpFilename(d = new Date()) {
  return `flow-dom-dump-${stampOf(d)}.json`
}

/** Timestamped agent-toggle diagnostic filename (written automatically on not_found). */
export function buildAgentDiagFilename(d = new Date()) {
  return `flow-agent-diag-${stampOf(d)}.json`
}

function stampOf(d) {
  const p = (n) => String(n).padStart(2, '0')
  return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`
}

/** Page-context expression: scans the live document + a trimmed body HTML snapshot. */
export const FLOW_DOM_DUMP_PROBE = `(function(){
  const scan = ${scanInteractiveElements.toString()};
  const scanImg = ${scanImages.toString()};
  const scanVid = ${scanVideos.toString()};
  return {
    url: location.href,
    title: document.title,
    elements: scan(document),
    images: scanImg(document),
    videos: scanVid(document),
    bodyHtml: (document.body ? document.body.outerHTML.slice(0, 40000) : ''),
  };
})()`
