/**
 * useFlowArchiveBrowser — Flow archive 2단계 네비게이션(날짜 → 이미지)을
 * 캡슐화한 훅. SceneSelect(드롭다운)와 EmptyStateUpload(빈 패널 CTA)에서
 * 동일하게 재사용한다.
 *
 * Lifecycle:
 *   view: 'idle' → 'dates' → 'media'
 *   - openDates() : 프로젝트 목록 fetch (lazy, 캐시됨)
 *   - pickProject(p) : 그 프로젝트의 이미지 fetch
 *   - reset() : idle 로 돌아감 (드롭다운 닫힐 때 등)
 *
 * Inputs:
 *   onListFlowProjects : () => Promise<{ success, items: [{projectId,title,...}] }>
 *   onFetchProjectGallery : (projectId) => Promise<{ success, items: [{mediaId,url,displayName}] }>
 */

import { useCallback, useRef, useState } from 'react'

// Shared UI strings — keep dropdown and empty-state labels in sync.
export const ARCHIVE_LABELS = {
  browse: '📅 Browse Flow Archive',
  loadingProjects: '⏳ Loading projects...',
  noProjects: 'No projects found',
  loadingImages: '⏳ Loading images...',
  noImages: 'No images',
  imagesHeader: '🖼 Images',
  archiveHeader: '📅 Flow Archive',
  back: '← Back',
  cancel: '← Cancel',
}

export default function useFlowArchiveBrowser({ onListFlowProjects, onFetchProjectGallery }) {
  const [view, setView] = useState('idle') // 'idle' | 'dates' | 'media'
  const [projects, setProjects] = useState([])
  const [projectsLoading, setProjectsLoading] = useState(false)
  const [selectedProject, setSelectedProject] = useState(null)
  const [media, setMedia] = useState([])
  const [mediaLoading, setMediaLoading] = useState(false)

  // 빠른 프로젝트 전환 race 방지: 마지막 요청 토큰만 state에 반영한다.
  // 사용자가 A 선택 → B 빠르게 선택 시 A 응답이 늦게 도착해 B 화면을 덮는 걸 막는다.
  const projectsReqRef = useRef(0)
  const mediaReqRef = useRef(0)

  const reset = useCallback(() => {
    setView('idle')
    setSelectedProject(null)
    setMedia([])
    // 진행 중인 요청 무효화
    projectsReqRef.current++
    mediaReqRef.current++
  }, [])

  const openDates = useCallback(async () => {
    if (!onListFlowProjects) return
    setView('dates')
    if (projects.length === 0) {
      const reqId = ++projectsReqRef.current
      setProjectsLoading(true)
      try {
        const r = await onListFlowProjects()
        if (reqId !== projectsReqRef.current) return // stale
        if (r?.success) setProjects(r.items || [])
        else console.warn('[archive] list projects failed:', r?.error)
      } catch (e) {
        if (reqId !== projectsReqRef.current) return
        console.error('[archive] list projects error:', e)
      } finally {
        if (reqId === projectsReqRef.current) setProjectsLoading(false)
      }
    }
  }, [onListFlowProjects, projects.length])

  const pickProject = useCallback(async (project) => {
    if (!project) return
    setSelectedProject(project)
    setView('media')
    setMedia([])
    if (!onFetchProjectGallery) return
    const reqId = ++mediaReqRef.current
    setMediaLoading(true)
    try {
      const r = await onFetchProjectGallery(project.projectId)
      if (reqId !== mediaReqRef.current) return // stale — 다른 프로젝트로 이미 전환됨
      if (r?.success) setMedia(r.items || [])
      else console.warn('[archive] fetch project gallery failed:', r?.error)
    } catch (e) {
      if (reqId !== mediaReqRef.current) return
      console.error('[archive] fetch project gallery error:', e)
    } finally {
      if (reqId === mediaReqRef.current) setMediaLoading(false)
    }
  }, [onFetchProjectGallery])

  const backToDates = useCallback(() => {
    setView('dates')
    setSelectedProject(null)
    setMedia([])
    // 미해결 media 요청 무효화
    mediaReqRef.current++
  }, [])

  return {
    view,
    projects,
    projectsLoading,
    selectedProject,
    media,
    mediaLoading,
    openDates,
    pickProject,
    backToDates,
    reset,
  }
}
