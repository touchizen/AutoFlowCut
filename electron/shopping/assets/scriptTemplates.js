import { defineShoppingAsset } from './asset.js'

export const scriptTemplates = defineShoppingAsset('script-templates/1', {
  templates: [
    {
      id: 'price-info-v1',
      name: '가격 충격·가성비 판정 정보형',
      structure: '승인된 가격·수량 → 단위 가격 계산 → 구성·사용법 정보 → 선택 기준 → 현재 정보 확인',
      evidencePolicy: 'page-or-user-approved-facts-only',
      scenes: [
        { sceneKey: 'S01', purpose: 'hook', copy: '[승인 수량/용량]이 [승인 가격]?' },
        { sceneKey: 'S02', purpose: 'calculation', copy: '표시 정보로 계산한 단위 가격은 [계산값]입니다.' },
        { sceneKey: 'S03', purpose: 'contents', copy: '페이지에 표시된 구성은 [승인 구성]입니다.' },
        { sceneKey: 'S04', purpose: 'instructions', copy: '안내된 사용 방법은 [승인 사용법]입니다.' },
        { sceneKey: 'S05', purpose: 'comparison', copy: '[승인 비교 기준]으로 보면 [승인 차이]가 있습니다.' },
        { sceneKey: 'S06', purpose: 'fit', copy: '[승인 조건]에는 맞고, [승인 제한 조건]은 확인이 필요합니다.' },
        { sceneKey: 'S07', purpose: 'cta', copy: '정확한 구성과 현재 가격은 쇼핑 스티커에서 확인하세요.' },
      ],
    },
    {
      id: 'problem-info-v1',
      name: '문제 해결 정보형',
      structure: '승인된 문제 상황 → 제품 용도 → 설치·사용 정보 → 확인 가능한 규격 → 제한 → 적합 조건',
      evidencePolicy: 'page-or-user-approved-facts-only',
      scenes: [
        { sceneKey: 'S01', purpose: 'hook', copy: '[승인 상황]에서 [승인 문제]가 생긴다면?' },
        { sceneKey: 'S02', purpose: 'problem', copy: '상품 정보에는 [승인 문제 설명]이 제시되어 있습니다.' },
        { sceneKey: 'S03', purpose: 'identity', copy: '이 제품은 [승인 제품명/종류]입니다.' },
        { sceneKey: 'S04', purpose: 'instructions', copy: '안내된 설치·사용 단계는 [승인 단계]입니다.' },
        { sceneKey: 'S05', purpose: 'specification', copy: '확인 가능한 규격과 기능은 [승인 규격/기능]입니다.' },
        { sceneKey: 'S06', purpose: 'limits', copy: '[승인 관리/호환/제한]은 먼저 확인해야 합니다.' },
        { sceneKey: 'S07', purpose: 'cta', copy: '[승인 상황]에 맞는지 쇼핑 스티커의 제품 정보에서 확인하세요.' },
      ],
    },
  ],
  rules: {
    hookWithinMs: 2000,
    maxBenefits: 3,
    primaryPurchaseReasonCount: 1,
    evidenceMustUseApprovedProductInformation: true,
    cta: '왼쪽 아래 쇼핑 스티커에서 제품 정보를 확인하세요.',
  },
})
