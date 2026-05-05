export default function Playhead({ positionPx }) {
  return (
    <div
      className="atl-playhead"
      style={{
        left: positionPx,
        top: 0,
        bottom: 0,
      }}
    >
      <div className="atl-playhead-handle" />
      <div className="atl-playhead-line" />
    </div>
  )
}
