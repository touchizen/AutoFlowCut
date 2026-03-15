/**
 * InfinityLoader — 무한대(∞) 경로를 따라 빛이 이동하는 로더
 */

export default function InfinityLoader({ size = 36 }) {
  const w = size
  const h = size * 0.5
  const cx = w / 2
  const cy = h / 2
  const rx = w * 0.22
  const ry = h * 0.38
  const path = [
    `M ${cx} ${cy}`,
    `C ${cx + rx * 0.5} ${cy - ry}, ${cx + rx} ${cy - ry}, ${cx + rx} ${cy}`,
    `C ${cx + rx} ${cy + ry}, ${cx + rx * 0.5} ${cy + ry}, ${cx} ${cy}`,
    `C ${cx - rx * 0.5} ${cy - ry}, ${cx - rx} ${cy - ry}, ${cx - rx} ${cy}`,
    `C ${cx - rx} ${cy + ry}, ${cx - rx * 0.5} ${cy + ry}, ${cx} ${cy}`,
  ].join(' ')

  // 고유 gradient ID (여러 인스턴스 공존 가능)
  const gradId = `infinityGlow_${size}`

  return (
    <svg width={w} height={h} viewBox={`0 0 ${w} ${h}`} className="infinity-loader">
      <path d={path} fill="none" stroke="rgba(218,165,32,0.35)" strokeWidth="2" strokeLinecap="round" />
      <path
        d={path}
        fill="none"
        stroke={`url(#${gradId})`}
        strokeWidth="2.5"
        strokeLinecap="round"
        strokeDasharray="12 80"
        className="infinity-light"
      />
      <defs>
        <linearGradient id={gradId} x1="0%" y1="0%" x2="100%" y2="0%">
          <stop offset="0%" stopColor="transparent" />
          <stop offset="40%" stopColor="#60a5fa" />
          <stop offset="50%" stopColor="#ffffff" />
          <stop offset="60%" stopColor="#60a5fa" />
          <stop offset="100%" stopColor="transparent" />
        </linearGradient>
      </defs>
    </svg>
  )
}
