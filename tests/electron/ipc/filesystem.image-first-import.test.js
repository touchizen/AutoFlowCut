// @vitest-environment node

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { tmpdir } from 'os'
import path from 'path'
import fsPromises from 'fs/promises'
import {
  existsSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync,
  writeFileSync,
  mkdirSync,
  renameSync,
} from 'fs'

vi.mock('child_process', () => ({
  execFile: vi.fn((_cmd, _args, _opts, cb) => cb(new Error('no ffprobe'), '', '')),
}))

vi.mock('electron', () => ({
  app: { getPath: () => tmpdir() },
  dialog: { showOpenDialog: vi.fn() },
}))

const PNG = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg=='
const JPEG = 'data:image/jpeg;base64,/9j/4AAQSkZJRgABAQAAAQABAAD/2w=='
const UNKNOWN = `data:application/octet-stream;base64,${Buffer.from('not an image').toString('base64')}`

function makeIpcMain() {
  const handlers = new Map()
  return {
    handle: (name, fn) => handlers.set(name, fn),
    invoke: async (name, payload) => {
      const handler = handlers.get(name)
      if (!handler) throw new Error(`Handler ${name} not registered`)
      return await handler({}, payload)
    },
  }
}

function snapshotTree(root) {
  if (!existsSync(root)) return null
  const walk = (dir) => readdirSync(dir).sort().map((name) => {
    const fullPath = path.join(dir, name)
    if (statSync(fullPath).isDirectory()) return [name, walk(fullPath)]
    return [name, readFileSync(fullPath).toString('base64')]
  })
  return walk(root)
}

function quarantinedJournals(projectRoot) {
  if (!existsSync(projectRoot)) return []
  return readdirSync(projectRoot)
    .filter((name) => name.startsWith('.image-first-import-journal.corrupt-') && name.endsWith('.json'))
    .sort()
}

