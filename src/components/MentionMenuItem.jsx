/**
 * MentionMenuItem — `@` 트리거 시 BeautifulMentionsPlugin 이 띄우는 드롭다운의
 * 개별 아이템. 우리 디자인: 썸네일 + 이름 + (type) suffix.
 *
 * item.data 에 refId 가 들어 있어서 그걸로 references 에서 ref 객체를 찾아 썸네일 src 추출.
 */

import { forwardRef, useContext } from 'react'
import { MentionRefsContext } from './MentionRefsContext'
import { resolveImageSrc } from '../utils/formatters'

const MentionMenuItem = forwardRef(function MentionMenuItem(
  { selected, item, itemValue: _itemValue, label: _label, refId: _refIdProp, refType: _refTypeProp, ...rest },
  ref
) {
  const ctx = useContext(MentionRefsContext)
  const refs = ctx?.references || []

  const refId = item?.data?.refId
  const matched =
    (refId != null && refs.find((r) => r?.id === refId)) ||
    refs.find((r) => r?.name && String(r.name).toLowerCase() === String(item?.value).toLowerCase())

  const src = matched ? resolveImageSrc(matched) : null
  const type = matched?.type || item?.data?.refType || ''

  return (
    <li
      ref={ref}
      className={`mention-menu-item ${selected ? 'selected' : ''}`}
      {...rest}
    >
      {src ? (
        <img className="mention-menu-thumb" src={src} alt="" loading="lazy" />
      ) : (
        <span className="mention-menu-thumb empty" />
      )}
      <span className="mention-menu-label">
        @{item?.value}
        {type && <span className="mention-menu-type">{type}</span>}
      </span>
    </li>
  )
})

export default MentionMenuItem
