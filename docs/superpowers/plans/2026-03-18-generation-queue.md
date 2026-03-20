# Generation Queue Manager Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 모든 생성 요청(레퍼런스, 씬, 비디오)을 하나의 큐로 통합하여, 동시 실행을 제어하고, 큐가 가득 차면 사용자에게 메시지를 표시한다.

**Architecture:** 새로운 `useGenerationQueue` 훅이 중앙 큐 매니저 역할을 한다. 기존 3개 생성 훅(useSceneGeneration, useReferenceGeneration, useVideoAutomation)은 직접 Flow API를 호출하는 대신 큐에 작업을 넣는다. 큐는 FIFO 순서로 concurrency=1로 실행하며, 최대 큐 사이즈를 초과하면 toast 메시지를 보낸다.

**Tech Stack:** React hooks, existing toast system, existing Flow API

---

## File Structure

| File | Role | Action |
|------|------|--------|
| `src/hooks/useGenerationQueue.js` | 중앙 큐 매니저 훅 | **Create** |
| `src/hooks/useSceneGeneration.js` | 씬 이미지 생성 | **Modify** — 큐 enqueue 사용 |
| `src/hooks/useReferenceGeneration.js` | 레퍼런스 이미지 생성 | **Modify** — 개별 생성을 큐 enqueue로 변경 |
| `src/hooks/useVideoAutomation.js` | 비디오 생성 | **Modify** — 큐 enqueue 사용 |
| `src/App.jsx` | 훅 연결 | **Modify** — useGenerationQueue 초기화 + 전달 |
| `src/locales/ko.js` | 한국어 번역 | **Modify** — 큐 관련 메시지 추가 |
| `src/locales/en.js` | 영어 번역 | **Modify** — 큐 관련 메시지 추가 |

---

## 설계 원칙

### 큐 아이템 구조

```javascript
{
  id: string,           // 고유 ID
  type: 'scene' | 'reference' | 'reference_batch' | 'video_batch',
  label: string,        // 표시용 (e.g. "씬 #42", "Ref #3")
  execute: async () => any,  // 실제 생성 함수 (클로저)
  resolve: Function,    // Promise resolve
  reject: Function,     // Promise reject
  status: 'queued' | 'running' | 'done' | 'error'
}
```

### 핵심 동작

- `enqueue(item)` → Promise 반환 (완료 시 resolve)
- 큐에 넣으면 자동으로 다음 아이템 실행 시작
- concurrency=1: 한 번에 하나만 실행
- maxQueue=200: 초과 시 reject + toast

### 배치 생성은 기존 패턴 유지

- 배치(handleGenerateAllRefs, 비디오 자동화)는 이미 자체적으로 **7~15초 딜레이 + 폴링** 패턴을 사용
- 배치 자체를 **하나의 큐 아이템**으로 enqueue (배치 내부의 개별 아이템은 큐를 거치지 않음)
- 배치 실행 중에 개별 생성 요청이 오면 큐에서 대기

---

### Task 1: useGenerationQueue 훅 생성

**Files:**
- Create: `src/hooks/useGenerationQueue.js`
- Modify: `src/locales/ko.js`
- Modify: `src/locales/en.js`

- [ ] **Step 1: 큐 훅 구현**

