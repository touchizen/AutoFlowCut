/**
 * Partitions download-only items (Phase 0) by whether they require a consume gate call.
 *
 * - deniedRetry: items with errorKind === 'download-entitlement' — these were never charged
 *   (the consume was denied mid-batch). They MUST pass through the gate before re-downloading.
 * - plainRedownload: all other download-only items — save-failures that were already charged
 *   on their original batch run. They re-download for free, no gate needed.
 *
 * @param {Array} items - Array of download-only scene items
 * @returns {{ deniedRetry: Array, plainRedownload: Array }}
 */
export function partitionDownloadOnly(items) {
  const deniedRetry = []
  const plainRedownload = []
  for (const it of items) {
    if (it.errorKind === 'download-entitlement') {
      deniedRetry.push(it)
    } else {
      plainRedownload.push(it)
    }
  }
  return { deniedRetry, plainRedownload }
}
