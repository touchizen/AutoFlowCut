# Hardware-Accelerated Self-Render Design

## Goal

Use a bundled ffmpeg hardware H.264 encoder automatically when the current
platform/build exposes one, while preserving the existing libx264 command line
as the safe default and runtime fallback.

## Detection and selection

`electron/render/hardwareEncoder.js` owns detection. It first invokes the
resolved bundled ffmpeg path with `-hide_banner -encoders`, then probes compiled
platform candidates in priority order with a one-frame 64x64 lavfi encode using
the same quality and pixel-format arguments as a real render. The first encoder
whose probe exits successfully is returned. This rejects encoders that are
present in the build but cannot initialize on the host, including Intel
VideoToolbox builds that reject `-q:v`, while still allowing a lower-priority
Windows encoder to be selected when it opens successfully.

The in-flight detection promise is stored in a module-level `Map` keyed by
`ffmpegPath`, so concurrent renders share the same probe. Only a non-null result
remains cached. Listing/probe errors and timeouts resolve to `null` without
throwing and remove the cache entry so a later render can retry transient
driver/session failures.

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

The runner makes at most two complete stage passes. It first uses the probed
hardware encoder. If any hardware-encoded stage still fails at runtime, the
runner disables hardware, removes every stage output created by that pass,
clears stage path resolution, and restarts the stage loop at index zero using
libx264. This prevents hardware and software segments with different SPS/PPS
from reaching the concat-demuxer `-c copy` stage.

Output deletion is best-effort: `ENOENT` is ignored and Windows lock failures
are warned, after which the restarted ffmpeg command's existing `-y` overwrites
the controlled path. If the software pass fails, its error remains the surfaced
error and the original hardware error is attached as `cause`. Cancellation
never triggers a restart.

## Tests

- Pure selection tests cover platform priority, unavailable encoders, VAAPI
  exclusion, and unknown platforms.
- Detection tests cover exact list/probe command invocation, positive-result
  memoization, retry after a negative result, and best-effort failure.
- Codec tests lock each mapping plus exact legacy libx264 arrays.
- Runner tests simulate whole-pass software restart, segmented concat safety,
  later-stage downgrade, best-effort deletion, and both passes failing with the
  hardware error retained as `cause`.
