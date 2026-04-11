/**
 * i18n Hook - 국제화 시스템
 * 
 * 브라우저 언어 자동 감지 + 수동 선택
 */

import { createContext, useContext, useState, useEffect, useCallback } from 'react'
import ko from '../locales/ko'
import en from '../locales/en'

// 지원 언어
// name: 언어 코드 (EN / KO) — 텍스트
// country: ISO 3166-1 alpha-2 (소문자) — flag-icons CSS 클래스용 (fi-us, fi-kr)
export const LANGUAGES = {
  ko: { code: 'ko', name: 'KO', country: 'kr', strings: ko },
  en: { code: 'en', name: 'EN', country: 'us', strings: en },
}

// 기본 언어
const DEFAULT_LANG = 'en'

// 브라우저 언어 감지
function detectBrowserLanguage() {
  // 1. navigator.language
  if (navigator.language) {
    const langCode = navigator.language.split('-')[0].toLowerCase()
    if (LANGUAGES[langCode]) {
      return langCode
    }
  }
  
  // 3. navigator.languages 배열 (사용자 선호 언어 목록)
  if (navigator.languages?.length > 0) {
    for (const lang of navigator.languages) {
      const langCode = lang.split('-')[0].toLowerCase()
      if (LANGUAGES[langCode]) {
        return langCode
      }
    }
  }
  
  // 4. 레거시 브라우저
  const browserLang = navigator.userLanguage || navigator.browserLanguage || ''
  if (browserLang) {
    const langCode = browserLang.split('-')[0].toLowerCase()
    if (LANGUAGES[langCode]) {
      return langCode
    }
  }
  
  return DEFAULT_LANG
}

// 저장된 언어 가져오기
function getSavedLanguage() {
  try {
    return localStorage.getItem('flow2capcut_lang')
  } catch {
    return null
  }
}

// 언어 저장
function saveLanguage(lang) {
  try {
    localStorage.setItem('flow2capcut_lang', lang)
  } catch {}
}

// Context
const I18nContext = createContext(null)

// Provider
export function I18nProvider({ children }) {
  const [lang, setLang] = useState(() => {
    // 1. 저장된 언어 확인
    const saved = getSavedLanguage()
    if (saved && LANGUAGES[saved]) {
      return saved
    }
    
    // 2. 브라우저 언어 감지
    return detectBrowserLanguage()
  })
  
  // 언어 변경
  const changeLang = useCallback((newLang) => {
    if (LANGUAGES[newLang]) {
      setLang(newLang)
      saveLanguage(newLang)
    }
  }, [])
  
  // 문자열 가져오기 (dot notation 지원)
  const t = useCallback((key, params = {}) => {
    const strings = LANGUAGES[lang]?.strings || LANGUAGES[DEFAULT_LANG].strings
    
    // key를 dot으로 분리해서 nested 값 찾기
    const keys = key.split('.')
    let value = strings
    
    for (const k of keys) {
      if (value && typeof value === 'object' && k in value) {
        value = value[k]
      } else {
        // 키를 찾지 못하면 영어로 fallback
        value = LANGUAGES[DEFAULT_LANG].strings
        for (const k of keys) {
          if (value && typeof value === 'object' && k in value) {
            value = value[k]
          } else {
            return key // 영어에도 없으면 키 자체 반환
          }
        }
        break
      }
    }
    
    // 문자열이 아니면 키 반환
    if (typeof value !== 'string') {
      return key
    }
    
    // 파라미터 치환 {param}
    return value.replace(/\{(\w+)\}/g, (match, paramKey) => {
      return params[paramKey] !== undefined ? params[paramKey] : match
    })
  }, [lang])
  
  const value = {
    lang,
    changeLang,
    t,
    languages: Object.values(LANGUAGES).map(l => ({ code: l.code, name: l.name, country: l.country })),
  }
  
  return (
    <I18nContext.Provider value={value}>
      {children}
    </I18nContext.Provider>
  )
}

// Hook
export function useI18n() {
  const context = useContext(I18nContext)
  if (!context) {
    throw new Error('useI18n must be used within I18nProvider')
  }
  return context
}

export default useI18n
