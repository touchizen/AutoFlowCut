import { useState, useRef, useCallback } from 'react'
import { estimateGenderFromPcm } from '../utils/voiceGender.js'

export function useVoicePreview() {
  const [state, setState] = useState({ voiceId: null, status: 'idle' })
  const [lastGender, setLastGender] = useState(null)
  const seqRef = useRef(0)
  const audioRef = useRef(null)
  const ctxRef = useRef(null)

  const play = useCallback(async (voice) => {
    const seq = ++seqRef.current
    if (audioRef.current) { audioRef.current.pause(); audioRef.current = null }
    setState({ voiceId: voice.voiceId, status: 'loading' })
    let res
    try {
      res = await window.electronAPI.ttsPreviewVoice({ provider: voice.provider, voiceId: voice.voiceId, language: voice.language || 'ko' })
    } catch { if (seq === seqRef.current) setState({ voiceId: voice.voiceId, status: 'error' }); return }
    if (seq !== seqRef.current) return // stale
    if (!res || res.error) { setState({ voiceId: voice.voiceId, status: 'error' }); return }

    const bytes = Uint8Array.from(atob(res.audioBase64), (c) => c.charCodeAt(0))
    const audio = new Audio(URL.createObjectURL(new Blob([bytes], { type: res.mimeType })))
    audioRef.current = audio
    audio.onended = () => { if (seq === seqRef.current) setState({ voiceId: voice.voiceId, status: 'idle' }) }
    setState({ voiceId: voice.voiceId, status: 'playing' })
    audio.play().catch(() => {})

    // F0 gender only for non-fixed voices
    if (voice.genderSource !== 'adapter' && voice.genderSource !== 'seed') {
      try {
        if (!ctxRef.current) ctxRef.current = new AudioContext()
        const buf = await ctxRef.current.decodeAudioData(bytes.buffer.slice(0))
        const ch = buf.getChannelData(0)
        const g = estimateGenderFromPcm(ch, buf.sampleRate)
        if (seq === seqRef.current && g.gender) {
          setLastGender({ voiceId: voice.voiceId, ...g })
          window.electronAPI.ttsTagVoiceGender?.({ provider: voice.provider, voiceId: voice.voiceId, gender: g.gender, f0: g.f0, confidence: g.confidence, source: 'f0' })
        }
      } catch { /* decode failed — skip tagging */ }
    }
  }, [])

  return { play, state, lastGender }
}
