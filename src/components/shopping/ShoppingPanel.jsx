import { useEffect, useMemo, useState } from 'react'

import './ShoppingPanel.css'

const SHOPPING_ERROR_MESSAGES = Object.freeze({
  'invalid-project-path': '프로젝트 폴더를 열 수 없습니다.',
  'project-context-not-ready': '작업 폴더를 준비하고 있습니다. 잠시 후 다시 시도해 주세요.',
  'project-open-failed': '프로젝트를 여는 중 오류가 발생했습니다(저장 파일 손상 등). 다시 시도해 주세요.',
  'story-workflow-requires-step-machine': '쇼핑 숏츠 프로젝트가 아닙니다.',
  'stale-token': '프로젝트가 전환되었습니다. 다시 시도해 주세요.',
  'invalid-transition': '현재 단계에서는 이 작업을 실행할 수 없습니다. 상태를 새로 확인해 주세요.',
  'product-unsupported': '지원하지 않는 상품 페이지입니다.',
  'product-fetch-failed': '상품 정보를 가져오지 못했습니다.',
  'product-snapshot-invalid': '가져온 상품 정보 형식이 올바르지 않습니다.',
  'no-browser-found': '크롤에 Chrome/Brave가 필요합니다. 설치하거나 상품 정보를 수동 입력해 주세요.',
  'shopping-workflow-disabled': '쇼핑 숏츠 프로젝트를 먼저 열어 주세요.',
  'fact-decision-failed': 'A/B 사실확인을 저장하지 못했습니다.',
  'fact-decisions-invalid': 'A/B 사실확인 입력 형식이나 개수를 확인해 주세요.',
  'plan-draft-invalid': '대본·씬표 형식이 올바르지 않습니다. 사실확인과 생성 결과를 다시 확인해 주세요.',
  'plan-generation-failed': '대본·씬표를 생성하지 못했습니다.',
  'materialization-failed': '씬표 승인은 저장됐지만 물질화를 시작하지 못했습니다.',
  'materialization-invalid': '물질화 결과를 확인하지 못했습니다.',
})

const HEADER_COPY = Object.freeze({
  empty: {
    title: '상품 정보 불러오기',
    description: '쿠팡 상품 URL을 입력하면 상품 정보와 근거 사실을 안전하게 가져옵니다.',
  },
  fact_review: {
    title: 'A/B 사실확인',
    description: '대본에 쓸 사실과 절대 쓰지 않을 주장을 직접 확정합니다.',
  },
  plan_review: {
    title: '대본·씬표 검토',
    description: 'persona, 대본, claim과 생성 단위를 확인한 뒤 명시적으로 승인합니다.',
  },
  materialized: {
    title: '생성 준비 완료',
    description: '승인한 씬표가 프로젝트에 저장됐습니다.',
  },
  generating: {
    title: '쇼핑 숏츠 생성 중',
    description: '승인된 씬표를 기준으로 생성 상태를 확인합니다.',
  },
  review_required: {
    title: '생성 결과 검수',
    description: '생성 결과의 화면과 실제 대사를 검수합니다.',
  },
})

export function shoppingErrorMessage(error) {
  const code = typeof error === 'string' ? error : error?.error
  if (!code) return null
  return SHOPPING_ERROR_MESSAGES[code] || '쇼핑 숏츠 작업을 처리하지 못했습니다. 다시 시도해 주세요.'
}

function formatPrice(value) {
  if (typeof value !== 'number' || !Number.isFinite(value)) return null
  return `${new Intl.NumberFormat('ko-KR').format(value)}원`
}

function formatFactValue(value) {
  if (value == null) return ''
  if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
    return String(value)
  }
  try {
    return JSON.stringify(value)
  } catch {
    return String(value)
  }
}

function formatTimelineRange(startMs, endMs) {
  return `${(startMs / 1000).toFixed(1)}–${(endMs / 1000).toFixed(1)}초`
}

function ProductSummary({ product, selectedImage }) {
  return (
    <div className="shopping-product__summary">
      {selectedImage?.sourceUrl && (
        <img src={selectedImage.sourceUrl} alt={product.name || '상품 이미지'} />
      )}
      <div>
        <p className="shopping-product__label">불러온 상품</p>
        <h2>{product.name}</h2>
        <dl className="shopping-product__prices">
          {formatPrice(product.priceKrw) && (
            <div><dt>판매가</dt><dd>{formatPrice(product.priceKrw)}</dd></div>
          )}
          {formatPrice(product.listPriceKrw) && (
            <div><dt>정가</dt><dd>{formatPrice(product.listPriceKrw)}</dd></div>
          )}
          {typeof product.discountPercent === 'number' && (
            <div><dt>할인율</dt><dd>{product.discountPercent}%</dd></div>
          )}
        </dl>
      </div>
    </div>
  )
}

