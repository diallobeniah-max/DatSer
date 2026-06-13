import React from 'react'

const STYLE_CONFIG = {
    coral: {
        className: 'border-orange-400/80 text-orange-50 shadow-[inset_0_1px_1px_rgba(255,255,255,0.28),inset_0_-12px_24px_rgba(69,10,10,0.32),0_0_20px_rgba(249,115,22,0.26)]',
        background: 'linear-gradient(135deg,#5b1716 0%,#aa3427 48%,#f9733d 100%)',
        lightBackground: 'linear-gradient(135deg,#fff7ed 0%,#fed7aa 48%,#fb923c 100%)',
        iconColor: '#fed7aa',
        lightIconColor: '#9a3412',
        lightTextColor: '#7c2d12',
        iconOpacity: 0.7,
        renderIcons: (color, opacity) => (
            <>
                <g className="member-code-badge-icon-left" opacity={opacity} stroke={color}>
                    <path d="M20 11v24M11 19h18" />
                    <path d="M20 35h-5M20 35h5" opacity="0.45" />
                </g>
                <g className="member-code-badge-sparkles" opacity="0.55" stroke={color}>
                    <path d="M48 12v6M45 15h6M103 12v6M100 15h6M44 32v4M42 34h4M112 31v5M109.5 33.5h5" />
                </g>
                <path className="member-code-badge-icon-right" opacity={opacity} stroke={color} d="M120 21c-3-5-10-2-10 3 0 6 10 11 10 11s10-5 10-11c0-5-7-8-10-3Z" />
            </>
        )
    },
    green: {
        className: 'border-lime-300/75 text-lime-50 shadow-[inset_0_1px_1px_rgba(255,255,255,0.22),inset_0_-12px_24px_rgba(20,83,45,0.34),0_0_22px_rgba(132,204,22,0.25)]',
        background: 'linear-gradient(135deg,#16351f 0%,#3f7f32 54%,#8ccf55 100%)',
        lightBackground: 'linear-gradient(135deg,#f0fdf4 0%,#bbf7d0 52%,#86efac 100%)',
        iconColor: '#d9f99d',
        lightIconColor: '#166534',
        lightTextColor: '#14532d',
        iconOpacity: 0.72,
        renderIcons: (color, opacity) => (
            <>
                <g className="member-code-badge-icon-left" opacity={opacity} stroke={color}>
                    <path d="M33 15c-11 1-18 7-20 18 9-2 17-6 24-13" />
                    <path d="M14 32c10 0 18-4 24-13" />
                    <path d="M31 14c-1 6 2 10 9 13" />
                    <path d="M28 22l-9-6" opacity="0.55" />
                </g>
                <g className="member-code-badge-icon-right" opacity={opacity} stroke={color}>
                    <path d="M112 31c5-7 10-12 17-16" />
                    <path d="M118 22c1-6 5-8 10-9-1 5-4 8-10 9Z" />
                    <path d="M116 28c-5 0-8 2-10 6 5 1 8-1 10-6Z" />
                </g>
                <g className="member-code-badge-sparkles" opacity="0.62" stroke={color}>
                    <path d="M49 11v7M45.5 14.5h7M128 33v7M124.5 36.5h7" />
                </g>
            </>
        )
    },
    crimson: {
        className: 'border-red-400/90 text-red-50 shadow-[inset_0_1px_1px_rgba(255,255,255,0.12),inset_0_-10px_22px_rgba(127,29,29,0.24),0_0_18px_rgba(239,68,68,0.23)]',
        background: 'linear-gradient(135deg,rgba(69,10,10,0.46) 0%,rgba(127,29,29,0.34) 52%,rgba(248,113,113,0.20) 100%)',
        lightBackground: 'linear-gradient(135deg,#fff1f2 0%,#fecdd3 52%,#fca5a5 100%)',
        iconColor: '#fca5a5',
        lightIconColor: '#991b1b',
        lightTextColor: '#7f1d1d',
        iconOpacity: 0.72,
        renderIcons: (color, opacity) => (
            <>
                <g className="member-code-badge-icon-left" opacity={opacity} stroke={color}>
                    <path d="M12 36h31" />
                    <path d="M15 36V22l11-9 11 9v14" />
                    <path d="M22 36V28h8v8" />
                    <path d="M26 9v10M22 13h8" />
                    <path d="M38 36V27l7 5v4" />
                </g>
                <g className="member-code-badge-sparkles" opacity="0.65" stroke={color}>
                    <path d="M112 11v8M108 15h8M125 27v6M122 30h6M101 21v4M99 23h4" />
                </g>
            </>
        )
    },
    magenta: {
        className: 'border-fuchsia-300/80 text-white shadow-[inset_0_1px_1px_rgba(255,255,255,0.24),inset_0_-12px_24px_rgba(88,28,135,0.30),0_0_22px_rgba(217,70,239,0.26)]',
        background: 'linear-gradient(135deg,#4c1d95 0%,#9d2db6 50%,#ec4899 100%)',
        lightBackground: 'linear-gradient(135deg,#faf5ff 0%,#e9d5ff 48%,#f0abfc 100%)',
        iconColor: '#f5d0fe',
        lightIconColor: '#86198f',
        lightTextColor: '#581c87',
        iconOpacity: 0.76,
        renderIcons: (color, opacity) => (
            <>
                <g className="member-code-badge-icon-left" opacity={opacity} stroke={color}>
                    <path d="M22 10v25" />
                    <path d="M22 10l18-4v22" />
                    <path d="M22 18l18-4" />
                    <path d="M17 34c0-3 2-5 5-5s5 2 5 5-2 5-5 5-5-2-5-5Z" />
                    <path d="M36 28c0-3 2-5 5-5s5 2 5 5-2 5-5 5-5-2-5-5Z" />
                </g>
                <g className="member-code-badge-icon-right" opacity={opacity} stroke={color}>
                    <path d="M111 15l16 4-5 22-16-4 5-22Z" />
                    <path d="M119 23v10M114 28h10" />
                    <path d="M109 18l-4-3" opacity="0.45" />
                </g>
                <g className="member-code-badge-sparkles" opacity="0.58" stroke={color}>
                    <path d="M51 12v6M48 15h6M132 12v5M129.5 14.5h5M101 35v5M98.5 37.5h5" />
                </g>
            </>
        )
    },
    amber: {
        className: 'border-amber-300/85 text-amber-50 shadow-[inset_0_1px_1px_rgba(255,255,255,0.28),inset_0_-12px_24px_rgba(120,53,15,0.34),0_0_22px_rgba(245,158,11,0.28)]',
        background: 'linear-gradient(135deg,#5b3708 0%,#a66d12 52%,#fbbf24 100%)',
        lightBackground: 'linear-gradient(135deg,#fffbeb 0%,#fde68a 52%,#fbbf24 100%)',
        iconColor: '#fde68a',
        lightIconColor: '#92400e',
        lightTextColor: '#713f12',
        iconOpacity: 0.78,
        renderIcons: (color, opacity) => (
            <>
                <g className="member-code-badge-icon-left" opacity={opacity} stroke={color}>
                    <path d="M21 33l-8-8 10-15" />
                    <path d="M32 33l8-8-10-15" />
                    <path d="M25 9v18" />
                    <path d="M28 9v18" />
                    <path d="M21 33l5.5 5 5.5-5" />
                </g>
                <path className="member-code-badge-icon-right" opacity="0.7" stroke={color} d="M111 16c7-4 15-4 22 0-2 4-20 4-22 0Z" />
                <g className="member-code-badge-sparkles" opacity="0.62" stroke={color}>
                    <path d="M48 10v6M45 13h6M121 32v7M117.5 35.5h7M133 23v5M130.5 25.5h5" />
                </g>
                <path opacity="0.6" stroke={color} d="M107 34c-2-3-7-1-7 3 0 3 7 7 7 7s7-4 7-7c0-4-5-6-7-3Z" />
            </>
        )
    }
}

