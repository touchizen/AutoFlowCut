// F0(기본주파수) 기반 성별 추정. autocorrelation로 프레임별 F0 → 중앙값 → 165Hz 이분.
// 순수 함수(브라우저/노드 무관). Web Audio decodeAudioData 결과의 채널 데이터를 받는다.

function frameF0(frame, sampleRate) {
  // RMS 게이트: 무음/무성 프레임 스킵
  let rms = 0
  for (let i = 0; i < frame.length; i++) rms += frame[i] * frame[i]
  rms = Math.sqrt(rms / frame.length)
  if (rms < 0.04) return null

  // 평균 제거
  let mean = 0
  for (let i = 0; i < frame.length; i++) mean += frame[i]
  mean /= frame.length

  const minLag = Math.floor(sampleRate / 400) // 400Hz
  const maxLag = Math.floor(sampleRate / 80)  // 80Hz
  let ac0 = 0
  for (let i = 0; i < frame.length; i++) { const v = frame[i] - mean; ac0 += v * v }
  if (ac0 <= 0) return null

  let bestLag = -1
  let bestVal = 0
  for (let lag = minLag; lag <= maxLag && lag < frame.length; lag++) {
    let s = 0
    for (let i = 0; i + lag < frame.length; i++) s += (frame[i] - mean) * (frame[i + lag] - mean)
    if (s > bestVal) { bestVal = s; bestLag = lag }
  }
  if (bestLag < 0 || bestVal / ac0 < 0.3) return null // 약한 주기성 제외
  return sampleRate / bestLag
}

export function estimateGenderFromPcm(samples, sampleRate) {
  const frameLen = Math.floor(0.04 * sampleRate) // 40ms
  const hop = Math.floor(0.02 * sampleRate)      // 20ms
  const f0s = []
  for (let i = 0; i + frameLen <= samples.length; i += hop) {
    const f0 = frameF0(samples.subarray(i, i + frameLen), sampleRate)
    if (f0 != null) f0s.push(f0)
  }
  if (f0s.length < 3) return { gender: null, f0: null, confidence: null }
  f0s.sort((a, b) => a - b)
  const f0 = f0s[Math.floor(f0s.length / 2)] // 중앙값
  const gender = f0 < 165 ? 'male' : 'female'
  const confidence = (f0 < 150 || f0 > 185) ? 'high' : 'low'
  return { gender, f0: Math.round(f0), confidence }
}
