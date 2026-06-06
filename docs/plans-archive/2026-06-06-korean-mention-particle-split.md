# 멘션 뒤 한글 조사 자동 분리 구현 플랜

날짜: 2026-06-06
상태: 구현 완료

## 목표

프롬프트 에디터와 생성 경로에서 `@queen이`, `@철수가`처럼 멘션 뒤에 한글 조사가
공백 없이 붙어도 reference mention 으로 인식되게 한다.

## 배경

기존 멘션 정규식은 영문/숫자/기호뿐 아니라 한글도 이름 문자로 허용했다. 그래서
`@queen이`를 `queen` 멘션 + `이` 텍스트가 아니라 `queen이`라는 하나의 이름으로
읽었다. reference 이름이 `Queen`이면 매칭에 실패해 빨간 unknown mention 으로
표시되고, 생성 요청의 referenceImages 에도 들어가지 않았다.

이 문제는 프로젝트 전환 시 chip 이 사라지는 ref 로딩 타이밍 문제와 별개다. `@king`
같은 기본 멘션은 정상인데 `@queen이`만 실패했기 때문에 파싱 문제로 분리했다.

## 설계

`resolveMentionPrefix(name, refByLowerName)`를 단일 진실원천으로 두고 다음 규칙을
적용했다.

- 전체 토큰이 reference 이름과 일치하면 그대로 매칭한다.
- 전체 매칭이 없고 마지막 문자가 한글이면 끝 한글을 한 글자씩 떼며 가장 긴 reference
  접두사를 찾는다.
- 끝이 영문이면 접두사 분리를 하지 않는다. `@kingdom`은 `King`으로 오인하지 않는다.
- 접두사도 없으면 기존처럼 unknown mention 으로 둔다.

예시:

| 입력 | reference | 결과 |
| --- | --- | --- |
| `@queen이` | `Queen` | `@Queen` chip + `이` text |
| `@철수가` | `철수` | `@철수` chip + `가` text |
| `@철수` | `철수` | `@철수` chip |
| `@kingdom` | `King` | unknown 유지 |
| `@수민이` | `수`, `수민` | `@수민` chip + `이` text |
| `@영희가` | 없음 | unknown 유지 |

## 구현

- `src/utils/mentionParser.js`
  - `resolveMentionPrefix` 구현.
  - `resolveMentions`와 `stripMentionPrefixes`가 같은 prefix 분리 로직을 사용하도록 통합.
  - 생성 payload 정리 시 `@Queen이`는 `Queen이`로, `@철수가`는 `철수가`로 변환한다.

- `src/utils/promptLexicalAdapter.js`
  - `MENTION_RE`와 `resolveMentionPrefix`를 `mentionParser`에서 가져와 사용.
  - `buildNodesForLine`이 접두사까지만 BeautifulMentionNode 로 만들고, 남은 조사는 일반
    TextNode 로 남기도록 변경.

- `src/components/mentionLiveTransform.js`
  - 기존 live transform 이 `buildNodesForLine`을 사용하므로 동일 로직이 자동 적용됨.
  - live typing 통합 테스트로 회귀를 고정.

## 테스트

추가/보강한 테스트:

- `tests/utils/promptLexicalAdapter.test.js`
  - `@queen이`, `@queen 이`, `@kingdom`
  - `@철수가`, `@철수`, `@영희가`, `@수민이`

- `tests/components/mentionTransform.test.js`
  - live transform 에서 `@queen이`가 chip + 조사 text 로 분리되는지 검증.
  - live transform 에서 `@철수가`가 chip + 조사 text 로 분리되는지 검증.

- `tests/utils/mentionParser.test.js`
  - 생성 경로의 `resolveMentions` / `stripMentionPrefixes`가 영문 mention + 한글 조사,
    한글 mention + 조사, 영문 조합어 unknown 유지 케이스를 처리하는지 검증.

- `tests/hooks/useScenes.test.js`
  - scene reference matching 경로에서 `@hero가`, `@철수가`가 reference 로 잡히는지 검증.

- `tests/integration/mention-to-genai.test.jsx`
  - 실제 GenAI payload 직전 경로에서 prompt 의 `@` 제거와 `referenceImages` 포함을 검증.

최종 검증:

- `npm run test:run`
  - 227 files passed
  - 2489 tests passed
- `git diff --check`
  - 통과

## 커밋

- `3e5315d feat(prompt): 멘션 뒤 한글 조사 자동 분리`
- `8b0ec9a fix(prompt): 생성 경로에서도 멘션 조사 분리 적용`
- `75e22cf test(prompt): 한글 멘션 조사 경로 보강`

## 남은 주의사항

이 구현은 한국어 문법 분석기가 아니라 한글 suffix fallback 이다. 따라서 reference 이름이
짧고 뒤에 임의의 한글이 붙은 경우에도 접두사 매칭이 될 수 있다. 대신 영문 suffix 는
분리하지 않아 `@aliceville` 같은 영문 조합어 오인식은 막는다.
