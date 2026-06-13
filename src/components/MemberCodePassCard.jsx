import React, { useEffect, useRef } from 'react'

const LEGACY_CARD_STYLE_KEYS = {
    wave: 'glass',
    gradient: 'premium',
    classic: 'cosmic'
}

const CARD_STYLE_CONFIG = {
    glass: {
        label: 'Glass Button',
        shortLabel: 'Glass',
        effectName: 'Glass Button Effect',
        colorName: 'Coral Flame',
        description: 'Coral glass shine with warm edges',
        badgeStyleKey: 'coral',
        accentClass: 'member-code-pass-accent-coral',
        cardClass: 'member-code-pass-card-glass'
    },
    premium: {
        label: 'Ambient Glow',
        shortLabel: 'Glow',
        effectName: 'Premium Ambient Glow Effect',
        colorName: 'Purple Worship',
        description: 'Purple-magenta glow with soft motion',
        badgeStyleKey: 'magenta',
        accentClass: 'member-code-pass-accent-purple',
        cardClass: 'member-code-pass-card-premium'
    },
    neon: {
        label: 'Neon Dove',
        shortLabel: 'Neon',
        effectName: 'Futuristic Neon Effect',
        colorName: 'Green Dove',
        description: 'Green scanline border with gentle glow',
        badgeStyleKey: 'green',
        accentClass: 'member-code-pass-accent-green',
        cardClass: 'member-code-pass-card-neon'
    },
    cosmic: {
        label: 'Galaxy Prayer',
        shortLabel: 'Galaxy',
        effectName: 'Cosmic Galaxy Effect',
        colorName: 'Golden Prayer',
        description: 'Gold stars over deep cosmic purple',
        badgeStyleKey: 'amber',
        accentClass: 'member-code-pass-accent-gold',
        cardClass: 'member-code-pass-card-cosmic'
    }
}

const CARD_STYLE_ORDER = ['glass', 'premium', 'neon', 'cosmic']

const normalizeMemberCodeCardStyleKey = (styleKey = 'glass') => (
    CARD_STYLE_CONFIG[styleKey]
        ? styleKey
        : LEGACY_CARD_STYLE_KEYS[styleKey] || 'glass'
)

const getMemberCodeCardStyle = (styleKey = 'glass') => {
    const normalizedKey = normalizeMemberCodeCardStyleKey(styleKey)
    return {
        id: normalizedKey,
        ...CARD_STYLE_CONFIG[normalizedKey]
    }
}

const MEMBER_CODE_CARD_STYLE_OPTIONS = CARD_STYLE_ORDER.map((id) => ({
    id,
    ...CARD_STYLE_CONFIG[id]
}))

