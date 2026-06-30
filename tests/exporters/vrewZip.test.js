// @vitest-environment node

import { describe, it, expect } from 'vitest'
import { packVrewProject } from '../../src/exporters/vrewZip'

function readStoredZipEntries(zipBytes) {
  const bytes = zipBytes instanceof Uint8Array ? zipBytes : new Uint8Array(zipBytes)
  const entries = new Map()
  let offset = 0
  while (offset + 30 <= bytes.length) {
    const sig = bytes[offset] | (bytes[offset + 1] << 8) | (bytes[offset + 2] << 16) | (bytes[offset + 3] << 24)
    if (sig !== 0x04034b50) break
    const method = bytes[offset + 8] | (bytes[offset + 9] << 8)
    const compressedSize = bytes[offset + 18] | (bytes[offset + 19] << 8) | (bytes[offset + 20] << 16) | (bytes[offset + 21] << 24)
    const nameLength = bytes[offset + 26] | (bytes[offset + 27] << 8)
    const extraLength = bytes[offset + 28] | (bytes[offset + 29] << 8)
    const nameStart = offset + 30
    const dataStart = nameStart + nameLength + extraLength
    const name = new TextDecoder().decode(bytes.slice(nameStart, nameStart + nameLength))
    expect(method).toBe(0)
    entries.set(name, bytes.slice(dataStart, dataStart + compressedSize))
    offset = dataStart + compressedSize
  }
  return entries
}

const projectJson = {
  files: [
    { mediaId: 'scene_0', path: 'media/scene_0.png', name: 'image.png' },
    { mediaId: 'audio_0', path: 'media/audio_0.mp3', name: 'voice.mp3' },
  ],
}

const mediaRefs = [
  { mediaId: 'scene_0', archivePath: 'media/scene_0.png', sourcePath: 'media/image.png', filename: 'image.png' },
  { mediaId: 'audio_0', archivePath: 'media/audio_0.mp3', sourcePath: 'media/voice.mp3', filename: 'voice.mp3' },
]

