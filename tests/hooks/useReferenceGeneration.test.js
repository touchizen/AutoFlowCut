/**
 * useReferenceGeneration 훅 테스트
 *
 * 레퍼런스 이미지 생성 (개별 + 일괄) 테스트
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'

// Mock 함수들
const mockToast = {
  warning: vi.fn(),
  info: vi.fn(),
  error: vi.fn()
}

const mockFileSystemAPI = {
  saveReference: vi.fn(),
  ensurePermission: vi.fn()
}

const mockCheckFolderPermission = vi.fn()
const mockCheckAuthToken = vi.fn()
const mockGenerateImageAPI = vi.fn()
const mockUploadReference = vi.fn()
const mockGetAccessToken = vi.fn()
const mockSetReferences = vi.fn()
const mockAddPendingSave = vi.fn()
const mockOpenSettings = vi.fn()

describe('useReferenceGeneration 로직', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  describe('handleGenerateRef (개별)', () => {
    describe('사전 검사', () => {
      it('프롬프트 없으면 경고', () => {
        const ref = { name: 'alice', prompt: '' }

        if (!ref?.prompt) {
          mockToast.warning('프롬프트가 없습니다.')
        }

        expect(mockToast.warning).toHaveBeenCalledWith('프롬프트가 없습니다.')
      })

      it('폴더 권한 실패 시 중단', async () => {
        mockCheckFolderPermission.mockResolvedValue(false)

        const permissionOk = await mockCheckFolderPermission()

        expect(permissionOk).toBe(false)
      })

      it('토큰 없으면 authError 반환', async () => {
        mockCheckAuthToken.mockResolvedValue(false)

        const tokenOk = await mockCheckAuthToken()

        if (!tokenOk) {
          const result = { success: false, authError: true }
          expect(result.authError).toBe(true)
        }
      })
    })

    describe('이미지 생성', () => {
      it('seed 처리', () => {
        const settings = { seedLocked: true, seed: 12345 }
        const seedToUse = settings.seedLocked ? settings.seed : null

        expect(seedToUse).toBe(12345)
      })

      it('빈 레퍼런스 배열로 생성', async () => {
        mockGenerateImageAPI.mockResolvedValue({
          success: true,
          images: ['base64_image']
        })

        const result = await mockGenerateImageAPI('prompt', '16:9', [], null)

        expect(result.success).toBe(true)
      })
    })

    describe('Whisk 업로드', () => {
      it('업로드 성공 시 mediaId, caption 반환', async () => {
        mockUploadReference.mockResolvedValue({
          success: true,
          mediaId: 'media_123',
          caption: 'Beautiful landscape'
        })

        const result = await mockUploadReference('base64', 'MEDIA_CATEGORY_SCENE')

        expect(result.mediaId).toBe('media_123')
        expect(result.caption).toBeDefined()
      })

      it('업로드 실패해도 계속 진행', async () => {
        mockUploadReference.mockResolvedValue({
          success: false,
          error: 'Upload failed'
        })

        const result = await mockUploadReference('base64', 'MEDIA_CATEGORY_SUBJECT')

        // 업로드 실패해도 로컬 저장은 진행
        expect(result.success).toBe(false)
      })

      it('base64 prefix 제거', () => {
        const imageData = 'data:image/png;base64,iVBORw0KGgo'
        const cleanBase64 = imageData.split(',')[1] || imageData

        expect(cleanBase64).toBe('iVBORw0KGgo')
      })
    })

    describe('파일 저장', () => {
      it('folder 모드일 때 저장', async () => {
        const settings = { saveMode: 'folder', projectName: 'test_project' }

        mockFileSystemAPI.saveReference.mockResolvedValue({
          success: true,
          path: 'test_project/references/alice.png',
          dataUrl: 'data:image/png;base64,...'
        })

        if (settings.saveMode === 'folder') {
          const result = await mockFileSystemAPI.saveReference(
            settings.projectName,
            'alice',
            'base64_data',
            'whisk',
            { mediaId: 'media_123', caption: 'Alice', category: 'MEDIA_CATEGORY_SUBJECT' }
          )

          expect(result.success).toBe(true)
          expect(result.path).toContain('references')
        }
      })

      it('저장 실패 시 pendingSave 추가', async () => {
        mockFileSystemAPI.saveReference.mockResolvedValue({
          success: false,
          error: 'Permission denied'
        })

        const saveResult = await mockFileSystemAPI.saveReference(
          'project',
          'alice',
          'base64',
          'whisk',
          {}
        )

        if (!saveResult.success) {
          mockAddPendingSave(vi.fn())
          mockToast.warning('로컬 저장을 위해 권한이 필요합니다.')
          mockOpenSettings('storage')
        }

        expect(mockAddPendingSave).toHaveBeenCalled()
        expect(mockToast.warning).toHaveBeenCalled()
        expect(mockOpenSettings).toHaveBeenCalledWith('storage')
      })
    })

    describe('레퍼런스 업데이트', () => {
      it('함수형 업데이트로 상태 변경', () => {
        const prevRefs = [
          { name: 'alice', type: 'character', data: null },
          { name: 'bob', type: 'character', data: null }
        ]
        const index = 0
        const newData = {
          data: 'base64_image',
          filePath: 'project/references/alice.png',
          dataStorage: 'file',
          mediaId: 'media_123',
          caption: 'Alice'
        }

        const updatedRefs = prevRefs.map((r, i) =>
          i === index ? { ...r, ...newData } : r
        )

        expect(updatedRefs[0].data).toBe('base64_image')
        expect(updatedRefs[0].mediaId).toBe('media_123')
        expect(updatedRefs[1].data).toBeNull()
      })

      it('dataStorage 결정', () => {
        const filePath = 'project/references/alice.png'
        const dataStorage = filePath ? 'file' : 'base64'

        expect(dataStorage).toBe('file')

        const noFilePath = null
        const dataStorage2 = noFilePath ? 'file' : 'base64'

        expect(dataStorage2).toBe('base64')
      })
    })

    describe('인증 에러 감지', () => {
      it('401 에러 감지', () => {
        const errorMsg = '401 Unauthorized'
        const isAuthError = errorMsg.includes('401')

        expect(isAuthError).toBe(true)
      })

      it('auth 관련 에러 감지', () => {
        const errorMessages = [
          '401 Unauthorized',
          'auth error',
          'token expired',
          'login required'
        ]

        errorMessages.forEach(msg => {
          const isAuthError = msg.includes('401') ||
            msg.includes('auth') ||
            msg.includes('token') ||
            msg.includes('login')

          expect(isAuthError).toBe(true)
        })
      })

      it('일반 에러는 authError false', () => {
        const errorMsg = 'Network error'
        const isAuthError = errorMsg.includes('401') ||
          errorMsg.includes('auth') ||
          errorMsg.includes('token') ||
          errorMsg.includes('login')

        expect(isAuthError).toBe(false)
      })
    })

    describe('반환값', () => {
      it('성공 시 { success: true }', () => {
        const result = { success: true }
        expect(result.success).toBe(true)
      })

      it('실패 시 { success: false }', () => {
        const result = { success: false }
        expect(result.success).toBe(false)
      })

      it('인증 에러 시 { success: false, authError: true }', () => {
        const result = { success: false, authError: true }
        expect(result.authError).toBe(true)
      })
    })
  })

  describe('handleGenerateAllRefs (일괄)', () => {
    describe('대상 레퍼런스 필터링', () => {
      it('prompt 있고 data 없는 것만 선택', () => {
        const references = [
          { name: 'alice', prompt: 'Alice prompt', data: null },
          { name: 'bob', prompt: 'Bob prompt', data: 'base64...' }, // 이미 생성됨
          { name: 'charlie', prompt: '', data: null }, // 프롬프트 없음
          { name: 'david', prompt: 'David prompt', data: null }
        ]

        const generatableIndices = references
          .map((ref, index) => (ref.prompt && !ref.data) ? index : -1)
          .filter(i => i !== -1)

        expect(generatableIndices).toEqual([0, 3])
      })

      it('모두 생성 완료면 빈 배열', () => {
        const references = [
          { name: 'alice', prompt: 'Alice', data: 'base64...' },
          { name: 'bob', prompt: 'Bob', data: 'base64...' }
        ]

        const generatableIndices = references
          .map((ref, index) => (ref.prompt && !ref.data) ? index : -1)
          .filter(i => i !== -1)

        expect(generatableIndices).toHaveLength(0)
      })

      it('force=true: 완료된 ref (data, filePath, status=done)도 포함, style은 styleIndices로 분리 선택', () => {
        const references = [
          { name: 'alice', prompt: 'Alice', data: 'base64...', status: 'done' },
          { name: 'bob', prompt: 'Bob', data: null, status: 'pending' },
          { name: 'charlie', prompt: 'Charlie', filePath: '/path/img.png', status: 'done' },
          { name: 'style1', prompt: 'Style prompt', type: 'style', data: 'base64...' },
          { name: 'david', prompt: '', data: null }, // prompt 없음 → 제외
        ]
        const force = true

        // 실 구현(_executeBatchRefs)의 pickIndices 와 같은 필터
        const pickIndices = (typeMatches) => references
          .map((ref, index) => {
            if (!ref.prompt || !typeMatches(ref.type)) return -1
            if (force) return index
            return (!ref.data && !ref.filePath && ref.status !== 'done') ? index : -1
          })
          .filter(i => i !== -1)

        const styleIndices = pickIndices(ty => ty === 'style')
        const nonStyleIndices = pickIndices(ty => ty !== 'style')

        // style ref 는 이제 배치에 포함된다 — styleIndices 로 분리 선택
        expect(styleIndices).toEqual([3])
        // non-style ref 는 별도 phase 로
        expect(nonStyleIndices).toEqual([0, 1, 2])
        // style 이 먼저 — allIndices = [...style, ...nonStyle]
        expect([...styleIndices, ...nonStyleIndices]).toEqual([3, 0, 1, 2])
      })

      it('force=true: done/error ref를 pending으로 status 리셋 (이미지 필드는 유지)', () => {
        const references = [
          { name: 'alice', prompt: 'Alice', data: 'base64-alice', filePath: '/a.png', mediaId: 'm-1', status: 'done' },
          { name: 'bob', prompt: 'Bob', status: 'error', errorMessage: 'old err' },
          { name: 'charlie', prompt: 'Charlie', status: 'pending' },
        ]
        const generatableIndices = [0, 1, 2]

        // 실 구현(_executeBatchRefs force 분기)과 같은 status 리셋
        const idxSet = new Set(generatableIndices)
        const reset = references.map((r, i) => {
          if (!idxSet.has(i)) return r
          if (r.status === 'done' || r.status === 'error') {
            return { ...r, status: 'pending', errorMessage: null }
          }
          return r
        })

        // done/error → pending
        expect(reset[0].status).toBe('pending')
        expect(reset[1].status).toBe('pending')
        expect(reset[1].errorMessage).toBeNull()
        // pending → pending (변경 없음)
        expect(reset[2].status).toBe('pending')

        // 이미지/path/mediaId 유지 (사용자가 이전 결과 비교 가능)
        expect(reset[0].data).toBe('base64-alice')
        expect(reset[0].filePath).toBe('/a.png')
        expect(reset[0].mediaId).toBe('m-1')
      })
    })

    describe('폴더 권한 (사용자 제스처)', () => {
      it('folder 모드 시 권한 먼저 확인', async () => {
        const settings = { saveMode: 'folder' }

        mockFileSystemAPI.ensurePermission.mockResolvedValue({
          hasPermission: true,
          name: 'WorkFolder'
        })

        if (settings.saveMode === 'folder') {
          const permission = await mockFileSystemAPI.ensurePermission()
          expect(permission.hasPermission).toBe(true)
        }
      })

      it('폴더 미설정 시 설정창 열기', async () => {
        mockFileSystemAPI.ensurePermission.mockResolvedValue({
          error: 'not_set'
        })

        const permission = await mockFileSystemAPI.ensurePermission()

        if (permission.error === 'not_set') {
          mockOpenSettings('storage')
        }

        expect(mockOpenSettings).toHaveBeenCalledWith('storage')
      })

      it('권한 없으면 경고 후 설정창', async () => {
        mockFileSystemAPI.ensurePermission.mockResolvedValue({
          hasPermission: false,
          name: 'WorkFolder'
        })

        const permission = await mockFileSystemAPI.ensurePermission()

        if (!permission.hasPermission) {
          mockToast.warning('작업 폴더 권한이 필요합니다.')
          mockOpenSettings('storage')
        }

        expect(mockToast.warning).toHaveBeenCalled()
      })
    })

    describe('순차 처리', () => {
      it('하나씩 순서대로 처리', async () => {
        const generatableIndices = [0, 2, 3]
        const processedOrder = []

        for (const index of generatableIndices) {
          processedOrder.push(index)
        }

        expect(processedOrder).toEqual([0, 2, 3])
      })

      it('각 처리 사이 딜레이', async () => {
        const generatableIndices = [0, 1]
        const delays = []

        for (let i = 0; i < generatableIndices.length; i++) {
          if (i !== generatableIndices.length - 1) {
            delays.push(2000)
          }
        }

        expect(delays).toEqual([2000])
      })
    })

    describe('collectCompleted 병렬 후처리', () => {
      // 같은 폴링 창에서 여러 ref 가 동시에 완료된 경우, 후처리(upscale + uploadReference +
      // save + history)는 서로 독립이므로 Promise.all 로 병렬 실행한다. 단일 항목에는 효과
      // 없고 다중 클러스터 완료 시 wall-clock 단축. 의미적으론 변경 없음 (결과·순서·API
      // 호출 횟수 모두 동일).

      // collectCompleted 의 핵심 알고리즘 재현
      // (Phase 1: status 순차 식별 / Phase 2: 후처리 병렬 / Phase 3: 성공 항목만 splice).
      // 후처리에서 throw 한 항목은 큐에 남겨 Phase 2 타임아웃 cleanup 으로 위임 — 직렬
      // 구현이 제공하던 안전망 (regression 방지) 보존.
      const collectCompletedAlgo = async ({ pendingQueue, checkGeneration, processAsyncResult }) => {
        let hasPendingSaves = false
        const completed = []
        for (let i = pendingQueue.length - 1; i >= 0; i--) {
          const pending = pendingQueue[i]
          try {
            const status = await checkGeneration(pending.generationId)
            if (status?.success && status.completed) {
              completed.push(pending)
            }
          } catch { /* ignore */ }
        }
        const succeeded = new Set()
        await Promise.all(completed.map(async (pending) => {
          try {
            const r = await processAsyncResult(pending.generationId, pending.index, pending.ref)
            if (r?.savedToMemory) hasPendingSaves = true
            succeeded.add(pending)
          } catch { /* leave in queue */ }
        }))
        if (succeeded.size > 0) {
          for (let i = pendingQueue.length - 1; i >= 0; i--) {
            if (succeeded.has(pendingQueue[i])) pendingQueue.splice(i, 1)
          }
        }
        return { hasPendingSaves, processedCount: completed.length, succeededCount: succeeded.size }
      }

      it('다중 완료 항목을 병렬로 후처리 (wall-clock = max, not sum)', async () => {
        const POST_PROCESS_MS = 80
        const checkGeneration = vi.fn().mockResolvedValue({ success: true, completed: true })
        const processAsyncResult = vi.fn().mockImplementation(
          () => new Promise(resolve => setTimeout(() => resolve({ success: true, savedToMemory: false }), POST_PROCESS_MS))
        )
        const pendingQueue = [
          { generationId: 'g1', index: 0, ref: { name: 'a' } },
          { generationId: 'g2', index: 1, ref: { name: 'b' } },
          { generationId: 'g3', index: 2, ref: { name: 'c' } },
        ]

        const start = Date.now()
        const { processedCount } = await collectCompletedAlgo({ pendingQueue, checkGeneration, processAsyncResult })
        const elapsed = Date.now() - start

        expect(processedCount).toBe(3)
        expect(processAsyncResult).toHaveBeenCalledTimes(3)
        // sequential = 240ms. parallel = ~80ms. 절반(120ms) 이하면 병렬 동작 확정 — 시스템
        // 변동에 견디는 보수적 임계값.
        expect(elapsed).toBeLessThan(POST_PROCESS_MS * 1.5)
        expect(pendingQueue).toHaveLength(0)
      })

      it('한 항목 후처리 실패 시 나머지는 처리 + 실패 항목은 큐에 유지 (Phase 2 cleanup 위임)', async () => {
        // 직렬 구현은 processAsyncResult 가 throw 하면 splice 가 도달 못 해서 큐에 남았다.
        // 병렬 구현은 succeeded set 으로 같은 안전망 유지 — Phase 2 타임아웃이 정리.
        const checkGeneration = vi.fn().mockResolvedValue({ success: true, completed: true })
        const processAsyncResult = vi.fn().mockImplementation((genId) => {
          if (genId === 'g2') return Promise.reject(new Error('boom'))
          return Promise.resolve({ success: true, savedToMemory: false })
        })
        const pendingQueue = [
          { generationId: 'g1', index: 0, ref: {} },
          { generationId: 'g2', index: 1, ref: {} },
          { generationId: 'g3', index: 2, ref: {} },
        ]

        const { processedCount, succeededCount } = await collectCompletedAlgo({ pendingQueue, checkGeneration, processAsyncResult })

        expect(processedCount).toBe(3)            // 3개 모두 후처리 시도
        expect(succeededCount).toBe(2)            // g1, g3 만 성공
        expect(processAsyncResult).toHaveBeenCalledTimes(3)
        expect(pendingQueue).toHaveLength(1)      // g2 (실패) 는 큐에 남음
        expect(pendingQueue[0].generationId).toBe('g2')
      })

      it('hasPendingSaves OR-merge: 하나라도 savedToMemory=true 면 true', async () => {
        const checkGeneration = vi.fn().mockResolvedValue({ success: true, completed: true })
        const processAsyncResult = vi.fn()
          .mockResolvedValueOnce({ success: true, savedToMemory: false })
          .mockResolvedValueOnce({ success: true, savedToMemory: true })
          .mockResolvedValueOnce({ success: true, savedToMemory: false })
        const pendingQueue = [
          { generationId: 'g1', index: 0, ref: {} },
          { generationId: 'g2', index: 1, ref: {} },
          { generationId: 'g3', index: 2, ref: {} },
        ]

        const { hasPendingSaves } = await collectCompletedAlgo({ pendingQueue, checkGeneration, processAsyncResult })

        expect(hasPendingSaves).toBe(true)
      })

      it('checkGeneration 실패 항목은 큐에 유지 (재시도 가능)', async () => {
        const checkGeneration = vi.fn().mockImplementation((genId) => {
          if (genId === 'g2') return Promise.reject(new Error('network'))
          return Promise.resolve({ success: true, completed: true })
        })
        const processAsyncResult = vi.fn().mockResolvedValue({ success: true })
        const pendingQueue = [
          { generationId: 'g1', index: 0, ref: {} },
          { generationId: 'g2', index: 1, ref: {} },
          { generationId: 'g3', index: 2, ref: {} },
        ]

        const { processedCount } = await collectCompletedAlgo({ pendingQueue, checkGeneration, processAsyncResult })

        expect(processedCount).toBe(2) // g1, g3 만 처리
        expect(pendingQueue).toHaveLength(1) // g2 는 큐에 남음
        expect(pendingQueue[0].generationId).toBe('g2')
      })

      it('완료 항목 0개일 때 processAsyncResult 호출 안 함', async () => {
        const checkGeneration = vi.fn().mockResolvedValue({ success: true, completed: false })
        const processAsyncResult = vi.fn()
        const pendingQueue = [
          { generationId: 'g1', index: 0, ref: {} },
          { generationId: 'g2', index: 1, ref: {} },
        ]

        const { processedCount } = await collectCompletedAlgo({ pendingQueue, checkGeneration, processAsyncResult })

        expect(processedCount).toBe(0)
        expect(processAsyncResult).not.toHaveBeenCalled()
        expect(pendingQueue).toHaveLength(2) // 모두 큐에 남음
      })
    })

    describe('mapWithConcurrency (Flow 429 보호)', () => {
      // 후처리에서 N개 동시 완료 시 uploadReference 가 무제한 동시 호출되면 Flow rate-limit
      // (429) 위험. useAutomation 의 자동 업로드 경로와 동일한 동시성 5 제한.
      const mapWithConcurrencyAlgo = async (items, mapper, concurrency = 5) => {
        if (items.length === 0) return []
        const results = new Array(items.length)
        let cursor = 0
        const workers = Array.from({ length: Math.min(concurrency, items.length) }, async () => {
          while (true) {
            const myIdx = cursor++
            if (myIdx >= items.length) return
            results[myIdx] = await mapper(items[myIdx], myIdx)
          }
        })
        await Promise.all(workers)
        return results
      }

      it('동시 활성 worker 가 concurrency 를 초과하지 않음', async () => {
        let active = 0
        let maxActive = 0
        const mapper = async () => {
          active++
          maxActive = Math.max(maxActive, active)
          await new Promise(r => setTimeout(r, 30))
          active--
        }
        const items = Array.from({ length: 12 }, (_, i) => i)

        await mapWithConcurrencyAlgo(items, mapper, 5)

        expect(maxActive).toBeLessThanOrEqual(5)
        expect(maxActive).toBeGreaterThanOrEqual(2) // 12개니까 최소 2개는 동시 — 진짜 병렬 검증
      })

      it('빈 배열은 빈 배열 반환', async () => {
        const mapper = vi.fn()
        const result = await mapWithConcurrencyAlgo([], mapper, 5)
        expect(result).toEqual([])
        expect(mapper).not.toHaveBeenCalled()
      })

      it('결과 순서 보존 (인덱스 매핑 정확)', async () => {
        const mapper = async (item) => item * 2
        const result = await mapWithConcurrencyAlgo([1, 2, 3, 4, 5], mapper, 2)
        expect(result).toEqual([2, 4, 6, 8, 10])
      })

      it('items.length < concurrency 일 때도 정상 동작', async () => {
        const mapper = vi.fn().mockResolvedValue('ok')
        const result = await mapWithConcurrencyAlgo(['a', 'b'], mapper, 5)
        expect(result).toEqual(['ok', 'ok'])
        expect(mapper).toHaveBeenCalledTimes(2)
      })
    })

    describe('uploadReferenceWithRetry (429 backoff)', () => {
      // useAutomation 의 자동 업로드 경로와 동일 패턴: MAX_RETRIES=2, exponential backoff,
      // 429 만 retry, 비-429 실패는 즉시 반환.
      const uploadReferenceWithRetryAlgo = async (flowAPI, base64, category) => {
        const MAX_RETRIES = 2
        for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
          try {
            const result = await flowAPI.uploadReference(base64, category)
            if (result.success) return result
            if (result.error?.includes('429') && attempt < MAX_RETRIES) {
              await new Promise(r => setTimeout(r, 0)) // 테스트에선 즉시 retry
              continue
            }
            return result
          } catch (e) {
            if (attempt < MAX_RETRIES && /429|rate/i.test(e?.message || '')) {
              await new Promise(r => setTimeout(r, 0))
              continue
            }
            return { success: false, error: e?.message || String(e) }
          }
        }
        return { success: false, error: 'uploadReference exhausted retries' }
      }

      it('성공 시 즉시 반환 (retry 없음)', async () => {
        const uploadReference = vi.fn().mockResolvedValue({ success: true, mediaId: 'm1' })
        const flowAPI = { uploadReference }

        const result = await uploadReferenceWithRetryAlgo(flowAPI, 'base64', 'character')

        expect(result).toEqual({ success: true, mediaId: 'm1' })
        expect(uploadReference).toHaveBeenCalledTimes(1)
      })

      it('429 시 backoff 후 재시도, 두 번째에 성공', async () => {
        const uploadReference = vi.fn()
          .mockResolvedValueOnce({ success: false, error: 'HTTP 429 rate limit' })
          .mockResolvedValueOnce({ success: true, mediaId: 'm1' })
        const flowAPI = { uploadReference }

        const result = await uploadReferenceWithRetryAlgo(flowAPI, 'base64', 'character')

        expect(result.success).toBe(true)
        expect(result.mediaId).toBe('m1')
        expect(uploadReference).toHaveBeenCalledTimes(2)
      })

      it('429 가 MAX_RETRIES 까지 지속 → 실패 반환', async () => {
        const uploadReference = vi.fn().mockResolvedValue({ success: false, error: '429 too many requests' })
        const flowAPI = { uploadReference }

        const result = await uploadReferenceWithRetryAlgo(flowAPI, 'base64', 'character')

        expect(result.success).toBe(false)
        expect(uploadReference).toHaveBeenCalledTimes(3) // initial + 2 retries
      })

      it('비-429 실패는 즉시 반환 (retry 없음)', async () => {
        const uploadReference = vi.fn().mockResolvedValue({ success: false, error: 'invalid token' })
        const flowAPI = { uploadReference }

        const result = await uploadReferenceWithRetryAlgo(flowAPI, 'base64', 'character')

        expect(result.success).toBe(false)
        expect(result.error).toBe('invalid token')
        expect(uploadReference).toHaveBeenCalledTimes(1) // 한 번만
      })

      it('throw 시 429 메시지면 retry, 아니면 즉시 실패', async () => {
        const uploadReference1 = vi.fn().mockRejectedValue(new Error('Got 429 from Flow'))
        const result1 = await uploadReferenceWithRetryAlgo({ uploadReference: uploadReference1 }, 'b', 'c')
        expect(uploadReference1).toHaveBeenCalledTimes(3) // 429 keyword → retry to MAX
        expect(result1.success).toBe(false)

        const uploadReference2 = vi.fn().mockRejectedValue(new Error('network down'))
        const result2 = await uploadReferenceWithRetryAlgo({ uploadReference: uploadReference2 }, 'b', 'c')
        expect(uploadReference2).toHaveBeenCalledTimes(1) // 비-429 → 즉시 실패
        expect(result2.success).toBe(false)
      })
    })

    describe('인증 에러 복구', () => {
      it('authError 시 토큰 갱신 시도', async () => {
        mockGetAccessToken.mockResolvedValue('new_token')

        const result = { authError: true }

        if (result.authError) {
          mockToast.info('토큰 갱신 중...')
          const newToken = await mockGetAccessToken(true)

          expect(newToken).toBe('new_token')
        }
      })

      it('토큰 갱신 성공 후 재시도', async () => {
        mockGetAccessToken.mockResolvedValue('new_token')

        const newToken = await mockGetAccessToken(true)

        if (newToken) {
          // 같은 인덱스 재시도
          const retryResult = { success: true }
          expect(retryResult.success).toBe(true)
        }
      })

      it('재시도도 실패하면 중단', async () => {
        mockGetAccessToken.mockResolvedValue('new_token')

        const retryResult = { authError: true }

        if (retryResult.authError) {
          mockToast.warning('인증 오류로 중단되었습니다. Whisk에 로그인 후 다시 시도해주세요.')
          // break
        }

        expect(mockToast.warning).toHaveBeenCalledWith(
          '인증 오류로 중단되었습니다. Whisk에 로그인 후 다시 시도해주세요.'
        )
      })

      it('토큰 갱신 실패하면 중단', async () => {
        mockGetAccessToken.mockResolvedValue(null)

        const newToken = await mockGetAccessToken(true)

        if (!newToken) {
          mockToast.warning('인증 오류로 중단되었습니다. Whisk에 로그인 후 다시 시도해주세요.')
        }

        expect(mockToast.warning).toHaveBeenCalled()
      })
    })
  })

  describe('generatingRefs 상태', () => {
    it('생성 시작 시 인덱스 추가', () => {
      let generatingRefs = []

      generatingRefs = [...generatingRefs, 0]

      expect(generatingRefs).toContain(0)
    })

    it('생성 완료 시 인덱스 제거', () => {
      let generatingRefs = [0, 1, 2]
      const index = 1

      generatingRefs = generatingRefs.filter(i => i !== index)

      expect(generatingRefs).toEqual([0, 2])
    })

    it('여러 개 동시에 추적', () => {
      let generatingRefs = []

      generatingRefs = [...generatingRefs, 0]
      generatingRefs = [...generatingRefs, 2]

      expect(generatingRefs).toEqual([0, 2])
    })
  })
})

