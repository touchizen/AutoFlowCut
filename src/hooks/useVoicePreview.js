import { useState, useRef, useCallback, useEffect } from 'react'
import { estimateGenderFromPcm } from '../utils/voiceGender.js'

export function useVoicePreview() {
  const [state, setState] = useState({ provider: null, voiceId: null, status: 'idle' })
  const [lastGender, setLastGender] = useState(null)
  const seqRef = useRef(0)
  const audioRef = useRef(null)
  const urlRef = useRef(null)
  const ctxRef = useRef(null)

  // Stops/clears the current audio element and revokes its object URL, if any.
  const cleanup = useCallback(() => {
    if (audioRef.current) {
      audioRef.current.pause()
      audioRef.current.onended = null
      audioRef.current.onerror = null
      audioRef.current = null
    }
    if (urlRef.current) {
      URL.revokeObjectURL(urlRef.current)
      urlRef.current = null
    }
  }, [])

  // Unmount cleanup: stop audio, revoke url, close the shared AudioContext.
  useEffect(() => {
    return () => {
      seqRef.current += 1 // Invalidate in-flight plays before cleanup
      cleanup()
      ctxRef.current?.close?.()
    }
  }, [cleanup])

  const play = useCallback(async (voice) => {
    const seq = ++seqRef.current
    cleanup()
    setState({ provider: voice.provider, voiceId: voice.voiceId, status: 'loading' })
    let res
    try {
      res = await window.electronAPI.ttsPreviewVoice({ provider: voice.provider, voiceId: voice.voiceId, language: voice.language || 'ko' })
    } catch { if (seq === seqRef.current) setState({ provider: voice.provider, voiceId: voice.voiceId, status: 'error' }); return }
    if (seq !== seqRef.current) return // stale
    if (!res || res.error) { setState({ provider: voice.provider, voiceId: voice.voiceId, status: 'error' }); return }

    const bytes = Uint8Array.from(atob(res.audioBase64), (c) => c.charCodeAt(0))
    const url = URL.createObjectURL(new Blob([bytes], { type: res.mimeType }))
    urlRef.current = url
    const audio = new Audio(url)
    audioRef.current = audio
    audio.onended = () => { if (seq === seqRef.current) setState({ provider: voice.provider, voiceId: voice.voiceId, status: 'idle' }) }
    audio.onerror = () => { if (seq === seqRef.current) setState({ provider: voice.provider, voiceId: voice.voiceId, status: 'error' }) }
    setState({ provider: voice.provider, voiceId: voice.voiceId, status: 'playing' })
    audio.play().catch(() => { if (seq === seqRef.current) setState({ provider: voice.provider, voiceId: voice.voiceId, status: 'error' }) })

    // F0 gender only for genuinely unknown voices — skip adapter/seed (fixed) and manual
    // (user override) so a preview replay never overwrites what the user already set.
    if (voice.genderSource !== 'adapter' && voice.genderSource !== 'seed' && voice.genderSource !== 'manual') {
      try {
        if (!ctxRef.current) ctxRef.current = new AudioContext()
        const buf = await ctxRef.current.decodeAudioData(bytes.buffer.slice(0))
        const ch = buf.getChannelData(0)
        const g = estimateGenderFromPcm(ch, buf.sampleRate)
        if (seq === seqRef.current && g.gender) {
          setLastGender({ provider: voice.provider, voiceId: voice.voiceId, ...g })
          window.electronAPI.ttsTagVoiceGender?.({ provider: voice.provider, voiceId: voice.voiceId, gender: g.gender, f0: g.f0, confidence: g.confidence, source: 'f0' })?.catch?.(() => {})
        }
      } catch { /* decode failed — skip tagging */ }
    }
  }, [cleanup])

  return { play, state, lastGender }
}
