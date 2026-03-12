import { useRef, useState } from 'react'

/**
 * Custom hook for long-press multi-selection with green highlighting
 * Works with both touch (mobile) and mouse (desktop) events
 * @param {Function} onSelectionChange - Callback when selection changes
 * @returns {Object} Hook state and handlers
 */
export const useLongPressSelection = (onSelectionChange) => {
    const [selectionMode, setSelectionMode] = useState(false)
    const [selectedIds, setSelectedIds] = useState(new Set())
    const longPressTimerRef = useRef(null)
    const startPosRef = useRef(null)
    const isMouseDownRef = useRef(false)

    const startLongPress = (id, clientX, clientY) => {
        if (selectionMode) return

        startPosRef.current = { x: clientX, y: clientY }

        longPressTimerRef.current = setTimeout(() => {
            setSelectionMode(true)
            setSelectedIds(prev => {
                const next = new Set(prev)
                next.add(id)
                if (onSelectionChange) onSelectionChange(next)
                return next
            })
            if (navigator.vibrate) navigator.vibrate(50)
        }, 1000)
    }

    const handleLongPressStart = (id, e) => {
        // Prevent context menu on long press when it's safe to do so
        try {
            if (e && e.cancelable) e.preventDefault()
        } catch (err) {
            // ignore
        }

        // Handle touch events
        if (e.touches && e.touches.length > 0) {
            startLongPress(id, e.touches[0].clientX, e.touches[0].clientY)
        }
        // Handle mouse events
        else if (e.button === 2 || (e.button === 0 && e.ctrlKey)) {
            // Right-click or Ctrl+Click for desktop long-press
            startLongPress(id, e.clientX, e.clientY)
        }
    }

    // Also add mouse down handler for left-click long-press
    const handleMouseDown = (id, e) => {
        if (e.button !== 0) return // Only left mouse button
        try { if (e && e.cancelable) e.preventDefault() } catch (err) { /* ignore */ }
        isMouseDownRef.current = true
        startLongPress(id, e.clientX, e.clientY)
    }

    const handleMouseUp = () => {
        isMouseDownRef.current = false
        if (longPressTimerRef.current) {
            clearTimeout(longPressTimerRef.current)
            longPressTimerRef.current = null
        }
    }

    const handleLongPressMove = (e) => {
        if (!startPosRef.current || !longPressTimerRef.current) return

        const currentX = e.touches?.[0]?.clientX ?? e.clientX ?? 0
        const currentY = e.touches?.[0]?.clientY ?? e.clientY ?? 0
        const deltaX = Math.abs(currentX - startPosRef.current.x)
        const deltaY = Math.abs(currentY - startPosRef.current.y)

        // Cancel long-press if moved more than 10px
        if (deltaX > 10 || deltaY > 10) {
            clearTimeout(longPressTimerRef.current)
            longPressTimerRef.current = null
        }
    }

    const handleLongPressEnd = () => {
        if (longPressTimerRef.current) {
            clearTimeout(longPressTimerRef.current)
            longPressTimerRef.current = null
        }
        startPosRef.current = null
        isMouseDownRef.current = false
    }

    const toggleSelection = (id) => {
        if (!selectionMode) return

        setSelectedIds(prev => {
            const next = new Set(prev)
            if (next.has(id)) {
                next.delete(id)
                if (next.size === 0) {
                    setSelectionMode(false)
                }
            } else {
                next.add(id)
            }
            if (onSelectionChange) onSelectionChange(next)
            return next
        })
    }

    const clearSelection = () => {
        setSelectedIds(new Set())
        setSelectionMode(false)
        if (onSelectionChange) onSelectionChange(new Set())
    }

    return {
        selectionMode,
        selectedIds,
        handleLongPressStart,
        handleLongPressMove,
        handleLongPressEnd,
        handleMouseDown,
        handleMouseUp,
        toggleSelection,
        clearSelection,
        setSelectedIds
    }
}
