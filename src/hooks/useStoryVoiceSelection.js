/**
 * useStoryVoiceSelection — StoryView의 화자→목소리 매핑/VoicePicker 상태를 분리한 훅.
 * M2a-3b/슬라이스3, Task 11 로직을 그대로 이전(순수 리팩터, 동작 동일).
 */
import { useState, useEffect } from 'react'
import { useVoicePreview } from './useVoicePreview'
import { isStoryTtsProvider } from '../config/storyTtsProviders'

export function useStoryVoiceSelection({ speakers, voices, onTagGender }) {
  // 화자별 엔진(provider)·목소리 선택(로컬). 초기값은 speakers[].voice.
  const [voiceBySpeaker, setVoiceBySpeaker] = useState({})
  const [providerBySpeaker, setProviderBySpeaker] = useState({})
  // 화자별 오디오 출처(로컬 오버라이드). {mp3Path, srtPath}면 TTS 대신 그 파일에서 잘라 쓴다.
  // null을 명시적으로 담으면 "해제"(영속된 import voice를 무시) — undefined(미설정)와 구분된다.
  const [importBySpeaker, setImportBySpeaker] = useState({})
  // Task 11: 드롭다운 대신 모달 — 어떤 화자의 VoicePicker가 열려 있는지(speaker id|null)와
  // 확정 전 임시 선택값. 취소 시 providerBySpeaker/voiceBySpeaker는 건드리지 않는다.
  const [voicePickerSpeaker, setVoicePickerSpeaker] = useState(null)
  const [pickerSelection, setPickerSelection] = useState({ provider: '', voiceId: '' })
  const preview = useVoicePreview()
  // 미리듣기 F0 성별 추정 — useVoicePreview가 이미 main에 저장(ttsTagVoiceGender)까지 하므로
  // 여기선 renderer voice 목록만 갱신(onTagGender가 source:'f0'는 낙관적 merge만 하도록 App에서 분기).
  useEffect(() => {
    if (!preview.lastGender) return
    onTagGender?.({ ...preview.lastGender, source: 'f0' })
  }, [preview.lastGender]) // eslint-disable-line react-hooks/exhaustive-deps

  // 사용 가능한 provider 목록(voices에서 파생). 화자별 엔진 드롭다운 옵션.
  const storyVoices = (voices || []).filter((v) => isStoryTtsProvider(v.provider))
  const providerList = [...new Set(storyVoices.map((v) => v.provider).filter(Boolean))]
  // 화자의 현재 provider(엔진): 로컬 선택 > 기존 voice.provider > voices의 첫 provider > typecast.
  const providerForSpeaker = (sp) => {
    const localProvider = providerBySpeaker[sp.id]
    if (isStoryTtsProvider(localProvider)) return localProvider
    if (isStoryTtsProvider(sp.voice?.provider)) return sp.voice.provider
    return providerList[0] ?? 'typecast'
  }
  // 화자의 현재 voiceId: 로컬 오버라이드(빈문자열 포함) > 기존 voice(같은 provider일 때만) > ''.
  const voiceIdForSpeaker = (sp) => {
    if (Object.prototype.hasOwnProperty.call(voiceBySpeaker, sp.id)) return voiceBySpeaker[sp.id]
    return sp.voice?.provider === providerForSpeaker(sp) ? (sp.voice?.voiceId ?? '') : ''
  }

  // 화자의 오디오 출처: 로컬 오버라이드(null 포함) > 영속된 import voice > 없음(=TTS로 생성).
  const importForSpeaker = (sp) => {
    if (Object.prototype.hasOwnProperty.call(importBySpeaker, sp.id)) return importBySpeaker[sp.id]
    return sp.voice?.provider === 'import' ? { mp3Path: sp.voice.mp3Path, srtPath: sp.voice.srtPath } : null
  }
  /** src가 {mp3Path,srtPath}면 지정, null이면 해제(TTS로 되돌림). */
  const setImportForSpeaker = (spId, src) => setImportBySpeaker((m) => ({ ...m, [spId]: src || null }))

  // Task 11: [성우 선택] 버튼 → 해당 화자의 현재 provider/voiceId를 임시 선택값으로 채우고 모달 오픈.
  const openVoicePicker = (sp) => {
    setPickerSelection({ provider: providerForSpeaker(sp), voiceId: voiceIdForSpeaker(sp) })
    setVoicePickerSpeaker(sp.id)
  }
  // 모달 footer [이 성우로 지정] → 임시 선택값을 실제 화자 매핑(voiceBySpeaker/providerBySpeaker)에 커밋.
  // voiceId가 빈 문자열이어도 그대로 저장(기본 성우 선택) — buildAudioParams에서 null 폴백 처리.
  const confirmVoice = () => {
    const spId = voicePickerSpeaker
    if (spId != null) {
      setProviderBySpeaker((m) => ({ ...m, [spId]: pickerSelection.provider }))
      setVoiceBySpeaker((m) => ({ ...m, [spId]: pickerSelection.voiceId }))
    }
    setVoicePickerSpeaker(null)
  }
  // 모달 취소 — providerBySpeaker/voiceBySpeaker는 건드리지 않고 모달만 닫는다.
  const closeVoicePicker = () => setVoicePickerSpeaker(null)
  // VoicePicker 카드 우클릭 성별 수동 지정 → App으로 올려 renderer 목록 갱신 + main 영속 저장.
  const handleOverrideGender = ({ provider, voiceId, gender }) => {
    onTagGender?.({ provider, voiceId, gender, source: 'manual' })
  }

  return {
    providerForSpeaker,
    voiceIdForSpeaker,
    importForSpeaker,
    setImportForSpeaker,
    voicePickerSpeaker,
    pickerSelection,
    setPickerSelection,
    openVoicePicker,
    confirmVoice,
    closeVoicePicker,
    handleOverrideGender,
    preview,
  }
}
