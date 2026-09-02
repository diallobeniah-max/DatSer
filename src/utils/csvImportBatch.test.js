import { describe, expect, it } from 'vitest'
import { CSV_BATCH_STATUS, compareCsvBatchEntries, csvBatchEntryFromSession, csvFileBasename, deriveCsvBatchStatus, findNextCsvBatchEntry, getCsvBatchCounts, getCsvBatchIssueQueue, getCsvBatchReviewSummary, groupCsvBatchSessions, isCsvBatchEntryCompleted, isCsvBatchFile, isCsvBatchImage, mergeCsvBatchFiles, normalizeCsvBatchBasename } from './csvImportBatch'

const f = (name) => ({ name, size: 1, type: name.endsWith('.csv') ? 'text/csv' : 'image/png' })
describe('CSV batch model', () => {
  it('accepts CSV only', () => expect(isCsvBatchFile(f('Sheet 1.csv'))).toBe(true))
  it('rejects executable files', () => expect(isCsvBatchFile(f('Sheet 1.exe'))).toBe(false))
  it('accepts supported images', () => ['jpg','jpeg','png','webp'].forEach((ext) => expect(isCsvBatchImage(f(`a.${ext}`))).toBe(true)))
  it('removes only the final extension', () => expect(csvFileBasename('Sheet.001.csv')).toBe('Sheet.001'))
  it('normalizes case and whitespace', () => expect(normalizeCsvBatchBasename('  SHEET   2.CSV ')).toBe('sheet 2'))
  it('preserves leading zero display names', () => expect(csvFileBasename('Sheet 001.csv')).toBe('Sheet 001'))
  it('pairs exact basenames across extensions', () => expect(mergeCsvBatchFiles([], { batchId:'b', csvFiles:[f('Sheet 1.csv')], imageFiles:[f('sheet 1.jpg')] })[0].status).toBe(CSV_BATCH_STATUS.READY))
  it('never pairs Sheet 1 with Sheet 10', () => expect(mergeCsvBatchFiles([], { batchId:'b', csvFiles:[f('Sheet 1.csv')], imageFiles:[f('Sheet 10.jpg')] })).toHaveLength(2))
  it('does not fuzzy pair old suffixes', () => expect(mergeCsvBatchFiles([], { batchId:'b', csvFiles:[f('Sheet 2.csv')], imageFiles:[f('Sheet 2 old.jpg')] })).toHaveLength(2))
  it('sorts Sheet 1 through Sheet 10 naturally', () => { const files=Array.from({length:10},(_,i)=>f(`Sheet ${10-i}.csv`)); expect(mergeCsvBatchFiles([], {batchId:'b',csvFiles:files}).map(x=>x.displayBasename)).toEqual(Array.from({length:10},(_,i)=>`Sheet ${i+1}`)) })
  it('puts non-numbered sheets after numbered sheets', () => expect([{displayBasename:'Alpha'},{displayBasename:'Sheet 2'}].sort(compareCsvBatchEntries)[0].displayBasename).toBe('Sheet 2'))
  it('detects duplicate CSV basenames', () => expect(mergeCsvBatchFiles([], {batchId:'b',csvFiles:[f('x.csv'),f('X.CSV') ]})[0].status).toBe(CSV_BATCH_STATUS.DUPLICATE_CSV))
  it('detects multiple images', () => expect(mergeCsvBatchFiles([], {batchId:'b',imageFiles:[f('x.jpg'),f('X.png')]})[0].status).toBe(CSV_BATCH_STATUS.DUPLICATE_IMAGE))
  it('allows missing images', () => expect(deriveCsvBatchStatus({csvFiles:[f('x.csv')],imageFiles:[]})).toBe(CSV_BATCH_STATUS.CSV_ONLY))
  it('allows images first', () => expect(deriveCsvBatchStatus({csvFiles:[],imageFiles:[f('x.jpg')]})).toBe(CSV_BATCH_STATUS.IMAGE_ONLY))
  it('later images pair to existing CSV', () => { const first=mergeCsvBatchFiles([], {batchId:'b',csvFiles:[f('x.csv')]}); expect(mergeCsvBatchFiles(first,{batchId:'b',imageFiles:[f('x.jpg')]})[0].status).toBe(CSV_BATCH_STATUS.READY) })
  it('later CSV pairs to existing image', () => { const first=mergeCsvBatchFiles([], {batchId:'b',imageFiles:[f('x.jpg')]}); expect(mergeCsvBatchFiles(first,{batchId:'b',csvFiles:[f('x.csv')]})[0].status).toBe(CSV_BATCH_STATUS.READY) })
  it('second selection adds instead of replacing', () => { const first=mergeCsvBatchFiles([], {batchId:'b',csvFiles:[f('Sheet 1.csv')]}); expect(mergeCsvBatchFiles(first,{batchId:'b',csvFiles:[f('Sheet 2.csv')]})).toHaveLength(2) })
  it('counts canonical states', () => expect(getCsvBatchCounts(mergeCsvBatchFiles([], {batchId:'b',csvFiles:[f('a.csv')],imageFiles:[f('a.jpg'),f('orphan.jpg')]}))).toMatchObject({csvs:1,images:2,paired:1,missingCsv:1}))
  it('marks invalid entries', () => expect(deriveCsvBatchStatus({csvFiles:[f('x.csv')],imageFiles:[],invalid:true})).toBe(CSV_BATCH_STATUS.INVALID))
  it('marks filename sheet mismatch', () => expect(deriveCsvBatchStatus({csvFiles:[f('x.csv')],imageFiles:[],sheetMismatch:true})).toBe(CSV_BATCH_STATUS.MISMATCH))
  it('preserves saved state', () => expect(deriveCsvBatchStatus({status:CSV_BATCH_STATUS.SAVED,csvFiles:[]})).toBe(CSV_BATCH_STATUS.SAVED))
  it('finds the next sheet', () => expect(findNextCsvBatchEntry([{id:'1',originalCsvFilename:'1.csv'},{id:'2',originalCsvFilename:'2.csv'}],'1').id).toBe('2'))
  it('finds the next unsaved sheet', () => expect(findNextCsvBatchEntry([{id:'1',originalCsvFilename:'1.csv',status:'saved'},{id:'2',originalCsvFilename:'2.csv',status:'ready_for_review'}],'1',{unsavedOnly:true}).id).toBe('2'))
  it('restores a draft entry from history JSON', () => expect(csvBatchEntryFromSession({id:'s',save_result:{batch:{id:'b',displayBasename:'Sheet 1',originalCsvFilename:'Sheet 1.csv'}},source_images:[],import_rows:[],parsed_sheets:[]})).toMatchObject({batchId:'b',sessionId:'s'}))
  it('groups persisted sessions by batch', () => expect(groupCsvBatchSessions([{id:'1',save_result:{batch:{id:'b',displayBasename:'Sheet 1'}},source_images:[]},{id:'2',save_result:{batch:{id:'b',displayBasename:'Sheet 2'}},source_images:[]}])[0].entries).toHaveLength(2))
  it('preserves completed sheets while queuing only unresolved rows from later sheets', () => {
    const entries = [
      { id: '1', displayBasename: 'Sheet 1', originalCsvFilename: 'Sheet 1.csv', status: 'saved', rows: [{ importRowId: 'done', saveStatus: 'saved', match: { status: 'exact', selectedMemberId: 'm1' } }] },
      { id: '4', displayBasename: 'Sheet 4', originalCsvFilename: 'Sheet 4.csv', status: 'ready_for_review', rows: [
        { importRowId: 'clean', saveStatus: 'pending', match: { status: 'exact', selectedMemberId: 'm2' } },
        { importRowId: 'attention', saveStatus: 'pending', match: { status: 'exact', selectedMemberId: 'm3' }, edited: { notes: 'Check phone' } },
      ] },
    ]
    expect(isCsvBatchEntryCompleted(entries[0])).toBe(true)
    expect(getCsvBatchIssueQueue(entries).map((issue) => issue.rowId)).toEqual(['attention'])
    expect(getCsvBatchReviewSummary(entries)).toMatchObject({ completedSheets: 1, remainingSheets: 1, ready: 1, issues: 1 })
    expect(findNextCsvBatchEntry(entries, '1', { unsavedOnly: true }).id).toBe('4')
  })

  it('accurately calculates 14-sheet batch breakdown with 4 completed and 10 remaining sheets', () => {
    const completedSheets = Array.from({ length: 4 }, (_, i) => ({
      id: `done-${i + 1}`,
      displayBasename: `Sheet ${i + 1}`,
      originalCsvFilename: `Sheet ${i + 1}.csv`,
      status: CSV_BATCH_STATUS.SAVED,
      rows: Array.from({ length: 15 }, (_, j) => ({
        importRowId: `done-${i + 1}-${j + 1}`,
        saveStatus: 'saved',
        match: { status: 'exact', selectedMemberId: `m-done-${i}-${j}` },
      })), // 4 * 15 = 60 completed rows (approx 59)
    }))

    const remainingSheets = [
      {
        id: 'rem-5',
        displayBasename: 'Sheet 5',
        originalCsvFilename: 'Sheet 5.csv',
        status: CSV_BATCH_STATUS.READY,
        rows: [
          { importRowId: 'r5-1', edited: { fullName: 'Exact One' }, match: { status: 'exact', selectedMemberId: 'm-exact-1' } },
          { importRowId: 'r5-2', edited: { fullName: 'Possible Person' }, match: { status: 'possible', candidates: [{ id: 'cand-1' }] } },
          { importRowId: 'r5-3', edited: { fullName: 'Needs Attention Person', notes: 'Check handwriting' }, match: { status: 'new' } },
          { importRowId: 'r5-4', edited: { fullName: '' }, match: { status: 'invalid' } }, // invalid missing name
        ],
      },
      ...Array.from({ length: 9 }, (_, i) => ({
        id: `rem-${i + 6}`,
        displayBasename: `Sheet ${i + 6}`,
        originalCsvFilename: `Sheet ${i + 6}.csv`,
        status: CSV_BATCH_STATUS.READY,
        rows: [
          { importRowId: `r${i + 6}-1`, edited: { fullName: `Safe New ${i + 6}` }, match: { status: 'new' } },
        ],
      })),
    ]

    const allEntries = [...completedSheets, ...remainingSheets]
    const summary = getCsvBatchReviewSummary(allEntries)

    expect(summary.totalSheets).toBe(14)
    expect(summary.completedSheets).toBe(4)
    expect(summary.remainingSheets).toBe(10)
    expect(summary.completedRows).toBe(60)
    expect(summary.remainingRows).toBe(13)
    expect(summary.exact).toBe(1)
    expect(summary.willCreateNew).toBe(11) // 1 possible (as new) + 1 attention (as new) + 9 safe new
    expect(summary.possible).toBe(1)
    expect(summary.attention).toBe(1)
    expect(summary.invalid).toBe(1)
  })
})
