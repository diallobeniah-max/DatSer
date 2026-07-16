import React, { useState } from 'react'
import {
  AlertTriangle,
  Check,
  CheckCircle2,
  CloudOff,
  Download,
  Info,
  RefreshCw,
  Rocket,
  Wifi,
  X,
  XCircle
} from 'lucide-react'

const iconMap = {
  success: CheckCircle2,
  error: XCircle,
  warning: AlertTriangle,
  info: Info,
  offline: CloudOff,
  online: Wifi,
  sync: RefreshCw,
  update: Download,
  default: Rocket
}

const NotificationToast = ({
  type = 'info',
  title,
  message,
  details,
  actions = [],
  closeToast,
  defaultExpanded = false
}) => {
  const [expanded, setExpanded] = useState(defaultExpanded)
  const isClosingRef = React.useRef(false)
  const Icon = iconMap[type] || iconMap.default
  const hasExpandableContent = Boolean(details) || actions.length > 0
  const displayTitle = title || message
  const displayMessage = title ? message : details

  const closeWithAnimation = (event) => {
    event?.stopPropagation?.()
    if (isClosingRef.current) return
    isClosingRef.current = true
    closeToast?.()
  }

  return (
    <div
      className={`datser-notification-card datser-notification-${type} ${expanded ? 'is-expanded' : ''}`}
      role={type === 'error' || type === 'warning' ? 'alert' : 'status'}
      aria-live={type === 'error' || type === 'warning' ? 'assertive' : 'polite'}
      onClick={() => {
        if (hasExpandableContent) setExpanded(prev => !prev)
      }}
    >
      <div className="datser-notification-accent" />
      <div className="datser-notification-icon">
        <Icon className={type === 'sync' ? 'datser-notification-spinable' : ''} />
      </div>
      <div className="datser-notification-copy">
        <p className="datser-notification-title">{displayTitle}</p>
        {displayMessage && (
          <p className="datser-notification-message">{displayMessage}</p>
        )}
        {expanded && details && title && (
          <p className="datser-notification-details">{details}</p>
        )}
        {expanded && actions.length > 0 && (
          <div className="datser-notification-actions" onClick={(event) => event.stopPropagation()}>
            {actions.map((action) => (
              <button
                key={action.label}
                type="button"
                className={`datser-notification-action ${action.variant === 'primary' ? 'is-primary' : ''}`}
                onClick={async (event) => {
                  await action.onClick?.()
                  if (action.dismiss !== false) closeWithAnimation(event)
                }}
              >
                <span className="datser-notification-action-icon" aria-hidden="true">
                  {action.variant === 'primary' ? <Check /> : <X />}
                </span>
                {action.label}
              </button>
            ))}
          </div>
        )}
      </div>
      <button
        type="button"
        className="datser-notification-close"
        aria-label="Dismiss notification"
        onClick={closeWithAnimation}
      >
        <X aria-hidden="true" />
      </button>
    </div>
  )
}

export default NotificationToast