```javascript
// src/hooks/useGenerationQueue.js
import { useState, useRef, useCallback } from 'react'

const MAX_QUEUE_SIZE = 200

export function useGenerationQueue({ t, showToast } = {}) {
  const [queueSize, setQueueSize] = useState(0)
  const [runningItem, setRunningItem] = useState(null)
  const queueRef = useRef([])
  const isProcessingRef = useRef(false)

  const processNext = useCallback(async () => {
    if (isProcessingRef.current) return
    if (queueRef.current.length === 0) {
      setRunningItem(null)
      return
    }

    isProcessingRef.current = true
    const item = queueRef.current.shift()
    setQueueSize(queueRef.current.length)
    setRunningItem(item)
    item.status = 'running'

    try {
      const result = await item.execute()
      item.status = 'done'
      item.resolve(result)
    } catch (err) {
      item.status = 'error'
      item.reject(err)
    } finally {
      isProcessingRef.current = false
      setRunningItem(null)
      processNext()
    }
  }, [])

  const enqueue = useCallback(({ type, label, execute }) => {
    return new Promise((resolve, reject) => {
      if (queueRef.current.length >= MAX_QUEUE_SIZE) {
        const msg = t?.('queue.full') || `Generation queue is full (${MAX_QUEUE_SIZE})`
        showToast?.(msg, 'error')
        reject(new Error(msg))
        return
      }

      const item = {
        id: `${type}_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
        type, label, execute, resolve, reject,
        status: 'queued'
      }

      queueRef.current.push(item)
      setQueueSize(queueRef.current.length)
      processNext()
    })
  }, [processNext, t, showToast])

  const clearQueue = useCallback((type) => {
    if (type) {
      const removed = queueRef.current.filter(item => item.type === type)
      queueRef.current = queueRef.current.filter(item => item.type !== type)
      removed.forEach(item => item.reject(new Error('Queue cleared')))
    } else {
      queueRef.current.forEach(item => item.reject(new Error('Queue cleared')))
      queueRef.current = []
    }
    setQueueSize(queueRef.current.length)
  }, [])

  return { enqueue, clearQueue, queueSize, runningItem }
}
```

- [ ] **Step 2: 번역 키 추가**

`ko.js`:
```javascript
queue: {
  full: '생성 큐가 가득 찼습니다 (200개)',
}
```

`en.js`:
```javascript
queue: {
  full: 'Generation queue is full (200)',
}
```

- [ ] **Step 3: 커밋**

```bash
git add src/hooks/useGenerationQueue.js src/locales/ko.js src/locales/en.js
git commit -m "feat: add useGenerationQueue hook for centralized generation queue"
```

---

### Task 2: App.jsx에 큐 훅 연결

**Files:**
- Modify: `src/App.jsx`

- [ ] **Step 1: import + 초기화 + 기존 훅에 전달**

```javascript
import { useGenerationQueue } from './hooks/useGenerationQueue'

// App 컴포넌트 내부
const generationQueue = useGenerationQueue({ t, showToast })

