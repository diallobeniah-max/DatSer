import React, { useState, useEffect } from 'react'
import { useAuth } from '../context/AuthContext'
import { useApp } from '../context/AppContext'
import {
  X,
  ChevronRight,
  ChevronLeft,
  Check,
  Sparkles,
  Building2,
  Users,
  Calendar,
  Settings,
  ArrowRight,
  CheckCircle2,
  Circle
} from 'lucide-react'

const OnboardingWizard = ({ isOpen, onClose, onNavigate }) => {
  const { user, preferences, updatePreference } = useAuth()
  const { members, currentTable, addMember } = useApp()
  const [currentStep, setCurrentStep] = useState(0)
  const [workspaceName, setWorkspaceName] = useState(preferences?.workspace_name || '')
  const [isUpdating, setIsUpdating] = useState(false)

  // Quick Add Member State
  const [newMemberName, setNewMemberName] = useState('')
  const [newMemberGender, setNewMemberGender] = useState('male')

  const handleQuickAddMember = async () => {
    if (!newMemberName.trim()) return
    setIsUpdating(true)
    try {
      await addMember({
        full_name: newMemberName,
        gender: newMemberGender,
        current_level: 'Member', // Default
        phone_number: '0000000000',
        age: 18, // Default
        is_visitor: false
      })
      setNewMemberName('')
      setIsUpdating(false) // Show "Great!" screen
    } catch (e) {
      console.error(e)
      setIsUpdating(false)
    }
  }

  // Steps configuration
  const steps = [
    {
      id: 'welcome',
      title: 'Welcome to TMH Teen Ministry',
      description: 'Let\'s get you set up in just a few steps',
      icon: Sparkles,
      color: 'from-orange-500 to-purple-600'
    },
    {
      id: 'workspace',
      title: 'Name Your Workspace',
      description: 'Give your church or organization a name',
      icon: Building2,
      color: 'from-green-500 to-emerald-600'
    },
    {
      id: 'members',
      title: 'Add Your First Member',
      description: 'Start building your attendance list',
      icon: Users,
      color: 'from-orange-500 to-amber-600'
    },
    {
      id: 'attendance',
      title: 'Mark Attendance',
      description: 'Learn how to track attendance',
      icon: Calendar,
      color: 'from-pink-500 to-rose-600'
    },
    {
      id: 'complete',
      title: 'You\'re All Set!',
      description: 'Start managing your attendance',
      icon: CheckCircle2,
      color: 'from-emerald-500 to-green-600'
    }
  ]

  // Check if step is completed
  const isStepCompleted = (stepId) => {
    switch (stepId) {
      case 'welcome':
        return currentStep > 0
      case 'workspace':
        return !!preferences?.workspace_name
      case 'members':
        return members?.length > 0
      case 'attendance':
        return currentStep > 3
      case 'complete':
        return false
      default:
        return false
    }
  }

  const handleNext = async () => {
    // Step 1: Workspace name is REQUIRED
    if (currentStep === 1) {
      if (!workspaceName.trim() && !preferences?.workspace_name) {
        // Don't proceed without workspace name
        return
      }

      if (workspaceName.trim()) {
        // Save workspace name
        setIsUpdating(true)
        try {
          await updatePreference('workspace_name', workspaceName.trim())
        } catch (error) {
          console.error('Failed to save workspace name:', error)
          return // Don't proceed if save failed
        } finally {
          setIsUpdating(false)
        }
      }
    }

    if (currentStep < steps.length - 1) {
      setCurrentStep(currentStep + 1)
    }
  }

  const handlePrev = () => {
    if (currentStep > 0) {
      setCurrentStep(currentStep - 1)
    }
  }

  const handleAction = (action) => {
    onClose()
    if (action === 'addMember') {
      onNavigate?.('dashboard', { openModal: 'addMember' })
    } else if (action === 'dashboard') {
      onNavigate?.('dashboard')
    } else if (action === 'settings') {
      onNavigate?.('settings')
    }
  }

  const handleComplete = () => {
    // Mark onboarding as complete
    localStorage.setItem('onboardingComplete', 'true')
    onClose()
  }

  if (!isOpen) return null

  const CurrentIcon = steps[currentStep].icon

  return (
    <div className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center p-4 z-[60]">
      <div className="bg-white dark:bg-gray-800 rounded-2xl shadow-2xl w-full max-w-lg overflow-hidden animate-scale-in">
        {/* Progress bar */}
        <div className="h-1 bg-gray-200 dark:bg-gray-700">
          <div
            className="h-full bg-gradient-to-r from-orange-500 to-purple-600 transition-all duration-500"
            style={{ width: `${((currentStep + 1) / steps.length) * 100}%` }}
          />
        </div>

        {/* Step indicators */}
        <div className="flex justify-center gap-2 pt-4 px-6">
          {steps.map((step, index) => (
            <button
              key={step.id}
              onClick={() => index < currentStep && setCurrentStep(index)}
              className={`w-8 h-8 rounded-full flex items-center justify-center transition-all ${index === currentStep
                ? 'bg-orange-500 text-white scale-110'
                : index < currentStep
                  ? 'bg-green-500 text-white cursor-pointer hover:scale-105'
                  : 'bg-gray-200 dark:bg-gray-700 text-gray-400'
                }`}
            >
              {index < currentStep ? (
                <Check className="w-4 h-4" />
              ) : (
                <span className="text-xs font-bold">{index + 1}</span>
              )}
            </button>
          ))}
        </div>

        {/* Content */}
        <div className="p-6">
          {/* Header */}
          <div className={`bg-gradient-to-br ${steps[currentStep].color} rounded-2xl p-6 text-white text-center mb-6`}>
            <div className="w-16 h-16 bg-white/20 rounded-2xl flex items-center justify-center mx-auto mb-4">
              <CurrentIcon className="w-8 h-8" />
            </div>
            <h2 className="text-xl font-bold mb-1">{steps[currentStep].title}</h2>
            <p className="text-white/80 text-sm">{steps[currentStep].description}</p>
          </div>

          {/* Step Content */}
          <div className="min-h-[150px]">
            {currentStep === 0 && (
              <div className="text-center space-y-4">
                <p className="text-gray-600 dark:text-gray-300">
                  Hi <span className="font-semibold text-gray-900 dark:text-white">{user?.user_metadata?.full_name || 'there'}</span>! 👋
                </p>
                <p className="text-gray-600 dark:text-gray-300 text-sm">
                  This quick setup will help you get started with tracking attendance for your ministry.
                </p>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 pt-4 transition-all duration-500 ease-[cubic-bezier(0.4,0,0.2,1)] grid-animate">
                  <div className="bg-gray-50 dark:bg-gray-700 rounded-xl p-3 text-center">
                    <Users className="w-6 h-6 text-orange-500 mx-auto mb-1" />
                    <p className="text-xs text-gray-600 dark:text-gray-300">Manage Members</p>
                  </div>
                  <div className="bg-gray-50 dark:bg-gray-700 rounded-xl p-3 text-center">
                    <Calendar className="w-6 h-6 text-green-500 mx-auto mb-1" />
                    <p className="text-xs text-gray-600 dark:text-gray-300">Track Attendance</p>
                  </div>
                </div>
              </div>
            )}

            {currentStep === 1 && (
              <div className="space-y-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                    Workspace Name
                  </label>
                  <input
                    type="text"
                    value={workspaceName}
                    onChange={(e) => setWorkspaceName(e.target.value)}
                    placeholder="e.g., TMH Teen Ministry, Grace Chapel Youth"
                    className="w-full px-4 py-3 rounded-xl border border-gray-300 dark:border-gray-600 bg-gray-50 dark:bg-gray-700 text-gray-900 dark:text-white placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-orange-500"
                    autoFocus
                  />
                </div>
                <p className="text-xs text-gray-500 dark:text-gray-400">
                  This name will appear in your dashboard and reports. You can change it later in Settings.
                </p>
                {preferences?.workspace_name && (
                  <div className="flex items-center gap-2 text-sm text-green-600 dark:text-green-400">
                    <CheckCircle2 className="w-4 h-4" />
                    Workspace name saved!
                  </div>
                )}
              </div>
            )}

            {currentStep === 2 && (
              <div className="space-y-4">
                {members?.length > 0 && !isUpdating ? (
                  <div className="text-center space-y-3">
                    <div className="w-12 h-12 bg-green-100 dark:bg-green-900/30 rounded-full flex items-center justify-center mx-auto">
                      <CheckCircle2 className="w-6 h-6 text-green-600 dark:text-green-400" />
                    </div>
                    <p className="text-green-600 dark:text-green-400 font-medium">
                      Great! You have {members.length} member{members.length !== 1 ? 's' : ''}.
                    </p>
                    <button
                      onClick={() => setIsUpdating(true)}
                      className="text-sm text-orange-600 hover:text-orange-700 font-medium"
                    >
                      + Add Another
                    </button>
                  </div>
                ) : (
                  <div className="space-y-4">
                    <div className="flex flex-col space-y-3">
                      <label className="block text-sm font-medium text-gray-700 dark:text-gray-300">
                        Full Name
                      </label>
                      <input
                        type="text"
                        value={newMemberName}
                        onChange={(e) => setNewMemberName(e.target.value)}
                        placeholder="e.g. John Doe"
                        className="w-full px-4 py-2 rounded-xl border border-gray-300 dark:border-gray-600 bg-gray-50 dark:bg-gray-700 focus:ring-2 focus:ring-orange-500 outline-none transition-all"
                      />

                      <div className="flex gap-4">
                        <label className="flex items-center gap-2 cursor-pointer">
                          <input type="radio" name="gender" checked={newMemberGender === 'male'} onChange={() => setNewMemberGender('male')} className="text-orange-600" />
                          <span className="text-sm text-gray-700 dark:text-gray-300">Male</span>
                        </label>
                        <label className="flex items-center gap-2 cursor-pointer">
                          <input type="radio" name="gender" checked={newMemberGender === 'female'} onChange={() => setNewMemberGender('female')} className="text-pink-600" />
                          <span className="text-sm text-gray-700 dark:text-gray-300">Female</span>
                        </label>
                      </div>

                      <div className="flex gap-2 pt-2">
                        <button
                          onClick={handleQuickAddMember}
                          disabled={!newMemberName.trim()}
                          className="flex-1 bg-orange-600 hover:bg-orange-700 text-white py-2 rounded-xl transition-colors disabled:opacity-50 text-sm font-medium"
                        >
                          Add Member
                        </button>
                      </div>
                    </div>
                    <p className="text-xs text-center text-gray-400">
                      Optional • You can add more details later
                    </p>
                  </div>
                )}
              </div>
            )}

            {currentStep === 3 && (
              <div className="space-y-4">
                <div className="bg-gray-50 dark:bg-gray-700 rounded-xl p-4 space-y-3">
                  <div className="flex items-start gap-3">
                    <div className="w-6 h-6 bg-orange-500 text-white rounded-full flex items-center justify-center flex-shrink-0 text-xs font-bold">1</div>
                    <p className="text-sm text-gray-600 dark:text-gray-300">
                      Select a <span className="font-medium text-gray-900 dark:text-white">Sunday date</span> from the date picker
                    </p>
                  </div>
                  <div className="flex items-start gap-3">
                    <div className="w-6 h-6 bg-orange-500 text-white rounded-full flex items-center justify-center flex-shrink-0 text-xs font-bold">2</div>
                    <p className="text-sm text-gray-600 dark:text-gray-300">
                      Tap <span className="text-green-600 font-medium">Present</span> or <span className="text-red-600 font-medium">Absent</span> for each member
                    </p>
                  </div>
                  <div className="flex items-start gap-3">
                    <div className="w-6 h-6 bg-orange-500 text-white rounded-full flex items-center justify-center flex-shrink-0 text-xs font-bold">3</div>
                    <p className="text-sm text-gray-600 dark:text-gray-300">
                      Long-press members to <span className="font-medium text-gray-900 dark:text-white">bulk select</span> multiple at once
                    </p>
                  </div>
                </div>
                <p className="text-xs text-gray-500 dark:text-gray-400 text-center">
                  Attendance is saved automatically - no need to hit save!
                </p>
              </div>
            )}

            {currentStep === 4 && (
              <div className="text-center space-y-4">
                <div className="w-16 h-16 bg-green-100 dark:bg-green-900/30 rounded-full flex items-center justify-center mx-auto">
                  <CheckCircle2 className="w-8 h-8 text-green-600 dark:text-green-400" />
                </div>
                <p className="text-gray-600 dark:text-gray-300">
                  You're ready to start managing attendance!
                </p>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 pt-2 transition-all duration-500 ease-[cubic-bezier(0.4,0,0.2,1)] grid-animate">
                  <button
                    onClick={() => handleAction('dashboard')}
                    className="flex items-center justify-center gap-2 px-4 py-3 bg-orange-500 text-white font-medium rounded-xl hover:bg-orange-600 transition-colors"
                  >
                    <Calendar className="w-4 h-4" />
                    Dashboard
                  </button>
                  <button
                    onClick={() => handleAction('settings')}
                    className="flex items-center justify-center gap-2 px-4 py-3 bg-gray-100 dark:bg-gray-700 text-gray-700 dark:text-gray-300 font-medium rounded-xl hover:bg-gray-200 dark:hover:bg-gray-600 transition-colors"
                  >
                    <Settings className="w-4 h-4" />
                    Settings
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>

        {/* Footer */}
        <div className="p-6 pt-0 flex items-center justify-between">
          {currentStep > 0 && currentStep < steps.length - 1 ? (
            <button
              onClick={handlePrev}
              className="flex items-center gap-1 px-4 py-2 text-gray-600 dark:text-gray-300 hover:text-gray-900 dark:hover:text-white transition-colors"
            >
              <ChevronLeft className="w-4 h-4" />
              Back
            </button>
          ) : (
            <div />
          )}

          {currentStep < steps.length - 1 ? (
            <button
              onClick={handleNext}
              disabled={currentStep === 1 && !workspaceName.trim() && !preferences?.workspace_name}
              className="flex items-center gap-2 px-6 py-2.5 bg-gradient-to-r from-orange-500 to-purple-600 text-white font-semibold rounded-xl hover:from-orange-600 hover:to-purple-700 transition-all disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {isUpdating ? (
                <>
                  <div className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                  Saving...
                </>
              ) : (
                <>
                  {currentStep === 0 ? "Let's Start" : currentStep === 1 ? 'Save & Continue' : 'Next'}
                  <ChevronRight className="w-4 h-4" />
                </>
              )}
            </button>
          ) : (
            <button
              onClick={handleComplete}
              className="flex items-center gap-2 px-6 py-2.5 bg-gradient-to-r from-green-500 to-emerald-600 text-white font-semibold rounded-xl hover:from-green-600 hover:to-emerald-700 transition-all"
            >
              <Check className="w-4 h-4" />
              Complete Setup
            </button>
          )}
        </div>

        {/* Skip button */}
        {currentStep < steps.length - 1 && (
          <div className="text-center pb-4">
            <button
              onClick={handleComplete}
              className="text-xs text-gray-400 hover:text-gray-600 dark:hover:text-gray-300 transition-colors"
            >
              Skip setup for now
            </button>
          </div>
        )}
      </div>
    </div>
  )
}

export default OnboardingWizard
