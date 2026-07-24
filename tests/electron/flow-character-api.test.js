/**
 * flow-character-api — Flow 캐릭터 등록 API 헬퍼 (순수 함수).
 *
 * 하이브리드 캐릭터 등록:
 *   1) 생성은 Flow UI 트러스트 클릭으로 트리거(직접 호출은 reCAPTCHA Enterprise 벽에서 400).
 *   2) batchGenerateImages 응답을 가로채 entityId/workflowId/mediaId 추출
 *      (parseCharacterGenerateResponse). entityId 는 workflows[].parentEntityId 에 있다.
 *   3) PATCH /v1/flow/entities 로 이름(멘션) 등록 (buildEntityRegisterBody, recaptcha 불필요).
 * 캡처: Cmd+Shift+N → /tmp/flow-net-capture.json (수동 생성 200 응답으로 역공학).
 */

import { describe, it, expect } from 'vitest'
import {
  buildEntityRegisterBody,
  parseCharacterGenerateResponse,
  buildCharacterResult,
  buildEntityRenameBody,
  buildEntityImageBody,
  downloadFifeAsBase64,
  isStaleEntityErrorBody,
  buildUploadImageBody,
  parseUploadImageResponse,
  buildCharactersUrl,
  normalizeEntityDisplayName,
} from '../../electron/flow-character-api.js'

