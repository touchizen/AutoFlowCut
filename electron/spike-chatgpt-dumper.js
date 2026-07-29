// 페이지 주입 문자열(단일 eval): __autoflowcut_chatgpt_dump__ 를 idempotent 정의 + 즉시 호출.
// 현재 문서의 컴포저/전송버튼/이미지 후보를 tag+attrs+상태로 직렬화해 반환(+prefix 로그).
// Node/CDP API 미사용. 실제 셀렉터 확정은 사용자가 실앱에서 이 반환을 파일로 받아 저자에게 전달.
export const CHATGPT_DUMPER = /* js */ `
(() => {
  const P = '[autoflowcut CGPT DUMP]';
  if (!window.__autoflowcut_chatgpt_dump__) {
    window.__autoflowcut_chatgpt_dump__ = function () {
      const ser = (el) => {
        if (!el) return null;
        const attrs = {};
        for (const a of el.attributes || []) attrs[a.name] = a.value;
        return {
          tag: el.tagName ? el.tagName.toLowerCase() : null,
          attrs,
          text: (el.textContent || '').trim().slice(0, 80),
          disabled: el.disabled === true || el.getAttribute?.('aria-disabled') === 'true',
          role: el.getAttribute?.('role') || null,
        };
      };
      const pick = (sel, limit = 8) => Array.from(document.querySelectorAll(sel)).slice(0, limit).map(ser);
      const out = {
        url: location.href,
        ts: Date.now(),
        // 넓은 후보군 — 저자가 덤프에서 실제 셀렉터를 고른다.
        composer: pick('textarea, [contenteditable="true"], [data-testid*="prompt" i], .ProseMirror'),
        sendButtons: [
          ...Array.from(document.querySelectorAll('button[data-testid*="send" i], button[aria-label*="send" i], form button[type="submit"]')).map(ser),
          ...Array.from(document.querySelectorAll('button:has(svg)')).slice(0, 12).map(ser),
        ],
        images: pick('main img, [data-testid*="image" i] img, canvas, a[download] img', 16),
      };
      try { console.log(P, JSON.stringify(out).slice(0, 2000)); } catch (e) {}
      return out;
    };
  }
  return window.__autoflowcut_chatgpt_dump__();
})()
`;
