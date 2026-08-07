import React, { useMemo, useState } from 'react'
import {
  AlertTriangle,
  ArrowLeft,
  CheckCircle2,
  ChevronRight,
  Clock,
  Database,
  FileSearch,
  Loader2,
  RefreshCw,
  Search,
  ShieldCheck,
  Users,
  X
} from 'lucide-react'
import useMemberDataReview from '../hooks/useMemberDataReview'
import {
  PROFILE_FIELDS,
  REVIEW_FILTERS,
  REVIEW_SORTS,
  filterReviewPersons,
  sortReviewPersons
} from '../utils/memberDataReview'

const FILTER_OPTIONS = [
  { id: REVIEW_FILTERS.ALL, label: 'All Members' },
  { id: REVIEW_FILTERS.NEEDS_REVIEW, label: 'Needs Review' },
  { id: REVIEW_FILTERS.CONFLICTS, label: 'Conflicts' },
  { id: REVIEW_FILTERS.INCOMPLETE, label: 'Incomplete' },
  { id: REVIEW_FILTERS.MULTIPLE_MONTHS, label: 'Multiple Months' }
]

const SORT_OPTIONS = [
  { id: REVIEW_SORTS.NAME, label: 'Name' },
  { id: REVIEW_SORTS.COMPLETENESS, label: 'Completeness' },
  { id: REVIEW_SORTS.MONTHS, label: 'Most Months' },
  { id: REVIEW_SORTS.RECENT, label: 'Most Recently Updated' }
]

const FIELD_LABEL = Object.fromEntries(PROFILE_FIELDS.map((field) => [field.key, field.label]))
const FIELD_KEYS = PROFILE_FIELDS.map((field) => field.key)

const formatPercent = (percent) => `${Math.round(percent * 100)}%`

const formatDate = (value) => {
  if (!value) return '—'
  const date = new Date(value)
  return Number.isNaN(date.getTime())
    ? String(value)
    : date.toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' })
}

const identityLabel = (person) => {
  if (person.uncertain) return 'Identity uncertain — name only'
  if (person.keyType === 'uuid') return 'Canonical ID'
  if (person.keyType === 'code') return 'Canonical code'
  if (person.keyType === 'phone') return 'Phone number'
  return 'Name'
}

const Card = ({ children, className = '' }) => (
  <div className={`rounded-2xl border border-gray-200 bg-white shadow-sm dark:border-gray-700 dark:bg-gray-800 ${className}`}>
    {children}
  </div>
)

const PersonCard = ({ person, onClick }) => {
  const hasConflicts = person.conflicts.length > 0
  return (
    <button
      type="button"
      onClick={onClick}
      className="group w-full rounded-2xl border border-gray-200 bg-white p-4 text-left shadow-sm transition-all hover:border-orange-300 hover:shadow-md dark:border-gray-700 dark:bg-gray-800 dark:hover:border-orange-600"
    >
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="truncate font-bold text-gray-900 dark:text-white">{person.name}</p>
          <div className="mt-1 flex flex-wrap items-center gap-1.5">
            {person.code ? (
              <span className="rounded-md bg-orange-100 px-2 py-0.5 text-[11px] font-black text-orange-700 dark:bg-orange-900/40 dark:text-orange-300">
                {person.code}
              </span>
            ) : null}
            <span className="text-[11px] font-semibold text-gray-500 dark:text-gray-400">
              {person.monthCount} {person.monthCount === 1 ? 'month' : 'months'} · {person.recordCount} {person.recordCount === 1 ? 'record' : 'records'}
            </span>
          </div>
        </div>
        <div className="flex shrink-0 items-center gap-1">
          {person.uncertain && (
            <span title="Identity uncertain" className="rounded-full bg-amber-100 p-1 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300">
              <AlertTriangle className="h-3.5 w-3.5" />
            </span>
          )}
          {hasConflicts && (
            <span title="Conflicts" className="rounded-full bg-red-100 p-1 text-red-700 dark:bg-red-900/40 dark:text-red-300">
              <AlertTriangle className="h-3.5 w-3.5" />
            </span>
          )}
          <ChevronRight className="h-4 w-4 text-gray-400 transition-transform group-hover:translate-x-0.5" />
        </div>
      </div>

      <div className="mt-3">
        <div className="flex items-center justify-between text-[11px] font-semibold text-gray-500 dark:text-gray-400">
          <span>Profile completeness</span>
          <span className={person.completeness.percent === 1 ? 'text-green-600 dark:text-green-400' : ''}>
            {formatPercent(person.completeness.percent)}
          </span>
        </div>
        <div className="mt-1 h-1.5 w-full overflow-hidden rounded-full bg-gray-100 dark:bg-gray-700">
          <div
            className={`h-full rounded-full ${person.completeness.percent === 1 ? 'bg-green-500' : person.completeness.percent >= 0.6 ? 'bg-orange-500' : 'bg-amber-500'}`}
            style={{ width: `${Math.round(person.completeness.percent * 100)}%` }}
          />
        </div>
        <div className="mt-2 flex items-center gap-1.5 text-[11px] text-gray-400 dark:text-gray-500">
          <Clock className="h-3 w-3" />
          <span>Updated {formatDate(person.latestUpdate)}</span>
        </div>
      </div>
    </button>
  )
}

