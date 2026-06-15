import React, { useEffect, useMemo, useRef, useState } from 'react'
import {
  BadgeCheck,
  BellRing,
  Check,
  ChevronRight,
  Clock3,
  Eye,
  LayoutDashboard,
  Moon,
  Palette,
  QrCode,
  Search,
  Smartphone,
  Sparkles,
  TouchpadOff,
  Zap
} from 'lucide-react'
import MemberCodeBadge from './MemberCodeBadge'

const PREVIEW_COPY = {
  member_codes: {
    title: 'Live Feature Preview',
    kicker: 'Member Codes',
    description: 'This preview shows how Member Codes appear on member cards, search results, and QR member passes.'
  },
  accessibility: {
    title: 'Live Feature Preview',
    kicker: 'Accessibility',
    description: 'This preview shows touch feedback, search tray behavior, quick look, and notification controls.'
  },
  appearance: {
    title: 'Live Feature Preview',
    kicker: 'Appearance',
    description: 'This preview shows how theme, accent color, and badge styling affect the app.'
  },
  activity: {
    title: 'Live Feature Preview',
    kicker: 'Recent Edits',
    description: 'This preview shows saved edits grouped by date so you can jump back to changed members.'
  },
  data: {
    title: 'Live Feature Preview',
    kicker: 'Data Sync',
    description: 'This preview shows cached member pages and a manual sync flow for lower Supabase usage.'
  },
  storage: {
    title: 'Live Feature Preview',
    kicker: 'Storage & Limits',
    description: 'This preview shows how DatSer keeps member previews light and avoids unnecessary downloads.'
  },
  default: {
    title: 'Live Feature Preview',
    kicker: 'Settings',
    description: 'This preview shows the visible result of this settings section before you change it.'
  }
}

export const PreviewFrame = ({ children, className = '' }) => (
  <div className={`overflow-hidden rounded-[1.35rem] border border-gray-200 bg-white/90 shadow-sm shadow-black/5 backdrop-blur-xl dark:border-white/10 dark:bg-[#111313]/95 dark:shadow-black/30 ${className}`}>
    {children}
  </div>
)

export const FeaturePreviewCard = ({ icon: Icon = Sparkles, title, detail, children }) => (
  <div className="rounded-2xl border border-gray-200 bg-gray-50/90 p-3 dark:border-white/10 dark:bg-white/[0.04]">
    <div className="mb-2 flex items-center gap-2">
      <span className="grid h-8 w-8 shrink-0 place-items-center rounded-xl bg-orange-100 text-orange-600 dark:bg-orange-500/15 dark:text-orange-300">
        <Icon className="h-4 w-4" />
      </span>
      <div className="min-w-0">
        <p className="truncate text-sm font-black text-gray-900 dark:text-white">{title}</p>
        {detail && <p className="truncate text-xs text-gray-500 dark:text-gray-400">{detail}</p>}
      </div>
    </div>
    {children}
  </div>
)

export const AutoScrollPreview = ({ children, className = '' }) => {
  const scrollerRef = useRef(null)
  const [isActive, setIsActive] = useState(false)
  const [isPaused, setIsPaused] = useState(false)

  useEffect(() => {
    const node = scrollerRef.current
    if (!node || typeof IntersectionObserver === 'undefined') {
      setIsActive(true)
      return undefined
    }

    const observer = new IntersectionObserver(([entry]) => {
      setIsActive(Boolean(entry?.isIntersecting))
    }, { threshold: 0.38 })

    observer.observe(node)
    return () => observer.disconnect()
  }, [])

  useEffect(() => {
    const node = scrollerRef.current
    if (!node || !isActive || isPaused) return undefined
    if (typeof window !== 'undefined' && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) return undefined

    const timer = window.setInterval(() => {
      const maxScroll = node.scrollHeight - node.clientHeight
      if (maxScroll <= 8) return
      const nextTop = node.scrollTop >= maxScroll - 6 ? 0 : node.scrollTop + 42
      node.scrollTo({ top: nextTop, behavior: 'smooth' })
    }, 2300)

    return () => window.clearInterval(timer)
  }, [isActive, isPaused])

  return (
    <div
      ref={scrollerRef}
      className={`live-feature-autoscroll max-h-[21rem] overflow-y-auto overscroll-contain pr-1 ${className}`}
      onPointerEnter={() => setIsPaused(true)}
      onPointerLeave={() => setIsPaused(false)}
      onPointerDown={() => setIsPaused(true)}
      onFocusCapture={() => setIsPaused(true)}
      onBlurCapture={() => setIsPaused(false)}
    >
      {children}
    </div>
  )
}

