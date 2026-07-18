export function resolveFfmpegPath({ isPackaged, resourcesPath, appRoot, platform, arch }) {
  const exe = platform === 'win32' ? 'ffmpeg.exe' : 'ffmpeg'
  return isPackaged
    ? `${resourcesPath}/ffmpeg/${exe}`
    : `${appRoot}/vendor/ffmpeg/${platform}-${arch}/${exe}`
}
