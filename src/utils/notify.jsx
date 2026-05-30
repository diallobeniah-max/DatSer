import React from 'react'
import { toast } from 'react-toastify'
import NotificationToast from '../components/NotificationToast'

const toastByType = {
  success: toast.success,
  error: toast.error,
  warning: toast.warning,
  info: toast.info,
  offline: toast.warning,
  online: toast.success,
  sync: toast.info,
  update: toast.info
}

const defaultAutoCloseByType = {
  success: 1200,
  info: 1800,
  online: 1800,
  sync: 1800,
  warning: 2400,
  offline: 2600,
  update: 2600,
  error: 2600
}

const makeToastId = (type, title, message) => (
  `${type}:${title || ''}:${message || ''}`.toLowerCase().replace(/\s+/g, '-').slice(0, 140)
)

const notifyCard = (type, options = {}) => {
  const {
    title,
    message,
    details,
    actions,
    autoClose,
    persistent = false,
    toastId,
    dedupe = true,
    defaultExpanded = false
  } = options
  const toastFn = toastByType[type] || toast.info
  const resolvedToastId = toastId || (dedupe ? makeToastId(type, title, message) : undefined)

  return toastFn(
    <NotificationToast
      type={type}
      title={title}
      message={message}
      details={details}
      actions={actions}
      defaultExpanded={defaultExpanded}
    />,
    {
      toastId: resolvedToastId,
      autoClose: persistent ? false : (autoClose ?? defaultAutoCloseByType[type] ?? 3400),
      closeButton: false,
      className: 'datser-notification-shell',
      bodyClassName: 'datser-notification-body',
      progressClassName: `datser-notification-progress datser-notification-progress-${type}`
    }
  )
}

export const notify = {
  show: notifyCard,
  success: (message, options = {}) => notifyCard('success', { message, ...options }),
  error: (message, options = {}) => notifyCard('error', { message, ...options }),
  warning: (message, options = {}) => notifyCard('warning', { message, ...options }),
  info: (message, options = {}) => notifyCard('info', { message, ...options }),
  offline: (message, options = {}) => notifyCard('offline', { message, ...options }),
  online: (message, options = {}) => notifyCard('online', { message, ...options }),
  sync: (message, options = {}) => notifyCard('sync', { message, ...options }),
  update: (message, options = {}) => notifyCard('update', { message, ...options })
}

export default notify