// 기존 훅에 generationQueue 전달
const { generatingSceneId, handleGenerateScene } = useSceneGeneration({
  ..., generationQueue
})
const { ... } = useReferenceGeneration({
  ..., generationQueue
})
// useVideoAutomation에도 동일하게 전달
```

- [ ] **Step 2: 커밋**

```bash
git add src/App.jsx
git commit -m "feat: wire useGenerationQueue into App and pass to generation hooks"
```

---

### Task 3: useSceneGeneration — 큐 적용

**Files:**
- Modify: `src/hooks/useSceneGeneration.js`

- [ ] **Step 1: handleGenerateScene을 큐 경유로 변경**

핵심 로직을 `_executeSceneGeneration`으로 추출, `handleGenerateScene`은 큐에 enqueue:

```javascript
export function useSceneGeneration({ ..., generationQueue }) {
  const [generatingSceneId, setGeneratingSceneId] = useState(null)

  const _executeSceneGeneration = useCallback(async (sceneId) => {
    // ... 기존 handleGenerateScene 전체 로직 그대로
  }, [/* 기존 deps */])

  const handleGenerateScene = useCallback(async (sceneId) => {
    if (!generationQueue) {
      return _executeSceneGeneration(sceneId)
    }
    try {
      await generationQueue.enqueue({
        type: 'scene',
        label: `Scene #${sceneId}`,
        execute: () => _executeSceneGeneration(sceneId)
      })
    } catch (err) {
      console.warn('[SceneGen] Queue rejected:', err.message)
    }
  }, [generationQueue, _executeSceneGeneration])

  return { generatingSceneId, handleGenerateScene }
}
```

- [ ] **Step 2: 커밋**

```bash
git add src/hooks/useSceneGeneration.js
git commit -m "feat: route scene generation through centralized queue"
```

---

### Task 4: useReferenceGeneration — 큐 적용

**Files:**
- Modify: `src/hooks/useReferenceGeneration.js`

- [ ] **Step 1: 개별 + 배치 모두 큐 경유로 변경**

```javascript
export function useReferenceGeneration({ ..., generationQueue }) {
  // 핵심 로직 추출
  const _executeGenerateRef = useCallback(async (index, skipPermissionCheck, overrideStyleId) => {
    // ... 기존 handleGenerateRef 전체 로직
  }, [/* 기존 deps */])

  const handleGenerateRef = useCallback(async (index, skipPermissionCheck = false, overrideStyleId) => {
    // 배치 내부 호출(skipPermissionCheck=true)이면 직접 실행
    if (skipPermissionCheck || !generationQueue) {
      return _executeGenerateRef(index, skipPermissionCheck, overrideStyleId)
    }
    // 개별 호출이면 큐에 enqueue
    try {
      return await generationQueue.enqueue({
        type: 'reference',
        label: `Ref #${index + 1}`,
        execute: () => _executeGenerateRef(index, false, overrideStyleId)
      })
    } catch (err) {
      console.warn('[RefGen] Queue rejected:', err.message)
      return { success: false }
    }
  }, [generationQueue, _executeGenerateRef])

  // 배치 전체를 하나의 큐 아이템으로
  const _executeBatchRefs = useCallback(async (overrideStyleId) => {
    // ... 기존 handleGenerateAllRefs 전체 로직
    // 내부에서 _executeGenerateRef(index, true, ...) 직접 호출 (큐 안 거침)
  }, [/* 기존 deps */])

  const handleGenerateAllRefs = useCallback(async (overrideStyleId) => {
    if (!generationQueue) {
      return _executeBatchRefs(overrideStyleId)
    }
    try {
      await generationQueue.enqueue({
        type: 'reference_batch',
        label: 'Batch References',
        execute: () => _executeBatchRefs(overrideStyleId)
      })
    } catch (err) {
      console.warn('[RefGen] Batch queue rejected:', err.message)
    }
  }, [generationQueue, _executeBatchRefs])

  return {
    generatingRefs, stoppingRefs, preparingRefs,
    handleGenerateRef, handleGenerateAllRefs, stopGenerateAllRefs
  }
}
```

**핵심 규칙:**
- `skipPermissionCheck=true` → 배치 내부 호출 → 큐 안 거침 (기존 7~15초 딜레이 유지)
- `skipPermissionCheck=false` (기본) → UI 개별 클릭 → 큐 경유
- 배치 자체 → 하나의 큐 아이템

- [ ] **Step 2: 커밋**

```bash
git add src/hooks/useReferenceGeneration.js
git commit -m "feat: route reference generation through centralized queue"
```

---

### Task 5: useVideoAutomation — 큐 적용

**Files:**
- Modify: `src/hooks/useVideoAutomation.js`

- [ ] **Step 1: 비디오 자동화를 큐 경유로 변경**

비디오 자동화는 배치 작업이므로, 전체를 하나의 큐 아이템으로:

```javascript
export function useVideoAutomation({ ..., generationQueue }) {
  const _executeVideoAutomation = useCallback(async (options) => {
    // ... 기존 startAutomation/run 전체 로직
  }, [/* 기존 deps */])

  const startAutomation = useCallback(async (options) => {
    if (!generationQueue) {
      return _executeVideoAutomation(options)
    }
    try {
      await generationQueue.enqueue({
        type: 'video_batch',
        label: 'Video Automation',
        execute: () => _executeVideoAutomation(options)
      })
    } catch (err) {
      console.warn('[VideoGen] Queue rejected:', err.message)
    }
  }, [generationQueue, _executeVideoAutomation])

  return { startAutomation, /* 기존 반환값 */ }
}
```

- [ ] **Step 2: 커밋**

```bash
git add src/hooks/useVideoAutomation.js
git commit -m "feat: route video automation through centralized queue"
```

---

### Task 6: 빌드 검증 및 최종 푸시

- [ ] **Step 1: 빌드 확인**

```bash
cd /Users/tuxxon/workspace/Flow2CapCut && npm run build
```

Expected: 빌드 성공

- [ ] **Step 2: 수동 테스트**

1. 개별 씬 이미지 생성 → 큐에 들어가고 순차 실행 확인
2. 개별 레퍼런스 생성 → 큐에 들어가고 순차 실행 확인
3. 배치 실행 중 개별 생성 요청 → 큐에서 대기 확인
4. 큐 200개 초과 → toast 메시지 확인

- [ ] **Step 3: 최종 푸시**

```bash
git push origin main
```
