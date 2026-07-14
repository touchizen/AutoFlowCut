// @vitest-environment jsdom
//
// 🔴 **raw JSON 만으로는 사용자가 무엇을 승인하는지 모른다.**
//    `{"speakers":[{"id":"narrator","voice":{...}}]}` 를 보고 뭘 하는 건지 알 수 없다면,
//    "인자를 보여줬다"는 건 알리바이일 뿐이다.
//
// 🔴 **그렇다고 요약이 원본을 *대체* 하면 안 된다.** grant 는 인자 전체에 묶인다 — 요약만 보여주면
//    "사람이 승인한 것"과 "실제 실행되는 것"이 갈릴 수 있다. **둘 다** 보여준다:
//      - 사람 말로 무엇을 하는지 (**앱이** 만든다 — 모델이 아니라)
//      - 정확히 무엇이 실행되는지 (원본 그대로)
import React from 'react'
import { act, cleanup, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { I18nProvider } from '../../../src/hooks/useI18n'
import { __resetFlowHiddenForTests } from '../../../src/hooks/useModalVisibility'
import ApprovalDialog from '../../../src/components/agent/ApprovalDialog.jsx'

let fire
beforeEach(() => {
  __resetFlowHiddenForTests()
  window.electronAPI = {
    onAgentPermissionRequest: (cb) => { fire = cb; return () => {} },
    respondAgentPermission: vi.fn(),
    setModalVisible: vi.fn(),
  }
})
afterEach(() => { cleanup(); localStorage.clear(); delete window.electronAPI })

function open(lang, tool, args) {
  localStorage.setItem('autoflowcut_lang', lang)
  const view = render(<I18nProvider><ApprovalDialog /></I18nProvider>)
  act(() => fire({
    requestId: 'r1', tool, sessionId: 's1',
    // main 신뢰 경계에서 검증된 구조화 args를 그대로 받는다. 문자열 프로토콜을 재현하지 않는다.
    args,
  }))
  return view
}

describe('승인 창은 무엇을 하는지 사람 말로 알려준다', () => {
  it('화자 설정: 기존 명단에 병합하며 누락된 기존 화자는 유지한다고 말한다', () => {
    open('ko', 'story_set_speakers', {
      speakers: [
        { id: 'narrator', name: '나레이션' },
        { id: 'kim', name: '김철수', voice: null, role: '형사' },
      ],
    })

    const summary = screen.getByTestId('approval-description').textContent
    expect(summary, '무엇을 하는지 사람 말로 설명하지 않는다').toMatch(/화자/)
    expect(summary, '몇 명인지 안 알려준다').toMatch(/2/)
    expect(summary, '누구인지 안 알려준다').toMatch(/나레이션/)
    expect(summary).toMatch(/병합/)
    expect(summary).toMatch(/유지/)
    expect(summary).toContain('음성: null')
    expect(summary).toContain('역할: 형사')
    expect(summary).toMatch(/기존 화자.*이미 설정된.*성별.*나이.*역할.*외모.*덮어써지지 않을 수/)
    expect(summary).toMatch(/확정 명단 상태에서는.*추가로.*이름 변경.*명단 밖 신규 화자/)
  })

  it('audio regenerate는 서술하고 미래의 모르는 params 키만 residual raw로 남긴다', () => {
    const { container } = open('ko', 'story_start_step', {
      step: 'audio',
      params: { speakers: [{ id: 'HIJACK', name: 'HIJACK' }], regenerate: ['seg-1'] },
    })

    const description = screen.getByTestId('approval-description').textContent
    expect(description).toMatch(/비용/)
    expect(description).toMatch(/강제 재합성 1/)
    expect(description).toContain('seg-1')
    expect(description).toMatch(/함께 새로 합성/)
    expect(description).toMatch(/재그룹.*scenes\.json.*재작성.*이미지.*비디오 프롬프트.*씬 요약.*소실될 수/)

    const residual = container.querySelector('.approval-residual-args')
    expect(residual).toBeTruthy()
    expect(residual.textContent).toContain('/params/speakers/0/id')
    expect(residual.textContent).toContain('HIJACK')
    expect(screen.getByText(/설명되지 않은 인자/)).toBeTruthy()

    // residual이 있으면 전체 원본도 details 안에 숨길 수 없다.
    expect(container.querySelector('.approval-original-expanded .approval-args')).toBeTruthy()
    expect(container.querySelector('details.approval-original')).toBeNull()
  })

  it('긴 synopsis는 JSON escape 없이 block으로 전부 보이고 원본 JSON도 접근 가능하다', () => {
    const args = { synopsisMd: `BEGIN-${'긴'.repeat(5000)}-END`, characters: [] }
    const { container } = open('ko', 'story_confirm_synopsis', args)

    expect(screen.getByTestId('approval-description')).toBeTruthy()
    const block = container.querySelector('.approval-block-text')
    expect(block.textContent).toBe(args.synopsisMd)
    const raw = container.querySelector('.approval-args').textContent
    expect(JSON.parse(raw)).toEqual(args)
    expect(raw).toContain('-END')
    expect(container.querySelector('details.approval-original')).toBeTruthy()
  })

  it('headline을 맨 앞에 두고 그 뒤에 danger, 정보 줄을 놓는다', () => {
    const { container } = open('ko', 'story_start_step', {
      step: 'audio', params: { regenerate: ['seg-1'], sfxSources: { 'seg-1': 'library' } },
    })

    const lines = [...container.querySelectorAll('.approval-line')]
    expect(lines[0].textContent).toMatch(/audio.*단계.*시작/)
    expect(lines[0].classList.contains('approval-line-danger')).toBe(false)
    const afterHeadline = lines.slice(1)
    const lastDanger = afterHeadline.map((line) => line.classList.contains('approval-line-danger')).lastIndexOf(true)
    const firstInfo = afterHeadline.findIndex((line) => !line.classList.contains('approval-line-danger'))
    expect(lastDanger).toBeLessThan(firstInfo)
  })

  // 🔴 경고가 헤드라인을 밀어내면 사람은 "무엇을 하는지"를 마지막에 읽는다. 모든 툴이 같은 계약이다.
  it('화자 설정도 무엇을 하는지를 경고보다 먼저 보여준다', () => {
    const { container } = open('ko', 'story_set_speakers', {
      speakers: [{ id: 'lee', name: '이영희', gender: 'male' }],
    })

    const lines = [...container.querySelectorAll('.approval-line')]
    expect(lines[0].textContent, '경고가 "무엇을 하는지"보다 앞에 왔다').toMatch(/병합/)
    expect(lines[0].classList.contains('approval-line-danger')).toBe(false)
    expect(lines.some((line) => line.classList.contains('approval-line-danger')), '보존 경고가 사라졌다').toBe(true)
  })

  it('coverage가 완전해도 전체 원본 인자를 details로 항상 접근할 수 있다', () => {
    const { container } = open('ko', 'story_set_speakers', {
      speakers: [{ id: 'narrator', name: '나레이션' }],
    })

    const original = container.querySelector('details.approval-original')
    expect(original, '완전 coverage라고 전체 원본을 없앴다').toBeTruthy()
    expect(JSON.parse(original.querySelector('.approval-args').textContent))
      .toEqual({ speakers: [{ id: 'narrator', name: '나레이션' }] })
  })

  it('여러 줄 원문은 문장 안이 아니라 pre block에서 앞뒤 공백까지 verbatim으로 보존한다', () => {
    const scriptOverride = '  첫 줄\n둘째 줄  '
    const { container } = open('ko', 'story_start_step', {
      step: 'scenes', params: { scriptOverride },
    })
    const block = container.querySelector('.approval-block-text')

    expect(block.textContent).toBe(scriptOverride)
    expect([...container.querySelectorAll('.approval-line')].some((line) => line.textContent.includes(scriptOverride))).toBe(false)
  })

  it('pastedScript의 제출된 제목·옵션 교체값을 danger 문장에 그대로 렌더한다', () => {
    const { container } = open('ko', 'story_start_step', {
      step: 'script',
      params: {
        pastedScript: '수정 대본',
        title: '야담 5화',
        options: { genre: 'yadam', language: 'ko' },
      },
    })
    const danger = [...container.querySelectorAll('.approval-line-danger')]
      .map((line) => line.textContent).join('\n')

    expect(danger).toMatch(/프로젝트 제목.*"야담 5화".*교체/)
    expect(danger).toContain('{"genre":"yadam","language":"ko"}')
    expect(danger).toMatch(/생성 옵션.*교체/)
  })

  it('pastedScript에서 생략된 제목·옵션이 지워진다는 경고를 렌더한다', () => {
    const { container } = open('ko', 'story_start_step', {
      step: 'script', params: { pastedScript: '수정 대본' },
    })
    const danger = [...container.querySelectorAll('.approval-line-danger')]
      .map((line) => line.textContent).join('\n')

    expect(danger).toMatch(/title.*생략.*프로젝트 제목.*지워/)
    expect(danger).toMatch(/options.*생략.*생성 옵션.*지워/)
  })

  it('confirm synopsis의 중복·나레이터 제외 경고를 실제 교체 목록과 함께 렌더한다', () => {
    open('ko', 'story_confirm_synopsis', {
      characters: [{ name: '나레이션' }, { name: '김철수' }, { name: '김철수' }],
    })
    const description = screen.getByTestId('approval-description').textContent

    expect(description).toMatch(/3건.*교체/)
    expect(description).toMatch(/정규화.*중복.*나레이터.*제외/)
  })
})
