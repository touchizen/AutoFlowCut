/**
 * Electron IPC Handler - Flow API Operations
 *
 * Image generation, media fetch, reference upload, token management.
 * All operations use Flow page context (cookies, reCAPTCHA) via deps.
 */

import path from 'node:path'
import { net, screen } from 'electron'
import { computeOffscreenBounds } from '../offscreen-bounds.js'
import { formatGoogleApiError } from './googleApiError.js'
import { SUBMIT_PROBE, shouldProceed, SUBMIT_ENABLED_PROBE } from '../flow-submit-gate.js'
import { GENERATED_IMG_PROBE, planDomImageAssignments, clampImageBatchCount } from '../flow-media-collect.js'
import { createGenerationTimeout } from '../flow-generation-timeout.js'
import { COMPOSE_EDITOR_READY } from '../flow-compose-editor.js'
import { createMutex } from '../asyncMutex.js'
import { VIDEO_DOWNLOAD_TIMEOUT_MS, IMAGE_UPSCALE_TIMEOUT_MS } from '../flow-download-config.js'

/**
 * Register all Flow API IPC handlers.
 *
 * @param {Electron.IpcMain} ipcMain
 * @param {object} deps - Shared dependencies injected from main process
 */
export function registerFlowAPIIPC(ipcMain, deps) {
  const {
    getFlowView, getMainWindow, trustedClickOnFlowView, sessionFetch, flowPageFetch,
    parseFlowResponse, getRecaptchaToken, extractMediaIds, extractFifeUrls,
    extractBase64Images, fetchMediaAsBase64, configureFlowMode, applyAgentDefaults, listAgentModels, ensureAgentOff, ensureAgentOn, selectFlowModeTab, ensureOnProjectComposer,
    getFlowAgentOn,
    getCapturedProjectId, setCapturedProjectId,
    getPendingGeneration, setPendingGeneration,
    pendingGenerations,
    getEnterToolClicked, setEnterToolClicked,
    setFlowPageInject, clearFlowPageInject,
    getCurrentMode,
    getApiBase, // #R33: region 대응 동적 API base (uploadImage 호스트)
    SESSION_URL, TOKEN_INFO_URL, FLOW_URL, MEDIA_REDIRECT_URL, UPLOAD_URL,
    API_HEADERS, GENERATE_URL, BASE_API_URL,
  } = deps

  // #R25-4: API 모드로 전환하면 flowView 인스턴스는 보존되므로(세션 유지) getFlowView() 만으론
  //   stale 렌더러 호출이 Flow quota 를 소비/상태변경할 수 있다. quota 를 쓰는 submit/upscale/upload
  //   핸들러는 현재 모드가 'flow' 일 때만 진행한다(읽기 전용 핸들러는 게이트 불필요).
  const flowActive = () => !getCurrentMode || getCurrentMode() === 'flow'

  // 에이전트 챗 DOM 에서 이미 수집(배정)한 생성 이미지 mediaId 집합.
  // 같은 이미지를 다른 generation 에 중복 배정하지 않게 한다. clear-generations 시 리셋.
  // main 이 공유 set 을 주입(character 동기 @멘션 수집과 공유) — 없으면 로컬(테스트).
  const collectedMediaIds = deps.collectedMediaIds || new Set()

  // R14-P1: DOM 비디오 다운로드 / 이미지 업스케일은 공유 Flow session 의 will-download 에 리스너를
  //   붙여 setSavePath 를 건다. 동시 실행 시 파일이 섞이므로(마지막 리스너가 가로챔) 이 mutex 로 직렬화.
  const downloadMutex = createMutex()

  // DOM 에서 생성 이미지(<img ...media.getMediaUrlRedirect?name=UUID>)를 제출 순서대로
  // 긁어, 아직 미배정인 것들을 "이미지가 필요한 pending generation"(제출 순서)에 1:1 매칭.
  // Flow 가 batchGenerateImages 를 안 쓰고 streamChat(SSE)로 이미지를 주므로 응답 가로채기
  // 대신 이 방식으로 수집한다.
  async function assignDomImagesToPending() {
    const flowView = getFlowView()
    if (!flowView) return
    let domImgs = []
    try {
      domImgs = await flowView.webContents.executeJavaScript(GENERATED_IMG_PROBE)
    } catch { return }
    if (!Array.isArray(domImgs) || domImgs.length === 0) return
    // 제출 순서대로 1:1 매칭. Agent-OFF 로 제출된 gen(allowDomFallback:false)은 intercept(fifeUrl)
    // 로 받으므로 여기서 제외 — 안 그러면 이전 Agent-OFF 씬의 DOM 잔상 이미지가 다음 gen 에
    // 잘못 재배정된다("첫 이미지가 둘째에도"). 매칭 로직은 planDomImageAssignments(단위테스트 보유).
    const assignments = planDomImageAssignments(domImgs, [...pendingGenerations.values()], collectedMediaIds)
    for (const { gen, img } of assignments) {
      collectedMediaIds.add(img.mediaId)
      gen.domImages = [img]
      gen.completed = true
      console.log('[Flow API] [DOM Collect] matched image', img.mediaId.slice(0, 8), '→ generation', (gen.generationId || '').slice(-8))
    }
  }

  // Extract Flow access token from session
  ipcMain.handle('flow:extract-token', async () => {
    console.log('[Flow API] extract-token called')
    // #R28-1: API 모드 전환 후에도 Flow view(=로그인 세션)는 보존되므로, gate 없으면 렌더러가
    //   계속 Flow bearer token 을 읽을 수 있다(fail-open). API 모드는 BYOK 키를 쓰지 Flow token 을
    //   안 쓰므로 mode 가 'flow' 일 때만 추출한다.
    if (!flowActive()) return { success: false, error: 'Flow inactive (API mode)' }
    const flowView = getFlowView()
    if (!flowView) return { success: false, error: 'Flow view not ready' }

    try {
      const sessionData = await flowView.webContents.executeJavaScript(`
        fetch('${SESSION_URL}')
          .then(r => r.ok ? r.text() : null)
          .catch(() => null)
      `)

      console.log('[Flow API] Session response (first 300):', sessionData?.substring(0, 300))

      if (!sessionData) {
        return { success: false, error: 'No session data. Please log in to Flow first.' }
      }

      // XSSI prefix 제거 후 JSON 파싱
      const parsed = parseFlowResponse(sessionData) || JSON.parse(sessionData)
      console.log('[Flow API] Session keys:', Object.keys(parsed || {}))

      const token = parsed?.access_token || parsed?.accessToken || null

      if (token) {
        console.log('[Flow API] Token extracted, length:', token.length)
        return { success: true, token, length: token.length }
      }
      console.warn('[Flow API] No token in session data')
      return { success: false, error: 'No token found. Please log in to Flow first.' }
    } catch (e) {
      console.error('[Flow API] extract-token error:', e.message)
      return { success: false, error: e.message }
    }
  })

  // Extract projectId from Flow page URL
  // (capturedProjectId는 파일 상단에서 선언)

  ipcMain.handle('flow:extract-project-id', async (event, opts = {}) => {
    const flowView = getFlowView()
    if (!flowView) return { success: false, error: 'Flow view not ready' }
    // liveOnly: 캐시/JS 폴백 없이 "현재 URL 의 프로젝트"만 반환(아니면 null). drift 가드가 Flow 가
    //   home/landing 인데 cache==bound 인 경우를 on-bound 로 오인하지 않게 하려면 진짜 라이브가 필요.
    const { liveOnly = false } = opts || {}

    try {
      // 방법 1: 라이브 URL에서 추출 (project/UUID 패턴) — 캐시보다 우선.
      //   ⚠️ 캐시(capturedProjectId)를 먼저 반환하면, 생성 중 Flow 가 다른 프로젝트로 옮겨가도
      //   stale id 를 돌려줘 establish 가 갱신 id 를 못 잡는다(edce→b266 미반영 회귀). 라이브 URL 이
      //   프로젝트면 그게 authoritative — 캐시도 갱신한다. URL 이 프로젝트가 아닐 때만 캐시 폴백.
      const url = flowView.webContents.getURL()
      const match = url.match(/project\/([a-f0-9-]{36})/)
      if (match) {
        setCapturedProjectId(match[1])
        return { success: true, projectId: match[1] }
      }

      if (liveOnly) return { success: true, projectId: null }

      // URL 이 프로젝트가 아니면(home/landing 등) 직전 캡처값으로 폴백.
      if (getCapturedProjectId()) {
        return { success: true, projectId: getCapturedProjectId() }
      }

      // 방법 2: Flow 페이지의 JS 컨텍스트에서 추출
      const pid = await flowView.webContents.executeJavaScript(`
        (function() {
          // URL에서 projectId 추출
          let m = location.href.match(/project\\/([a-f0-9-]{36})/);
          if (m) return m[1];
          // __flowConfig 등 글로벌 변수에서 추출 시도
          try {
            let scripts = document.querySelectorAll('script');
            for (let s of scripts) {
              let match = s.textContent.match(/"projectId":"([a-f0-9-]{36})"/);
              if (match) return match[1];
            }
          } catch {}
          return null;
        })()
      `)
      if (pid) {
        setCapturedProjectId(pid)
        return { success: true, projectId: pid }
      }

      return { success: true, projectId: null }
    } catch (e) {
      return { success: false, error: e.message }
    }
  })

  // Get reCAPTCHA token from Flow page
  ipcMain.handle('flow:get-recaptcha-token', async () => {
    const token = await getRecaptchaToken()
    return { success: !!token, token }
  })

  // Apply Flow "에이전트 설정" panel defaults (image/video aspect+count+model) + 저장.
  // Called once before a generation batch starts.
  ipcMain.handle('flow:apply-agent-defaults', async (event, opts) => {
    console.log('[Flow API] apply-agent-defaults:', JSON.stringify(opts))
    return applyAgentDefaults(opts || {})
  })

  // 동적 모델 목록 — Flow 에이전트 설정 패널에서 이미지/비디오 모델 옵션을 긁어 반환.
  ipcMain.handle('flow:list-agent-models', async () => {
    if (!flowActive()) return { success: false, error: 'Flow inactive (API mode)' }
    return listAgentModels()
  })

  // Generate image via Flow API
  ipcMain.handle('flow:generate-image', async (event, {
    token, prompt, aspectRatio, seed, model, projectId, referenceImages, batchCount,
    asyncMode  // true: 제출만 하고 즉시 반환 (비동기 배치용)
  }) => {
    // promptLen — 본문은 안 찍는다(Sentry breadcrumb 로 사용자 콘텐츠가 새어나간다).
    console.log('[Flow API] generate-image:', { promptLen: prompt?.length ?? 0, model, aspectRatio, seed: (seed ?? 'random') })
    if (!prompt) return { success: false, error: 'No prompt' }
    if (!flowActive()) return { success: false, error: 'Flow inactive (API mode)' }  // #R25-4
    const flowView = getFlowView()
    if (!flowView) return { success: false, error: 'Flow view not ready' }

    // Codex #R4-4: enforce Flow page is on the TARGET project before DOM mutation.
    const projectCheck = await ensureOnProjectComposer(flowView, projectId)
    if (!projectCheck.ok) return { success: false, error: projectCheck.error }

    // Seed / aspectRatio / references → set in page via monkey-patch inject
    const _seedValue = typeof seed === 'number' && Number.isFinite(seed) ? seed : null
    const _aspectRatioEnum = (
      aspectRatio === '16:9' ? 'IMAGE_ASPECT_RATIO_LANDSCAPE'
        : aspectRatio === '9:16' ? 'IMAGE_ASPECT_RATIO_PORTRAIT'
          : null
    )

    // === DOM 자동화 + 네트워크 응답 인터셉트 ===
    // 페이지가 자체적으로 reCAPTCHA를 처리하므로 가장 안정적인 방법
    // R9-P2: async pending id 를 try 밖에 선언 — submit 성공 반환 전 throw 시 catch 에서
    //   pendingGenerations 의 stale entry 를 지우기 위함(try 안에 두면 catch 가 못 봄).
    let generationId = null
    // generationTimeout 도 try 밖 — finally 의 정리(clearTimeout)가 접근해야 한다(try 안에 두면
    //   finally 가 못 봐 'generationTimeout is not defined' ReferenceError). generationId 와 동일 이유.
    let generationTimeout = null
    // #R7-9: sync 모드가 소유한 pendingGeneration — click 실패/throw 정리에서 identity 가드.
    //   (동시 진행 중인 다른 sync 생성의 pending 을 무조건 null 로 지우지 않게.)
    let syncOwnPending = null
    try {
      console.log('[Flow API] [DOM+Net] Starting DOM-triggered generation')

      // 0. Flow 프로젝트 페이지 확인 (textarea가 있어야 DOM 자동화 가능)
      const currentUrl = flowView.webContents.getURL()
      console.log('[Flow API] [DOM+Net] Current Flow URL:', currentUrl)

      const hasProject = currentUrl.includes('/project/') || currentUrl.includes('/tools/flow/')
      // ⚠️ document.querySelector('textarea') 로 판정하면 안 된다 — Flow 는 숨은
      //   <textarea id="g-recaptcha-response"> 를 항상 갖고 있어 죽은 페이지(에러/랜딩)에서도
      //   true 가 된다. 그러면 아래 준비/부트스트랩 블록이 통째로 스킵되고, 컴포저가 없는 페이지에서
      //   ensureAgentOff 가 토글을 못 찾아 "Agent 를 OFF 로 못 바꿨다"는 엉뚱한 에러가 뜬다.
      //   COMPOSE_EDITOR_READY 는 Slate/보이는 contenteditable 만 인정한다(flow-compose-editor.js).
      const hasTextarea = await flowView.webContents.executeJavaScript(COMPOSE_EDITOR_READY).catch(() => false)

      console.log('[Flow API] [DOM+Net] hasProject:', hasProject, 'hasTextarea:', hasTextarea)

      if (!hasTextarea) {
        console.log('[Flow API] [DOM+Net] No textarea found — need to create/enter project')

        // Flow 랜딩 페이지면: Enter tool 버튼 클릭으로 프로젝트 생성
        if (!currentUrl.includes('/project/')) {
          // 이미 Flow 페이지가 아니면 로드
          if (!currentUrl.includes('labs.google/fx')) {
            console.log('[Flow API] Navigating to Flow...')
            await flowView.webContents.loadURL(FLOW_URL)
            await new Promise(r => setTimeout(r, 3000))
          }

          // Enter tool 버튼 찾기 + trusted click
          for (let attempt = 0; attempt < 8; attempt++) {
            if (attempt > 0) await new Promise(r => setTimeout(r, 2000))

            // 이미 프로젝트로 이동했는지 확인
            const checkUrl = flowView.webContents.getURL()
            if (checkUrl.includes('/project/')) {
              console.log('[Flow API] Already navigated to project:', checkUrl)
              break
            }

            // New Project 버튼 클릭 (AutoFlow: icon='add_2')
            const enterClicked = await flowView.webContents.executeJavaScript(`
              (function() {
                // XPath: add_2 아이콘 버튼 (AutoFlow 검증된 방식)
                try {
                  const xr = document.evaluate(
                    "//button[.//i[normalize-space(text())='add_2']] | (//button[.//i[normalize-space(.)='add_2']])",
                    document, null, XPathResult.FIRST_ORDERED_NODE_TYPE, null
                  );
                  if (xr.singleNodeValue) { xr.singleNodeValue.click(); return 'add_2_xpath'; }
                } catch {}

                const allButtons = document.querySelectorAll('button');
                // icon 'add_2' 또는 'add'
                for (const b of allButtons) {
                  const icons = b.querySelectorAll('i, span.material-icons, span.material-symbols-outlined');
                  for (const icon of icons) {
                    const t = icon.textContent.trim();
                    if (t === 'add_2' || t === 'add' || t === 'arrow_forward') {
                      b.click(); return 'icon_' + t;
                    }
                  }
                }
                // 텍스트 버튼
                for (const b of allButtons) {
                  const text = b.textContent.trim().toLowerCase();
                  if (['start', '시작', 'enter', 'new', '새로 만들기', '새 프로젝트', '새프로젝트'].some(k => text.includes(k))) {
                    b.click(); return 'text_' + text.substring(0, 30);
                  }
                }
                console.log('[DOM] Buttons:', allButtons.length, Array.from(allButtons).slice(0,10).map(b => b.textContent.trim().substring(0,30)));
                return null;
              })()
            `).catch(() => null)

            if (enterClicked) {
              console.log('[Flow API] Enter tool button clicked:', enterClicked)
              setEnterToolClicked(true) // 무한루프 방지

              // 프로젝트 생성 대기 (최대 15초)
              for (let w = 0; w < 30; w++) {
                await new Promise(r => setTimeout(r, 500))
                const projUrl = flowView.webContents.getURL()
                if (projUrl.includes('/project/')) {
                  const m = projUrl.match(/\/project\/([a-f0-9-]{36})/)
                  if (m) setCapturedProjectId(m[1])
                  console.log('[Flow API] Project created:', projUrl)
                  break
                }
              }
              break
            } else {
              console.log('[Flow API] Enter tool button not found, attempt', attempt + 1, '/ 8')
            }
          }
        }

        // 프로젝트 생성 후 textarea 재확인 (최대 10초)
        let textareaReady = false
        for (let w = 0; w < 10; w++) {
          await new Promise(r => setTimeout(r, 1000))
          textareaReady = await flowView.webContents.executeJavaScript(COMPOSE_EDITOR_READY).catch(() => false)
          if (textareaReady) {
            console.log('[Flow API] Textarea ready after project creation')
            break
          }
        }

        if (!textareaReady) {
          return { success: false, error: 'Flow project page not ready (no textarea found). Please check Flow tab.' }
        }
      }

      // 0.5. 토큰 자동 추출 (DOM 모드에서 token=null로 호출될 때)
      if (!token) {
        try {
          const sessionData = await flowView.webContents.executeJavaScript(
            `fetch('${SESSION_URL}').then(r => r.ok ? r.text() : null).catch(() => null)`
          )
          if (sessionData) {
            const parsed = parseFlowResponse(sessionData) || JSON.parse(sessionData)
            token = parsed?.access_token || parsed?.accessToken || null
            if (token) console.log('[Flow API] Auto-extracted token for media fetch, length:', token.length)
          }
        } catch (e) {
          console.warn('[Flow API] Token auto-extraction failed:', e.message)
        }
      }

      // 0.8. (제거됨) 옛 configureFlowMode 팝업메뉴 방식 — Flow 가 설정을 "에이전트 설정"
      // 패널로 옮기면서 이 셀렉터는 매번 mode_tab_not_found 로 5회 실패하며 페이지를
      // churn 시켰다. 배치 카운트는 configureFlowMode 로 전달한다(P2). 화면비/seed 는
      // monkey-patch(injectImageBatchBody) 주입이 보장하나, 모델은 현재 미반영(P2 —
      // configureFlowMode 확장 예정). applyAgentDefaults 호출은 주석처리됨.

      // 0.85. (v2) Flow 이미지 모델 적용 — 에이전트 설정 패널에서 선택(동적 모델 목록 반영).
      //   model 이 Flow 패널 모델명(예: 'Nano Banana 2')일 때만 의미가 있고, 매칭 실패 시 graceful
      //   (패널 열고 닫음). applyAgentDefaults 는 패널이 닫힌 것을 확인(panelClosed)하므로 이후 컴포즈
      //   주입을 가리지 않는다. 컴포즈 주입(아래) 전에 호출한다.
      if (model && applyAgentDefaults) {
        // #R34-fix(2): best-effort. 패널 미발견/필드 미적용은 생성을 막지 않는다(warn) — Agent OFF/첫 씬 등
        //   정상 상황에서도 패널이 없을 수 있어 하드 블록하면 생성 불가가 된다. applied:false 는 경고만.
        try {
          const _md = await applyAgentDefaults({ image: { model } })
          if (!_md?.success) console.warn('[Flow API] applyAgentDefaults(image model) not applied:', _md?.error)
          else if (_md.applied === false) console.warn('[Flow API] applyAgentDefaults(image model): panel found but model not applied')
        } catch (e) { console.warn('[Flow API] applyAgentDefaults(image model) error:', e.message) }
      }

      // 0.9. Inject pending values into Flow page (monkey-patch path)
      //   window.__autoflowcut_inject__ is read by the patched window.fetch on the page.
      // Monkey-patch: set inject state on page — #R15-5: arming 실패 시 중단(미주입 생성 방지).
      const _injRes = await setFlowPageInject?.({
        seed:        _seedValue,
        aspectRatio: _aspectRatioEnum,
        references:  referenceImages?.length > 0 ? referenceImages : null,
        i2v:         null,
      })
      if (_injRes && _injRes.success === false) {
        clearTimeout(generationTimeout)
        return { success: false, error: `Flow inject arming failed: ${_injRes.error || 'unknown'}`, retry: true }
      }

      // 1. 네트워크 응답 캡처 Promise 설정 (동기 모드만)
      // ★ pendingGeneration은 Generate 버튼 클릭 직후에 설정한다!
      //   프롬프트 주입 시 Slate의 input/change 이벤트가 Flow 자동생성을 트리거할 수 있음.
      //   pendingGeneration을 미리 설정하면 자동생성 응답이 캡처되고,
      //   실제 버튼 클릭의 응답은 무시되는 문제가 발생한다.
      let resolveGeneration = null
      // generationTimeout 은 try 밖(핸들러 상위)에 선언됨 — 여기서 재선언하면 try 블록에 그림자
      //   변수가 생겨 finally 의 정리가 다시 out-of-scope 가 된다. 여기선 할당만(아래 R8-P1 경로).
      let responsePromise = null
      if (!asyncMode) {
        // [R8-P1] 타이머는 여기서 만들지 않는다 — pendingGeneration 을 arm 한 직후(클릭 직전)에
        //   createGenerationTimeout 으로 만든다. 제출 게이트가 최대 180s 폴링할 수 있어, 여기서
        //   미리 만들면 클릭(네트워크 대기) 전에 120s 가 만료되어 (1) 응답 대기가 무방비 hang,
        //   (2) 만료 콜백이 그 사이 살아있는 다른 pending 을 지운다.
        responsePromise = new Promise((resolve) => {
          resolveGeneration = resolve
        })
      }

      // 2. 기존 blob URL 스냅샷 (fallback용)
      let existingBlobs = []
      try {
        existingBlobs = await flowView.webContents.executeJavaScript(
          `Array.from(document.querySelectorAll('img[src^="blob:"]')).map(img => img.src)`
        ) || []
      } catch {}

      // 2b. Agent ON(streamChat) 결과는 batchGenerateImages intercept 가 안 잡히고 DOM
      //   <img>(media.getMediaUrlRedirect?name=UUID)로만 온다. 동기 모드 수집을 위해 제출 "전"
      //   이미 떠 있는 생성 이미지 mediaId 를 스냅샷해, 제출 후 새로 나타난 것만 골라낸다.
      let existingGenMediaIds = []
      try {
        const _pre = await flowView.webContents.executeJavaScript(GENERATED_IMG_PROBE)
        if (Array.isArray(_pre)) existingGenMediaIds = _pre.map((i) => i && i.mediaId).filter(Boolean)
      } catch {}

      // 0.8. Agent 토글 — flowAgentOn(설정) 이면 ON(Maps 그라운딩/주소 기반, autoApprove),
      //   아니면 OFF(직접 생성 API batchGenerateImages, intercept 수집).
      const agentOn = !!(getFlowAgentOn && getFlowAgentOn())
      // ⚠️ agentOff 는 함수 스코프에 선언한다 — 아래 async arming 의 `allowDomFallback: !agentOff`
      //   가 이 변수를 읽기 때문. `if (!agentOn)` 블록 안에 `let` 으로 두면 블록 밖 arming 에서
      //   ReferenceError('agentOff is not defined')가 나 두 모드(ON/OFF) 모두 async submit 이
      //   arming 에서 throw 됐다. Agent ON 은 여기서 false 로 남아 allowDomFallback:true →
      //   streamChat DOM(media.getMediaUrlRedirect) 수집이 켜진다.
      let agentOff = false
      if (!agentOn) {
      try { const _r = await ensureAgentOff(); agentOff = !!(_r && _r.success) } catch (e) { console.warn('[Flow API] ensureAgentOff skipped:', e.message) }
      // [P1] Agent OFF 보장 실패 시 생성 중단(fail-closed) — Agent ON 이면 프롬프트가
      //   streamChat(SSE)으로 가서 직접 생성 API(batchGenerateImages) intercept 가 동작하지
      //   않아 빈/오염 결과가 된다. ensureAgentOff 는 already_off 도 success=true 이므로
      //   정상 케이스는 막지 않고 실패(토글 못 찾음/still ON)만 차단한다.
      if (!agentOff) {
        // R8-P1: 이 시점엔 아직 타이머를 만들지 않았으므로(arm 직후 생성) generationTimeout 은 null —
        //   방어적으로 정리만 한다(no-op). 타이머가 arm 후로 미뤄져 옛 R7-P2 오삭제 위험은 사라졌다.
        if (generationTimeout) clearTimeout(generationTimeout)
        return { success: false, error: 'Flow Agent 를 OFF 로 전환하지 못했습니다. Flow 가 "모든 미디어" 화면인지 확인한 뒤 다시 시도해주세요. (캐릭터/장면 탭에는 Agent 토글이 없어 실패할 수 있음)' }
      }
      // 0.82. 이미지 모드로 전환 — 비디오와 동일하게 configureFlowMode 가 컴포즈 칩 팝오버를
      //      열고 이미지 탭을 클릭한다 (모드 탭은 컴포즈 칩 팝오버 안에 있다). 이미지 모드를
      //      확실히 보장해야 batchGenerateImages(intercept) 경로로 가고 fifeUrl 다운로드가 동작한다.
      //      (Agent ON 이면 DOM getMediaUrlRedirect 로 빠져 다운로드 URL 이 달라짐.)
      //      [P2] 배치 카운트(batchCount)를 전달 — 안 넘기면 칩 팝오버가 x1 로 고정된다.
      // [보존] 옛 selectFlowModeTab 경로 — 팝오버를 안 열어 not_found 가능. 나중 대비 주석 유지.
      // try { await selectFlowModeTab('IMAGE') } catch (e) { console.warn('[Flow API] selectFlowModeTab skipped:', e.message) }
      let _modeRes = null
      try { _modeRes = await configureFlowMode('IMAGE', batchCount) } catch (e) { console.warn('[Flow API] configureFlowMode skipped:', e.message) }
      // #R30-1: 모드 전환이 (내부 재시도 소진 후) 명시적 {success:false} 면 컴포저가 반대 모드일 수
      //   있어 이미지 제출이 비디오 요청으로 나가 잘못된 quota 소비 + pending capture timeout 을
      //   유발한다 → 제출을 중단한다. (throw 는 기존대로 관용 — 모드 미확정이 아닐 수 있음.)
      if (_modeRes && _modeRes.success === false) {
        clearTimeout(generationTimeout)
        await clearFlowPageInject?.()
        return { success: false, error: `Flow IMAGE mode switch failed: ${_modeRes.error || 'unknown'}`, retry: true }
      }
      } else {
        // [Agent ON — Maps 그라운딩 / 주소 기반 생성] 토글 ON 유지 + autoApprove(에이전트가 안 묻고
        //   자동 생성). 위치/주소는 프롬프트에 포함한다. Agent ON 은 컴포즈 모드 탭이 없어
        //   configureFlowMode('IMAGE') 생략. ⚠️ 라이브 검증 필요(셀렉터/타이밍/streamChat DOM 수집).
        let onOk = false
        try { const _r = await ensureAgentOn(); onOk = !!(_r && _r.success) } catch (e) { console.warn('[Flow API] ensureAgentOn skipped:', e.message) }
        if (!onOk) {
          if (generationTimeout) clearTimeout(generationTimeout)
          return { success: false, error: 'Flow Agent 를 ON 으로 전환하지 못했습니다. Flow 컴포즈에 Agent 토글이 있는지 확인해주세요.' }
        }
        // 장수(count)+화면비도 함께 적용 — 안 넘기면 패널 기존값으로 생성된다.
        // #R33: Agent ON 은 streamChat 경로라 monkey-patch inject(imageAspectRatio)가 안 먹는다 →
        //   화면비(설정>씬)를 이 패널(aspectSuffix)로 적용. (Agent OFF 는 inject 로 처리.)
        // #R34-fix(2): best-effort(warn) — 패널 미발견/필드 미적용으로 생성을 막지 않는다.
        try {
          const _md = await applyAgentDefaults({ image: { model, count: clampImageBatchCount(batchCount), aspectRatio }, autoApprove: true })
          if (!_md?.success) console.warn('[Flow API] (Agent ON) applyAgentDefaults(image) not applied:', _md?.error)
          else if (_md.applied === false) console.warn('[Flow API] (Agent ON) applyAgentDefaults(image): panel found but not fully applied')
        } catch (e) { console.warn('[Flow API] (Agent ON) applyAgentDefaults(image) error:', e.message) }
        // Agent 추론이 영상으로 빠지지 않게 명시 지시 프리펜드(타입 강제). 주소/위치는 그대로 유지.
        prompt = `Generate a still image: ${prompt}`
        console.log('[Flow API] (Agent ON) image prompt prefixed for type forcing')
      }

      // 0.85. 제출 버튼/에디터 준비 대기 — 제출 페이싱의 메인 게이트. (프롬프트 주입 전!)
      // Flow 가 에이전트 챗 모델로 바뀌면서 이전 생성이 진행 중이면 제출 버튼이
      //   'arrow_forward'(준비) → 'stop'(중지) 으로 토글되고 컴포즈 에디터도 잠시 사라진다.
      // 따라서 "arrow_forward 가 enable 로 나타날 때까지"(= 에이전트가 다음 프롬프트를
      //   받을 준비) 폴링한 뒤에야 프롬프트를 주입/제출한다. 이게 빠지면 다음 씬이
      //   에디터가 없는 상태에서 주입하다 'Editor not found' 로 실패한다.
      // 상태: ready(arrow_forward enable) / disabled / busy(stop) / absent.
      {
        const SUBMIT_POLL = 1500
        const SUBMIT_MAX_WAIT = 180000  // 에이전트 생성이 길 수 있어 최대 3분
        // 게이트 판정 로직은 flow-submit-gate.js (jsdom 단위테스트 보유). SUBMIT_PROBE 는
        // 그 classifyAgentState 를 그대로 페이지에 주입한 것 — 단일 소스.
        let submitState = 'absent'
        let waited = 0
        while (waited <= SUBMIT_MAX_WAIT) {
          submitState = await flowView.webContents.executeJavaScript(SUBMIT_PROBE).catch(() => 'error')
          if (shouldProceed(submitState)) break
          if (waited === 0) {
            console.log('[Flow API] [DOM+Net] Agent not idle (state=' + submitState + ') — polling until ready to accept prompt (max 180s)...')
          }
          await new Promise(r => setTimeout(r, SUBMIT_POLL))
          waited += SUBMIT_POLL
        }
        if (submitState !== 'idle') {
          clearTimeout(generationTimeout)
          console.warn('[Flow API] [DOM+Net] Agent never idle (last state=' + submitState + ', waited ' + Math.round(waited / 1000) + 's)')
          return { success: false, error: 'Agent not ready (' + submitState + ') after 180s', retry: true }
        }
        if (waited > 0) console.log('[Flow API] [DOM+Net] Agent idle after', Math.round(waited / 1000), 's — proceeding to inject')
      }

      // 3. 프롬프트 입력 (Slate.js 에디터 — AutoFlow 역공학)
      // execCommand 방식이 작동하려면 flowView가 보여야 함 (focus 필요)
      const mainWindow = getMainWindow()
      const promptBounds = flowView.getBounds()
      const promptWasHidden = (promptBounds.width === 0 || promptBounds.height === 0)
      if (promptWasHidden) {
        const { width, height } = mainWindow.getContentBounds()
        // 모든 디스플레이 너머로 — 멀티모니터에서 보조 모니터에 Flow 가 깜빡이지 않게.
        flowView.setBounds(computeOffscreenBounds(screen.getAllDisplays(), mainWindow.getBounds().x, width, height))
        await new Promise(r => setTimeout(r, 300))
        console.log('[Flow API] Temporarily showed flowView (offscreen) for Slate injection')
      }

      // #R6-13: 임시로 보인 flowView 의 bounds 는 주입이 중간에 throw 해도 finally 에서
      //   반드시 원복한다 — 안 그러면 off-screen(width+5000)으로 보인 채 leak 된다.
      let promptResult
      try {
      // WebContentsView 에 OS 포커스를 준다. 이게 없으면 editor.focus() 가 무시되고
      // (document.hasFocus()=false) execCommand('insertText') 가 no-op 이 되어
      // 프롬프트가 컴포즈에 안 박힌다 — 특히 applyAgentDefaults 가 패널을 열고 닫은
      // (Escape 로 포커스가 body 로 빠진) 직후의 첫 제출에서 발생.
      try { flowView.webContents.focus() } catch (e) { console.warn('[Flow API] webContents.focus failed:', e.message) }
      await new Promise(r => setTimeout(r, 120))

      // 에디터를 trusted click(실제 마우스 클릭)으로 포커스/캐럿 삽입.
      // webContents.focus()/editor.focus() 만으론 Slate 가 포커스를 안 받는 경우가 있어
      // 실제 클릭으로 캐럿을 넣어야 execCommand('insertText') 가 동작한다.
      // 뷰가 이미 보이는 상태(위에서 show)라 trustedClick 이 끝나도 다시 숨기지 않는다.
      const editorFocusSelector = `(function(){
        return document.querySelector("[data-slate-editor='true']")
          || document.querySelector("div[role='textbox'][contenteditable='true']:not(#af-bot-panel *)")
          || document.querySelector('[contenteditable="true"]:not([aria-hidden])')
          || document.querySelector('textarea');
      })()`
      try {
        const ef = await trustedClickOnFlowView(editorFocusSelector)
        console.log('[Flow API] [DOM+Net] Editor focus click:', ef?.success, ef?.coords ? '@' + ef.coords.x + ',' + ef.coords.y : '')
      } catch (e) { console.warn('[Flow API] editor focus click failed:', e.message) }
      await new Promise(r => setTimeout(r, 120))

      promptResult = await flowView.webContents.executeJavaScript(`
        (async function() {
          const promptText = ${JSON.stringify(prompt)};
          const sleep = (ms) => new Promise(r => setTimeout(r, ms));

          // Slate editor 찾기
          let editor = document.querySelector("[data-slate-editor='true']");
          if (!editor) editor = document.querySelector("div[role='textbox'][contenteditable='true']:not(#af-bot-panel *)");
          if (!editor) editor = document.querySelector('[contenteditable="true"]:not([aria-hidden])');

          if (!editor) {
            return { success: false, error: 'Editor not found' };
          }

          const isSlate = !!(editor.matches?.("[data-slate-editor='true']") || editor.querySelector?.("[data-slate-node]"));
          console.log('[Prompt] Editor found, isSlate:', isSlate, 'tag:', editor.tagName);

          // ==== 방법 1: Slate React API — editor.apply() ====
          let slateSuccess = false;
          if (isSlate) {
            try {
              const reactKeys = Object.keys(editor).filter(k => k.startsWith('__react'));
              let slateEditor = null;
              for (const key of reactKeys) {
                const stack = [editor[key]];
                const visited = new Set();
                let guard = 0;
                while (stack.length > 0 && guard < 5000) {
                  const node = stack.pop();
                  guard++;
                  if (!node || typeof node !== 'object' || visited.has(node)) continue;
                  visited.add(node);
                  const candidate =
                    node?.memoizedProps?.node || node?.memoizedProps?.editor ||
                    node?.pendingProps?.node || node?.pendingProps?.editor ||
                    node?.stateNode?.editor || node?.editor;
                  if (candidate && typeof candidate.apply === 'function') {
                    slateEditor = candidate;
                    break;
                  }
                  if (node.child) stack.push(node.child);
                  if (node.sibling) stack.push(node.sibling);
                  if (node.return) stack.push(node.return);
                  if (node.alternate) stack.push(node.alternate);
                }
                if (slateEditor) break;
              }

              if (slateEditor) {
                console.log('[Prompt] Found Slate editor via React fiber');
                // 기존 텍스트 삭제
                try {
                  const existingText = slateEditor.children?.[0]?.children?.[0]?.text || '';
                  if (existingText) {
                    slateEditor.apply({ type: 'remove_text', path: [0, 0], offset: 0, text: existingText });
                  }
                } catch (e) { console.log('[Prompt] remove_text failed (ok):', e.message); }

                // 새 텍스트 삽입
                slateEditor.apply({ type: 'insert_text', path: [0, 0], offset: 0, text: promptText });
                if (typeof slateEditor.onChange === 'function') slateEditor.onChange();
                editor.dispatchEvent(new Event('input', { bubbles: true }));
                editor.dispatchEvent(new Event('change', { bubbles: true }));
                await sleep(200);

                // 검증
                const modelText = (slateEditor.children?.[0]?.children?.[0]?.text || '').trim();
                if (modelText && modelText.includes(promptText.slice(0, 40))) {
                  console.log('[Prompt] Slate API verified OK');
                  slateSuccess = true;
                }
              }
            } catch (e) { console.log('[Prompt] Slate API failed:', e.message); }
          }

          // ==== 방법 2: document.execCommand('insertText') ====
          if (!slateSuccess) {
            console.log('[Prompt] Trying execCommand insertText...');
            try {
              editor.focus();
              editor.click();
              await sleep(100);

              if (isSlate) {
                const sel = window.getSelection();
                const range = document.createRange();
                const stringNodes = Array.from(editor.querySelectorAll('[data-slate-string]'))
                  .map(n => n.firstChild).filter(n => n && n.nodeType === Node.TEXT_NODE);
                if (stringNodes.length > 0) {
                  range.setStart(stringNodes[0], 0);
                  const last = stringNodes[stringNodes.length - 1];
                  range.setEnd(last, (last.textContent || '').length);
                } else {
                  const zeroNode = Array.from(editor.querySelectorAll('[data-slate-zero-width]'))
                    .map(n => n.firstChild).find(n => n && n.nodeType === Node.TEXT_NODE);
                  if (zeroNode) { range.setStart(zeroNode, 0); range.setEnd(zeroNode, (zeroNode.textContent || '').length); }
                  else { range.selectNodeContents(editor); }
                }
                sel.removeAllRanges();
                sel.addRange(range);
              } else {
                document.execCommand('selectAll', false, null);
              }

              document.execCommand('delete', false, null);
              await sleep(50);

              try {
                editor.dispatchEvent(new InputEvent('beforeinput', {
                  bubbles: true, cancelable: true, inputType: 'insertText', data: promptText
                }));
              } catch {}

              const inserted = document.execCommand('insertText', false, promptText);
              if (inserted) {
                try { editor.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertText', data: promptText })); } catch {}
                await sleep(200);
                const hasText = !!editor.querySelector?.('[data-slate-string]');
                const visibleText = (editor.innerText || editor.textContent || '').trim();
                if (hasText || visibleText.includes(promptText.slice(0, 20))) {
                  console.log('[Prompt] execCommand verified OK');
                  slateSuccess = true;
                }
              }
            } catch (e) { console.log('[Prompt] execCommand failed:', e.message); }
          }

          // ==== 방법 3: textarea fallback (Slate가 아닌 경우) ====
          if (!slateSuccess && !isSlate) {
            try {
              const tag = editor.tagName.toLowerCase();
              if (tag === 'textarea' || tag === 'input') {
                const setter = Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, 'value')?.set;
                if (setter) {
                  setter.call(editor, '');
                  editor.dispatchEvent(new Event('input', { bubbles: true }));
                  setter.call(editor, promptText);
                  editor.dispatchEvent(new InputEvent('input', { bubbles: true, data: promptText }));
                  slateSuccess = true;
                }
              }
            } catch (e) { console.log('[Prompt] textarea setter failed:', e.message); }
          }

          if (!slateSuccess) return { success: false, error: 'All prompt injection methods failed' };
          await sleep(500);

          // Generate 버튼 disabled 체크
          try {
            const xr = document.evaluate("//button[.//i[text()='arrow_forward']]",
              document, null, XPathResult.FIRST_ORDERED_NODE_TYPE, null);
            if (xr.singleNodeValue?.disabled) {
              return { success: false, error: 'Generate button disabled after injection', retry: true };
            }
          } catch {}

          return { success: true };
        })()
      `)

      } finally {
        // #R6-13: 주입 성공/실패/throw 와 무관하게 임시로 보인 flowView 를 원복.
        if (promptWasHidden) {
          flowView.setBounds(promptBounds)
          await new Promise(r => setTimeout(r, 200))
        }
      }

      console.log('[Flow API] [DOM+Net] Prompt injection result:', promptResult)
      if (!promptResult?.success) {
        clearTimeout(generationTimeout)
        return { success: false, error: promptResult?.error || 'Prompt injection failed' }
      }

      // 진단: 주입 직후 에디터 실제 내용 + 포커스 + 제출버튼 상태 확인
      // (제출버튼이 disabled 로 남으면 = 컴포즈에 텍스트가 안 박힌 것)
      try {
        const diag = await flowView.webContents.executeJavaScript(`
          (function() {
            const ed = document.querySelector("[data-slate-editor='true']")
              || document.querySelector("div[role='textbox'][contenteditable='true']:not(#af-bot-panel *)")
              || document.querySelector('[contenteditable="true"]:not([aria-hidden])')
              || document.querySelector('textarea');
            const ae = document.activeElement;
            const fwd = (function(){
              for (const b of document.querySelectorAll('button'))
                for (const i of b.querySelectorAll("i, [class*='material-symbols'], [class*='google-symbols']"))
                  if ((i.textContent||'').trim()==='arrow_forward') return b;
              return null;
            })();
            return {
              editorFound: !!ed,
              editorText: ed ? (ed.value !== undefined ? ed.value : ed.textContent || '').trim().slice(0, 60) : null,
              activeEl: ae ? (ae.tagName.toLowerCase() + (ae.getAttribute && ae.getAttribute('contenteditable') ? '[ce]' : '')) : null,
              editorIsActive: ed === ae,
              fwdDisabled: fwd ? (fwd.disabled || fwd.getAttribute('aria-disabled')==='true') : 'no_fwd',
            };
          })()
        `).catch((e) => ({ error: e.message }))
        console.log('[Flow API] [DOM+Net] Post-inject diag:', JSON.stringify(diag))
      } catch {}

      // 4. Generate 버튼 찾기 + Trusted Click
      // b.click()은 isTrusted: false라서 Flow 페이지가 무시함
      // → flowView를 일시적으로 보이게 한 후 sendInputEvent로 trusted click

      // 4-pre. 주입 "후" 가드: 제출버튼이 실제로 enable(프롬프트 인식됨) 됐는지 확인하고
      // 나서만 클릭한다. 빈/disabled 상태에서 클릭하면 잘못된/중복 동작이 될 수 있어
      // 방어한다. 판정은 flow-submit-gate.isSubmitEnabled (단위테스트 보유).
      {
        const ENABLE_POLL = 1000
        const ENABLE_MAX_WAIT = 20000  // 주입 반영은 보통 즉시 — 최대 20초
        let enabled = false
        let ew = 0
        while (ew <= ENABLE_MAX_WAIT) {
          enabled = await flowView.webContents.executeJavaScript(SUBMIT_ENABLED_PROBE).catch(() => false)
          if (enabled) break
          await new Promise(r => setTimeout(r, ENABLE_POLL))
          ew += ENABLE_POLL
        }
        if (!enabled) {
          clearTimeout(generationTimeout)
          console.warn('[Flow API] [DOM+Net] Submit button not enabled after inject (prompt may not have registered) — aborting submit')
          return { success: false, error: 'Submit button not enabled after prompt injection', retry: true }
        }
        console.log('[Flow API] [DOM+Net] Submit button enabled — proceeding to click', ew > 0 ? '(after ' + Math.round(ew / 1000) + 's)' : '')
      }

      // Trusted click via sendInputEvent (flowView를 일시적으로 보이게)
      // JS 셀렉터: XPath로 arrow_forward 버튼 찾기
      const generateBtnSelector = `(function() {
        try {
          const xr = document.evaluate(
            "//button[.//i[text()='arrow_forward']]",
            document, null, XPathResult.FIRST_ORDERED_NODE_TYPE, null
          );
          if (xr.singleNodeValue && !xr.singleNodeValue.disabled) return xr.singleNodeValue;
        } catch {}
        // fallback: icon 이름으로
        for (const b of document.querySelectorAll('button')) {
          for (const icon of b.querySelectorAll('i')) {
            if (icon.textContent.trim() === 'arrow_forward' && !b.disabled) return b;
          }
        }
        return null;
      })()`

      // R6-P2: pending 을 클릭 "직전"에 arm + backdate 제거(setAt = now). arm-after-click + backdate(-2s)
      //   는 직전 유사 요청의 늦은 응답이 2초 창 안에 새 pending 에 붙는 stale 버그가 있었다.
      //   arm-before-click 이라 클릭으로 시작될 요청의 reqStartedAt >= setAt 이 보장된다.
      //   클릭 실패 시 arm 한 pending 을 반드시 삭제한다(고아 pending 방지).
      const generationSetAt = Date.now() / 1000
      // generationId 는 위(try 밖)에서 선언됨 — 여기서 재선언하지 않는다(catch 정리용).

      if (asyncMode) {
        // === 비동기 모드: pendingGenerations Map에 등록 ===
        // 제출 전 이미 DOM 에 떠 있던 결과 이미지(이전 런 잔상/캐릭터)는 이 gen 의 DOM 매칭에서
        //   제외한다 — 안 그러면 fresh 세션(collectedMediaIds 빈 상태)에서 첫 폴링이 가장 오래된
        //   잔상 이미지를 이 gen 에 잘못 배정해, 첫 씬에 "이미 생성한 옛 이미지"가 들어가고 진짜
        //   새 결과는 버려진다. (동기 경로의 existingGenMediaIds 스냅샷과 동일 목적.)
        for (const _mid of existingGenMediaIds) collectedMediaIds.add(_mid)
        generationId = `gen-${Date.now()}-${Math.random().toString(36).substring(2, 8)}`
        pendingGenerations.set(generationId, {
          setAt: generationSetAt,
          // R9-P1: arm 시 expectedCount 를 batchCount 로 확정 — 클릭 후 DOM 갱신을 기다리는
          //   사이 첫 응답이 와도 1/N 로 조기완료되어 나머지가 버려지는 것을 막는다.
          expectedCount: clampImageBatchCount(batchCount),
          responses: [],
          collectionTimer: null,
          completed: false,
          token,              // 나중에 이미지 fetch용
          // Agent OFF 로 제출됐으면 intercept(fifeUrl)로 받으므로 DOM 폴백 제외 — 이전 씬의
          // DOM 잔상 이미지가 이 gen 으로 잘못 재배정되는 것을 막는다. OFF 불확실(토글 못 찾음/
          // still ON)이면 Agent ON 가능성이 있으므로 DOM 폴백을 안전망으로 남긴다.
          allowDomFallback: !agentOff,
          // 응답↔gen 상관키 (generationMatch.js) — 요청 body 의 prompt/refs/seed/aspectRatio 와 대조
          promptKey: prompt,
          refMediaIds: Array.isArray(referenceImages)
            ? referenceImages.map((r) => r?.mediaId).filter(Boolean).sort()
            : [],
          reqSeed: _seedValue,
          reqAspectRatio: _aspectRatioEnum
        })
        // #R12-12/#R13-3: owner orphan TTL — 렌더러가 크래시/폴링 중단해 collect/clear 가 안 오면
        //   entry 가 영구 누수된다. 충분히 긴 TTL(10분) 후 자동 제거. 이 타이머는 collectionTimer 와
        //   별개(orphanTimer)다 — reportResponseRouter 가 응답 완료 시 collectionTimer 만 clear 하므로
        //   완료된 entry 도 collect/clear 전까지 orphanTimer 가 살아 누수를 막는다.
        {
          const _g = pendingGenerations.get(generationId)
          if (_g) {
            _g.orphanTimer = setTimeout(() => {
              if (pendingGenerations.get(generationId) === _g) {
                pendingGenerations.delete(generationId)
                console.warn('[Flow API] [Async] pendingGeneration orphan TTL expired — removed:', generationId)
              }
            }, 10 * 60 * 1000)
          }
        }
        console.log('[Flow API] [Async] pendingGenerations set:', generationId,
          '(setAt:', generationSetAt.toFixed(3), ')')
      } else {
        // === 동기 모드: 기존 pendingGeneration 설정 ===
        const pendingObj = {
          setAt: generationSetAt,
          // R9-P1: arm 시 expectedCount 를 batchCount 로 확정(멀티 이미지 조기완료 방지).
          expectedCount: clampImageBatchCount(batchCount),
          responses: [],
          collectionTimer: null,
          resolve: (result) => {
            clearTimeout(generationTimeout)
            const pg = getPendingGeneration()
            if (pg?.collectionTimer) clearTimeout(pg.collectionTimer)
            resolveGeneration(result)
          }
        }
        syncOwnPending = pendingObj
        setPendingGeneration(pendingObj)
        // [R8-P1] 응답 대기 타임아웃은 arm 직후(클릭 직전)에 시작 — 제출 게이트(최대 180s) 통과 후라
        //   타이머가 실제 네트워크 대기 구간만 바운드한다. 자기 pending(pendingObj)만 identity 로 정리.
        generationTimeout = createGenerationTimeout({
          ownPending: pendingObj,
          getPending: getPendingGeneration,
          setPending: setPendingGeneration,
          resolve: resolveGeneration,
        })
        console.log('[Flow API] [DOM+Net] pendingGeneration armed BEFORE click (setAt:',
          generationSetAt.toFixed(3), ')')
      }

      // pending arm 직후 클릭 — 클릭이 batchGenerateImages 를 트리거한다(arm 이 먼저라 미스 없음).
      const clickResult = await trustedClickOnFlowView(generateBtnSelector)
      console.log('[Flow API] [DOM+Net] Trusted click result:', clickResult)
      if (!clickResult?.success) {
        clearTimeout(generationTimeout)
        // R6-P2: arm 한 pending 삭제(고아 방지) — 다음 생성이 이 pending 에 잘못 붙지 않게.
        // #R7-9: sync 는 자기 pending(identity)일 때만 클리어 — 동시 sync 생성 보호.
        // #R14-9: async 삭제 전 orphanTimer/collectionTimer 정리(타이머 누수 방지).
        if (asyncMode) {
          if (generationId) {
            const _ag = pendingGenerations.get(generationId)
            if (_ag?.orphanTimer) clearTimeout(_ag.orphanTimer)
            if (_ag?.collectionTimer) clearTimeout(_ag.collectionTimer)
            pendingGenerations.delete(generationId)
          }
        }
        else if (getPendingGeneration() === syncOwnPending) setPendingGeneration(null)
        return { success: false, error: clickResult?.error || 'Failed to click Generate button' }
      }

      // 예상 이미지 개수 감지 (x1/x2/x3/x4 선택 버튼에서)
      let expectedImageCount = 1
      try {
        expectedImageCount = await flowView.webContents.executeJavaScript(`
          (function() {
            // 방법 1: x1/x2/x3/x4 버튼에서 선택된 것 찾기
            const btns = Array.from(document.querySelectorAll('button'));
            const countBtns = btns.filter(b => /^x[1-4]$/.test(b.textContent.trim()));
            if (countBtns.length > 0) {
              for (const btn of countBtns) {
                const style = getComputedStyle(btn);
                const bg = style.backgroundColor;
                const isSelected = btn.getAttribute('aria-pressed') === 'true'
                  || btn.getAttribute('aria-selected') === 'true'
                  || btn.classList.contains('selected')
                  || btn.classList.contains('active')
                  || (bg && bg !== 'rgba(0, 0, 0, 0)' && bg !== 'transparent'
                      && !bg.includes('0.') && bg !== 'rgb(0, 0, 0)');
                if (isSelected) {
                  console.log('[DOM] Detected selected image count button:', btn.textContent.trim(), 'bg:', bg);
                  return parseInt(btn.textContent.trim().replace('x', ''));
                }
              }
              console.log('[DOM] Count buttons found but no selected state detected, checking generate button text');
            }

            // 방법 2: Generate 버튼 텍스트에서 "x2", "x3", "x4" 추출
            for (const btn of btns) {
              const text = btn.textContent || '';
              const match = text.match(/x([2-4])/);
              if (match && (text.includes('arrow_forward') || text.includes('Nano') || text.includes('Imagen'))) {
                console.log('[DOM] Detected image count from generate button text:', match[1]);
                return parseInt(match[1]);
              }
            }

            return 1;
          })()
        `) || 1
      } catch (e) {
        console.warn('[Flow API] Failed to detect image count from DOM:', e.message)
        expectedImageCount = 1
      }

      // expectedCount 업데이트 — R9-P1: DOM 감지값으로 "올리기만" 한다(낮추면 조기완료 위험).
      //   arm 때 batchCount 로 이미 확정했으므로, 감지 실패(=1)나 과소감지가 덮어쓰지 못하게 max.
      if (asyncMode) {
        const ag = pendingGenerations.get(generationId)
        if (ag) ag.expectedCount = Math.max(ag.expectedCount, expectedImageCount)
        console.log('[Flow API] [Async] expectedCount updated to', ag ? ag.expectedCount : expectedImageCount,
          'for gen:', generationId)

        // 비동기 모드: inject 정리 후 즉시 반환
        await new Promise(r => setTimeout(r, 2000))  // 요청이 나갈 시간 확보
        await clearFlowPageInject?.()
        return { success: true, generationId, submitted: true }
      }

      // === 동기 모드: 기존 대기 로직 ===
      const pg = getPendingGeneration()
      if (pg) {
        pg.expectedCount = Math.max(pg.expectedCount, expectedImageCount)  // R9-P1: 올리기만
      }
      console.log('[Flow API] [DOM+Net] expectedCount updated to', expectedImageCount,
        ', waiting for API response(s)...')

      // 4-A. Agent ON(동기): streamChat 결과는 intercept 가 없으므로 응답 대기 대신 DOM 에
      //   새 생성 이미지(media.getMediaUrlRedirect?name=UUID)가 뜰 때까지 폴링해 수집한다.
      //   (제출 전 스냅샷 existingGenMediaIds 에 없는 = 이번 생성분만 골라 src 를 그대로 fetch.)
      if (agentOn) {
        const want = Math.max(1, expectedImageCount)
        const POLL_MS = 2000
        const MAX_WAIT = 180000  // Agent(Maps 그라운딩) 생성이 길 수 있음
        let waited = 0
        let lastFresh = []
        while (waited < MAX_WAIT) {
          await new Promise((r) => setTimeout(r, POLL_MS))
          waited += POLL_MS
          let imgs = []
          try { imgs = await flowView.webContents.executeJavaScript(GENERATED_IMG_PROBE) } catch {}
          if (!Array.isArray(imgs)) continue
          lastFresh = imgs.filter((i) => i && i.mediaId && !existingGenMediaIds.includes(i.mediaId))
          if (lastFresh.length < want) continue
          const picked = lastFresh.slice(0, want)
          const out = []
          for (const { mediaId, src } of picked) {
            try {
              const res = await sessionFetch(src)
              if (!res.ok) throw new Error(`media fetch HTTP ${res.status}`)
              const buffer = await res.arrayBuffer()
              const base64Raw = Buffer.from(buffer).toString('base64')
              const contentType = (res.headers.get && res.headers.get('content-type')) || 'image/png'
              out.push({ base64: `data:${contentType};base64,${base64Raw}`, mediaId })
            } catch (e) {
              console.warn('[Flow API] (Agent ON sync) image fetch failed:', e.message)
            }
          }
          if (out.length > 0) {
            clearTimeout(generationTimeout)
            if (getPendingGeneration() === syncOwnPending) setPendingGeneration(null)
            console.log('[Flow API] (Agent ON sync) collected', out.length, 'image(s) from DOM')
            return { success: true, images: out }
          }
        }
        clearTimeout(generationTimeout)
        if (getPendingGeneration() === syncOwnPending) setPendingGeneration(null)
        console.warn('[Flow API] (Agent ON sync) no fresh result image after', Math.round(MAX_WAIT / 1000), 's (fresh seen:', lastFresh.length, ')')
        return { success: false, error: 'Agent 생성 결과 이미지를 찾지 못했습니다 (타임아웃).', retry: true }
      }

      // 4. 네트워크 응답 대기
      const netResult = await responsePromise

      if (netResult.error) {
        console.warn('[Flow API] [DOM+Net] Network error/timeout:', netResult.message)
        // Fallback: blob 이미지 폴링 (최대 60초)
        console.log('[Flow API] [BlobPoll] Falling back to blob image polling...')
        for (let i = 0; i < 30; i++) {
          await new Promise(r => setTimeout(r, 2000))
          try {
            const currentBlobs = await flowView.webContents.executeJavaScript(
              `Array.from(document.querySelectorAll('img[src^="blob:"]')).map(img => img.src)`
            ) || []
            const newBlobs = currentBlobs.filter(b => !existingBlobs.includes(b))
            if (newBlobs.length > 0) {
              console.log('[Flow API] [BlobPoll] New blob found:', newBlobs[0].substring(0, 50))
              const base64 = await flowView.webContents.executeJavaScript(`
                (async function() {
                  try {
                    const res = await fetch(${JSON.stringify(newBlobs[0])});
                    const blob = await res.blob();
                    return new Promise(resolve => {
                      const reader = new FileReader();
                      reader.onloadend = () => resolve(reader.result);
                      reader.readAsDataURL(blob);
                    });
                  } catch { return null; }
                })()
              `)
              if (base64) return { success: true, images: [{ base64, mediaId: null }] }
            }
          } catch {}
        }
        return { success: false, error: netResult.message || 'Generation failed' }
      }

      // 5. 멀티 응답 파싱 — 각 응답에서 이미지 추출 후 결합
      const successResponses = (netResult.responses || []).filter(r => !r.error)
      const failedCount = (netResult.responses || []).filter(r => r.error).length
      console.log('[Flow API] [DOM+Net] Parsing', successResponses.length, 'successful responses (' +
        failedCount, 'failed)')

      // allImages: [{ base64, mediaId }] — mediaId 보존을 위해 객체 배열
      const allImages = []
      const allErrors = []

      for (const resp of successResponses) {
        // #R11-4: 401/403 은 파싱 가능 여부와 무관하게 인증 에러로 보존 — 렌더러(engineFlow)가
        //   authFailed 로 인식해 배치를 즉시 중단할 수 있게 한다(상태 유실 방지).
        if (resp.status === 401 || resp.status === 403) {
          allErrors.push(`HTTP ${resp.status} Unauthorized`)
          continue
        }
        const data = parseFlowResponse(resp.body)
        if (!data) {
          allErrors.push(`Failed to parse response (HTTP ${resp.status ?? '?'})`)
          continue
        }

        // 에러 체크
        if (data.error) {
          // formatGoogleApiError 가 message + status 를 합쳐서 노출 — renderer 의 quota
          // detector 가 "RESOURCE_EXHAUSTED" 같은 status-only quota 신호도 잡을 수 있게.
          allErrors.push(formatGoogleApiError(data.error))
          continue
        }

        // base64 이미지 직접 추출 → [{ base64, mediaId }]
        const base64Images = extractBase64Images(data)
        if (base64Images.length > 0) {
          allImages.push(...base64Images)
          continue
        }

        // fifeUrl 직접 다운로드 시도 (가장 빠름) → [{ fifeUrl, mediaId }]
        const fifeResults = extractFifeUrls(data)
        if (fifeResults.length > 0) {
          console.log('[Flow API] Got fifeUrls from response:', fifeResults.length)
          for (const { fifeUrl, mediaId } of fifeResults) {
            try {
              const res = await sessionFetch(fifeUrl)
              if (!res.ok) throw new Error(`fifeUrl fetch HTTP ${res.status}`)
              const buffer = await res.arrayBuffer()
              const base64Raw = Buffer.from(buffer).toString('base64')
              const contentType = res.headers.get('content-type') || 'image/png'
              allImages.push({
                base64: `data:${contentType};base64,${base64Raw}`,
                mediaId
              })
            } catch (fifeErr) {
              console.warn('[Flow API] fifeUrl fetch failed:', fifeErr.message)
              allErrors.push(fifeErr.message)
            }
          }
          if (allImages.length > 0) continue
        }

        // mediaId fallback
        const mediaIds = extractMediaIds(data)
        if (mediaIds.length > 0) {
          console.log('[Flow API] Got mediaIds from response:', mediaIds)
          for (const id of mediaIds) {
            try {
              const base64 = await fetchMediaAsBase64(token, id)
              allImages.push({ base64, mediaId: id })
            } catch (fetchErr) {
              console.warn('[Flow API] mediaId fetch failed:', fetchErr.message)
              allErrors.push(fetchErr.message)
            }
          }
          continue
        }

        // 이 응답에서는 이미지를 찾을 수 없음
        console.warn('[Flow API] No images in response:', JSON.stringify(data).substring(0, 300))
        allErrors.push('No images in response')
      }

      console.log('[Flow API] [DOM+Net] Total images collected:', allImages.length,
        '(errors:', allErrors.length, ')')

      if (allImages.length > 0) {
        return { success: true, images: allImages }
      }

      // 모든 응답에서 이미지 추출 실패
      return { success: false, error: allErrors.join('; ') || 'No images generated (content may have been filtered)' }

    } catch (e) {
      console.error('[Flow API] [DOM+Net] Exception:', e.message)
      // #R6-12: 자기 모드가 소유한 pending 만 정리한다. async 제출의 예외에서 sync 의
      //   공유 pendingGeneration 을 무조건 null 로 지우면, 동시에 진행 중인 다른 sync
      //   생성의 pending 까지 날려 그 생성이 영구 미수집된다.
      if (asyncMode) {
        // R9-P2: async pending 을 arm 한 뒤 submit 성공 반환 전에 throw 하면(클릭/DOM 감지 예외 등)
        //   pendingGenerations 에 고아 entry 가 남는다 — 여기서 정리(stale 매칭 방지).
        if (generationId && pendingGenerations.has(generationId)) {
          // #R14-9: 삭제 전 타이머 정리(orphanTimer/collectionTimer 누수 방지).
          const _tg = pendingGenerations.get(generationId)
          if (_tg?.orphanTimer) clearTimeout(_tg.orphanTimer)
          if (_tg?.collectionTimer) clearTimeout(_tg.collectionTimer)
          pendingGenerations.delete(generationId)
          console.warn('[Flow API] [Async] cleaned up stale pending on throw:', generationId)
        }
      } else if (getPendingGeneration() === syncOwnPending) {
        // #R7-9: sync 는 자기 pending(identity)일 때만 클리어 — 동시 sync 생성 보호.
        setPendingGeneration(null)
      }
      return { success: false, error: e.message }
    } finally {
      // R7-P2/R8-P1: 모든 종료 경로에서 generationTimeout 정리(idempotent) — 떠 있는 타이머가
      //   나중에 깨어나지 않게 한다. (R8-P1 의 identity 가드로 남의 pending 오삭제는 이미 차단됨.)
      if (generationTimeout) clearTimeout(generationTimeout)
      // Monkey-patch inject 정리 (다음 유기적 Flow 요청에 stale 값이 새지 않도록)
      await clearFlowPageInject?.()
    }
  })

  // ─── 비동기 생성 결과 조회 (폴링용) ───
  ipcMain.handle('flow:check-generation', async (event, { generationId }) => {
    if (!generationId) return { success: false, error: 'No generationId' }
    const gen = pendingGenerations.get(generationId)
    if (!gen) return { success: false, error: 'Generation not found', notFound: true }
    // 응답 가로채기로 완료가 안 됐으면 DOM 에서 생성 이미지를 수집해 본다 (에이전트 모델).
    if (!gen.completed) {
      try { await assignDomImagesToPending() } catch (_) {}
    }
    return {
      success: true,
      completed: gen.completed,
      responseCount: gen.responses.length,
      expectedCount: gen.expectedCount,
      via: gen.domImages ? 'dom' : 'intercept',
    }
  })

  // ─── 비동기 생성 결과 수집 + 파싱 (완료 후 호출) ───
  ipcMain.handle('flow:collect-generation', async (event, { generationId, token }) => {
    if (!generationId) return { success: false, error: 'No generationId' }
    const gen = pendingGenerations.get(generationId)
    if (!gen) return { success: false, error: 'Generation not found', notFound: true }
    if (!gen.completed) return { success: false, error: 'Generation not completed yet' }

    // 타이머 정리 + Map에서 제거
    if (gen.collectionTimer) clearTimeout(gen.collectionTimer)
    if (gen.orphanTimer) clearTimeout(gen.orphanTimer) // #R13-3
    pendingGenerations.delete(generationId)

    console.log('[Flow API] [AsyncCollect] Parsing results for gen:', generationId,
      'responses:', gen.responses.length)

    // 응답 파싱 (flow:generate-image 동기 모드와 동일한 로직)
    const successResponses = gen.responses.filter(r => !r.error)
    const failedCount = gen.responses.filter(r => r.error).length
    const allImages = []
    const allErrors = []

    const useToken = token || gen.token || null

    // 에이전트 모델: DOM 에서 매칭한 생성 이미지를 src(media.getMediaUrlRedirect?name=UUID)
    // 그대로 페이지 컨텍스트 fetch(쿠키 포함, redirect 따라감)로 받아 base64 변환.
    if (gen.domImages && gen.domImages.length > 0) {
      for (const { mediaId, src } of gen.domImages) {
        try {
          // sessionFetch = Electron session.fetch (페이지 쿠키 포함, redirect 자동 추적,
          // 실제 Response). <img> 가 렌더한 그 src 를 그대로 받아 바이너리 → base64.
          const res = await sessionFetch(src)
          if (!res.ok) throw new Error(`media fetch HTTP ${res.status}`)
          const buffer = await res.arrayBuffer()
          const base64Raw = Buffer.from(buffer).toString('base64')
          const contentType = (res.headers.get && res.headers.get('content-type')) || 'image/png'
          allImages.push({ base64: `data:${contentType};base64,${base64Raw}`, mediaId })
        } catch (e) {
          console.warn('[Flow API] [DOM Collect] image fetch failed:', e.message)
          allErrors.push(e.message)
        }
      }
      console.log('[Flow API] [DOM Collect] collected', allImages.length, 'image(s) for gen:', generationId)
      if (allImages.length > 0) {
        return { success: true, images: allImages }
      }
      // 실패 시 아래 응답-가로채기 경로로 폴백
    }

    for (const resp of successResponses) {
      // #R11-5: 401/403 인증 에러 보존(async collect 도 동일) — 렌더러 auth-stop.
      if (resp.status === 401 || resp.status === 403) { allErrors.push(`HTTP ${resp.status} Unauthorized`); continue }
      const data = parseFlowResponse(resp.body)
      if (!data) { allErrors.push(`Failed to parse response (HTTP ${resp.status ?? '?'})`); continue }
      if (data.error) { allErrors.push(formatGoogleApiError(data.error)); continue }

      // base64 이미지 직접 추출
      const base64Images = extractBase64Images(data)
      if (base64Images.length > 0) { allImages.push(...base64Images); continue }

      // fifeUrl 직접 다운로드
      const fifeResults = extractFifeUrls(data)
      if (fifeResults.length > 0) {
        for (const { fifeUrl, mediaId } of fifeResults) {
          try {
            const res = await sessionFetch(fifeUrl)
            if (!res.ok) throw new Error(`fifeUrl fetch HTTP ${res.status}`)
            const buffer = await res.arrayBuffer()
            const base64Raw = Buffer.from(buffer).toString('base64')
            const contentType = res.headers.get('content-type') || 'image/png'
            allImages.push({ base64: `data:${contentType};base64,${base64Raw}`, mediaId })
          } catch (fifeErr) {
            allErrors.push(fifeErr.message)
          }
        }
        if (allImages.length > 0) continue
      }

      // mediaId fallback
      const mediaIds = extractMediaIds(data)
      if (mediaIds.length > 0 && useToken) {
        for (const id of mediaIds) {
          try {
            const base64 = await fetchMediaAsBase64(useToken, id)
            allImages.push({ base64, mediaId: id })
          } catch (fetchErr) {
            allErrors.push(fetchErr.message)
          }
        }
        continue
      }
      allErrors.push('No images in response')
    }

    console.log('[Flow API] [AsyncCollect] Total images:', allImages.length,
      '(errors:', allErrors.length, ', failed:', failedCount, ')')

    if (allImages.length > 0) {
      return { success: true, images: allImages }
    }
    return { success: false, error: allErrors.join('; ') || 'No images generated' }
  })

  // ─── 비동기 생성 일괄 정리 (배치 종료 시) ───
  ipcMain.handle('flow:clear-generations', async () => {
    for (const [id, gen] of pendingGenerations) {
      if (gen.collectionTimer) clearTimeout(gen.collectionTimer)
      if (gen.orphanTimer) clearTimeout(gen.orphanTimer) // #R13-3
    }
    const count = pendingGenerations.size
    pendingGenerations.clear()
    console.log('[Flow API] [AsyncClear] Cleared', count, 'pending generations')
    return { success: true, cleared: count }
  })

  // Fetch media by ID (mediaId → redirect → base64)
  ipcMain.handle('flow:fetch-media', async (event, { token, mediaId }) => {
    if (!token) return { success: false, error: 'No token' }
    if (!mediaId) return { success: false, error: 'No mediaId' }

    try {
      const base64 = await fetchMediaAsBase64(token, mediaId)
      return { success: true, base64 }
    } catch (e) {
      return { success: false, error: e.message }
    }
  })

  // 비디오 URL 직접 다운로드 (status 응답에서 추출한 fifeUri/url)
  ipcMain.handle('flow:download-video-url', async (event, { url, token }) => {
    if (!url) return { success: false, error: 'No URL' }

    try {
      console.log('[Flow VideoDownload] Fetching:', url.substring(0, 80))
      const headers = {}
      if (token) headers['Authorization'] = `Bearer ${token}`

      const res = await sessionFetch(url, { headers })
      if (!res.ok) {
        return { success: false, error: `HTTP ${res.status}` }
      }

      const buffer = await res.arrayBuffer()
      const contentType = res.headers?.get?.('content-type') || 'video/mp4'
      const base64 = `data:${contentType};base64,${Buffer.from(buffer).toString('base64')}`
      console.log('[Flow VideoDownload] Downloaded, size:', buffer.byteLength, 'type:', contentType)
      return { success: true, base64 }
    } catch (e) {
      console.error('[Flow VideoDownload] Error:', e.message)
      return { success: false, error: e.message }
    }
  })

  // DOM-based video download — AutoFlow downloadVideoAtResolution 방식
  // 1. CDP Page.setDownloadBehavior → temp 디렉토리로 자동 저장
  // 2. <video> 요소를 mediaId로 찾기 → hover → three-dot → download → 해상도 선택
  // 3. temp 파일 읽기 → base64 반환
  ipcMain.handle('flow:dom-download-video', async (event, { mediaId, resolution = '720p' }) => {
    // #R27-5: 단순 fetch 가 아니라 Flow 다운로드 메뉴를 클릭하고 1080p/4K 선택 시 업스케일까지
    //   돌 수 있어 Flow quota 를 쓴다. API 모드 전환 후 stale 호출이 보존된 Flow view 를 구동해
    //   quota 를 소모하지 않도록 게이트한다. (API 모드 비디오 다운로드는 engineApi 경로라 무관.)
    if (!flowActive()) return { success: false, error: 'Flow inactive (API mode)' }
    const flowView = getFlowView()
    if (!flowView) return { success: false, error: 'Flow view not ready' }
    if (!mediaId) return { success: false, error: 'No mediaId' }
    // CDP 없이도 동작 — will-download 핸들러가 path 지정. ensureDebuggerAttached 호출 안 함.

    console.log('[Flow DOMDownload] Starting DOM download — mediaId:', mediaId?.substring(0, 30), 'resolution:', resolution)

    // R14-P1: 공유 session will-download 경합 방지 — 다운로드/업스케일을 직렬화.
    const releaseDownloadLock = await downloadMutex.acquire()

    // session.will-download 핸들러 (CDP setDownloadBehavior 대체) — 함수 스코프 변수로 cleanup
    let willDownloadHandler = null
    // #R11-8: tempDir 를 try 밖에 둬 finally 에서 항상 정리(예외 경로 누수 방지).
    let tempDir = null
    const dlSession = flowView.webContents.session

    try {
      const fs = await import('node:fs')
      const os = await import('node:os')

      // Step 1: 다운로드 path 가로채기 (Electron session.will-download — CDP 무관)
      tempDir = path.join(os.tmpdir(), `flow-dl-${Date.now()}`)
      fs.mkdirSync(tempDir, { recursive: true })
      console.log('[Flow DOMDownload] Download dir:', tempDir)

      willDownloadHandler = (_event, item) => {
        const filename = item.getFilename()
        const savePath = path.join(tempDir, filename)
        console.log('[Flow DOMDownload] will-download intercept:', filename, '→', savePath)
        item.setSavePath(savePath)
      }
      dlSession.on('will-download', willDownloadHandler)
      console.log('[Flow DOMDownload] will-download handler installed (no CDP)')

      // Step 2: DOM 자동화 — AutoFlow downloadVideoAtResolution 패턴
      const domResult = await flowView.webContents.executeJavaScript(`
        (async function() {
          const LOG = (msg) => console.log('[DOMDownload] ' + msg)
          const mediaId = ${JSON.stringify(mediaId)}
          const resolution = ${JSON.stringify(resolution)}

          // --- Helper: pointerClick (Radix UI 호환) ---
          function pointerClick(el) {
            if (!el) return
            const rect = el.getBoundingClientRect()
            const x = rect.left + rect.width / 2
            const y = rect.top + rect.height / 2
            const pOpts = { bubbles: true, cancelable: true, composed: true, clientX: x, clientY: y, pointerId: 1, pointerType: 'mouse', isPrimary: true }
            el.dispatchEvent(new PointerEvent('pointerdown', pOpts))
            el.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true, clientX: x, clientY: y, button: 0 }))
            el.dispatchEvent(new PointerEvent('pointerup', pOpts))
            el.dispatchEvent(new MouseEvent('mouseup', { bubbles: true, cancelable: true, clientX: x, clientY: y, button: 0 }))
            el.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, clientX: x, clientY: y, button: 0 }))
          }

          // --- Helper: waitForMenu ---
          async function waitForMenu(ms = 2000) {
            const t0 = Date.now()
            while (Date.now() - t0 < ms) {
              const m = document.querySelector("[data-radix-menu-content][data-state='open'], [role='menu'][data-state='open']")
              if (m) return m
              await new Promise(r => setTimeout(r, 80))
            }
            return null
          }

          // --- Helper: closeMenus ---
          async function closeMenus() {
            for (let i = 0; i < 3; i++) {
              if (!document.querySelector("[data-radix-menu-content][data-state='open'], [role='menu'][data-state='open']")) break
              document.activeElement?.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', keyCode: 27, bubbles: true, cancelable: true, composed: true }))
              await new Promise(r => setTimeout(r, 150))
            }
          }

          // --- Helper: ICON_SEL ---
          const ICON_SEL = "i, .material-symbols, .material-symbols-outlined, .google-symbols, [class*='material-symbols']"

          // --- Helper: findVideoElement ---
          // strict 매칭(1~3순위)은 mediaId 가 DOM 어딘가에 박혀 있어야 함.
          // allowFallback=true 면 4순위로 "마지막 video" 를 반환하는데,
          // 배치 처리 중엔 이전 생성물이 갤러리에 남아있을 수 있어 위험하다.
          // 폴링 헬퍼(waitForVideoElement)에서는 반드시 false 로 호출해 잘못된
          // 영상이 선택되지 않도록 한다.
          function findVideoElement(uuid, opts) {
            const allowFallback = opts && opts.allowFallback !== undefined ? opts.allowFallback : true
            if (!uuid) return null

            // 1순위: <video src> 또는 <source src> 에 UUID 포함
            for (const el of document.querySelectorAll('video[src], video source[src]')) {
              const src = el.getAttribute('src') || ''
              const resolved = el.src || ''
              if (src.includes(uuid) || resolved.includes(uuid)) {
                return el.tagName === 'SOURCE' ? el.closest('video') : el
              }
            }

            // 2순위: <video poster> 에 UUID 포함 (T2V 갤러리는 보통 poster만 먼저 로드됨)
            for (const el of document.querySelectorAll('video[poster]')) {
              const poster = el.getAttribute('poster') || ''
              if (poster.includes(uuid)) {
                return el
              }
            }

            // 3순위: data-* 속성에 UUID 가 박힌 컨테이너 → 그 안의 video
            // (Flow UI 가 data-id, data-media-id 등으로 타일을 표시하는 케이스)
            for (const el of document.querySelectorAll(
              '[data-id*="' + uuid + '"], [data-media-id*="' + uuid + '"], [data-name*="' + uuid + '"]'
            )) {
              const v = el.tagName === 'VIDEO' ? el : (el.querySelector('video') || el.closest('video'))
              if (v) return v
            }

            // 4순위(fallback): 마지막 <video> — 명시적으로 허용한 호출자만 사용.
            // 배치 컨텍스트에선 절대 쓰면 안 됨(이전 생성물이 잡힐 수 있음).
            if (allowFallback) {
              const allVideos = document.querySelectorAll('video[src], video[poster]')
              if (allVideos.length > 0) {
                LOG('UUID match failed across all selectors, using last video element as fallback')
                return allVideos[allVideos.length - 1]
              }
            }
            return null
          }

          // --- Helper: waitForVideoElement (폴링, strict-only) ---
          // T2V 결과는 generation-status complete 직후 DOM에 즉시 추가되지 않는 경우가
          // 있어, 최대 15초까지 폴링하며 대기한다. 발견되면 즉시 반환.
          // ⚠️ fallback 비활성화: 배치 처리 중 갤러리에 이전 생성물이 남아있을 때
          //    fallback이 활성화되면 첫 폴링에 잘못된 영상이 즉시 잡혀 폴링 의미가
          //    사라지고 silent data corruption 이 발생한다(원래 영상 자리에 다른 영상
          //    저장됨). 폴링 후에도 못 찾으면 null 반환 → 상위 폴백(direct URL,
          //    fetchMedia)이 처리하도록 한다.
          async function waitForVideoElement(uuid, maxMs = 15000, intervalMs = 500) {
            const t0 = Date.now()
            let attempt = 0
            while (Date.now() - t0 < maxMs) {
              const v = findVideoElement(uuid, { allowFallback: false })
              if (v) {
                if (attempt > 0) LOG('Video element appeared after ' + (Date.now() - t0) + 'ms')
                return v
              }
              attempt++
              await new Promise(r => setTimeout(r, intervalMs))
            }
            LOG('waitForVideoElement timeout after ' + maxMs + 'ms (strict match only, no fallback)')
            return null
          }

          // --- Helper: findTileWithOverlay ---
          function findTileWithOverlay(mediaEl) {
            if (!mediaEl) return null
            let node = mediaEl.parentElement
            for (let i = 0; i < 10 && node; i++) {
              if (Array.from(node.querySelectorAll(ICON_SEL)).some(icon => {
                const t = (icon.textContent || '').trim().toLowerCase()
                return t === 'more_vert' || t === 'more_horiz'
              })) return node
              node = node.parentElement
            }
            return null
          }

          // --- Helper: findThreeDots ---
          function findThreeDots(scope) {
            if (!scope) return null
            for (const icon of scope.querySelectorAll(ICON_SEL)) {
              const t = (icon.textContent || '').trim().toLowerCase()
              if (t === 'more_vert' || t === 'more_horiz')
                return icon.closest('button') || icon.parentElement
            }
            return null
          }

          // --- Helper: findMenuItem ---
          function findMenuItem(menu, iconText) {
            if (!menu) return null
            const needle = iconText.toLowerCase()
            for (const item of menu.querySelectorAll("[role='menuitem']")) {
              for (const icon of item.querySelectorAll(ICON_SEL))
                if ((icon.textContent || '').trim().toLowerCase() === needle) return item
              if ((item.textContent || '').trim().toLowerCase().startsWith(needle)) return item
            }
            return null
          }

          // --- Helper: unhover ---
          function unhover(el) {
            if (!el) return
            el.dispatchEvent(new MouseEvent('mouseleave', { bubbles: true }))
            el.dispatchEvent(new MouseEvent('mouseout', { bubbles: true }))
            let node = el.parentElement
            for (let i = 0; i < 4 && node; i++) {
              node.dispatchEvent(new MouseEvent('mouseleave', { bubbles: true }))
              node.dispatchEvent(new MouseEvent('mouseout', { bubbles: true }))
              node = node.parentElement
            }
          }

          try {
            // 1. 비디오 요소 찾기 — 폴링 (T2V 결과는 status complete 직후 DOM에 즉시
            //    추가되지 않는 경우가 있어, 최대 15초 대기)
            LOG('Finding video element for: ' + mediaId.substring(0, 30))
            let targetVideo = await waitForVideoElement(mediaId, 15000, 500)
            if (!targetVideo) {
              return { success: false, error: 'Video element not found on page (15s timeout)' }
            }
            LOG('Found target video element, src: ' + (targetVideo.getAttribute('src') || '').substring(0, 60))

            // 2. Hover — 오버레이 표시
            targetVideo.dispatchEvent(new MouseEvent('mouseenter', { bubbles: true }))
            targetVideo.dispatchEvent(new MouseEvent('mouseover', { bubbles: true }))
            let hoverNode = targetVideo.parentElement
            for (let i = 0; i < 4 && hoverNode; i++) {
              hoverNode.dispatchEvent(new MouseEvent('mouseenter', { bubbles: true }))
              hoverNode.dispatchEvent(new MouseEvent('mouseover', { bubbles: true }))
              hoverNode = hoverNode.parentElement
            }
            await new Promise(r => setTimeout(r, 500))

            // 3. Tile 찾기 (more_vert 포함)
            const tile = findTileWithOverlay(targetVideo)
            if (!tile) {
              unhover(targetVideo)
              return { success: false, error: 'Overlay tile not found after hover' }
            }

            // 4. Three-dots 버튼 클릭
            const threeDotsBtn = findThreeDots(tile)
            if (!threeDotsBtn) {
              unhover(targetVideo)
              return { success: false, error: 'Three-dots button not found in tile' }
            }
            LOG('Clicking three-dots button')
            pointerClick(threeDotsBtn)
            await new Promise(r => setTimeout(r, 300))

            // 5. 메뉴 대기 (재시도 1회)
            let menu = await waitForMenu(2000)
            if (!menu) {
              pointerClick(threeDotsBtn)
              menu = await waitForMenu(2000)
            }
            if (!menu) {
              unhover(targetVideo)
              return { success: false, error: 'Context menu did not open' }
            }
            LOG('Context menu opened')

            // 6. "download" 메뉴 아이템 찾기 (아이콘 텍스트로 — 언어 독립)
            const downloadItem = findMenuItem(menu, 'download')
            if (!downloadItem) {
              const items = Array.from(menu.querySelectorAll("[role='menuitem']")).map(i => i.textContent?.trim())
              LOG('Download item not found. Items: ' + JSON.stringify(items))
              await closeMenus()
              unhover(targetVideo)
              return { success: false, error: 'Download menu item not found. Items: ' + items.join(', ') }
            }
            LOG('Hovering Download menu item to open submenu')

            // 7. Download 호버 → 서브메뉴 열기
            const dlRect = downloadItem.getBoundingClientRect()
            const dlX = dlRect.left + dlRect.width / 2
            const dlY = dlRect.top + dlRect.height / 2
            const hoverOpts = { bubbles: true, cancelable: true, clientX: dlX, clientY: dlY, pointerId: 1, pointerType: 'mouse', isPrimary: true }

            downloadItem.focus?.()
            downloadItem.setAttribute?.('data-highlighted', '')
            downloadItem.dispatchEvent(new PointerEvent('pointerenter', { ...hoverOpts, composed: true }))
            downloadItem.dispatchEvent(new PointerEvent('pointermove', { ...hoverOpts, composed: true }))
            downloadItem.dispatchEvent(new MouseEvent('mouseover', { bubbles: true, clientX: dlX, clientY: dlY }))
            downloadItem.dispatchEvent(new MouseEvent('mouseenter', { bubbles: true, clientX: dlX, clientY: dlY }))
            downloadItem.dispatchEvent(new MouseEvent('mousemove', { bubbles: true, clientX: dlX, clientY: dlY }))
            await new Promise(r => setTimeout(r, 400))

            // 8. 서브메뉴 대기 (jitter 포함)
            let submenu = null
            for (let attempt = 0; attempt < 20; attempt++) {
              const openMenus = document.querySelectorAll("[data-radix-menu-content][data-state='open'], [role='menu'][data-state='open']")
              if (openMenus.length >= 2) {
                submenu = openMenus[openMenus.length - 1]
                break
              }
              if (attempt % 3 === 2) {
                const jX = dlX + (attempt % 2 === 0 ? 2 : -2)
                const jY = dlY + (attempt % 2 === 0 ? 1 : -1)
                const jOpts = { ...hoverOpts, clientX: jX, clientY: jY }
                downloadItem.dispatchEvent(new PointerEvent('pointermove', { ...jOpts, composed: true }))
                downloadItem.dispatchEvent(new PointerEvent('pointerenter', { ...jOpts, composed: true }))
                downloadItem.dispatchEvent(new MouseEvent('mouseover', { bubbles: true, clientX: jX, clientY: jY }))
                downloadItem.dispatchEvent(new MouseEvent('mousemove', { bubbles: true, clientX: jX, clientY: jY }))
              }
              await new Promise(r => setTimeout(r, 200))
            }

            // 9. 해상도 선택
            const resMap = { '270p': '270p', '720p': '720p', '1080p': '1080p', '4k': '4K' }
            const targetRes = resMap[String(resolution).toLowerCase()] || '720p'

            if (submenu) {
              LOG('Submenu opened! Looking for resolution: ' + targetRes)
              const submenuItems = Array.from(submenu.querySelectorAll("[role='menuitem']"))
              LOG('Submenu items: ' + submenuItems.map(i => i.textContent?.trim()).join(', '))
              let resOption = null
              for (const item of submenuItems) {
                if ((item.textContent || '').trim().includes(targetRes)) {
                  resOption = item
                  break
                }
              }
              if (resOption) {
                pointerClick(resOption)
                LOG('Clicked resolution: ' + targetRes)
                await closeMenus()
                unhover(targetVideo)
                return { success: true, resolution: targetRes }
              }
            }

            // 10. 서브메뉴 안 열리면 click + keyboard fallback
            if (!submenu) {
              LOG('Submenu did not open, trying click + keyboard fallback')
              pointerClick(downloadItem)
              await new Promise(r => setTimeout(r, 400))
              downloadItem.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true, cancelable: true }))
              await new Promise(r => setTimeout(r, 400))

              for (const item of document.querySelectorAll("[role='menuitem']")) {
                if ((item.textContent || '').trim().includes(targetRes)) {
                  pointerClick(item)
                  LOG('Clicked resolution (keyboard fallback): ' + targetRes)
                  await closeMenus()
                  unhover(targetVideo)
                  return { success: true, resolution: targetRes }
                }
              }
            }

            // 11. 해상도 옵션 없으면 직접 다운로드 클릭 (서브메뉴 없는 경우)
            LOG('No resolution submenu, clicking download directly')
            pointerClick(downloadItem)
            await closeMenus()
            unhover(targetVideo)
            return { success: true, resolution: 'default' }

          } catch (e) {
            try { await closeMenus() } catch {}
            return { success: false, error: e.message }
          }
        })()
      `)

      console.log('[Flow DOMDownload] DOM automation result:', JSON.stringify(domResult))

      if (!domResult.success) {
        // 다운로드 디렉토리 정리
        try { fs.rmSync(tempDir, { recursive: true, force: true }) } catch {}
        return { success: false, error: `DOM: ${domResult.error}` }
      }

      // Step 3: temp 디렉토리에서 다운로드 파일 대기 (폴링)
      console.log('[Flow DOMDownload] Waiting for download file in:', tempDir)
      let downloadedFile = null
      const maxWait = VIDEO_DOWNLOAD_TIMEOUT_MS // 5분 (동영상 4K 업스케일 포함)
      const pollInterval = 1000
      const startTime = Date.now()

      while (Date.now() - startTime < maxWait) {
        await new Promise(r => setTimeout(r, pollInterval))

        try {
          const files = fs.readdirSync(tempDir)
            .filter(f => !f.endsWith('.crdownload') && !f.endsWith('.tmp') && !f.startsWith('.'))

          if (files.length > 0) {
            const filePath = path.join(tempDir, files[0])
            const stats = fs.statSync(filePath)

            // 파일 크기가 변하지 않으면 완료 (1초 대기 후 재확인)
            await new Promise(r => setTimeout(r, 1000))
            const stats2 = fs.statSync(filePath)

            if (stats.size === stats2.size && stats.size > 0) {
              downloadedFile = filePath
              console.log('[Flow DOMDownload] File ready:', files[0], 'size:', stats.size)
              break
            }
          }
        } catch (pollErr) {
          // 디렉토리 아직 비어있음 — 계속 대기
        }
      }

      // will-download 핸들러 해제 (CDP setDownloadBehavior reset 대체)
      if (willDownloadHandler) {
        dlSession.off('will-download', willDownloadHandler)
        willDownloadHandler = null
      }

      // "닫기" 버튼 클릭 — 업스케일링 완료 토스트 닫기
      try {
        await flowView.webContents.executeJavaScript(`
          (function() {
            // 토스트/스낵바에서 "닫기" 또는 "Close" 버튼 찾기
            const buttons = Array.from(document.querySelectorAll('button'))
            for (const btn of buttons) {
              const text = (btn.textContent || '').trim()
              if (text === '닫기' || text === 'Close' || text === '닫 기') {
                console.log('[DOMDownload] Clicking close button: ' + text)
                btn.click()
                break
              }
            }
          })()
        `)
        console.log('[Flow DOMDownload] Dismissed upscale toast')
      } catch (dismissErr) {
        console.warn('[Flow DOMDownload] Toast dismiss failed (non-critical):', dismissErr.message)
      }

      if (!downloadedFile) {
        // 디렉토리 정리
        try { fs.rmSync(tempDir, { recursive: true, force: true }) } catch {}
        return { success: false, error: 'Download timeout — no file appeared in temp dir' }
      }

      // Step 4: 파일 읽기 → base64
      try {
        const data = fs.readFileSync(downloadedFile)
        const ext = path.extname(downloadedFile).toLowerCase()
        const mimeType = ext === '.webm' ? 'video/webm' : 'video/mp4'
        const base64 = `data:${mimeType};base64,${data.toString('base64')}`
        console.log('[Flow DOMDownload] Success! size:', data.length, 'type:', mimeType, 'resolution:', domResult?.resolution)

        // 정리
        try { fs.rmSync(tempDir, { recursive: true, force: true }) } catch {}

        // domResult.resolution은 Step 2의 DOM 자동화가 실제 클릭한 해상도
        // ("720p"/"1080p"/"4K" — submenu에서 선택 성공) 또는 "default" (submenu 못 열림).
        // 상위 호출자가 요청 해상도와 비교해서 upscale 필요 여부 판단하게 그대로 전달.
        return { success: true, base64, resolution: domResult?.resolution || 'default' }
      } catch (readErr) {
        try { fs.rmSync(tempDir, { recursive: true, force: true }) } catch {}
        return { success: false, error: `File read error: ${readErr.message}` }
      }

    } catch (e) {
      console.error('[Flow DOMDownload] Error:', e.message)
      return { success: false, error: e.message }
    } finally {
      // R13-P2: early return(DOM 실패 등)/throw 경로에서도 will-download 리스너 누수 방지(idempotent).
      if (willDownloadHandler) {
        dlSession.off('will-download', willDownloadHandler)
        willDownloadHandler = null
      }
      // #R11-8: 예외 등 어떤 종료 경로든 temp 디렉터리 정리(중간 rmSync 와 idempotent).
      if (tempDir) { try { (await import('node:fs')).rmSync(tempDir, { recursive: true, force: true }) } catch { /* ignore */ } }
      releaseDownloadLock()  // R14-P1
    }
  })

  // Upload image to Flow
  ipcMain.handle('flow:upload-reference', async (event, { token, base64, projectId }) => {
    if (!token) return { success: false, error: 'No token' }
    if (!flowActive()) return { success: false, error: 'Flow inactive (API mode)' }  // #R25-4

    // projectId가 없으면 flowView URL에서 추출 시도
    const flowView = getFlowView()
    let resolvedProjectId = projectId || ''
    if (!resolvedProjectId && flowView) {
      try {
        const flowUrl = flowView.webContents.getURL()
        const match = flowUrl.match(/\/project\/([a-f0-9-]+)/)
        if (match) resolvedProjectId = match[1]
      } catch (e) { /* ignore */ }
    }

    try {
      // AutoFlow 10.7.58 형식 (sidepanel.js:44951)
      const body = {
        clientContext: {
          projectId: resolvedProjectId,
          tool: 'PINHOLE'
        },
        imageBytes: base64,
        isUserUploaded: true,
        isHidden: false,
        mimeType: 'image/png',
        fileName: 'ref_image.png'
      }

      // #R33: region 대응 — 캡처된 API origin 으로 uploadImage 호스트 해석(없으면 UPLOAD_URL fallback).
      const _uploadUrl = getApiBase ? `${await getApiBase()}/flow/uploadImage` : UPLOAD_URL
      console.log('[Flow API] upload-reference: sending to', _uploadUrl, 'projectId:', resolvedProjectId?.substring(0, 12), 'base64Len:', base64?.length)

      const response = await sessionFetch(_uploadUrl, {
        method: 'POST',
        headers: { ...API_HEADERS, 'Authorization': `Bearer ${token}` },
        body: JSON.stringify(body)
      })

      if (!response.ok) {
        const errText = await response.text().catch(() => '')
        console.error('[Flow API] upload-reference HTTP', response.status, errText.substring(0, 500))
        return { success: false, error: `Upload HTTP ${response.status}` }
      }

      const text = await response.text()
      const data = parseFlowResponse(text)

      // 응답 구조: { media: { name: "uuid" }, workflow: { ... } }
      const mediaId = data?.media?.name || data?.mediaGenerationId || data?.name || null
      const caption = data?.media?.caption || data?.caption || data?.description || null

      console.log('[Flow API] upload-reference result:', { mediaId: mediaId?.substring(0, 36), caption: caption?.substring(0, 30), dataKeys: data ? Object.keys(data) : [] })

      if (mediaId) {
        return { success: true, mediaId, caption }
      }

      console.warn('[Flow API] upload-reference: No mediaId in response, data:', JSON.stringify(data)?.substring(0, 500))
      return { success: false, error: 'No media ID returned' }
    } catch (e) {
      console.error('[Flow API] upload-reference error:', e.message)
      return { success: false, error: e.message }
    }
  })

  // Validate token and get expiry
  ipcMain.handle('flow:validate-token', async (event, { token }) => {
    try {
      const response = await sessionFetch(`${TOKEN_INFO_URL}?access_token=${token}`)
      if (response.ok) {
        const data = await response.json()
        return { valid: true, expiry: parseInt(data.exp) * 1000 }
      }
      return { valid: false, expiry: null }
    } catch (e) {
      return { valid: false, expiry: null }
    }
  })

  // ─── List User Projects (Flow archive — date list) ─────────────
  // 사용자의 Flow 프로젝트(=날짜별 세션) 목록을 가져온다.
  // 응답: result.data.json.result.projects[] → {projectId, projectInfo, creationTime}
  ipcMain.handle('flow:list-projects', async (event, { token, pageSize = 20 } = {}) => {
    try {
      const input = JSON.stringify({ json: { pageSize, toolName: 'PINHOLE' } })
      const url = `https://labs.google/fx/api/trpc/project.searchUserProjects?input=${encodeURIComponent(input)}`

      console.log('[Projects] Fetching project list, pageSize:', pageSize)
      const resp = await sessionFetch(url, {
        headers: {
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'application/json',
        }
      })

      if (!resp.ok) {
        return { success: false, error: `List projects HTTP ${resp.status}`, items: [] }
      }

      const text = await resp.text()
      const data = parseFlowResponse(text)
      const projects =
        data?.result?.data?.json?.result?.projects ||
        data?.result?.data?.result?.projects ||
        []

      const items = projects.map(p => ({
        projectId: p.projectId || '',
        title: p.projectInfo?.projectTitle || p.projectId || '',
        thumbnailMediaKey: p.projectInfo?.thumbnailMediaKey || null,
        creationTime: p.creationTime || '',
      })).filter(p => p.projectId)

      console.log(`[Projects] ${items.length} projects extracted`)
      return { success: true, items }
    } catch (e) {
      console.error('[Projects] Error:', e.message)
      return { success: false, error: e.message, items: [] }
    }
  })

  // ─── Fetch Gallery (Project Images — uploads + generated) ─────────
  // Flow archive 뷰가 호출하는 project.getProjectContents 사용.
  // flow.projectInitialData 와 달리 사용자가 Flow UI로 직접 업로드한
  // 이미지(image.userUploadedImage)와 생성 이미지(image.generatedImage)
  // 모두 반환한다. 비디오는 제외.
  ipcMain.handle('flow:fetch-gallery', async (event, { token, projectId }) => {
    try {
      if (!projectId) {
        projectId = getCapturedProjectId?.()
      }
      if (!projectId) {
        return { success: false, error: 'No projectId available', items: [] }
      }

      const input = JSON.stringify({ json: { projectId } })
      const url = `https://labs.google/fx/api/trpc/project.getProjectContents?input=${encodeURIComponent(input)}`

      console.log('[Gallery] Fetching project contents for:', projectId.substring(0, 12) + '...')
      const resp = await sessionFetch(url, {
        headers: {
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'application/json',
        }
      })

      if (!resp.ok) {
        return { success: false, error: `Gallery fetch failed: ${resp.status}`, items: [] }
      }

      const text = await resp.text()
      const data = parseFlowResponse(text)

      // 응답: result.data.json.result.{media[], workflows[], externalReferenceMedia[]}
      const root =
        data?.result?.data?.json?.result ||
        data?.result?.data?.result ||
        {}
      const media = Array.isArray(root.media) ? root.media : []
      const workflows = Array.isArray(root.workflows) ? root.workflows : []

      // workflowId → workflow.metadata.displayName 매핑 (원본 파일명 표시용)
      const workflowMap = new Map()
      for (const wf of workflows) {
        const wfId = String(wf?.name || wf?.workflowId || '')
        if (wfId) workflowMap.set(wfId, wf)
      }

      console.log(`[Gallery] Found ${media.length} media items, ${workflows.length} workflows`)

      // 모든 이미지 (업로드 + 생성). 비디오는 제외.
      const images = media.filter(m => m?.image && !m?.video)

      // media.getMediaUrlRedirect 는 ?name=<uuid> 만 받고 307로 CDN URL을 돌려준다.
      // 메모리 폭증 방지: 이미지 바이트를 가져오지 않고 redirect Location 만 추출해
      // 서명 CDN URL을 그대로 renderer 에 반환한다. (signed Expires 토큰이 있어
      // 인증 없이 <img src> 로 바로 렌더 가능.)
      //
      // ses.fetch / 브라우저 fetch 는 redirect:'manual'을 못 잡거나 opaque로 가려서
      // Location 을 못 읽는다. Electron 의 net.request 는 Flow 세션 쿠키를 그대로 쓰면서
      // 'redirect' 이벤트로 Location URL 을 직접 넘겨주므로 거기서 잡는다.
      const flowView = getFlowView()
      const flowSession = flowView?.webContents?.session

      // redirect URL이 실제 Google 미디어 CDN인지 확인. 인증/에러 페이지 redirect를
      // 이미지 URL 처럼 renderer 에 흘려보내는 사고 방지.
      // 허용:
      //   - *.googleusercontent.com (lh3.* 등 일반 Google 사용자 콘텐츠 CDN)
      //   - *.googleapis.com         (Flow API 도메인의 서명 미디어 URL)
      //   - flow-content.google      (Flow 전용 미디어 CDN — `.google` TLD)
      // 의도적 제외: *.google.com — accounts.google.com 같은 로그인 페이지가
      //              이미지 URL 행세를 할 수 있음.
      const isAllowedMediaHost = (urlStr) => {
        try {
          const u = new URL(urlStr)
          if (u.protocol !== 'https:') return false
          const h = u.hostname.toLowerCase()
          if (/(^|\.)googleusercontent\.com$/.test(h)) return true
          if (/(^|\.)googleapis\.com$/.test(h)) return true
          if (h === 'flow-content.google' || /(^|\.)flow-content\.google$/.test(h)) return true
          return false
        } catch {
          return false
        }
      }

      const RESOLVE_TIMEOUT_MS = 10_000
      const resolveMediaUrl = (mediaId) => new Promise((resolve, reject) => {
        const url = `${MEDIA_REDIRECT_URL}?name=${encodeURIComponent(mediaId)}`
        const req = net.request({
          method: 'GET',
          url,
          session: flowSession,
          useSessionCookies: true,
          redirect: 'manual',
        })
        req.setHeader('Authorization', `Bearer ${token}`)
        let settled = false
        const settle = (fn, val) => {
          if (settled) return
          settled = true
          clearTimeout(timer)
          fn(val)
        }
        // 응답이 영영 안 올 경우 전체 갤러리 fetch 가 멈추는 걸 방지.
        // 개별 fetch 가 timeout 되면 drop 가드가 처리한다.
        const timer = setTimeout(() => {
          try { req.abort() } catch (_) {}
          settle(reject, new Error('timeout'))
        }, RESOLVE_TIMEOUT_MS)
        req.on('redirect', (_status, _method, redirectUrl) => {
          req.abort()
          if (!isAllowedMediaHost(redirectUrl)) {
            try {
              const host = new URL(redirectUrl).hostname
              console.warn('[Gallery] redirect host blocked:', host)
            } catch {
              console.warn('[Gallery] redirect URL malformed')
            }
            settle(reject, new Error('redirect host not allowed'))
            return
          }
          settle(resolve, redirectUrl)
        })
        req.on('response', (response) => {
          // redirect:'manual'인데 200이 떨어졌다면 (인증 만료 → HTML 등) 실패 처리.
          settle(reject, new Error(`unexpected status ${response.statusCode}`))
          response.on('data', () => {})
        })
        req.on('error', (err) => settle(reject, err))
        req.end()
      })

      // 작은 동시성 풀 — 한 번에 N개만 redirect 해소를 진행한다.
      // 무제한 Promise.all 은 이미지 많은 프로젝트에서 net.request 폭주 + 소켓 고갈 야기.
      const MEDIA_RESOLVE_CONCURRENCY = 6
      const resolveItem = async (m) => {
        const mediaId = m.name || m.mediaId || m.id || ''
        if (!mediaId) return null
        const wf = workflowMap.get(String(m.workflowId || ''))
        const displayName = wf?.metadata?.displayName || ''
        try {
          const cdnUrl = await resolveMediaUrl(mediaId)
          if (!cdnUrl) {
            console.warn('[Gallery] no URL resolved for', mediaId.substring(0, 8))
            return null
          }
          return { mediaId, url: cdnUrl, displayName }
        } catch (e) {
          console.warn('[Gallery] resolve url failed for', mediaId.substring(0, 8), e.message)
          return null
        }
      }
      const results = []
      for (let i = 0; i < images.length; i += MEDIA_RESOLVE_CONCURRENCY) {
        const slice = images.slice(i, i + MEDIA_RESOLVE_CONCURRENCY)
        const batch = await Promise.all(slice.map(resolveItem))
        results.push(...batch)
      }

      const filtered = results.filter(Boolean)
      console.log(`[Gallery] ${filtered.length} image items extracted`)
      return { success: true, items: filtered }
    } catch (e) {
      console.error('[Gallery] Error:', e.message)
      return { success: false, error: e.message, items: [] }
    }
  })

  // ─── Image Upscale (DOM 방식: three-dots → download → 해상도 선택 → 파일 캡처) ───
  // 비디오 DOM 다운로드와 동일한 패턴. Flow UI가 reCAPTCHA를 내부적으로 처리.
  ipcMain.handle('flow:upscale-image', async (event, { token, mediaId, projectId, resolution }) => {
    if (!flowActive()) return { success: false, error: 'Flow inactive (API mode)' }  // #R25-4
    const flowView = getFlowView()
    if (!flowView) return { success: false, error: 'Flow view not ready' }
    if (!mediaId) return { success: false, error: 'No mediaId' }
    // CDP 없이도 동작 — will-download 핸들러가 path 지정.

    const normalizedRes = String(resolution || '2k').toLowerCase()
    const resText = normalizedRes === '4k' ? '4K' : '2K'

    console.log('[Flow Image Upscale] Starting DOM upscale — mediaId:', mediaId?.substring(0, 30), 'resolution:', resText)

    // R14-P1: 공유 session will-download 경합 방지 — 다운로드/업스케일을 직렬화.
    const releaseDownloadLock = await downloadMutex.acquire()

    let willDownloadHandler = null
    // #R11-9: tempDir 를 try 밖에 둬 finally 에서 항상 정리(예외 경로 누수 방지).
    let tempDir = null
    const dlSession = flowView.webContents.session

    try {
      const fs = await import('node:fs')
      const os = await import('node:os')

      // Step 1: 다운로드 path 가로채기 (Electron session.will-download — CDP 무관)
      tempDir = path.join(os.tmpdir(), `flow-img-up-${Date.now()}`)
      fs.mkdirSync(tempDir, { recursive: true })
      console.log('[Flow Image Upscale] Download dir:', tempDir)

      willDownloadHandler = (_event, item) => {
        const filename = item.getFilename()
        const savePath = path.join(tempDir, filename)
        console.log('[Flow Image Upscale] will-download intercept:', filename, '→', savePath)
        item.setSavePath(savePath)
      }
      dlSession.on('will-download', willDownloadHandler)

      // Step 2: DOM 자동화 — 이미지 hover → three-dots → download → 해상도 선택
      const domResult = await flowView.webContents.executeJavaScript(`
        (async function() {
          const LOG = (msg) => console.log('[ImageUpscale] ' + msg)
          const mediaId = ${JSON.stringify(mediaId)}
          const resText = ${JSON.stringify(resText)}

          // --- Helpers (flow:dom-download-video와 동일) ---
          function pointerClick(el) {
            if (!el) return
            const rect = el.getBoundingClientRect()
            const x = rect.left + rect.width / 2
            const y = rect.top + rect.height / 2
            const pOpts = { bubbles: true, cancelable: true, composed: true, clientX: x, clientY: y, pointerId: 1, pointerType: 'mouse', isPrimary: true }
            el.dispatchEvent(new PointerEvent('pointerdown', pOpts))
            el.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true, clientX: x, clientY: y, button: 0 }))
            el.dispatchEvent(new PointerEvent('pointerup', pOpts))
            el.dispatchEvent(new MouseEvent('mouseup', { bubbles: true, cancelable: true, clientX: x, clientY: y, button: 0 }))
            el.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, clientX: x, clientY: y, button: 0 }))
          }

          async function waitForMenu(ms = 2000) {
            const t0 = Date.now()
            while (Date.now() - t0 < ms) {
              const m = document.querySelector("[data-radix-menu-content][data-state='open'], [role='menu'][data-state='open']")
              if (m) return m
              await new Promise(r => setTimeout(r, 80))
            }
            return null
          }

          async function closeMenus() {
            for (let i = 0; i < 3; i++) {
              if (!document.querySelector("[data-radix-menu-content][data-state='open'], [role='menu'][data-state='open']")) break
              document.activeElement?.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', keyCode: 27, bubbles: true, cancelable: true, composed: true }))
              await new Promise(r => setTimeout(r, 150))
            }
          }

          const ICON_SEL = "i, .material-symbols, .material-symbols-outlined, .google-symbols, [class*='material-symbols']"

          function findImageElement(uuid) {
            if (!uuid) return null
            for (const el of document.querySelectorAll('img[src]')) {
              const src = el.getAttribute('src') || ''
              const resolved = el.src || ''
              if (src.includes(uuid) || resolved.includes(uuid)) return el
            }
            return null
          }

          function findTileWithOverlay(mediaEl) {
            if (!mediaEl) return null
            let node = mediaEl.parentElement
            for (let i = 0; i < 10 && node; i++) {
              if (Array.from(node.querySelectorAll(ICON_SEL)).some(icon => {
                const t = (icon.textContent || '').trim().toLowerCase()
                return t === 'more_vert' || t === 'more_horiz'
              })) return node
              node = node.parentElement
            }
            return null
          }

          function findThreeDots(scope) {
            if (!scope) return null
            for (const icon of scope.querySelectorAll(ICON_SEL)) {
              const t = (icon.textContent || '').trim().toLowerCase()
              if (t === 'more_vert' || t === 'more_horiz')
                return icon.closest('button') || icon.parentElement
            }
            return null
          }

          function findMenuItem(menu, iconText) {
            if (!menu) return null
            const needle = iconText.toLowerCase()
            for (const item of menu.querySelectorAll("[role='menuitem']")) {
              for (const icon of item.querySelectorAll(ICON_SEL))
                if ((icon.textContent || '').trim().toLowerCase() === needle) return item
              if ((item.textContent || '').trim().toLowerCase().startsWith(needle)) return item
            }
            return null
          }

          function unhover(el) {
            if (!el) return
            el.dispatchEvent(new MouseEvent('mouseleave', { bubbles: true }))
            el.dispatchEvent(new MouseEvent('mouseout', { bubbles: true }))
            let node = el.parentElement
            for (let i = 0; i < 4 && node; i++) {
              node.dispatchEvent(new MouseEvent('mouseleave', { bubbles: true }))
              node.dispatchEvent(new MouseEvent('mouseout', { bubbles: true }))
              node = node.parentElement
            }
          }

          try {
            // 1. 이미지 요소 찾기
            LOG('Finding image for: ' + mediaId.substring(0, 30))
            const targetImg = findImageElement(mediaId)
            if (!targetImg) {
              return { success: false, error: 'Image element not found on page' }
            }
            LOG('Found image, src: ' + (targetImg.getAttribute('src') || '').substring(0, 60))

            // 2. Hover — 오버레이 표시
            targetImg.dispatchEvent(new MouseEvent('mouseenter', { bubbles: true }))
            targetImg.dispatchEvent(new MouseEvent('mouseover', { bubbles: true }))
            let hoverNode = targetImg.parentElement
            for (let i = 0; i < 4 && hoverNode; i++) {
              hoverNode.dispatchEvent(new MouseEvent('mouseenter', { bubbles: true }))
              hoverNode.dispatchEvent(new MouseEvent('mouseover', { bubbles: true }))
              hoverNode = hoverNode.parentElement
            }
            await new Promise(r => setTimeout(r, 500))

            // 3. Tile 찾기 (more_vert/more_horiz 포함)
            const tile = findTileWithOverlay(targetImg)
            if (!tile) {
              unhover(targetImg)
              return { success: false, error: 'Overlay tile not found after hover' }
            }

            // 4. Three-dots 버튼 클릭
            const threeDotsBtn = findThreeDots(tile)
            if (!threeDotsBtn) {
              unhover(targetImg)
              return { success: false, error: 'Three-dots button not found in tile' }
            }
            LOG('Clicking three-dots button')
            pointerClick(threeDotsBtn)
            await new Promise(r => setTimeout(r, 300))

            // 5. 메뉴 대기 (재시도 1회)
            let menu = await waitForMenu(2000)
            if (!menu) {
              pointerClick(threeDotsBtn)
              menu = await waitForMenu(2000)
            }
            if (!menu) {
              unhover(targetImg)
              return { success: false, error: 'Context menu did not open' }
            }
            LOG('Context menu opened')

            // 6. "download" 메뉴 아이템 찾기
            const downloadItem = findMenuItem(menu, 'download')
            if (!downloadItem) {
              const items = Array.from(menu.querySelectorAll("[role='menuitem']")).map(i => i.textContent?.trim())
              LOG('Download item not found. Items: ' + JSON.stringify(items))
              await closeMenus()
              unhover(targetImg)
              return { success: false, error: 'Download menu item not found. Items: ' + items.join(', ') }
            }
            LOG('Hovering Download menu item to open submenu')

            // 7. Download 호버 → 서브메뉴 열기 (Radix UI 호환)
            const dlRect = downloadItem.getBoundingClientRect()
            const dlX = dlRect.left + dlRect.width / 2
            const dlY = dlRect.top + dlRect.height / 2
            const hoverOpts = { bubbles: true, cancelable: true, clientX: dlX, clientY: dlY, pointerId: 1, pointerType: 'mouse', isPrimary: true }

            downloadItem.focus?.()
            downloadItem.setAttribute?.('data-highlighted', '')
            downloadItem.dispatchEvent(new PointerEvent('pointerenter', { ...hoverOpts, composed: true }))
            downloadItem.dispatchEvent(new PointerEvent('pointermove', { ...hoverOpts, composed: true }))
            downloadItem.dispatchEvent(new MouseEvent('mouseover', { bubbles: true, clientX: dlX, clientY: dlY }))
            downloadItem.dispatchEvent(new MouseEvent('mouseenter', { bubbles: true, clientX: dlX, clientY: dlY }))
            downloadItem.dispatchEvent(new MouseEvent('mousemove', { bubbles: true, clientX: dlX, clientY: dlY }))
            await new Promise(r => setTimeout(r, 400))

            // 8. 서브메뉴 대기 (jitter 포함)
            let submenu = null
            for (let attempt = 0; attempt < 20; attempt++) {
              const openMenus = document.querySelectorAll("[data-radix-menu-content][data-state='open'], [role='menu'][data-state='open']")
              if (openMenus.length >= 2) {
                submenu = openMenus[openMenus.length - 1]
                break
              }
              if (attempt % 3 === 2) {
                const jX = dlX + (attempt % 2 === 0 ? 2 : -2)
                const jY = dlY + (attempt % 2 === 0 ? 1 : -1)
                const jOpts = { ...hoverOpts, clientX: jX, clientY: jY }
                downloadItem.dispatchEvent(new PointerEvent('pointermove', { ...jOpts, composed: true }))
                downloadItem.dispatchEvent(new PointerEvent('pointerenter', { ...jOpts, composed: true }))
                downloadItem.dispatchEvent(new MouseEvent('mouseover', { bubbles: true, clientX: jX, clientY: jY }))
                downloadItem.dispatchEvent(new MouseEvent('mousemove', { bubbles: true, clientX: jX, clientY: jY }))
              }
              await new Promise(r => setTimeout(r, 200))
            }

            // 9. 해상도 선택 (이미지: 1K/2K/4K)
            if (submenu) {
              LOG('Submenu opened! Looking for resolution: ' + resText)
              const submenuItems = Array.from(submenu.querySelectorAll("[role='menuitem']"))
              LOG('Submenu items: ' + submenuItems.map(i => i.textContent?.trim()).join(', '))
              let resOption = null
              for (const item of submenuItems) {
                if ((item.textContent || '').includes(resText)) {
                  resOption = item
                  break
                }
              }
              if (resOption) {
                pointerClick(resOption)
                LOG('Clicked resolution: ' + resText)
                await closeMenus()
                unhover(targetImg)
                return { success: true, resolution: resText }
              }
            }

            // 10. 서브메뉴 안 열리면 click + keyboard fallback
            if (!submenu) {
              LOG('Submenu did not open, trying click + keyboard fallback')
              pointerClick(downloadItem)
              await new Promise(r => setTimeout(r, 400))
              downloadItem.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true, cancelable: true }))
              await new Promise(r => setTimeout(r, 400))

              for (const item of document.querySelectorAll("[role='menuitem']")) {
                if ((item.textContent || '').includes(resText)) {
                  pointerClick(item)
                  LOG('Clicked resolution (keyboard fallback): ' + resText)
                  await closeMenus()
                  unhover(targetImg)
                  return { success: true, resolution: resText }
                }
              }
            }

            // 11. 해상도 옵션 없으면 직접 다운로드 (원본)
            LOG('No resolution submenu, clicking download directly')
            pointerClick(downloadItem)
            await closeMenus()
            unhover(targetImg)
            return { success: true, resolution: 'default' }

          } catch (e) {
            try { await closeMenus() } catch {}
            return { success: false, error: e.message }
          }
        })()
      `)

      console.log('[Flow Image Upscale] DOM automation result:', JSON.stringify(domResult))

      if (!domResult.success) {
        try { fs.rmSync(tempDir, { recursive: true, force: true }) } catch {}
        return { success: false, error: `DOM: ${domResult.error}` }
      }

      // Step 3: temp 디렉토리에서 다운로드 파일 대기 (폴링)
      console.log('[Flow Image Upscale] Waiting for download file in:', tempDir)
      let downloadedFile = null
      const maxWait = IMAGE_UPSCALE_TIMEOUT_MS // 2분 (이미지 업스케일)
      const startTime = Date.now()

      while (Date.now() - startTime < maxWait) {
        await new Promise(r => setTimeout(r, 1000))

        try {
          const files = fs.readdirSync(tempDir)
            .filter(f => !f.endsWith('.crdownload') && !f.endsWith('.tmp') && !f.startsWith('.'))

          if (files.length > 0) {
            const filePath = path.join(tempDir, files[0])
            const stats = fs.statSync(filePath)

            // 파일 크기 안정화 확인
            await new Promise(r => setTimeout(r, 1000))
            const stats2 = fs.statSync(filePath)

            if (stats.size === stats2.size && stats.size > 0) {
              downloadedFile = filePath
              console.log('[Flow Image Upscale] File ready:', files[0], 'size:', stats.size)
              break
            }
          }
        } catch {}
      }

      // will-download 핸들러 해제 (CDP setDownloadBehavior reset 대체)
      if (willDownloadHandler) {
        dlSession.off('will-download', willDownloadHandler)
        willDownloadHandler = null
      }

      // 업스케일 완료 토스트 닫기
      try {
        await flowView.webContents.executeJavaScript(`
          (function() {
            const buttons = Array.from(document.querySelectorAll('button'))
            for (const btn of buttons) {
              const text = (btn.textContent || '').trim()
              if (text === '닫기' || text === 'Close') { btn.click(); break }
            }
          })()
        `)
      } catch {}

      if (!downloadedFile) {
        try { fs.rmSync(tempDir, { recursive: true, force: true }) } catch {}
        return { success: false, error: 'Download timeout — no file appeared in temp dir' }
      }

      // Step 4: 파일 읽기 → base64 (data URL)
      try {
        const data = fs.readFileSync(downloadedFile)
        const ext = path.extname(downloadedFile).toLowerCase()
        const mimeType = ext === '.jpg' || ext === '.jpeg' ? 'image/jpeg'
          : ext === '.webp' ? 'image/webp' : 'image/png'
        const base64DataUrl = `data:${mimeType};base64,${data.toString('base64')}`
        console.log('[Flow Image Upscale] ✅ Success — size:', data.length, 'bytes, type:', mimeType)

        try { fs.rmSync(tempDir, { recursive: true, force: true }) } catch {}
        return { success: true, data: base64DataUrl }
      } catch (readErr) {
        try { fs.rmSync(tempDir, { recursive: true, force: true }) } catch {}
        return { success: false, error: `File read error: ${readErr.message}` }
      }

    } catch (e) {
      console.error('[Flow Image Upscale] Error:', e.message)
      return { success: false, error: e.message }
    } finally {
      // R13-P2: early return(DOM 실패 등)/throw 경로에서도 will-download 리스너 누수 방지(idempotent).
      if (willDownloadHandler) {
        dlSession.off('will-download', willDownloadHandler)
        willDownloadHandler = null
      }
      // #R11-9: 예외 등 어떤 종료 경로든 temp 디렉터리 정리(중간 rmSync 와 idempotent).
      if (tempDir) { try { (await import('node:fs')).rmSync(tempDir, { recursive: true, force: true }) } catch { /* ignore */ } }
      releaseDownloadLock()  // R14-P1
    }
  })
}
