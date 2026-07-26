/**
 * CharacterCards — 시놉시스 게이트의 등장인물 카드 편집 목록 (spec §v2.5).
 *
 * controlled 컴포넌트: characters[](storyCharacter 스키마) + onChange.
 * 필드: name/gender/ethnicity(출신, §v2.12)/age/role/appearance, 행 추가/삭제. gender는 내부 enum
 * (male/female/unknown)으로 저장하고 표시 라벨만 i18n(§v2.7).
 * 이름 변경 시 id도 name.trim()으로 재파생 — 이름 변경=신규 인물 취급(§v2.9 MINOR①).
 */
import { normalizeStoryCharacter } from '../../services/storyCharacter'

const GENDERS = ['male', 'female', 'unknown']

export default function CharacterCards({ characters = [], onChange, disabled = false, t = (key, fallback) => fallback }) {
  const update = (index, patch) => onChange(characters.map((c, i) => (i === index ? { ...c, ...patch } : c)))
  const genderLabel = {
    male: t('story.synopsis.genderMale', '남성'),
    female: t('story.synopsis.genderFemale', '여성'),
    unknown: t('story.synopsis.genderUnknown', '미상'),
  }
  return (
    <div className="story-character-cards">
      {/* 컬럼 헤더 — 각 입력칸이 무엇인지 알려준다(카드와 동일 flex로 정렬). 행이 있을 때만. */}
      {characters.length > 0 && (
        <div className="story-character-header" aria-hidden="true">
          <span className="story-character-col-name">{t('story.synopsis.charName', '이름')}</span>
          <span className="story-character-col-gender">{t('story.synopsis.charGender', '성별')}</span>
          <span className="story-character-col-ethnicity">{t('story.synopsis.charEthnicity', '출신')}</span>
          <span className="story-character-col-age">{t('story.synopsis.charAge', '나이')}</span>
          <span className="story-character-col-role">{t('story.synopsis.charRole', '역할')}</span>
          <span className="story-character-col-appearance">{t('story.synopsis.charAppearance', '프롬프트')}</span>
          <span className="story-character-col-remove" aria-hidden="true" />
        </div>
      )}
      {characters.map((c, i) => (
        // key는 index — id가 name 파생이라 이름 편집 중 key가 바뀌면 포커스를 잃는다.
        <div key={i} className="story-character-card">
          <input
            className="story-input story-character-name"
            aria-label={t('story.synopsis.charName', '이름')}
            placeholder={t('story.synopsis.charName', '이름')}
            value={c.name}
            title={c.name || undefined}
            disabled={disabled}
            onChange={(e) => update(i, { name: e.target.value, id: e.target.value.trim() })}
          />
          <select
            className="story-input story-character-gender"
            aria-label={t('story.synopsis.charGender', '성별')}
            value={c.gender}
            disabled={disabled}
            onChange={(e) => update(i, { gender: e.target.value })}
          >
            {GENDERS.map((g) => (
              <option key={g} value={g}>{genderLabel[g]}</option>
            ))}
          </select>
          {/* §v2.12: 출신/인종 자유입력(성별 옆) — 이미지 프롬프트에 조합돼 인종을 반영. */}
          <input
            className="story-input story-character-ethnicity"
            aria-label={t('story.synopsis.charEthnicity', '출신')}
            placeholder={t('story.synopsis.charEthnicity', '출신')}
            value={c.ethnicity ?? ''}
            title={c.ethnicity || undefined}
            disabled={disabled}
            onChange={(e) => update(i, { ethnicity: e.target.value })}
          />
          <input
            className="story-input story-character-age"
            aria-label={t('story.synopsis.charAge', '나이')}
            placeholder={t('story.synopsis.charAge', '나이')}
            value={c.age}
            disabled={disabled}
            onChange={(e) => update(i, { age: e.target.value })}
          />
          <input
            className="story-input story-character-role"
            aria-label={t('story.synopsis.charRole', '역할')}
            placeholder={t('story.synopsis.charRole', '역할')}
            value={c.role}
            title={c.role || undefined}
            disabled={disabled}
            onChange={(e) => update(i, { role: e.target.value })}
          />
          <input
            className="story-input story-character-appearance"
            aria-label={t('story.synopsis.charAppearance', '프롬프트')}
            placeholder={t('story.synopsis.charAppearance', '프롬프트')}
            value={c.appearance}
            title={c.appearance || undefined}
            disabled={disabled}
            onChange={(e) => update(i, { appearance: e.target.value })}
          />
          <button
            type="button"
            className="story-btn-secondary story-character-remove"
            aria-label={t('story.synopsis.removeCharacter', '행 삭제')}
            disabled={disabled}
            onClick={() => onChange(characters.filter((_, idx) => idx !== i))}
          >
            ✕
          </button>
        </div>
      ))}
      <button
        type="button"
        className="story-btn-secondary story-character-add"
        disabled={disabled}
        onClick={() => onChange([...characters, normalizeStoryCharacter({})])}
      >
        + {t('story.synopsis.addCharacter', '행 추가')}
      </button>
    </div>
  )
}
