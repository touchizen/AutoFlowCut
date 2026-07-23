import { defineShoppingAsset } from './asset.js'

export const personaMapping = defineShoppingAsset('persona-mapping/1', {
  categories: [
    { category: '색조 화장품, 스킨케어(20대향)', gender: 'female', ageBand: '20s', ethnicity: 'Korean', requiresUserConfirmation: true, rationale: '뷰티 숏츠의 주 시청층' },
    { category: '안티에이징, 기능성 화장품', gender: 'female', ageBand: '40s', ethnicity: 'Korean', requiresUserConfirmation: true, rationale: '구매력과 기능성 니즈의 일치' },
    { category: '주방가전', gender: 'female', ageBand: '30s', ethnicity: 'Korean', requiresUserConfirmation: true, rationale: '신혼과 주방 구매층' },
    { category: '생활가전', gender: 'female', ageBand: '30s', ethnicity: 'Korean', requiresUserConfirmation: true, rationale: '성별 중립 범주에서 단일 진행자 기본안을 선택' },
    { category: '공구, 자동차용품', gender: 'male', ageBand: '40s', ethnicity: 'Korean', requiresUserConfirmation: true, rationale: '카테고리의 주 구매층' },
    { category: '테크 가젯, 충전기, 주변기기', gender: 'male', ageBand: '20s', ethnicity: 'Korean', requiresUserConfirmation: true, rationale: '테크 리뷰 시청층' },
    { category: '유아용품, 육아템', gender: 'female', ageBand: '30s', ethnicity: 'Korean', requiresUserConfirmation: true, rationale: '육아 콘텐츠의 부모 시청층과 여성 우선 기본값' },
    { category: '건강기능식품, 홍삼', gender: 'female', ageBand: '50s', ethnicity: 'Korean', requiresUserConfirmation: true, rationale: '시니어 타깃과 선물 수요' },
    { category: '식품, 간편식', gender: 'female', ageBand: '20s', ethnicity: 'Korean', requiresUserConfirmation: true, rationale: '1인 가구와 가성비 문법' },
    { category: '패션(여성복)', gender: 'female', ageBand: '20s', ethnicity: 'Korean', requiresUserConfirmation: true, rationale: '여성복 트라이온 구매층' },
    { category: '패션(남성복, 스니커즈)', gender: 'male', ageBand: '20s', ethnicity: 'Korean', requiresUserConfirmation: true, rationale: '남성복과 스니커즈 구매층' },
    { category: '여행용품', gender: 'female', ageBand: '30s', ethnicity: 'Korean', requiresUserConfirmation: true, rationale: '여행 브이로그 톤의 단일 진행자 기본안' },
    { category: '정리, 수납, 청소용품', gender: 'female', ageBand: '30s', ethnicity: 'Korean', requiresUserConfirmation: true, rationale: '살림 콘텐츠 시청층' },
    { category: '홈트, 운동기구', gender: 'male', ageBand: '20s', ethnicity: 'Korean', requiresUserConfirmation: true, rationale: '운동 전후 비교 콘텐츠의 단일 진행자 기본안' },
  ],
  adjustmentSignals: [
    { signal: '상세페이지 모델', action: '성별과 나이대를 우선 검토하되 사용자가 확정한다' },
    { signal: '카테고리 평균 대비 고가', action: '기본 나이대보다 10세 높은 안을 제시한다' },
    { signal: '초저가 또는 가성비 카피', action: '20s 또는 30s 안을 제시한다' },
    { signal: '부모님 선물 또는 효도 카피', action: '구매자와 사용자를 분리하고 구매자 페르소나를 확정한다' },
    { signal: '육아 또는 아이 언급', action: '20s 또는 30s 부모 안을 제시한다' },
    { signal: '전문가 또는 프로용 카피', action: '30s부터 50s 사이의 안을 제시한다' },
  ],
  promptRules: {
    appearance: 'Use an explicit Korean man or Korean woman with the confirmed age band.',
    spokenLanguage: 'Korean',
    regenerateOnEthnicityMismatch: true,
  },
})
