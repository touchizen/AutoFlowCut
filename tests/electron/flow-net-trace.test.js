/**
 * flow-net-trace — AUTOFLOWCUT_NET_TRACE=1 진단 트레이스의 순수 헬퍼.
 *
 * main 이 Flow 페이지의 batchexecute 요청/응답을 JSONL 로 남길 때 쓰는 게이트·경로·디코더·요약.
 * 실기(2026-09-23): 새 flow.google.com 은 모든 RPC 를 POST batchexecute?rpcids=… 로 보낸다.
 */
import { describe, it, expect } from 'vitest'
import path from 'node:path'
import {
  isNetTraceOn, netTraceFilePath, decodeUploadData, batchexecuteRpcIds,
  buildTraceLine, summarizeTraceEntry,
} from '../../electron/flow-net-trace.js'

describe('isNetTraceOn — 정확히 "1" 일 때만', () => {
  it('"1" 이면 on', () => { expect(isNetTraceOn({ AUTOFLOWCUT_NET_TRACE: '1' })).toBe(true) })
  it('없음/빈값/"true"/"0" 은 off', () => {
    expect(isNetTraceOn({})).toBe(false)
    expect(isNetTraceOn(undefined)).toBe(false)
    expect(isNetTraceOn({ AUTOFLOWCUT_NET_TRACE: '' })).toBe(false)
    expect(isNetTraceOn({ AUTOFLOWCUT_NET_TRACE: 'true' })).toBe(false)
    expect(isNetTraceOn({ AUTOFLOWCUT_NET_TRACE: '0' })).toBe(false)
  })
})

describe('netTraceFilePath — 명시 경로 우선, 아니면 바탕화면 타임스탬프 jsonl', () => {
  it('AUTOFLOWCUT_NET_TRACE_FILE 이 있으면 그대로', () => {
    expect(netTraceFilePath({ AUTOFLOWCUT_NET_TRACE_FILE: '/x/y.jsonl' }, '/desk')).toBe('/x/y.jsonl')
  })
  it('없으면 <desktop>/autoflowcut-xhr-<stamp>.jsonl (콜론·점 없는 stamp)', () => {
    const p = netTraceFilePath({}, '/desk', new Date('2026-09-24T03:04:05.678Z'))
    expect(p).toBe(path.join('/desk', 'autoflowcut-xhr-2026-09-24T03-04-05-678Z.jsonl'))
  })
})

describe('decodeUploadData — webRequest uploadData → 본문 문자열', () => {
  it('bytes 청크를 utf8 로 이어 붙인다', () => {
    const up = [{ bytes: Buffer.from('f.req=%5B%5B%5B%22ab') }, { bytes: Buffer.from('cd%22%5D%5D%5D&at=tok') }]
    expect(decodeUploadData(up)).toBe('f.req=%5B%5B%5B%22abcd%22%5D%5D%5D&at=tok')
  })
  it('file 항목은 값 대신 <file:…> 표식', () => {
    expect(decodeUploadData([{ file: '/tmp/a.png' }])).toBe('<file:/tmp/a.png>')
  })
  it('없거나 비면 null', () => {
    expect(decodeUploadData(undefined)).toBeNull()
    expect(decodeUploadData([])).toBeNull()
  })
})

describe('batchexecuteRpcIds — URL 쿼리의 rpcids', () => {
  it('콤마 구분 목록', () => {
    expect(batchexecuteRpcIds('https://flow.google.com/_/AiSandboxAngularFrontend/data/batchexecute?rpcids=AbCdEf%2CGhIjKl&source-path=%2Fproject%2Fx&f.sid=-1&bl=boq_x&hl=ko&_reqid=123&rt=c'))
      .toEqual(['AbCdEf', 'GhIjKl'])
  })
  it('상대경로도 뽑는다 — 페이지 XHR 은 /_/… 로 연다(2026-09-24 실측)', () => {
    expect(batchexecuteRpcIds('/_/AiSandboxAngularFrontend/data/batchexecute?rpcids=qJcgMc%2CZzl0ze&f.sid=1')).toEqual(['qJcgMc', 'Zzl0ze'])
  })
  it('rpcids 없음/깨진 URL 은 []', () => {
    expect(batchexecuteRpcIds('https://flow.google.com/_/x/batchexecute')).toEqual([])
    expect(batchexecuteRpcIds('not a url')).toEqual([])
    expect(batchexecuteRpcIds(undefined)).toEqual([])
  })
})

describe('buildTraceLine — 한 줄 JSON, t 와 rpcids 를 앞에 붙인다', () => {
  it('entry 필드를 보존하고 rpcids 를 URL 에서 뽑는다', () => {
    const line = buildTraceLine({ source: 'xhr', method: 'POST', url: 'https://flow.google.com/_/a/data/batchexecute?rpcids=Q1', status: 200, reqBody: 'f.req=x', respBody: ")]}'\n" }, 1700000000000)
    expect(line).not.toContain('\n')
    const o = JSON.parse(line)
    expect(o).toMatchObject({ t: 1700000000000, rpcids: ['Q1'], source: 'xhr', method: 'POST', status: 200, reqBody: 'f.req=x', respBody: ")]}'\n" })
  })
  it('url 이 없어도 터지지 않는다(rpcids [])', () => {
    expect(JSON.parse(buildTraceLine({ source: 'wiz', wiz: '{}' }, 1)).rpcids).toEqual([])
  })
})

describe('summarizeTraceEntry — 콘솔 한 줄(값 없이 크기만)', () => {
  it('source method host path rpcids status 크기', () => {
    const s = summarizeTraceEntry({ source: 'xhr', method: 'POST', url: 'https://flow.google.com/_/AiSandboxAngularFrontend/data/batchexecute?rpcids=Q1%2CQ2&at=SECRET', status: 200, reqBody: 'abcd', respBody: 'abcdefgh' })
    expect(s).toContain('xhr POST flow.google.com /_/AiSandboxAngularFrontend/data/batchexecute')
    expect(s).toContain('rpcids=Q1,Q2')
    expect(s).toContain('status=200')
    expect(s).toContain('req=4b')
    expect(s).toContain('resp=8b')
    expect(s).not.toContain('SECRET')
  })
  it('상대경로는 host 를 (relative) 로 두고 path·rpcids 는 뽑는다', () => {
    const s = summarizeTraceEntry({ source: 'xhr', method: 'POST', url: '/_/AiSandboxAngularFrontend/data/batchexecute?rpcids=Q1', status: 200 })
    expect(s).toContain('xhr POST (relative) /_/AiSandboxAngularFrontend/data/batchexecute rpcids=Q1')
  })
  it('본문 없음/깨진 URL 도 한 줄', () => {
    expect(typeof summarizeTraceEntry({ source: 'wiz', url: 'nope' })).toBe('string')
  })
})
