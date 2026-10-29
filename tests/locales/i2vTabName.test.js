// 2026-10-30: 프레임 → 영상 탭 이름은 'I2V'(사용자 "탭명을 F->V 에서 I2V로 수정해도 돼") — 탭과 안내 문구 어디에도 'F→V' 가 남지 않는다.
//   내부 탭 id('frame-to-video')·로케일 키(frameToVideo)는 그대로다.
import { describe, it, expect } from 'vitest'
import ko from '../../src/locales/ko.js'
import en from '../../src/locales/en.js'

const strings = (o, out = []) => { for (const v of Object.values(o || {})) { if (typeof v === 'string') out.push(v); else if (v && typeof v === 'object') strings(v, out) } return out }

describe.each([['ko', ko], ['en', en]])('%s — I2V 탭 이름', (_lang, loc) => {
  it("tabs.frameToVideo === 'I2V'", () => { expect(loc.tabs.frameToVideo).toBe('I2V') })
  it("어떤 문구에도 'F→V' 가 없다", () => { expect(strings(loc).filter((s) => s.includes('F→V'))).toEqual([]) })
})
