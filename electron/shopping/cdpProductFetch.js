import { execFile } from 'node:child_process'
import { constants as fsConstants } from 'node:fs'
import { access as fsAccess, mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { promisify } from 'node:util'

const PRODUCT_PATH = /^\/vp\/products\/\d+\/?$/
const SOURCE_URL_LIMIT = 2_048
const TRUST = 'untrusted-web-data'
const HOME_URL = 'https://www.coupang.com/'
const DEFAULT_WARMUP_MS = 2_500
const DEFAULT_NAV_TIMEOUT_MS = 40_000
const DEFAULT_EXTRACT_TIMEOUT_MS = 15_000
const EXTRACT_POLL_MS = 750
const BROWSER_CLOSE_TIMEOUT_MS = 5_000
const execFileAsync = promisify(execFile)

const MAC_EXECUTABLES = Object.freeze([
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  '/Applications/Brave Browser.app/Contents/MacOS/Brave Browser',
  '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge',
  '/Applications/Chromium.app/Contents/MacOS/Chromium',
])

const WINDOWS_BROWSER_PATHS = Object.freeze([
  ['Google', 'Chrome', 'Application', 'chrome.exe'],
  ['BraveSoftware', 'Brave-Browser', 'Application', 'brave.exe'],
  ['Microsoft', 'Edge', 'Application', 'msedge.exe'],
  ['Chromium', 'Application', 'chrome.exe'],
])

const LINUX_COMMANDS = Object.freeze([
  'google-chrome',
  'brave-browser',
  'microsoft-edge',
  'chromium',
  'chromium-browser',
])

function noBrowserFound() {
  return Object.assign(new Error('no-browser-found'), { code: 'no-browser-found' })
}

async function defaultWhich(command) {
  try {
    const { stdout } = await execFileAsync('which', [command])
    return stdout.trim() || undefined
  } catch {
    return undefined
  }
}

export function createBrowserExecutableFinder({
  platform = process.platform,
  env = process.env,
  access = fsAccess,
  which = defaultWhich,
} = {}) {
  return async function findInstalledBrowser() {
    if (platform === 'linux') {
      for (const command of LINUX_COMMANDS) {
        const executable = await which(command)
        if (typeof executable === 'string' && executable.trim()) return executable.trim()
      }
      throw noBrowserFound()
    }

    let candidates = []
    if (platform === 'darwin') {
      candidates = MAC_EXECUTABLES
    } else if (platform === 'win32') {
      const roots = [env.PROGRAMFILES, env['PROGRAMFILES(X86)'], env.LOCALAPPDATA]
        .filter((root) => typeof root === 'string' && root)
      candidates = WINDOWS_BROWSER_PATHS.flatMap((parts) => (
        roots.map((root) => path.win32.join(root, ...parts))
      ))
    }

    for (const candidate of candidates) {
      try {
        await access(candidate, fsConstants.X_OK)
        return candidate
      } catch {
        // Keep searching in explicit browser preference order.
      }
    }
    throw noBrowserFound()
  }
}

export const findBrowserExecutable = createBrowserExecutableFinder()

function unsupported(reason) {
  return { status: 'unsupported', trust: TRUST, reason }
}

function abortError(reason) {
  if (reason?.name === 'AbortError') return reason
  const message = typeof reason?.message === 'string'
    ? reason.message
    : 'The operation was aborted'
  return new DOMException(message, 'AbortError')
}

function abortIfNeeded(signal) {
  if (signal?.aborted) throw abortError(signal.reason)
}

function abortable(promise, signal) {
  if (!signal) return promise
  abortIfNeeded(signal)
  return new Promise((resolve, reject) => {
    const onAbort = () => {
      signal.removeEventListener('abort', onAbort)
      reject(abortError(signal.reason))
    }
    signal.addEventListener('abort', onAbort, { once: true })
    promise.then(
      (value) => {
        signal.removeEventListener('abort', onAbort)
        resolve(value)
      },
      (error) => {
        signal.removeEventListener('abort', onAbort)
        reject(error)
      },
    )
  })
}

function delay(milliseconds, signal) {
  if (milliseconds <= 0) {
    abortIfNeeded(signal)
    return Promise.resolve()
  }
  return abortable(new Promise((resolve) => setTimeout(resolve, milliseconds)), signal)
}

function normalizePositiveDuration(value, name) {
  if (!Number.isFinite(value) || value < 0) {
    throw new TypeError(`${name} must be a non-negative finite number`)
  }
  return value
}

function errorMessage(error) {
  return typeof error?.message === 'string' ? error.message : String(error)
}

async function closeBrowserBestEffort(browser) {
  if (!browser) return
  let timeoutId
  try {
    await Promise.race([
      Promise.resolve().then(() => browser.close()),
      new Promise((_, reject) => {
        timeoutId = setTimeout(() => reject(new Error('browser-close-timeout')), BROWSER_CLOSE_TIMEOUT_MS)
      }),
    ])
  } catch (error) {
    console.warn('[Shopping CDP] browser cleanup failed:', errorMessage(error))
  } finally {
    clearTimeout(timeoutId)
  }
}

async function removeProfileBestEffort(profileDirectory) {
  if (!profileDirectory) return
  try {
    await rm(profileDirectory, {
      recursive: true,
      force: true,
      maxRetries: 2,
    })
  } catch (error) {
    console.warn('[Shopping CDP] profile cleanup failed:', errorMessage(error))
  }
}

function createSourceFacts(product, imageUrls, sourceUrl) {
  const facts = []
  for (const [field, value] of Object.entries(product)) {
    facts.push({
      field,
      value,
      sourceKind: 'dom',
      sourceUrl,
      jsonPathOrProperty: `document:${field}`,
      verification: 'page-rendered',
      trust: TRUST,
    })
  }
  for (const imageUrl of imageUrls) {
    facts.push({
      field: 'imageUrls',
      value: imageUrl,
      sourceKind: 'dom',
      sourceUrl,
      jsonPathOrProperty: 'document:img[src]',
      verification: 'page-rendered',
      trust: TRUST,
    })
  }
  return facts
}

export function validateCoupangProductUrl(rawUrl) {
  if (
    typeof rawUrl !== 'string'
    || rawUrl.length > SOURCE_URL_LIMIT
    || rawUrl.includes('\\')
    || rawUrl.includes('#')
  ) {
    throw new Error('URL not allowed')
  }

  const authority = rawUrl.match(/^https:\/\/([^/?#]+)/i)?.[1]?.toLowerCase()
  if (authority !== 'coupang.com' && authority !== 'www.coupang.com') {
    throw new Error('URL not allowed')
  }

  let url
  try {
    url = new URL(rawUrl)
  } catch {
    throw new Error('URL not allowed')
  }
  if (
    url.protocol !== 'https:'
    || url.port
    || url.username
    || url.password
    || url.hash
    || !PRODUCT_PATH.test(url.pathname)
  ) {
    throw new Error('URL not allowed')
  }
  return url
}

export function createCdpProductFetch({
  launchBrowser,
  findBrowserExecutable: findExecutable,
  now = Date.now,
  warmupMs = DEFAULT_WARMUP_MS,
  navTimeoutMs = DEFAULT_NAV_TIMEOUT_MS,
  extractTimeoutMs = DEFAULT_EXTRACT_TIMEOUT_MS,
} = {}) {
  if (typeof launchBrowser !== 'function') throw new TypeError('launchBrowser must be a function')
  if (typeof findExecutable !== 'function') {
    throw new TypeError('findBrowserExecutable must be a function')
  }
  if (typeof now !== 'function') throw new TypeError('now must be a function')
  const admittedWarmupMs = normalizePositiveDuration(warmupMs, 'warmupMs')
  const admittedNavTimeoutMs = normalizePositiveDuration(navTimeoutMs, 'navTimeoutMs')
  const admittedExtractTimeoutMs = normalizePositiveDuration(extractTimeoutMs, 'extractTimeoutMs')

  return async function cdpProductFetch(rawUrl, { signal } = {}) {
    const initialUrl = validateCoupangProductUrl(rawUrl)
    abortIfNeeded(signal)
    const executablePath = await abortable(Promise.resolve().then(() => findExecutable()), signal)
    abortIfNeeded(signal)

    let browser
    let profileDirectory
    try {
      profileDirectory = await mkdtemp(path.join(tmpdir(), 'autoflowcut-coupang-'))
      abortIfNeeded(signal)
      try {
        browser = await launchBrowser({
          executablePath,
          headless: false,
          args: [
            '--disable-blink-features=AutomationControlled',
            '--no-first-run',
            '--no-default-browser-check',
          ],
          ignoreDefaultArgs: ['--enable-automation'],
          userDataDir: profileDirectory,
        })
      } catch (error) {
        abortIfNeeded(signal)
        throw error
      }
      // Launch itself is not cancellable. Wait for it to settle so a browser
      // created just after cancellation is still closed by the shared finally.
      abortIfNeeded(signal)
      const page = await abortable(browser.newPage(), signal)
      const navigationOptions = {
        waitUntil: 'domcontentloaded',
        timeout: admittedNavTimeoutMs,
      }

      await abortable(page.goto(HOME_URL, navigationOptions), signal)
      await delay(admittedWarmupMs, signal)
      await abortable(page.goto(initialUrl.toString(), navigationOptions), signal)

      const deadline = now() + admittedExtractTimeoutMs
      while (true) {
        abortIfNeeded(signal)
        // This anonymous function runs inside an untrusted page and must stay
        // self-contained so bundler/minifier symbol names cannot leak into it.
        const extraction = await abortable(page.evaluate(() => {
          const textOf = (element) => (element?.textContent || '').replace(/\s+/gu, ' ').trim()
          const bodyText = textOf(document.body)
          const title = String(document.title || '').trim()
          const errorImage = Array.from(document.images).some((image) => {
            const source = String(image.currentSrc || image.src || '').toLowerCase()
            return source.includes('err-re.gif') || source.includes('logo-coupang.gif')
          })
          if (title === '쿠팡!' || /access denied/iu.test(bodyText) || errorImage) {
            return { errorPage: true, sourceUrl: String(location.href) }
          }

          const hasCoupangMarker = /\s*\|\s*쿠팡.*$/u.test(title)
          const cleanedTitle = hasCoupangMarker
            ? title
              .replace(/\s*\|\s*쿠팡.*$/u, '')
              .replace(/\s+-\s+[^-]*$/u, '')
              .trim()
            : title
          const name = cleanedTitle || textOf(document.querySelector('h1'))
            || textOf(document.querySelector('h2.prod-buy-header__title'))

          const parseKrw = (value) => {
            const match = String(value || '').match(/(\d[\d,\s]*)\s*원/u)
            if (!match) return undefined
            const parsed = Number(match[1].replace(/[^\d]/gu, ''))
            return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : undefined
          }
          const firstText = (selectors) => {
            for (const selector of selectors) {
              const value = textOf(document.querySelector(selector))
              if (value) return value
            }
            return ''
          }
          const bodyPrices = Array.from(bodyText.matchAll(/(\d[\d,\s]*)\s*원/gu))
            .map((match) => Number(match[1].replace(/[^\d]/gu, '')))
            .filter((value) => Number.isSafeInteger(value) && value > 0)

          // Provisional selectors — 사용자 눈검증서 실제 DOM으로 확정.
          const priceKrw = parseKrw(firstText([
            '.total-price',
            '[class*="price"] strong',
            '[class*="Price"]',
          ])) || bodyPrices[0]
          // 셀렉터 miss 시 첫 `원` 값은 배송비/적립금일 수 있어 사용자 눈검증서 확인 필요.
          // Provisional selectors — 사용자 눈검증서 실제 DOM으로 확정.
          const listPriceKrw = parseKrw(firstText([
            '.origin-price',
            '.prod-origin-price',
            '[class*="original-price"]',
            '[class*="list-price"]',
            '[class*="ListPrice"]',
          ]))

          const imageUrls = []
          const seenImages = new Set()
          for (const image of document.querySelectorAll('img[src*="coupangcdn.com"]')) {
            if (imageUrls.length >= 5) break
            let imageUrl
            try {
              imageUrl = new URL(image.currentSrc || image.src, location.href)
            } catch {
              continue
            }
            const hostname = imageUrl.hostname.toLowerCase()
            const source = imageUrl.toString()
            const lowerSource = source.toLowerCase()
            if (
              imageUrl.protocol !== 'https:'
              || (hostname !== 'coupangcdn.com' && !hostname.endsWith('.coupangcdn.com'))
              || lowerSource.includes('/error/')
              || lowerSource.includes('err-')
              || lowerSource.includes('logo-coupang')
              || seenImages.has(source)
            ) continue
            seenImages.add(source)
            imageUrls.push(source)
          }

          return {
            errorPage: false,
            sourceUrl: String(location.href),
            name,
            priceKrw,
            listPriceKrw,
            imageUrls,
          }
        }), signal)

        if (typeof extraction?.name === 'string' && extraction.name.trim()) {
          const product = { name: extraction.name.trim() }
          if (Number.isSafeInteger(extraction.priceKrw) && extraction.priceKrw > 0) {
            product.priceKrw = extraction.priceKrw
            product.currency = 'KRW'
          }
          if (Number.isSafeInteger(extraction.listPriceKrw) && extraction.listPriceKrw > 0) {
            product.listPriceKrw = extraction.listPriceKrw
          }
          if (product.priceKrw && product.listPriceKrw) {
            const derivedDiscount = Math.round((1 - product.priceKrw / product.listPriceKrw) * 100)
            if (derivedDiscount >= 0 && derivedDiscount <= 100) {
              product.discountPercent = derivedDiscount
            }
          }
          const sourceUrl = typeof extraction.sourceUrl === 'string'
            ? extraction.sourceUrl
            : initialUrl.toString()
          const imageUrls = Array.isArray(extraction.imageUrls)
            ? extraction.imageUrls.slice(0, 5)
            : []
          return {
            status: 'ok',
            trust: TRUST,
            sourceUrl,
            product,
            sourceFacts: createSourceFacts(product, imageUrls, sourceUrl),
            imageUrls,
          }
        }

        const remaining = deadline - now()
        if (remaining <= 0) {
          return extraction?.errorPage
            ? unsupported('Coupang blocked or error page rendered')
            : unsupported('Rendered product data could not be extracted')
        }
        await delay(Math.min(EXTRACT_POLL_MS, remaining), signal)
      }
    } finally {
      await closeBrowserBestEffort(browser)
      await removeProfileBestEffort(profileDirectory)
    }
  }
}
