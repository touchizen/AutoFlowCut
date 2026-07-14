import fs from 'node:fs'
import path from 'node:path'
import { describe, expect, test } from 'vitest'

// 🔴 레거시 MCP HTTP 서버(`127.0.0.1:3210`)는 **인증이 없다.** 그리고 노출하는 엔드포인트가
//    `/api/start-scene-batch`, `/api/generate-scene`, `/api/export-*`, `DELETE /api/projects` —
//    즉 **에이전트 승인 게이트가 지키려는 바로 그 G/B 집합**이다.
//
//    유일한 방어막은 **브라우저가 못 닿게 하는 것**이다. 와일드카드 CORS 를 켜면
//    JSON POST 의 preflight 가 통과하고, **사용자가 방문한 아무 웹페이지나** 그 API 를 부를 수 있다
//    (크레딧 소모, 프로젝트 삭제). 실제로 `Access-Control-Allow-Origin: '*'` 였고,
//    바로 옆 주석은 "CORS: localhost만 허용" 이라고 **거짓말**을 하고 있었다.
//
//    mcp-server 는 Node 프로세스라 CORS 와 무관하다 — 끊어도 안 깨진다.
const mainJs = fs.readFileSync(path.resolve(__dirname, '..', '..', 'electron', 'main.js'), 'utf8')

describe('레거시 MCP HTTP 서버는 브라우저에서 못 닿는다', () => {
  test('🔴 와일드카드 CORS 를 열지 않는다 (열면 아무 웹사이트나 이 API 를 부른다)', () => {
    const offenders = mainJs.split('\n')
      .map((line, i) => ({ line, no: i + 1 }))
      .filter(({ line }) => /Access-Control-Allow-Origin/.test(line) && /['"]\*['"]/.test(line))

    expect(
      offenders.map((o) => `main.js:${o.no}`),
      '🔴 와일드카드 CORS 가 켜졌다 — 웹페이지가 사용자의 크레딧을 태우고 프로젝트를 지울 수 있다',
    ).toEqual([])
  })

  test('🔴 CORS 헤더 자체를 설정하지 않는다', () => {
    expect(/setHeader\(\s*['"]Access-Control-Allow/.test(mainJs)).toBe(false)
  })
})