const RecommendedProfilePanel = ({ person }) => {
  const recommended = person.recommended
  return (
    <Card className="overflow-hidden">
      <div className="border-b border-gray-200 bg-orange-50/70 px-4 py-3 dark:border-gray-700 dark:bg-orange-950/30">
        <p className="flex items-center gap-1.5 text-xs font-black uppercase tracking-wider text-orange-700 dark:text-orange-300">
          <ShieldCheck className="h-4 w-4" />
          Recommended Profile
        </p>
        <p className="mt-0.5 text-sm font-bold text-gray-900 dark:text-white">{person.label}</p>
      </div>
      <div className="grid grid-cols-1 gap-x-4 sm:grid-cols-2">
        {FIELD_KEYS.map((key) => {
          const provenance = recommended.provenance[key]
          const value = recommended.combined[key]
          if (!provenance) return null
          return (
            <div key={key} className="border-b border-gray-100 px-4 py-2.5 last:border-0 dark:border-gray-700/60">
              <p className="text-[10px] font-black uppercase tracking-wider text-gray-400 dark:text-gray-500">{FIELD_LABEL[key]}</p>
              <p className="truncate text-sm font-semibold text-gray-900 dark:text-white">{String(value)}</p>
              <p className="text-[11px] text-orange-600 dark:text-orange-400">Source: {provenance.sourceMonth}</p>
            </div>
          )
        })}
        {Object.keys(recommended.provenance).length === 0 && (
          <p className="px-4 py-4 text-sm text-gray-500 dark:text-gray-400">No useful profile fields found.</p>
        )}
      </div>
      <div className="border-t border-gray-200 px-4 py-3 text-xs text-gray-500 dark:border-gray-700 dark:text-gray-400">
        Combined completeness: <span className="font-bold text-gray-900 dark:text-white">{formatPercent(recommended.completeness.percent)}</span>
      </div>
    </Card>
  )
}

const MostCompletePanel = ({ person }) => {
  const record = person.mostComplete
  if (!record) return null
  return (
    <Card className="p-4">
      <p className="flex items-center gap-1.5 text-xs font-black uppercase tracking-wider text-gray-500 dark:text-gray-400">
        <CheckCircle2 className="h-4 w-4 text-green-600 dark:text-green-400" />
        Most Complete Single Record
      </p>
      <p className="mt-2 text-sm font-bold text-gray-900 dark:text-white">{record.source_month_label}</p>
      <p className="text-xs text-gray-500 dark:text-gray-400">
        {record.completeness.count}/{record.completeness.total} fields ({formatPercent(record.completeness.percent)})
      </p>
      {record.completeness.missingFields.length > 0 && (
        <p className="mt-2 text-[11px] text-amber-700 dark:text-amber-300">
          Missing: {record.completeness.missingFields.map((field) => FIELD_LABEL[field]).join(', ')}
        </p>
      )}
    </Card>
  )
}

