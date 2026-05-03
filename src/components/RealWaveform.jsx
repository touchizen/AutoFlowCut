/**
 * RealWaveform - 오디오 파일 디코드 후 진짜 waveform 렌더
 *
 * Web Audio API의 decodeAudioData로 PCM 추출 → 다운샘플 → 막대 그래프
 * 모달처럼 한 번에 하나만 띄우는 곳에 사용 (디코드 비용 ~50-200ms)
 */

import { useState, useEffect, useRef } from 'react'

const BAR_COUNT = 120
const BAR_GAP = 1

export default function RealWaveform({ filePath, color = '#4FC3F7', height = 64, progress = 0 }) {
  const [bars, setBars] = useState(null) // null = loading, [] = error
  const cancelRef = useRef(false)

  useEffect(() => {
    cancelRef.current = false
    if (!filePath) { setBars([]); return }

    setBars(null)

    const decode = async () => {
      try {
        const result = await window.electronAPI?.readFileAbsolute({ filePath })
        if (cancelRef.current) return
        if (!result?.success || !result.data) { setBars([]); return }

        // data URL → ArrayBuffer
        const base64 = result.data.split(',')[1]
        const binary = atob(base64)
        const buffer = new Uint8Array(binary.length)
        for (let i = 0; i < binary.length; i++) buffer[i] = binary.charCodeAt(i)

        const ctx = new (window.AudioContext || window.webkitAudioContext)()
        const audioBuffer = await ctx.decodeAudioData(buffer.buffer)
        if (cancelRef.current) { ctx.close(); return }

        // 첫 채널 데이터 가져와서 BAR_COUNT개 버킷으로 다운샘플 (peak)
        const channel = audioBuffer.getChannelData(0)
        const bucketSize = Math.floor(channel.length / BAR_COUNT)
        const peaks = new Array(BAR_COUNT)
        let maxPeak = 0
        for (let i = 0; i < BAR_COUNT; i++) {
          const start = i * bucketSize
          const end = Math.min(start + bucketSize, channel.length)
          let peak = 0
          for (let j = start; j < end; j++) {
            const v = Math.abs(channel[j])
            if (v > peak) peak = v
          }
          peaks[i] = peak
          if (peak > maxPeak) maxPeak = peak
        }

        // 정규화 (0~1) — 무음 파일 안전 처리
        const normalized = maxPeak > 0
          ? peaks.map(p => p / maxPeak)
          : peaks.map(() => 0)

        ctx.close()
        if (!cancelRef.current) setBars(normalized)
      } catch (err) {
        console.error('[RealWaveform] decode error:', filePath, err)
        if (!cancelRef.current) setBars([])
      }
    }
    decode()

    return () => { cancelRef.current = true }
  }, [filePath])

  if (bars === null) {
    return (
      <div className="real-waveform-loading" style={{ height, color }}>
        디코딩 중…
      </div>
    )
  }

  if (bars.length === 0) {
    return (
      <div className="real-waveform-error" style={{ height }}>
        파형을 불러올 수 없음
      </div>
    )
  }

  // 재생 진행도(0~1) → 어느 막대까지 "재생됨" 상태인지
  const playedIndex = Math.floor(progress * bars.length)

  return (
    <div className="real-waveform" style={{ height }}>
      {bars.map((amp, i) => {
        const played = i < playedIndex
        return (
          <div
            key={i}
            className={`real-waveform-bar${played ? ' played' : ''}`}
            style={{
              height: `${Math.max(2, amp * 100)}%`,
              backgroundColor: color,
              marginRight: i < bars.length - 1 ? BAR_GAP : 0,
              opacity: played ? 1 : 0.35,
            }}
          />
        )
      })}
    </div>
  )
}
