// @vitest-environment node
//
// 🔴 **승인 창은 앱의 어떤 것에도 가려지면 안 된다.**
//    실앱 실측: `z-index: 9999` 였는데 앱에는 10001(SceneDetailModal) / 10002(SceneList) /
//    10003(App, TagInputAutocomplete) / 99999(Toast) 가 있었다. 승인 창이 **거의 제일 아래**에
//    깔려서 씬 이미지 패널에 잘려 보였다.
//
//    가려진 승인 창은 게이트의 결함이다 — 사람이 **무엇을 승인하는지 못 보고** 누르게 된다.
//    (commit c18ff32 가 인자를 보여주려고 한 이유가 통째로 무너진다.)
//
// 🔴 **숫자를 하드코딩해서 단언하지 않는다.** 그건 shape 이고, 누가 더 높은 값을 새로 넣으면
//    조용히 다시 깨진다. 대신 **불변식**을 잰다: 승인 창의 z-index 는 앱의 모든 z-index 중 최대다.
import { describe, expect, it } from 'vitest'
import { readFileSync, readdirSync, statSync } from 'node:fs'
import path from 'node:path'

const SRC = path.join(process.cwd(), 'src')

function cssFiles(dir) {
  return readdirSync(dir).flatMap((entry) => {
    const full = path.join(dir, entry)
    if (statSync(full).isDirectory()) return cssFiles(full)
    return full.endsWith('.css') ? [full] : []
  })
}

/** 파일에 선언된 z-index 숫자들. `auto`/변수는 비교 대상이 아니다. */
function zIndexes(file) {
  const css = readFileSync(file, 'utf8')
  return [...css.matchAll(/z-index:\s*(\d+)/g)].map((match) => Number(match[1]))
}

describe('승인 창은 항상 최상단이다', () => {
  it('앱의 어떤 z-index 보다도 높다 — 가려진 승인은 눈 감고 누르는 것이다', () => {
    const files = cssFiles(SRC)
    const approvalCss = files.find((file) => file.endsWith(path.join('agent', 'ApprovalDialog.css')))
    expect(approvalCss, 'ApprovalDialog.css 를 못 찾았다').toBeTruthy()

    const approval = Math.max(...zIndexes(approvalCss))
    expect(Number.isFinite(approval), '승인 창에 z-index 가 없다').toBe(true)

    const others = files
      .filter((file) => file !== approvalCss)
      .flatMap((file) => zIndexes(file).map((value) => ({ file: path.relative(SRC, file), value })))
      .filter((entry) => entry.value >= approval)

    expect(
      others,
      `승인 창(z-index:${approval})보다 위에 있는 것들: ${JSON.stringify(others)}`,
    ).toHaveLength(0)
  })
})
