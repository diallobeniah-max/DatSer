import React from 'react'
import { Users } from 'lucide-react'

const GuardianSectionHeader = ({ invalid = false, complete = false }) => (
  <div className={`border-b p-3 ${invalid
    ? 'border-red-200 bg-red-50 dark:border-red-800 dark:bg-red-900/20'
    : 'border-gray-200 bg-gray-50 dark:border-gray-600 dark:bg-gray-700'}`}>
    <div className="flex items-start gap-2.5">
      <Users className={`mt-0.5 h-4 w-4 flex-none ${invalid ? 'text-red-500' : 'text-orange-500'}`} />
      <div className="min-w-0">
        <div className="flex flex-wrap items-center gap-2">
          <h3 className={`text-sm font-bold ${invalid ? 'text-red-700 dark:text-red-300' : 'text-gray-800 dark:text-gray-100'}`}>Parent/Guardian Info</h3>
          {invalid && <span className="rounded-md bg-red-100 px-1.5 py-0.5 text-[10px] font-black uppercase tracking-wide text-red-700 dark:bg-red-900 dark:text-red-200">Required</span>}
          {complete && !invalid && <span className="rounded-md bg-green-100 px-1.5 py-0.5 text-[10px] font-black uppercase tracking-wide text-green-700 dark:bg-green-900 dark:text-green-200">Saved</span>}
        </div>
        <p className="mt-0.5 text-xs leading-5 text-gray-500 dark:text-gray-300">Add one required guardian. A second guardian is optional.</p>
      </div>
    </div>
  </div>
)

export default GuardianSectionHeader
