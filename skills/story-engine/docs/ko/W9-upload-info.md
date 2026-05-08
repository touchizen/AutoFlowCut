# W9: 업로드 정보

이 문서는 story-engine 스킬의 W9(유튜브 업로드 정보 생성) 단계 가이드입니다.

(이전엔 W8이었으나, W7 split으로 W8이 어셈블리에 할당되면서 W9로 renumber됨.)

> **📋 출력 파일명 — genre별로 다름**
> - **yadam**: `11_업로드정보.json`
> - **dark-history**: `11_upload_info.json`
> - **bespoke**: `11_upload_info.json` (English filename, content in `STATE.md` "Output language:" 필드)
>
> 본 문서 본문의 출력 파일명은 yadam 기준이며, 다른 장르는 위 매핑으로 substitute. 자세한 filename convention: `workflows/execute-pipeline.md` § "Filename convention varies by genre".

---

## ★ W9 primary review lens — 궁금증/기대감 promise

> SKILL.md 핵심 원칙: **궁금증 + 기대감 = 몰입도. 모든 wave의 최상위 평가 기준.**

W9는 시청자에게 **promise를 거는** wave다. title / thumbnail / description / 첫 30초가 모두 같은 약속을 일관되게 던져야 클릭이 retention으로 이어진다.

### W9 검토 4 항목 (mandatory)

**P1. Title이 구체적 궁금증 promise를 거는가** — "이 영상은 ___ 에 대한 답을 줄 것이다" 라는 약속이 명확한가? 일반적 문구 (예: "조선시대 비극") = 거의 약속 안 함, 클릭 안 됨. 구체적 fact + 미스터리 hint (예: "산에 버려진 관상 보는 천재 아이가 조선의 운명을 바꾼 사연")가 promise.

**P2. Thumbnail text가 title을 보강하거나 다른 angle을 제시하는가** — title과 동일 텍스트 반복 = 공간 낭비. Thumbnail은 title이 못 잡은 감정 / 비주얼 promise를 담아야 한다.

**P3. 첫 30초가 promise를 지키는가** — title이 약속한 궁금증이 영상 첫 30초 안에 명시적으로 작동해야 한다 (관련 cold open이 시작, 관련 질문이 던져짐). 약속과 첫 30초가 어긋나면 → 즉시 이탈.

**P4. Bait 금지** — title/thumbnail이 영상 내용보다 강한 약속을 거는 경우 (예: 영상에 안 나오는 reveal을 thumbnail에 적음, "shocking ending"을 title에 박았는데 평범한 결말) → 시청자 신뢰 파괴 + 채널 retention 곡선 깨짐. **YouTube 알고리즘은 bait를 단기 클릭으로 보상하지만 장기적으로 채널 침몰시킴.** 거부.

→ W9 출력 후 위 4 항목을 self-check + 사용자 확인 권장.

---

## 유튜브 업로드 정보

### 제목 작성 공식

- `[자극적 상황] + [궁금증 유발 클로저]`
- 50~70자 + `| 야담 옛날이야기 오디오북 수면동화 전설 민담`
- 예: "산에 버려진 관상 보는 천재 아이, 조선의 운명을 바꾸다"

### 출력 형식

```json
{
  "youtube": {
    "enabled": true,
    "title": "제목 | 야담 옛날이야기 오디오북 전설 민담",
    "description": "SEO 최적화된 설명문 (첫 200자에 키워드)",
    "tags": ["야담", "민담", "설화", "전설", "옛날이야기", "오디오북", "수면동화", "조선시대", "권선징악", "인과응보", "조선야담", "옛이야기", "한국전설"],
    "hashTags": true,
    "privacy": "private",
    "categoryId": "24",
    "defaultLanguage": "ko",
    "defaultAudioLanguage": "ko",
    "schedule": { "enabled": false }
  }
}
```

**업로드 제목 후보 3개**, **설명란**, **태그 20개 이내**, **썸네일 문구**, **해시태그 15개 이내**를 함께 제공한다.

**출력 파일**: `11_업로드정보.json`
