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
