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
    Shield,
    BadgeCheck,
    Search
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
        id: 'member_codes',
        label: 'Member Codes',
        icon: BadgeCheck,
        color: 'member-codes',
        content: 'Configure member index codes, workspace member codes, QR pass scanning, quick pass bottom sheet, badge style, member profile previews, and exact-match code lookup.',
        keywords: 'member codes workspace member codes index badge quick pass profile preview check in lookup attendance code number id qr pass share scanner camera scan code name'
    },
    {
        id: 'accessibility',
        label: 'Accessibility',
        icon: Zap,
        color: 'yellow',
        content: 'Command Menu, keyboard shortcuts, search behavior, notifications, website sharing, QR code, and in-app alert settings.',
        keywords: 'command menu keyboard shortcuts navigation ctrl k cmd k notifications alerts search share qr code tray short tray full list member search touch haptics'
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
        keywords: 'audit logs history updates tracking activity actions events recent edits changes monthly dates'
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
        id: 'show_tags',
        section: 'forms',
        label: 'Show Tags',
        description: 'Show optional workspace tags in member forms, lists, search, and details',
        keywords: 'tags show hide member tags workspace tags optional tag visibility toggle enable disable forms list details search',
        icon: UserPlus
    },
    {
        id: 'show_visitor',
        section: 'forms',
        label: 'Show Visitor Option',
        description: 'Show the Mark as Visitor control in Add and Edit Member',
        keywords: 'visitor mark visitor option show hide forms add edit member guest',
        icon: UserPlus
    },
    {
        id: 'show_notes',
        section: 'forms',
        label: 'Show Notes',
        description: 'Show the optional notes field in Add and Edit Member',
        keywords: 'notes show hide optional notes field forms add edit member text',
        icon: UserPlus
    },
    {
        id: 'member_codes_enabled',
        section: 'member_codes',
        label: 'Member Codes',
        description: 'Show index codes on member cards',
        keywords: 'member codes workspace member codes enable member codes index badge card quick check in id number code number display codes show hide connected members',
        icon: BadgeCheck
    },
    {
        id: 'workspace_member_codes_enabled',
        section: 'member_codes',
        label: 'Workspace Member Codes',
        description: 'Apply member codes to connected members across the workspace',
        keywords: 'workspace member codes toggle apply everyone connected members all members collaborators admin owner sync supabase save update',
        icon: BadgeCheck
    },
    {
        id: 'member_code_letters_only',
        section: 'member_codes',
        label: 'Letters Only',
        description: 'Generate alphabetical workspace member codes such as A, B, Z, and AA',
        keywords: 'letters letters only alphabetical member code format code format a b aa workspace codes',
        icon: BadgeCheck
    },
    {
        id: 'member_code_numbers_only',
        section: 'member_codes',
        label: 'Numbers Only',
        description: 'Generate numeric workspace member codes such as 001, 002, and 500',
        keywords: 'numbers numbers only numeric member code format code format 001 002 workspace codes',
        icon: BadgeCheck
    },
    {
        id: 'member_code_quick_pass',
        section: 'member_codes',
        label: 'Quick Pass',
        description: 'Open the member pass when a code is tapped',
        keywords: 'quick pass bottom sheet member code profile tap badge qr share scan present',
        icon: BadgeCheck
    },
    {
        id: 'member_code_badge_style',
        section: 'member_codes',
        label: 'Code Badge Style',
        description: 'Choose the member code badge style',
        keywords: 'badge style member code color shape index',
        icon: Palette
    },
    {
        id: 'member_code_card_style',
        section: 'member_codes',
        label: 'Pass Card Style',
        description: 'Choose the member pass card style',
        keywords: 'member pass card style wave glass gradient classic 3d ambient neon galaxy qr share',
        icon: Palette
    },
    {
        id: 'member_code_church_name',
        section: 'member_codes',
        label: 'Pass Organization Name',
        description: 'Edit the name shown on member code passes',
        keywords: 'church name organization workspace ministry pass name code member panel custom name',
        icon: Building2
    },
    {
        id: 'member_code_lookup',
        section: 'member_codes',
        label: 'Code Number Lookup',
        description: 'Show the matching member name while typing a code',
        keywords: 'code number lookup search exact match member name k56 p36 e79 quick lookup code field code name find member',
        icon: Search
    },
    {
        id: 'member_code_lookup_field',
        section: 'member_codes',
        label: 'Code Number Preview Field',
        description: 'Test a code number and see the matching member name',
        keywords: 'type code number preview field k56 member appears immediately lookup test',
        icon: Search
    },
    {
        id: 'member_code_share_message',
        section: 'member_codes',
        label: 'Member Pass Share Message',
        description: 'Edit the message used when sharing a member pass',
        keywords: 'share message member pass custom text whatsapp sms edit template',
        icon: Mail
    },
    {
        id: 'member_code_qr_scanner',
        section: 'member_codes',
        label: 'QR Scanner Camera',
        description: 'Scan member pass QR codes and mark attendance from phones or tablets',
        keywords: 'qr scanner camera scan member pass phone android samsung blurry blue focus rear camera tablet check in present',
        icon: Search
    },
    {
        id: 'member_code_accent',
        section: 'member_codes',
        label: 'Member Code Accent',
        description: 'Choose the accent color for member passes',
        keywords: 'member code accent color pass profile',
        icon: Palette
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
        id: 'member_search_view',
        section: 'accessibility',
        label: 'Member Search View',
        description: 'Choose Short Tray or Full List behavior for member search',
        keywords: 'member search view tray short tray full list results search phone mobile suggestion suggestions',
        icon: Search
    },
    {
        id: 'recent_edits',
        section: 'activity',
        label: 'Recent Edits',
        description: 'Review recent member edits by date and month',
        keywords: 'recent edits changes history activity edited updated date tabs month june sunday',
        icon: ClipboardList
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
        id: 'command_palette_preview',
        section: 'accessibility',
        label: 'Command Menu Preview',
        description: 'Preview settings inside the command menu before opening the full Settings page',
        keywords: 'command palette preview quick settings popup search results ctrl k',
        icon: Zap
    },
    {
        id: 'command_palette_auto_scan',
        section: 'accessibility',
        label: 'Auto-Scan Settings Search',
        description: 'Automatically add new settings and panels to command menu search',
        keywords: 'auto scan settings search command palette discover panels automatic',
        icon: RefreshCw
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

const SEARCH_TOKEN_ALIASES = {
    tray: ['tray', 'search', 'suggestion', 'short'],
    workspace: ['workspace', 'owner', 'shared', 'connected', 'all'],
    code: ['code', 'codes', 'member', 'number'],
    codes: ['code', 'codes', 'member', 'number'],
    pass: ['pass', 'qr', 'share', 'scan'],
    qr: ['qr', 'scan', 'scanner', 'camera', 'code'],
    scanner: ['scanner', 'scan', 'camera', 'qr'],
    camera: ['camera', 'scanner', 'scan', 'qr'],
    number: ['number', 'code', 'codes'],
    recent: ['recent', 'edits', 'activity', 'history'],
    edits: ['edits', 'changes', 'recent', 'activity'],
    light: ['light', 'theme', 'appearance'],
    dark: ['dark', 'theme', 'appearance'],
    tag: ['tag', 'tags', 'label', 'category'],
    tags: ['tags', 'tag', 'label', 'category'],
    notes: ['notes', 'note', 'text', 'optional'],
    visitor: ['visitor', 'guest', 'visit'],
    searhc: ['search'],
    memebr: ['member'],
    memberb: ['member'],
    numnber: ['number'],
    bades: ['badge'],
    badge: ['badge', 'style', 'code'],
    preve: ['preview'],
    preview: ['preview', 'live'],
    live: ['live', 'preview'],
    toggle: ['toggle', 'enable', 'switch', 'turn'],
    turn: ['turn', 'enable', 'toggle', 'switch'],
    enable: ['enable', 'show', 'display', 'turn'],
    android: ['android', 'phone', 'mobile', 'samsung'],
    fone: ['phone'],
    colaborator: ['collaborator'],
    collaborator: ['collaborator', 'team', 'admin'],
    admin: ['admin', 'owner', 'permission', 'collaborator'],
    supabase: ['supabase', 'sync', 'save', 'database']
}

const SEARCH_STOP_WORDS = new Set([
    'a', 'an', 'and', 'are', 'can', 'do', 'for', 'from', 'go', 'how', 'i', 'in', 'is', 'me', 'my',
    'of', 'on', 'open', 'please', 'show', 'take', 'the', 'this', 'to', 'turn', 'up', 'where', 'with'
])

const getSearchTokenVariants = (token) => {
    const variants = [token, ...(SEARCH_TOKEN_ALIASES[token] || [])]
    if (token.length > 3 && token.endsWith('s')) variants.push(token.slice(0, -1))
    if (token.length > 3 && !token.endsWith('s')) variants.push(`${token}s`)
    return Array.from(new Set(variants))
}

export const settingsSearchTextMatches = (searchText, tokens = []) => (
    tokens.every(token => getSearchTokenVariants(token).some(variant => tokenMatchesSearchText(variant, searchText)))
)

const normalizeSearchText = (value = '') => String(value).toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim()

const getSearchTokens = (query = '') => (
    normalizeSearchText(query)
        .split(/\s+/)
        .filter(token => token && !SEARCH_STOP_WORDS.has(token))
)

const levenshteinDistance = (a = '', b = '') => {
    if (a === b) return 0
    if (!a) return b.length
    if (!b) return a.length
    const previous = Array.from({ length: b.length + 1 }, (_, index) => index)
    const current = new Array(b.length + 1)
    for (let i = 1; i <= a.length; i += 1) {
        current[0] = i
        for (let j = 1; j <= b.length; j += 1) {
            current[j] = Math.min(
                previous[j] + 1,
                current[j - 1] + 1,
                previous[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1)
            )
        }
        previous.splice(0, previous.length, ...current)
    }
    return previous[b.length]
}

const tokenMatchesWord = (token, word) => {
    if (!token || !word) return false
    if (word.includes(token) || token.includes(word)) return true
    if (token.length < 4 || word.length < 4) return false
    const distance = levenshteinDistance(token, word)
    return distance <= (token.length > 6 ? 2 : 1)
}

const tokenMatchesSearchText = (token, searchText) => {
    const normalizedText = normalizeSearchText(searchText)
    if (normalizedText.includes(token)) return true
    return normalizedText.split(/\s+/).some(word => tokenMatchesWord(token, word))
}

const scoreSettingsItem = (item, query, sections = SETTINGS_SECTIONS) => {
    const normalizedQuery = normalizeSearchText(query)
    const tokens = getSearchTokens(query)
    const section = sections.find(candidate => candidate.id === item.section)
    const label = normalizeSearchText(item.label)
    const sectionLabel = normalizeSearchText(section?.label)
    const searchText = buildSettingsSearchText(item, sections)
    const normalizedSearchText = normalizeSearchText(searchText)
    let score = 0

    if (label === normalizedQuery) score += 400
    if (sectionLabel === normalizedQuery) score += 260
    if (label.includes(normalizedQuery)) score += 220
    if (sectionLabel.includes(normalizedQuery)) score += 160
    if (normalizedSearchText.includes(normalizedQuery)) score += 90

    tokens.forEach((token) => {
        const variants = getSearchTokenVariants(token)
        const bestVariantScore = variants.reduce((best, variant) => {
            if (label.split(/\s+/).some(word => tokenMatchesWord(variant, word))) return Math.max(best, 80)
            if (sectionLabel.split(/\s+/).some(word => tokenMatchesWord(variant, word))) return Math.max(best, 55)
            if (tokenMatchesSearchText(variant, normalizedSearchText)) return Math.max(best, 30)
            return best
        }, 0)
        score += bestVariantScore
    })

    if (item.section === 'member_codes' && /member|code|qr|scan|pass|workspace/.test(normalizedQuery)) score += 45
    return score
}

export const searchSettingsIndex = (query, items = SETTINGS_SEARCH_INDEX, sections = SETTINGS_SECTIONS) => {
    const normalizedQuery = String(query || '').trim().toLowerCase()
    if (!normalizedQuery) return items
    const tokens = getSearchTokens(query)
    return items
        .map(item => ({
            item,
            score: scoreSettingsItem(item, query, sections),
            matchesAllTokens: tokens.every(token => getSearchTokenVariants(token).some(variant => tokenMatchesSearchText(variant, buildSettingsSearchText(item, sections))))
        }))
        .filter(result => result.score >= 55 || result.matchesAllTokens)
        .sort((a, b) => b.score - a.score)
        .map(result => result.item)
}
