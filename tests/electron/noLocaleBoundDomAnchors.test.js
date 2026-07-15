// @vitest-environment node
//
// 우리는 남의 UI(Google Flow)를 DOM 으로 조종한다. 그 UI 의 **문구는 사용자의 구글 계정 언어를
// 따라 번역된다** — URL 로도 ?hl= 로도 못 바꾼다(2026-07-14 실측). 그래서 번역되는 문구를 앵커로
// 쓰면, 그 코드는 "한국어 계정에서만 동작하는 코드"가 된다.
//
// 2026-07-14 에 이걸로 영어 사용자의 @멘션이 100% 실패하고 있었다. 옵션 라벨을 통짜 textContent 로
// 읽어 '캐릭터' 와 비교했기 때문이다(en: "Zed2Character"). 같은 병이 에이전트 토글·설정 패널·결과
// 이미지 판별까지 최소 6곳에 퍼져 있었고, 아무도 몰랐다 — 우리 계정이 전부 한국어였으니까.
//
// 이 테스트가 그 병의 재발을 막는다. 규칙:
//   주입되는 DOM 코드에서 **번역되는 문구를 매칭에 쓰지 않는다.**
//   대신 번역되지 않는 것에 앵커한다:
//     - Material 아이콘 리거처 (accessibility_new, arrow_back, crop_16_9 …)
//     - ARIA role/state (role="tab", aria-pressed, aria-selected, data-state)
//     - DOM 구조 (leaf 위치, 링크 형태 /project/<id>/edit/<id>)
//     - 사용자가 지은 문자열 (img alt="캐릭터이름")
//
// 부득이 문구를 써야 하면(2차 폴백 등) BASELINE 에 이유와 함께 등록한다. BASELINE 은 **부채 목록**
// 이지 면허가 아니다 — 새 항목이 늘면 이 테스트가 막고, 고쳐서 사라지면 등록을 지워야 통과한다.
import { describe, it, expect } from 'vitest'
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = fileURLToPath(new URL('../../electron', import.meta.url))

/**
 * 우리 앱 자신의 한국어는 이 규칙과 무관하다 — 문제는 **Flow(남의 UI)의 번역되는 문구**를 앵커로
 * 쓰는 것뿐이다. LLM 프롬프트, 우리 메뉴 라벨, 우리 에러 메시지는 스캔하지 않는다.
 */
const SKIP_DIRS = ['/story/', '/agent/']
const SKIP_FILES = ['menuLabels.js', 'api-docs.js', 'video-model-rules.js']

/** 번역되는 UI 문구가 DOM 매칭의 **인자로** 들어간 형태만 잡는다(진단 메시지·프롬프트는 제외). */
const T = '[ㄱ-힝぀-ヿ一-鿿؀-ۿЀ-ӿ]'
const LOCALE_ANCHOR = new RegExp(
  [
    `(?:includes|indexOf|startsWith|endsWith|test)\\(\\s*['"\`][^'"\`]*${T}`, // .includes('캐릭터')
    `===?\\s*['"\`][^'"\`]*${T}`,                                              // t === '저장'
    `/[^/\\n]*${T}[^/\\n]*/[gimsuy]*\\.test`,                                  // /캐릭터|character/i.test(…)
    `test\\(\\s*/[^/\\n]*${T}`,                                                // .test(/…캐릭터…/)
  ].join('|'),
)

/**
 * 알려진 부채 — 각 항목은 "왜 아직 문구에 묶여 있는가"를 설명해야 한다.
 * 고쳤으면 여기서 지운다(지우지 않으면 stale 로 실패한다).
 */
const BASELINE = new Map([
  ['flow-mention-dom.js', '캐릭터 탭의 2차 폴백. 1차 앵커는 accessibility_new 리거처이고, 폴백은 리거처가 개명될 때만 쓰인다.'],
  ['flow-agent-toggle.js', '에이전트 채팅 close 버튼의 다중 후보 판별(새로운 세션/기록). 이 화면의 DOM 을 아직 한 번도 관측하지 못해 구조 앵커를 만들 수 없다 — 덤프 확보 후 제거할 것.'],
  ['flow-settings-dumper.js', '진단 전용 도구(Cmd+Shift+?). 생성 경로가 의존하지 않는다. 그래도 로케일 종속이므로 영어 계정에서는 진단이 무용지물이다.'],
  ['character.js', 'A2 캐릭터 업로드 실행 버튼(만들기/실행). 캐릭터 페이지 DOM 미관측 — arrow_forward 폴백이 있으나 정확도가 떨어진다.'],
  ['flow-api.js', '프로젝트 진입 버튼(새 프로젝트/시작). 영어 키워드(new/start/enter)가 함께 있으나 일본어·아랍어는 못 잡는다.'],
  ['main.js', 'Flow 진입/새 프로젝트 버튼(flow로 만들기/새 프로젝트). 영어 키워드가 함께 있으나 일본어·아랍어는 못 잡는다. 프로젝트 홈 DOM 은 확보돼 있으니(New project 버튼) 구조 앵커로 옮길 수 있다.'],
])

function jsFiles(dir) {
  return readdirSync(dir).flatMap((f) => {
    const p = join(dir, f)
    if (statSync(p).isDirectory()) return SKIP_DIRS.some((d) => `${p}/`.includes(d)) ? [] : jsFiles(p)
    if (SKIP_FILES.includes(f)) return []
    return /\.jsx?$/.test(f) ? [p] : []
  })
}

/** 주석은 로케일에 묶이지 않는다 — 한국어로 주석을 쓰는 것은 이 규칙과 무관하다. */
function isComment(line) {
  const t = line.trim()
  return t.startsWith('//') || t.startsWith('*') || t.startsWith('/*')
}

describe('주입되는 DOM 앵커는 로케일에 묶이면 안 된다', () => {
  it('번역되는 UI 문구를 DOM 매칭에 쓰지 않는다 (BASELINE 외)', () => {
    const offenders = []

    for (const file of jsFiles(ROOT)) {
      const name = file.split('/').pop()
      const lines = readFileSync(file, 'utf8').split('\n')
      lines.forEach((line, i) => {
        if (isComment(line) || !LOCALE_ANCHOR.test(line)) return
        if (BASELINE.has(name)) return
        offenders.push(`${name}:${i + 1}  ${line.trim().slice(0, 100)}`)
      })
    }

    expect(
      offenders,
      `번역되는 문구를 DOM 앵커로 쓰고 있다. 아이콘 리거처·ARIA·구조·사용자 문자열에 앵커하라.\n` +
      `정말 불가피하면 BASELINE 에 이유와 함께 등록하라(부채로 남는다):\n${offenders.join('\n')}`,
    ).toEqual([])
  })

  it('BASELINE 은 stale 하면 안 된다 — 고친 항목은 목록에서 지운다', () => {
    const stillBound = new Set()

    for (const file of jsFiles(ROOT)) {
      const name = file.split('/').pop()
      const lines = readFileSync(file, 'utf8').split('\n')
      if (lines.some((l) => !isComment(l) && LOCALE_ANCHOR.test(l))) stillBound.add(name)
    }

    const stale = [...BASELINE.keys()].filter((f) => !stillBound.has(f))
    expect(stale, `이미 로케일 종속이 아닌데 BASELINE 에 남아 있다 — 지워라: ${stale.join(', ')}`).toEqual([])
  })
})
