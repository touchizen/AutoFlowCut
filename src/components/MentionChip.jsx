/**
 * MentionChip — Lexical BeautifulMentionNode 가 렌더하는 inline chip.
 *
 * `trigger` + `value` (예: '@', 'alice') 와 함께 노드 시리얼라이즈 시 저장된 data
 * (refId/refType) 를 받는다. 썸네일 이미지는 외부 references[] 에서 lookup.
 *
 * data 만으로 썸네일을 못 가져오는 이유: BeautifulMentionsItemData 는 primitive 만
 * 허용 — 객체/함수 직렬화 불가. 그래서 refId 기반 lookup 으로 분리.
 *
 * React.Context (MentionRefsContext) 를 통해 references 와 thumbnails 를 받는다.
 */

import { forwardRef, useContext } from 'react'
import { MentionRefsContext } from './MentionRefsContext'
import { resolveImageSrc } from '../utils/formatters'

const MentionChip = forwardRef(function MentionChip(
  { trigger, value, data, className, classNameFocused, classNames, ...rest },
  ref
) {
  const ctx = useContext(MentionRefsContext)
  const refs = ctx?.references || []

  // data.refId 가 있으면 id 로 우선 lookup, 없으면 name 으로 폴백 (수동 입력 케이스).
  const refId = data?.refId
  const matched =
    (refId != null && refs.find((r) => r?.id === refId)) ||
    refs.find((r) => r?.name && String(r.name).toLowerCase() === String(value).toLowerCase())

  const src = matched ? resolveImageSrc(matched) : null

  return (
    <span
      ref={ref}
      className={`mention-chip ${className || ''}`}
      data-mention-trigger={trigger}
      data-mention-value={value}
      {...rest}
    >
      {src ? (
        <img className="mention-chip-thumb" src={src} alt="" loading="lazy" />
      ) : (
        <span className="mention-chip-thumb empty" />
      )}
      <span className="mention-chip-label">
        {trigger}
        {value}
      </span>
    </span>
  )
})

export default MentionChip
