import React from 'react'
import { HelpCircle, X, Check } from 'lucide-react'

const TutorialPromptBar = ({ isOpen, onAccept, onDismiss }) => {
    if (!isOpen) return null

    return (
        <div className="fixed bottom-4 left-4 right-4 md:left-auto md:right-4 md:w-96 z-[100] animate-slide-up">
            <div className="bg-gradient-to-r from-orange-600 to-purple-600 text-white rounded-xl shadow-lg p-4 flex items-center gap-4">
                <div className="p-2 bg-white/20 rounded-lg flex-shrink-0">
                    <HelpCircle className="w-5 h-5" />
                </div>
                
                <div className="flex-1 min-w-0">
                    <p className="font-semibold text-sm">Want a quick tutorial?</p>
                    <p className="text-xs text-white/80">Learn how to use Datsar with our getting started guide</p>
                </div>

                <div className="flex items-center gap-2 flex-shrink-0">
                    <button
                        onClick={onAccept}
                        className="p-2 hover:bg-white/20 rounded-lg transition-colors"
                        title="Show tutorial"
                    >
                        <Check className="w-4 h-4" />
                    </button>
                    <button
                        onClick={onDismiss}
                        className="p-2 hover:bg-white/20 rounded-lg transition-colors"
                        title="Dismiss"
                    >
                        <X className="w-4 h-4" />
                    </button>
                </div>
            </div>
        </div>
    )
}

export default TutorialPromptBar
