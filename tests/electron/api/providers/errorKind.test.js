import { describe, expect, it } from 'vitest'
import {
  ERROR_KINDS,
  classifyGoogleErrorKind,
} from '../../../../electron/api/providers/errorKind.js'

describe('Google provider errorKind taxonomy', () => {
  it('exports the canonical ordered taxonomy', () => {
    expect(ERROR_KINDS).toEqual([
      'auth',
      'forbidden',
      'quota',
      'transient',
      'safety',
      'invalid-config',
      'invalid-input',
      'other',
    ])
  })

  it.each([
    ['No API key', 'auth'],
    ['HTTP 401 :: Request failed', 'auth'],
    ['HTTP 400 :: API key not valid. Please pass a valid API key. :: INVALID_ARGUMENT', 'auth'],
    ['HTTP 400 :: Request failed :: API_KEY_INVALID', 'auth'],
    ['HTTP 429 :: Request failed :: RESOURCE_EXHAUSTED', 'quota'],
    ['Quota exceeded. Check quota and billing details.', 'quota'],
    ['HTTP 503 :: video download failed', 'transient'],
    ['The model is overloaded.', 'transient'],
    ['Please try again later.', 'transient'],
    ['Service temporarily unavailable', 'transient'],
    ['HTTP 500 :: UNAVAILABLE', 'transient'],
    ['Blocked by safety filter: SAFETY', 'safety'],
    ['Veo media was blocked by the safety filter (1 item)', 'safety'],
    ['No image was generated', 'other'],
    ['Video URI not found in completed operation', 'other'],
  ])('classifies adapter error %j as %s', (errorText, expectedKind) => {
    expect(classifyGoogleErrorKind(errorText)).toBe(expectedKind)
  })

  it.each([
    [
      'HTTP 401 :: RESOURCE_EXHAUSTED :: overloaded :: Blocked by safety filter: SAFETY',
      'auth',
    ],
    [
      'HTTP 429 :: RESOURCE_EXHAUSTED :: overloaded :: Blocked by safety filter: SAFETY',
      'quota',
    ],
    [
      'HTTP 503 :: Blocked by safety filter: SAFETY',
      'transient',
    ],
  ])('keeps auth > quota > transient > safety priority for %j', (errorText, expectedKind) => {
    expect(classifyGoogleErrorKind(errorText)).toBe(expectedKind)
  })

  it.each([
    ['Generated 503 frames successfully'],
    ['The model is available'],
    ['The safety filter documentation was displayed'],
  ])('does not classify unrelated text as a signal: %j', (errorText) => {
    expect(classifyGoogleErrorKind(errorText)).toBe('other')
  })
})
