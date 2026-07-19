# Prompts Progressive Streaming Design

## Goal

`prompts` 스텝의 단일 구조화 LLM 응답이 스트리밍되는 동안, 이미 존재하는 씬 행에 sceneNo별 이미지·비디오 프롬프트를 임시 ghost text로 표시한다. 스트림 값은 표시 전용이며 최종 `writePrompts` 반환값만 저장과 push의 진실 소스로 사용한다.

## Architecture

상태형 `partialScenes` 파서는 덧붙여지는 문자열 조각에서 지정한 top-level 배열(기본 `scenes`)을 찾고, 닫힌 직계 배열 요소만 한 번씩 `JSON.parse`하여 callback으로 보낸다. 문자열·escape·객체/배열 깊이를 추적하며 부분 또는 잘못된 요소는 fail-silent로 건너뛴다.

Claude structured/fallback 스트림과 Codex `item/agentMessage/delta`의 raw text를 선택적 `onPartialText` callback으로 노출한다. `writePrompts`는 호출마다 parser를 새로 만들고 완성된 scene element만 `onPartialPrompt`로 전달한다. 최종 구조화 결과 검증과 sceneNo 병합은 기존 경로를 그대로 유지한다.

step machine은 `writePrompts` 호출 직전에 `story:progress`의 `kind: 'prompt-delta', phase: 'started'`를 보내고, 이후 payload를 `sceneNo`, `imagePrompt`, `videoPrompt`로 제한한다. renderer는 prompt 전용 op-ref와 sceneNo map으로 started 이후 같은 operationId의 delta만 누적한다. 모든 최종 `story:state`에서 map과 gate를 비워 최종 scenes가 즉시 권위값이 되게 한다.

`StoryView`의 prompts running 화면은 기존 scene 행을 유지하고 map 값만 provisional class로 표시한다. 값은 non-editable이며, 최종 상태 수신 후 기존 정식 prompt 셀로 교체된다. review 실행은 기존 완성 테이블 동작을 유지한다.

## Error Handling

- partial parser의 element parse 오류와 malformed tail은 callback 없이 무시한다.
- streaming callback이 없거나 adapter가 스트리밍하지 않으면 기존 all-at-once UI로 자연스럽게 동작한다.
- operationId가 없거나 started gate와 다른 delta는 renderer에서 버린다.
- 최종 Claude/Codex 결과 파싱·스키마 검증·sceneNo 병합 오류는 기존 authoritative 경로대로 실패한다.

## Tests

- parser: chunk 경계, escape/중괄호 문자열, 공백, 일괄/개별 element, key parameter, malformed tail.
- Claude: structured `input_json_delta`, fallback `text_delta`, callback 생략, 최종 result 불변.
- writePrompts/router/Codex: callback plumbing과 최종 merge 불변.
- step machine: started 선행, payload sanitization, callback context 전달.
- renderer/UI: map 누적, stale-op drop, state clear, running scene rows의 ghost text.
