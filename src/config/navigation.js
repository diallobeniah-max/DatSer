import {
    User,
    Building2,
    Users,
    Database,
    Palette,
    Zap,
    HelpCircle,
    ClipboardList,
    LayoutDashboard,
    TrendingUp,
    Monitor,
    AlertTriangle,
    Lock,
    Mail,
    Download,
    Upload,
    UserPlus,
    Calendar,
    Moon,
    Sun,
    Laptop,
    RefreshCw,
    Archive,
    BellRing,
    Shield
} from 'lucide-react'

// Main Application Views
export const APP_VIEWS = [
    { id: 'dashboard', label: 'Dashboard', icon: LayoutDashboard },
    { id: 'analytics', label: 'View Analytics', icon: TrendingUp },
    { id: 'admin', label: 'Admin Panel', icon: Users },
    { id: 'exec', label: 'Executive Attendance', icon: Monitor, requiresExec: true },
    { id: 'settings', label: 'Settings', icon: Zap }
]

// Settings Page Sections
export const SETTINGS_SECTIONS = [
    {
        id: 'account',
        label: 'Account',
        icon: User,
        color: 'blue',
        content: 'Manage your profile picture, email address, full name, password, and personal account settings. Update your avatar, change your email, modify your display name, and secure your account with password changes.',
        keywords: 'profile email avatar name personal information password security login sign in'
    },
    {
        id: 'workspace',
        label: 'Workspace',
        icon: Building2,
        color: 'purple',
        content: 'Configure your workspace name, organization settings, and ministry information. Set up your church or organization name and manage workspace preferences.',
        keywords: 'organization company ministry name settings workspace configuration'
    },
    {
        id: 'team',
        label: 'Team & Sharing',
        icon: Users,
        color: 'green',
        content: 'Add team members, invite collaborators, manage permissions, and control access to your workspace. Share your data with trusted team members and manage user roles.',
        keywords: 'collaborators sharing access members users permissions invitations team management'
    },
    {
        id: 'data',
        label: 'Data Management',
        icon: Database,
        color: 'orange',
        content: 'Export member data, import CSV files, backup your information, prepare offline mode, sync pending changes, and manage member databases.',
        keywords: 'export import backup members data storage csv download upload database offline sync cache'
    },
    {
        id: 'storage',
        label: 'Storage & Limits',
        icon: Archive,
        color: 'orange',
        content: 'Review database storage, free plan usage, auth email limits, and archive recommendations.',
        keywords: 'storage limits free plan database emails auth archive supabase quota usage'
    },
    {
        id: 'updates',
        label: 'Updates',
        icon: Download,
        color: 'green',
        content: 'Download Android APK updates, check the installed app version, and review recent release details.',
        keywords: 'updates apk android download version release install latest'
    },
    {
        id: 'appearance',
        label: 'Appearance',
        icon: Palette,
        color: 'pink',
        content: 'Customize theme, colors, and display settings. Switch between dark and light modes, adjust visual preferences, and personalize your interface.',
        keywords: 'theme dark light colors display visual interface'
    },
    {
        id: 'forms',
        label: 'Forms & Workflow',
        icon: UserPlus,
        color: 'orange',
        content: 'Control member form helpers, the Next button, guided field order, missing info prompts, attendance completion, and date of birth picker behavior.',
        keywords: 'forms workflow next button guided form date birth missing info auto all dates member attendance'
    },
    {
        id: 'accessibility',
        label: 'Accessibility',
        icon: Zap,
        color: 'yellow',
        content: 'Command Menu, keyboard shortcuts, search behavior, notifications, website sharing, QR code, and in-app alert settings.',
        keywords: 'command menu keyboard shortcuts navigation ctrl k cmd k notifications alerts search share qr code'
    },
    {
        id: 'help',
        label: 'Help Center',
        icon: HelpCircle,
        color: 'cyan',
        content: 'Get help and support, read documentation, view tutorials, and find answers to frequently asked questions. Learn how to use all features and troubleshoot issues.',
        keywords: 'support documentation tutorial guide FAQ help instructions getting started'
    },
    {
        id: 'activity',
        label: 'Activity Log',
        icon: ClipboardList,
        color: 'indigo',
        content: 'View a history of actions taken in your workspace. Monitor member additions, deletions, updates, and other important events.',
        keywords: 'audit logs history updates tracking activity actions events'
    },
    {
        id: 'developer',
        label: 'Developer Mode',
        icon: Monitor,
        color: 'cyan',
        requiresDeveloper: true,
        content: 'Open risky flows quickly, test interaction-heavy controls, and use the in-app sandbox before shipping changes.',
        keywords: 'developer dev qa testing sandbox smoke launchers debug preflight'
    },
    {
        id: 'danger',
        label: 'Danger Zone',
        icon: AlertTriangle,
        color: 'red',
        danger: true,
        content: 'Delete your account, remove all data, and perform destructive actions. Permanently erase your account and all associated information.',
        keywords: 'delete remove account danger destructive reset erase data clean slate'
    }
]

