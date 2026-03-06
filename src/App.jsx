import React, { useState, useEffect, lazy, Suspense, memo } from 'react'
import { ToastContainer } from 'react-toastify'
import 'react-toastify/dist/ReactToastify.css'

// Core components - loaded immediately
import Header from './components/Header'
import Dashboard from './components/Dashboard'
import ErrorBoundary from './components/ErrorBoundary'
import LoginPage from './components/LoginPage'
import TutorialPromptBar from './components/TutorialPromptBar'
import MonthModal from './components/MonthModal'

// Lazy-loaded components - loaded on demand for faster initial load
const MemberModal = lazy(() => import('./components/MemberModal'))
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
function AppContent({ isMobile }) {

  const { preferences, signOut } = useAuth()
  const { members, loading: appLoading, hasAccess, isCollaborator, adminSyncNotice, acknowledgeAdminSync } = useApp()
  const [currentView, setCurrentView] = useState('dashboard')
  const [isAdmin, setIsAdmin] = useState(() => {
    return localStorage.getItem('tmht_admin_session') === 'true'
  })
  const [showMemberModal, setShowMemberModal] = useState(false)
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

  // Handle navigation from onboarding wizard
  const handleOnboardingNavigate = (view, options) => {
    setCurrentView(view)
    if (options?.openModal === 'addMember') {
      setTimeout(() => setShowMemberModal(true), 100)
    }
  }

  const isExecutive = preferences?.role === 'executive' || preferences?.is_executive === true
  const adminTargetLabel = adminSyncNotice?.targetDate
    ? new Date(adminSyncNotice.targetDate).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
    : (adminSyncNotice?.targetTable ? adminSyncNotice.targetTable.replace('_', ' ') : null)

  // Expose modal openers globally via window for profile dropdown
  useEffect(() => {
    window.openWorkspaceSettings = () => setShowWorkspaceSettings(true)
    window.openDeleteAccount = () => setShowDeleteAccount(true)
    window.openExportData = () => setShowExportData(true)
    window.openSettings = () => setCurrentView('settings')
    window.openExecutive = () => setCurrentView('exec')
    window.openOnboarding = () => setShowOnboarding(true)
    return () => {
      delete window.openWorkspaceSettings
      delete window.openDeleteAccount
      delete window.openExportData
      delete window.openSettings
      delete window.openExecutive
      delete window.openOnboarding
    }
  }, [])

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
    <div className={`min-app-vh transition-colors duration-200 ios-overscroll-none ${isMobile ? 'mobile-toast-top' : ''}`}>
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

      <main className={`mx-auto px-0 sm:px-4 py-8 pt-28 sm:pt-24 md:pt-20 w-full`}>
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

      <ToastContainer
        position={isMobile ? 'top-center' : 'bottom-right'}
        autoClose={3000}
        hideProgressBar={false}
        newestOnTop
        closeOnClick
        rtl={false}
        pauseOnFocusLoss
        draggable
        pauseOnHover
        style={isMobile
          ? { top: 'calc(env(safe-area-inset-top) + 8px)' }
          : { bottom: 'calc(env(safe-area-inset-bottom) + 8px)' }}
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
