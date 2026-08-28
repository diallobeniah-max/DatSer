import React, { useMemo } from 'react'
import { AlertTriangle, ChevronRight, FileSpreadsheet, Image as ImageIcon, Loader2, RotateCcw, Trash2 } from 'lucide-react'
import { CSV_BATCH_STATUS, getCsvBatchCounts, getCsvBatchEntryAttentionCount } from '../utils/csvImportBatch'

const BADGES = {
  [CSV_BATCH_STATUS.READY]: ['Paired · Ready', 'bg-emerald-100 text-emerald-700 dark:bg-emerald-950/55 dark:text-emerald-300'],
  [CSV_BATCH_STATUS.CSV_ONLY]: ['CSV only', 'bg-amber-100 text-amber-700 dark:bg-amber-950/45 dark:text-amber-300'],
  [CSV_BATCH_STATUS.IMAGE_ONLY]: ['Image only', 'bg-sky-100 text-sky-700 dark:bg-sky-950/45 dark:text-sky-300'],
  [CSV_BATCH_STATUS.DUPLICATE_CSV]: ['Duplicate CSV name', 'bg-red-100 text-red-700 dark:bg-red-950/45 dark:text-red-300'],
  [CSV_BATCH_STATUS.DUPLICATE_IMAGE]: ['Multiple images found', 'bg-amber-100 text-amber-700 dark:bg-amber-950/45 dark:text-amber-300'],
  [CSV_BATCH_STATUS.INVALID]: ['Invalid CSV', 'bg-red-100 text-red-700 dark:bg-red-950/45 dark:text-red-300'],
  [CSV_BATCH_STATUS.MISMATCH]: ['Filename / CSV sheet mismatch', 'bg-amber-100 text-amber-700 dark:bg-amber-950/45 dark:text-amber-300'],
  [CSV_BATCH_STATUS.REVIEWED]: ['Reviewed', 'bg-violet-100 text-violet-700 dark:bg-violet-950/45 dark:text-violet-300'],
  [CSV_BATCH_STATUS.SAVED]: ['Already saved', 'bg-emerald-600 text-white'],
  [CSV_BATCH_STATUS.FAILED]: ['Failed · Retry', 'bg-red-100 text-red-700 dark:bg-red-950/45 dark:text-red-300'],
}

