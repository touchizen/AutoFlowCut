/**
 * 라이브러리 SFX 소스 — description을 로컬 SFX 라이브러리 파일과 매칭.
 * M2b MVP: 인터페이스만(stub). 실제 매칭(라이브러리 구축/인덱싱)은 후속 slice.
 */
export function createLibrarySfxAdapter() {
  return {
    capabilities() {
      return { outputFormats: ['mp3', 'wav'], maxConcurrency: 4 }
    },
    async generate() {
      const error = new Error('Local sound-effects library unavailable')
      error.errorKind = 'story-sfx-library-unavailable'
      throw error
    },
  }
}
