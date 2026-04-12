/**
 * AppClient — AutoFlowCut Electron 앱과의 HTTP 통신 클라이언트
 */

import http from 'http';

/**
 * AutoFlowCut 앱의 MCP HTTP 서버에 요청 보내기
 * @param {number} port - HTTP 포트 (기본: 3210)
 * @param {string} method - HTTP 메서드
 * @param {string} pathname - 요청 경로
 * @param {object|null} body - 요청 바디
 * @returns {Promise<{ status: number, data: any }>}
 */
export function appFetch(port, method, pathname, body = null) {
  return new Promise((resolve, reject) => {
    const options = {
      hostname: '127.0.0.1',
      port: port || 3210,
      path: pathname,
      method,
      headers: { 'Content-Type': 'application/json' },
    };
    const req = http.request(options, (res) => {
      let data = '';
      res.on('data', chunk => { data += chunk; });
      res.on('end', () => {
        try {
          resolve({ status: res.statusCode, data: JSON.parse(data) });
        } catch {
          resolve({ status: res.statusCode, data });
        }
      });
    });
    req.on('error', (err) => reject(err));
    if (body) req.write(JSON.stringify(body));
    req.end();
  });
}
