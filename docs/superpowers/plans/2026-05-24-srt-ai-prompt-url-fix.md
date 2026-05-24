# SRT 옵션 aiPromptUrl을 #ai-srt-to-csv로 수정

**Status:** Backlog (next release cycle)
**Created:** 2026-05-24
**Target release:** Next AutoFlowCut deploy
**Estimated:** 5분 (1줄 변경 + 4개 언어 검증)

---

## Problem

`ImportModal`의 SRT 옵션에서 🤖 **AI Gen** 버튼을 클릭하면 가이드 페이지의
`#tts-srt` 섹션 ("TTS 서비스에서 SRT 자동 생성하기")로 이동한다. 이 섹션은
SRT를 *만드는 방법*만 보여주고, 사용자가 이미 가진 SRT를 *어떻게 씬으로
분리할지*는 알려주지 않는다.

사용자 의도는 "SRT 가져오기에서 AI Gen 누르면 SRT를 씬으로 잘 분리하는
메타 프롬프트가 나오는 것".

가이드 페이지([touchizen.github.io](https://github.com/touchizen/touchizen.github.io))에는
2026-05-24부터 별도의 **"SRT → 장면 CSV 변환 프롬프트"** 카드가
`#ai-srt-to-csv` anchor와 함께 4개 언어(ko/en/ja/de) 모두 라이브 상태.

- 가이드 변경 커밋: [touchizen.github.io@d99e8016](https://github.com/touchizen/touchizen.github.io/commit/d99e8016)
- 라이브 anchor 예시: https://touchizen.com/guide/ko/autoflowcut/import-guide.html#ai-srt-to-csv

## Fix

[src/components/ImportModal.jsx:66](../../src/components/ImportModal.jsx#L66) 의
`srt` 옵션 객체에서 `aiPromptUrl` 한 줄만 변경:

```diff
     {
       id: 'srt',
       icon: '📺',
       title: t('import.srtTitle'),
       description: t('import.srtDesc'),
       accept: '.srt',
       hint: t('import.srtHint'),
       guideUrl: `${guideBaseUrl}/import-guide.html#srt-subtitle`,
       sampleUrl: `${guideBaseUrl}/samples/sample-subtitles.srt`,
-      aiPromptUrl: `${guideBaseUrl}/import-guide.html#tts-srt`
+      aiPromptUrl: `${guideBaseUrl}/import-guide.html#ai-srt-to-csv`
     }
```

다른 옵션 (text / csv / reference) 의 `aiPromptUrl` 은 그대로 둔다. 특히
`csv` 옵션은 의도적으로 `#ai-csv-prompt` 를 유지 — 그 섹션 안에 Scene CSV
프롬프트 / SRT→CSV 프롬프트 / Reference CSV 프롬프트 3개 카드가 모두
있어서, CSV 가져오기를 선택한 사용자도 SRT 카드를 발견할 수 있다.

## Verification

1. `npm run dev` 로 앱 실행
2. 어떤 프로젝트든 열고 **📂 가져오기** 모달 띄우기
3. SRT 행의 🤖 **AI Gen** 버튼 클릭
4. 외부 브라우저가 다음 URL로 점프하는지 확인:
   - ko: `https://touchizen.com/guide/ko/autoflowcut/import-guide.html#ai-srt-to-csv`
   - en/ja/de 도 lang 토글로 동일하게 점프 확인
5. 가이드 페이지에서 "🎬 SRT → 장면 CSV 변환 프롬프트" 카드가
   뷰포트 최상단에 보이는지 확인 (scroll-margin-top 80px 적용된 상태)

## Why this isn't urgent

- **회귀 아님**: 기존 `#tts-srt` 동작은 가이드 페이지에 그대로 살아있다
  (TTS 서비스 안내). 이번 변경은 SRT 사용자 발견성 개선일 뿐.
- **현재도 우회 발견 가능**: CSV 옵션의 🤖 AI Gen → `#ai-csv-prompt` 섹션
  → 두 번째 카드로 SRT→CSV 변환 프롬프트 노출됨 (사용자 스크롤 필요).
- 따라서 가이드 변경분은 단독 배포 안전, 본 fix는 **다음 AutoFlowCut 배포
  사이클에 다른 변경과 함께 묶어서 처리**해도 무방.

## Out of scope

- `text` 옵션의 `aiPromptUrl` 변경 (텍스트 가져오기는 별도 흐름)
- 가이드 페이지의 추가 변경 (이미 라이브)
- 다국어 라벨/툴팁 수정 (변경 없음 — anchor만 변경)