export default function ShoppingPanel({ pipeline }) {
  const [url, setUrl] = useState('')
  const [pending, setPending] = useState(false)
  const [crawlPending, setCrawlPending] = useState(false)
  const [reviewPending, setReviewPending] = useState(null)
  const [localError, setLocalError] = useState(null)
  const [factChoices, setFactChoices] = useState({})
  const [prohibitedTexts, setProhibitedTexts] = useState([''])
  const [factsSaved, setFactsSaved] = useState(false)

  const workflowState = pipeline.state?.state || 'empty'
  const snapshot = pipeline.state?.snapshot
  const sourceFacts = snapshot?.status === 'ok' && Array.isArray(snapshot.sourceFacts)
    ? snapshot.sourceFacts
    : []
  const factSnapshotIdentity = workflowState === 'fact_review' && snapshot?.status === 'ok'
    ? snapshot.snapshotId || sourceFacts.map(({ id }) => id).join('|')
    : null
  const product = snapshot?.status === 'ok' ? snapshot.product : null
  const loading = pending || pipeline.submitting
  const activePlanAction = reviewPending || pipeline.pendingAction || null
  const reviewBusy = Boolean(activePlanAction)
  const headerCopy = HEADER_COPY[workflowState] || HEADER_COPY.empty

  useEffect(() => {
    if (workflowState !== 'fact_review' || snapshot?.status !== 'ok') return
    const decisions = Object.fromEntries(
      (snapshot.factDecisions || []).map(({ sourceFactId, decision }) => [sourceFactId, decision]),
    )
    setFactChoices(decisions)
    const existingProhibited = (snapshot.prohibitedClaims || [])
      .map(({ text }) => text)
      .filter((text) => typeof text === 'string')
    setProhibitedTexts(existingProhibited.length ? existingProhibited : [''])
    setFactsSaved(sourceFacts.length > 0 && sourceFacts.every(({ id }) => (
      decisions[id] === 'allowed' || decisions[id] === 'excluded'
    )))
  }, [factSnapshotIdentity, workflowState])

  const selectedImage = useMemo(() => {
    if (!snapshot?.images?.length) return null
    const selectedId = snapshot.selectedImageIds?.[0]
    return snapshot.images.find((image) => image.id === selectedId) || snapshot.images[0]
  }, [snapshot])

  const claimById = useMemo(() => new Map(
    (snapshot?.claims || []).map((claim) => [claim.id, claim]),
  ), [snapshot])

  const sceneRows = useMemo(() => {
    let cursor = 0
    return (snapshot?.scenes || []).map((scene) => {
      const startMs = cursor
      const duration = Number.isInteger(scene.timelineDurationMs) ? scene.timelineDurationMs : 0
      cursor += duration
      return { scene, startMs, endMs: cursor }
    })
  }, [snapshot])

  const unsupportedError = snapshot?.status === 'unsupported'
    ? `상품 정보를 가져올 수 없습니다: ${snapshot.reason || '지원하지 않는 상품 페이지입니다.'}`
    : null
  const visibleError = unsupportedError
    || localError
    || shoppingErrorMessage(pipeline.error)
    || shoppingErrorMessage(pipeline.openError)
  const crawlActive = crawlPending || pipeline.submitting
  const factsComplete = sourceFacts.length > 0 && sourceFacts.every(({ id }) => (
    factChoices[id] === 'allowed' || factChoices[id] === 'excluded'
  ))
  const approvalMatches = Boolean(
    pipeline.state?.approvedHash
    && pipeline.state.approvedHash === pipeline.state.currentPlanHash,
  )
  const pipelineErrorCode = typeof pipeline.error === 'string'
    ? pipeline.error
    : pipeline.error?.error
  const materializationRetry = workflowState === 'plan_review'
    && approvalMatches
    && pipelineErrorCode === 'materialization-failed'

  const handleSubmit = async (event) => {
    event.preventDefault()
    const value = url.trim()
    if (!value) {
      setLocalError('상품 URL을 입력해 주세요.')
      return
    }
    setLocalError(null)
    setPending(true)
    setCrawlPending(true)
    try {
      const result = await pipeline.submitProduct(value)
      if (result?.error && result.error !== 'aborted') {
        setLocalError(shoppingErrorMessage(result.error))
      }
    } catch (error) {
      setLocalError(shoppingErrorMessage(error?.message || 'product-fetch-failed'))
    } finally {
      setPending(false)
      setCrawlPending(false)
    }
  }

  const handleRetryOpen = async () => {
    setLocalError(null)
    setPending(true)
    try {
      const result = await pipeline.open()
      if (result?.error) setLocalError(shoppingErrorMessage(result.error))
    } catch {
      setLocalError(shoppingErrorMessage('product-fetch-failed'))
    } finally {
      setPending(false)
    }
  }

  const handleAbort = () => {
    pipeline.abort?.()?.catch?.(() => {})
  }

  const chooseFact = (factId, decision) => {
    setFactChoices((current) => ({ ...current, [factId]: decision }))
    setFactsSaved(false)
    setLocalError(null)
  }

  const updateProhibitedText = (index, text) => {
    setProhibitedTexts((current) => current.map((value, row) => (row === index ? text : value)))
    setFactsSaved(false)
  }

  const handleSaveFacts = async () => {
    if (!factsComplete) {
      setLocalError('모든 사실을 A 사용 또는 사용 안 함으로 확정해 주세요.')
      return
    }
    const confirmedAt = new Date().toISOString()
    const factDecisions = sourceFacts.map(({ id }) => ({
      sourceFactId: id,
      decision: factChoices[id],
      confirmedAt,
    }))
    const prohibitedClaims = prohibitedTexts
      .map((text) => text.trim())
      .filter(Boolean)
      .map((text, index) => ({
        id: `prohibited-${index + 1}`,
        text,
        reason: '사용자 B 확정',
      }))
    setLocalError(null)
    setReviewPending('set-fact-decisions')
    try {
      const result = await pipeline.setFactDecisions(factDecisions, prohibitedClaims)
      if (result?.error) setLocalError(shoppingErrorMessage(result.error))
      else setFactsSaved(true)
    } catch (error) {
      setLocalError(shoppingErrorMessage(error?.message || 'fact-decision-failed'))
    } finally {
      setReviewPending(null)
    }
  }

  const handleDraftPlan = async () => {
    if (!factsComplete || !factsSaved) return
    setLocalError(null)
    setReviewPending('draft-plan')
    try {
      const result = await pipeline.draftPlan({})
      if (result?.error && result.error !== 'aborted') {
        setLocalError(shoppingErrorMessage(result.error))
      }
    } catch (error) {
      setLocalError(shoppingErrorMessage(error?.message || 'plan-generation-failed'))
    } finally {
      setReviewPending(null)
    }
  }

  const handleApprovePlan = async () => {
    setLocalError(null)
    setReviewPending('approve-plan')
    try {
      const result = await pipeline.approvePlan()
      if (result?.error && result.error !== 'aborted') {
        setLocalError(shoppingErrorMessage(result.error))
      }
    } catch (error) {
      setLocalError(shoppingErrorMessage(error?.message || 'materialization-failed'))
    } finally {
      setReviewPending(null)
    }
  }

  return (
    <section className="shopping-panel" aria-label="쇼핑 숏츠 상품">
      <header className="shopping-panel__header">
        <p className="shopping-panel__eyebrow">쇼핑 숏츠</p>
        <h1>{headerCopy.title}</h1>
        <p>{headerCopy.description}</p>
      </header>

      {workflowState === 'empty' && (
        <form className="shopping-panel__form" onSubmit={handleSubmit}>
          <label htmlFor="shopping-product-url">상품 URL</label>
          <div className="shopping-panel__url-row">
            <input
              id="shopping-product-url"
              type="url"
              value={url}
              onChange={(event) => setUrl(event.target.value)}
              placeholder="https://www.coupang.com/vp/products/..."
              disabled={loading}
            />
            <button type="submit" disabled={loading}>
              {loading ? '상품 불러오는 중' : '상품 불러오기'}
            </button>
          </div>
        </form>
      )}

      {crawlActive && (
        <div className="shopping-panel__crawl-controls" aria-live="polite">
          <span>별도 브라우저 창에서 상품을 확인하고 있습니다.</span>
          <button type="button" onClick={handleAbort}>크롤 취소</button>
        </div>
      )}

      {visibleError && (
        <div className="shopping-panel__error" role="alert">
          <span>{visibleError}</span>
          {pipeline.openError && (
            <button type="button" onClick={handleRetryOpen} disabled={loading}>
              프로젝트 다시 열기
            </button>
          )}
        </div>
      )}

      {workflowState === 'fact_review' && product && (
        <article className="shopping-product" aria-busy={loading || reviewBusy}>
          <ProductSummary product={product} selectedImage={selectedImage} />

          <section className="shopping-product__facts" aria-labelledby="shopping-facts-title">
            <h3 id="shopping-facts-title">상품 사실 요약</h3>
            <ul>
              {sourceFacts.map((fact) => (
                <li key={fact.id || `${fact.field}-${formatFactValue(fact.value)}`}>
                  <strong>{fact.field}</strong>: {formatFactValue(fact.value)}
                </li>
              ))}
            </ul>
          </section>

          <section className="shopping-fact-review" aria-labelledby="shopping-fact-review-title">
            <div className="shopping-step-heading">
              <div>
                <p className="shopping-product__label">A · 사용할 사실</p>
                <h3 id="shopping-fact-review-title">사실별 사용 여부</h3>
              </div>
              <p>웹페이지에 표시된 값도 자동 승인되지 않습니다.</p>
            </div>
            <div className="shopping-fact-review__list">
              {sourceFacts.map((fact) => (
                <fieldset key={fact.id} className="shopping-fact-card">
                  <legend><strong>{fact.field}</strong>: {formatFactValue(fact.value)}</legend>
                  <p className="shopping-fact-card__provenance">
                    {fact.sourceKind || 'unknown'} · {fact.verification || 'unknown'}
                  </p>
                  <div className="shopping-fact-card__choices">
                    <label>
                      <input
                        type="radio"
                        name={`shopping-fact-${fact.id}`}
                        checked={factChoices[fact.id] === 'allowed'}
                        onChange={() => chooseFact(fact.id, 'allowed')}
                      />
                      A · 대본에 사용
                    </label>
                    <label>
                      <input
                        type="radio"
                        name={`shopping-fact-${fact.id}`}
                        checked={factChoices[fact.id] === 'excluded'}
                        onChange={() => chooseFact(fact.id, 'excluded')}
                      />
                      사용 안 함
                    </label>
                  </div>
                </fieldset>
              ))}
            </div>
          </section>

          <section className="shopping-prohibited" aria-labelledby="shopping-prohibited-title">
            <div className="shopping-step-heading">
              <div>
                <p className="shopping-product__label">B · 금지할 주장</p>
                <h3 id="shopping-prohibited-title">대본에 절대 넣지 않을 문장</h3>
              </div>
              <button
                type="button"
                className="shopping-secondary-button"
                onClick={() => {
                  setProhibitedTexts((current) => [...current, ''])
                  setFactsSaved(false)
                }}
                disabled={reviewBusy}
              >
                금지 주장 추가
              </button>
            </div>
            <div className="shopping-prohibited__list">
              {prohibitedTexts.map((text, index) => (
                <label key={`prohibited-${index + 1}`}>
                  <span>금지 주장 {index + 1}</span>
                  <input
                    type="text"
                    value={text}
                    onChange={(event) => updateProhibitedText(index, event.target.value)}
                    placeholder="예: 흡입력이 업계 최고다"
                    disabled={reviewBusy}
                  />
                </label>
              ))}
            </div>
          </section>

          <div className="shopping-review-actions">
            <button
              type="button"
              className="shopping-secondary-button"
              onClick={handleSaveFacts}
              disabled={!factsComplete || reviewBusy}
            >
              {activePlanAction === 'set-fact-decisions' ? '사실확인 저장 중' : 'A/B 사실확인 저장'}
            </button>
            <button
              type="button"
              className="shopping-primary-button"
              onClick={handleDraftPlan}
              disabled={!factsComplete || !factsSaved || reviewBusy}
            >
              {activePlanAction === 'draft-plan' ? '대본·씬표 생성 중' : '대본·씬표 생성'}
            </button>
          </div>
        </article>
      )}

      {workflowState === 'plan_review' && snapshot && (
        <article className="shopping-plan-review" aria-busy={reviewBusy}>
          <section className="shopping-plan-section shopping-persona" aria-labelledby="shopping-persona-title">
            <p className="shopping-product__label">Persona</p>
            <h2 id="shopping-persona-title">{snapshot.persona?.name || '이름 없음'}</h2>
            <p>{snapshot.persona?.appearance || '외형 정보 없음'}</p>
            <dl>
              <div><dt>역할</dt><dd>{snapshot.persona?.role || '-'}</dd></div>
              <div><dt>성별</dt><dd>{snapshot.persona?.gender || '-'}</dd></div>
              <div><dt>연령대</dt><dd>{snapshot.persona?.ageBand || '-'}</dd></div>
              <div><dt>민족성</dt><dd>{snapshot.persona?.ethnicity || '-'}</dd></div>
            </dl>
          </section>

          <section className="shopping-plan-section" aria-labelledby="shopping-script-title">
            <div className="shopping-step-heading">
              <div>
                <p className="shopping-product__label">Script</p>
                <h2 id="shopping-script-title">대본</h2>
              </div>
              <span>{sceneRows.length}개 씬</span>
            </div>
            <ol className="shopping-script-list">
              {sceneRows.map(({ scene }) => (
                <li key={scene.sceneKey}>
                  <strong>{scene.sceneKey}</strong>
                  <span>{scene.dialogueText || scene.subtitleText || '(대사·자막 없음)'}</span>
                </li>
              ))}
            </ol>
          </section>

          <section className="shopping-plan-section" aria-labelledby="shopping-claims-title">
            <div className="shopping-step-heading">
              <div>
                <p className="shopping-product__label">Claims</p>
                <h2 id="shopping-claims-title">승인 대상 claim</h2>
              </div>
            </div>
            <ul className="shopping-claims-list">
              {(snapshot.claims || []).map((claim) => (
                <li key={claim.id}>
                  <strong>{claim.id}</strong> ({claim.claimType}): {claim.text}
                </li>
              ))}
            </ul>
          </section>

          <section className="shopping-plan-section" aria-labelledby="shopping-scene-table-title">
            <div className="shopping-step-heading">
              <div>
                <p className="shopping-product__label">Scene table</p>
                <h2 id="shopping-scene-table-title">씬표</h2>
              </div>
            </div>
            <div className="shopping-scene-table-wrap">
              <table className="shopping-scene-table">
                <thead>
                  <tr>
                    <th scope="col">씬</th>
                    <th scope="col">시간</th>
                    <th scope="col">visualType</th>
                    <th scope="col">실사 asset</th>
                    <th scope="col">대사·자막</th>
                    <th scope="col">claim</th>
                    <th scope="col">생성 길이</th>
                  </tr>
                </thead>
                <tbody>
                  {sceneRows.map(({ scene, startMs, endMs }) => (
                    <tr key={scene.sceneKey}>
                      <th scope="row">{scene.sceneKey}</th>
                      <td>{formatTimelineRange(startMs, endMs)}</td>
                      <td><code>{scene.visualType}</code></td>
                      <td className="shopping-scene-table__stack">
                        <code>{scene.productImageId || '미지정'}</code>
                        <span>{scene.visualDescription}</span>
                      </td>
                      <td className="shopping-scene-table__stack">
                        <span><strong>대사</strong> {scene.dialogueText || '—'}</span>
                        <span><strong>자막</strong> {scene.subtitleText || '—'}</span>
                      </td>
                      <td className="shopping-scene-table__stack">
                        {(scene.claimIds || []).map((claimId) => {
                          const claim = claimById.get(claimId)
                          return <span key={claimId}>{claimId} · {claim?.text || '없는 claim'}</span>
                        })}
                      </td>
                      <td>{scene.generationDurationSec}초</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>

          {approvalMatches && (
            <div className="shopping-approval-status" role="status">
              <strong>{materializationRetry ? '씬표 승인 완료 · 물질화 재시도 필요' : '씬표 승인 완료 · 물질화 대기'}</strong>
              <span>승인 hash <code>{pipeline.state.approvedHash}</code></span>
              <p>M3 renderer 저장 ack 뒤에 materialized 상태로 전환됩니다.</p>
            </div>
          )}

          <div className="shopping-review-actions shopping-review-actions--sticky">
            <p>승인 시 main이 현재 draft를 다시 검증하고 승인 hash를 직접 계산합니다.</p>
            <button
              type="button"
              className="shopping-primary-button"
              onClick={handleApprovePlan}
              disabled={reviewBusy || (approvalMatches && !materializationRetry)}
            >
              {materializationRetry ? '물질화 다시 시도' : '이 씬표로 생성 승인'}
            </button>
          </div>
        </article>
      )}

      {['materialized', 'generating', 'review_required'].includes(workflowState) && (
        <article className="shopping-post-approval" role="status">
          <strong>{workflowState === 'materialized' ? '씬표가 프로젝트에 저장됐습니다.' : '후속 생성 단계 상태입니다.'}</strong>
          {pipeline.state?.approvedHash && <code>{pipeline.state.approvedHash}</code>}
        </article>
      )}
    </section>
  )
}