export default function CsvImportBatchWorkspace({ batchName, onBatchNameChange, onBatchNameCommit, entries, progress, onReview, onRetry, onRemove, onAssignImage }) {
  const counts = useMemo(() => getCsvBatchCounts(entries), [entries])
  if (!entries.length) return null
  return <section className="overflow-hidden rounded-[1.5rem] border border-emerald-200 bg-white shadow-lg shadow-emerald-950/5 dark:border-emerald-900/70 dark:bg-[#111a16]" aria-label="CSV batch workspace">
    <header className="border-b border-emerald-100 p-4 dark:border-emerald-900/60">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div><p className="text-[10px] font-black uppercase tracking-[0.16em] text-emerald-600 dark:text-emerald-400">Batch import</p><input value={batchName} onChange={(event) => onBatchNameChange(event.target.value)} onBlur={onBatchNameCommit} className="mt-1 w-full rounded-lg border-0 bg-transparent p-0 text-lg font-black text-gray-900 outline-none focus:ring-0 dark:text-white sm:w-80" aria-label="Batch name" /></div>
        {(progress.csvTotal > 0 || progress.imageTotal > 0) && <div className="rounded-xl bg-emerald-50 px-3 py-2 text-xs font-bold text-emerald-700 dark:bg-emerald-950/45 dark:text-emerald-300">{progress.csvTotal > 0 && <span>Parsing CSVs {progress.csvDone} / {progress.csvTotal}</span>}{progress.csvTotal > 0 && progress.imageTotal > 0 && <span> · </span>}{progress.imageTotal > 0 && <span>Uploading images {progress.imageDone} / {progress.imageTotal}</span>}</div>}
      </div>
      <div className="mt-3 grid grid-cols-3 gap-1.5 sm:grid-cols-5 lg:grid-cols-10">{[
        ['CSVs',counts.csvs],['Images',counts.images],['Paired',counts.paired],['Missing image',counts.missingImage],['Missing CSV',counts.missingCsv],['Invalid',counts.invalid],['Ready',counts.ready],['Reviewed',counts.reviewed],['Saved',counts.saved],['Attention',counts.needsAttention],
      ].map(([label,value])=><div key={label} className="rounded-xl bg-gray-50 px-2 py-2 text-center dark:bg-black/20"><span className="block text-base font-black text-gray-900 dark:text-white">{value}</span><span className="block text-[9px] font-bold text-gray-500 dark:text-gray-400">{label}</span></div>)}</div>
    </header>
    <div className="max-h-[28rem] divide-y divide-gray-100 overflow-y-auto dark:divide-gray-800">
      {entries.map((entry,index)=>{ const badge=BADGES[entry.status]||['Draft','bg-gray-100 text-gray-600']; const attentionCount=getCsvBatchEntryAttentionCount(entry); const canReview=!!(entry.sessionId && (entry.csvFiles?.length || entry.originalCsvFilename) && entry.status!==CSV_BATCH_STATUS.DUPLICATE_CSV && entry.status!==CSV_BATCH_STATUS.INVALID); return <article key={entry.id} className="grid gap-3 p-3 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-center [content-visibility:auto]">
        <div className="min-w-0"><div className="flex flex-wrap items-center gap-2"><span className="flex h-7 w-7 items-center justify-center rounded-lg bg-emerald-50 text-xs font-black text-emerald-700 dark:bg-emerald-950/45 dark:text-emerald-300">{index+1}</span><h4 className="truncate text-sm font-black text-gray-900 dark:text-white">{entry.displayBasename}</h4><span className={`rounded-full px-2 py-1 text-[9px] font-black ${badge[1]}`}>{entry.isPersisting?<><Loader2 className="mr-1 inline h-3 w-3 animate-spin"/>Saving draft</>:badge[0]}</span></div>
          <div className="mt-2 flex flex-wrap gap-2 text-[10px] font-bold text-gray-500 dark:text-gray-400"><span className="inline-flex items-center gap-1"><FileSpreadsheet className="h-3 w-3"/>{entry.csvFiles?.length||0} CSV</span><span className="inline-flex items-center gap-1"><ImageIcon className="h-3 w-3"/>{entry.imageFiles?.length||entry.persistedImageCount||0} image</span>{entry.rows?.length>0&&<span>{entry.rows.length} rows</span>}{attentionCount>0&&<span className="inline-flex items-center gap-1 rounded-full bg-red-100 px-2 py-0.5 text-red-700 dark:bg-red-950/55 dark:text-red-300"><AlertTriangle className="h-3 w-3"/>{attentionCount} need attention</span>}{entry.mode&&<span>{entry.mode==='sunday_names'?'Sunday Names List':'Full Register'}</span>}{entry.error&&<span className="text-red-600">{entry.error}</span>}</div>
        </div>
        <div className="flex flex-wrap items-center justify-end gap-1.5">
          {entry.status===CSV_BATCH_STATUS.IMAGE_ONLY && entries.some((candidate)=>candidate.sessionId&&candidate.originalCsvFilename) && <select defaultValue="" onChange={(event)=>{if(event.target.value)onAssignImage(entry.id,event.target.value)}} className="rounded-lg border border-emerald-200 bg-white px-2 py-2 text-[10px] font-black text-emerald-700 dark:border-emerald-800 dark:bg-gray-900 dark:text-emerald-300" aria-label={`Assign ${entry.displayBasename} image to`}><option value="">Assign image to…</option>{entries.filter((candidate)=>candidate.originalCsvFilename).map((candidate)=><option key={candidate.id} value={candidate.id}>{candidate.displayBasename}</option>)}</select>}
          {entry.status===CSV_BATCH_STATUS.FAILED&&<button type="button" onClick={()=>onRetry(entry.id)} className="rounded-lg p-2 text-red-600 hover:bg-red-50" aria-label={`Retry ${entry.displayBasename}`}><RotateCcw className="h-4 w-4"/></button>}
          {entry.status!==CSV_BATCH_STATUS.SAVED&&<button type="button" onClick={()=>onRemove(entry.id)} className="rounded-lg p-2 text-gray-400 hover:bg-red-50 hover:text-red-600 dark:hover:bg-red-950/35" aria-label={`Remove ${entry.displayBasename}`}><Trash2 className="h-4 w-4"/></button>}
          <button type="button" onClick={()=>onReview(entry.id)} disabled={!canReview} className="inline-flex min-h-9 items-center gap-1 rounded-xl bg-emerald-600 px-3 text-xs font-black text-white hover:bg-emerald-700 disabled:cursor-not-allowed disabled:bg-gray-200 disabled:text-gray-400 dark:disabled:bg-gray-800">Review<ChevronRight className="h-3.5 w-3.5"/></button>
        </div>
      </article>})}
    </div>
    {counts.needsAttention>0&&<footer className="flex items-center gap-2 border-t border-amber-100 bg-amber-50/70 px-4 py-3 text-xs font-bold text-amber-800 dark:border-amber-900/50 dark:bg-amber-950/25 dark:text-amber-300"><AlertTriangle className="h-4 w-4"/>Resolve duplicate filenames, invalid CSVs, or sheet mismatches before review.</footer>}
  </section>
}