describe('image-first main-process filesystem transaction', () => {
  let tmpDir
  let ipc
  let filesystem

  beforeEach(async () => {
    tmpDir = mkdtempSync(path.join(tmpdir(), 'image-first-import-'))
    ipc = makeIpcMain()
    filesystem = await import('../../../electron/ipc/filesystem.js')
    filesystem.registerFilesystemIPC(ipc)
  })

  afterEach(() => {
    vi.restoreAllMocks()
    rmSync(tmpDir, { recursive: true, force: true })
  })

  describe('strict PNG helper and fs:save-resource guard', () => {
    it('accepts PNG magic only when MIME and extension detection also say PNG', () => {
      expect(filesystem.isStrictPngPayload).toBeTypeOf('function')
      expect(filesystem.isStrictPngPayload(PNG)).toBe(true)
    })

    it('rejects invalid PNG magic', () => {
      expect(filesystem.isStrictPngPayload).toBeTypeOf('function')
      expect(filesystem.isStrictPngPayload(JPEG)).toBe(false)
    })

    it('rejects unknown bytes even though detectMimeType falls back to PNG', () => {
      expect(filesystem.isStrictPngPayload).toBeTypeOf('function')
      expect(filesystem.isStrictPngPayload(UNKNOWN)).toBe(false)
    })

    it('rejects a PNG-declared data URL whose detected bytes are JPEG', () => {
      expect(filesystem.isStrictPngPayload).toBeTypeOf('function')
      expect(filesystem.isStrictPngPayload(`data:image/png;base64,${JPEG.split(',')[1]}`)).toBe(false)
    })

    it('rejects PNG magic when independent MIME/extension detection disagrees', () => {
      const mismatchedDetector = () => ({ mimeType: 'image/jpeg', ext: 'jpg' })
      expect(filesystem.isStrictPngPayload(PNG, mismatchedDetector)).toBe(false)
    })

    it('fs:save-resource rejects a non-PNG scene before mkdir/current/history writes', async () => {
      const projectRoot = path.join(tmpDir, 'P')
      mkdirSync(projectRoot, { recursive: true })
      writeFileSync(path.join(projectRoot, 'sentinel.txt'), 'keep')
      const before = snapshotTree(projectRoot)

      const result = await ipc.invoke('fs:save-resource', {
        workFolder: tmpDir,
        project: 'P',
        resourceType: 'scenes',
        name: 'scene_1',
        data: UNKNOWN,
      })

      expect(result).toEqual({ success: false, error: 'scene-image-not-png' })
      expect(snapshotTree(projectRoot)).toEqual(before)
    })

    it('fs:save-resource applies the same zero-write PNG guard to historyOnly scenes', async () => {
      const projectRoot = path.join(tmpDir, 'P')
      mkdirSync(path.join(projectRoot, 'scenes', 'history'), { recursive: true })
      writeFileSync(path.join(projectRoot, 'scenes', 'history', 'keep.png'), 'keep')
      const before = snapshotTree(projectRoot)

      const result = await ipc.invoke('fs:save-resource', {
        workFolder: tmpDir,
        project: 'P',
        resourceType: 'scenes',
        name: 'scene_1',
        data: JPEG,
        historyOnly: true,
      })

      expect(result).toEqual({ success: false, error: 'scene-image-not-png' })
      expect(snapshotTree(projectRoot)).toEqual(before)
    })

    it('fs:save-resource keeps non-scene resource behavior unchanged', async () => {
      const result = await ipc.invoke('fs:save-resource', {
        workFolder: tmpDir,
        project: 'P',
        resourceType: 'references',
        name: 'ref_1',
        data: JPEG,
      })

      expect(result.success).toBe(true)
      expect(result.filename).toBe('ref_1.jpg')
    })
  })

  describe('safe import path segment guard', () => {
    it.each([
      ['empty string', ''],
      ['dot', '.'],
      ['dot-dot', '..'],
      ['forward slash', 'a/b'],
      ['backslash', 'a\\b'],
      ['embedded NUL', 'a\0b'],
      ['non-string', null],
    ])('rejects %s', (_label, value) => {
      expect(filesystem.isSafeImportPathSegment).toBeTypeOf('function')
      expect(filesystem.isSafeImportPathSegment(value)).toBe(false)
    })

    it('accepts renderer-generated revision and scene IDs', () => {
      expect(filesystem.isSafeImportPathSegment).toBeTypeOf('function')
      expect(filesystem.isSafeImportPathSegment('revision-123')).toBe(true)
      expect(filesystem.isSafeImportPathSegment('scene_42')).toBe(true)
    })
  })

  describe('fs:stage-image-first-image', () => {
    const stage = (ipc, workFolder, data, overrides = {}) => ipc.invoke('fs:stage-image-first-image', {
      workFolder,
      project: 'P',
      fixedSceneRevision: 'revision-1',
      rendererSceneId: 'scene_1',
      data,
      ...overrides,
    })

    function seedUntouchedProject(root) {
      const projectRoot = path.join(root, 'P')
      mkdirSync(path.join(projectRoot, 'scenes', '.image-first-staging', 'existing-revision'), { recursive: true })
      mkdirSync(path.join(projectRoot, 'scenes', 'history'), { recursive: true })
      writeFileSync(path.join(projectRoot, 'project.json'), '{"fixedSceneRevision":"old"}')
      writeFileSync(path.join(projectRoot, 'story.json'), '{"fixedSceneRevision":"old"}')
      writeFileSync(path.join(projectRoot, 'scenes', 'scene_existing.png'), 'canonical')
      writeFileSync(path.join(projectRoot, 'scenes', 'history', 'keep.png'), 'history')
      writeFileSync(path.join(projectRoot, 'scenes', '.image-first-staging', 'existing-revision', 'keep.png'), 'staged')
      writeFileSync(path.join(projectRoot, '.image-first-import-journal.json'), 'journal')
      return projectRoot
    }

    it('writes an accepted PNG only to its revision staging directory', async () => {
      const result = await stage(ipc, tmpDir, PNG)
      const expectedPath = path.join(tmpDir, 'P', 'scenes', '.image-first-staging', 'revision-1', 'scene_1.png')

      expect(result).toEqual({ success: true, path: expectedPath })
      expect(readFileSync(expectedPath)).toEqual(Buffer.from(PNG.split(',')[1], 'base64'))
      expect(existsSync(path.join(tmpDir, 'P', 'project.json'))).toBe(false)
      expect(existsSync(path.join(tmpDir, 'P', 'scenes', 'scene_1.png'))).toBe(false)
      expect(existsSync(path.join(tmpDir, 'P', 'scenes', 'history'))).toBe(false)
      expect(existsSync(path.join(tmpDir, 'P', '.image-first-import-journal.json'))).toBe(false)
    })

    it('rejects invalid magic with scene-image-not-png and leaves the whole tree untouched', async () => {
      const projectRoot = seedUntouchedProject(tmpDir)
      const before = snapshotTree(projectRoot)

      expect(await stage(ipc, tmpDir, JPEG)).toEqual({ success: false, error: 'scene-image-not-png' })
      expect(snapshotTree(projectRoot)).toEqual(before)
    })

    it('rejects detectMimeType unknown fallback and leaves the whole tree untouched', async () => {
      const projectRoot = seedUntouchedProject(tmpDir)
      const before = snapshotTree(projectRoot)

      expect(await stage(ipc, tmpDir, UNKNOWN)).toEqual({ success: false, error: 'scene-image-not-png' })
      expect(snapshotTree(projectRoot)).toEqual(before)
    })

    it('rejects MIME/extension mismatch and leaves the whole tree untouched', async () => {
      const projectRoot = seedUntouchedProject(tmpDir)
      const before = snapshotTree(projectRoot)
      const pngDeclaredJpeg = `data:image/png;base64,${JPEG.split(',')[1]}`

      expect(await stage(ipc, tmpDir, pngDeclaredJpeg)).toEqual({ success: false, error: 'scene-image-not-png' })
      expect(snapshotTree(projectRoot)).toEqual(before)
    })

    it('rejects a traversal revision without writing outside the project', async () => {
      const stagingRoot = path.join(tmpDir, 'P', 'scenes', '.image-first-staging')
      const victimDir = path.join(tmpDir, 'REVISION_VICTIM')
      const traversalRevision = path.relative(stagingRoot, victimDir)
      mkdirSync(victimDir, { recursive: true })
      writeFileSync(path.join(victimDir, 'sentinel.txt'), 'keep')
      const before = snapshotTree(tmpDir)

      const result = await stage(ipc, tmpDir, PNG, { fixedSceneRevision: traversalRevision })

      expect(result).toEqual({ success: false, error: 'image-first-import-invalid' })
      expect(snapshotTree(tmpDir)).toEqual(before)
    })

    it('rejects a traversal rendererSceneId without writing outside the project', async () => {
      const stagingRevision = path.join(tmpDir, 'P', 'scenes', '.image-first-staging', 'revision-1')
      const victimBase = path.join(tmpDir, 'RENDERER_VICTIM')
      const victimFile = `${victimBase}.png`
      const traversalRendererId = path.relative(stagingRevision, victimBase)
      writeFileSync(victimFile, 'keep')
      const before = snapshotTree(tmpDir)

      const result = await stage(ipc, tmpDir, PNG, { rendererSceneId: traversalRendererId })

      expect(result).toEqual({ success: false, error: 'image-first-import-invalid' })
      expect(snapshotTree(tmpDir)).toEqual(before)
    })
  })

  describe('fs:abort-image-first-import', () => {
    const abort = (ipc, workFolder, fixedSceneRevision) => ipc.invoke('fs:abort-image-first-import', {
      workFolder,
      project: 'P',
      fixedSceneRevision,
    })

    it('deletes only the requested staging revision', async () => {
      const scenesRoot = path.join(tmpDir, 'P', 'scenes')
      const target = path.join(scenesRoot, '.image-first-staging', 'revision-1')
      const other = path.join(scenesRoot, '.image-first-staging', 'revision-2')
      mkdirSync(path.join(scenesRoot, 'history'), { recursive: true })
      mkdirSync(target, { recursive: true })
      mkdirSync(other, { recursive: true })
      writeFileSync(path.join(target, 'scene_1.png'), 'target')
      writeFileSync(path.join(other, 'scene_2.png'), 'other')
      writeFileSync(path.join(scenesRoot, 'scene_existing.png'), 'canonical')
      writeFileSync(path.join(scenesRoot, 'history', 'keep.png'), 'history')
      writeFileSync(path.join(tmpDir, 'P', 'project.json'), 'project')
      writeFileSync(path.join(tmpDir, 'P', 'story.json'), 'story')
      writeFileSync(path.join(tmpDir, 'P', '.image-first-import-journal.json'), 'different revision journal')

      expect(await abort(ipc, tmpDir, 'revision-1')).toEqual({ success: true })
      expect(existsSync(target)).toBe(false)
      expect(readFileSync(path.join(other, 'scene_2.png'), 'utf8')).toBe('other')
      expect(readFileSync(path.join(scenesRoot, 'scene_existing.png'), 'utf8')).toBe('canonical')
      expect(readFileSync(path.join(scenesRoot, 'history', 'keep.png'), 'utf8')).toBe('history')
      expect(readFileSync(path.join(tmpDir, 'P', 'project.json'), 'utf8')).toBe('project')
      expect(readFileSync(path.join(tmpDir, 'P', 'story.json'), 'utf8')).toBe('story')
      expect(readFileSync(path.join(tmpDir, 'P', '.image-first-import-journal.json'), 'utf8')).toBe('different revision journal')
    })

    it('is an idempotent success when no staging tree exists', async () => {
      expect(await abort(ipc, tmpDir, 'revision-1')).toEqual({ success: true })
      expect(existsSync(path.join(tmpDir, 'P'))).toBe(false)
    })

    it('is a no-op success for a wrong revision', async () => {
      const existing = path.join(tmpDir, 'P', 'scenes', '.image-first-staging', 'revision-1')
      mkdirSync(existing, { recursive: true })
      writeFileSync(path.join(existing, 'keep.png'), 'keep')
      const before = snapshotTree(path.join(tmpDir, 'P'))

      expect(await abort(ipc, tmpDir, 'revision-other')).toEqual({ success: true })
      expect(snapshotTree(path.join(tmpDir, 'P'))).toEqual(before)
    })

    it('treats a traversal revision as a no-op and never removes an outside sentinel directory', async () => {
      const stagingRoot = path.join(tmpDir, 'P', 'scenes', '.image-first-staging')
      const victimDir = path.join(tmpDir, 'ABORT_VICTIM')
      const traversalRevision = path.relative(stagingRoot, victimDir)
      mkdirSync(victimDir, { recursive: true })
      writeFileSync(path.join(victimDir, 'sentinel.txt'), 'keep')
      const before = snapshotTree(tmpDir)

      expect(await abort(ipc, tmpDir, traversalRevision)).toEqual({ success: true })
      expect(snapshotTree(tmpDir)).toEqual(before)
      expect(readFileSync(path.join(victimDir, 'sentinel.txt'), 'utf8')).toBe('keep')
    })

    it('removes all N staged images on a live cancel without committing project or canonical files', async () => {
      const projectRoot = path.join(tmpDir, 'P')
      mkdirSync(projectRoot, { recursive: true })
      writeFileSync(path.join(projectRoot, 'project.json'), '{"fixedSceneRevision":"old"}')
      await ipc.invoke('fs:stage-image-first-image', {
        workFolder: tmpDir, project: 'P', fixedSceneRevision: 'revision-1', rendererSceneId: 'scene_1', data: PNG,
      })
      await ipc.invoke('fs:stage-image-first-image', {
        workFolder: tmpDir, project: 'P', fixedSceneRevision: 'revision-1', rendererSceneId: 'scene_2', data: PNG,
      })

      expect(await abort(ipc, tmpDir, 'revision-1')).toEqual({ success: true })
      expect(existsSync(path.join(projectRoot, 'scenes', '.image-first-staging', 'revision-1'))).toBe(false)
      expect(existsSync(path.join(projectRoot, 'scenes', 'scene_1.png'))).toBe(false)
      expect(existsSync(path.join(projectRoot, 'scenes', 'scene_2.png'))).toBe(false)
      expect(existsSync(path.join(projectRoot, 'scenes', 'history'))).toBe(false)
      expect(readFileSync(path.join(projectRoot, 'project.json'), 'utf8')).toBe('{"fixedSceneRevision":"old"}')
    })
  })

  describe('fs:commit-image-first-import', () => {
    const fixedScenes = [
      { storyId: 'story-1', rendererSceneId: 'scene_1', ordinal: 1 },
      { storyId: 'story-2', rendererSceneId: 'scene_2', ordinal: 2 },
    ]

    const projectData = (overrides = {}) => ({
      schemaVersion: 2,
      settings: { aspectRatio: '16:9', defaultDuration: 5 },
      references: [{ id: 'ref-keep' }],
      videoScenes: [],
      framePairs: [],
      srtTrack: [],
      scenes: [{ id: 'renderer-must-not-trust', prompt: 'must disappear' }],
      sceneMode: 'image-first',
      imageFirstVariant: 'storyboard',
      fixedSceneRevision: 'revision-1',
      fixedScenes,
      ...overrides,
    })

    async function stageBoth(ipc, workFolder) {
      for (const slot of fixedScenes) {
        const result = await ipc.invoke('fs:stage-image-first-image', {
          workFolder,
          project: 'P',
          fixedSceneRevision: 'revision-1',
          rendererSceneId: slot.rendererSceneId,
          data: PNG,
        })
        expect(result.success).toBe(true)
      }
    }

    it('commits ordered prompt-absent scenes, canonical PNGs, and the full project payload without history', async () => {
      const projectRoot = path.join(tmpDir, 'P')
      mkdirSync(projectRoot, { recursive: true })
      writeFileSync(path.join(projectRoot, 'project.json'), JSON.stringify({ fixedSceneRevision: 'old', keep: 'old' }))
      await stageBoth(ipc, tmpDir)

      const result = await ipc.invoke('fs:commit-image-first-import', {
        workFolder: tmpDir,
        project: 'P',
        data: projectData(),
      })

      const expectedScenes = fixedScenes.map((slot) => ({
        id: slot.rendererSceneId,
        storyId: slot.storyId,
        status: 'done',
        image: null,
        imagePath: path.join(projectRoot, 'scenes', `${slot.rendererSceneId}.png`),
      }))
      const fixedSceneState = {
        sceneMode: 'image-first',
        imageFirstVariant: 'storyboard',
        fixedSceneRevision: 'revision-1',
        fixedScenes,
      }
      expect(result).toEqual({ success: true, scenes: expectedScenes, fixedSceneState })
      expect(result.scenes.every((scene) => !Object.hasOwn(scene, 'prompt'))).toBe(true)

      const durable = JSON.parse(readFileSync(path.join(projectRoot, 'project.json'), 'utf8'))
      expect(durable).toMatchObject({
        schemaVersion: 2,
        settings: { aspectRatio: '16:9', defaultDuration: 5 },
        references: [{ id: 'ref-keep' }],
        ...fixedSceneState,
      })
      expect(durable.scenes).toEqual(expectedScenes)
      expect(durable.scenes.every((scene) => !Object.hasOwn(scene, 'prompt'))).toBe(true)
      expect(fixedScenes.map((slot) => readFileSync(path.join(projectRoot, 'scenes', `${slot.rendererSceneId}.png`))))
        .toEqual([Buffer.from(PNG.split(',')[1], 'base64'), Buffer.from(PNG.split(',')[1], 'base64')])
      expect(existsSync(path.join(projectRoot, 'scenes', '.image-first-staging', 'revision-1'))).toBe(false)
      expect(existsSync(path.join(projectRoot, 'scenes', 'history'))).toBe(false)
      expect(existsSync(path.join(projectRoot, '.image-first-import-journal.json'))).toBe(false)
      expect(readdirSync(projectRoot).some((name) => name.includes('.tmp'))).toBe(false)
    })

    it('rejects a pre-existing canonical path before journaling and never overwrites it', async () => {
      const projectRoot = path.join(tmpDir, 'P')
      const scenesRoot = path.join(projectRoot, 'scenes')
      mkdirSync(scenesRoot, { recursive: true })
      const oldProject = JSON.stringify({ fixedSceneRevision: 'old', scenes: [{ id: 'old' }] })
      writeFileSync(path.join(projectRoot, 'project.json'), oldProject)
      writeFileSync(path.join(scenesRoot, 'scene_1.png'), 'pre-existing canonical')
      await stageBoth(ipc, tmpDir)
      const before = snapshotTree(projectRoot)

      const result = await ipc.invoke('fs:commit-image-first-import', {
        workFolder: tmpDir,
        project: 'P',
        data: projectData(),
      })

      expect(result).toEqual({ success: false, error: 'scene-image-already-exists' })
      expect(readFileSync(path.join(scenesRoot, 'scene_1.png'), 'utf8')).toBe('pre-existing canonical')
      expect(readFileSync(path.join(projectRoot, 'project.json'), 'utf8')).toBe(oldProject)
      expect(existsSync(path.join(projectRoot, '.image-first-import-journal.json'))).toBe(false)
      expect(existsSync(path.join(scenesRoot, 'history'))).toBe(false)
      expect(existsSync(path.join(scenesRoot, '.image-first-staging', 'revision-1', 'scene_1.png'))).toBe(true)
      expect(snapshotTree(projectRoot)).toEqual(before)
    })

    it('rejects a traversal revision before touching an outside staged file or project data', async () => {
      const projectRoot = path.join(tmpDir, 'P')
      const stagingRoot = path.join(projectRoot, 'scenes', '.image-first-staging')
      const victimDir = path.join(tmpDir, 'COMMIT_REVISION_VICTIM')
      const traversalRevision = path.relative(stagingRoot, victimDir)
      const oldProject = JSON.stringify({ fixedSceneRevision: 'old', scenes: [{ id: 'old' }] })
      mkdirSync(victimDir, { recursive: true })
      mkdirSync(projectRoot, { recursive: true })
      writeFileSync(path.join(projectRoot, 'project.json'), oldProject)
      writeFileSync(path.join(victimDir, 'scene_1.png'), Buffer.from(PNG.split(',')[1], 'base64'))
      const before = snapshotTree(tmpDir)

      const result = await ipc.invoke('fs:commit-image-first-import', {
        workFolder: tmpDir,
        project: 'P',
        data: projectData({
          fixedSceneRevision: traversalRevision,
          fixedScenes: [{ storyId: 'story-1', rendererSceneId: 'scene_1', ordinal: 1 }],
        }),
      })

      expect(result).toEqual({ success: false, error: 'image-first-import-invalid' })
      expect(snapshotTree(tmpDir)).toEqual(before)
      expect(readFileSync(path.join(projectRoot, 'project.json'), 'utf8')).toBe(oldProject)
    })

    it('rejects a traversal rendererSceneId before journal or project writes', async () => {
      const projectRoot = path.join(tmpDir, 'P')
      const stagingRevision = path.join(projectRoot, 'scenes', '.image-first-staging', 'revision-1')
      const traversalRendererId = path.relative(stagingRevision, path.join(tmpDir, 'COMMIT_RENDERER_VICTIM'))
      const oldProject = JSON.stringify({ fixedSceneRevision: 'old', scenes: [{ id: 'old' }] })
      mkdirSync(projectRoot, { recursive: true })
      writeFileSync(path.join(projectRoot, 'project.json'), oldProject)
      const before = snapshotTree(tmpDir)

      const result = await ipc.invoke('fs:commit-image-first-import', {
        workFolder: tmpDir,
        project: 'P',
        data: projectData({
          fixedScenes: [{ storyId: 'story-1', rendererSceneId: traversalRendererId, ordinal: 1 }],
        }),
      })

      expect(result).toEqual({ success: false, error: 'image-first-import-invalid' })
      expect(snapshotTree(tmpDir)).toEqual(before)
      expect(readFileSync(path.join(projectRoot, 'project.json'), 'utf8')).toBe(oldProject)
    })

    it('rejects a missing staged PNG before journal, canonical, or project writes', async () => {
      const projectRoot = path.join(tmpDir, 'P')
      const oldProject = JSON.stringify({ fixedSceneRevision: 'old', scenes: [{ id: 'old' }] })
      mkdirSync(projectRoot, { recursive: true })
      writeFileSync(path.join(projectRoot, 'project.json'), oldProject)
      const staged = await ipc.invoke('fs:stage-image-first-image', {
        workFolder: tmpDir,
        project: 'P',
        fixedSceneRevision: 'revision-1',
        rendererSceneId: 'scene_1',
        data: PNG,
      })
      expect(staged.success).toBe(true)
      const before = snapshotTree(projectRoot)

      const result = await ipc.invoke('fs:commit-image-first-import', {
        workFolder: tmpDir,
        project: 'P',
        data: projectData(),
      })

      expect(result).toEqual({ success: false, error: 'image-first-staging-missing' })
      expect(snapshotTree(projectRoot)).toEqual(before)
      expect(readFileSync(path.join(projectRoot, 'project.json'), 'utf8')).toBe(oldProject)
      expect(existsSync(path.join(projectRoot, '.image-first-import-journal.json'))).toBe(false)
      expect(existsSync(path.join(projectRoot, 'scenes', 'scene_1.png'))).toBe(false)
      expect(existsSync(path.join(projectRoot, 'scenes', 'scene_2.png'))).toBe(false)
    })

    it('removes canonical PNGs owned by the previous fixed set only after a successful replacement', async () => {
      const projectRoot = path.join(tmpDir, 'P')
      const scenesRoot = path.join(projectRoot, 'scenes')
      mkdirSync(scenesRoot, { recursive: true })
      const oldFixedScene = { storyId: 'old-story', rendererSceneId: 'old_scene_1', ordinal: 1 }
      writeFileSync(path.join(projectRoot, 'project.json'), JSON.stringify({
        sceneMode: 'image-first',
        imageFirstVariant: 'storyboard',
        fixedSceneRevision: 'old-revision',
        fixedScenes: [oldFixedScene],
        scenes: [{ id: oldFixedScene.rendererSceneId }],
      }))
      writeFileSync(path.join(scenesRoot, 'old_scene_1.png'), 'old fixed canonical')
      writeFileSync(path.join(scenesRoot, 'manual_keep.png'), 'manual canonical')
      await stageBoth(ipc, tmpDir)

      const result = await ipc.invoke('fs:commit-image-first-import', {
        workFolder: tmpDir,
        project: 'P',
        data: projectData(),
      })

      expect(result.success).toBe(true)
      expect(existsSync(path.join(scenesRoot, 'old_scene_1.png'))).toBe(false)
      expect(readFileSync(path.join(scenesRoot, 'manual_keep.png'), 'utf8')).toBe('manual canonical')
      expect(existsSync(path.join(scenesRoot, 'scene_1.png'))).toBe(true)
      expect(existsSync(path.join(scenesRoot, 'scene_2.png'))).toBe(true)
    })
  })

  describe('fs:load-project-data image-first recovery', () => {
    const slots = [
      { storyId: 'story-1', rendererSceneId: 'scene_1', ordinal: 1 },
      { storyId: 'story-2', rendererSceneId: 'scene_2', ordinal: 2 },
    ]
    const nextProject = () => ({
      schemaVersion: 2,
      settings: { aspectRatio: '16:9' },
      references: [],
      scenes: [],
      sceneMode: 'image-first',
      imageFirstVariant: 'storyboard',
      fixedSceneRevision: 'revision-1',
      fixedScenes: slots,
    })

    async function seedStagedTransaction() {
      const projectRoot = path.join(tmpDir, 'P')
      const scenesRoot = path.join(projectRoot, 'scenes')
      mkdirSync(scenesRoot, { recursive: true })
      const oldFixedScene = { storyId: 'old-story', rendererSceneId: 'old_scene_1', ordinal: 1 }
      const oldData = {
        sceneMode: 'image-first',
        imageFirstVariant: 'storyboard',
        fixedSceneRevision: 'old',
        fixedScenes: [oldFixedScene],
        scenes: [{ id: 'old_scene_1' }],
        keep: 'old',
      }
      writeFileSync(path.join(projectRoot, 'project.json'), JSON.stringify(oldData, null, 2))
      writeFileSync(path.join(scenesRoot, 'old_scene_1.png'), 'old fixed canonical')
      for (const slot of slots) {
        const staged = await ipc.invoke('fs:stage-image-first-image', {
          workFolder: tmpDir,
          project: 'P',
          fixedSceneRevision: 'revision-1',
          rendererSceneId: slot.rendererSceneId,
          data: PNG,
        })
        expect(staged.success).toBe(true)
      }
      return { projectRoot, oldData }
    }

    const crashCases = [
      {
        name: 'before the first staged PNG rename',
        after: false,
        match: (from) => from.includes(`${path.sep}.image-first-staging${path.sep}`),
        expectedRevision: 'old',
      },
      {
        name: 'after the first staged PNG rename',
        after: true,
        match: (from) => from.includes(`${path.sep}.image-first-staging${path.sep}`),
        expectedRevision: 'old',
      },
      {
        name: 'before the project temp rename',
        after: false,
        match: (from, to) => from.endsWith('.image-first-project.tmp') && to.endsWith('project.json'),
        expectedRevision: 'old',
      },
      {
        name: 'after the project temp rename',
        after: true,
        match: (from, to) => from.endsWith('.image-first-project.tmp') && to.endsWith('project.json'),
        expectedRevision: 'revision-1',
      },
    ]

    it.each(crashCases)('recovers to one consistent disk state after a crash $name', async ({ after, match, expectedRevision }) => {
      const { projectRoot, oldData } = await seedStagedTransaction()
      const realRename = fsPromises.rename.bind(fsPromises)
      let injected = false
      const renameSpy = vi.spyOn(fsPromises, 'rename').mockImplementation(async (from, to, ...args) => {
        if (!injected && match(String(from), String(to))) {
          injected = true
          if (after) await realRename(from, to, ...args)
          throw new Error('injected-crash')
        }
        return await realRename(from, to, ...args)
      })

      const commitResult = await ipc.invoke('fs:commit-image-first-import', {
        workFolder: tmpDir,
        project: 'P',
        data: nextProject(),
      })
      expect(injected).toBe(true)
      expect(commitResult).toEqual({ success: false, error: 'injected-crash' })
      expect(existsSync(path.join(projectRoot, '.image-first-import-journal.json'))).toBe(true)
      renameSpy.mockRestore()

      const loaded = await ipc.invoke('fs:load-project-data', { workFolder: tmpDir, project: 'P' })
      expect(loaded.success).toBe(true)
      expect(loaded.data.fixedSceneRevision).toBe(expectedRevision)
      expect(JSON.parse(readFileSync(path.join(projectRoot, 'project.json'), 'utf8')).fixedSceneRevision).toBe(expectedRevision)
      expect(existsSync(path.join(projectRoot, '.image-first-import-journal.json'))).toBe(false)
      expect(existsSync(path.join(projectRoot, '.image-first-import-journal.tmp'))).toBe(false)
      expect(existsSync(path.join(projectRoot, '.image-first-project.tmp'))).toBe(false)
      expect(existsSync(path.join(projectRoot, 'scenes', '.image-first-staging'))).toBe(false)
      expect(existsSync(path.join(projectRoot, 'scenes', 'history'))).toBe(false)
      expect(quarantinedJournals(projectRoot)).toEqual([])

      const canonicalPaths = slots.map((slot) => path.join(projectRoot, 'scenes', `${slot.rendererSceneId}.png`))
      if (expectedRevision === 'revision-1') {
        expect(canonicalPaths.every(existsSync)).toBe(true)
        expect(loaded.data.scenes.map((scene) => scene.id)).toEqual(['scene_1', 'scene_2'])
        expect(existsSync(path.join(projectRoot, 'scenes', 'old_scene_1.png'))).toBe(false)
      } else {
        expect(canonicalPaths.some(existsSync)).toBe(false)
        expect(loaded.data).toEqual(oldData)
        expect(readFileSync(path.join(projectRoot, 'scenes', 'old_scene_1.png'), 'utf8')).toBe('old fixed canonical')
      }
    })

    it('sweeps journal-less staging left by a crash during staging and leaves project/canonical data untouched', async () => {
      const { projectRoot, oldData } = await seedStagedTransaction()
      mkdirSync(path.join(projectRoot, 'scenes'), { recursive: true })
      writeFileSync(path.join(projectRoot, 'scenes', 'pre-existing.png'), 'keep canonical')

      const loaded = await ipc.invoke('fs:load-project-data', { workFolder: tmpDir, project: 'P' })

      expect(loaded).toEqual({ success: true, data: oldData, isNew: false })
      expect(existsSync(path.join(projectRoot, 'scenes', '.image-first-staging'))).toBe(false)
      expect(readFileSync(path.join(projectRoot, 'scenes', 'pre-existing.png'), 'utf8')).toBe('keep canonical')
      expect(JSON.parse(readFileSync(path.join(projectRoot, 'project.json'), 'utf8'))).toEqual(oldData)
    })

    it('reopen after a canonical collision sweeps only staging and preserves the canonical file it did not create', async () => {
      const { projectRoot, oldData } = await seedStagedTransaction()
      const canonical = path.join(projectRoot, 'scenes', 'scene_1.png')
      writeFileSync(canonical, 'pre-existing canonical')
      const commit = await ipc.invoke('fs:commit-image-first-import', {
        workFolder: tmpDir,
        project: 'P',
        data: nextProject(),
      })
      expect(commit).toEqual({ success: false, error: 'scene-image-already-exists' })

      const loaded = await ipc.invoke('fs:load-project-data', { workFolder: tmpDir, project: 'P' })

      expect(loaded).toEqual({ success: true, data: oldData, isNew: false })
      expect(readFileSync(canonical, 'utf8')).toBe('pre-existing canonical')
      expect(existsSync(path.join(projectRoot, 'scenes', '.image-first-staging'))).toBe(false)
    })

    it('quarantines a legacy absolute-path journal after the work folder moves and opens twice without changing project.json', async () => {
      const oldWorkFolder = path.join(tmpDir, 'old-work')
      const newWorkFolder = path.join(tmpDir, 'new-work')
      const oldProjectRoot = path.join(oldWorkFolder, 'P')
      const newProjectRoot = path.join(newWorkFolder, 'P')
      const revision = 'legacy-revision'
      const rendererSceneId = 'scene_legacy'
      const oldScenesRoot = path.join(oldProjectRoot, 'scenes')
      const oldStagingRevision = path.join(oldScenesRoot, '.image-first-staging', revision)
      const projectBytes = Buffer.from(JSON.stringify({ fixedSceneRevision: 'old', scenes: [{ id: 'old' }] }, null, 2))
      mkdirSync(oldStagingRevision, { recursive: true })
      writeFileSync(path.join(oldProjectRoot, 'project.json'), projectBytes)
      writeFileSync(path.join(oldStagingRevision, `${rendererSceneId}.png`), Buffer.from(PNG.split(',')[1], 'base64'))
      writeFileSync(path.join(oldProjectRoot, '.image-first-import-journal.json'), JSON.stringify({
        version: 1,
        fixedSceneRevision: revision,
        entries: [{
          rendererSceneId,
          stagedPath: path.join(oldStagingRevision, `${rendererSceneId}.png`),
          canonicalPath: path.join(oldScenesRoot, `${rendererSceneId}.png`),
        }],
        previousRendererSceneIds: [],
        stagingRevisionPath: oldStagingRevision,
        projectTempPath: path.join(oldProjectRoot, '.image-first-project.tmp'),
      }, null, 2))
      mkdirSync(newWorkFolder, { recursive: true })
      renameSync(oldProjectRoot, newProjectRoot)

      const first = await ipc.invoke('fs:load-project-data', { workFolder: newWorkFolder, project: 'P' })
      expect(first).toMatchObject({ success: true, isNew: false })
      expect(readFileSync(path.join(newProjectRoot, 'project.json'))).toEqual(projectBytes)
      expect(existsSync(path.join(newProjectRoot, '.image-first-import-journal.json'))).toBe(false)
      expect(quarantinedJournals(newProjectRoot)).toHaveLength(1)
      expect(existsSync(path.join(newProjectRoot, 'scenes', '.image-first-staging'))).toBe(false)

      const second = await ipc.invoke('fs:load-project-data', { workFolder: newWorkFolder, project: 'P' })
      expect(second).toEqual(first)
      expect(quarantinedJournals(newProjectRoot)).toHaveLength(1)
      expect(readFileSync(path.join(newProjectRoot, 'project.json'))).toEqual(projectBytes)
    })

    it('quarantines a truncated journal and opens twice without changing project.json', async () => {
      const projectRoot = path.join(tmpDir, 'P')
      const stagingRoot = path.join(projectRoot, 'scenes', '.image-first-staging', 'truncated-revision')
      const projectBytes = Buffer.from(JSON.stringify({ fixedSceneRevision: 'old', scenes: [{ id: 'old' }] }, null, 2))
      mkdirSync(stagingRoot, { recursive: true })
      writeFileSync(path.join(projectRoot, 'project.json'), projectBytes)
      writeFileSync(path.join(stagingRoot, 'scene_1.png'), 'staged')
      const garbageJournal = '{"version":2,"fixedSceneRevision":'
      writeFileSync(path.join(projectRoot, '.image-first-import-journal.json'), garbageJournal)

      const first = await ipc.invoke('fs:load-project-data', { workFolder: tmpDir, project: 'P' })
      expect(first).toMatchObject({ success: true, isNew: false })
      expect(readFileSync(path.join(projectRoot, 'project.json'))).toEqual(projectBytes)
      expect(existsSync(path.join(projectRoot, '.image-first-import-journal.json'))).toBe(false)
      expect(quarantinedJournals(projectRoot)).toHaveLength(1)
      expect(readFileSync(path.join(projectRoot, quarantinedJournals(projectRoot)[0]), 'utf8')).toBe(garbageJournal)
      expect(existsSync(path.join(projectRoot, 'scenes', '.image-first-staging'))).toBe(false)

      const second = await ipc.invoke('fs:load-project-data', { workFolder: tmpDir, project: 'P' })
      expect(second).toEqual(first)
      expect(quarantinedJournals(projectRoot)).toHaveLength(1)
      expect(readFileSync(path.join(projectRoot, 'project.json'))).toEqual(projectBytes)
    })

    it('quarantines an unusable journal before reading durable project.json', async () => {
      const projectRoot = path.join(tmpDir, 'P')
      const projectPath = path.join(projectRoot, 'project.json')
      const journalPath = path.join(projectRoot, '.image-first-import-journal.json')
      mkdirSync(projectRoot, { recursive: true })
      writeFileSync(projectPath, JSON.stringify({ fixedSceneRevision: 'old', scenes: [] }))
      writeFileSync(journalPath, 'garbage journal')
      const events = []
      const realReadFile = fsPromises.readFile.bind(fsPromises)
      const realRename = fsPromises.rename.bind(fsPromises)
      vi.spyOn(fsPromises, 'readFile').mockImplementation(async (filePath, ...args) => {
        if (String(filePath) === projectPath) events.push('project-read')
        return await realReadFile(filePath, ...args)
      })
      vi.spyOn(fsPromises, 'rename').mockImplementation(async (from, to, ...args) => {
        if (String(from) === journalPath && path.basename(String(to)).startsWith('.image-first-import-journal.corrupt-')) {
          events.push('quarantine')
        }
        return await realRename(from, to, ...args)
      })

      const loaded = await ipc.invoke('fs:load-project-data', { workFolder: tmpDir, project: 'P' })

      expect(loaded.success).toBe(true)
      expect(events).toContain('quarantine')
      expect(events.indexOf('quarantine')).toBeLessThan(events.indexOf('project-read'))
    })

    it('quarantines a valid journal when staged and canonical both exist, then opens twice', async () => {
      const projectRoot = path.join(tmpDir, 'P')
      const scenesRoot = path.join(projectRoot, 'scenes')
      const stagingRevision = path.join(scenesRoot, '.image-first-staging', 'revision-both')
      const projectData = { fixedSceneRevision: 'revision-both', scenes: [{ id: 'scene_both' }] }
      const projectBytes = Buffer.from(JSON.stringify(projectData, null, 2))
      mkdirSync(stagingRevision, { recursive: true })
      writeFileSync(path.join(projectRoot, 'project.json'), projectBytes)
      writeFileSync(path.join(stagingRevision, 'scene_both.png'), 'staged copy')
      writeFileSync(path.join(scenesRoot, 'scene_both.png'), 'canonical copy')
      writeFileSync(path.join(projectRoot, '.image-first-import-journal.json'), JSON.stringify({
        version: 2,
        fixedSceneRevision: 'revision-both',
        rendererSceneIds: ['scene_both'],
        previousRendererSceneIds: [],
      }, null, 2))

      const first = await ipc.invoke('fs:load-project-data', { workFolder: tmpDir, project: 'P' })
      expect(first).toEqual({ success: true, data: projectData, isNew: false })
      expect(readFileSync(path.join(projectRoot, 'project.json'))).toEqual(projectBytes)
      expect(readFileSync(path.join(scenesRoot, 'scene_both.png'), 'utf8')).toBe('canonical copy')
      expect(existsSync(path.join(projectRoot, '.image-first-import-journal.json'))).toBe(false)
      expect(quarantinedJournals(projectRoot)).toHaveLength(1)
      expect(existsSync(path.join(scenesRoot, '.image-first-staging'))).toBe(false)

      const second = await ipc.invoke('fs:load-project-data', { workFolder: tmpDir, project: 'P' })
      expect(second).toEqual(first)
      expect(quarantinedJournals(projectRoot)).toHaveLength(1)
    })

    it('quarantines a valid journal when staged and canonical are both missing, then opens twice', async () => {
      const projectRoot = path.join(tmpDir, 'P')
      const projectData = { fixedSceneRevision: 'revision-neither', scenes: [{ id: 'scene_neither' }] }
      const projectBytes = Buffer.from(JSON.stringify(projectData, null, 2))
      mkdirSync(projectRoot, { recursive: true })
      writeFileSync(path.join(projectRoot, 'project.json'), projectBytes)
      writeFileSync(path.join(projectRoot, '.image-first-import-journal.json'), JSON.stringify({
        version: 2,
        fixedSceneRevision: 'revision-neither',
        rendererSceneIds: ['scene_neither'],
        previousRendererSceneIds: [],
      }, null, 2))

      const first = await ipc.invoke('fs:load-project-data', { workFolder: tmpDir, project: 'P' })
      expect(first).toEqual({ success: true, data: projectData, isNew: false })
      expect(readFileSync(path.join(projectRoot, 'project.json'))).toEqual(projectBytes)
      expect(existsSync(path.join(projectRoot, '.image-first-import-journal.json'))).toBe(false)
      expect(quarantinedJournals(projectRoot)).toHaveLength(1)

      const second = await ipc.invoke('fs:load-project-data', { workFolder: tmpDir, project: 'P' })
      expect(second).toEqual(first)
      expect(quarantinedJournals(projectRoot)).toHaveLength(1)
    })

    it('writes a location-independent journal that recovers normally after moving the work folder', async () => {
      const oldWorkFolder = path.join(tmpDir, 'portable-old')
      const newWorkFolder = path.join(tmpDir, 'portable-new')
      const oldProjectRoot = path.join(oldWorkFolder, 'P')
      const newProjectRoot = path.join(newWorkFolder, 'P')
      const oldData = { fixedSceneRevision: 'old', scenes: [{ id: 'old' }], keep: 'portable' }
      const projectBytes = Buffer.from(JSON.stringify(oldData, null, 2))
      mkdirSync(oldProjectRoot, { recursive: true })
      writeFileSync(path.join(oldProjectRoot, 'project.json'), projectBytes)
      for (const slot of slots) {
        await ipc.invoke('fs:stage-image-first-image', {
          workFolder: oldWorkFolder,
          project: 'P',
          fixedSceneRevision: 'revision-1',
          rendererSceneId: slot.rendererSceneId,
          data: PNG,
        })
      }
      const realRename = fsPromises.rename.bind(fsPromises)
      let injected = false
      const renameSpy = vi.spyOn(fsPromises, 'rename').mockImplementation(async (from, to, ...args) => {
        if (!injected && String(from).includes(`${path.sep}.image-first-staging${path.sep}`)) {
          injected = true
          throw new Error('portable-crash')
        }
        return await realRename(from, to, ...args)
      })
      expect(await ipc.invoke('fs:commit-image-first-import', {
        workFolder: oldWorkFolder,
        project: 'P',
        data: nextProject(),
      })).toEqual({ success: false, error: 'portable-crash' })
      renameSpy.mockRestore()

      const journal = JSON.parse(readFileSync(path.join(oldProjectRoot, '.image-first-import-journal.json'), 'utf8'))
      expect(Object.keys(journal).sort()).toEqual([
        'fixedSceneRevision', 'previousRendererSceneIds', 'rendererSceneIds', 'version',
      ])
      expect(JSON.stringify(journal)).not.toContain(oldWorkFolder)
      mkdirSync(newWorkFolder, { recursive: true })
      renameSync(oldProjectRoot, newProjectRoot)

      const loaded = await ipc.invoke('fs:load-project-data', { workFolder: newWorkFolder, project: 'P' })
      expect(loaded).toEqual({ success: true, data: oldData, isNew: false })
      expect(readFileSync(path.join(newProjectRoot, 'project.json'))).toEqual(projectBytes)
      expect(existsSync(path.join(newProjectRoot, '.image-first-import-journal.json'))).toBe(false)
      expect(quarantinedJournals(newProjectRoot)).toEqual([])
      expect(existsSync(path.join(newProjectRoot, 'scenes', '.image-first-staging'))).toBe(false)
      expect(slots.some((slot) => existsSync(path.join(newProjectRoot, 'scenes', `${slot.rendererSceneId}.png`)))).toBe(false)
    })
  })

  describe('per-project writer serialization', () => {
    const oneSlotProject = () => ({
      schemaVersion: 2,
      scenes: [],
      references: [],
      sceneMode: 'image-first',
      imageFirstVariant: 'storyboard',
      fixedSceneRevision: 'revision-lock',
      fixedScenes: [{ storyId: 'story-lock', rendererSceneId: 'scene_lock', ordinal: 1 }],
    })

    async function stageOne() {
      const projectRoot = path.join(tmpDir, 'P')
      mkdirSync(projectRoot, { recursive: true })
      writeFileSync(path.join(projectRoot, 'project.json'), JSON.stringify({ fixedSceneRevision: 'old' }))
      const staged = await ipc.invoke('fs:stage-image-first-image', {
        workFolder: tmpDir,
        project: 'P',
        fixedSceneRevision: 'revision-lock',
        rendererSceneId: 'scene_lock',
        data: PNG,
      })
      expect(staged.success).toBe(true)
      return projectRoot
    }

    it('keeps abort queued behind an in-progress commit for the same project path', async () => {
      const projectRoot = await stageOne()
      const realRename = fsPromises.rename.bind(fsPromises)
      let releaseRename
      let enteredRename
      const release = new Promise((resolve) => { releaseRename = resolve })
      const entered = new Promise((resolve) => { enteredRename = resolve })
      vi.spyOn(fsPromises, 'rename').mockImplementation(async (from, to, ...args) => {
        if (String(from).includes(`${path.sep}.image-first-staging${path.sep}`)) {
          enteredRename()
          await release
        }
        return await realRename(from, to, ...args)
      })
      const stagingRevisionPath = path.join(projectRoot, 'scenes', '.image-first-staging', 'revision-lock')
      const realRm = fsPromises.rm.bind(fsPromises)
      let abortRmCalled = false
      vi.spyOn(fsPromises, 'rm').mockImplementation(async (target, ...args) => {
        if (String(target) === stagingRevisionPath) abortRmCalled = true
        return await realRm(target, ...args)
      })

      const commitPromise = ipc.invoke('fs:commit-image-first-import', {
        workFolder: tmpDir, project: 'P', data: oneSlotProject(),
      })
      await entered
      let abortSettled = false
      const abortPromise = ipc.invoke('fs:abort-image-first-import', {
        workFolder: tmpDir, project: 'P', fixedSceneRevision: 'revision-lock',
      }).then((result) => {
        abortSettled = true
        return result
      })
      expect(abortRmCalled).toBe(false)
      expect(abortSettled).toBe(false)

      releaseRename()
      expect(await commitPromise).toMatchObject({ success: true })
      expect(await abortPromise).toEqual({ success: true })
      expect(existsSync(path.join(projectRoot, 'scenes', 'scene_lock.png'))).toBe(true)
    })

    it('keeps abort queued behind an in-progress stage for the same project path', async () => {
      const projectRoot = path.join(tmpDir, 'P')
      const realWriteFile = fsPromises.writeFile.bind(fsPromises)
      let releaseWrite
      let enteredWrite
      const release = new Promise((resolve) => { releaseWrite = resolve })
      const entered = new Promise((resolve) => { enteredWrite = resolve })
      vi.spyOn(fsPromises, 'writeFile').mockImplementation(async (filePath, ...args) => {
        if (String(filePath).includes(`${path.sep}.image-first-staging${path.sep}`)) {
          enteredWrite()
          await release
        }
        return await realWriteFile(filePath, ...args)
      })

      const stagePromise = ipc.invoke('fs:stage-image-first-image', {
        workFolder: tmpDir,
        project: 'P',
        fixedSceneRevision: 'revision-lock',
        rendererSceneId: 'scene_lock',
        data: PNG,
      })
      await entered
      let abortSettled = false
      const abortPromise = ipc.invoke('fs:abort-image-first-import', {
        workFolder: tmpDir, project: 'P', fixedSceneRevision: 'revision-lock',
      }).then((result) => {
        abortSettled = true
        return result
      })
      await new Promise((resolve) => setTimeout(resolve, 0))
      expect(abortSettled).toBe(false)

      releaseWrite()
      expect(await stagePromise).toMatchObject({ success: true })
      expect(await abortPromise).toEqual({ success: true })
      expect(existsSync(path.join(projectRoot, 'scenes', '.image-first-staging', 'revision-lock'))).toBe(false)
    })

    it('serializes merge-project-data after commit so partial writers preserve fixed fields', async () => {
      const projectRoot = await stageOne()
      const realRename = fsPromises.rename.bind(fsPromises)
      let releaseRename
      let enteredRename
      const release = new Promise((resolve) => { releaseRename = resolve })
      const entered = new Promise((resolve) => { enteredRename = resolve })
      vi.spyOn(fsPromises, 'rename').mockImplementation(async (from, to, ...args) => {
        if (String(from).includes(`${path.sep}.image-first-staging${path.sep}`)) {
          enteredRename()
          await release
        }
        return await realRename(from, to, ...args)
      })

      const commitPromise = ipc.invoke('fs:commit-image-first-import', {
        workFolder: tmpDir, project: 'P', data: oneSlotProject(),
      })
      await entered
      let mergeSettled = false
      const mergePromise = ipc.invoke('fs:merge-project-data', {
        workFolder: tmpDir, project: 'P', patch: { flowProjectId: 'flow-kept' },
      }).then((result) => {
        mergeSettled = true
        return result
      })
      await new Promise((resolve) => setTimeout(resolve, 0))
      expect(mergeSettled).toBe(false)

      releaseRename()
      expect(await commitPromise).toMatchObject({ success: true })
      expect(await mergePromise).toEqual({ success: true })
      const durable = JSON.parse(readFileSync(path.join(projectRoot, 'project.json'), 'utf8'))
      expect(durable.flowProjectId).toBe('flow-kept')
      expect(durable.fixedSceneRevision).toBe('revision-lock')
      expect(durable.fixedScenes).toEqual(oneSlotProject().fixedScenes)
      expect(durable.scenes.map((scene) => scene.id)).toEqual(['scene_lock'])
    })

    it('preserves committed scenes and FixedSceneState when partial flow writers settle before and after commit', async () => {
      const projectRoot = await stageOne()

      expect(await ipc.invoke('fs:merge-project-data', {
        workFolder: tmpDir, project: 'P', patch: { flowProjectId: null },
      })).toEqual({ success: true })

      const commit = await ipc.invoke('fs:commit-image-first-import', {
        workFolder: tmpDir,
        project: 'P',
        data: { ...oneSlotProject(), flowProjectId: null },
      })
      expect(commit).toMatchObject({ success: true })
      const committedFixedBytes = JSON.stringify(commit.fixedSceneState)
      const committedSceneBytes = JSON.stringify(commit.scenes)

      expect(await ipc.invoke('fs:merge-project-data', {
        workFolder: tmpDir, project: 'P', patch: { flowProjectId: 'flow-after' },
      })).toEqual({ success: true })

      const durable = JSON.parse(readFileSync(path.join(projectRoot, 'project.json'), 'utf8'))
      expect(durable.flowProjectId).toBe('flow-after')
      expect(JSON.stringify({
        sceneMode: durable.sceneMode,
        imageFirstVariant: durable.imageFirstVariant,
        fixedSceneRevision: durable.fixedSceneRevision,
        fixedScenes: durable.fixedScenes,
      })).toBe(committedFixedBytes)
      expect(JSON.stringify(durable.scenes)).toBe(committedSceneBytes)
      expect(durable.fixedScenes).toHaveLength(1)
      expect(durable.fixedScenes.map((slot) => [slot.ordinal, slot.storyId, slot.rendererSceneId]))
        .toEqual([[1, 'story-lock', 'scene_lock']])
    })
  })
})