const ConflictsPanel = ({ person }) => {
  if (person.conflicts.length === 0) return null
  return (
    <Card className="overflow-hidden">
      <div className="border-b border-gray-200 bg-red-50/70 px-4 py-3 dark:border-gray-700 dark:bg-red-950/30">
        <p className="flex items-center gap-1.5 text-xs font-black uppercase tracking-wider text-red-700 dark:text-red-300">
          <AlertTriangle className="h-4 w-4" />
          Conflicts — review before acting
        </p>
      </div>
      <div className="divide-y divide-gray-100 dark:divide-gray-700/60">
        {person.conflicts.map((conflict, index) => (
          <div key={`${conflict.field}-${index}`} className="px-4 py-3">
            <p className="text-[10px] font-black uppercase tracking-wider text-gray-400 dark:text-gray-500">
              {conflict.kind === 'identity' ? 'Identity' : conflict.label}
            </p>
            <div className="mt-1.5 space-y-1.5">
              {conflict.values.map((entry, i) => (
                <div key={i} className="flex items-center justify-between gap-2 rounded-lg bg-gray-50 px-2.5 py-1.5 dark:bg-gray-900/60">
                  <span className="truncate text-sm font-semibold text-gray-800 dark:text-gray-200">{String(entry.value)}</span>
                  <span className="shrink-0 text-[11px] text-gray-500 dark:text-gray-400">{entry.months.join(', ')}</span>
                </div>
              ))}
            </div>
          </div>
        ))}
      </div>
    </Card>
  )
}

const ComparisonView = ({ person, onBack }) => (
  <div className="space-y-4">
    <div className="flex items-start justify-between gap-2">
      <div>
        <button
          type="button"
          onClick={onBack}
          className="flex items-center gap-1.5 text-sm font-semibold text-orange-600 hover:text-orange-700 dark:text-orange-400"
        >
          <ArrowLeft className="h-4 w-4" />
          Back to list
        </button>
        <h2 className="mt-2 text-xl font-black text-gray-900 dark:text-white">{person.name}</h2>
        <div className="mt-1 flex flex-wrap items-center gap-2 text-xs text-gray-500 dark:text-gray-400">
          {person.code ? <span className="rounded-md bg-orange-100 px-2 py-0.5 font-black text-orange-700 dark:bg-orange-900/40 dark:text-orange-300">{person.code}</span> : null}
          <span>{identityLabel(person)}</span>
          <span>·</span>
          <span>{person.monthCount} months · {person.recordCount} records</span>
        </div>
      </div>
      <button
        type="button"
        onClick={onBack}
        className="rounded-full p-2 text-gray-400 hover:bg-gray-100 hover:text-gray-700 dark:hover:bg-gray-700"
        aria-label="Close comparison"
      >
        <X className="h-5 w-5" />
      </button>
    </div>

    <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
      <RecommendedProfilePanel person={person} />
      <div className="space-y-4">
        <MostCompletePanel person={person} />
        <ConflictsPanel person={person} />
      </div>
    </div>

    {/* Per-month comparison */}
    <div>
      <h3 className="mb-2 text-xs font-black uppercase tracking-wider text-gray-500 dark:text-gray-400">Records by month</h3>
      <div className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-3">
        {person.records.map((record) => (
          <Card key={`${record.sourceTable}_${record.id}`} className="overflow-hidden">
            <div className="border-b border-gray-200 bg-gray-50 px-3 py-2 dark:border-gray-700 dark:bg-gray-900/50">
              <p className="text-sm font-black text-gray-900 dark:text-white">{record.source_month_label}</p>
              <p className="text-[11px] text-gray-400 dark:text-gray-500">
                {record.completeness.count}/{record.completeness.total} fields
              </p>
            </div>
            <div className="divide-y divide-gray-100 dark:divide-gray-700/60">
              {FIELD_KEYS.map((key) => {
                const value = record[key]
                const isBlank = value === undefined || value === null || (typeof value === 'string' && value.trim() === '')
                const hasConflict = person.conflicts.some((c) => c.field === key)
                return (
                  <div key={key} className="flex items-start justify-between gap-2 px-3 py-1.5">
                    <span className="text-[11px] font-semibold text-gray-400 dark:text-gray-500">{FIELD_LABEL[key]}</span>
                    <span className={`truncate text-right text-xs font-medium ${isBlank ? 'text-gray-300 dark:text-gray-600' : hasConflict ? 'text-amber-700 dark:text-amber-300' : 'text-gray-800 dark:text-gray-200'}`}>
                      {isBlank ? '—' : String(value)}
                    </span>
                  </div>
                )
              })}
            </div>
          </Card>
        ))}
      </div>
    </div>
  </div>
)

