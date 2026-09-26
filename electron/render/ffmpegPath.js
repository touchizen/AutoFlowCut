// 실제 packaged 여부 판정.
// patch-electron-name(scripts/patch-electron-name.cjs)이 dev에서 electron 바이너리를
// 'AutoFlowCut'으로 rename하면 basename !== 'electron' 이라 app.isPackaged가 dev인데도
// true로 오판된다. vite-plugin-electron이 dev에서만 세팅하는 VITE_DEV_SERVER_URL을 병행
// 신뢰 신호로 쓴다(electron/updater.js 와 동일 관습). → self-render가 dev에서 packaged
// 리소스 경로(Resources/ffmpeg)를 뒤지다 실패하던 버그를 막는다.
export function isRuntimePackaged({ appIsPackaged, viteDevServerUrl }) {
  return !!appIsPackaged && !viteDevServerUrl
}

export function resolveFfmpegPath({ isPackaged, resourcesPath, appRoot, platform, arch }) {
  const exe = platform === 'win32' ? 'ffmpeg.exe' : 'ffmpeg'
  return isPackaged
    ? `${resourcesPath}/ffmpeg/${exe}`
    : `${appRoot}/vendor/ffmpeg/${platform}-${arch}/${exe}`
}
