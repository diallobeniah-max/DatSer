import React, { useState, useEffect, lazy, Suspense, memo } from 'react'
import { ToastContainer, Slide, toast } from 'react-toastify'
import 'react-toastify/dist/ReactToastify.css'

// Core components - loaded immediately
import Header from './components/Header'
import Dashboard from './components/Dashboard'
import ErrorBoundary from './components/ErrorBoundary'
import LoginPage from './components/LoginPage'
import TutorialPromptBar from './components/TutorialPromptBar'
import AppUpdatePrompt from './components/AppUpdatePrompt'
import OfflineStatusBanner from './components/OfflineStatusBanner'
import useHapticFeedback from './hooks/useHapticFeedback'
import { Check, Minimize2, X } from 'lucide-react'

// Lazy-loaded components - loaded on demand for faster initial load
const MemberModal = lazy(() => import('./components/MemberModal'))
const EditMemberModal = lazy(() => import('./components/EditMemberModal'))
const MissingDataModal = lazy(() => import('./components/MissingDataModal'))
const AttendanceAnalytics = lazy(() => import('./components/AttendanceAnalytics'))
const AdminPanel = lazy(() => import('./components/AdminPanel'))
const WorkspaceSettingsModal = lazy(() => import('./components/WorkspaceSettingsModal'))
const DeleteAccountModal = lazy(() => import('./components/DeleteAccountModal'))
const ExportDataModal = lazy(() => import('./components/ExportDataModal'))
const SettingsPage = lazy(() => import('./components/SettingsPage'))
const OnboardingWizard = lazy(() => import('./components/OnboardingWizard'))
const AIChatAssistant = lazy(() => import('./components/AIChatAssistant'))
const CommandPalette = lazy(() => import('./components/CommandPalette'))
const ExecAttendancePage = lazy(() => import('./components/ExecAttendancePage'))
const SetPasswordModal = lazy(() => import('./components/SetPasswordModal'))
const ResetPasswordModal = lazy(() => import('./components/ResetPasswordModal'))
const MonthModal = lazy(() => import('./components/MonthModal'))

// Minimal loading fallback for lazy components
const LazyFallback = memo(() => (
  <div className="flex items-center justify-center p-4">
    <div className="w-6 h-6 border-2 border-primary-500 border-t-transparent rounded-full animate-spin" />
  </div>
))
LazyFallback.displayName = 'LazyFallback'

// Context
import { AppProvider, useApp } from './context/AppContext'
import { ThemeProvider } from './context/ThemeContext'
import { AuthProvider, useAuth } from './context/AuthContext'

// Main app content - only shown when authenticated
const CustomCloseButton = ({ closeToast }) => {
  const [showCloseAll, setShowCloseAll] = React.useState(false);
  const timerRef = React.useRef(null);
  const closeTimerRef = React.useRef(null);
  const isClosingRef = React.useRef(false);

  React.useEffect(() => () => {
    if (timerRef.current) clearTimeout(timerRef.current);
    if (closeTimerRef.current) clearTimeout(closeTimerRef.current);
  }, []);

  const playCloseAnimation = (event, dismiss) => {
    event?.stopPropagation?.();
    event?.preventDefault?.();

    if (isClosingRef.current) return;
    isClosingRef.current = true;

    const toastElement = event?.currentTarget?.closest?.('.Toastify__toast');
    toastElement?.classList?.add('datser-toast-manual-closing');

    closeTimerRef.current = setTimeout(() => {
      dismiss?.(event);
    }, 280);
  };

  const handleStart = (e) => {
    if (e.type === 'mousedown' && e.button !== 0) return;
    e.stopPropagation();
    timerRef.current = setTimeout(() => {
      setShowCloseAll(true);
    }, 600);
  };

  const handleEnd = (e) => {
    if (timerRef.current) clearTimeout(timerRef.current);
    if (!showCloseAll) {
      playCloseAnimation(e, closeToast);
    }
  };

  const handleCloseAll = (e) => {
    const toasts = document.querySelectorAll('.datser-toast-stack .Toastify__toast');
    toasts.forEach((toastElement) => toastElement.classList.add('datser-toast-manual-closing'));
    playCloseAnimation(e, () => toast.dismiss());
  };

  const handleCancelCloseAll = (e) => {
    e.stopPropagation();
    setShowCloseAll(false);
  };

  if (showCloseAll) {
    return (
      <button
        type="button"
        className="datser-toast-close-all"
        onClick={handleCloseAll}
        onMouseLeave={handleCancelCloseAll}
        aria-label="Close all notifications"
        style={{
          background: '#dc2626',
          color: '#fff',
          border: 'none',
          borderRadius: '8px',
          padding: '4px 10px',
          fontSize: '12px',
          fontWeight: '600',
          cursor: 'pointer',
          whiteSpace: 'nowrap',
          display: 'flex',
          alignItems: 'center',
          gap: '4px',
          animation: 'fadeInToast 0.15s ease-out',
        }}
      >
        Close All
      </button>
    );
  }

  return (
    <button
      type="button"
      className="datser-toast-close"
      aria-label="Close notification"
      onMouseDown={handleStart}
      onMouseUp={handleEnd}
      onMouseLeave={() => { if (timerRef.current) clearTimeout(timerRef.current); }}
      onTouchStart={handleStart}
      onTouchEnd={handleEnd}
      onTouchCancel={() => { if (timerRef.current) clearTimeout(timerRef.current); }}
    >
      <X aria-hidden="true" size={18} strokeWidth={2.4} />
    </button>
  );
}