const MiniMemberCard = ({ name = 'Agnes Abena Agyei', code = 'A44' }) => (
  <div className="rounded-2xl border border-gray-200 bg-white p-3 shadow-lg shadow-black/5 dark:border-white/10 dark:bg-[#202121] dark:shadow-black/20">
    <div className="mb-3 flex items-start justify-between gap-3">
      <div className="min-w-0">
        <p className="truncate text-sm font-black text-gray-900 dark:text-white">{name}</p>
        <p className="text-xs text-gray-500 dark:text-gray-400">Joined Jan 10</p>
      </div>
      <MemberCodeBadge code={code} styleKey="coral" />
    </div>
    <div className="grid grid-cols-2 gap-2">
      <span className="rounded-xl bg-orange-700 px-3 py-2 text-center text-xs font-black text-white">Present</span>
      <span className="rounded-xl bg-red-800 px-3 py-2 text-center text-xs font-black text-white">Absent</span>
    </div>
  </div>
)

const MemberCodesPreview = () => (
  <AutoScrollPreview className="space-y-3">
    <MiniMemberCard />
    <FeaturePreviewCard icon={QrCode} title="Member pass" detail="Tap the code to open the QR pass">
      <div className="grid grid-cols-[auto_1fr] items-center gap-3 rounded-2xl bg-orange-50 p-3 dark:bg-orange-500/10">
        <div className="grid h-20 w-20 place-items-center rounded-full border-4 border-orange-300 bg-white text-[10px] font-black text-gray-900 shadow-inner">
          QR
        </div>
        <div className="min-w-0">
          <p className="truncate text-sm font-black text-gray-900 dark:text-white">Esther M</p>
          <div className="mt-2 inline-flex">
            <MemberCodeBadge code="E79" styleKey="soft" />
          </div>
          <p className="mt-2 text-xs text-gray-500 dark:text-gray-400">Scan opens this member and marks present.</p>
        </div>
      </div>
    </FeaturePreviewCard>
    <FeaturePreviewCard icon={Search} title="Code lookup" detail="Exact code searches stay fast">
      <div className="rounded-2xl border border-gray-200 bg-white p-2 dark:border-white/10 dark:bg-[#202121]">
        {['A44 Agnes Abena', 'E79 Esther M', 'P36 PreCOMPLETEDious'].map((row) => (
          <div key={row} className="flex items-center justify-between gap-2 rounded-xl px-2 py-1.5 text-xs font-bold text-gray-700 dark:text-gray-200">
            <span className="truncate">{row}</span>
            <ChevronRight className="h-3.5 w-3.5 text-orange-500" />
          </div>
        ))}
      </div>
    </FeaturePreviewCard>
  </AutoScrollPreview>
)

const MemberSearchPreview = () => (
  <AutoScrollPreview className="space-y-3">
    <FeaturePreviewCard icon={Search} title="Short tray" detail="Compact matches while typing">
      <div className="rounded-2xl border border-gray-200 bg-white p-2 dark:border-white/10 dark:bg-[#202121]">
        <div className="mb-2 flex items-center gap-2 rounded-xl bg-gray-100 px-3 py-2 dark:bg-black/30">
          <Search className="h-4 w-4 text-gray-400" />
          <span className="text-sm font-bold text-gray-900 dark:text-white">tray</span>
        </div>
        {['Beniah Opong Diallo', 'Beniah Yaw Dingo', 'Beniah Kwaku Mensah'].map((name, index) => (
          <div key={name} className="grid grid-cols-[1fr_auto] items-center gap-2 border-t border-gray-100 px-2 py-2 dark:border-white/5">
            <div className="min-w-0">
              <p className="truncate text-xs font-black text-gray-900 dark:text-white">{name}</p>
              <p className="text-[10px] text-gray-500 dark:text-gray-400">Tap to focus</p>
            </div>
            <span className="rounded-lg bg-orange-600 px-2 py-1 text-[10px] font-black text-white">{['A12', 'B47', 'C09'][index]}</span>
          </div>
        ))}
      </div>
    </FeaturePreviewCard>
    <FeaturePreviewCard icon={LayoutDashboard} title="Full list" detail="Open results in the main view">
      <div className="grid gap-2">
        <MiniMemberCard name="Mary-Ann Goldman" code="M25" />
      </div>
    </FeaturePreviewCard>
  </AutoScrollPreview>
)

