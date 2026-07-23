# M1a 작업 지시 — `safeHttpFetch` socket-pinned SSRF primitive (TDD)

너(Codex)는 이 모듈의 저자다. **TDD 로 간다: 실패하는 테스트 먼저 → 최소 구현 → GREEN → 리팩터.**
코드는 이 worktree(`/Users/tuxxon/workspace/AutoFlowCut-shoppingshorts`, 브랜치 `feature/shopping-shorts`)에만 쓴다.

## 무엇을 만드나
쇼핑 숏츠의 상품 크롤이 쓸 **socket-pinned, SSRF-safe 공통 fetch primitive**. HTML 페이지와 이미지가 **같은 primitive** 를 쓴다.
파일: `electron/api/net/safeHttpFetch.js` + 테스트 `tests/electron/api/net/safeHttpFetch.test.js`.

이번 M1a 스코프는 **primitive 하나뿐**이다. 쿠팡 파서(M1b), 에이전트 툴 배선(M1c)은 별도 작업이니 **건드리지 마라.**

## 권위 스펙 (반드시 직접 열어 읽어라)
`docs/handoffs/2026-07-23-shopping-shorts-spec.md` 의 **§D3.1 / §D3.2 / §D3.3** 이 이 모듈의 전체 계약이다.
그리고 테스트 요구는 **§6.1**. 요약하지 말고 원문을 따르되, 아래는 놓치기 쉬운 핵심:

- **D3.1 URL·redirect**: 입력·모든 redirect hop 에서 `https:` + 포트 443 만. userinfo/IP literal/fragment/빈 hostname 거부. hostname 은 URL parser 로 punycode 정규화 + trailing dot 제거 후 host allowlist 비교. HTML host = exact `{coupang.com, www.coupang.com}`, 이미지 host = `coupangcdn.com` 또는 `*.coupangcdn.com`. **`link.coupang.com` 등 다른 서브도메인도 MVP 는 unsupported.** redirect 는 `new URL(location, currentUrl)` 로 상대 해석, HTTPS→HTTP downgrade/host 이탈/userinfo/비표준 포트 거부. **최대 3 hop, 각 hop 에서 URL·DNS 정책 처음부터 재적용.**
- **D3.2 DNS-소켓 결합 (이 모듈의 급소)**:
  1. hop hostname 을 `all:true, verbatim:true` 로 A/AAAA 해석
  2. **모든** 응답 주소가 public 인지 검사. 하나라도 금지 대역이면 mixed 전체 거부.
  3. 통과 주소 하나를 **결정론적으로** 선택
  4. hop 전용 custom `lookup` 이 그 선택 주소·family 만 반환하게 해 소켓 고정
  5. TLS SNI + HTTP Host 는 원래 hostname 유지, 인증서는 hostname 으로 검증
  6. **연결 단계에서 일반 DNS lookup 이 두 번째로 일어나면 테스트가 실패해야 한다** (rebinding 방어의 핵심 검증)
- **D3.2 금지 CIDR** (IANA special-purpose, 최소 명시):
  - IPv4: `0.0.0.0/8`(+unspecified), RFC1918(`10/8`,`172.16/12`,`192.168/16`), loopback `127/8`, link-local `169.254/16`, CGNAT `100.64/10`, protocol-assignment `192.0.0/24`, benchmark `198.18/15`, documentation(`192.0.2/24`,`198.51.100/24`,`203.0.113/24`), multicast `224/4`, reserved/future `240/4`, limited broadcast `255.255.255.255/32`.
  - IPv6: unspecified `::/128`, loopback `::1/128`, IPv4-mapped `::ffff:0:0/96`, NAT64 `64:ff9b::/96`(+local-use NAT64 `64:ff9b:1::/48`), ULA `fc00::/7`, link-local `fe80::/10`, discard `100::/64`, documentation `2001:db8::/32`, ORCHID `2001:20::/28`, multicast `ff00::/8`, 기타 IANA reserved.
  - **IPv4-mapped 는 내부 IPv4 재검사 방식으로 허용하지 말고 mapped form 전체를 거부.**
- **D3.3 자원 상한**: DNS+connect+redirect+body read 전체가 **단일 15초 absolute deadline** 공유(hop 마다 timer 초기화 금지). body streaming, Content-Length 는 조기거부 힌트로만. **content-encoding 푼 뒤** HTML 2 MiB / 이미지 10 MiB 상한. HTML 은 `text/html` 만, 이미지는 magic bytes+MIME 일치 JPEG/PNG/WebP 만(SVG·HTML masquerade 거부). 이미지 header decode 후 width/height 각 ≤10,000, 총 ≤25 MP. cookie/앱 session/Authorization/사용자 Referer 미전달, 고정 browser-like 헤더만.

