# Flow(flow.google.com) batchexecute rpcid 표 — 2026-09-24

캡처: `AutoFlowCut-bugfix` 커밋 `46835bf5` 의 `AUTOFLOWCUT_NET_TRACE=1` 훅(`electron/flow-xhr-capture.js` XHR 몽키패치 + `webRequest` 요청 본문 → JSONL). 표 생성: `python3 scripts/flow-rpc-table.py <capture.jsonl>`.
원본 JSONL 은 개인 id·`at` 토큰이 들어 있어 저장소에 넣지 않았다. 마스킹: `<uuid#n>`(같은 값=같은 번호), `<id#n>`(15자리 이상 숫자), `<at>`, `<f.sid>`, `<lh3-url>`, `<email>`.

## 0. 판정 범례
- **관측**: 응답 내용이 UI/요청과 대조돼 확인됨. **추정**: 요청·응답 모양만으로 추측 — 구현 전 재확인 필요. **미상**: 모름.

## 1. 전송 계층 (관측)

| 항목 | 값 |
|---|---|
| 엔드포인트 | `POST https://flow.google.com/_/AiSandboxAngularFrontend/data/batchexecute` (XHR, `WIZ_global_data.Im6cmf` = `/_/AiSandboxAngularFrontend`) |
| 인증 | 쿠키(`Authorization` 헤더 없음). aisandbox/googleapis 직접 호출 0건 |
| 요청 헤더(페이지가 설정) | `X-Same-Domain: 1`, `Content-Type: application/x-www-form-urlencoded;charset=utf-8` |
| URL 쿼리 | `rpcids=<id>` · `source-path=<현재 경로>` · `bl=boq_labs-ai-sandbox-frontend_20260922.09_p0` · `f.sid=<숫자>` · `hl=ko` · `_reqid=<정수>` · `rt=c` |
| 본문 | `f.req=<urlencoded JSON>&at=<token>&` — `f.req` = `[[[rpcid, "<JSON 문자열 payload>", null, "generic"]]]` (payload 는 문자열 안의 JSON 배열) |
| 토큰 출처 | 같은 문서 안 모든 요청에서 `at` == `WIZ_global_data.SNlM0e`, `f.sid` == `FdrFJe`, `bl` == `cfb2h` (36/36, 62/62 일치). **페이지 로드마다 값이 바뀌고 문서 안에서는 고정** |
| 배치 | 관측된 요청 전부 rpcid 1개(멀티 rpcid 배치 0건) |
| 응답 프레이밍 | `)]}'\n\n` 접두 → `<길이>\n<JSON 배열>\n` 청크 반복. 청크 = `[["wrb.fr", rpcid, "<JSON 문자열 payload>", null, null, null, "generic"], ["di", N], ["af.httprm", N, "<id>", 39]]`, 마지막 `[["e",4,null,null,N]]` |
| 응답 예 | `nzlxg` → `)]}'\n\n127\n[["wrb.fr","nzlxg","[1050,1,2,2,null,1050]",null,null,null,"generic"],["di",276],["af.httprm",276,"-<id#2>",39]]\n25\n[["e",4,null,null,163]]\n` |
| WIZ_global_data 키(값 미기록) | AfY8Hf BMqR8 DpimGf EP1ykd(`["/_/*","/accounts/*"]`) FdrFJe HiPsbb Im6cmf K21R3e KLD0Rc LoQv7e MT7f9b MUE6Ne QrtxK S06Grb S6lZl SNlM0e TSDtV UUFaWc Vvafkd W3Yyqf WZsZ1e awbSEf b5W2zf cPpIQe cfb2h eptZe gGcLoe hCQbU hsFLT iCzhFc l9sTOe mXaIFf nQyAE oPEP7c p9hQne qDCSke qwAQke rtQCxc rySayd tQVkXe |

## 2. 프로젝트 열기·생성 단계 rpcid (관측 2회 로드 + 앱의 새 프로젝트 1회)

