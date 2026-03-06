import React, { useState, useMemo, useRef, useEffect } from 'react'
import {
    Search,
    ChevronDown,
    ChevronRight,
    ChevronLeft,
    ArrowLeft,
    HelpCircle,
    Users,
    Calendar,
    BarChart3,
    Settings,
    Play,
    ExternalLink,
    Sparkles,
    CheckCircle2,
    UserPlus,
    Edit3,
    Trash2,
    CalendarCheck,
    Filter,
    Download
} from 'lucide-react'

// FAQ Data organized by category
const faqData = [
    // Attendance Category
    {
        id: 1,
        category: 'attendance',
        question: 'How do I mark someone as present or absent?',
        answer: 'On the Dashboard, find the member you want to mark. You\'ll see "Present" (green) and "Absent" (red) buttons next to their name. Simply tap the appropriate button to record their attendance for the selected date.',
        quickAction: { type: 'navigate', label: 'Go to Dashboard', target: 'dashboard' },
        hasVideo: true
    },
    {
        id: 2,
        category: 'attendance',
        question: 'How do I change the attendance date?',
        answer: 'In the Dashboard header, you\'ll see the current date displayed. Tap on it to open the date picker, then select the Sunday you want to record attendance for. All attendance actions will apply to this selected date.',
        quickAction: { type: 'navigate', label: 'Go to Dashboard', target: 'dashboard' },
        hasVideo: true
    },
    {
        id: 3,
        category: 'attendance',
        question: 'Can I mark attendance for multiple people at once?',
        answer: 'Yes! Long-press on any member to enter selection mode. You\'ll see a green highlight appear. Then tap other members to select them. Once you\'ve selected everyone, use the "Present" or "Absent" buttons at the top to mark them all at once.',
        quickAction: null,
        hasVideo: true
    },
    {
        id: 4,
        category: 'attendance',
        question: 'What happens if I mark the wrong attendance?',
        answer: 'No worries! Just tap the opposite button to change it. For example, if you marked someone as Present but meant Absent, simply tap the "Absent" button to correct it. The change is saved immediately.',
        quickAction: null,
        hasVideo: false
    },

    // Members Category
    {
        id: 5,
        category: 'members',
        question: 'How do I add a new member?',
        answer: 'Go to the Dashboard and tap the "+" button or "Add Member" option from the menu. Fill in the member\'s name, gender, phone number, age, and current level. You can also assign tags like "Member", "Regular", or "Newcomer".',
        quickAction: { type: 'action', label: 'Add New Member', action: 'openAddMember' },
        hasVideo: true
    },
    {
        id: 6,
        category: 'members',
        question: 'How do I edit a member\'s information?',
        answer: 'Find the member on the Dashboard and tap their name to expand their card. You\'ll see an "Edit" button which opens the Edit Member modal. Here you can update their name, phone number, gender, age, level, and attendance records.',
        quickAction: { type: 'navigate', label: 'Go to Dashboard', target: 'dashboard' },
        hasVideo: true
    },
    {
        id: 7,
        category: 'members',
        question: 'How do I delete a member?',
        answer: 'Expand the member\'s card by tapping their name, then tap the "Delete" button (trash icon). You\'ll be asked to confirm before the member is permanently removed. Be careful - this action cannot be undone!',
        quickAction: null,
        hasVideo: false
    },
    {
        id: 8,
        category: 'members',
        question: 'What are member badges/tags?',
        answer: 'Badges help you categorize members. "Member" (blue) indicates official members, "Regular" (green) means they attend consistently, and "Newcomer" (amber) is for new attendees. You can filter by these badges using the filter options.',
        quickAction: null,
        hasVideo: false
    },

    // Navigation Category
    {
        id: 9,
        category: 'navigation',
        question: 'How do I switch between months?',
        answer: 'Look at the info bar below the search. You\'ll see the current month (e.g., "January 2025"). Tap on it to open the Month Picker popup. Select the month you want to view, and the data will update automatically.',
        quickAction: { type: 'action', label: 'Open Month Picker', action: 'openMonthPicker' },
        hasVideo: true
    },
    {
        id: 10,
        category: 'navigation',
        question: 'What is the difference between "All" and "Edited" tabs?',
        answer: '"All" shows every member in the database. "Edited" shows only members who have attendance recorded for any Sunday in the current month. Use "Edited" to quickly see who has been marked this month.',
        quickAction: null,
        hasVideo: false
    },
    {
        id: 11,
        category: 'navigation',
        question: 'How do I search for a member?',
        answer: 'Use the search bar at the top of the Dashboard. Type any part of the member\'s name and the list will filter in real-time. The search is case-insensitive and matches partial names.',
        quickAction: { type: 'navigate', label: 'Go to Dashboard', target: 'dashboard' },
        hasVideo: false
    },

    // Reports Category
    {
        id: 12,
        category: 'reports',
        question: 'How do I see attendance statistics?',
        answer: 'Go to the "Edited" tab to see members with attendance this month. Each member\'s card shows their attendance count. For detailed analytics, check the Statistics section in Settings.',
        quickAction: { type: 'navigate', label: 'View Edited Tab', target: 'edited' },
        hasVideo: true
    },
    {
        id: 13,
        category: 'reports',
        question: 'Can I export attendance data?',
        answer: 'Currently, attendance data is stored in your Supabase database. You can access and export it directly from your Supabase dashboard. Go to Table Editor, select your month\'s table, and use the export function.',
        quickAction: null,
        hasVideo: false
    },
    {
        id: 14,
        category: 'reports',
        question: 'How do I see who was absent on a specific Sunday?',
        answer: 'Select the date you want to check using the date picker. Then look at the "Edited" tab - members marked as Absent will have a red indicator. You can also use the filter to show only absent members.',
        quickAction: null,
        hasVideo: false
    },

    // Settings Category
    {
        id: 15,
        category: 'settings',
        question: 'How do I change my profile photo?',
        answer: 'Go to Settings and tap on your profile photo or the camera icon. You can either upload a photo from your device or choose an emoji as your avatar. Crop and adjust as needed, then save.',
        quickAction: { type: 'navigate', label: 'Go to Settings', target: 'settings' },
        hasVideo: true
    },
    {
        id: 16,
        category: 'settings',
        question: 'How do I switch between light and dark mode?',
        answer: 'The app automatically follows your device\'s system theme. To change it, adjust your device\'s display settings to Light or Dark mode, and the app will update accordingly.',
        quickAction: null,
        hasVideo: false
    },
    {
        id: 17,
        category: 'settings',
        question: 'How do I create a new month table?',
        answer: 'In Settings, look for "Create New Month" option. This creates a fresh table for a new month while keeping all your members. Attendance data starts fresh for the new month.',
        quickAction: { type: 'navigate', label: 'Go to Settings', target: 'settings' },
        hasVideo: true
    },
    {
        id: 18,
        category: 'settings',
        question: 'How do I sign out?',
        answer: 'Tap on your profile photo in the header to open the profile menu. At the bottom, you\'ll see a red "Sign Out" button. Tap it to log out of your account.',
        quickAction: null,
        hasVideo: false
    },

    // Filters Category
    {
        id: 19,
        category: 'filters',
        question: 'How do I filter members?',
        answer: 'Tap the Filter button (funnel icon) next to the search bar at the bottom. A filter panel will open where you can filter by Gender, Education Level, Ministry/Group, and Member Status (Members vs Visitors).',
        quickAction: { type: 'navigate', label: 'Go to Dashboard', target: 'dashboard' },
        hasVideo: false
    },
    {
        id: 20,
        category: 'filters',
        question: 'How do I clear all filters?',
        answer: 'In the Filter panel, tap the "Clear All" button at the bottom to remove all active filters. You can also tap individual filter buttons again to deselect them.',
        quickAction: null,
        hasVideo: false
    },
    {
        id: 21,
        category: 'filters',
        question: 'What is the Visitor filter?',
        answer: 'The Visitor filter lets you show only visitors (people marked as visiting) or only regular members. This helps you quickly see who are first-time attendees vs regular members.',
        quickAction: null,
        hasVideo: false
    },

    // Notes & Ministry Category
    {
        id: 22,
        category: 'members',
        question: 'How do I add notes to a member?',
        answer: 'When adding or editing a member, scroll down to find the "Notes" field. You can add any important information about the member here. Notes are displayed in a yellow box when you expand the member\'s card.',
        quickAction: null,
        hasVideo: false
    },
    {
        id: 23,
        category: 'members',
        question: 'How do I assign ministry tags to a member?',
        answer: 'When adding or editing a member, you\'ll see a "Ministry/Groups" section with buttons like Choir, Ushers, Youth, etc. Tap to select multiple ministries. These tags help you filter and organize members by their church roles.',
        quickAction: null,
        hasVideo: false
    },
    {
        id: 24,
        category: 'members',
        question: 'How do I mark someone as a visitor?',
        answer: 'When adding or editing a member, toggle the "Mark as Visitor" switch to ON. Visitors will show an amber "Visitor" badge on their card. You can filter to show only visitors using the Filter panel.',
        quickAction: null,
        hasVideo: false
    },
    {
        id: 25,
        category: 'members',
        question: 'How do I see a member\'s attendance history?',
        answer: 'Expand any member\'s card by tapping their name. Scroll down to see the "Attendance Summary" section which shows their total Present count, Absent count, and attendance rate percentage for the current month.',
        quickAction: null,
        hasVideo: false
    },

    // Admin Panel Category
    {
        id: 26,
        category: 'admin',
        question: 'How do I access the Admin Panel?',
        answer: 'Go to Settings and tap "Admin Panel". You\'ll need to enter your account password (the same one you use to sign in) to access admin features. This adds an extra layer of security.',
        quickAction: { type: 'navigate', label: 'Go to Settings', target: 'settings' },
        hasVideo: false
    },
    {
        id: 27,
        category: 'admin',
        question: 'What is the "Stay logged in" option in Admin Panel?',
        answer: 'When logging into the Admin Panel, check "Stay logged in" to keep your admin access for 7 days. Without this, you\'ll be automatically locked out after 15 minutes of inactivity for security.',
        quickAction: null,
        hasVideo: false
    },
    {
        id: 28,
        category: 'admin',
        question: 'How do I print an attendance sheet?',
        answer: 'In the Admin Panel, tap "Print Attendance Sheet". A new window opens with an editable preview. You can adjust font size, table style, toggle columns, and edit titles before printing. Click "Print" when ready.',
        quickAction: null,
        hasVideo: false
    },
    {
        id: 29,
        category: 'admin',
        question: 'How do I manage ministry/group tags?',
        answer: 'In the Admin Panel, find the "Ministry/Groups" section. Here you can add new ministries, edit existing ones (hover and click pencil), or delete them (hover and click trash). Changes sync across the app instantly.',
        quickAction: null,
        hasVideo: false
    },
    {
        id: 30,
        category: 'admin',
        question: 'What is badge processing?',
        answer: 'Badge processing automatically assigns badges (Member, Regular, Newcomer) based on attendance patterns. It requires all Sundays in the month to be marked. Members with 2+ Sundays get "Member", those with 3+ consecutive get "Regular".',
        quickAction: null,
        hasVideo: false
    },
    {
        id: 31,
        category: 'admin',
        question: 'How do I lock the Admin Panel?',
        answer: 'Click the red "Lock" button in the Admin Panel header. This immediately locks the panel and requires your password to re-enter. The panel also auto-locks after 15 minutes of inactivity (unless "Stay logged in" is checked).',
        quickAction: null,
        hasVideo: false
    }
]