const MemberCodePassCard = ({
    styleKey = 'glass',
    className = '',
    children,
    compact = false,
    enableTilt = true,
    showStyleTitle = false,
    onPointerMove,
    onPointerLeave,
    style,
    ...props
}) => {
    const styleConfig = getMemberCodeCardStyle(styleKey)
    const cardRef = useRef(null)
    const tiltFrameRef = useRef(null)

    useEffect(() => () => {
        if (tiltFrameRef.current) window.cancelAnimationFrame(tiltFrameRef.current)
    }, [])

    const tiltCardTowardPointer = (event, { returning = false } = {}) => {
        if (!enableTilt || !cardRef.current) return

        if (returning) {
            if (tiltFrameRef.current) window.cancelAnimationFrame(tiltFrameRef.current)
            tiltFrameRef.current = window.requestAnimationFrame(() => {
                if (!cardRef.current) return
                cardRef.current.style.transition = 'transform 700ms cubic-bezier(0.16, 1, 0.3, 1)'
                cardRef.current.style.transform = 'perspective(1100px) rotateX(0deg) rotateY(0deg) scale3d(1, 1, 1)'
            })
            return
        }

        const rect = event.currentTarget.getBoundingClientRect()
        const x = event.clientX - rect.left
        const y = event.clientY - rect.top
        const isCoarsePointer = event.pointerType === 'touch' || event.pointerType === 'pen'
        const tiltStrength = isCoarsePointer ? 3.8 : 6.5
        const scale = isCoarsePointer ? 1.01 : 1.014
        const rotateX = ((y - rect.height / 2) / (rect.height / 2)) * -tiltStrength
        const rotateY = ((x - rect.width / 2) / (rect.width / 2)) * tiltStrength

        if (tiltFrameRef.current) window.cancelAnimationFrame(tiltFrameRef.current)
        tiltFrameRef.current = window.requestAnimationFrame(() => {
            if (!cardRef.current) return
            cardRef.current.style.transition = isCoarsePointer
                ? 'transform 180ms cubic-bezier(0.2, 0.8, 0.2, 1)'
                : 'transform 120ms cubic-bezier(0.2, 0.8, 0.2, 1)'
            cardRef.current.style.transform = `perspective(1100px) rotateX(${rotateX.toFixed(2)}deg) rotateY(${rotateY.toFixed(2)}deg) scale3d(${scale}, ${scale}, ${scale})`
        })
    }

    const handlePointerDown = (event) => {
        if (!enableTilt) return
        if (event.pointerType === 'touch' || event.pointerType === 'pen') {
            event.currentTarget.setPointerCapture?.(event.pointerId)
        }
        tiltCardTowardPointer(event)
    }

    const handlePointerMove = (event) => {
        onPointerMove?.(event)
        tiltCardTowardPointer(event)
    }

    const handlePointerLeave = (event) => {
        onPointerLeave?.(event)
        tiltCardTowardPointer(event, { returning: true })
    }

    return (
        <div
            ref={cardRef}
            className={`member-code-pass-card ${styleConfig.accentClass} ${styleConfig.cardClass} ${compact ? 'member-code-pass-card-compact' : ''} ${enableTilt ? 'member-code-pass-card-tilt' : ''} ${className}`}
            onPointerDown={handlePointerDown}
            onPointerMove={handlePointerMove}
            onPointerLeave={handlePointerLeave}
            onPointerCancel={(event) => tiltCardTowardPointer(event, { returning: true })}
            onPointerUp={(event) => tiltCardTowardPointer(event, { returning: true })}
            style={style}
            {...props}
        >
            <span className="member-code-pass-glass-shine" aria-hidden="true" />
            <span className="member-code-pass-blob member-code-pass-blob-one" aria-hidden="true" />
            <span className="member-code-pass-blob member-code-pass-blob-two" aria-hidden="true" />
            <span className="member-code-pass-inner-frame" aria-hidden="true" />
            <span className="member-code-pass-star-field" aria-hidden="true" />
            <svg className="member-code-pass-corner-pattern" viewBox="0 0 144 48" fill="none" aria-hidden="true">
                <rect x="7" y="7" width="130" height="34" rx="9" stroke="currentColor" opacity="0.28" />
                <rect x="52" y="8" width="40" height="32" rx="8" fill="currentColor" opacity="0.06" />
                <g stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" vectorEffect="non-scaling-stroke">
                    <path d="M20 11v24M11 19h18" opacity="0.32" />
                    <path d="M48 12v6M45 15h6M103 12v6M100 15h6M112 31v5M109.5 33.5h5" opacity="0.26" />
                    <path d="M120 21c-3-5-10-2-10 3 0 6 10 11 10 11s10-5 10-11c0-5-7-8-10-3Z" opacity="0.28" />
                </g>
            </svg>
            <div className="member-code-pass-content">
                {children}
                {showStyleTitle && (
                    <p className="member-code-pass-style-title">
                        {styleConfig.effectName} <span aria-hidden="true">&middot;</span> {styleConfig.colorName}
                    </p>
                )}
            </div>
        </div>
    )
}

export {
    MEMBER_CODE_CARD_STYLE_OPTIONS,
    getMemberCodeCardStyle,
    normalizeMemberCodeCardStyleKey
}

export default MemberCodePassCard