| rpcid | 용도 | 판정 | 요청 payload(마스킹) | 응답 payload(마스킹, 앞부분) | 요청/응답 수 |
|---|---|---|---|---|---|
| `UpteDb` | 프로젝트 목록(홈) | 관측: 응답이 `[projectId,[제목,null,[ts],썸네일 lh3 URL,mediaId]]` 배열(21개 요청 = 페이지 크기) | `["projects/*",21,null,null,null,null,[1]]` | `[[["<uuid#230>",["9월 23 - 17:37",null,[1790152630,423441000]]],["<uuid#231>",["8월 03일 오후 09:55",null,[1785761720,474424000],"<lh3-url>` | 7/3 |
| `jHPbke` | 프로젝트 생성 | 관측: 앱의 "새 프로젝트" 클릭 직후 1회, 요청에 기본 제목("9월 24 - 12:07"), 응답 `[projectId,[제목]]` 이 이후 source-path 의 프로젝트 id 와 일치 | `["projects/*",[null,["9월 24 - 12:07"]],[null,22]]` | `["<uuid#271>",["9월 24 - 12:07"]]` | 2/1 |
| `ngNC2` | 프로젝트 메타(제목·기본 모델 설정) | 관측: 요청 `tools/PINHOLE/projects/<id>`, 응답 제목이 UI 제목과 일치, 끝에 `[[null,3,2,"narwhal_display"],["abra",2,1]]` 모델 설정 | `["tools/PINHOLE/projects/<uuid#1>"]` | `["<uuid#1>",["6월 23일 오후 03:19","<uuid#2>"],null,null,null,[null,null,[[null,3,2,"narwhal_display"],["abra",2,1]],null,2]]` | 6/3 |
| `Zzl0ze` | 프로젝트 미디어(생성물) 목록 | 관측(§3에서 생성 직후 재호출·새 항목 확인): 응답 ~95KB, 항목 `[id,null,null,[이름(프롬프트 앞부분),[created],null,null,id2,id3,[ts]],projectId]` — 옛 프로젝트의 씬 이름들과 일치. 생성 후 재호출되는지 확인 필요 | `["projects/<uuid#1>",null,null,null,[1]]` | `[null,[["<uuid#111>",null,null,["Woman working in office",[1782197040,83948000],null,null,"<uuid#112>","<uuid#113>",[1782197055,13712000]],"` | 5/2 |
| `nzlxg` | 크레딧 잔량 | 관측(간접): `[1050,…]` → 영상 제출 응답의 잔량 1040 과 이어짐(§3) | `[]` | `[1050,1,2,2,null,1050]` | 10/5 |
| `HTrJv` | 모델 카탈로그(키→표시명)+기본 모델 | 관측: `[[modelKey,[표시명]],…]` 에 veo_2/veo_3_x/abra/GEM_PIX("🍌 Nano Banana") 전부, 앞부분에 [1 veo_3_1_lite / 2 abra / 3 abra] 기본값 | `[]` | `[[null,null,[[1,[null,null,"narwhal_display","veo_3_1_lite",null,null,4,3,2,2,1]],[2,[null,null,"narwhal_display","abra",null,null,1,3,2,2,1` | 6/3 |
| `yBhWQ` | 비디오 모델 가용 상태 | 추정: `[["abra",1],["veo_3_1_fast",1],["veo_3_1_quality",1],["veo_3_1_lite",1]]` (1 = 사용 가능?) | `[]` | `[[["abra",1],["veo_3_1_fast",1],["veo_3_1_quality",1],["veo_3_1_lite",1]]]` | 5/2 |
| `mrlkwd` | 에이전트 챗 세션 목록(프로젝트별) | 추정: 요청 projectId, 응답 `[[sessionId,[제목,[ts],[ts],null,1]]]` — 제목이 에이전트 챗 제목 | `["<uuid#1>"]` | `[[["<uuid#99>",["Royal King Lobby Scene",[1790156021],[1790156073,998886000],null,1]]]]` | 6/3 |
| `GN0Bre` | 에이전트 챗 세션 내용 | 추정: 요청 sessionId, 응답에 사용자 문장("왕이 로비에 있는 그림")과 A2UI(beginRendering/surfaceUpdate) JSON | `["<uuid#99>"]` | `[["<uuid#99>",["Royal King Lobby Scene",[1790156021],[1790156073,998886000],null,1]],[[[[[["왕이 로비에 있는 그림"]]]],[[[[["text",[null,null,"```jso` | 3/1 |
| `tRARke` | 커뮤니티 툴(applets) 목록 | 관측: ThumbnailForge 등 이름·설명·아이콘 URL | `[]` | `[[["community-<uuid#3>",-1,"ThumbnailForge","Create photorealistic, scroll-stopping thumbnails for every platform in seconds.",null,"<uuid#4` | 6/3 |
| `o30O0e` | 계정 프로필(people "me") | 관측(요청만): `[["me"],[[["person.photo","person.name","person.email"]]…]]`. 응답은 주입 전이라 미캡처 | `[["me"],[[["person.photo","person.name","person.email"]],null,[1,7]]]` | `-` | 5/0 |
| `xI9TVb` | 사용자 설정 | 관측: 요청 `userPreferences/`, 응답 `[true,null,true]` | `["userPreferences/"]` | `[true,null,true]` | 6/3 |
| `WuwhI` | 분석 이벤트(PAGE_VIEW) | 관측: 요청에 PAGE_VIEW·IS_MOBILE 등 | `[[["PAGE_VIEW",["<uuid#273>",[1790218842,2000000],null,[["IS_MOBILE",["type.googleapis.com/google.protobuf.BoolValue",[1` | `[]` | 4/1 |
| `NfrxTb` | 미상 | 요청 `[16]`, 응답 `[]` — 페이지마다 여러 번(플래그/실험 류로 보임) | `[16]` | `[]` | 14/4 |
| `KV2T2d` | 미상 | 요청 `[22]`, 응답 미캡처(주입 전) | `[22]` | `-` | 5/0 |
| `LPzVkd` | 미상 | 요청 `[[4,8,5,6,9]]`, 응답 `[]` | `[[4,8,5,6,9]]` | `[]` | 6/3 |
| `qJcgMc` | 미상 | 요청 `[]`, 응답 `[]` | `[]` | `[]` | 6/3 |
| `cPZSdc` | 미상 | 요청 `[]`, 응답 미캡처 | `[]` | `-` | 5/0 |
| `Yizz8d` | 미상 | 요청 `[]`, 응답 미캡처 | `[]` | `-` | 5/0 |
| `ve2Lsc` | 미상 | 요청 `[]`, 응답 `[true]` | `[]` | `[true]` | 3/1 |
| `DTaVef` | 미상(프로젝트 생성 직후 1회) | 요청 `[1]`, 응답 `[]` | `[1]` | `[]` | 2/1 |
| `as29s` | 미디어 단건 조회(서명 URL) | 관측(§3): 요청 mediaId, 응답에 `flow-content.google` 서명 URL·바이트수 — 목록 항목별로 연속 호출 | `["<uuid#212>"]` | `-` | 6/0 |

### 주요 rpcid 샘플(마스킹·절단)

**`UpteDb`** — 요청 `["projects/*",21,null,null,null,null,[1]]`

```json
[[["<uuid#230>",["9월 23 - 17:37",null,[1790152630,423441000]]],["<uuid#231>",["8월 03일 오후 09:55",null,[1785761720,474424000],"<lh3-url>","<uuid#232>"]],["<uuid#233>",["7월 29일 오후 02:13",null,[1785302015,468945000],"<lh3-url>","<uuid#234>"]],["<uuid#235>",["7월 28일 오후 08:23",null,[1785237789,493102000],"<lh3-url>","<uuid#236>"]],["<uuid#237>",["7월 28일 오전 10:17",null,[1785201436,513130…(+5796)
```

**`jHPbke`** — 요청 `["projects/*",[null,["9월 24 - 12:07"]],[null,22]]`

```json
["<uuid#271>",["9월 24 - 12:07"]]
```

**`ngNC2`** — 요청 `["tools/PINHOLE/projects/<uuid#1>"]`

```json
["<uuid#1>",["6월 23일 오후 03:19","<uuid#2>"],null,null,null,[null,null,[[null,3,2,"narwhal_display"],["abra",2,1]],null,2]]
```

**`Zzl0ze`** — 요청 `["projects/<uuid#1>",null,null,null,[1]]`

```json
[null,[["<uuid#111>",null,null,["Woman working in office",[1782197040,83948000],null,null,"<uuid#112>","<uuid#113>",[1782197055,13712000]],"<uuid#1>"],["<uuid#114>",null,null,["회사원 제품 소개 장면",[1782273167,17222000],null,null,"<uuid#115>","<uuid#116>",[1782273198,353067000]],"<uuid#1>"],["<uuid#117>",null,null,["회사원3이 회사앞에서 제품을 소개하는 모",[1782197353,986316000],null,null,"<uuid#118>","<uuid#119>",[1782197368,355811000]],"<uuid#1>"],["<uuid#120>",null,null,["King sitting on throne",[1782275680,534322000],null,null,"<uuid#121>","<uuid#122>",[1782275708,753417000]],"<uuid#1>"],["<uuid#123>",null,null,["King sitting on throne",[1784170038,930517000],null,null,"<uuid#124>","<uuid#125>",[1784170063,47…(+94800)
```

**`HTrJv`** — 요청 `[]`

```json
[[null,null,[[1,[null,null,"narwhal_display","veo_3_1_lite",null,null,4,3,2,2,1]],[2,[null,null,"narwhal_display","abra",null,null,1,3,2,2,1]],[3,[null,null,"narwhal_display","abra",null,null,1,3,2,2,1]]],[["GEM_PIX",["🍌 Nano Banana"]],["veo_2_0_i2v",["Veo 2 - Quality"]],["veo_2_0_object_insertion_landscape",["Insertion"]],["veo_2_0_object_insertion_portrait",["Insertion"]],["veo_2_0_object_removal_landscape",["Removal"]],["veo_2_0_object_removal_portrait",["Removal"]],["veo_2_0_t2v",["Veo 2 - Quality"]],["veo_2_1080p_upsampler_8s",["Veo 2 - Upsampler"]],["veo_2_1_fast_d_15_i2v",["Veo 2 - Fast"]],["veo_2_1_fast_d_15_t2v",["Veo 2 - Fast"]],["veo_2_1_fast_d_15_with_start_image_and_end_image_interpolation",["Veo 2 - Quality"]],["veo_2_1_fast_d_15_with_video_extension",["Veo 2 - Fast"]],["veo_2_camera_control",["Veo 2 - Fast"]],["veo_2_r2v",["Veo 2 - Quality"]],["veo_2_r2v_fast",["Veo 2 - Fa…
```

**`nzlxg`** — 요청 `[]`

```json
[1050,1,2,2,null,1050]
```

**`yBhWQ`** — 요청 `[]`

```json
[[["abra",1],["veo_3_1_fast",1],["veo_3_1_quality",1],["veo_3_1_lite",1]]]
```

**`mrlkwd`** — 요청 `["<uuid#1>"]`

```json
[[["<uuid#99>",["Royal King Lobby Scene",[1790156021],[1790156073,998886000],null,1]]]]
```

## 3. 생성 단계 rpcid (관측: 이미지 2장·영상 1개 수동 생성, 2026-09-24)

uuid 번호는 **이 섹션 안에서만** 일관(`<uuid#1>` = 프로젝트 id). `<b64 N chars>` = reCAPTCHA Enterprise 토큰(접두 `0cAFcWeA`, 요청마다 새로 발급).

| rpcid | 용도 | 판정 | 핵심 관측 |
|---|---|---|---|
| `ogiZ0b` | **이미지 생성(동기)** | 관측 | 제출 직전 `POST www.google.com/recaptcha/enterprise/clr`. 요청에 프롬프트·seed·`"NARWHAL"`·프로젝트 id·reCAPTCHA 토큰(같은 토큰이 요청 안에 2번). XHR 이 **결과까지 열려 있음(21.5s, 20.7s)**. 응답에 mediaId·서명 CDN URL(`flow-content.google/image/<mediaId>`)·영문 재작성 프롬프트·크기 `[1376,768]`·미디어 목록 항목. **크레딧 변화 0**(1050 유지) |
| `YhhmEf` | **영상 생성 제출(비동기)** | 관측 | 같은 reCAPTCHA 선행. 요청에 프롬프트·`"abra_t2v_6s"`·`2`·프로젝트 id·토큰·`["<sceneId>",2]`. **5.7s 후 반환**: `[null, 1040(크레딧 잔량), [[미디어목록 항목]], [[미디어 레코드, 상태 `[6]`]]]`. 1050→1040 = abra 6초 10크레딧 |
| `jwpduf` | **생성 상태 폴링** | 관측 | 요청 `[null,null,[["<mediaId>"]]]`(배열 — 여러 개 가능). 페이지가 **5초 간격**으로 호출. 응답 = 미디어 레코드. 상태 `[2]`×7 → `[3]`(완료 폴에 크레딧 1040·바이트수 2613641 동봉). 6→2→3 의 의미(제출/생성중/완료)는 순서로 추정 |
| `as29s` | **미디어 단건 조회(서명 URL)** | 관측 | 요청 `["<mediaId>"]`. 완료 후 응답에 포스터 `flow-content.google/image/<mediaId>` + **`flow-content.google/video/<mediaId>` (mp4)**. 이미지 미디어에도 같은 rpc(이미지 URL+바이트수). 프로젝트 열기 때의 6연속 호출도 이것(목록 항목별 URL 조회) |
| `DA4VGb` | 사용자 설정 조회(기본 영상 모델·실험 코호트·에이전트 모드) | 추정 | 요청 `[[null×11,1],[["is_agent_mode_toggled"]]]`, 응답 `["veo_3_1_t2v_fast_portrait","2026-09-09-v0-ios-launch-<uuid>",[uuid×5],2,false,…,["MODEL","AGENT"],true,false]`. 에이전트 토글 시 `Kcr7Ub` 와 짝으로 5회 |
| `Kcr7Ub` | 프로젝트 설정 갱신(field mask) | 추정 | 요청 `["projects/<id>",[null,null,null,null,1],[["agent_toggle_state"]]]`, 응답 `[[[null,null,null,null,1]]]` |
| `Zzl0ze` | 미디어 목록 재조회 | 관측 | 이미지 생성 직후 재호출(35 항목). §2 참조 |

### 전송·인증 관측(생성 단계)

- **reCAPTCHA Enterprise 토큰이 제출 요청 본문에 들어간다**(`["<token>",1]`, 프로젝트 id 옆). 페이지는 제출 직전 `enterprise/clr` 를 fetch 한다. 주입한 `grecaptcha.enterprise.execute` 래퍼는 한 번도 안 울렸다 → **토큰 취득 경로 미관측**(모듈 내부 참조로 추정). 즉 앱이 제출 RPC 를 직접 만들 수는 없고, **UI 로 제출시키고 페이지 XHR 을 캡처**해야 한다.
- 상태 폴링(`jwpduf`)·미디어 조회(`as29s`)·목록(`Zzl0ze`)은 토큰 없이 `at`(=`WIZ_global_data.SNlM0e`)+쿠키만으로 나간다 → 페이지 컨텍스트에서 앱이 직접 호출 가능.
- 미디어 CDN: `https://flow-content.google/{image|video}/<mediaId>?Expires=<unix>&KeyName=labs-flow-prod-cdn-key&Signature=<sig>` — 서명 URL, **약 6시간 유효**, `auth: none` GET(host seen 로그). 옛 `MEDIA_REDIRECT_URL`(labs.google trpc)은 폐기.
- 상수 `22` 가 `jHPbke`(프로젝트 생성)·`KV2T2d`·`ogiZ0b`·`YhhmEf` 에 공통으로 들어간다(툴 id 로 추정). 이미지 요청의 `3`, 영상 요청의 `2` 는 종횡비/모드 후보지만 **미확인**.
- 미관측: 레퍼런스(캐릭터) 이미지 첨부 생성, i2v, 업스케일, 업로드. 필요하면 같은 훅으로 수동 1회씩 추가 캡처.

### 샘플(마스킹·절단)

**`ogiZ0b` 이미지 생성** — 요청
```json
[[null,[[null,null,null,1687588041,3,"NARWHAL",null,[null,22,null,null,null,"<uuid#1>",null,null,null,null,["<b64 2510 chars>",1]],[[["궁정안에 있는 왕"]]],null,null,null,"<uuid#2>","<uuid#3>"]],1,[null,22,null,null,null,"<uuid#1>",null,null,null,null,["<b64 2510 chars>",1]],["<uuid#4>"]]]
```
응답
```json
[[[["<uuid#5>",null,"<uuid#6>",null,null,null,[[null,1687588041,null,null,null,null,1,"A king inside the royal court",29,null,null,"<uuid#6>",null,"https://flow-content.google/image/<uuid#5>?Expires=1790261521&KeyName=labs-flow-prod-cdn-key&Signature=<sig>",3,[null,null,[["A king inside the royal court",null,[[["궁정안에 있는 왕"]]]]],[]],null,"<uuid#5>"],null,[1376,768]]]],[["<uuid#6>",null,null,["King inside royal court",[1790239922,668744000],null,null,"<uuid#5>","<uuid#4>",[1790239939,179585000]],"<uuid#1>"]]]]
```

**`YhhmEf` 영상 제출** — 요청
```json
[[[[[null,null,[[["왕이 궁전 내부를 산책하는 영상"]]]],"abra_t2v_6s",2,null,[null,null,null,null,"<uuid#7>","<uuid#8>"]]],[null,22,null,null,null,"<uuid#1>",null,null,null,null,["<b64 2510 chars>",1]],["<uuid#9>",2]]]
```
응답
```json
[[null,1040,[["<uuid#10>",null,null,["왕이 궁전 내부를 산책하는 영상",[1790240102,232689000],null,null,"<uuid#11>","<uuid#9>",[1790240105,313912000]],"<uuid#1>"]],[["<uuid#11>","<uuid#1>","<uuid#10>","CAE",null,[[1790240102,232689000],"왕이 궁전 내부를 산책하는 영상",null,null,null,null,[null,[["abra_t2v_6s",1,null,null,2,1]],[[null,null,[[["왕이 궁전 내부를 산책하는 영상"]]]]],null,1],null,[6],1],null,[[null,281181,null,null,null,null,null,"A video of a king taking a walk inside the palace.",null,null,null,null,"abra_t2v_6s","",null,false,2],[null,null,[6]],["<uuid#11>"]]]]]]
```

**`jwpduf` 첫 폴(상태 [2])** — 요청
```json
[[null,null,[["<uuid#11>"]]]]
```
응답
```json
[[null,null,[["<uuid#11>","<uuid#1>","<uuid#10>","CAE",null,[[1790240102,232689000],"왕이 궁전 내부를 산책하는 영상",null,null,null,null,[null,[["abra_t2v_6s",1,null,null,2,1]],[[null,null,[[["왕이 궁전 내부를 산책하는 영상"]]]]],null,1],null,[2],1],null,[[null,281181,null,null,null,null,null,"A video of a king taking a walk inside the palace.",null,null,null,null,"abra_t2v_6s","",null,false,2],[null,null,[6]],["<uuid#11>"]]]]]]
```

**`jwpduf` 마지막 폴(상태 [3])** — 요청
```json
[[null,null,[["<uuid#11>"]]]]
```
응답
```json
[[null,1040,[["<uuid#11>","<uuid#1>","<uuid#10>","CAE",null,[[1790240102,232689000],"왕이 궁전 내부를 산책하는 영상",null,null,null,null,[null,[["abra_t2v_6s",1,null,null,2,1]],[[null,null,[[["왕이 궁전 내부를 산책하는 영상"]]]]],null,1],null,[3],1,null,null,null,2613641],null,[[null,281181,null,null,null,null,null,"A video of a king taking a walk inside the palace.",null,null,null,null,"abra_t2v_6s","",null,false,2],[null,null,[6]],["<uuid#11>"]]]]]]
```

**`as29s` 완료 영상 조회** — 요청
```json
[["<uuid#11>"]]
```
응답
```json
[["<uuid#11>","<uuid#1>","<uuid#10>","CAE",null,[[1790240102,232689000],"왕이 궁전 내부를 산책하는 영상",null,null,null,null,[null,[["abra_t2v_6s",1,null,null,2,1]],[[null,null,[[["왕이 궁전 내부를 산책하는 영상"]]]]],null,1],null,[3],1,"https://flow-content.google/image/<uuid#11>?Expires=1790261742&KeyName=labs-flow-prod-cdn-key&Signature=<sig>",[],null,2613641],null,[[null,281181,null,null,null,null,null,"A video of a king taking a walk inside the palace.","https://flow-content.google/video/<uuid#11>?Expires=1790261742&KeyName=labs-flow-prod-cdn-key&Signature=<sig>",null,null,null,"abra_t2v_6s","",null,false,2],[null,null,[6]],["<uuid#11>"]]]]
```

**`DA4VGb`** — 요청
```json
[[[null,null,null,null,null,null,null,null,null,null,null,1],[["is_agent_mode_toggled"]]]]
```
응답
```json
[["veo_3_1_t2v_fast_portrait","2026-09-09-v0-ios-launch-<uuid#12>",["<uuid#13>","<uuid#14>","<uuid#15>","<uuid#16>","<uuid#17>"],2,false,null,null,null,null,null,["MODEL","AGENT"],true,false]]
```

**`Kcr7Ub`** — 요청
```json
[["projects/<uuid#1>",[null,null,null,null,1],[["agent_toggle_state"]]]]
```
응답
```json
[[[null,null,null,null,1]]]
```

## 4. 구현(§3-B 2~7)에 필요한 결론

1. **제출은 UI 경유**: 이미지(`ogiZ0b`)·영상(`YhhmEf`) 요청은 reCAPTCHA 토큰이 필요하고 취득 경로를 못 봤다 → 옛 구조 그대로 "앱이 Flow UI 를 눌러 제출 → XHR 훅이 응답 캡처". 라우팅은 URL 이 아니라 **rpcid** 로.
2. **상태·URL 은 직접 호출 가능**: `jwpduf`(폴링)·`as29s`(mp4/이미지 서명 URL)는 토큰 불필요 → 페이지 컨텍스트 XHR 로 앱이 직접 부르거나, 페이지의 5초 폴링 응답을 그냥 캡처.
3. **다운로드**: 서명 URL 은 6시간 유효, 쿠키 불필요 추정(`auth: none`) → 완료 즉시 받으면 된다.
4. **seed/종횡비/레퍼런스 주입**: `send` 훅에서 `f.req` 를 고쳐 넣을 수 있다. seed 위치는 관측됨(`ogiZ0b` 요청 4번째 원소), 종횡비 후보 `3`/`2` 와 레퍼런스 형태는 **추가 캡처 후** 확정.
5. **인증 게이트**: 세션 토큰 대신 "프로젝트 컴포저 진입(`flowProjectReady`)" 으로. 크레딧은 `nzlxg` 로 읽을 수 있다(영상만 차감).
6. 위치 기반 배열(protobuf 순서)이라 **Google 이 바꾸면 깨진다** — rpcid·필드 위치를 이 문서의 샘플 픽스처로 테스트에 박아 깨짐을 바로 알게 할 것.

## 6. 컴포저 DOM (관측: 프로젝트 화면 덤프 2회 — 영상 모드·이미지 모드, 2026-09-24)

파일: `2026-09-24-flow-composer-dom-video-mode.elements.json`, `…-image-mode.elements.json`(uuid 마스킹, bodyHtml 제외).

| 요소 | 셀렉터 후보 | 관측값 |
|---|---|---|
| 프롬프트 입력 | `div.ProseMirror[contenteditable=true]` | 빈 입력, 포커스 시 `ProseMirror-focused` |
| 생성 버튼 | `button.generate-icon-button[type=submit]`, `aria-label="생성 시작"`, 아이콘 `arrow_forward` | 입력이 비면 `disabled` |
| 설정 트리거(모드·모델·비율·개수) | `button.settings-trigger-button`, `aria-label="설정 트리거"` | 영상: `동영상 · 720p · 6초 crop_16_9 x1`, 이미지: `🍌 Nano Banana 2 crop_16_9 x1` |
| 생성물 카드 라벨 | `div.footer-left[role=button]` | `image` 아이콘 + 이름 |
| reCAPTCHA | `textarea.g-recaptcha-response` (숨김) | 페이지에 로드돼 있음 |

- 기존 코드(`electron/ipc/video.js`, `main.js`)의 `contenteditable`·`arrow_forward`·`생성 시작` 셀렉터가 새 마크업에서도 그대로 맞는다 → **DOM 층은 대부분 살아 있고, 끊긴 건 네트워크 층**이라는 핸드오프 판단과 일치.
- 설정 패널은 `설정 트리거` 를 누르면 뜨는 오버레이다. 닫힌 덤프 2개 + **연 덤프 2개**(`…-image-panel-open`, `…-video-panel-open`)를 받았다. bodyHtml 은 40000자에서 잘려 오버레이가 빠지지만 `elements` 에는 들어 있다.

### 6-1. 설정 패널 (연 상태, 관측)

모든 선택지는 Angular Material `button.mat-button-toggle-button[role=radio]` 이고 선택 여부는 `aria-checked="true"`. `id`(`mat-button-toggle-86-button`)·`name`(`mat-button-toggle-group-28`)은 **Angular 자동 번호라 불안정** → 아이콘 리거처와 텍스트로 찾아야 한다.

| 그룹 | 이미지 모드 선택지 | 동영상 모드 선택지 | 식별 |
|---|---|---|---|
| 모드 | 이미지 / 동영상 | 이미지 / 동영상 | 아이콘 `image` / `videocam` |
| 동영상 입력 방식 | – | 프레임 / **소재**(기본 선택) | 아이콘 `crop_free` / `chrome_extension` |
| 비율 | 16:9 · 4:3 · 1:1 · 3:4 · 9:16 | 16:9 · 9:16 | 아이콘 `crop_16_9` `crop_landscape` `crop_square` `crop_portrait` `crop_9_16` |
| 모델 | `🍌 Nano Banana 2 ▾` | `Omni 1.1 Flash ▾` | `button.mat-mdc-menu-trigger[aria-haspopup=menu]`, `aria-label="모델 제품군 선택"` — 메뉴 항목은 **미캡처** |
| 해상도 | – | 360p(`info` 아이콘) / **720p** | 텍스트 |
| 길이 | – | 4초 / **6초** / 8초 / 10초 | 텍스트 |
| 개수 | **x1** / x2 / x3 / x4 | **x1** / x2 / x3 / x4 | 텍스트 |
| 비용 | `a.credit-cost-link` = `0 크레딧` | `10 크레딧` | 네트워크 관측(1050→1040)과 일치 |
| 소재 추가 | `button[aria-label="프롬프트 상자에 소재 추가"]`(아이콘 `add`) | 같음 | 레퍼런스 이미지 첨부 입구로 추정 |

- 관측한 T2V 요청(`YhhmEf`)의 모델 키는 `abra_t2v_6s` — 패널의 `Omni 1.1 Flash` + `6초` 와 대응. 입력 방식이 `소재` 여도 소재가 없으면 t2v 키로 나갔다.
- **기존 설정 코드와 호환 안 됨**: `electron/flow-agent-defaults.js` 는 옛 labs.google 패널(Radix Tabs `-trigger-LANDSCAPE` id 접미사, `tune` 아이콘 설정 버튼)을 전제한다. 새 패널은 Material 토글이라 그 셀렉터는 조용히 no-op 될 것이다. 모델 트리거의 `aria-haspopup="menu"` 만 겹친다. 반면 프롬프트 입력·생성 버튼은 호환(위 표).
- 남은 관측: 모델 드롭다운을 **연 상태** 덤프(메뉴 항목 라벨). 모델 키 ↔ 표시명은 `HTrJv` 카탈로그에 있다(§2).
- `aria-label` 이 한국어(`hl=ko`)라 로케일 의존 — 셀렉터는 클래스·아이콘 리거처 우선.

## 5. 재현
```bash
cd ~/workspace/AutoFlowCut-bugfix
AUTOFLOWCUT_NET_TRACE=1 AUTOFLOWCUT_NET_TRACE_FILE=/tmp/flow-capture.jsonl env -u ELECTRON_RUN_AS_NODE npm run dev
# Flow 모드에서 프로젝트 열기/생성, Flow UI 에서 수동 생성 → JSONL 누적(단축키 불필요)
python3 scripts/flow-rpc-table.py /tmp/flow-capture.jsonl --out-md /tmp/rpc-table.md
```
