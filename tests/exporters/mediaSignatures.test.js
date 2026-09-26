// @vitest-environment node

import { describe, it, expect } from 'vitest'
import { rawMediaExtension, isRawBase64Media } from '../../src/exporters/mediaSignatures'
import { isFilePath } from '../../src/exporters/prepareCloudRequest'

describe('mediaSignatures', () => {
  it('detects WebM raw base64 and keeps MP4 detection', () => {
    expect(rawMediaExtension('GkXfo0FBQUFB')).toBe('webm')
    expect(isRawBase64Media('GkXfo0FBQUFB')).toBe(true)
    expect(rawMediaExtension('AAAAGGZ0eXA')).toBe('mp4')
  })

  it('maps raw base64 signatures to extensions (incl. data: prefix)', () => {
    expect(rawMediaExtension('/9j/4AAQ')).toBe('jpg')
    expect(rawMediaExtension('iVBORw0KG')).toBe('png')
    expect(rawMediaExtension('R0lGODlh')).toBe('gif')
    expect(rawMediaExtension('UklGRlYA')).toBe('webp')
    expect(rawMediaExtension('AAAAGGZ0eXA')).toBe('mp4')
    expect(rawMediaExtension('SUQzBAAA')).toBe('mp3')        // ID3
    expect(rawMediaExtension('//uQxAAA')).toBe('mp3')        // MPEG frame sync
    expect(rawMediaExtension('//sQxAAA')).toBe('mp3')        // round-2 일관성
    expect(rawMediaExtension('data:audio/mpeg;base64,//uQ')).toBe('mp3')
  })

  it('returns null for file paths and bare filenames', () => {
    expect(rawMediaExtension('/Users/me/clip.mp4')).toBeNull()
    expect(rawMediaExtension('media/scene_0.png')).toBeNull()
    expect(rawMediaExtension('scene.png')).toBeNull()
  })

  it('isRawBase64Media: true for data: and known sigs, false for paths', () => {
    expect(isRawBase64Media('data:image/png;base64,iVB')).toBe(true)
    expect(isRawBase64Media('//s123')).toBe(true)
    expect(isRawBase64Media('/Users/a/b.mp3')).toBe(false)
    expect(isRawBase64Media('clip.mp4')).toBe(false)
  })

  it('isFilePath and the signature detector agree (no drift) — raw mp3 //s is NOT a path', () => {
    // 회귀: getFilename 이 //s 를 mp3 로 보는데 isFilePath 가 //s 를 경로로 보던 drift.
    expect(isFilePath('//sQxRawMp3Payload')).toBe(false)
    expect(isFilePath('//uQxRawMp3Payload')).toBe(false)
    // 실제 파일 경로는 그대로 경로로 인식.
    expect(isFilePath('/Users/me/voice.mp3')).toBe(true)
    expect(isFilePath('media/scene_0.png')).toBe(true)
  })

  it('does NOT misclassify forward-slash UNC/network paths as raw mp3', () => {
    // '//server/share/...' 는 '//s' 시그니처와 겹치지만 경로다.
    expect(rawMediaExtension('//server/share/clip.png')).toBeNull()
    expect(rawMediaExtension('//unc-host/dir/audio.mp3')).toBeNull()
    expect(isRawBase64Media('//server/share/clip.png')).toBe(false)
    expect(isFilePath('//server/share/clip.png')).toBe(true)
    expect(isFilePath('\\\\server\\share\\clip.png')).toBe(true)
  })

  it('distinguishes raw RIFF WebP vs WAV by decoding the format tag', () => {
    const webp = Buffer.from('RIFF\x00\x00\x00\x00WEBPVP8 ').toString('base64')
    const wav = Buffer.from('RIFF\x00\x00\x00\x00WAVEfmt ').toString('base64')
    expect(rawMediaExtension(webp)).toBe('webp')
    expect(rawMediaExtension(wav)).toBe('wav')
    // tag 미확인(짧은) RIFF 는 기존 동작(webp) 유지.
    expect(rawMediaExtension('UklGRlYA')).toBe('webp')
  })
})
