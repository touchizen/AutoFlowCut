/**
 * modeInfo — API/Flow 생성 모드의 장단점(대상·가격·속도·특징) 공용 정의.
 *
 * ModeSelector(첫 실행 피커) 카드와 ModeToggle(상단 토글) hover 툴팁이 동일한 문구를
 * 쓰도록 i18n 키만 모아둔다. 실제 문자열은 locale(ko/en)에 있고, 소비자가 t(key) 로 해석한다.
 * (useI18n 의 t() 는 문자열만 반환하므로 배열을 직접 못 담아 키 목록으로 보관.)
 */
export const MODE_INFO = {
  flow: {
    nameKey: 'modeInfo.flow.name',
    descKey: 'modeInfo.flow.desc',
    featKeys: [
      'modeInfo.flow.audience',
      'modeInfo.flow.price',
      'modeInfo.flow.speed',
      'modeInfo.flow.setup',
    ],
  },
  api: {
    nameKey: 'modeInfo.api.name',
    descKey: 'modeInfo.api.desc',
    featKeys: [
      'modeInfo.api.audience',
      'modeInfo.api.price',
      'modeInfo.api.speed',
      'modeInfo.api.extra',
    ],
  },
}

/** 툴팁용 멀티라인 문자열: "이름\n• feat\n• feat …" */
export function modeTooltip(mode, t) {
  const info = MODE_INFO[mode]
  if (!info) return ''
  return [t(info.nameKey), ...info.featKeys.map((key) => t(key))].join('\n')
}