## ✅ 실증된 socket-pinning 패턴 (Opus 가 이 환경에서 측정함 — 이대로 써라)
Node 20.19.6, Electron 36. undici 도 내장이지만 **built-in `https` + custom `lookup` 로 충분하고 의존성이 없다.**

```js
const https = require('https')
// 검증 통과한 pinnedAddr(문자열) / pinnedFamily(4|6) 를 미리 구해둔 상태에서:
const req = https.request(urlString, {
  method: 'GET',
  autoSelectFamily: false,          // ★ 필수. Node 20 기본 true 면 내부 lookup 이 '배열'을 기대해
                                    //   cb(null, addr, family) 가 ERR_INVALID_IP_ADDRESS 로 깨진다.
                                    //   false 로 꺼야 Happy Eyeballs 없이 pinned IP 하나로 결정론적 연결.
  lookup: (host, opts, cb) => cb(null, pinnedAddr, pinnedFamily),  // 소켓을 pinned IP 로 고정, SNI/Host 는 host 유지
  timeout: /* 남은 deadline */,
}, res => { /* status/headers/redirect/stream */ })
```
- 이 패턴은 실제 왕복 200 을 확인했다. `autoSelectFamily:true` + 문자열 콜백은 **깨진다** — 함정이니 반복 실증에 시간 쓰지 마라.
- redirect 는 수동 처리(`res.statusCode` 3xx + `location`) — 각 hop 을 위 절차로 처음부터.

## 테스트 가능하게: 의존성 주입
network 없이 전부 단위 테스트되게 설계하라. 예:
```js
safeHttpFetch(url, policy, { resolveDns, createRequest, now })
```
- `resolveDns(hostname) -> [{address, family}]` — 기본은 `dns.lookup(all:true, verbatim:true)` 래핑. 테스트가 fake 주입.
- `createRequest(urlString, options) -> reqLike` — 기본은 위 `https.request`. 테스트가 fake transport 주입.
- **rebinding 테스트의 핵심**: fake `resolveDns` 는 public IP 를 주고, fake transport 는 "연결 시 두 번째 lookup 이 불렸는지" 카운트한다. 그 카운트가 **0** 이어야 한다(주소는 이미 pin 됐으므로). custom `lookup` 을 우회한 재-resolve 가 있으면 실패.
- `policy` 는 `{ kind:'html'|'image', hostAllow, maxBytes, ... }` 형태로 HTML/이미지가 같은 함수에 다른 정책만 넘기는 구조.

## §6.1 이 요구하는 테스트 (전부 넣어라)
- fake DNS/dispatcher 로 "검사 DNS=공인, 연결 lookup=사설" 재현 + **연결 단계 일반 lookup 호출 0회** 검증
- HTML·이미지가 **같은 primitive** 를 부르는지 DI 로 검증
- 압축 bomb, 거짓 Content-Length, chunked overflow, pixel bomb, SVG/HTML masquerade 거부
- mixed A/AAAA(한쪽 사설) 전체 거부, IPv4-mapped/NAT64/ULA/link-local/multicast/reserved/`0/8` 각 거부
- 상대 redirect 해석, HTTPS→HTTP downgrade 거부, host 이탈 거부, 4번째 hop 거부
- 단일 15초 deadline 이 hop 넘어 공유되는지(hop 마다 초기화 안 됨)
- userinfo/IP literal/비-https/포트 이탈/빈 host/`link.coupang.com` 거부

## 코드 규율 (repo CLAUDE.md)
- 기존 스타일 준수. 참고: `electron/api/net/ssrfSafeFetch.js`(오디오 전용, allowlist·byte cap 패턴만 참고 — 얘는 일반 fetch 재호출이라 rebinding 못 막음. 그대로 베끼지 마라).
- CIDR 판정은 순수 함수로 분리(예: `isPublicAddress(addr, family)`)해 단위 테스트가 진리표를 직접 친다.
- `npx vitest run tests/electron/api/net/safeHttpFetch.test.js` GREEN 확인하고, 커밋은 하지 마라(Opus 가 검증 후 커밋).
- 스펙·다른 소스 파일 수정 금지. 이 두 파일만.

## 산출물
1. `electron/api/net/safeHttpFetch.js`
2. `tests/electron/api/net/safeHttpFetch.test.js`
3. 마지막에 요약: export 시그니처, 테스트 개수/통과, 스펙 D3 요구사항 중 **미구현·미확인 가정**이 있으면 명시.

한국어로 답하라. 근거는 `파일:라인`.
