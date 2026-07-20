# Hardware-Accelerated Self-Render Design

## Goal

Use a bundled ffmpeg hardware H.264 encoder automatically when the current
platform/build exposes one, while preserving the existing libx264 command line
as the safe default and runtime fallback.

## Detection and selection

`electron/render/hardwareEncoder.js` owns detection. It invokes the resolved
bundled ffmpeg path with `-hide_banner -encoders`, captures the output once, and
memoizes the resulting promise in a module-level `Map` keyed by `ffmpegPath`.
Detection errors, spawn errors, and unknown platforms resolve to `null`.

Selection order:

- macOS: `h264_videotoolbox`
- Windows: `h264_nvenc`, `h264_qsv`, `h264_amf`
- Linux: `h264_nvenc`, `h264_qsv`

VAAPI is deliberately excluded. The current renderer uses complex filtergraph
output labels; VAAPI requires a device plus a hardware-frame upload in the
graph. Supporting it safely would require separate hardware/software graph
scripts for fallback and device discovery, which is outside this change.

## Codec mapping

`codecArgs(stage, graph, encoder)` remains the single codec argument builder.
Passing `null` produces the existing libx264 arrays without reordering.

- VideoToolbox: map CRF 0..51 inversely to `-q:v` 100..1 and output `yuv420p`.
- NVENC: `-preset p5 -rc vbr -cq <crf> -b:v 0`, output `yuv420p`.
- QSV: `-preset <render preset> -global_quality <crf>`, output `nv12`.
- AMF: balanced CQP with the mapped CRF applied to I/P/B QP, output `nv12`.

Frame-rate arguments, video-only `-an`, final AAC arguments, and stream-copy
behavior remain unchanged.

## Runtime fallback

Each prepared encoding stage carries hardware arguments and, only when it
actually selects a hardware video codec, a software argument array. If the
hardware process fails, the runner deletes that stage's partial output, checks
cancellation, disables hardware for later stages in the render, and runs the
same stage once with the preserved libx264 arguments. A deletion failure stops
the render rather than allowing a partial file to be consumed. A second ffmpeg
failure is surfaced and normal artifact cleanup runs.

## Tests

- Pure selection tests cover platform priority, unavailable encoders, VAAPI
  exclusion, and unknown platforms.
- Detection tests cover exact command invocation, per-path memoization, and
  best-effort failure.
- Codec tests lock each mapping plus exact legacy libx264 arrays.
- Runner tests simulate hardware failure/successful fallback and both attempts
  failing, including deletion-before-retry and no destination rename on error.

