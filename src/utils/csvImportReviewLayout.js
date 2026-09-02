export const CSV_IMPORT_REVIEW_COLUMNS = [
  { key: 'row', label: '#', width: 58, compactWidth: 42, min: 50, compactMin: 38 },
  { key: 'sheet', label: 'Sheet', width: 92, compactWidth: 62, min: 76, compactMin: 56 },
  { key: 'fullName', label: 'CSV Name', width: 190, compactWidth: 140, min: 130, compactMin: 118 },
  { key: 'match', label: 'DatSer Match', width: 190, compactWidth: 150, min: 140, compactMin: 124 },
  { key: 'status', label: 'Status', width: 124, compactWidth: 86, min: 104, compactMin: 74 },
  { key: 'phoneNumber', label: 'Phone', width: 140, compactWidth: 102, min: 108, compactMin: 92 },
  { key: 'age', label: 'Age', width: 72, compactWidth: 46, min: 58, compactMin: 42 },
  { key: 'gender', label: 'Gender', width: 100, compactWidth: 68, min: 82, compactMin: 60 },
  { key: 'educationalLevel', label: 'Education', width: 136, compactWidth: 86, min: 100, compactMin: 76 },
  { key: 'parentGuardianName', label: 'Guardian', width: 170, compactWidth: 124, min: 120, compactMin: 108 },
  { key: 'parentGuardianPhone', label: 'Guardian phone', width: 150, compactWidth: 116, min: 112, compactMin: 104 },
  ...[1, 2, 3, 4, 5].map((number) => ({ key: `sunday_${number}`, label: `S${number}`, width: 54, compactWidth: 40, min: 46, compactMin: 36 })),
  { key: 'actions', label: 'Actions', width: 92, compactWidth: 72, min: 76, compactMin: 66 },
]

export const getCsvImportReviewColumns = ({ compactView, parsedSheets, sheetFilter }) => {
  if (!compactView) return CSV_IMPORT_REVIEW_COLUMNS

  const needsSheetContext = (parsedSheets?.length || 0) > 1 && sheetFilter === 'all'
  return CSV_IMPORT_REVIEW_COLUMNS.filter((column) => {
    if (column.key === 'sheet') return needsSheetContext
    return column.key !== 'parentGuardianName' && column.key !== 'parentGuardianPhone'
  })
}

export const getCsvImportReviewColumnWidth = (column, compactView) => (
  compactView ? column.compactWidth : column.width
)

export const getCsvImportReviewColumnMinimum = (column, compactView) => (
  compactView ? (column.compactMin || column.min) : column.min
)