const RecentEditsPreview = () => (
  <AutoScrollPreview className="space-y-3">
    <FeaturePreviewCard icon={Clock3} title="Date tabs" detail="Jump through edits by service date">
      <div className="mb-3 flex gap-2 overflow-x-auto pb-1">
        {['Jun 7', 'Jun 14', 'Jun 21', 'Jun 28'].map((date, index) => (
          <span key={date} className={`shrink-0 rounded-full px-3 py-1.5 text-xs font-black ${index === 0 ? 'bg-orange-600 text-white' : 'bg-gray-100 text-gray-600 dark:bg-white/10 dark:text-gray-300'}`}>{date}</span>
        ))}
      </div>
      {['Stephen Amafu', 'Agnes Abena Agyei', 'Mary-Ann Goldman'].map((name) => (
        <div key={name} className="flex items-center gap-3 border-t border-gray-100 py-2 first:border-t-0 dark:border-white/5">
          <span className="grid h-8 w-8 place-items-center rounded-xl bg-orange-100 text-xs font-black text-orange-700 dark:bg-orange-500/15 dark:text-orange-300">{name[0]}</span>
          <div className="min-w-0 flex-1">
            <p className="truncate text-xs font-black text-gray-900 dark:text-white">{name}</p>
            <p className="text-[10px] text-gray-500 dark:text-gray-400">Updated member details</p>
          </div>
          <ChevronRight className="h-4 w-4 text-gray-400" />
        </div>
      ))}
    </FeaturePreviewCard>
  </AutoScrollPreview>
)

const AppearancePreview = () => (
  <AutoScrollPreview className="space-y-3">
    <FeaturePreviewCard icon={Palette} title="Theme preview" detail="Dark, light, and system modes">
      <div className="grid grid-cols-3 gap-2">
        {[
          ['Light', SunLike],
          ['Dark', Moon],
          ['System', Smartphone]
        ].map(([label, Icon], index) => (
          <span key={label} className={`grid min-h-[54px] place-items-center rounded-xl border text-xs font-black ${index === 1 ? 'border-orange-500 bg-orange-500/10 text-orange-600 dark:text-orange-200' : 'border-gray-200 bg-white text-gray-600 dark:border-white/10 dark:bg-white/5 dark:text-gray-300'}`}>
            <Icon className="mb-1 h-4 w-4" />
            {label}
          </span>
        ))}
      </div>
    </FeaturePreviewCard>
    <MiniMemberCard name="Kelvin Sarfo" code="K13" />
  </AutoScrollPreview>
)

const SunLike = (props) => <Sparkles {...props} />

const AccessibilityPreview = () => (
  <AutoScrollPreview className="space-y-3">
    <FeaturePreviewCard icon={TouchpadOff} title="Touch feedback" detail="Readable buttons with optional haptics">
      <div className="grid grid-cols-3 gap-2">
        {['Soft', 'Normal', 'Strong'].map((label, index) => (
          <span key={label} className={`rounded-xl border px-2 py-2 text-center text-xs font-black ${index === 1 ? 'border-orange-500 bg-orange-50 text-orange-700 dark:bg-orange-500/15 dark:text-orange-200' : 'border-gray-200 bg-white text-gray-600 dark:border-white/10 dark:bg-white/5 dark:text-gray-300'}`}>{label}</span>
        ))}
      </div>
    </FeaturePreviewCard>
    <FeaturePreviewCard icon={BellRing} title="Notifications" detail="Copy, sync, and alert messages">
      <div className="rounded-2xl border border-orange-200 bg-orange-50 p-3 text-xs font-bold text-orange-700 dark:border-orange-400/20 dark:bg-orange-500/10 dark:text-orange-200">
        Copied website link
      </div>
    </FeaturePreviewCard>
  </AutoScrollPreview>
)

