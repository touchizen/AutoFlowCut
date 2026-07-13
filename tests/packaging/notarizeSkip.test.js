import { afterEach, describe, expect, test, vi } from 'vitest'

import notarize from '../../scripts/notarize.cjs'

// 공증은 **릴리스에선 절대 조용히 건너뛰면 안 된다** — 공증 안 된 앱은 사용자 맥에서 안 열린다.
// 그런데 CI(APPLE_ID 없음)에서 패키징 스파이크를 돌리려면 끌 수단이 필요하다.
// → **명시적 스위치(`SKIP_NOTARIZE=1`)로만 꺼진다.** 자격증명이 없다고 알아서 꺼지면
//   누군가 .env 를 빠뜨린 채 릴리스를 만들고도 초록을 본다 (fail-open). 그건 안 된다.

const ctx = (platform) => ({
  electronPlatformName: platform,
  appOutDir: '/tmp/nonexistent-appout',
  packager: { appInfo: { productFilename: 'AutoFlowCut' } },
})

afterEach(() => {
  delete process.env.SKIP_NOTARIZE
  vi.restoreAllMocks()
})

describe('notarize', () => {
  test('SKIP_NOTARIZE=1 이면 공증을 건너뛴다 (CI 용)', async () => {
    process.env.SKIP_NOTARIZE = '1'
    // 건너뛰면 @electron/notarize 를 import 조차 안 하므로 자격증명 없이도 그냥 끝난다.
    await expect(notarize(ctx('darwin'))).resolves.toBeUndefined()
  })

  test('darwin 이 아니면 건너뛴다', async () => {
    await expect(notarize(ctx('win32'))).resolves.toBeUndefined()
  })

  test('🔴 스위치가 없으면 자격증명이 없어도 **건너뛰지 않는다** (fail-open 금지)', async () => {
    // 자격증명 없이 진짜 공증을 시도하면 실패한다 — 그게 옳다.
    // 조용히 통과하면 공증 안 된 앱이 릴리스로 나간다.
    await expect(notarize(ctx('darwin'))).rejects.toThrow()
  })
})
