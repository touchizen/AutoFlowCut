// @vitest-environment jsdom

import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import {
  buildAgentDefaultsScript,
  buildListModelsScript,
} from '../../electron/flow-agent-defaults.js'
import { ENGLISH_AGENT_SETTINGS } from '../fixtures/flow-live-dom-20260714.js'

let realSetTimeout

beforeEach(() => {
  document.body.innerHTML = ENGLISH_AGENT_SETTINGS
  Element.prototype.getBoundingClientRect = () => ({
    width: 100,
    height: 30,
    top: 0,
    left: 0,
    right: 100,
    bottom: 30,
    x: 0,
    y: 0,
  })
  realSetTimeout = window.setTimeout
  window.setTimeout = (callback) => {
    callback()
    return 0
  }
})

afterEach(() => {
  window.setTimeout = realSetTimeout
})

describe('Agent defaults page scripts — live English settings DOM', () => {
  it('finds the image section and structural save action without translated labels', async () => {
    const result = await window.eval(buildAgentDefaultsScript({
      image: { aspectRatio: '4:3' },
      save: true,
    }))

    expect(result).toMatchObject({
      ok: true,
      image: { aspect: 'clicked' },
      saved: 'clicked',
    })
  })

  it('lists the current image and video models without translated section labels', async () => {
    const result = await window.eval(buildListModelsScript())

    expect(result).toMatchObject({
      ok: true,
      image: { current: 'Nano Banana 2' },
      video: { current: 'Omni Flash' },
    })
  })
})
