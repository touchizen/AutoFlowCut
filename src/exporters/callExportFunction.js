/**
 * Cloud Functions 익스포터 호출 공통 헬퍼
 *
 * CapCut/Premiere/Vrew 가 공유: env(test/prod) suffix 선택, JSON-safe sanitize,
 * APP_ID 주입, 호출, 선택적 응답 검증. 각 익스포터는 functionBaseName 과 (선택)
 * validate 콜백만 제공한다.
 */

import { getFunctions, httpsCallable } from 'firebase/functions';
import { APP_ID } from '../firebase/config';

/**
 * @param {string} functionBaseName - suffix 없는 함수명 (예: 'generateVrewJson')
 * @param {Object} requestData - cloudRequest 페이로드
 * @param {{ logLabel?: string, validate?: (data: any) => void }} [opts]
 * @returns {Promise<any>} callable 응답 data
 */
export async function callExportFunction(functionBaseName, requestData, opts = {}) {
  const { logLabel, validate } = opts;
  const functions = getFunctions();
  const suffix = import.meta.env.VITE_FUNCTION_ENV === 'prod' ? '_prod' : '_test';
  const callable = httpsCallable(functions, `${functionBaseName}${suffix}`);

  // undefined/NaN 제거 (Firebase httpsCallable 은 JSON-safe 값만 허용)
  const sanitized = JSON.parse(JSON.stringify(requestData, (key, value) =>
    value === undefined || (typeof value === 'number' && !isFinite(value)) ? null : value
  ));

  if (logLabel) {
    console.log(`[${logLabel}] Calling ${functionBaseName}${suffix} with`, sanitized.scenes?.length, 'scenes');
  }

  const result = await callable({ ...sanitized, appId: APP_ID });
  const data = result?.data;
  if (validate) validate(data);
  return data;
}

export default {
  callExportFunction,
};