const MemberDataReview = ({ onBack }) => {
  const { status, error, persons, rawRecordCount, monthCount, reload } = useMemberDataReview()
  const [query, setQuery] = useState('')
  const [filter, setFilter] = useState(REVIEW_FILTERS.ALL)
  const [sortBy, setSortBy] = useState(REVIEW_SORTS.NAME)
  const [sortDir, setSortDir] = useState('asc')
  const [selectedId, setSelectedId] = useState(null)

  const filteredPersons = useMemo(
    () => sortReviewPersons(filterReviewPersons(persons, { filter, query }), { sortBy, sortDir }),
    [persons, filter, query, sortBy, sortDir]
  )

  const selected = persons.find((person) => person.id === selectedId) || null

  return (
    <div className="mx-auto w-full max-w-7xl px-3 py-4 sm:px-4 sm:py-6">
      {/* Header */}
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <div className="grid h-11 w-11 place-items-center rounded-2xl bg-orange-100 text-orange-600 dark:bg-orange-950/60 dark:text-orange-400">
            <Database className="h-5 w-5" />
          </div>
          <div>
            <h1 className="text-lg font-black text-gray-900 dark:text-white">Member Data Review</h1>
            <p className="text-xs font-medium text-gray-500 dark:text-gray-400">Read-only analysis across all months</p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={reload}
            className="inline-flex items-center gap-1.5 rounded-xl border border-gray-200 bg-white px-3 py-2 text-xs font-bold text-gray-700 transition-colors hover:border-orange-300 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-200"
            title="Reload all months"
          >
            <RefreshCw className="h-3.5 w-3.5" />
            Reload
          </button>
          <button
            type="button"
            onClick={onBack}
            className="inline-flex items-center gap-1.5 rounded-xl border border-gray-200 bg-white px-3 py-2 text-xs font-bold text-gray-700 transition-colors hover:border-orange-300 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-200"
          >
            <ArrowLeft className="h-3.5 w-3.5" />
            Back to Admin
          </button>
        </div>
      </div>

      {/* Read-only notice + stats */}
      <div className="mb-4 grid grid-cols-1 gap-3 sm:grid-cols-4">
        <div className="rounded-2xl border border-orange-200 bg-orange-50/70 px-4 py-3 dark:border-orange-900/40 dark:bg-orange-950/20 sm:col-span-1">
          <p className="flex items-center gap-1.5 text-[11px] font-black uppercase tracking-wider text-orange-700 dark:text-orange-300">
            <ShieldCheck className="h-3.5 w-3.5" />
            Read-only
          </p>
          <p className="mt-1 text-xs text-orange-800 dark:text-orange-200">No changes are made to any month.</p>
        </div>
        <StatCard icon={Users} label="People" value={String(persons.length)} />
        <StatCard icon={FileSearch} label="Records" value={String(rawRecordCount)} />
        <StatCard icon={Database} label="Months scanned" value={String(monthCount)} />
      </div>

      {selected ? (
        <ComparisonView person={selected} onBack={() => setSelectedId(null)} />
      ) : (
        <>
          {/* Controls */}
          <div className="mb-4 space-y-3">
            <div className="relative">
              <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400" />
              <input
                type="text"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Search by name, code, or phone..."
                className="w-full rounded-xl border border-gray-200 bg-white py-2.5 pl-9 pr-9 text-sm font-medium text-gray-900 outline-none focus:border-orange-500 dark:border-gray-700 dark:bg-gray-800 dark:text-white"
              />
              {query && (
                <button
                  type="button"
                  onClick={() => setQuery('')}
                  className="absolute right-2.5 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600"
                  aria-label="Clear search"
                >
                  <X className="h-4 w-4" />
                </button>
              )}
            </div>
            <div className="flex flex-wrap items-center gap-2">
              {FILTER_OPTIONS.map((option) => (
                <button
                  key={option.id}
                  type="button"
                  onClick={() => setFilter(option.id)}
                  className={`rounded-full px-3.5 py-1.5 text-xs font-bold transition-colors ${
                    filter === option.id
                      ? 'bg-orange-600 text-white shadow-sm'
                      : 'border border-gray-200 bg-white text-gray-600 hover:border-orange-300 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-300'
                  }`}
                >
                  {option.label}
                </button>
              ))}
              <div className="ml-auto flex items-center gap-1.5">
                <label className="text-xs font-semibold text-gray-500 dark:text-gray-400">Sort</label>
                <select
                  value={sortBy}
                  onChange={(e) => setSortBy(e.target.value)}
                  className="rounded-xl border border-gray-200 bg-white px-2.5 py-1.5 text-xs font-bold text-gray-800 outline-none focus:border-orange-500 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-200"
                >
                  {SORT_OPTIONS.map((option) => (
                    <option key={option.id} value={option.id}>{option.label}</option>
                  ))}
                </select>
                <button
                  type="button"
                  onClick={() => setSortDir((prev) => (prev === 'asc' ? 'desc' : 'asc'))}
                  className="rounded-xl border border-gray-200 bg-white px-2.5 py-1.5 text-xs font-bold text-gray-700 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-200"
                  title="Toggle sort direction"
                >
                  {sortDir === 'asc' ? '↑' : '↓'}
                </button>
              </div>
            </div>
          </div>

          {/* Status / content */}
          {status === 'loading' && (
            <div className="flex items-center justify-center gap-2 py-16 text-sm font-semibold text-orange-600 dark:text-orange-400">
              <Loader2 className="h-5 w-5 animate-spin" />
              Scanning {monthCount} months…
            </div>
          )}
          {status === 'error' && (
            <div className="rounded-2xl border border-red-200 bg-red-50 px-4 py-8 text-center text-sm font-semibold text-red-700 dark:border-red-900/50 dark:bg-red-950/30 dark:text-red-300">
              Member data could not be loaded. No data was changed.
            </div>
          )}
          {status === 'ready' && filteredPersons.length === 0 && (
            <div className="rounded-2xl border border-gray-200 bg-white px-4 py-16 text-center dark:border-gray-700 dark:bg-gray-800">
              <Users className="mx-auto mb-3 h-10 w-10 text-gray-300 dark:text-gray-600" />
              <p className="font-bold text-gray-700 dark:text-gray-300">No members match this view.</p>
              <p className="mt-1 text-sm text-gray-500 dark:text-gray-400">Try a different filter or search.</p>
            </div>
          )}
          {status === 'ready' && filteredPersons.length > 0 && (
            <>
              <p className="mb-2 text-xs font-semibold text-gray-500 dark:text-gray-400">
                {filteredPersons.length} {filteredPersons.length === 1 ? 'person' : 'people'}
              </p>
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
                {filteredPersons.map((person) => (
                  <PersonCard key={person.id} person={person} onClick={() => setSelectedId(person.id)} />
                ))}
              </div>
            </>
          )}
        </>
      )}
    </div>
  )
}

const StatCard = ({ icon: Icon, label, value }) => (
  <div className="rounded-2xl border border-gray-200 bg-white px-4 py-3 dark:border-gray-700 dark:bg-gray-800">
    <p className="flex items-center gap-1.5 text-[11px] font-black uppercase tracking-wider text-gray-400 dark:text-gray-500">
      <Icon className="h-3.5 w-3.5" />
      {label}
    </p>
    <p className="mt-1 text-2xl font-black text-gray-900 dark:text-white">{value}</p>
  </div>
)

export default MemberDataReview
