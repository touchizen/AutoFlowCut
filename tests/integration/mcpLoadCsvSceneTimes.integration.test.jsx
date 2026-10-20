/**
 * MCP load_csv 씬 시각 통합 테스트 — 옛 형식 CSV(시각 열 없이 duration 만) → loadCSV → nestSceneGenerationColumns
 * → layoutSceneRowTimes → stripCSVTimeColumns (load_csv 의 update-scenes 와 같은 순서) → 앱 useScenes().setScenes (normalizeScene) 까지.
 *
 * 2026-10-20: 툰 배치 CSV(prompt,prompt_ko,scene_tag,shot_type,duration)를 load_csv 로 넣자 96씬이 전부 0~4초에
 *   겹쳤다 — MCP 가 시각 없는 행을 보냈고 normalizeScene 이 씬마다 startTime 0 을 넣었다. 가져오기 창(parseCSVToScenes)은
 *   duration 으로 이어 붙인다 → MCP 경로도 같아야 한다.
 */
import { describe, it, expect } from 'vitest'
import { renderHook, act } from '@testing-library/react'
import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { loadCSV, nestSceneGenerationColumns, layoutSceneRowTimes, stripCSVTimeColumns } from '../../mcp-server/lib/csv.js'
import { useScenes } from '../../src/hooks/useScenes'
import { parseCSVToScenes } from '../../src/utils/parsers'

const TOON_CSV = [
  'prompt,prompt_ko,scene_tag,shot_type,duration',
  '"Redraw panel 2",v2 흑백 만화 칸,frame_v2,scene,4.000',
  '"Redraw panel 4",v4 흑백 만화 칸,frame_v4,scene,4.000',
  '"Redraw panel 5",v5 흑백 만화 칸,frame_v5,scene,4.000',
].join('\n') + '\n'

describe('MCP load_csv → 앱 씬 시각 (통합)', () => {
  it('duration 만 있는 CSV 는 앱에서 0~4 · 4~8 · 8~12 로 펼쳐진다 — 가져오기 창과 같은 결과', () => {
    const dir = mkdtempSync(join(tmpdir(), 'afc-loadcsv-'))
    const csvPath = join(dir, 'scenes.csv')
    writeFileSync(csvPath, TOON_CSV, 'utf-8')

    const data = loadCSV(csvPath)
    const incoming = stripCSVTimeColumns(layoutSceneRowTimes(data.scenes.map((row) => nestSceneGenerationColumns(row, { warnings: [] }))))

    const { result } = renderHook(() => useScenes())
    act(() => { result.current.setScenes(incoming.map((s, i) => ({ ...s, id: `scene_${i + 1}`, status: 'pending' }))) })

    const times = result.current.scenes.map((s) => [s.startTime, s.endTime])
    expect(times).toEqual([[0, 4], [4, 8], [8, 12]])
    expect(times).toEqual(parseCSVToScenes(TOON_CSV).map((s) => [s.startTime, s.endTime]))
  })

  it('불러온 뒤 씬을 지우면 남은 씬이 앞으로 당겨진다 — 옛 시각(snake 칸)이 남아 되돌아가지 않는다', () => {
    const dir = mkdtempSync(join(tmpdir(), 'afc-loadcsv-'))
    const csvPath = join(dir, 'scenes.csv')
    writeFileSync(csvPath, TOON_CSV, 'utf-8')
    const data = loadCSV(csvPath)
    const incoming = stripCSVTimeColumns(layoutSceneRowTimes(data.scenes.map((row) => nestSceneGenerationColumns(row, { warnings: [] }))))

    const { result } = renderHook(() => useScenes())
    act(() => { result.current.setScenes(incoming.map((s, i) => ({ ...s, id: `scene_${i + 1}`, status: 'pending' }))) })
    act(() => { result.current.deleteScene('scene_1') })

    expect(result.current.scenes.map((s) => [s.startTime, s.endTime])).toEqual([[0, 4], [4, 8]])
  })
})