describe('buildCharactersUrl (A2 bound-project /characters URL)', () => {
  it('projectId 지정 시 base/locale 보존하며 그 프로젝트로 강제', () => {
    expect(buildCharactersUrl('https://labs.google/fx/ko/tools/flow/project/AAAAAAAA-aaaa-aaaa-aaaa-aaaaaaaaaaaa/characters', 'BBB'))
      .toBe('https://labs.google/fx/ko/tools/flow/project/BBB/characters')
    expect(buildCharactersUrl('https://labs.google/fx/tools/flow/project/AAAAAAAA-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'BBB'))
      .toBe('https://labs.google/fx/tools/flow/project/BBB/characters')
  })
  it('projectId 미지정이면 현재 URL 의 project 사용', () => {
    expect(buildCharactersUrl('https://labs.google/fx/ko/tools/flow/project/AAAAAAAA-aaaa-aaaa-aaaa-aaaaaaaaaaaa'))
      .toBe('https://labs.google/fx/ko/tools/flow/project/AAAAAAAA-aaaa-aaaa-aaaa-aaaaaaaaaaaa/characters')
  })
  it('project 없는 URL + projectId 없음 → null', () => {
    expect(buildCharactersUrl('https://labs.google/fx/tools/flow')).toBeNull()
    expect(buildCharactersUrl('')).toBeNull()
  })
  it('P2: 홈/landing(=/project 없음)이어도 projectId 있으면 base 로 /characters 구성', () => {
    expect(buildCharactersUrl('https://labs.google/fx/ko/tools/flow', 'BBB'))
      .toBe('https://labs.google/fx/ko/tools/flow/project/BBB/characters')
    expect(buildCharactersUrl('https://labs.google/fx/tools/flow', 'BBB'))
      .toBe('https://labs.google/fx/tools/flow/project/BBB/characters')
  })
  it('P2: 빈 URL + projectId 있으면 고정 base 폴백', () => {
    expect(buildCharactersUrl('', 'BBB')).toBe('https://labs.google/fx/tools/flow/project/BBB/characters')
  })
})

// A2: 이미지 업로드(/flow/uploadImage) — 캡처(2026-06-25)로 역공학.
//   req: { clientContext:{ projectId, tool:'PINHOLE' }, imageBytes }
//   resp: { media:{ name, workflowId, ... }, workflow:{ name, ... } }
describe('buildUploadImageBody (A2 업로드 요청 body)', () => {
  it('character: entityId → mediaGenerationContext.entityContext + isUserUploaded/mimeType/fileName', () => {
    const b = buildUploadImageBody({ projectId: 'P1', base64: 'AAAA', entityId: 'E1', mimeType: 'image/png', fileName: 'a.png' })
    expect(b).toEqual({
      clientContext: { projectId: 'P1', tool: 'PINHOLE' },
      imageBytes: 'AAAA',
      isUserUploaded: true,
      isHidden: false,
      mimeType: 'image/png',
      fileName: 'a.png',
      mediaGenerationContext: { entityContext: { entityId: 'E1', characterSlot: { imageReferenceIndex: 0 } } },
    })
  })
  it('entityId 없으면 mediaGenerationContext 생략, mimeType 기본 image/jpeg', () => {
    const b = buildUploadImageBody({ projectId: 'P1', base64: 'AAAA' })
    expect(b.mediaGenerationContext).toBeUndefined()
    expect(b.mimeType).toBe('image/jpeg')
    expect(b.isUserUploaded).toBe(true)
  })
})

describe('parseUploadImageResponse (A2 업로드 응답 파싱)', () => {
  // 캡처: uploadImage 가 entity 를 자동 생성하고 그 id 를 workflow.parentEntityId 로 돌려준다.
  //   PATCH /flow/entities 는 그 기존 entityId 만 수정(없는 id 면 404) → 반드시 parentEntityId 사용.
  const RESP = JSON.stringify({
    media: { name: 'media-uuid', projectId: 'P1', workflowId: 'wf-uuid', workflowStepId: 'CAE' },
    workflow: { name: 'wf-uuid', parentEntityId: 'ent-uuid' },
  })
  it('media.name→mediaId, media.workflowId→workflowId, workflow.parentEntityId→entityId', () => {
    expect(parseUploadImageResponse(RESP)).toEqual({ mediaId: 'media-uuid', workflowId: 'wf-uuid', entityId: 'ent-uuid' })
  })
  it('media.workflowId 없으면 workflow.name 으로 폴백', () => {
    const r = JSON.stringify({ media: { name: 'm' }, workflow: { name: 'wf2', parentEntityId: 'e2' } })
    expect(parseUploadImageResponse(r)).toEqual({ mediaId: 'm', workflowId: 'wf2', entityId: 'e2' })
  })
  it('객체 입력도 허용 / workflowId·entityId 없으면 null', () => {
    expect(parseUploadImageResponse({ media: { name: 'm' } })).toEqual({ mediaId: 'm', workflowId: null, entityId: null })
  })
  it('파싱 불가/빈 → null', () => {
    expect(parseUploadImageResponse('not json')).toBeNull()
    expect(parseUploadImageResponse({})).toBeNull()
    expect(parseUploadImageResponse(null)).toBeNull()
  })
})

describe('buildEntityRegisterBody', () => {
  it('sets displayName + imageReferences[{workflowId}] with updateMask', () => {
    const b = buildEntityRegisterBody({ projectId: 'P1', entityId: 'E1', displayName: '싸이코', workflowId: 'W1' })
    expect(b.entity.projectId).toBe('P1')
    expect(b.entity.entityId).toBe('E1')
    expect(b.entity.entityInfo.displayName).toBe('싸이코')
    expect(b.entity.entityInfo.characterInfo.imageReferences).toEqual([{ workflowId: 'W1' }, {}])
    expect(b.updateMask).toBe('entityInfo.displayName,entityInfo.characterInfo.imageReferences')
  })
})

describe('normalizeEntityDisplayName — 빈 이름 등록 차단 판정', () => {
  it.each([undefined, null, '', '   '])('빈 값(%s)은 등록 가능한 이름이 아니다', (value) => {
    expect(normalizeEntityDisplayName(value)).toBeNull()
  })

  it('이름이 있으면 기존 등록 동작을 바꾸지 않도록 원문을 돌려준다', () => {
    expect(normalizeEntityDisplayName('  싸이코  ')).toBe('  싸이코  ')
  })
})

describe('parseCharacterGenerateResponse', () => {
  // 실제 수동 생성(200) 응답 구조(flow-net-capture.json #15)를 축약.
  const resp = {
    media: [{
      name: 'cd1a18c7-789f-4b80-a7ca-0676aa3f024c',
      workflowId: '62d439ba-66fa-40c3-9790-8c21e6b01d20',
      image: { generatedImage: { seed: 796865, fifeUrl: 'https://flow-content.google/image/M1' } },
    }],
    workflows: [{
      name: '62d439ba-66fa-40c3-9790-8c21e6b01d20',
      metadata: { primaryMediaId: 'cd1a18c7-789f-4b80-a7ca-0676aa3f024c' },
      projectId: '1e1c0a72-88fc-4a4a-b86f-c11694640c88',
      parentEntityId: 'f72a13c4-d860-4910-8180-f8cc1d525744',
    }],
  }
  it('extracts workflowId/mediaId/fifeUrl from the first media', () => {
    const r = parseCharacterGenerateResponse(JSON.stringify(resp))
    expect(r).toMatchObject({
      workflowId: '62d439ba-66fa-40c3-9790-8c21e6b01d20',
      mediaId: 'cd1a18c7-789f-4b80-a7ca-0676aa3f024c',
      fifeUrl: 'https://flow-content.google/image/M1',
    })
  })
  it('extracts entityId from workflows[].parentEntityId (UI 가 만든 서버측 entity)', () => {
    const r = parseCharacterGenerateResponse(JSON.stringify(resp))
    expect(r.entityId).toBe('f72a13c4-d860-4910-8180-f8cc1d525744')
  })
  it('returns null on empty/invalid response', () => {
    expect(parseCharacterGenerateResponse('{}')).toBeNull()
    expect(parseCharacterGenerateResponse('not json')).toBeNull()
  })

  it('P2: workflows 순서가 달라도 media[0].workflowId 로 매칭해 올바른 parentEntityId 선택', () => {
    const r = parseCharacterGenerateResponse(JSON.stringify({
      media: [{ name: 'MED_A', workflowId: 'WF_A', image: { generatedImage: { fifeUrl: 'u' } } }],
      workflows: [
        { name: 'WF_B', parentEntityId: 'ENT_B' },   // 다른 workflow 가 먼저
        { name: 'WF_A', parentEntityId: 'ENT_A' },   // media 에 대응하는 것
      ],
    }))
    expect(r.entityId).toBe('ENT_A') // workflows[0]('ENT_B') 가 아니라 매칭된 것
  })

  it('P2: metadata.primaryMediaId 로도 매칭', () => {
    const r = parseCharacterGenerateResponse(JSON.stringify({
      media: [{ name: 'MED_A', workflowId: 'WFx', image: { generatedImage: {} } }],
      workflows: [
        { name: 'other', parentEntityId: 'ENT_B' },
        { name: 'WFy', metadata: { primaryMediaId: 'MED_A' }, parentEntityId: 'ENT_A' },
      ],
    }))
    expect(r.entityId).toBe('ENT_A')
  })

  it('P2: 매칭 실패 + workflow 1개 → workflows[0] 폴백', () => {
    const r = parseCharacterGenerateResponse(JSON.stringify({
      media: [{ name: 'MED_A', workflowId: 'WF_A', image: { generatedImage: {} } }],
      workflows: [{ name: 'nomatch', parentEntityId: 'ENT_0' }],
    }))
    expect(r.entityId).toBe('ENT_0')
  })
  it('R4-P1: 매칭 실패 + workflow 여러 개 → entityId null (잘못된 등록 방지)', () => {
    const r = parseCharacterGenerateResponse(JSON.stringify({
      media: [{ name: 'MED_A', workflowId: 'WF_A', image: { generatedImage: {} } }],
      workflows: [{ name: 'x', parentEntityId: 'ENT_X' }, { name: 'y', parentEntityId: 'ENT_Y' }],
    }))
    expect(r.entityId).toBeNull()
  })
})

describe('buildCharacterResult', () => {
  const parsed = { entityId: 'E1', workflowId: 'W1', mediaId: 'M1', fifeUrl: 'https://f/img' }
  it('base64 있으면 images:[{base64,mediaId}] 포함', () => {
    const r = buildCharacterResult(parsed, 'data:image/png;base64,AAA', { displayName: '겁청', registered: true })
    expect(r).toMatchObject({ success: true, entityId: 'E1', workflowId: 'W1', mediaId: 'M1', displayName: '겁청', registered: true })
    expect(r.images).toEqual([{ base64: 'data:image/png;base64,AAA', mediaId: 'M1' }])
  })
  it('base64 없으면 images 빈 배열', () => {
    expect(buildCharacterResult(parsed, null, {}).images).toEqual([])
  })
})

describe('buildEntityRenameBody', () => {
  it('displayName 만 PATCH (updateMask 이름 한정)', () => {
    const b = buildEntityRenameBody({ projectId: 'P1', entityId: 'E1', displayName: '새이름' })
    expect(b).toEqual({
      entity: { projectId: 'P1', entityId: 'E1', entityInfo: { displayName: '새이름' } },
      updateMask: 'entityInfo.displayName',
    })
  })
})

describe('buildEntityImageBody', () => {
  it('이미지 레퍼런스만 PATCH (displayName 미포함, updateMask = imageReferences 한정)', () => {
    const b = buildEntityImageBody({ projectId: 'P1', entityId: 'E1', workflowId: 'W9' })
    expect(b).toEqual({
      entity: {
        projectId: 'P1',
        entityId: 'E1',
        entityInfo: { characterInfo: { imageReferences: [{ workflowId: 'W9' }, {}] } },
      },
      updateMask: 'entityInfo.characterInfo.imageReferences',
    })
    // displayName 이 entityInfo 에 없어야 함
    expect(b.entity.entityInfo.displayName).toBeUndefined()
  })
})

describe('downloadFifeAsBase64', () => {
  const okFetch = async () => ({ ok: true, arrayBuffer: async () => new Uint8Array([1, 2, 3]).buffer, headers: { get: () => 'image/jpeg' } })
  it('fifeUrl 없으면 null', async () => {
    expect(await downloadFifeAsBase64(okFetch, null)).toBe(null)
  })
  it('sessionFetch 없으면 null', async () => {
    expect(await downloadFifeAsBase64(null, 'http://x')).toBe(null)
  })
  it('정상 → data:URL(content-type 반영)', async () => {
    const r = await downloadFifeAsBase64(okFetch, 'http://x/i.jpg')
    expect(r).toMatch(/^data:image\/jpeg;base64,/)
  })
  it('content-type 없으면 image/png 기본', async () => {
    const f = async () => ({ ok: true, arrayBuffer: async () => new Uint8Array([1]).buffer, headers: { get: () => null } })
    expect(await downloadFifeAsBase64(f, 'http://x')).toMatch(/^data:image\/png;base64,/)
  })
  it('not ok → null', async () => {
    expect(await downloadFifeAsBase64(async () => ({ ok: false }), 'http://x')).toBe(null)
  })
  it('throw → null (삼킴)', async () => {
    expect(await downloadFifeAsBase64(async () => { throw new Error('net') }, 'http://x')).toBe(null)
  })
})

describe('isStaleEntityErrorBody', () => {
  it('error.status === INVALID_ARGUMENT → true (stale)', () => {
    expect(isStaleEntityErrorBody('{"error":{"status":"INVALID_ARGUMENT"}}')).toBe(true)
  })
  it('다른 400(FAILED_PRECONDITION/content policy) → false', () => {
    expect(isStaleEntityErrorBody('{"error":{"status":"FAILED_PRECONDITION"}}')).toBe(false)
  })
  it('R5-P1: message/details 에만 INVALID_ARGUMENT 있고 status 는 다름 → false (문자열 포함 오판 방지)', () => {
    expect(isStaleEntityErrorBody('{"error":{"status":"FAILED_PRECONDITION","message":"not INVALID_ARGUMENT really"}}')).toBe(false)
  })
  it('빈/널/파싱불가 → false', () => {
    expect(isStaleEntityErrorBody('')).toBe(false)
    expect(isStaleEntityErrorBody(null)).toBe(false)
    expect(isStaleEntityErrorBody('not json')).toBe(false)
  })
})
