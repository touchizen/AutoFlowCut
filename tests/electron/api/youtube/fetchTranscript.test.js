import { describe, it, expect, vi } from 'vitest'
import { readFileSync, writeFileSync, mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { fetchTranscript, buildYtDlpSubArgs } from '../../../../electron/api/youtube/fetchTranscript.js'

const FIXTURES = path.join(process.cwd(), 'tests', 'fixtures', 'youtube')
const manualSrv3 = readFileSync(path.join(FIXTURES, 'manual-en.srv3'), 'utf8')

describe('buildYtDlpSubArgs (yt-dlp 자막 인자 계약)', () => {
  it('사용자자막+자동자막, ko→en 우선, skip-download, srv3 포맷, 출력 템플릿', () => {
    const args = buildYtDlpSubArgs({ videoId: 'abc12345678', outDir: '/tmp/x', langs: ['ko', 'en'] })
    expect(args).toContain('--write-subs')
    expect(args).toContain('--write-auto-subs')
    expect(args).toContain('--skip-download')
    expect(args).toContain('--sub-langs')
    expect(args).toContain('ko,en')
    expect(args).toContain('--sub-format')
    expect(args).toContain('srv3/json3/vtt/best')
    expect(args.some((a) => a.includes('abc12345678'))).toBe(true)
    // watch URL
    expect(args.some((a) => a.includes('youtube.com/watch?v=abc12345678'))).toBe(true)
  })
})

describe('fetchTranscript (yt-dlp child_process 계약 + 파싱)', () => {
  function fakeRunWriting(fileName, content, { code = 0 } = {}) {
    return vi.fn(async (args) => {
      // -o 템플릿에서 outDir 추출해 파일 생성(yt-dlp가 하는 일 흉내)
      const oIdx = args.indexOf('-o')
      const tmpl = args[oIdx + 1]
      const outDir = path.dirname(tmpl)
      writeFileSync(path.join(outDir, fileName), content)
      return { stdout: `[info] Writing video subtitles to: ${path.join(outDir, fileName)}`, stderr: '', code }
    })
  }

  it('ko 수동 자막 취득 → srt/plainText, source=manual', async () => {
    const runYtDlp = fakeRunWriting('abc12345678.ko.srv3', manualSrv3)
    const res = await fetchTranscript('abc12345678', { runYtDlp, tmpBase: mkdtempSync(path.join(tmpdir(), 'yt-')) })
    expect(res.ok).toBe(true)
    expect(res.videoId).toBe('abc12345678')
    expect(res.lang).toBe('ko')
    expect(res.isAuto).toBe(false)
    expect(res.segments.length).toBe(6)
    expect(res.srt).toContain('00:00:01,200 --> 00:00:03,360')
    expect(res.plainText).toContain('All right')
  })

  it('자동생성(.ko.auto/asr) 파일도 인식 → isAuto=true', async () => {
    // yt-dlp auto-sub 파일명 규칙: <id>.<lang>.srv3 (auto도 동일 확장자, lang에 -orig 등 접미 가능)
    const runYtDlp = fakeRunWriting('abc12345678.en.srv3', manualSrv3)
    const res = await fetchTranscript('abc12345678', { runYtDlp, langs: ['ko', 'en'], tmpBase: mkdtempSync(path.join(tmpdir(), 'yt-')), autoLangs: ['en'] })
    expect(res.ok).toBe(true)
    expect(res.lang).toBe('en')
  })

  it('자막 파일이 안 생기면 no-transcript', async () => {
    const runYtDlp = vi.fn(async () => ({ stdout: '[info] There are no subtitles for the requested languages', stderr: '', code: 0 }))
    const res = await fetchTranscript('abc12345678', { runYtDlp, tmpBase: mkdtempSync(path.join(tmpdir(), 'yt-')) })
    expect(res.ok).toBe(false)
    expect(res.error).toBe('no-transcript')
  })

  it('yt-dlp 미설치 → binary-not-found', async () => {
    const runYtDlp = vi.fn(async () => { throw new Error('binary-not-found') })
    const res = await fetchTranscript('abc12345678', { runYtDlp, tmpBase: mkdtempSync(path.join(tmpdir(), 'yt-')) })
    expect(res.ok).toBe(false)
    expect(res.error).toBe('binary-not-found')
  })

  it('타임아웃 전파 → error:timeout', async () => {
    const runYtDlp = vi.fn(async () => { throw new Error('timeout') })
    const res = await fetchTranscript('abc12345678', { runYtDlp, tmpBase: mkdtempSync(path.join(tmpdir(), 'yt-')) })
    expect(res.ok).toBe(false)
    expect(res.error).toBe('timeout')
  })
})
