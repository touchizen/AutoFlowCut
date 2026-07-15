/**
 * 임포트 텍스트 파일(SRT/CSV/TXT)의 인코딩 감지 + 디코딩.
 *
 * FileReader.readAsText(file) 는 인코딩을 안 주면 **무조건 UTF-8** 로 해석한다. 사용자가 어디서
 * 받았는지 모르는 자막 파일에는 그 가정이 안 통한다:
 *   - Windows 메모장 "유니코드" 저장 → UTF-16 (BOM 있음)
 *   - 한국 자막 도구 → CP949/EUC-KR (BOM 없음)
 * 이 경우 파싱은 "성공"하고 에러도 안 뜬 채 **자막 내용만 깨져서** 들어간다. 그래서 조용히 넘어가지
 * 않도록 바이트를 직접 보고 고른다.
 */

/** BOM 으로 확정할 수 있는 것들. (WHATWG 'euc-kr' 디코더는 CP949 상위집합이다.) */
const BOMS = [
  { bom: [0xef, 0xbb, 0xbf], encoding: 'utf-8' },
  { bom: [0xff, 0xfe], encoding: 'utf-16le' },
  { bom: [0xfe, 0xff], encoding: 'utf-16be' },
]

const startsWith = (bytes, bom) => bom.every((b, i) => bytes[i] === b)

/**
 * @param {ArrayBuffer|Uint8Array} input 파일 바이트
 * @returns {string} 디코딩된 텍스트 (BOM 은 제거된다)
 */
export function decodeTextBytes(input) {
  const bytes = input instanceof Uint8Array ? input : new Uint8Array(input)
  if (!bytes.length) return ''

  for (const { bom, encoding } of BOMS) {
    if (startsWith(bytes, bom)) {
      return new TextDecoder(encoding).decode(bytes.subarray(bom.length))
    }
  }

  // BOM 이 없다 → UTF-8 로 엄격하게 시도한다. 유효한 UTF-8 이면 그게 정답이다
  //   (ASCII 도 여기로 들어온다 — CP949 와 바이트가 같으므로 결과도 같다).
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(bytes)
  } catch {
    // UTF-8 로 성립하지 않는 바이트열 → 한국어 사용자의 압도적 다수는 CP949 다.
    return new TextDecoder('euc-kr').decode(bytes)
  }
}

/**
 * File → 텍스트. readAsText 와 달리 인코딩을 감지한다.
 * @param {File|Blob} file
 * @returns {Promise<string>}
 */
export async function readTextFile(file) {
  return decodeTextBytes(await file.arrayBuffer())
}