describe('packVrewProject', () => {
  it('writes root project.json and media entries at archivePath', async () => {
    const zip = await packVrewProject({
      projectJson,
      mediaRefs,
      media: {
        scene_0: new Uint8Array([1, 2, 3]),
        audio_0: new Uint8Array([4, 5]),
      },
    })

    const entries = readStoredZipEntries(zip)
    expect(entries.has('project.json')).toBe(true)
    expect(entries.has('media/scene_0.png')).toBe(true)
    expect(entries.has('media/audio_0.mp3')).toBe(true)
    expect([...entries.get('media/scene_0.png')]).toEqual([1, 2, 3])
    expect(JSON.parse(new TextDecoder().decode(entries.get('project.json'))).files.length).toBe(2)
  })

  it('resolves Vrew IN_MEMORY files by mediaId when project files omit path', async () => {
    const zip = await packVrewProject({
      projectJson: {
        files: [
          { mediaId: 'scene_0', name: 'image.png', fileLocation: 'IN_MEMORY' },
          { mediaId: 'audio_0', name: 'voice.mp3', fileLocation: 'IN_MEMORY' },
        ],
      },
      mediaRefs,
      media: {
        scene_0: new Uint8Array([1, 2, 3]),
        audio_0: new Uint8Array([4, 5]),
      },
    })

    const entries = readStoredZipEntries(zip)
    expect(entries.has('media/scene_0.png')).toBe(true)
    expect(entries.has('media/audio_0.mp3')).toBe(true)
    expect(JSON.parse(new TextDecoder().decode(entries.get('project.json'))).files[0]).not.toHaveProperty('path')
  })

  it('resolves Vrew LOCAL_TMP files by mediaId instead of local cache path', async () => {
    const zip = await packVrewProject({
      projectJson: {
        files: [
          {
            mediaId: 'video_0',
            name: 'video.mp4',
            fileLocation: 'LOCAL_TMP',
            path: '/tmp/vrew-asset_mp4_video_0/video_0.mp4',
          },
        ],
      },
      mediaRefs: [
        { mediaId: 'video_0', archivePath: 'media/video_0.mp4', sourcePath: 'media/video.mp4', filename: 'video.mp4' },
      ],
      media: {
        video_0: new Uint8Array([9, 8, 7]),
      },
    })

    const entries = readStoredZipEntries(zip)
    expect([...entries.get('media/video_0.mp4')]).toEqual([9, 8, 7])
  })

  it('rejects invalid archivePath values for pathless Vrew files', async () => {
    await expect(
      packVrewProject({
        projectJson: { files: [{ mediaId: 'scene_0', name: 'image.png', fileLocation: 'IN_MEMORY' }] },
        mediaRefs: [{ mediaId: 'scene_0', archivePath: 'project.json', sourcePath: 'media/image.png' }],
        media: { scene_0: new Uint8Array([1]) },
      })
    ).rejects.toThrow(/reserved archive path/)

    await expect(
      packVrewProject({
        projectJson: { files: [{ mediaId: 'scene_0', name: 'image.png', fileLocation: 'IN_MEMORY' }] },
        mediaRefs: [{ mediaId: 'scene_0', sourcePath: 'media/image.png' }],
        media: { scene_0: new Uint8Array([1]) },
      })
    ).rejects.toThrow(/archivePath is required/)

    await expect(
      packVrewProject({
        projectJson: { files: [{ mediaId: 'scene_0', name: 'image.png', fileLocation: 'IN_MEMORY' }] },
        mediaRefs: [{ mediaId: 'scene_0', archivePath: '/tmp/scene.png', sourcePath: 'media/image.png' }],
        media: { scene_0: new Uint8Array([1]) },
      })
    ).rejects.toThrow(/archivePath must be under media/)

    for (const archivePath of [
      'media/../project.json',
      'media/..\\project.json',
      'media//scene.png',
      'media/./scene.png',
      'media/',
      'media/scene\u0000.png',
    ]) {
      await expect(
        packVrewProject({
          projectJson: { files: [{ mediaId: 'scene_0', name: 'image.png', fileLocation: 'IN_MEMORY' }] },
          mediaRefs: [{ mediaId: 'scene_0', archivePath, sourcePath: 'media/image.png' }],
          media: { scene_0: new Uint8Array([1]) },
        })
      ).rejects.toThrow(/archivePath must be a normalized media path/)
    }
  })

  it('throws when projectJson references media without a mediaRef', async () => {
    await expect(
      packVrewProject({ projectJson, mediaRefs: mediaRefs.slice(0, 1), media: {} })
    ).rejects.toThrow(/Missing mediaRef.*media\/audio_0\.mp3/)
  })

  it('rejects duplicate project mediaId before writing duplicate ZIP entries', async () => {
    await expect(
      packVrewProject({
        projectJson: { files: [{ mediaId: 'dup', path: 'media/dup.png' }, { mediaId: 'dup', path: 'media/dup-copy.png' }] },
        mediaRefs: [
          { mediaId: 'dup', archivePath: 'media/dup.png', sourcePath: 'media/dup.png' },
          { mediaId: 'dup', archivePath: 'media/dup-copy.png', sourcePath: 'media/dup-copy.png' },
        ],
        media: { dup: new Uint8Array([1]) },
      })
    ).rejects.toThrow(/Duplicate project mediaId.*dup/)
  })

  it('rejects duplicate project archive paths before writing duplicate ZIP entries', async () => {
    await expect(
      packVrewProject({
        projectJson: { files: [{ mediaId: 'a', path: 'media/dup.png' }, { mediaId: 'b', path: 'media/dup.png' }] },
        mediaRefs: [{ mediaId: 'a', archivePath: 'media/dup.png', sourcePath: 'media/dup.png' }],
        media: { a: new Uint8Array([1]) },
      })
    ).rejects.toThrow(/Duplicate project media path.*media\/dup\.png/)
  })

  it('rejects duplicate media candidate keys and source paths', async () => {
    await expect(
      packVrewProject({
        projectJson,
        mediaRefs,
        media: [
          { mediaId: 'media/scene_0.png', bytes: new Uint8Array([1]) },
          { mediaId: 'media/scene_0.png', bytes: new Uint8Array([2]) },
          { mediaId: 'media/audio_0.mp3', bytes: new Uint8Array([3]) },
        ],
      })
    ).rejects.toThrow(/Duplicate media candidate key.*media\/scene_0\.png/)

    await expect(
      packVrewProject({
        projectJson,
        mediaRefs,
        media: [
          { archivePath: 'media/scene_0.png', sourcePath: 'media/shared.png', bytes: new Uint8Array([1]) },
          { archivePath: 'media/audio_0.mp3', sourcePath: 'media/shared.png', bytes: new Uint8Array([2]) },
        ],
      })
    ).rejects.toThrow(/Duplicate media candidate sourcePath.*media\/shared\.png/)
  })
})