function AppContent({ isMobile }) {

  const { preferences, signOut, updatePreference } = useAuth()
  const { selection } = useHapticFeedback()
  const {
    members,
    loading: appLoading,
    hasAccess,
    isCollaborator,
    adminSyncNotice,
    acknowledgeAdminSync,
    validateMemberData,
    getPastSundays,
    getMissingAttendance,
    selectedAttendanceDate
  } = useApp()
  const [currentView, setCurrentView] = useState('dashboard')
  const [isAdmin, setIsAdmin] = useState(() => {
    return localStorage.getItem('tmht_admin_session') === 'true'
  })
  const [showMemberModal, setShowMemberModal] = useState(false)
  const [showDeveloperEditModal, setShowDeveloperEditModal] = useState(false)
  const [developerEditMember, setDeveloperEditMember] = useState(null)
  const [showDeveloperMissingDataModal, setShowDeveloperMissingDataModal] = useState(false)
  const [developerMissingDataMember, setDeveloperMissingDataMember] = useState(null)
  const [developerMissingFields, setDeveloperMissingFields] = useState([])
  const [developerMissingDates, setDeveloperMissingDates] = useState([])
  const [developerPendingAttendanceAction, setDeveloperPendingAttendanceAction] = useState(null)
  const recentDeveloperMissingDataCloseRef = React.useRef({ memberId: null, present: null, at: 0 })
  const [showMonthModal, setShowMonthModal] = useState(false)
  const [showAIChat, setShowAIChat] = useState(false)
  const [navigateToSettingsSection, setNavigateToSettingsSection] = useState(null)

  // Onboarding wizard for new users
  const [showOnboarding, setShowOnboarding] = useState(false)
  const [onboardingAutoChecked, setOnboardingAutoChecked] = useState(false)

  // Global modals - accessible from profile dropdown anywhere
  const [showWorkspaceSettings, setShowWorkspaceSettings] = useState(false)
  const [showDeleteAccount, setShowDeleteAccount] = useState(false)
  const [showExportData, setShowExportData] = useState(false)

  // Password setup prompt for collaborators who logged in via magic link/invite
  const [showSetPassword, setShowSetPassword] = useState(false)
  const [needsPasswordSetup, setNeedsPasswordSetup] = useState(false)
  
  // Tutorial prompt bar instead of auto-popup
  const [showTutorialPrompt, setShowTutorialPrompt] = useState(false)
  const [showCompactSuggestion, setShowCompactSuggestion] = useState(false)

  // Handle navigation from onboarding wizard
  const handleOnboardingNavigate = (view, options) => {
    setCurrentView(view)
    if (options?.openModal === 'addMember') {
      setTimeout(() => setShowMemberModal(true), 100)
    }
  }

  const isExecutive = preferences?.role === 'executive' || preferences?.is_executive === true
  const backgroundAnimationEnabled = preferences?.background_animation_enabled !== false
  const motionAndSoundsEnabled = preferences?.motion_and_sounds_enabled !== false
  const compactUiEnabled = preferences?.compact_ui_enabled === true
  const smartCompactPromptEnabled = preferences?.smart_compact_prompt_enabled !== false
  const hapticFeedbackEnabled = preferences?.haptic_feedback_enabled !== false
  const hapticFeedbackStrength = preferences?.haptic_feedback_strength || 1
  const adminTargetLabel = adminSyncNotice?.targetDate
    ? new Date(adminSyncNotice.targetDate).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
    : (adminSyncNotice?.targetTable ? adminSyncNotice.targetTable.replace('_', ' ') : null)

  const clearDeveloperMissingDataState = () => {
    recentDeveloperMissingDataCloseRef.current = {
      memberId: developerPendingAttendanceAction?.memberId ?? developerMissingDataMember?.id ?? null,
      present: developerPendingAttendanceAction?.present ?? null,
      at: Date.now()
    }
    setShowDeveloperMissingDataModal(false)
    setDeveloperMissingDataMember(null)
    setDeveloperMissingFields([])
    setDeveloperMissingDates([])
    setDeveloperPendingAttendanceAction(null)
  }

  // Tap outside to collapse, long press to expand
  useEffect(() => {
    let longPressTimer;

    const handleTouchStart = (e) => {
      const stack = e.target.closest('.datser-toast-stack');
      if (stack) {
        if (!stack.classList.contains('toast-stack-expanded')) {
          longPressTimer = setTimeout(() => {
            stack.classList.add('toast-stack-expanded');
          }, 800);
        }
      } else {
        document.querySelector('.datser-toast-stack')?.classList.remove('toast-stack-expanded');
      }
    };

    const clearTimer = () => {
      clearTimeout(longPressTimer);
    };

    document.addEventListener('touchstart', handleTouchStart, { passive: true });
    document.addEventListener('touchmove', clearTimer, { passive: true });
    document.addEventListener('touchend', clearTimer, { passive: true });
    document.addEventListener('touchcancel', clearTimer, { passive: true });
    document.addEventListener('scroll', clearTimer, { passive: true });

    return () => {
      document.removeEventListener('touchstart', handleTouchStart);
      document.removeEventListener('touchmove', clearTimer);
      document.removeEventListener('touchend', clearTimer);
      document.removeEventListener('touchcancel', clearTimer);
      document.removeEventListener('scroll', clearTimer);
    };
  }, []);

  useEffect(() => {
    if (typeof document === 'undefined') return
    const root = document.documentElement
    const body = document.body
    const classTargets = [root, body]
    classTargets.forEach((target) => {
      target.classList.toggle('background-static', !backgroundAnimationEnabled)
      target.classList.toggle('animations-disabled', !motionAndSoundsEnabled)
      target.classList.toggle('compact-ui', compactUiEnabled)
    })
    try {
      window.localStorage.setItem('datser_motion_and_sounds_enabled', String(motionAndSoundsEnabled))
      window.localStorage.setItem('datser_haptic_feedback_enabled', String(hapticFeedbackEnabled))
      window.localStorage.setItem('datser_haptic_feedback_strength', String(hapticFeedbackStrength))
    } catch { }
    return () => {
      classTargets.forEach((target) => {
        target.classList.remove('background-static')
        target.classList.remove('animations-disabled')
        target.classList.remove('compact-ui')
      })
    }
  }, [backgroundAnimationEnabled, compactUiEnabled, hapticFeedbackEnabled, hapticFeedbackStrength, motionAndSoundsEnabled])

  useEffect(() => {
    if (!smartCompactPromptEnabled || compactUiEnabled || typeof window === 'undefined') return
    if (window.localStorage.getItem('datser_compact_suggestion_dismissed') === 'true') return

    const checkCrowdedScreen = () => {
      const rootFontSize = parseFloat(window.getComputedStyle(document.documentElement).fontSize || '16')
      const width = window.innerWidth || 0
      const height = window.innerHeight || 0
      const visualScale = window.visualViewport?.scale || 1
      const crowded = width <= 390 || height <= 680 || rootFontSize >= 18 || visualScale > 1.08
      if (crowded) window.setTimeout(() => setShowCompactSuggestion(true), 900)
    }

    checkCrowdedScreen()
    window.addEventListener('resize', checkCrowdedScreen)
    return () => window.removeEventListener('resize', checkCrowdedScreen)
  }, [compactUiEnabled, smartCompactPromptEnabled])

  const handleGlobalInteractionFeedback = React.useCallback((event) => {
    if (event.defaultPrevented) return
    const target = event.target instanceof Element
      ? event.target.closest('button, a, [role="button"], summary, input[type="checkbox"], input[type="radio"], input[type="range"], select')
      : null
    if (!target || target.matches(':disabled,[aria-disabled="true"]')) return
    selection()
  }, [selection])

  // Expose modal openers globally via window for profile dropdown
  useEffect(() => {
    window.openDashboard = () => setCurrentView('dashboard')
    window.openAddMember = () => setShowMemberModal(true)
    window.openDeveloperEditMember = (memberIdentifier) => {
      const resolvedMember = members.find((member) =>
        member?.id === memberIdentifier ||
        member?.full_name === memberIdentifier ||
        member?.['Full Name'] === memberIdentifier
      )

      if (!resolvedMember) {
        return false
      }

      setDeveloperEditMember(resolvedMember)
      setShowDeveloperEditModal(true)
      return true
    }
    window.openDeveloperMissingDataFlow = (memberIdentifier, present = true) => {
      const resolvedMember = members.find((member) =>
        member?.id === memberIdentifier ||
        member?.full_name === memberIdentifier ||
        member?.['Full Name'] === memberIdentifier
      )

      if (!resolvedMember) {
        return false
      }

      const recentClose = recentDeveloperMissingDataCloseRef.current
      if (
        recentClose.memberId === resolvedMember.id &&
        recentClose.present === present &&
        Date.now() - recentClose.at < 5000
      ) {
        return true
      }

      const fields = validateMemberData(resolvedMember)
      const dates = getMissingAttendance(resolvedMember.id, getPastSundays())

      if (fields.length === 0 && dates.length === 0) {
        return false
      }

      const openModal = () => {
        setDeveloperMissingDataMember(resolvedMember)
        setDeveloperMissingFields(fields)
        setDeveloperMissingDates(dates)
        setDeveloperPendingAttendanceAction({ memberId: resolvedMember.id, present })
        setShowDeveloperMissingDataModal(true)
      }

      if (showDeveloperMissingDataModal) {
        clearDeveloperMissingDataState()
        setTimeout(openModal, 50)
      } else {
        openModal()
      }

      return true
    }
    window.openCreateMonth = () => setShowMonthModal(true)
    window.openWorkspaceSettings = () => setShowWorkspaceSettings(true)
    window.openDeleteAccount = () => setShowDeleteAccount(true)
    window.openExportData = () => setShowExportData(true)
    window.openSettings = () => setCurrentView('settings')
    window.openExecutive = () => setCurrentView('exec')
    window.openOnboarding = () => setShowOnboarding(true)

    const openApkUpdateSettings = () => {
      setCurrentView('settings')
      setNavigateToSettingsSection({ section: 'updates', settingId: 'android_apk' })
    }
    window.addEventListener('datser-open-apk-update-settings', openApkUpdateSettings)

    return () => {
      delete window.openDashboard
      delete window.openAddMember
      delete window.openDeveloperEditMember
      delete window.openDeveloperMissingDataFlow
      delete window.openCreateMonth
      delete window.openWorkspaceSettings
      delete window.openDeleteAccount
      delete window.openExportData
      delete window.openSettings
      delete window.openExecutive
      delete window.openOnboarding
      window.removeEventListener('datser-open-apk-update-settings', openApkUpdateSettings)
    }
  }, [members, validateMemberData, getMissingAttendance, getPastSundays, showDeveloperMissingDataModal])

  // Guard executive view if role revoked or non-exec
  useEffect(() => {
    if (currentView === 'exec' && !isExecutive) {
      setCurrentView('dashboard')
    }
  }, [currentView, isExecutive])

  // Auto-show tutorial prompt for new users (optional onboarding)
  useEffect(() => {
    if (appLoading || onboardingAutoChecked) return
    const onboardingComplete = localStorage.getItem('onboardingComplete')
    const tutorialDismissed = localStorage.getItem('tutorialPrompt_dismissed')
    const hasWorkspace = !!preferences?.workspace_name
    const hasMembers = (members?.length || 0) > 0
    
    // Show tutorial prompt bar for new users who haven't dismissed it
    // The full onboarding wizard only opens when user taps Yes on the prompt bar
    if (!tutorialDismissed && !onboardingComplete && (!hasWorkspace || !hasMembers)) {
      setTimeout(() => setShowTutorialPrompt(true), 1000)
    }
    
    setOnboardingAutoChecked(true)
  }, [appLoading, onboardingAutoChecked, members, preferences])

  // Check if collaborator needs to set up a password (logged in via magic link/invite)
  useEffect(() => {
    if (appLoading || !isCollaborator) return
    const passwordComplete = localStorage.getItem('passwordSetup_complete')
    const dismissed = sessionStorage.getItem('passwordSetup_dismissed')
    
    if (passwordComplete || dismissed) {
      setNeedsPasswordSetup(false)
      setShowSetPassword(false)
    } else {
      setNeedsPasswordSetup(true)
      setShowSetPassword(false)
    }
  }, [appLoading, isCollaborator])

  // Expose password setup state globally for Settings badge
  useEffect(() => {
    window.__needsPasswordSetup = needsPasswordSetup
    window.__openSetPassword = () => setShowSetPassword(true)
    return () => {
      delete window.__needsPasswordSetup
      delete window.__openSetPassword
    }
  }, [needsPasswordSetup])

  // Access control: block users who are not the owner and not in collaborators table
  if (!appLoading && !hasAccess) {
    return (
      <div className="min-h-screen bg-gray-50 dark:bg-gray-900 flex items-center justify-center p-4">
        <div className="max-w-md w-full text-center">
          <div className="mb-6">
            <div className="w-16 h-16 bg-red-100 dark:bg-red-900 rounded-full flex items-center justify-center mx-auto mb-4">
              <svg className="w-8 h-8 text-red-600 dark:text-red-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4v2m0 4v2M6.343 3.665c-.256-.565.198-1.165.76-1.165h10.794c.562 0 1.016.6.76 1.165l-5.397 11.95c-.256.565-1.264.565-1.52 0L6.343 3.665z" />
              </svg>
            </div>
            <h1 className="text-2xl font-bold text-gray-900 dark:text-white mb-2">Access Denied</h1>
            <p className="text-gray-600 dark:text-gray-400 mb-6">
              You don't have permission to access this application. Only the workspace owner and invited collaborators can access this system.
            </p>
            <p className="text-sm text-gray-500 dark:text-gray-500 mb-6">
              If you believe this is an error, please ask the workspace owner to invite you as a collaborator.
            </p>
          </div>
          <button
            onClick={() => signOut()}
            className="w-full px-4 py-2 bg-primary-600 hover:bg-primary-700 text-white rounded-lg font-medium transition-colors"
          >
            Sign Out
          </button>
        </div>
      </div>
    )
  }

  return (
    <div
      onClick={handleGlobalInteractionFeedback}
      className={`min-app-vh app-shell ios-overscroll-none ${backgroundAnimationEnabled ? 'transition-colors duration-200' : 'background-static'} ${motionAndSoundsEnabled ? '' : 'animations-disabled'} ${compactUiEnabled ? 'compact-ui' : ''}`}
    >
      {showCompactSuggestion && (
        <div className="fixed left-3 right-3 top-[calc(env(safe-area-inset-top,0px)+72px)] z-[1000000] mx-auto max-w-sm rounded-2xl border border-orange-300/70 bg-white/95 p-3 shadow-2xl shadow-black/20 backdrop-blur-xl dark:border-orange-400/25 dark:bg-[#202121]/95">
          <div className="flex items-start gap-3">
            <div className="grid h-9 w-9 shrink-0 place-items-center rounded-xl bg-orange-100 text-orange-600 dark:bg-orange-500/15 dark:text-orange-300">
              <Minimize2 className="h-5 w-5" />
            </div>
            <div className="min-w-0 flex-1">
              <p className="text-sm font-bold text-gray-900 dark:text-white">Enable Compact UI?</p>
              <p className="mt-0.5 text-xs text-gray-500 dark:text-gray-400">Your screen looks tight. Compact UI fits more with less spacing.</p>
            </div>
            <button
              type="button"
              onClick={async () => {
                await updatePreference?.('compact_ui_enabled', true)
                setShowCompactSuggestion(false)
              }}
              className="grid h-8 w-8 shrink-0 place-items-center rounded-full bg-orange-600 text-white"
              aria-label="Enable compact UI"
            >
              <Check className="h-4 w-4" />
            </button>
            <button
              type="button"
              onClick={() => {
                window.localStorage.setItem('datser_compact_suggestion_dismissed', 'true')
                setShowCompactSuggestion(false)
              }}
              className="grid h-8 w-8 shrink-0 place-items-center rounded-full bg-gray-100 text-gray-600 dark:bg-white/10 dark:text-gray-200"
              aria-label="Dismiss compact UI suggestion"
            >
              <X className="h-4 w-4" />
            </button>
          </div>
        </div>
      )}
      <Header
        currentView={currentView}
        setCurrentView={setCurrentView}
        isAdmin={isAdmin}
        setIsAdmin={setIsAdmin}
        onAddMember={() => setShowMemberModal(true)}
        onCreateMonth={() => setShowMonthModal(true)}
        onToggleAIChat={() => setShowAIChat(prev => !prev)}
      />
      {isCollaborator && adminSyncNotice && (
        <div className="fixed inset-0 z-[70] bg-black/60 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-white dark:bg-gray-900 rounded-3xl w-full max-w-md shadow-2xl border border-gray-200 dark:border-gray-700 overflow-hidden">
            <div className="px-6 pt-6 pb-4 bg-gradient-to-r from-orange-600 to-orange-800 text-white">
              <div className="flex items-center gap-3">
                <div className="w-11 h-11 rounded-full bg-white/15 flex items-center justify-center text-xl font-semibold">!</div>
                <div>
                  <div className="text-lg font-semibold">Working period updated</div>
                  <div className="text-xs text-white/80">Admin requires refresh to continue</div>
                </div>
              </div>
            </div>
            <div className="px-6 py-5">
              <div className="text-sm text-gray-700 dark:text-gray-200">
                Admin has changed the working period. Your view must refresh to load the latest data.
              </div>
              {adminTargetLabel && (
                <div className="mt-3 text-sm font-semibold text-gray-900 dark:text-white">
                  New period: <span className="text-orange-700 dark:text-orange-300">{adminTargetLabel}</span>
                </div>
              )}
              <div className="mt-5">
                <button
                  onClick={acknowledgeAdminSync}
                  className="w-full px-4 py-2.5 bg-orange-600 hover:bg-orange-700 text-white rounded-xl font-semibold transition-colors"
                >
                  Refresh
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      <main className={`app-main-safe ${currentView === 'dashboard' ? 'app-main-dashboard-safe' : ''} ${currentView === 'settings' ? 'app-main-settings-safe' : ''} ${currentView === 'admin' ? 'app-main-admin-safe' : ''} mx-auto px-0 sm:px-4 pt-0 pb-6 md:py-6 w-full`}>
        <OfflineStatusBanner
          onOpenOfflineSettings={() => {
            setCurrentView('settings')
            setNavigateToSettingsSection({ section: 'data', settingId: 'offline_mode' })
          }}
        />
        {currentView === 'dashboard' && (
          <Dashboard isAdmin={isAdmin} />
        )}

        {currentView === 'analytics' && (
          <Suspense fallback={<LazyFallback />}>
            <AttendanceAnalytics />
          </Suspense>
        )}

        {currentView === 'admin' && (
          <Suspense fallback={<LazyFallback />}>
            <AdminPanel
              setCurrentView={setCurrentView}
              onLogout={() => {
                localStorage.removeItem('tmht_admin_session')
                setIsAdmin(false)
                setCurrentView('dashboard')
              }}
            />
          </Suspense>
        )}

        {currentView === 'settings' && (
          <Suspense fallback={<LazyFallback />}>
            <SettingsPage
              onBack={() => {
                setCurrentView('dashboard')
                setNavigateToSettingsSection(null)
              }}
              navigateToSection={navigateToSettingsSection}
              onOpenAddMember={() => setShowMemberModal(true)}
              onCreateMonth={() => setShowMonthModal(true)}
            />
          </Suspense>
        )}

        {currentView === 'exec' && (
          <Suspense fallback={<LazyFallback />}>
            <ExecAttendancePage onBack={() => setCurrentView('dashboard')} />
          </Suspense>
        )}

      </main>

      {/* Lazy-loaded modals - only render when open */}
      {showMemberModal && (
        <Suspense fallback={<LazyFallback />}>
          <MemberModal
            isOpen={showMemberModal}
            onClose={() => setShowMemberModal(false)}
          />
        </Suspense>
      )}

      {showDeveloperEditModal && developerEditMember && (
        <Suspense fallback={<LazyFallback />}>
          <EditMemberModal
            isOpen={showDeveloperEditModal}
            member={developerEditMember}
            onClose={() => {
              setShowDeveloperEditModal(false)
              setDeveloperEditMember(null)
            }}
          />
        </Suspense>
      )}

      {showDeveloperMissingDataModal && developerMissingDataMember && (
        <Suspense fallback={<LazyFallback />}>
          <MissingDataModal
            member={developerMissingDataMember}
            missingFields={developerMissingFields}
            missingDates={developerMissingDates}
            pendingAttendanceAction={developerPendingAttendanceAction}
            selectedAttendanceDate={selectedAttendanceDate}
            onClose={clearDeveloperMissingDataState}
            onSave={async () => {
              clearDeveloperMissingDataState()
            }}
          />
        </Suspense>
      )}

      {showMonthModal && (
        <Suspense fallback={<LazyFallback />}>
          <MonthModal
            isOpen={showMonthModal}
            onClose={() => setShowMonthModal(false)}
          />
        </Suspense>
      )}

      {/* Global Modals - accessible from profile dropdown */}
      {showWorkspaceSettings && (
        <Suspense fallback={<LazyFallback />}>
          <WorkspaceSettingsModal
            isOpen={showWorkspaceSettings}
            onClose={() => setShowWorkspaceSettings(false)}
          />
        </Suspense>
      )}

      {showDeleteAccount && (
        <Suspense fallback={<LazyFallback />}>
          <DeleteAccountModal
            isOpen={showDeleteAccount}
            onClose={() => setShowDeleteAccount(false)}
          />
        </Suspense>
      )}

      {showExportData && (
        <Suspense fallback={<LazyFallback />}>
          <ExportDataModal
            isOpen={showExportData}
            onClose={() => setShowExportData(false)}
          />
        </Suspense>
      )}

      {/* Password Setup Modal for collaborators */}
      {showSetPassword && (
        <Suspense fallback={<LazyFallback />}>
          <SetPasswordModal
            isOpen={showSetPassword}
            onClose={() => setShowSetPassword(false)}
            onSuccess={() => setNeedsPasswordSetup(false)}
          />
        </Suspense>
      )}

      {/* Tutorial Prompt Bar - shown after password setup */}
      <TutorialPromptBar
        isOpen={showTutorialPrompt}
        onAccept={() => {
          setShowTutorialPrompt(false)
          setShowOnboarding(true)
        }}
        onDismiss={() => {
          setShowTutorialPrompt(false)
          localStorage.setItem('tutorialPrompt_dismissed', 'true')
        }}
      />

      {/* Onboarding Wizard for new users */}
      {showOnboarding && (
        <Suspense fallback={<LazyFallback />}>
          <OnboardingWizard
            isOpen={showOnboarding}
            onClose={() => setShowOnboarding(false)}
            onNavigate={handleOnboardingNavigate}
          />
        </Suspense>
      )}

      {showAIChat && (
        <Suspense fallback={<LazyFallback />}>
          <AIChatAssistant
            isOpen={showAIChat}
            onClose={() => setShowAIChat(false)}
          />
        </Suspense>
      )}


      {/* Global Command Palette - lazy loaded */}
      <Suspense fallback={null}>
        <CommandPalette
          setCurrentView={setCurrentView}
          onAddMember={() => setShowMemberModal(true)}
          isExecutive={isExecutive}
          onNavigateToSettingsSection={(section) => {
            setCurrentView('settings')
            setNavigateToSettingsSection(section)
          }}
        />
      </Suspense>

      <AppUpdatePrompt />

      <ToastContainer
        className="datser-toast-stack"
        toastClassName="datser-toast"
        bodyClassName="datser-toast-body"
        position="top-center"
        autoClose={6500}
        transition={Slide}
        hideProgressBar={false}
        newestOnTop
        closeOnClick={false}
        rtl={false}
        pauseOnFocusLoss
        draggable={false}
        closeButton={CustomCloseButton}
        pauseOnHover
        limit={1}
      />
    </div>
  )
}

// Auth wrapper - shows login or app based on auth state
function AuthenticatedApp({ isMobile }) {
  const { isAuthenticated, loading } = useAuth()

  // Detect password recovery flow from hash BEFORE AuthContext clears it
  const [showResetPassword, setShowResetPassword] = useState(() => {
    const hash = window.location.hash
    if (hash && hash.includes('type=recovery')) return true
    const params = new URLSearchParams(window.location.search)
    if (params.get('type') === 'recovery') return true
    return false
  })


  // Show loading spinner while checking auth
  if (loading) {
    return (
      <div className="min-h-screen bg-gray-50 dark:bg-gray-900 flex items-center justify-center">
        <div className="text-center">
          <div className="w-12 h-12 border-4 border-primary-500 border-t-transparent rounded-full animate-spin mx-auto mb-4" />
          <p className="text-gray-600 dark:text-gray-400">Loading...</p>
        </div>
      </div>
    )
  }

  // Not authenticated -> show login page
  if (!isAuthenticated) {
    return <LoginPage />
  }

  return (
    <>
      <AppContent isMobile={isMobile} />
      {showResetPassword && (
        <Suspense fallback={null}>
          <ResetPasswordModal
            isOpen={showResetPassword}
            onClose={() => setShowResetPassword(false)}
          />
        </Suspense>
      )}
    </>
  )
}

function App() {
  const [isMobile, setIsMobile] = useState(false)

  // iOS keyboard-aware offset and robust mobile detection
  useEffect(() => {
    const isIOS = /iPhone|iPad|iPod/i.test(navigator.userAgent)
    if (isIOS) {
      document.documentElement.classList.add('is-ios')
    }

    // Mobile detection via UA + input modality + viewport width
    const coarseMedia = window.matchMedia ? window.matchMedia('(pointer: coarse)') : null
    const widthMedia = window.matchMedia ? window.matchMedia('(max-width: 768px)') : null
    const uaMobile = /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(navigator.userAgent)

    const computeMobile = () => uaMobile || (coarseMedia?.matches ?? false) || (widthMedia?.matches ?? false)
    setIsMobile(computeMobile())

    const onMediaChange = () => setIsMobile(computeMobile())
    coarseMedia?.addEventListener('change', onMediaChange)
    widthMedia?.addEventListener('change', onMediaChange)

    // Keyboard offset for iOS
    const vv = window.visualViewport
    const applyOffset = () => {
      if (!vv) return
      // Use full difference between layout viewport and visual viewport height.
      // This closely matches keyboard height across iOS Safari and Android Chrome.
      const diff = Math.max(0, window.innerHeight - vv.height)
      document.documentElement.style.setProperty('--keyboard-offset', `${diff}px`)
    }
    vv?.addEventListener('resize', applyOffset)
    vv?.addEventListener('scroll', applyOffset)
    applyOffset()

    return () => {
      vv?.removeEventListener('resize', applyOffset)
      vv?.removeEventListener('scroll', applyOffset)
      coarseMedia?.removeEventListener('change', onMediaChange)
      widthMedia?.removeEventListener('change', onMediaChange)
    }
  }, [])

  return (
    <ErrorBoundary>
      <AuthProvider>
        <ThemeProvider>
          <AppProvider>
            <AuthenticatedApp isMobile={isMobile} />
          </AppProvider>
        </ThemeProvider>
      </AuthProvider>
    </ErrorBoundary>
  )
}

export default App