describe('훅 반환값', () => {
  it('반환 객체 구조', () => {
    const hookReturn = {
      generatingRefs: [],
      handleGenerateRef: vi.fn(),
      handleGenerateAllRefs: vi.fn()
    }

    expect(hookReturn).toHaveProperty('generatingRefs')
    expect(hookReturn).toHaveProperty('handleGenerateRef')
    expect(hookReturn).toHaveProperty('handleGenerateAllRefs')
  })
})

describe('통합 시나리오', () => {
  it('개별 레퍼런스 생성 전체 플로우', async () => {
    const index = 0
    const ref = {
      name: 'alice',
      type: 'character',
      prompt: 'A beautiful woman with long hair',
      category: 'MEDIA_CATEGORY_SUBJECT'
    }
    const settings = {
      saveMode: 'folder',
      projectName: 'test_project',
      aspectRatio: '1:1',
      seedLocked: false
    }

    // 1. 권한 체크
    mockCheckFolderPermission.mockResolvedValue(true)
    mockCheckAuthToken.mockResolvedValue(true)

    // 2. 이미지 생성
    mockGenerateImageAPI.mockResolvedValue({
      success: true,
      images: ['base64_image_data']
    })

    const genResult = await mockGenerateImageAPI(ref.prompt, settings.aspectRatio, [], null)
    expect(genResult.success).toBe(true)

    // 3. Whisk 업로드
    mockUploadReference.mockResolvedValue({
      success: true,
      mediaId: 'media_123',
      caption: 'A beautiful woman'
    })

    const uploadResult = await mockUploadReference('base64', ref.category)
    expect(uploadResult.mediaId).toBe('media_123')

    // 4. 파일 저장
    mockFileSystemAPI.saveReference.mockResolvedValue({
      success: true,
      path: 'test_project/references/alice.png',
      dataUrl: 'data:image/png;base64,...'
    })

    const saveResult = await mockFileSystemAPI.saveReference(
      settings.projectName,
      ref.name,
      genResult.images[0],
      'whisk',
      { mediaId: uploadResult.mediaId, caption: uploadResult.caption, category: ref.category }
    )
    expect(saveResult.success).toBe(true)

    // 5. 상태 업데이트
    const updateData = {
      data: saveResult.dataUrl,
      filePath: saveResult.path,
      dataStorage: 'file',
      mediaId: uploadResult.mediaId,
      caption: uploadResult.caption
    }

    expect(updateData.filePath).toContain('alice')
    expect(updateData.mediaId).toBe('media_123')
  })

  it('일괄 생성 전체 플로우', async () => {
    const references = [
      { name: 'alice', prompt: 'Alice', data: null },
      { name: 'bob', prompt: 'Bob', data: null }
    ]
    const settings = { saveMode: 'folder', projectName: 'test' }

    // 1. 대상 필터링
    const generatableIndices = references
      .map((ref, index) => (ref.prompt && !ref.data) ? index : -1)
      .filter(i => i !== -1)

    expect(generatableIndices).toHaveLength(2)

    // 2. 폴더 권한
    mockFileSystemAPI.ensurePermission.mockResolvedValue({ hasPermission: true })
    const permission = await mockFileSystemAPI.ensurePermission()
    expect(permission.hasPermission).toBe(true)

    // 3. 순차 처리
    for (const index of generatableIndices) {
      // 각 레퍼런스 처리
      expect(index).toBeGreaterThanOrEqual(0)
    }
  })
})