export const SETTINGS_SEARCH_INDEX = [
    {
        id: 'profile_photo',
        section: 'account',
        label: 'Profile Photo',
        description: 'Change your profile picture',
        keywords: 'avatar image photo picture upload face profile picture',
        icon: User
    },
    {
        id: 'account_name',
        section: 'account',
        label: 'Account Name',
        description: 'View your display name',
        keywords: 'name full username display personal info profile',
        icon: User
    },
    {
        id: 'account_email',
        section: 'account',
        label: 'Email Address',
        description: 'View the email connected to this account',
        keywords: 'email address mail contact login sign in',
        icon: Mail
    },
    {
        id: 'app_version',
        section: 'account',
        label: 'App Version',
        description: 'View installed APK version and wrapper mode',
        keywords: 'version apk android local bundled live wrapper update build versionCode versionName',
        icon: Monitor
    },
    {
        id: 'android_apk',
        section: 'updates',
        label: 'Android Updates',
        description: 'Download the latest Android APK and see recent release details',
        keywords: 'android apk update download install latest release version',
        icon: Download
    },
    {
        id: 'date_of_birth',
        section: 'account',
        label: 'Date of Birth',
        description: 'Update your profile date of birth',
        keywords: 'dob birthday birth date age profile',
        icon: Calendar
    },
    {
        id: 'date_of_birth_picker',
        section: 'forms',
        label: 'Date of Birth Picker',
        description: 'Choose the member form birthday picker style',
        keywords: 'dob birthday birth date picker combined month year day member form',
        icon: Calendar
    },
    {
        id: 'password',
        section: 'account',
        label: 'Password',
        description: 'Change or reset your password',
        keywords: 'password security reset change login',
        icon: Lock
    },
    {
        id: 'set_password',
        section: 'account',
        label: 'Create Password',
        description: 'Open password setup',
        keywords: 'password create set setup login',
        icon: Lock
    },
    {
        id: 'edit_workspace',
        section: 'workspace',
        label: 'Edit Workspace',
        description: 'Change workspace name and preferences',
        keywords: 'workspace name organization ministry rename settings',
        icon: Building2
    },
    {
        id: 'admin_controls',
        section: 'workspace',
        label: 'Admin Controls',
        description: 'Set sticky month and Sunday dates for the workspace',
        keywords: 'admin controls owner power transfer override sticky month sunday',
        icon: Shield
    },
    {
        id: 'auto_all_dates',
        section: 'forms',
        label: 'Auto-All-Dates',
        description: 'Automatically mark all dates up to today as present',
        keywords: 'auto all dates attendance present automation missing completed',
        icon: Zap
    },
    {
        id: 'missing_info_prompt',
        section: 'forms',
        label: 'Missing Info Popup',
        description: 'Turn the missing information prompt on or off',
        keywords: 'missing info popup prompt complete information override age phone level',
        icon: AlertTriangle
    },
    {
        id: 'guided_form_assistant',
        section: 'forms',
        label: 'Guided Form Assistant',
        description: 'Highlight the next field in member and attendance forms',
        keywords: 'guided form assistant highlight next field notes tags auto focus scroll attendance auto present',
        icon: Zap
    },
    {
        id: 'current_month',
        section: 'workspace',
        label: 'Current Month Database',
        description: 'Select or review the active month database',
        keywords: 'month database table select switch change calendar sunday',
        icon: Calendar
    },
    {
        id: 'personal_calendar',
        section: 'workspace',
        label: 'Personal Calendar Mode',
        description: 'Choose automatic or manual month and Sunday behavior',
        keywords: 'personal calendar manual auto month sunday override',
        icon: Calendar
    },
    {
        id: 'invite_team',
        section: 'team',
        label: 'Invite Team Members',
        description: 'Share access with new collaborators',
        keywords: 'invite add share team member collaborator friend access',
        icon: UserPlus
    },
    {
        id: 'manage_team',
        section: 'team',
        label: 'Manage Team',
        description: 'View, manage, and remove collaborators',
        keywords: 'team list collaborators remove delete permissions roles transfer',
        icon: Users
    },
    {
        id: 'offline_mode',
        section: 'data',
        label: 'Offline Mode',
        description: 'Download offline data, see pending changes, sync now, or clear local cache',
        keywords: 'offline sync download offline data prepare cache pending changes local android apk storage',
        icon: Database
    },
    {
        id: 'export_data',
        section: 'data',
        label: 'Export Data',
        description: 'Download your data as CSV',
        keywords: 'export download save backup csv excel',
        icon: Download
    },
    {
        id: 'import_data',
        section: 'data',
        label: 'Import Data',
        description: 'Import members from CSV',
        keywords: 'import upload restore csv add bulk',
        icon: Upload
    },
    {
        id: 'clean_duplicates',
        section: 'data',
        label: 'Clean Duplicates',
        description: 'Find and merge duplicate members',
        keywords: 'duplicates clean fix merge cleanup',
        icon: RefreshCw
    },
    {
        id: 'archive_month',
        section: 'data',
        label: 'Archive Month',
        description: 'Export and delete old months to save storage',
        keywords: 'archive month delete export csv storage space free cleanup',
        icon: Archive
    },
    {
        id: 'storage_limits',
        section: 'storage',
        label: 'Storage & Limits',
        description: 'Review database storage, free plan limits, and auth email limits',
        keywords: 'storage limits database supabase emails auth rate limit free plan',
        icon: Database
    },
    {
        id: 'theme_light',
        section: 'appearance',
        label: 'Light Mode',
        description: 'Switch to light theme',
        keywords: 'light day white bright theme appearance',
        icon: Sun
    },
    {
        id: 'theme_dark',
        section: 'appearance',
        label: 'Dark Mode',
        description: 'Switch to dark theme',
        keywords: 'dark night black dim theme appearance',
        icon: Moon
    },
    {
        id: 'theme_auto',
        section: 'appearance',
        label: 'Auto Theme',
        description: 'Sync theme with system settings',
        keywords: 'system auto default theme appearance',
        icon: Laptop
    },
    {
        id: 'command_menu',
        section: 'accessibility',
        label: 'Command Menu',
        description: 'Open quick navigation with Ctrl K or Cmd K',
        keywords: 'command menu keyboard shortcuts navigation ctrl k cmd k quick search',
        shortcut: 'Ctrl K',
        icon: Zap
    },
    {
        id: 'notifications',
        section: 'accessibility',
        label: 'In-App Notifications',
        description: 'Status banners, popup alerts, and sync messages shown inside DatSer',
        keywords: 'notifications alerts popups popup toast banner ios style sync offline',
        icon: BellRing
    },
    {
        id: 'help_center',
        section: 'help',
        label: 'Help Center',
        description: 'View documentation and support',
        keywords: 'help support guide docs tutorial manual faq settings',
        icon: HelpCircle
    },
    {
        id: 'activity_log',
        section: 'activity',
        label: 'Activity Log',
        description: 'Review workspace changes and audit history',
        keywords: 'activity log audit history events tracking changes',
        icon: ClipboardList
    },
    {
        id: 'developer_mode',
        section: 'developer',
        label: 'Developer Mode',
        description: 'Open the in-app QA sandbox and quick launchers',
        keywords: 'dev developer testing qa sandbox launchers debug preflight notifications',
        icon: Monitor,
        requiresDeveloper: true
    },
    {
        id: 'delete_account',
        section: 'danger',
        label: 'Delete Account',
        description: 'Permanently remove your account',
        keywords: 'delete remove destroy account danger destructive reset erase data clean slate',
        icon: AlertTriangle,
        isDestructive: true
    }
]

export const getVisibleSettingsSections = (isDeveloperToolsEnabled = false) =>
    SETTINGS_SECTIONS.filter(section => !section.requiresDeveloper || isDeveloperToolsEnabled)

export const getVisibleSettingsSearchItems = (isDeveloperToolsEnabled = false) =>
    SETTINGS_SEARCH_INDEX.filter(item => !item.requiresDeveloper || isDeveloperToolsEnabled)

export const buildSettingsSearchText = (item, sections = SETTINGS_SECTIONS) => {
    const section = sections.find(candidate => candidate.id === item.section)
    return [
        item.label,
        item.description,
        item.keywords,
        item.shortcut,
        section?.label,
        section?.content,
        section?.keywords
    ].filter(Boolean).join(' ').toLowerCase()
}

export const searchSettingsIndex = (query, items = SETTINGS_SEARCH_INDEX, sections = SETTINGS_SECTIONS) => {
    const normalizedQuery = String(query || '').trim().toLowerCase()
    if (!normalizedQuery) return items
    const tokens = normalizedQuery.split(/\s+/).filter(Boolean)
    return items.filter(item => {
        const searchText = buildSettingsSearchText(item, sections)
        return tokens.every(token => searchText.includes(token))
    })
}
