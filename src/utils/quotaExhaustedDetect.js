/**
 * 호환 layer — 기존 import 경로 유지.
 *
 * 실제 구현은 src/utils/quotaStop.js 의 단일 모듈로 통합됐다. 새 코드는
 * `from '../utils/quotaStop'` 를 직접 import 할 것.
 */
export { isQuotaExhaustedError } from './quotaStop'