const DefaultPreview = ({ section }) => (
  <AutoScrollPreview className="space-y-3">
    <FeaturePreviewCard icon={Eye} title={section?.label || 'Setting preview'} detail="Preview how this section affects DatSer">
      <div className="space-y-2">
        <div className="h-3 w-2/3 rounded-full bg-orange-500/40" />
        <div className="h-3 w-full rounded-full bg-gray-200 dark:bg-white/10" />
        <div className="h-3 w-5/6 rounded-full bg-gray-200 dark:bg-white/10" />
      </div>
    </FeaturePreviewCard>
    <FeaturePreviewCard icon={Check} title="Safe to adjust" detail="Changes can be reviewed before saving" />
  </AutoScrollPreview>
)

const renderPreviewBody = (type, section) => {
  switch (type) {
    case 'member_codes':
      return <MemberCodesPreview />
    case 'accessibility':
      return <AccessibilityPreview />
    case 'appearance':
      return <AppearancePreview />
    case 'activity':
      return <RecentEditsPreview />
    case 'data':
    case 'storage':
      return <MemberSearchPreview />
    default:
      return <DefaultPreview section={section} />
  }
}

const LiveFeaturePreview = ({ type = 'default', section = null, compact = false, collapsible = true, defaultOpen = false, className = '' }) => {
  const copy = PREVIEW_COPY[type] || PREVIEW_COPY.default
  const [isOpen, setIsOpen] = useState(defaultOpen)
  const PreviewIcon = useMemo(() => {
    if (type === 'member_codes') return BadgeCheck
    if (type === 'accessibility') return Zap
    if (type === 'appearance') return Palette
    if (type === 'activity') return Clock3
    return Sparkles
  }, [type])

  useEffect(() => {
    setIsOpen(defaultOpen)
  }, [defaultOpen, type])

  return (
    <PreviewFrame className={`live-feature-preview ${compact ? 'live-feature-preview-compact' : ''} ${className}`}>
      <button
        type="button"
        onClick={() => collapsible && setIsOpen((value) => !value)}
        className={`flex w-full items-center justify-between gap-3 border-b border-gray-200/70 px-4 py-4 text-left transition hover:bg-orange-50/70 dark:border-white/10 dark:hover:bg-orange-500/10 ${collapsible ? 'cursor-pointer' : 'cursor-default'}`}
        aria-expanded={isOpen}
        aria-label={`${isOpen ? 'Close' : 'Open'} ${copy.title}`}
      >
        <div className="flex min-w-0 items-center gap-3">
          <span className="grid h-10 w-10 shrink-0 place-items-center rounded-2xl bg-orange-100 text-orange-600 dark:bg-orange-500/15 dark:text-orange-300">
            <PreviewIcon className="h-5 w-5" />
          </span>
          <div className="min-w-0">
            <p className="text-[11px] font-black uppercase tracking-[0.18em] text-orange-600 dark:text-orange-300">{copy.kicker}</p>
            <h3 className="truncate text-base font-black text-gray-900 dark:text-white">{copy.title}</h3>
          </div>
        </div>
        {collapsible && (
          <span className="inline-flex shrink-0 items-center gap-2 rounded-full border border-orange-200 bg-orange-50 px-3 py-1.5 text-xs font-black text-orange-700 dark:border-orange-400/20 dark:bg-orange-500/10 dark:text-orange-200">
            {isOpen ? 'Close' : 'Open'}
            <ChevronRight className={`h-4 w-4 transition-transform ${isOpen ? 'rotate-90' : ''}`} />
          </span>
        )}
      </button>

      {isOpen && (
        <div className="space-y-4 p-4">
          {renderPreviewBody(type, section)}
          <p className="rounded-2xl border border-orange-200/70 bg-orange-50/70 px-3 py-2 text-xs font-semibold leading-5 text-orange-800 dark:border-orange-400/20 dark:bg-orange-500/10 dark:text-orange-100">
            {copy.description}
          </p>
        </div>
      )}
    </PreviewFrame>
  )
}

export default LiveFeaturePreview
