export default function ImportProcessingOverlay({ processing, spinnerVisible, label }) {
  if (!processing) return null

  return (
    <div
      className={`import-processing-overlay${spinnerVisible ? ' is-visible' : ''}`}
      data-import-processing="true"
      role={spinnerVisible ? 'status' : undefined}
      aria-live={spinnerVisible ? 'polite' : undefined}
      aria-hidden={spinnerVisible ? undefined : 'true'}
    >
      <div className="import-processing-card">
        <div className="import-processing-spinner" aria-hidden="true" />
        <span>{label}</span>
      </div>
    </div>
  )
}