const LEGACY_STYLE_KEYS = {
    auto: 'coral',
    soft: 'green',
    outline: 'crimson',
    solid: 'magenta',
    circle: 'amber'
}

const AUTO_STYLE_KEYS = ['coral', 'green', 'crimson', 'magenta', 'amber']

const normalizeBadgeStyleKey = (styleKey = 'green') => LEGACY_STYLE_KEYS[styleKey] || styleKey

const getBadgeStyle = (styleKey = 'green') => STYLE_CONFIG[normalizeBadgeStyleKey(styleKey)] || STYLE_CONFIG.green

const getStableMemberSeed = (value = '') => (
    String(value)
        .split('')
        .reduce((total, character) => total + character.charCodeAt(0), 0)
)

const getAutoBadgeStyleKey = ({ member, code, cycleSlot = 0 } = {}) => {
    const seedSource = member?.id || member?.full_name || member?.['Full Name'] || code || ''
    const seed = getStableMemberSeed(seedSource)
    return AUTO_STYLE_KEYS[(seed + cycleSlot) % AUTO_STYLE_KEYS.length]
}

const MemberCodeBadge = ({
    code,
    styleKey = 'soft',
    as: Component = 'span',
    className = '',
    style,
    children,
    ...props
}) => {
    const badgeStyle = getBadgeStyle(styleKey)
    const content = children ?? code

    return (
        <Component
            className={`member-code-designed-badge relative inline-flex h-9 min-w-[5.5rem] shrink-0 items-center justify-center overflow-hidden rounded-xl border px-5 text-center text-sm font-black tracking-wide ${badgeStyle.className} ${className}`}
            style={{
                '--member-code-badge-bg-dark': badgeStyle.background,
                '--member-code-badge-bg-light': badgeStyle.lightBackground || badgeStyle.background,
                '--member-code-badge-icon-dark': badgeStyle.iconColor,
                '--member-code-badge-icon-light': badgeStyle.lightIconColor || badgeStyle.iconColor,
                '--member-code-badge-text-light': badgeStyle.lightTextColor || '#111827',
                ...style
            }}
            {...props}
        >
            <svg
                className="pointer-events-none absolute inset-0 h-full w-full"
                viewBox="0 0 144 48"
                fill="none"
                aria-hidden="true"
            >
                <rect x="6" y="6" width="132" height="36" rx="10" fill="rgba(255,255,255,0.08)" />
                <rect x="7" y="7" width="130" height="34" rx="9" stroke="rgba(255,255,255,0.20)" />
                <rect x="52" y="8" width="40" height="32" rx="8" fill="rgba(0,0,0,0.10)" />
                <g strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" vectorEffect="non-scaling-stroke">
                    {badgeStyle.renderIcons('var(--member-code-badge-icon)', badgeStyle.iconOpacity)}
                </g>
            </svg>
            <span className="relative z-10 drop-shadow-[0_1px_3px_rgba(0,0,0,0.62)]">{content}</span>
        </Component>
    )
}

export { STYLE_CONFIG as MEMBER_CODE_BADGE_STYLES, AUTO_STYLE_KEYS, getAutoBadgeStyleKey, normalizeBadgeStyleKey }
export default MemberCodeBadge
