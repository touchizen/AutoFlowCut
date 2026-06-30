/**
 * MentionRefsContext — chip 컴포넌트가 외부 references 를 lookup 하기 위한 컨텍스트.
 *
 * BeautifulMentionsItemData 는 primitive 만 직렬화 가능 → 썸네일 src 같은 동적
 * 데이터는 chip 안에서 컨텍스트로 받는 게 깔끔. references 가 바뀌면 모든 chip 이
 * 자동 재렌더 (썸네일 새로 들어왔을 때 등).
 */

import { createContext } from 'react'

export const MentionRefsContext = createContext({ references: [] })
