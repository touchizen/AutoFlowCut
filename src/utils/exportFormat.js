/**
 * exportFormat — 내보내기 포맷 화이트리스트 + 정규화.
 *
 * localStorage('lastExportFormat') 등 외부에서 들어온 값이 깨져도(예: 구버전 잔재,
 * 수동 조작) UI 분기(버튼 라벨 / 모달 카드 / export 경로)가 어긋나지 않도록
 * 항상 유효한 포맷으로 좁힌다. 알 수 없는 값 → 기본 'capcut'.
 *
 * 이 목록은 "정규화 허용 목록"일 뿐 자동 배선이 아니다. 새 포맷(예: 'vrew') 추가 시
 * EXPORT_FORMATS 에 넣는 것 외에 각 소비처도 함께 갱신해야 한다:
 *   - ExportSplitButton: FORMATS(드롭다운 항목) + 라벨 분기
 *   - ExportModal: 카드 분기 + handleExport 의 export 경로 분기
 */

export const EXPORT_FORMATS = ['capcut', 'premiere', 'vrew', 'render']

export const DEFAULT_EXPORT_FORMAT = 'capcut'

export function normalizeExportFormat(value) {
  return EXPORT_FORMATS.includes(value) ? value : DEFAULT_EXPORT_FORMAT
}