const categories = [
    { id: 'all', label: 'All', icon: HelpCircle },
    { id: 'attendance', label: 'Attendance', icon: CalendarCheck },
    { id: 'members', label: 'Members', icon: Users },
    { id: 'filters', label: 'Filters', icon: Filter },
    { id: 'admin', label: 'Admin', icon: Settings },
    { id: 'navigation', label: 'Navigation', icon: Calendar },
    { id: 'reports', label: 'Reports', icon: BarChart3 },
    { id: 'settings', label: 'Settings', icon: Settings }
]

const getCategoryIcon = (categoryId) => {
    switch (categoryId) {
        case 'attendance': return CalendarCheck
        case 'members': return Users
        case 'filters': return Filter
        case 'admin': return Settings
        case 'navigation': return Calendar
        case 'reports': return BarChart3
        case 'settings': return Settings
        default: return HelpCircle
    }
}

const HelpCenterPage = ({ onBack, onNavigate }) => {
    const [searchQuery, setSearchQuery] = useState('')
    const [selectedCategory, setSelectedCategory] = useState('all')
    const [expandedQuestions, setExpandedQuestions] = useState(new Set())
    const tabsContainerRef = useRef(null)
    const [canScrollLeft, setCanScrollLeft] = useState(false)
    const [canScrollRight, setCanScrollRight] = useState(false)

    // Check scroll position to show/hide arrow buttons
    const checkScrollPosition = () => {
        const container = tabsContainerRef.current
        if (!container) return
        
        const { scrollLeft, scrollWidth, clientWidth } = container
        setCanScrollLeft(scrollLeft > 0)
        setCanScrollRight(scrollLeft < scrollWidth - clientWidth - 5)
    }

    useEffect(() => {
        checkScrollPosition()
        const container = tabsContainerRef.current
        if (container) {
            container.addEventListener('scroll', checkScrollPosition)
            window.addEventListener('resize', checkScrollPosition)
        }
        return () => {
            if (container) {
                container.removeEventListener('scroll', checkScrollPosition)
            }
            window.removeEventListener('resize', checkScrollPosition)
        }
    }, [])

    const scrollTabs = (direction) => {
        const container = tabsContainerRef.current
        if (!container) return
        const scrollAmount = 200
        container.scrollBy({
            left: direction === 'left' ? -scrollAmount : scrollAmount,
            behavior: 'smooth'
        })
    }

    // Filter FAQs based on search and category
    const filteredFaqs = useMemo(() => {
        return faqData.filter(faq => {
            const matchesCategory = selectedCategory === 'all' || faq.category === selectedCategory
            const matchesSearch = searchQuery === '' ||
                faq.question.toLowerCase().includes(searchQuery.toLowerCase()) ||
                faq.answer.toLowerCase().includes(searchQuery.toLowerCase())
            return matchesCategory && matchesSearch
        })
    }, [searchQuery, selectedCategory])

    const toggleQuestion = (id) => {
        setExpandedQuestions(prev => {
            const newSet = new Set(prev)
            if (newSet.has(id)) {
                newSet.delete(id)
            } else {
                newSet.add(id)
            }
            return newSet
        })
    }

    const handleQuickAction = (action) => {
        if (!action) return

        if (action.type === 'navigate') {
            onNavigate?.(action.target)
        } else if (action.type === 'action') {
            // Handle specific actions
            if (action.action === 'openAddMember') {
                onNavigate?.('dashboard', { openModal: 'addMember' })
            } else if (action.action === 'openMonthPicker') {
                onNavigate?.('dashboard', { openModal: 'monthPicker' })
            }
        }
    }

    return (
        <div className="min-h-screen bg-gray-50 dark:bg-gray-900">
            {/* Header */}
            <div className="fixed top-[76px] md:top-[48px] left-0 right-0 z-50 bg-white/95 dark:bg-gray-800/95 backdrop-blur-md border-b border-gray-200 dark:border-gray-700">
                <div className="max-w-4xl mx-auto px-4 py-4">
                    <div className="flex items-center gap-4">
                        <button
                            onClick={onBack}
                            className="p-2 hover:bg-gray-100 dark:hover:bg-gray-700 rounded-xl transition-colors btn-press"
                        >
                            <ArrowLeft className="w-5 h-5 text-gray-600 dark:text-gray-300" />
                        </button>
                        <div>
                            <h1 className="text-xl font-bold text-gray-900 dark:text-white flex items-center gap-2">
                                <HelpCircle className="w-5 h-5 text-orange-500" />
                                Help Center
                            </h1>
                            <p className="text-sm text-gray-500 dark:text-gray-400">
                                Find answers to common questions
                            </p>
                        </div>
                    </div>
                </div>
            </div>

            <div className="max-w-4xl mx-auto px-4 pt-[104px] md:pt-[112px] pb-6 space-y-6">
                {/* Search Bar */}
                <div className="relative animate-fade-in-up">
                    <Search className="absolute left-4 top-1/2 -translate-y-1/2 w-5 h-5 text-gray-400" />
                    <input
                        type="text"
                        placeholder="Search questions..."
                        value={searchQuery}
                        onChange={(e) => setSearchQuery(e.target.value)}
                        className="w-full pl-12 pr-4 py-3.5 rounded-2xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 text-gray-900 dark:text-white placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-orange-500 focus:border-transparent shadow-sm transition-all input-focus"
                    />
                    {searchQuery && (
                        <button
                            onClick={() => setSearchQuery('')}
                            className="absolute right-4 top-1/2 -translate-y-1/2 text-xs text-gray-400 hover:text-gray-600 dark:hover:text-gray-300"
                        >
                            Clear
                        </button>
                    )}
                </div>

                {/* Category Tabs with Arrow Navigation */}
                <div className="relative animate-fade-in-up" style={{ animationDelay: '50ms' }}>
                    {/* Left Arrow */}
                    {canScrollLeft && (
                        <button
                            onClick={() => scrollTabs('left')}
                            className="absolute left-0 top-1/2 -translate-y-1/2 z-10 w-8 h-8 flex items-center justify-center bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-full shadow-lg hover:bg-gray-50 dark:hover:bg-gray-700 transition-all"
                            aria-label="Scroll left"
                        >
                            <ChevronLeft className="w-4 h-4 text-gray-600 dark:text-gray-300" />
                        </button>
                    )}
                    
                    {/* Tabs Container */}
                    <div 
                        ref={tabsContainerRef}
                        className={`flex gap-2 overflow-x-auto pb-2 scrollbar-hide scroll-smooth ${canScrollLeft ? 'pl-10' : ''} ${canScrollRight ? 'pr-10' : ''}`}
                    >
                        {categories.map((cat) => {
                            const Icon = cat.icon
                            const isActive = selectedCategory === cat.id
                            return (
                                <button
                                    key={cat.id}
                                    onClick={() => setSelectedCategory(cat.id)}
                                    className={`flex items-center gap-2 px-4 py-2 rounded-full text-sm font-medium whitespace-nowrap transition-all btn-press ${isActive
                                        ? 'bg-orange-500 text-white shadow-lg shadow-orange-500/25'
                                        : 'bg-white dark:bg-gray-800 text-gray-600 dark:text-gray-300 border border-gray-200 dark:border-gray-700 hover:bg-gray-50 dark:hover:bg-gray-700'
                                        }`}
                                >
                                    <Icon className="w-4 h-4" />
                                    {cat.label}
                                </button>
                            )
                        })}
                    </div>

                    {/* Right Arrow */}
                    {canScrollRight && (
                        <button
                            onClick={() => scrollTabs('right')}
                            className="absolute right-0 top-1/2 -translate-y-1/2 z-10 w-8 h-8 flex items-center justify-center bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-full shadow-lg hover:bg-gray-50 dark:hover:bg-gray-700 transition-all"
                            aria-label="Scroll right"
                        >
                            <ChevronRight className="w-4 h-4 text-gray-600 dark:text-gray-300" />
                        </button>
                    )}
                </div>

                {/* Results Count */}
                <div className="flex items-center justify-between text-sm animate-fade-in">
                    <span className="text-gray-500 dark:text-gray-400">
                        {filteredFaqs.length} {filteredFaqs.length === 1 ? 'question' : 'questions'} found
                    </span>
                    {searchQuery && (
                        <span className="text-orange-500">
                            Searching for "{searchQuery}"
                        </span>
                    )}
                </div>

                {/* FAQ List */}
                <div className="space-y-3">
                    {filteredFaqs.map((faq, index) => {
                        const isExpanded = expandedQuestions.has(faq.id)
                        const CategoryIcon = getCategoryIcon(faq.category)

                        return (
                            <div
                                key={faq.id}
                                className="bg-white dark:bg-gray-800 rounded-2xl border border-gray-200 dark:border-gray-700 overflow-hidden shadow-sm hover:shadow-md transition-all card-hover animate-fade-in-up"
                                style={{ animationDelay: `${index * 30}ms` }}
                            >
                                {/* Question Header */}
                                <button
                                    onClick={() => toggleQuestion(faq.id)}
                                    className="w-full flex items-start gap-4 p-4 text-left transition-colors hover:bg-gray-50 dark:hover:bg-gray-700/50"
                                >
                                    <div className={`p-2 rounded-xl flex-shrink-0 ${isExpanded
                                        ? 'bg-orange-100 dark:bg-orange-900/30'
                                        : 'bg-gray-100 dark:bg-gray-700'
                                        }`}>
                                        <CategoryIcon className={`w-5 h-5 ${isExpanded
                                            ? 'text-orange-600 dark:text-orange-400'
                                            : 'text-gray-500 dark:text-gray-400'
                                            }`} />
                                    </div>
                                    <div className="flex-1 min-w-0">
                                        <h3 className="font-medium text-gray-900 dark:text-white text-left">
                                            {faq.question}
                                        </h3>
                                        <p className="text-xs text-gray-400 mt-1 capitalize">
                                            {faq.category}
                                        </p>
                                    </div>
                                    <div className={`p-1 transition-transform flex-shrink-0 ${isExpanded ? 'rotate-180' : ''}`}>
                                        <ChevronDown className="w-5 h-5 text-gray-400" />
                                    </div>
                                </button>

                                {/* Answer Content */}
                                {isExpanded && (
                                    <div className="px-4 pb-4 pt-0 animate-fade-in">
                                        <div className="pl-14 space-y-4">
                                            {/* Answer Text */}
                                            <p className="text-gray-600 dark:text-gray-300 text-sm leading-relaxed">
                                                {faq.answer}
                                            </p>

                                            {/* Video Placeholder */}
                                            {faq.hasVideo && (
                                                <div className="relative overflow-hidden rounded-xl aspect-video bg-gradient-to-br from-gray-100 to-gray-200 dark:from-gray-700 dark:to-gray-800">
                                                    {/* Blurred Background */}
                                                    <div className="absolute inset-0 backdrop-blur-sm bg-gray-900/30 flex flex-col items-center justify-center gap-3">
                                                        <div className="w-16 h-16 rounded-full bg-white/20 backdrop-blur-md flex items-center justify-center border border-white/30">
                                                            <Play className="w-8 h-8 text-white ml-1" />
                                                        </div>
                                                        <div className="text-center">
                                                            <p className="text-white font-medium text-sm">Video Tutorial</p>
                                                            <div className="flex items-center gap-1.5 mt-1">
                                                                <Sparkles className="w-3.5 h-3.5 text-amber-400" />
                                                                <span className="text-xs text-white/80">Coming Soon</span>
                                                            </div>
                                                        </div>
                                                    </div>
                                                    {/* Decorative Elements */}
                                                    <div className="absolute top-4 left-4 w-20 h-3 bg-white/20 rounded-full" />
                                                    <div className="absolute top-4 right-4 w-8 h-8 bg-white/20 rounded-lg" />
                                                    <div className="absolute bottom-4 left-4 right-4 h-2 bg-white/20 rounded-full" />
                                                </div>
                                            )}

                                            {/* Quick Action Button */}
                                            {faq.quickAction && (
                                                <button
                                                    onClick={() => handleQuickAction(faq.quickAction)}
                                                    className="inline-flex items-center gap-2 px-4 py-2 bg-orange-50 dark:bg-orange-900/30 text-orange-600 dark:text-orange-400 rounded-xl text-sm font-medium hover:bg-orange-100 dark:hover:bg-orange-900/50 transition-colors btn-press"
                                                >
                                                    <ExternalLink className="w-4 h-4" />
                                                    {faq.quickAction.label}
                                                </button>
                                            )}
                                        </div>
                                    </div>
                                )}
                            </div>
                        )
                    })}
                </div>

                {/* No Results */}
                {filteredFaqs.length === 0 && (
                    <div className="text-center py-16 animate-fade-in">
                        <div className="w-16 h-16 rounded-full bg-gray-100 dark:bg-gray-800 flex items-center justify-center mx-auto mb-4">
                            <Search className="w-8 h-8 text-gray-400" />
                        </div>
                        <h3 className="text-lg font-medium text-gray-900 dark:text-white mb-2">
                            No questions found
                        </h3>
                        <p className="text-gray-500 dark:text-gray-400 text-sm max-w-sm mx-auto">
                            Try adjusting your search or browse a different category
                        </p>
                        <button
                            onClick={() => {
                                setSearchQuery('')
                                setSelectedCategory('all')
                            }}
                            className="mt-4 px-4 py-2 text-orange-500 hover:bg-orange-50 dark:hover:bg-orange-900/20 rounded-lg text-sm font-medium transition-colors btn-press"
                        >
                            Clear filters
                        </button>
                    </div>
                )}

                {/* Footer */}
                <div className="text-center py-8 border-t border-gray-200 dark:border-gray-700 mt-8">
                    <p className="text-sm text-gray-500 dark:text-gray-400 mb-3">
                        Can't find what you're looking for?
                    </p>
                    <div className="flex items-center justify-center gap-2 text-orange-500">
                        <CheckCircle2 className="w-4 h-4" />
                        <span className="text-sm font-medium">More help coming soon</span>
                    </div>
                </div>
            </div>
        </div>
    )
}

export default HelpCenterPage
