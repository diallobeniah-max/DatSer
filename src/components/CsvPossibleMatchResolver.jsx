import React, { useMemo, useState } from 'react'
import { Check, ChevronDown, User, UserPlus } from 'lucide-react'

const candidateName = (candidate, formatMemberName) => formatMemberName(candidate?.['Full Name'] || candidate?.full_name || candidate?.fullName || '') || 'Unnamed member'
const candidatePhone = (candidate) => {
  const value = String(candidate?.['Phone Number'] || candidate?.phone_number || candidate?.phoneNumber || '').trim()
  return value && value !== '0000000000' ? value : 'No phone'
}
const candidateKey = (candidate, index) => String(candidate?.id || candidate?.canonical_member_id || candidate?.member_code || `${candidateName(candidate, (value) => value)}-${index}`)

export default function CsvPossibleMatchResolver({ candidates = [], formatMemberName = (value) => value, onSelect, onCreateNew, selectedMemberId = null }) {
  const [showAllCandidates, setShowAllCandidates] = useState(false)
  const visibleCandidates = useMemo(() => (showAllCandidates ? candidates : candidates.slice(0, 3)), [candidates, showAllCandidates])
  const hiddenCount = Math.max(candidates.length - 3, 0)

  return (
    <section aria-label="Possible DatSer matches" className="rounded-2xl border border-amber-200/80 bg-amber-50/40 p-2.5 shadow-sm dark:border-amber-900/60 dark:bg-amber-950/10">
      <div className="mb-2 flex items-center justify-between gap-3 px-0.5">
        <p className="text-xs font-black text-amber-800 dark:text-amber-200">Choose a DatSer match</p>
        <span className="rounded-full bg-amber-100 px-2 py-0.5 text-[10px] font-bold text-amber-800 dark:bg-amber-900/40 dark:text-amber-200">{candidates.length} candidate{candidates.length === 1 ? '' : 's'}</span>
      </div>

      <div className="grid gap-1.5 md:grid-cols-3">
        {visibleCandidates.map((candidate, index) => {
          const key = candidateKey(candidate, index)
          const isSelected = selectedMemberId != null && String(selectedMemberId) === String(candidate.id)
          const name = candidateName(candidate, formatMemberName)
          const phone = candidatePhone(candidate)
          return (
            <button
              key={key}
              type="button"
              aria-pressed={isSelected}
              aria-label={`Select ${name}${phone === 'No phone' ? '' : `, ${phone}`}`}
              onClick={() => onSelect(candidate)}
              className={`group flex min-h-11 w-full items-center gap-2 rounded-xl border px-2.5 text-left transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500 focus-visible:ring-offset-2 dark:focus-visible:ring-offset-gray-900 ${isSelected ? 'border-emerald-500 bg-emerald-50 text-emerald-950 dark:border-emerald-500 dark:bg-emerald-900/35 dark:text-emerald-50' : 'border-gray-200 bg-white hover:border-emerald-400 hover:bg-emerald-50/60 dark:border-gray-700 dark:bg-gray-800 dark:hover:border-emerald-600 dark:hover:bg-emerald-900/20'}`}
            >
              <span className={`flex h-6 w-6 shrink-0 items-center justify-center rounded-lg ${isSelected ? 'bg-emerald-600 text-white' : 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/45 dark:text-emerald-300'}`}>
                {isSelected ? <Check className="h-4 w-4" aria-hidden="true" /> : <User className="h-3.5 w-3.5" aria-hidden="true" />}
              </span>
              <span className="min-w-0 flex-1">
                <span className="block truncate text-xs font-bold text-gray-900 dark:text-white">{name}</span>
                <span className="block truncate text-[10px] text-gray-500 dark:text-gray-400">{phone}</span>
              </span>
              {candidate.member_code && <span className="hidden shrink-0 rounded-md bg-gray-100 px-1.5 py-0.5 text-[10px] font-bold text-gray-500 dark:bg-gray-700 dark:text-gray-300 md:inline">{candidate.member_code}</span>}
              <span className="shrink-0 text-[10px] font-bold text-emerald-700 opacity-0 transition-opacity group-hover:opacity-100 group-focus-visible:opacity-100 dark:text-emerald-300">Select</span>
            </button>
          )
        })}
        <button type="button" onClick={onCreateNew} className="flex min-h-10 w-full items-center gap-2 rounded-xl border border-dashed border-emerald-300 bg-emerald-50/60 px-2.5 text-left text-xs font-bold text-emerald-800 transition-colors hover:border-emerald-500 hover:bg-emerald-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500 focus-visible:ring-offset-2 dark:border-emerald-800 dark:bg-emerald-950/20 dark:text-emerald-200 dark:hover:bg-emerald-900/35 dark:focus-visible:ring-offset-gray-900">
          <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-lg bg-emerald-600 text-white"><UserPlus className="h-3.5 w-3.5" aria-hidden="true" /></span>
          <span>Create as new member</span>
        </button>
      </div>

      {hiddenCount > 0 && <button type="button" aria-expanded={showAllCandidates} onClick={() => setShowAllCandidates((visible) => !visible)} className="mt-1.5 inline-flex min-h-8 items-center gap-1 rounded-lg px-2 text-xs font-bold text-amber-800 hover:bg-amber-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-500 dark:text-amber-200 dark:hover:bg-amber-900/30">
        <ChevronDown className={`h-3.5 w-3.5 transition-transform ${showAllCandidates ? 'rotate-180' : ''}`} aria-hidden="true" />
        {showAllCandidates ? 'Show fewer matches' : `More matches (${hiddenCount})`}
      </button>}

    </section>
  )
}
