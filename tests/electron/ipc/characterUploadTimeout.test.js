// @vitest-environment node
//
// #R33: 캐릭터 entity 업로드(on-demand @멘션 등록) uploadImage 응답 대기 한도.
//   60s 는 큰 레퍼런스/혼잡 시 짧아 등록이 타임아웃 → registered=false →
//   flowNameSyncStatus='failed' 로 고착돼 @멘션 후보에서 빠졌다("Unresolved @mention: king").
//   완료 시간 확보를 위해 120s 로 늘렸다. (값 회귀 가드 — flowDownloadConfig.test.js 와 동일 패턴.)
import { describe, it, expect } from 'vitest'
import { CHARACTER_UPLOAD_TIMEOUT_MS } from '../../../electron/ipc/character.js'

describe('#R33: character entity upload timeout', () => {
  it('uploadImage 응답 대기는 2분(120000ms)', () => {
    expect(CHARACTER_UPLOAD_TIMEOUT_MS).toBe(120000)
  })
  it('기존 60s 보다 길어 등록 완료 시간을 확보한다', () => {
    expect(CHARACTER_UPLOAD_TIMEOUT_MS).toBeGreaterThan(60000)
  })
})
