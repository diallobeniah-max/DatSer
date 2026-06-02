import { useCallback, useEffect, useRef, useState } from 'react'

const DISMISS_DISTANCE = 120
const DISMISS_VELOCITY = 0.7

const isMobileSheet = () => {
  if (typeof window === 'undefined') return false
  // Increased threshold to 1024px to cover more tablets and large phones
  return window.matchMedia('(max-width: 1024px)').matches
}

const useBottomSheetDrag = ({ onDismiss, enabled = true, dismissDistance = DISMISS_DISTANCE, delegateDismissAnimation = false } = {}) => {
  const startYRef = useRef(0)
  const startTimeRef = useRef(0)
  const draggingRef = useRef(false)
  const useWindowListenersRef = useRef(false)
  const [dragY, setDragY] = useState(0)
  const [isDragging, setIsDragging] = useState(false)

  const resetDrag = useCallback(() => {
    draggingRef.current = false
    setIsDragging(false)
    setDragY(0)
  }, [])

  const startDrag = useCallback((clientY) => {
    draggingRef.current = true
    startYRef.current = clientY
    startTimeRef.current = performance.now()
    setIsDragging(true)
    setDragY(0)
  }, [])

  const updateDrag = useCallback((clientY) => {
    if (!draggingRef.current) return

    const deltaY = clientY - startYRef.current
    const resistedY = deltaY < 0 ? deltaY * 0.18 : deltaY
    setDragY(Math.max(-24, resistedY))
  }, [])

  const endDrag = useCallback((clientY) => {
    if (!draggingRef.current) return

    const deltaY = clientY - startYRef.current
    const elapsed = Math.max(1, performance.now() - startTimeRef.current)
    const velocity = deltaY / elapsed
    const shouldDismiss = deltaY > dismissDistance || velocity > DISMISS_VELOCITY

    draggingRef.current = false
    setIsDragging(false)

    if (shouldDismiss) {
      if (delegateDismissAnimation) {
        setDragY(typeof window !== 'undefined' ? window.innerHeight : 900)
        window.setTimeout(() => onDismiss?.({ viaDrag: true }), 260)
        return
      }
      setDragY(window.innerHeight)
      window.setTimeout(() => onDismiss?.({ viaDrag: true }), 260)
      return
    }

    setDragY(0)
  }, [delegateDismissAnimation, dismissDistance, onDismiss])

  const handlePointerDown = useCallback((event) => {
    if (!enabled || !isMobileSheet()) return
    if (event.pointerType === 'mouse' && event.button !== 0) return

    useWindowListenersRef.current = false
    startDrag(event.clientY)
    event.currentTarget.setPointerCapture?.(event.pointerId)
    event.preventDefault()
  }, [enabled, startDrag])

  const handlePointerMove = useCallback((event) => {
    if (!draggingRef.current) return
    updateDrag(event.clientY)
    event.preventDefault()
  }, [updateDrag])

  const handlePointerUp = useCallback((event) => {
    if (!draggingRef.current) return

    event.currentTarget.releasePointerCapture?.(event.pointerId)
    endDrag(event.clientY)
  }, [endDrag])

  const handlePointerCancel = useCallback((event) => {
    event.currentTarget.releasePointerCapture?.(event.pointerId)
    resetDrag()
  }, [resetDrag])

  const handleMouseDown = useCallback((event) => {
    if (!enabled || !isMobileSheet()) return
    if (event.button !== 0 || draggingRef.current) return

    useWindowListenersRef.current = true
    startDrag(event.clientY)
    event.preventDefault()
  }, [enabled, startDrag])

  const handleMouseMoveDirect = useCallback((event) => {
    if (!draggingRef.current) return
    updateDrag(event.clientY)
    event.preventDefault()
  }, [updateDrag])

  const handleMouseUpDirect = useCallback((event) => {
    if (!draggingRef.current) return
    endDrag(event.clientY)
    useWindowListenersRef.current = false
  }, [endDrag])

  const handleTouchStart = useCallback((event) => {
    if (!enabled || !isMobileSheet()) return
    const touch = event.touches?.[0]
    if (!touch || draggingRef.current) return

    useWindowListenersRef.current = true
    startDrag(touch.clientY)
    event.preventDefault()
  }, [enabled, startDrag])

  const handleTouchMoveDirect = useCallback((event) => {
    if (!draggingRef.current) return
    const touch = event.touches?.[0]
    if (!touch) return
    updateDrag(touch.clientY)
    event.preventDefault()
  }, [updateDrag])

  const handleTouchEndDirect = useCallback((event) => {
    if (!draggingRef.current) return
    const touch = event.changedTouches?.[0]
    endDrag(touch?.clientY ?? startYRef.current)
    useWindowListenersRef.current = false
  }, [endDrag])

  useEffect(() => {
    if (!isDragging || !useWindowListenersRef.current || typeof window === 'undefined') return undefined

    const handleMouseMove = (event) => {
      updateDrag(event.clientY)
      event.preventDefault()
    }
    const handleMouseUp = (event) => {
      endDrag(event.clientY)
      useWindowListenersRef.current = false
    }
    const handleTouchMove = (event) => {
      const touch = event.touches?.[0]
      if (!touch) return
      updateDrag(touch.clientY)
      event.preventDefault()
    }
    const handleTouchEnd = (event) => {
      const touch = event.changedTouches?.[0]
      endDrag(touch?.clientY ?? startYRef.current)
      useWindowListenersRef.current = false
    }

    window.addEventListener('mousemove', handleMouseMove, { passive: false })
    window.addEventListener('mouseup', handleMouseUp)
    window.addEventListener('touchmove', handleTouchMove, { passive: false })
    window.addEventListener('touchend', handleTouchEnd)
    window.addEventListener('touchcancel', handleTouchEnd)

    return () => {
      window.removeEventListener('mousemove', handleMouseMove)
      window.removeEventListener('mouseup', handleMouseUp)
      window.removeEventListener('touchmove', handleTouchMove)
      window.removeEventListener('touchend', handleTouchEnd)
      window.removeEventListener('touchcancel', handleTouchEnd)
    }
  }, [endDrag, isDragging, updateDrag])

  return {
    dragHandleProps: {
      onPointerDown: handlePointerDown,
      onPointerMove: handlePointerMove,
      onPointerUp: handlePointerUp,
      onPointerCancel: handlePointerCancel,
      onMouseDown: handleMouseDown,
      onMouseMove: handleMouseMoveDirect,
      onMouseUp: handleMouseUpDirect,
      onTouchStart: handleTouchStart,
      onTouchMove: handleTouchMoveDirect,
      onTouchEnd: handleTouchEndDirect,
      onTouchCancel: handleTouchEndDirect,
      style: { touchAction: 'none' } // Essential for preventing browser scroll interference
    },
    sheetStyle: {
      ...(dragY !== 0 ? { transform: `translateY(${dragY}px)` } : {}),
      transition: isDragging ? 'none' : 'transform 320ms cubic-bezier(0.22, 1, 0.36, 1)',
      willChange: 'transform'
    },
    isDragging,
    resetDrag
  }
}

export default useBottomSheetDrag
