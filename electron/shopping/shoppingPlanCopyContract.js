export const SHOPPING_PLAN_COPY_CONTRACT = Object.freeze({
  factCopyClaimTypes: Object.freeze(['page_fact', 'numeric_fact', 'editorial_fit']),
  factCopyPolicy: Object.freeze({
    allowExactReferencedValue: true,
    allowSuppliedScriptTemplateSubstitution: true,
    fieldFormats: Object.freeze({
      priceKrw: Object.freeze([
        '판매가는 {value}원',
        '가격은 {value}원',
        '현재 가격은 {value}원',
      ]),
      listPriceKrw: Object.freeze([
        '정가는 {value}원',
        '표시 정가는 {value}원',
      ]),
      reviewCount: Object.freeze([
        '상품평 {value}개',
        '{value}개 상품평',
      ]),
      monthlyPurchaseCount: Object.freeze([
        '한 달간 {value}명 이상 구매',
        '한 달간 {value}명 이상 구매했어요',
      ]),
      ratingValue: Object.freeze([
        '평점은 {value}점',
        '별점은 {value}점',
      ]),
      tomorrowDelivery: Object.freeze([
        '내일 도착',
      ]),
      brand: Object.freeze([
        '{value} 브랜드',
      ]),
      category: Object.freeze([
        '{value} 제품',
      ]),
    }),
    fieldValueFormats: Object.freeze({
      deliveryType: Object.freeze({
        rocket: Object.freeze(['로켓배송 상품']),
        rocketFresh: Object.freeze(['로켓프레시 상품']),
        standard: Object.freeze(['일반배송 상품']),
      }),
    }),
  }),
  derivedDiscountFormats: Object.freeze([
    '{percent}% 할인',
    '정가 대비 {percent}% 할인',
  ]),
  safeDisclosureTexts: Object.freeze([
    '이 영상은 AI로 생성되었습니다.',
    '제휴 링크를 통해 수익을 얻을 수 있습니다.',
  ]),
  forbiddenEvidencePhrases: Object.freeze([
    '직접 확인해봤습니다',
    '첫 느낌',
    '문의가 많았습니다',
  ]),
  visualDescriptions: Object.freeze({
    product_still: Object.freeze([
      '실제 제품 이미지',
      '승인된 실제 제품 이미지',
      '승인된 실제 제품 클로즈업',
    ]),
    persona_i2v: Object.freeze([
      '한국인 진행자가 카메라를 본다',
      '한국인 진행자가 카메라를 보며 말한다',
    ]),
  }),
  personaVideoPromptTemplate: 'Presenter speaking in Korean, say exactly "{dialogueText}", no ad-lib, no extra speech, no music, no captions, no on-screen text',
})

export function fillShoppingCopyFormat(format, placeholder, value) {
  return format.replaceAll(`{${placeholder}}`, String(value))
}

export function controlledPersonaVideoPrompt(dialogueText) {
  return fillShoppingCopyFormat(
    SHOPPING_PLAN_COPY_CONTRACT.personaVideoPromptTemplate,
    'dialogueText',
    dialogueText,
  )
}
