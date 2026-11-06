import { EventEmitter } from 'node:events'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

// Execute only the native shield factory, never Electron's main/app bootstrap.
const main = readFileSync(resolve('electron/main.js'), 'utf8')
const start = main.indexOf('function makeInputShield(')
const factory = main.slice(start, main.indexOf('\n}\n', start) + 2)
export function inputShieldHarness(flowView) {
  const surfaces = []
  class WebContentsView {
    constructor() {
      this.webContents = new EventEmitter()
      this.webContents.loadURL = async () => {}
      this.webContents.close = () => { this.closed = true }
    }
    setBounds(bounds) { this.bounds = { ...bounds } }
    setBackgroundColor() {}
  }
  const win = {
    getContentBounds: () => ({ x: 0, y: 0, width: 2400, height: 900 }),
    webContents: { focus() {}, send() {} },
    contentView: {
      addChildView: view => surfaces.push(view),
      removeChildView: view => surfaces.splice(surfaces.indexOf(view), 1),
    },
  }
  const create = Function('mainWindow', 'WebContentsView', 'modeController', 'shieldFocusTarget', `${factory}; return makeInputShield`)(win, WebContentsView, { getFlowView: () => flowView }, 'main')
  const covers = (x, y) => surfaces.some(({ bounds: b }) => b && x >= b.x && y >= b.y && x < b.x + b.width && y < b.y + b.height)
  return { win, create, surfaces, covers }
}
