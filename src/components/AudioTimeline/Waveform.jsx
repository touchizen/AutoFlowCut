import { useMemo } from 'react'

// 합성 파형 (Phase 1) — 실제 PCM 분석은 추후
export default function Waveform({ color }) {
  const bars = useMemo(() => Array.from({ length: 32 }, (_, i) => {
    const h = 35 + Math.sin(i * 0.55) * 22 + Math.cos(i * 1.3) * 10 + Math.sin(i * 0.27) * 8
    return Math.max(18, Math.min(95, h))
  }), [])
  return (
    <div className="atl-waveform">
      {bars.map((h, i) => (
        <div key={i} style={{ height: `${h}%`, backgroundColor: color, opacity: 0.7 }} />
      ))}
    </div>
  )
}
