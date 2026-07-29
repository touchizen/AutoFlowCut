/**
 * capcutCloud — 사이드카 SRT 핸드오프 seam
 *
 * 리뷰 라운드 1·2 가 같은 구멍을 두 번 짚었다: 훅 테스트는 exporter 에 넘어간
 * `project.srtTrack` 에서 끝나고, `generateSRT` 를 직접 부르는 테스트는 그 앞
 * 단계를 건너뛴다. 그 사이 구간(`exportCapcutPackageCloud` → `generateSRT` →
 * `writeSrtToWorkFolder`)이 raw 트랙이나 씬 폴백으로 새면 **모든 테스트가 초록인 채로**
 * 최종 `_subtitle_ko.srt` 만 다시 어긋난다.
 *
 * 여기서는 함수를 실제로 구동하고 IPC 가 받은 **파일 내용**을 단언한다.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('../../src/exporters/callExportFunction', () => ({
  callExportFunction: vi.fn(async () => ({
    draftInfo: JSON.stringify({ ok: true }),
    draftMetaInfo: JSON.stringify({ ok: true }),
  })),
}))

import { exportCapcutPackageCloud } from '../../src/exporters/capcutCloud'

const writeSrt = vi.fn(async ({ filename }) => ({ success: true, filePath: `/work/p/${filename}` }))

beforeEach(() => {
  vi.clearAllMocks()
  writeSrt.mockImplementation(async ({ filename }) => ({ success: true, filePath: `/work/p/${filename}` }))
  window.electronAPI = {
    getVolumePath: vi.fn(async () => ({ volumePath: '' })),
    writeSrtToWorkFolder: writeSrt,
    writeCapcutProject: vi.fn(async () => ({ success: true, targetPath: '/out' })),
  }
  localStorage.setItem('workFolderPath', '/work')
})

const koContent = () =>
  writeSrt.mock.calls.map(c => c[0]).find(a => a.filename.endsWith('_subtitle_ko.srt'))?.content

describe('capcutCloud — 사이드카는 rebase 된 project.srtTrack 을 쓴다', () => {
  it('rebased 와 raw 가 갈리는 프로젝트에서 rebased 시각이 파일로 나간다', async () => {
    // 재배열 프로젝트: rawSrtTrack 은 원본 절대 시각(100~105), srtTrack 은 rebase 결과(0~5).
    // capcutCloud 가 raw 를 넘기면 자막이 100 초에서 시작한다.
    const project = {
      name: 'p',
      scenes: [
        { id: 'scene_1', image_path: '/i1.png', image_size: { width: 8, height: 8 }, image_duration: 5 },
        { id: 'scene_2', image_path: '/i2.png', image_size: { width: 8, height: 8 }, image_duration: 5 },
      ],
      srtTrack: [
        { id: 'c1', startTime: 0, endTime: 5, text: 'C' },
        { id: 'a1', startTime: 5, endTime: 10, text: 'A' },
      ],
      rawSrtTrack: [
        { id: 'c1', startTime: 100, endTime: 105, text: 'C' },
        { id: 'a1', startTime: 0, endTime: 5, text: 'A' },
      ],
    }

    await exportCapcutPackageCloud(project, { capcutProjectNumber: '/draft/1', subtitleOption: 'ko' })

    const srt = koContent()
    expect(srt).toContain('00:00:00,000 --> 00:00:05,000')
    expect(srt).toContain('00:00:05,000 --> 00:00:10,000')
    expect(srt).not.toContain('00:01:40,000')
  })

  it('간격을 흡수한 슬롯 프로젝트의 EN 사이드카도 슬롯을 누적한다', async () => {
    // EN 은 항상 씬 폴백 경로다(srtTrack 은 ko 전용). 슬롯 [6, 4, 5] 를 누적해야
    // 자막이 원본 절대 시각(0–6 / 6–10 / 10–15)과 맞는다.
    const project = {
      name: 'p',
      scenes: [
        { id: 'scene_1', image_path: '/i1.png', image_size: { width: 8, height: 8 }, image_duration: 6, subtitle_en: 'A' },
        { id: 'scene_2', image_path: '/i2.png', image_size: { width: 8, height: 8 }, image_duration: 4, subtitle_en: 'B' },
        { id: 'scene_3', image_path: '/i3.png', image_size: { width: 8, height: 8 }, image_duration: 5, subtitle_en: 'C' },
      ],
    }

    await exportCapcutPackageCloud(project, { capcutProjectNumber: '/draft/1', subtitleOption: 'en' })

    const en = writeSrt.mock.calls.map(c => c[0]).find(a => a.filename.endsWith('_subtitle_en.srt'))?.content
    expect(en).toContain('00:00:00,000 --> 00:00:06,000')
    expect(en).toContain('00:00:06,000 --> 00:00:10,000')
    expect(en).toContain('00:00:10,000 --> 00:00:15,000')
  })
})
