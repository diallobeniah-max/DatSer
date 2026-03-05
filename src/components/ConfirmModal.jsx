import React from 'react'
import { X, AlertTriangle } from 'lucide-react'
import useHapticFeedback from '../hooks/useHapticFeedback'

const ConfirmModal = ({
  isOpen,
  onClose,
  onConfirm,
  title = "Confirm Action",
  message = "Are you sure you want to proceed?",
  confirmText = "Confirm",
  cancelText = "Cancel",
  confirmButtonClass = "bg-red-600 hover:bg-red-700 text-white",
  cancelButtonClass = "bg-gray-100 dark:bg-gray-700 text-gray-700 dark:text-gray-300 hover:bg-gray-200 dark:hover:bg-gray-600",
  children
}) => {
  const { selection, success } = useHapticFeedback()

  if (!isOpen) return null

  return (
    <div className="fixed inset-0 bg-black bg-opacity-60 flex items-center justify-center p-4 z-[60] backdrop-animate">
      <div className="bg-white dark:bg-gray-800 rounded-xl w-full max-w-md mx-4 overflow-hidden shadow-2xl border border-gray-200 dark:border-gray-700 animate-scale-in">
        {/* Header */}
        <div className="px-6 py-4 bg-yellow-50 dark:bg-yellow-900/20 border-b border-yellow-200 dark:border-yellow-800 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-full bg-yellow-100 dark:bg-yellow-900 flex items-center justify-center">
              <AlertTriangle className="w-5 h-5 text-yellow-600 dark:text-yellow-400" />
            </div>
            <h3 className="text-lg font-semibold text-gray-900 dark:text-white">{title}</h3>
          </div>
          <button
            onClick={() => { selection(); onClose() }}
            className="p-2 hover:bg-gray-100 dark:hover:bg-gray-700 rounded-lg transition-colors btn-press"
          >
            <X className="w-5 h-5 text-gray-600 dark:text-gray-400" />
          </button>
        </div>

        {/* Message or Custom Content */}
        <div className="px-6 py-6 text-center">
          <div className="mb-4">
            <div className="w-16 h-16 rounded-full bg-red-100 dark:bg-red-900/30 flex items-center justify-center mx-auto mb-4">
              <svg className="w-8 h-8 text-red-600 dark:text-red-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
              </svg>
            </div>
            {children ? (
              <div className="text-left w-full">
                {children}
              </div>
            ) : (
              <p className="text-gray-700 dark:text-gray-300 text-base leading-relaxed">
                {message}
              </p>
            )}
          </div>
        </div>

        {/* Action Buttons */}
        <div className="px-6 py-4 bg-gray-50 dark:bg-gray-700/50 border-t border-gray-200 dark:border-gray-600 flex gap-3">
          <button
            onClick={() => { selection(); onClose() }}
            className={`flex-1 px-4 py-3 border border-gray-300 dark:border-gray-600 rounded-lg font-medium transition-colors focus:outline-none focus:ring-2 focus:ring-gray-500 btn-press ${cancelButtonClass}`}
          >
            {cancelText}
          </button>
          <button
            onClick={() => {
              selection()
              onConfirm()
              onClose()
            }}
            className={`flex-1 px-4 py-3 rounded-lg font-medium transition-colors focus:outline-none focus:ring-2 focus:ring-red-500 shadow-lg hover:shadow-xl btn-press ${confirmButtonClass}`}
          >
            {confirmText}
          </button>
        </div>
      </div>
    </div>
  )
}

export default ConfirmModal