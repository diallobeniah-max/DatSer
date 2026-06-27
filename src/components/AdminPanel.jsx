import React, { useState, useEffect, useMemo, useCallback } from 'react'
import { useApp } from '../context/AppContext'
import { useTheme } from '../context/ThemeContext'
import { useAuth } from '../context/AuthContext'
import { supabase } from '../lib/supabase'
import { toast } from 'react-toastify'
import {
  Users,
  Calendar,
  Award,
  Tag,
  TrendingUp,
  CheckCircle2,
  XCircle,
  Clock,
  ChevronDown,
  ChevronUp,
  Sparkles,
  Trophy,
  ArrowRight,
  RefreshCw,
  Check,
  X,
  AlertTriangle,
  Star,
  Printer,
  Download,
  LogOut,
  Shield,
  Lock,
  LogIn,
  ArrowLeft,
  Phone,
  MessageCircle,
  Mail,
  Send,
  UserCheck,
  UserX
} from 'lucide-react'
import TagManager from './TagManager'
import AppUpdatesManager from './AppUpdatesManager'
import ApkBuildManager from './ApkBuildManager'
import {
  DEFAULT_FOLLOW_UP_TEMPLATE,
  FOLLOW_UP_STAGES,
  FOLLOW_UP_TABS,
  buildSuggestedMessage,
  calculateAttendanceFollowUps
} from '../utils/attendanceFollowUp'
import { DEV_BYPASS_STORAGE_KEY, isLocalWebDeveloperModeAllowed } from '../utils/developerMode'

const getDevAdminPassword = () => (
  import.meta.env.DEV && isLocalWebDeveloperModeAllowed()
    ? String.fromCharCode(76, 111, 97, 100, 32, 109, 101, 32, 105, 110)
    : ''
)

const isLocalDeveloperBypassActive = () => (
  isLocalWebDeveloperModeAllowed() &&
  typeof window !== 'undefined' &&
  window.localStorage.getItem(DEV_BYPASS_STORAGE_KEY) === 'true'
)

const normalizeSundayDate = (dateValue) => {
  if (dateValue instanceof Date) {
    const y = dateValue.getFullYear()
    const m = String(dateValue.getMonth() + 1).padStart(2, '0')
    const d = String(dateValue.getDate()).padStart(2, '0')
    return `${y}-${m}-${d}`
  }
  return dateValue
}

const getMemberName = (member) => member?.full_name || member?.['Full Name'] || member?.name || 'Unknown'
const getMemberPhone = (member) => member?.['Phone Number'] || member?.phone_number || member?.phone || member?.Phone || ''
const getMemberEmail = (member) => member?.email || member?.Email || member?.email_address || member?.['Email Address'] || ''
const cleanPhoneDigits = (phone) => String(phone || '').replace(/[^\d+]/g, '').replace(/(?!^)\+/g, '')
const getWhatsAppDigits = (phone) => {
  const cleaned = cleanPhoneDigits(phone).replace(/^\+/, '')
  return cleaned.startsWith('0') ? `233${cleaned.slice(1)}` : cleaned
}

const AdminPanel = ({ setCurrentView, onBack }) => {
  const {
    members,
    currentTable,
    attendanceData,
    availableSundayDates,
    isMonthAttendanceComplete,
    updateMember,
    calculateAttendanceRate,
    isCollaborator,
    isAdminCollaborator,
    isDeveloperBypass,
    dataOwnerId,
    isSupabaseConfigured
  } = useApp()
  const { isDarkMode } = useTheme()
  const { user, signInWithGoogle } = useAuth()
  const hasDeveloperAdminBypass = isLocalWebDeveloperModeAllowed() && (isDeveloperBypass || isLocalDeveloperBypassActive())

  // Admin password protection - uses the same password as user's account
  const [isAuthenticated, setIsAuthenticated] = useState(() => {
    // Check localStorage first (stay logged in), then sessionStorage
    const stayLoggedIn = localStorage.getItem('adminStayLoggedIn') === 'true'
    if (stayLoggedIn) {
      const expiry = localStorage.getItem('adminAuthExpiry')
      if (expiry && new Date().getTime() < parseInt(expiry)) {
        return true
      }
      // Expired, clear it
      localStorage.removeItem('adminStayLoggedIn')
      localStorage.removeItem('adminAuthExpiry')
    }
    return sessionStorage.getItem('adminAuthenticated') === 'true'
  })
  const [passwordInput, setPasswordInput] = useState(() => hasDeveloperAdminBypass ? getDevAdminPassword() : '')
  const [passwordError, setPasswordError] = useState(false)
  const [isVerifying, setIsVerifying] = useState(false)
  const [stayLoggedIn, setStayLoggedIn] = useState(false)
  const [lastActivity, setLastActivity] = useState(Date.now())
  const AUTO_LOCK_MINUTES = 15 // Auto-lock after 15 minutes of inactivity
  const [isGoogleAuthing, setIsGoogleAuthing] = useState(false)
  const [showOverview, setShowOverview] = useState(false)
  const [followUpMessage, setFollowUpMessage] = useState(DEFAULT_FOLLOW_UP_TEMPLATE)
  const [activeFollowUpTab, setActiveFollowUpTab] = useState('follow_up')
  const [followUpRecords, setFollowUpRecords] = useState([])
  const [isSavingFollowUp, setIsSavingFollowUp] = useState(false)
  const [selectedFollowUpRecord, setSelectedFollowUpRecord] = useState(null)
  const [followUpDraftMessage, setFollowUpDraftMessage] = useState('')
  const followUpOwnerId = dataOwnerId || user?.id
  const followUpStorageKey = useMemo(
    () => `datser_follow_up_records_${followUpOwnerId || 'local'}`,
    [followUpOwnerId]
  )

  useEffect(() => {
    if (hasDeveloperAdminBypass && !isAuthenticated) {
      setPasswordInput(getDevAdminPassword())
    }
  }, [hasDeveloperAdminBypass, isAuthenticated])

  const readLocalFollowUpRecords = useCallback(() => {
    try {
      return JSON.parse(localStorage.getItem(followUpStorageKey) || '[]')
    } catch {
      return []
    }
  }, [followUpStorageKey])

  const writeLocalFollowUpRecord = useCallback((entry) => {
    const next = [entry, ...readLocalFollowUpRecords()].slice(0, 500)
    localStorage.setItem(followUpStorageKey, JSON.stringify(next))
    setFollowUpRecords(next)
  }, [followUpStorageKey, readLocalFollowUpRecords])

  // Auto-lock timer - locks admin panel after inactivity
  useEffect(() => {
    if (!isAuthenticated) return

    const checkInactivity = () => {
      const stayLoggedInEnabled = localStorage.getItem('adminStayLoggedIn') === 'true'
      if (stayLoggedInEnabled) return // Don't auto-lock if stay logged in is enabled

      const inactiveTime = Date.now() - lastActivity
      if (inactiveTime > AUTO_LOCK_MINUTES * 60 * 1000) {
        handleAdminLogout()
        toast.info('Admin session expired due to inactivity')
      }
    }

    const interval = setInterval(checkInactivity, 60000) // Check every minute
    return () => clearInterval(interval)
  }, [isAuthenticated, lastActivity])

  // Track user activity
  useEffect(() => {
    if (!isAuthenticated) return

    const updateActivity = () => setLastActivity(Date.now())
    window.addEventListener('mousemove', updateActivity)
    window.addEventListener('keydown', updateActivity)
    window.addEventListener('click', updateActivity)

    return () => {
      window.removeEventListener('mousemove', updateActivity)
      window.removeEventListener('keydown', updateActivity)
      window.removeEventListener('click', updateActivity)
    }
  }, [isAuthenticated])

  const loadFollowUpRecords = useCallback(async () => {
    if (!isAuthenticated || !followUpOwnerId || !isSupabaseConfigured() || !supabase) {
      setFollowUpRecords(readLocalFollowUpRecords())
      return
    }

    try {
      const { data, error } = await supabase.rpc('get_follow_up_records', {
        p_owner_id: followUpOwnerId
      })

      if (error) throw error
      setFollowUpRecords(Array.isArray(data) ? data : [])
    } catch (error) {
      const message = error?.message || ''
      const backendMissing =
        error?.code === '42883' ||
        error?.code === '42P01' ||
        message.includes('get_follow_up_records') ||
        message.includes('follow_up_records')

      if (backendMissing) {
        setFollowUpRecords(readLocalFollowUpRecords())
        return
      }

      console.warn('Failed to load follow-up records:', error)
    }
  }, [followUpOwnerId, isAuthenticated, isSupabaseConfigured, readLocalFollowUpRecords])

  useEffect(() => {
    loadFollowUpRecords()
  }, [loadFollowUpRecords])

  const saveFollowUpStage = async (record, stage, contactMethod = 'admin', response = '') => {
    if (!record?.id) return
    const localEntry = {
      id: `local-${record.id}-${Date.now()}`,
      owner_id: followUpOwnerId || 'local',
      member_id: record.id,
      reason: record.followUpReason,
      follow_up_status: stage,
      message_sent: stage === 'message_sent',
      contacted_by: user?.id || null,
      contact_method: contactMethod,
      response: response || null,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString()
    }

    if (!followUpOwnerId || !isSupabaseConfigured() || !supabase) {
      writeLocalFollowUpRecord(localEntry)
      toast.success('Follow-up saved on this device')
      return
    }

    setIsSavingFollowUp(true)
    try {
      const payload = {
        p_owner_id: followUpOwnerId,
        p_member_id: record.id,
        p_reason: record.followUpReason,
        p_follow_up_status: stage,
        p_contact_method: contactMethod,
        p_response: response || null,
        p_next_action_date: null
      }

      const { error } = await supabase.rpc('upsert_follow_up_record', payload)

      if (error) {
        const backendMissing =
          error?.code === '42883' ||
          error?.code === '42P01' ||
          String(error?.message || '').includes('upsert_follow_up_record')

        if (!backendMissing) throw error

        const { error: insertError } = await supabase
          .from('follow_up_records')
          .insert({
            owner_id: followUpOwnerId,
            member_id: record.id,
            reason: record.followUpReason,
            follow_up_status: stage,
            message_sent: stage === 'message_sent',
            contacted_by: user?.id || null,
            contact_method: contactMethod,
            response: response || null
          })

        if (insertError) {
          writeLocalFollowUpRecord(localEntry)
          toast.success('Follow-up saved on this device')
          return
        }
      }

      toast.success('Follow-up updated')
      await loadFollowUpRecords()
    } catch (error) {
      console.error('Failed to save follow-up record:', error)
      writeLocalFollowUpRecord(localEntry)
      toast.success('Follow-up saved on this device')
    } finally {
      setIsSavingFollowUp(false)
    }
  }

  const addFollowUpNote = async (record) => {
    const note = window.prompt(`Add a note for ${record.name}`)
    if (!note || !note.trim()) return
    await saveFollowUpStage(record, 'responded', 'note', note.trim())
  }

  const handlePasswordSubmit = async (e) => {
    e.preventDefault()
    if (!user?.email || !passwordInput) return

    setIsVerifying(true)
    setPasswordError(false)

    try {
      if (hasDeveloperAdminBypass && passwordInput.trim() === getDevAdminPassword()) {
        setIsAuthenticated(true)
        setLastActivity(Date.now())
        sessionStorage.setItem('adminAuthenticated', 'true')
        toast.success('Developer admin access granted')
        return
      }

      // Verify password by attempting to sign in with Supabase
      const { error } = await supabase.auth.signInWithPassword({
        email: user.email,
        password: passwordInput
      })

      if (error) {
        setPasswordError(true)
        setPasswordInput('')
      } else {
        setIsAuthenticated(true)
        setLastActivity(Date.now())

        if (stayLoggedIn) {
          // Store for 7 days
          const expiry = new Date().getTime() + (7 * 24 * 60 * 60 * 1000)
          localStorage.setItem('adminStayLoggedIn', 'true')
          localStorage.setItem('adminAuthExpiry', expiry.toString())
        } else {
          sessionStorage.setItem('adminAuthenticated', 'true')
        }
        toast.success('Admin access granted')
      }
    } catch (err) {
      setPasswordError(true)
      setPasswordInput('')
    } finally {
      setIsVerifying(false)
    }
  }

  const handleAdminLogout = () => {
    setIsAuthenticated(false)
    sessionStorage.removeItem('adminAuthenticated')
    localStorage.removeItem('adminStayLoggedIn')
    localStorage.removeItem('adminAuthExpiry')
  }

  // Google SSO for admin access (one-step)
  const handleGoogleAdminAccess = async () => {
    setIsGoogleAuthing(true)
    try {
      await signInWithGoogle()
      // After OAuth completes/returns, grant admin session
      sessionStorage.setItem('adminAuthenticated', 'true')
      setIsAuthenticated(true)
      setLastActivity(Date.now())
      toast.success('Admin access granted with Google')
    } catch (err) {
      console.error('Google admin access failed:', err)
      toast.error('Google sign-in failed for admin access')
    } finally {
      setIsGoogleAuthing(false)
    }
  }

  // Badge processing state
  const [isProcessingBadges, setIsProcessingBadges] = useState(false)
  const [badgeResults, setBadgeResults] = useState(null)
  const [showBadgeResults, setShowBadgeResults] = useState(false)
  const [showAdvancedFeatures, setShowAdvancedFeatures] = useState(false)





  // Print attendance sheet with editable preview
  const printAttendanceSheet = () => {
    const sundayDates = availableSundayDates?.map(d => {
      if (d instanceof Date) {
        const y = d.getFullYear()
        const m = String(d.getMonth() + 1).padStart(2, '0')
        const day = String(d.getDate()).padStart(2, '0')
        return `${y}-${m}-${day}`
      }
      return d
    }) || []

    // Sort members alphabetically
    const sortedMembers = [...members].sort((a, b) => {
      const nameA = (a['full_name'] || a['Full Name'] || '').toLowerCase()
      const nameB = (b['full_name'] || b['Full Name'] || '').toLowerCase()
      return nameA.localeCompare(nameB)
    })

    const printContent = `
      <!DOCTYPE html>
      <html>
      <head>
        <title>Attendance Sheet - ${monthDisplayName}</title>
        <style>
          * { box-sizing: border-box; }
          body { font-family: 'Segoe UI', Arial, sans-serif; padding: 20px; margin: 0; background: #f5f5f5; }
          .toolbar { 
            position: fixed; top: 0; left: 0; right: 0; 
            background: linear-gradient(135deg, #1e293b 0%, #334155 100%);
            padding: 12px 20px; 
            display: flex; align-items: center; gap: 15px; 
            box-shadow: 0 4px 20px rgba(0,0,0,0.15);
            z-index: 1000;
            flex-wrap: wrap;
          }
          .toolbar label { color: #e2e8f0; font-size: 13px; font-weight: 500; }
          .toolbar select, .toolbar input[type="number"] { 
            padding: 8px 12px; border-radius: 8px; border: 1px solid #475569; 
            font-size: 13px; background: #1e293b; color: white; cursor: pointer;
          }
          .toolbar select:focus { outline: none; border-color: #f97316; }
          .toolbar button {
            padding: 10px 20px; border-radius: 8px; border: none;
            font-weight: 600; cursor: pointer; transition: all 0.2s;
          }
          .btn-print { background: #059669; color: white; }
          .btn-print:hover { background: #047857; transform: translateY(-1px); }
          .btn-close { background: #475569; color: white; margin-left: auto; }
          .btn-close:hover { background: #64748b; }
          .toolbar-group { display: flex; align-items: center; gap: 8px; }
          .toolbar-divider { width: 1px; height: 24px; background: #475569; margin: 0 8px; }
          
          .content { margin-top: 80px; background: white; padding: 30px; border-radius: 8px; box-shadow: 0 2px 8px rgba(0,0,0,0.1); }
          h1 { text-align: center; margin-bottom: 5px; font-size: 24px; color: #1f2937; }
          h2 { text-align: center; color: #6b7280; font-weight: normal; margin-top: 0; font-size: 16px; }
          
          .editable-title { 
            border: 2px dashed transparent; padding: 5px 10px; border-radius: 4px;
            transition: border-color 0.2s; cursor: text;
          }
          .editable-title:hover { border-color: #f97316; }
          .editable-title:focus { outline: none; border-color: #f97316; background: #fff7ed; }
          
          table { width: 100%; border-collapse: collapse; margin-top: 20px; }
          th, td { border: 1px solid #d1d5db; padding: 8px; text-align: center; }
          th { background: #f3f4f6; font-weight: 600; color: #374151; }
          td:nth-child(2) { text-align: left; }
          .present { background: #d1fae5; color: #065f46; font-weight: bold; }
          .absent { background: #fee2e2; color: #991b1b; font-weight: bold; }
          
          .summary { margin: 20px 0; display: flex; gap: 20px; justify-content: center; flex-wrap: wrap; }
          .summary-item { text-align: center; padding: 15px 25px; background: #f9fafb; border-radius: 8px; }
          .summary-value { font-size: 28px; font-weight: bold; }
          .summary-label { font-size: 12px; color: #6b7280; margin-top: 4px; }
          
          .footer { text-align: center; margin-top: 30px; color: #9ca3af; font-size: 11px; }
          
          @media print {
            body { background: white; padding: 10px; }
            .toolbar { display: none !important; }
            .content { margin-top: 0; box-shadow: none; padding: 0; }
            .editable-title { border: none !important; }
            table { font-size: 10px; }
            th, td { padding: 4px; }
          }
        </style>
      </head>
      <body>
        <div class="toolbar">
          <div class="toolbar-group">
            <label>📝 Font:</label>
            <select id="fontSize" onchange="changeFontSize(this.value)">
              <option value="9">Tiny</option>
              <option value="10">Small</option>
              <option value="12" selected>Normal</option>
              <option value="14">Large</option>
            </select>
          </div>
          <div class="toolbar-divider"></div>
          <div class="toolbar-group">
            <label>📊 Style:</label>
            <select id="tableStyle" onchange="changeTableStyle(this.value)">
              <option value="default">Default</option>
              <option value="compact">Compact</option>
              <option value="striped">Striped</option>
              <option value="bordered">Bold Border</option>
            </select>
          </div>
          <div class="toolbar-divider"></div>
          <div class="toolbar-group">
            <label>
              <input type="checkbox" id="showSummary" checked onchange="toggleSummary(this.checked)"> 
              Summary
            </label>
          </div>
          <div class="toolbar-group">
            <label>
              <input type="checkbox" id="boldNames" onchange="toggleBoldNames(this.checked)"> 
              Bold Names
            </label>
          </div>
          <div class="toolbar-group">
            <label>
              <input type="checkbox" id="showGender" checked onchange="toggleColumn('gender', this.checked)"> 
              Gender
            </label>
          </div>
          <div class="toolbar-group">
            <label>
              <input type="checkbox" id="showLevel" checked onchange="toggleColumn('level', this.checked)"> 
              Level
            </label>
          </div>
          <div class="toolbar-divider"></div>
          <button class="btn-print" onclick="window.print()">🖨️ Print</button>
          <button class="btn-close" onclick="window.close()">✕ Close</button>
        </div>
        
        <div class="content">
          <h1 contenteditable="true" class="editable-title">Attendance Sheet</h1>
          <h2 contenteditable="true" class="editable-title">${monthDisplayName}</h2>
          
          <div class="summary" id="summarySection">
            <div class="summary-item">
              <div class="summary-value">${members.length}</div>
              <div class="summary-label">Total Members</div>
            </div>
            <div class="summary-item">
              <div class="summary-value" style="color: #10b981">${stats.totalPresent}</div>
              <div class="summary-label">Total Present</div>
            </div>
            <div class="summary-item">
              <div class="summary-value" style="color: #ef4444">${stats.totalAbsent}</div>
              <div class="summary-label">Total Absent</div>
            </div>
            <div class="summary-item">
              <div class="summary-value" style="color: #8b5cf6">${stats.attendanceRate}%</div>
              <div class="summary-label">Attendance Rate</div>
            </div>
          </div>
          
          <table id="attendanceTable">
            <thead>
              <tr>
                <th>#</th>
                <th>Name</th>
                <th>Gender</th>
                <th>Level</th>
                ${sundayDates.map(d => `<th>${new Date(d).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}</th>`).join('')}
                <th>Total</th>
              </tr>
            </thead>
            <tbody>
              ${sortedMembers.map((member, idx) => {
      let presentCount = 0
      const cells = sundayDates.map(date => {
        const status = attendanceData[date]?.[member.id]
        if (status === true) { presentCount++; return '<td class="present">P</td>' }
        if (status === false) { return '<td class="absent">A</td>' }
        return '<td>-</td>'
      }).join('')
      return `<tr>
                  <td>${idx + 1}</td>
                  <td class="member-name">${member['full_name'] || member['Full Name'] || 'N/A'}</td>
                  <td>${member['Gender'] || 'N/A'}</td>
                  <td>${member['Current Level'] || 'N/A'}</td>
                  ${cells}
                  <td><strong>${presentCount}/${sundayDates.length}</strong></td>
                </tr>`
    }).join('')}
            </tbody>
          </table>
          
          <p class="footer" contenteditable="true">Generated on ${new Date().toLocaleString()}</p>
        </div>
        
        <script>
          function changeFontSize(size) {
            document.getElementById('attendanceTable').style.fontSize = size + 'px';
          }
          function changeTableStyle(style) {
            const table = document.getElementById('attendanceTable');
            // Reset all styles first
            table.querySelectorAll('tbody tr').forEach(row => row.style.background = '');
            table.querySelectorAll('th, td').forEach(cell => {
              cell.style.padding = '';
              cell.style.borderWidth = '';
            });
            
            if (style === 'striped') {
              table.querySelectorAll('tbody tr').forEach((row, i) => {
                row.style.background = i % 2 === 0 ? '#f8fafc' : 'white';
              });
            } else if (style === 'compact') {
              table.querySelectorAll('th, td').forEach(cell => {
                cell.style.padding = '3px 5px';
              });
            } else if (style === 'bordered') {
              table.querySelectorAll('th, td').forEach(cell => {
                cell.style.borderWidth = '2px';
              });
            }
          }
          function toggleSummary(show) {
            document.getElementById('summarySection').style.display = show ? 'flex' : 'none';
          }
          function toggleBoldNames(bold) {
            document.querySelectorAll('.member-name').forEach(cell => {
              cell.style.fontWeight = bold ? 'bold' : 'normal';
            });
          }
          function toggleColumn(col, show) {
            const colIndex = col === 'gender' ? 2 : col === 'level' ? 3 : -1;
            if (colIndex === -1) return;
            document.querySelectorAll('#attendanceTable tr').forEach(row => {
              const cell = row.children[colIndex];
              if (cell) cell.style.display = show ? '' : 'none';
            });
          }
        </script>
      </body>
      </html>
    `

    const printWindow = window.open('', '_blank')
    printWindow.document.write(printContent)
    printWindow.document.close()
  }

  // Get month display name
  const monthDisplayName = currentTable ? currentTable.replace('_', ' ') : 'No Month Selected'
  const buildFollowUpPlainMessage = (record, template = followUpMessage) =>
    buildSuggestedMessage(template, record).replaceAll('{month}', monthDisplayName)

  const openFollowUpComposer = (record) => {
    setSelectedFollowUpRecord(record)
    setFollowUpDraftMessage(buildFollowUpPlainMessage(record))
  }

  const closeFollowUpComposer = () => {
    setSelectedFollowUpRecord(null)
    setFollowUpDraftMessage('')
  }

  const sendFollowUpMessage = async (method) => {
    const record = selectedFollowUpRecord
    if (!record) return

    const message = followUpDraftMessage.trim() || buildFollowUpPlainMessage(record)
    const phone = record.phone || getMemberPhone(record.member)
    const phoneDigits = cleanPhoneDigits(phone)
    const whatsappDigits = getWhatsAppDigits(phone)
    const email = getMemberEmail(record.member)
    const encoded = encodeURIComponent(message)

    if (method === 'whatsapp') {
      if (!whatsappDigits) {
        toast.error('No WhatsApp number saved')
        return
      }
      window.open(`https://wa.me/${whatsappDigits}?text=${encoded}`, '_blank', 'noopener,noreferrer')
    } else if (method === 'sms') {
      if (!phoneDigits) {
        toast.error('No phone number saved')
        return
      }
      window.location.href = `sms:${phoneDigits}?&body=${encoded}`
    } else if (method === 'email') {
      if (!email) {
        toast.error('No email saved')
        return
      }
      window.location.href = `mailto:${email}?subject=${encodeURIComponent('We missed you')}&body=${encoded}`
    } else if (method === 'call') {
      if (!phoneDigits) {
        toast.error('No phone number saved')
        return
      }
      window.location.href = `tel:${phoneDigits}`
    }

    await saveFollowUpStage(record, method === 'call' ? 'called' : 'message_sent', method, message)
    closeFollowUpComposer()
  }

  // Calculate quick stats
  const stats = useMemo(() => {
    // Get all sunday dates for this month
    const sundayDates = availableSundayDates?.map(normalizeSundayDate) || []

    let totalPresent = 0
    let totalAbsent = 0
    let totalMarked = 0

    // Calculate per-sunday stats
    const sundayStats = sundayDates.map(dateKey => {
      const map = attendanceData[dateKey] || {}
      const present = Object.values(map).filter(v => v === true).length
      const absent = Object.values(map).filter(v => v === false).length
      totalPresent += present
      totalAbsent += absent
      totalMarked += present + absent
      return {
        date: dateKey,
        present,
        absent,
        total: present + absent, marked: present + absent > 0
      }
    })

    // Calculate attendance rate
    const totalPossible = members.length * sundayDates.length
    const attendanceRate = totalPossible > 0 ? Math.round((totalPresent / totalPossible) * 100) : 0

    return {
      totalMembers: members.length,
      totalPresent,
      totalAbsent,
      attendanceRate,
      sundayStats,
      sundaysCompleted: sundayStats.filter(s => s.marked).length,
      totalSundays: sundayDates.length
    }
  }, [members, attendanceData, availableSundayDates])

  const attendanceFollowUps = useMemo(() => calculateAttendanceFollowUps({
    members,
    attendanceData,
    availableSundayDates: (availableSundayDates || []).map(normalizeSundayDate).filter(Boolean),
    followUpRecords,
    messageTemplate: followUpMessage
  }), [members, attendanceData, availableSundayDates, followUpRecords, followUpMessage])

  // Get top attendees
  const topAttendees = useMemo(() => {
    return members
      .map(member => {
        const rate = calculateAttendanceRate(member)
        return {
          id: member.id,
          name: member['full_name'] || member['Full Name'] || 'Unknown',
          rate,
          badge: member['Badge Type'] || 'newcomer'
        }
      })
      .filter(m => m.rate > 0)
      .sort((a, b) => b.rate - a.rate)
      .slice(0, 5)
  }, [members, calculateAttendanceRate])

  // Process badges
  const processBadges = async () => {
    setIsProcessingBadges(true)
    setBadgeResults(null)

    try {
      const monthComplete = isMonthAttendanceComplete()

      if (!monthComplete) {
        toast.error('Please complete attendance for all Sundays first.')
        setIsProcessingBadges(false)
        return
      }

      const results = {
        qualified: [],
        notQualified: [],
        totalProcessed: 0
      }

      // Get all sundays sorted
      const sortedSundays = [...(availableSundayDates || [])].sort((a, b) => {
        const dateA = a instanceof Date ? a : new Date(a)
        const dateB = b instanceof Date ? b : new Date(b)
        return dateA - dateB
      })

      for (const member of members) {
        results.totalProcessed++

        // Count total present
        let presentCount = 0
        let consecutiveCount = 0
        let hasThreeConsecutive = false

        for (const sunday of sortedSundays) {
          const dateKey = sunday instanceof Date
            ? `${sunday.getFullYear()}-${String(sunday.getMonth() + 1).padStart(2, '0')}-${String(sunday.getDate()).padStart(2, '0')}`
            : sunday
          const status = attendanceData[dateKey]?.[member.id]

          if (status === true) {
            presentCount++
            consecutiveCount++
            if (consecutiveCount >= 3) hasThreeConsecutive = true
          } else {
            consecutiveCount = 0
          }
        }

        const memberInfo = {
          id: member.id,
          name: member['full_name'] || member['Full Name'],
          presentCount,
          currentBadge: member['Badge Type'] || 'newcomer'
        }

        // Badge rules:
        // Member = 2+ Sundays present
        // Regular = 3+ consecutive Sundays present
        if (hasThreeConsecutive) {
          if (member['Badge Type'] !== 'regular') {
            await updateMember(member.id, { 'Badge Type': 'regular' }, { silent: true })
            memberInfo.newBadge = 'regular'
            memberInfo.upgraded = true
          }
          results.qualified.push(memberInfo)
        } else if (presentCount >= 2) {
          if (member['Badge Type'] !== 'member' && member['Badge Type'] !== 'regular') {
            await updateMember(member.id, { 'Badge Type': 'member' }, { silent: true })
            memberInfo.newBadge = 'member'
            memberInfo.upgraded = true
          }
          results.qualified.push(memberInfo)
        } else {
          results.notQualified.push(memberInfo)
        }
      }

      setBadgeResults(results)
      setShowBadgeResults(true)

      const upgraded = results.qualified.filter(m => m.upgraded).length
      toast.success(`Badge processing complete! ${upgraded} members upgraded.`)
    } catch (error) {
      console.error('Error processing badges:', error)
      toast.error('Failed to process badges. Please try again.')
    } finally {
      setIsProcessingBadges(false)
    }
  }

  const activeFollowUpRecords = attendanceFollowUps.buckets?.[activeFollowUpTab] || []
  const priorityFollowUpCount = attendanceFollowUps.follow_up.length + attendanceFollowUps.inactive.length
  const canManageAppUpdates = isDeveloperBypass || !isCollaborator || isAdminCollaborator
  const canUseLocalApkBuilder = import.meta.env.DEV && hasDeveloperAdminBypass

  useEffect(() => {
    if (!isAuthenticated || priorityFollowUpCount <= 0) return

    const key = `datser_follow_up_alert_${followUpOwnerId || 'local'}_${currentTable || 'month'}_${priorityFollowUpCount}`
    if (localStorage.getItem(key) === 'seen') return

    const firstRecord = attendanceFollowUps.follow_up[0] || attendanceFollowUps.inactive[0]
    localStorage.setItem(key, 'seen')
    toast.info(
      <div className="space-y-2">
        <p className="font-bold">Follow-up needed</p>
        <p className="text-sm">
          {priorityFollowUpCount} member{priorityFollowUpCount === 1 ? '' : 's'} missed recent Sundays.
        </p>
        {firstRecord && (
          <button
            type="button"
            onClick={() => {
              setActiveFollowUpTab(firstRecord.category === 'inactive' ? 'inactive' : 'follow_up')
              openFollowUpComposer(firstRecord)
              toast.dismiss()
            }}
            className="rounded-lg bg-orange-600 px-3 py-1.5 text-xs font-bold text-white"
          >
            Review message
          </button>
        )}
      </div>,
      {
        toastId: key,
        autoClose: 9000,
        closeOnClick: false
      }
    )
  }, [attendanceFollowUps.follow_up, attendanceFollowUps.inactive, currentTable, followUpOwnerId, isAuthenticated, priorityFollowUpCount])

  // Password protection screen
  if (!isAuthenticated) {
    return (
      <div className="flex min-h-[calc(100vh-var(--app-dashboard-header-height,72px))] items-start justify-center px-3 pb-24 pt-4 sm:px-4 sm:pt-8 md:items-center md:pt-4">
        <div className="w-full max-w-lg">
          <div className="overflow-hidden rounded-3xl border border-orange-100 bg-white shadow-2xl shadow-black/10 dark:border-white/10 dark:bg-[#202121] dark:shadow-black/40">
            {/* Header */}
            <div className="relative overflow-hidden bg-gradient-to-br from-orange-500 via-orange-600 to-orange-800 px-5 py-5 text-center dark:from-orange-700 dark:via-orange-800 dark:to-[#7c2508] sm:px-6 sm:py-6">
              <div className="absolute inset-0 bg-[radial-gradient(circle_at_50%_0%,rgba(255,255,255,0.25),transparent_42%)]" />
              <div className="relative mx-auto mb-3 flex h-14 w-14 items-center justify-center rounded-2xl border border-white/25 bg-white/15 shadow-lg shadow-orange-950/20 backdrop-blur">
                <Shield className="h-7 w-7 text-white" />
              </div>
              <h1 className="relative text-2xl font-black tracking-tight text-white">Admin Panel</h1>
              <p className="relative mt-1 text-sm font-medium text-orange-50">Secure access required</p>
            </div>

            {/* Form */}
            <form onSubmit={handlePasswordSubmit} className="space-y-4 p-5 sm:p-6">
              <div>
                <label className="mb-2 block text-sm font-bold text-gray-800 dark:text-gray-200">
                  Account Password
                </label>
                <input
                  type="password"
                  value={passwordInput}
                  onChange={(e) => setPasswordInput(e.target.value)}
                  placeholder="Enter your account password"
                  className={`w-full rounded-2xl border px-4 py-3.5 text-base shadow-inner transition-all focus:outline-none focus:ring-2 ${passwordError
                    ? 'border-red-400 bg-red-50 text-red-950 focus:ring-red-400 dark:bg-red-950/30 dark:text-white'
                    : 'border-gray-200 bg-gray-50 text-gray-900 focus:border-orange-400 focus:ring-orange-500/30 dark:border-white/10 dark:bg-[#2f3030] dark:text-white'
                    } placeholder:text-gray-400`}
                  autoFocus
                  disabled={isVerifying}
                />
                {passwordError && (
                  <p className="mt-2 flex items-center gap-1 text-sm font-medium text-red-500">
                    <X className="w-4 h-4" />
                    Incorrect password. Please try again.
                  </p>
                )}
              </div>

              {/* Stay logged in checkbox */}
              <label className="group flex cursor-pointer items-center gap-3 rounded-2xl border border-gray-200 bg-gray-50/80 p-3 transition-colors hover:bg-gray-100 dark:border-white/10 dark:bg-[#262727] dark:hover:bg-[#2f3030]">
                <div className="relative">
                  <input
                    type="checkbox"
                    checked={stayLoggedIn}
                    onChange={(e) => setStayLoggedIn(e.target.checked)}
                    className="sr-only peer"
                  />
                  <div className="flex h-6 w-6 items-center justify-center rounded-lg border-2 border-gray-300 transition-all peer-checked:border-orange-600 peer-checked:bg-orange-600 dark:border-gray-600">
                    {stayLoggedIn && <Check className="h-3.5 w-3.5 text-white" />}
                  </div>
                </div>
                <div>
                  <span className="text-sm font-bold text-gray-800 dark:text-gray-200">Stay logged in</span>
                  <p className="text-xs text-gray-500 dark:text-gray-400">Keep admin access for 7 days</p>
                </div>
              </label>

              <button
                type="submit"
                disabled={isVerifying || !passwordInput}
                className="flex min-h-[52px] w-full items-center justify-center gap-2 rounded-2xl bg-gradient-to-r from-orange-500 to-orange-700 px-4 py-3 font-black text-white shadow-lg shadow-orange-900/20 transition-all hover:from-orange-600 hover:to-orange-800 disabled:cursor-not-allowed disabled:from-orange-300 disabled:to-orange-400 disabled:shadow-none dark:shadow-black/30"
              >
                {isVerifying ? (
                  <>
                    <div className="w-5 h-5 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                    Verifying...
                  </>
                ) : (
                  <>
                    <Shield className="w-4 h-4" />
                    Access Admin Panel
                  </>
                )}
              </button>

              <div className="space-y-3 rounded-2xl border border-orange-200 bg-orange-50/80 p-3 dark:border-orange-800/60 dark:bg-orange-950/20">
                <p className="flex items-start gap-2 text-sm font-medium text-orange-800 dark:text-orange-100">
                  <LogIn className="mt-0.5 h-4 w-4 flex-shrink-0" />
                  <span>Use Google SSO. We'll verify your profile after redirect.</span>
                </p>
                <button
                  type="button"
                  onClick={handleGoogleAdminAccess}
                  disabled={isGoogleAuthing}
                  className="flex min-h-[48px] w-full items-center justify-center gap-2 rounded-2xl border border-orange-300 bg-white px-4 py-3 font-black text-orange-700 shadow-sm transition-all hover:bg-orange-50 disabled:opacity-70 dark:border-orange-700 dark:bg-orange-900/30 dark:text-orange-100 dark:hover:bg-orange-900/40"
                >
                  {isGoogleAuthing ? (
                    <>
                      <div className="w-5 h-5 border-2 border-orange-400 border-t-transparent rounded-full animate-spin" />
                      Connecting with Google...
                    </>
                  ) : (
                    <>
                      <LogIn className="w-4 h-4" />
                      Continue with Google
                    </>
                  )}
                </button>
              </div>

              <button
                type="button"
                onClick={() => setCurrentView('dashboard')}
                className="flex min-h-[44px] w-full items-center justify-center rounded-2xl text-sm font-bold text-gray-500 transition-colors hover:bg-gray-100 hover:text-gray-800 dark:text-gray-400 dark:hover:bg-white/5 dark:hover:text-gray-100"
              >
                ← Back to Dashboard
              </button>
            </form>
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className="min-h-screen pb-24">
      {/* Header */}
      <div className="sticky top-0 z-20 w-full py-1.5">
        <div className="mx-auto max-w-[1600px] px-4 relative">
          <div className="bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-xl px-4 py-2.5 sm:px-5 sm:py-3 flex items-center justify-between shadow-sm">
            <div className="flex items-center gap-3 sm:gap-4 flex-1 min-w-0">
              <div className="bg-slate-100 dark:bg-slate-700/50 p-2 sm:p-2.5 rounded-xl border border-slate-200 dark:border-slate-600 flex-shrink-0">
                <Shield className="w-5 h-5 sm:w-6 sm:h-6 text-slate-700 dark:text-slate-300" />
              </div>
              <div className="min-w-0 overflow-hidden">
                <h1 className="text-lg sm:text-xl font-bold text-gray-900 dark:text-white leading-tight truncate">
                  Admin Panel
                </h1>
                <p className="text-xs sm:text-sm font-medium text-gray-500 dark:text-gray-400 mt-0.5 truncate">
                  {monthDisplayName}
                </p>
              </div>
            </div>
              <div className="flex items-center gap-2 sm:gap-3 flex-shrink-0 ml-2">
              <button
                onClick={() => {
                  handleAdminLogout()
                  toast.info('Admin session ended')
                }}
                className="flex items-center gap-2 px-2.5 py-2 sm:px-3 text-sm font-semibold text-red-600 dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-900/20 rounded-lg transition-colors group"
                title="Lock Admin Panel"
              >
                <LogOut className="w-4 h-4 transition-transform group-hover:translate-x-0.5" />
                <span className="hidden sm:inline">Lock</span>
              </button>

              <div className="h-6 sm:h-8 w-px bg-gray-200 dark:bg-gray-700 mx-0.5 sm:mx-1"></div>

              <button
                onClick={() => setCurrentView('dashboard')}
                className="flex items-center gap-2 px-3 py-2 sm:px-4 text-sm font-medium text-gray-600 dark:text-gray-300 hover:text-gray-900 dark:hover:text-white hover:bg-gray-100 dark:hover:bg-gray-700 rounded-lg transition-colors"
                title="Back to Dashboard"
              >
                <ArrowLeft className="w-4 h-4" />
                <span className="hidden sm:inline">Back to Dashboard</span>
                <span className="sm:hidden">Back</span>
              </button>
              <button
                onClick={() => setShowOverview(prev => !prev)}
                className="flex items-center gap-2 px-3 py-2 sm:px-3 text-sm font-medium text-gray-600 dark:text-gray-300 hover:text-gray-900 dark:hover:text-white hover:bg-gray-100 dark:hover:bg-gray-700 rounded-lg transition-colors"
                title="Overview"
              >
                <Printer className="w-4 h-4" />
                <span className="hidden sm:inline">Overview</span>
              </button>
            </div>
            {showOverview && (
              <div className="absolute right-4 top-full mt-2 w-80 z-50">
                <div className="bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-2xl shadow-lg p-3">
                  <div className="flex items-start justify-between mb-2">
                    <div>
                      <p className="text-lg font-semibold text-gray-900 dark:text-white">Overview</p>
                      <p className="text-xs text-gray-500 dark:text-gray-400">Quick summary</p>
                    </div>
                    <div className="flex items-center gap-2">
                      <button onClick={printAttendanceSheet} className="px-3 py-1 text-sm rounded-lg border border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-900 text-gray-700 dark:text-gray-200">Print</button>
                      <button onClick={() => setShowOverview(false)} className="px-2 py-1 text-sm rounded-lg text-gray-500 hover:text-gray-700">Close</button>
                    </div>
                  </div>

                  <div className="grid grid-cols-2 gap-2">
                    <div className="p-3 rounded-lg bg-white/60 dark:bg-gray-900/50 border border-gray-100 dark:border-gray-700">
                      <p className="text-xl font-bold text-gray-900 dark:text-white">{stats.totalMembers}</p>
                      <p className="text-xs text-gray-500 dark:text-gray-400">Total Members</p>
                    </div>
                    <div className="p-3 rounded-lg bg-white/60 dark:bg-gray-900/50 border border-gray-100 dark:border-gray-700">
                      <p className="text-xl font-bold text-green-600 dark:text-green-400">{stats.totalPresent}</p>
                      <p className="text-xs text-gray-500 dark:text-gray-400">Total Present</p>
                    </div>
                    <div className="p-3 rounded-lg bg-white/60 dark:bg-gray-900/50 border border-gray-100 dark:border-gray-700">
                      <p className="text-xl font-bold text-red-600 dark:text-red-400">{stats.totalAbsent}</p>
                      <p className="text-xs text-gray-500 dark:text-gray-400">Total Absent</p>
                    </div>
                    <div className="p-3 rounded-lg bg-white/60 dark:bg-gray-900/50 border border-gray-100 dark:border-gray-700">
                      <p className="text-xl font-bold text-purple-600 dark:text-purple-400">{stats.attendanceRate}%</p>
                      <p className="text-xs text-gray-500 dark:text-gray-400">Attendance Rate</p>
                    </div>
                  </div>

                  <div className="mt-3">
                    <button
                      onClick={() => setShowAdvancedFeatures(prev => !prev)}
                      className="w-full p-3 flex items-center justify-between rounded-lg border border-gray-100 dark:border-gray-700 bg-gray-50 dark:bg-gray-900 text-sm"
                    >
                      <div className="flex items-center gap-3">
                        <Award className="w-4 h-4 text-gray-600 dark:text-gray-400" />
                        <div className="text-left">
                          <p className="font-medium text-gray-900 dark:text-white">Advanced Features</p>
                          <p className="text-xs text-gray-500 dark:text-gray-400">Badge processing & automation</p>
                        </div>
                      </div>
                      <ChevronDown className={`w-4 h-4 text-gray-400 transition-transform ${showAdvancedFeatures ? 'rotate-180' : ''}`} />
                    </button>

                    {showAdvancedFeatures && (
                      <div className="mt-3 bg-gradient-to-br from-orange-500 to-purple-600 rounded-xl p-3 text-white">
                        <div className="flex items-center justify-between">
                          <div>
                            <p className="font-bold">Badge Processing</p>
                            <p className="text-xs text-white/80">Auto-assign badges based on attendance</p>
                          </div>
                          <div className="text-right">
                            <div className="text-sm font-bold">{stats.sundaysCompleted}/{stats.totalSundays}</div>
                            <p className="text-xs opacity-80">Sundays</p>
                          </div>
                        </div>
                        <button
                          onClick={processBadges}
                          disabled={isProcessingBadges || stats.sundaysCompleted < stats.totalSundays}
                          className={`w-full mt-3 py-2 rounded-lg font-semibold text-sm ${stats.sundaysCompleted < stats.totalSundays ? 'bg-white/20 text-white/50 cursor-not-allowed' : 'bg-white text-orange-600'}`}
                        >
                          {isProcessingBadges ? 'Processing...' : stats.sundaysCompleted < stats.totalSundays ? 'Complete Sundays' : 'Process Badges'}
                        </button>
                      </div>
                    )}
                  </div>
                </div>
              </div>
            )}
          </div>
        </div>
      </div>

      <div className="mx-auto grid max-w-[1600px] grid-cols-1 gap-4 px-3 py-3 sm:px-4 sm:py-4 xl:grid-cols-[minmax(340px,420px)_minmax(0,1fr)] xl:items-start xl:gap-5">

        {canUseLocalApkBuilder && (
          <div className="xl:col-span-2">
            <ApkBuildManager
              canAccess={canUseLocalApkBuilder}
              canUpload={canManageAppUpdates}
              userId={user?.id || null}
            />
          </div>
        )}

        <div className="xl:col-span-2">
          <AppUpdatesManager canManage={canManageAppUpdates} userId={user?.id || null} />
        </div>

        {/* Badge Results */}
        {badgeResults && showBadgeResults && (
          <div className="bg-white dark:bg-gray-800 rounded-2xl border border-gray-200 dark:border-gray-700 overflow-hidden animate-fade-in-up xl:col-span-2">
            <div className="p-4 border-b border-gray-200 dark:border-gray-700 flex items-center justify-between">
              <h3 className="font-semibold text-gray-900 dark:text-white flex items-center gap-2">
                <Trophy className="w-5 h-5 text-yellow-500" />
                Badge Results
              </h3>
              <button
                onClick={() => setShowBadgeResults(false)}
                className="p-1 hover:bg-gray-100 dark:hover:bg-gray-700 rounded-lg transition-colors"
              >
                <X className="w-5 h-5 text-gray-400" />
              </button>
            </div>
            <div className="p-4 space-y-4">
              <div className="grid grid-cols-2 gap-4 transition-all duration-500 ease-[cubic-bezier(0.4,0,0.2,1)]">
                <div className="bg-green-50 dark:bg-green-900/20 rounded-xl p-4 text-center">
                  <p className="text-2xl font-bold text-green-600 dark:text-green-400">
                    {badgeResults.qualified.length}
                  </p>
                  <p className="text-sm text-green-600/70 dark:text-green-400/70">Qualified</p>
                </div>
                <div className="bg-gray-50 dark:bg-gray-700/50 rounded-xl p-4 text-center">
                  <p className="text-2xl font-bold text-gray-600 dark:text-gray-300">
                    {badgeResults.notQualified.length}
                  </p>
                  <p className="text-sm text-gray-500 dark:text-gray-400">Not Qualified</p>
                </div>
              </div>

              {badgeResults.qualified.filter(m => m.upgraded).length > 0 && (
                <div className="space-y-2">
                  <p className="text-sm font-medium text-gray-700 dark:text-gray-300">Recently Upgraded:</p>
                  {badgeResults.qualified.filter(m => m.upgraded).slice(0, 5).map(member => (
                    <div key={member.id} className="flex items-center justify-between bg-green-50 dark:bg-green-900/20 rounded-lg px-3 py-2">
                      <span className="text-sm text-gray-900 dark:text-white">{member.name}</span>
                      <span className={`text-xs px-2 py-1 rounded-full font-medium ${member.newBadge === 'regular'
                        ? 'bg-green-100 dark:bg-green-800 text-green-700 dark:text-green-300'
                        : 'bg-orange-100 dark:bg-orange-800 text-orange-700 dark:text-orange-300'
                        }`}>
                        {member.newBadge === 'regular' ? '⭐ Regular' : '👤 Member'}
                      </span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        )}

        {/* This Month's Sundays */}
        <div className="bg-white dark:bg-gray-800 rounded-2xl border border-gray-200 dark:border-gray-700 overflow-hidden animate-fade-in-up" style={{ animationDelay: '200ms' }}>
          <div className="p-4 border-b border-gray-200 dark:border-gray-700">
            <h3 className="font-semibold text-gray-900 dark:text-white flex items-center gap-2">
              <Calendar className="w-5 h-5 text-orange-500" />
              This Month's Sundays
            </h3>
          </div>
          <div className="p-4">
            <div className="space-y-2">
              {stats.sundayStats.map((sunday, index) => {
                const date = new Date(sunday.date)
                const label = date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
                return (
                  <div key={sunday.date} className="flex items-center justify-between py-2 px-3 rounded-lg hover:bg-gray-50 dark:hover:bg-gray-700/50 transition-colors">
                    <div className="flex items-center gap-3">
                      <div className={`w-8 h-8 rounded-full flex items-center justify-center text-sm font-medium ${sunday.marked
                        ? 'bg-green-100 dark:bg-green-900/30 text-green-600 dark:text-green-400'
                        : 'bg-gray-100 dark:bg-gray-700 text-gray-400'
                        }`}>
                        {sunday.marked ? <Check className="w-4 h-4" /> : index + 1}
                      </div>
                      <span className={`font-medium ${sunday.marked ? 'text-gray-900 dark:text-white' : 'text-gray-400'}`}>
                        {label}
                      </span>
                    </div>
                    {sunday.marked ? (
                      <div className="flex items-center gap-4 text-sm">
                        <span className="text-green-600 dark:text-green-400">{sunday.present} present</span>
                        <span className="text-red-500">{sunday.absent} absent</span>
                      </div>
                    ) : (
                      <span className="text-xs text-gray-400 flex items-center gap-1">
                        <Clock className="w-3 h-3" />
                        Not marked
                      </span>
                    )}
                  </div>
                )
              })}
            </div>
          </div>
        </div>

        {/* Attendance Follow-up */}
        <div className="admin-insight-card bg-white dark:bg-gray-800 rounded-2xl border border-gray-200 dark:border-gray-700 overflow-hidden animate-fade-in-up xl:row-span-3" style={{ animationDelay: '280ms' }}>
          <div className="p-4 border-b border-gray-200 dark:border-gray-700">
            <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
              <h3 className="font-semibold text-gray-900 dark:text-white flex items-center gap-2">
                <Phone className="w-5 h-5 text-emerald-500" />
                Attendance Follow-up
              </h3>
              <span className="text-xs font-semibold text-gray-500 dark:text-gray-400">
                Last {Math.min(attendanceFollowUps.totalSundays, 12)} Sundays checked
              </span>
            </div>
          </div>
          <div className="p-4 space-y-4">
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
              <div className="rounded-xl bg-green-50 dark:bg-green-900/20 p-3 text-center">
                <p className="text-2xl font-bold text-green-600 dark:text-green-400">{attendanceFollowUps.regular.length}</p>
                <p className="text-xs font-medium text-green-700 dark:text-green-300">Regular</p>
              </div>
              <div className="rounded-xl bg-amber-50 dark:bg-amber-900/20 p-3 text-center">
                <p className="text-2xl font-bold text-amber-600 dark:text-amber-400">{attendanceFollowUps.watch.length}</p>
                <p className="text-xs font-medium text-amber-700 dark:text-amber-300">Watch</p>
              </div>
              <div className="rounded-xl bg-red-50 dark:bg-red-900/20 p-3 text-center">
                <p className="text-2xl font-bold text-red-600 dark:text-red-400">{priorityFollowUpCount}</p>
                <p className="text-xs font-medium text-red-700 dark:text-red-300">Need care</p>
              </div>
              <div className="rounded-xl bg-blue-50 dark:bg-blue-900/20 p-3 text-center">
                <p className="text-2xl font-bold text-blue-600 dark:text-blue-400">{attendanceFollowUps.contacted.length}</p>
                <p className="text-xs font-medium text-blue-700 dark:text-blue-300">Contacted</p>
              </div>
            </div>

            <textarea
              value={followUpMessage}
              onChange={(event) => setFollowUpMessage(event.target.value)}
              rows={3}
              className="w-full rounded-xl border border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-900/50 px-3 py-2 text-sm text-gray-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-emerald-500"
              placeholder="Message template"
            />

            <div className="admin-insight-help rounded-2xl border border-emerald-200 bg-emerald-50 p-3 text-sm leading-6 text-emerald-900 dark:border-emerald-900/50 dark:bg-emerald-950/20 dark:text-emerald-100">
              <p className="font-black">How follow-up works</p>
              <p className="mt-1">
                DatSer checks the latest marked Sundays. If someone misses 3 Sundays in a row or has no attendance in the last 4 marked Sundays, they appear in Follow Up. If they have been away longer, they move to Inactive. Use Review & send to edit the message, choose WhatsApp, SMS, email, or call, then DatSer records that contact stage.
              </p>
            </div>

            {attendanceFollowUps.totalSundays === 0 ? (
              <p className="text-center text-gray-400 py-4">No Sundays available for this month yet</p>
            ) : (
              <div className="space-y-3">
                <div className="flex gap-2 overflow-x-auto pb-1">
                  {FOLLOW_UP_TABS.map((tab) => {
                    const isActive = activeFollowUpTab === tab.id
                    const count = attendanceFollowUps.buckets?.[tab.id]?.length || 0
                    return (
                      <button
                        key={tab.id}
                        type="button"
                        onClick={() => setActiveFollowUpTab(tab.id)}
                        className={`shrink-0 rounded-full border px-3 py-2 text-xs font-semibold transition-colors ${
                          isActive
                            ? 'border-emerald-500 bg-emerald-50 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-200'
                            : 'border-gray-200 bg-white text-gray-600 hover:bg-gray-50 dark:border-gray-700 dark:bg-gray-900/40 dark:text-gray-300 dark:hover:bg-gray-700'
                        }`}
                      >
                        {tab.label} <span className="ml-1 opacity-70">{count}</span>
                      </button>
                    )
                  })}
                </div>

                {activeFollowUpRecords.slice(0, 12).map((record) => {
                  const message = buildSuggestedMessage(followUpMessage, record).replaceAll('{month}', monthDisplayName)
                  const phone = record.phone || getMemberPhone(record.member)
                  const phoneDigits = cleanPhoneDigits(phone)
                  const phoneHref = phoneDigits ? `tel:${phoneDigits}` : undefined
                  return (
                    <div key={record.id} className="rounded-xl border border-gray-200 bg-gray-50/80 p-3 dark:border-gray-700 dark:bg-gray-900/30">
                      <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
                        <div className="min-w-0 flex-1 space-y-3">
                          <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
                            <div className="min-w-0">
                              <div className="flex items-center gap-2">
                                {record.category === 'regular' || record.category === 'resolved' ? (
                                  <UserCheck className="h-4 w-4 shrink-0 text-green-500" />
                                ) : (
                                  <UserX className="h-4 w-4 shrink-0 text-amber-500" />
                                )}
                                <p className="truncate font-semibold text-gray-900 dark:text-white">{record.name}</p>
                              </div>
                              <p className="mt-1 text-xs text-gray-500 dark:text-gray-400">
                                {phone || 'No phone saved'}
                              </p>
                            </div>
                            <select
                              value={record.followUpStage || 'not_contacted'}
                              onChange={(event) => saveFollowUpStage(record, event.target.value, 'stage')}
                              disabled={isSavingFollowUp}
                              className="rounded-lg border border-gray-200 bg-white px-2 py-2 text-xs font-semibold text-gray-700 focus:outline-none focus:ring-2 focus:ring-emerald-500 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-200"
                            >
                              {FOLLOW_UP_STAGES.map((stage) => (
                                <option key={stage.id} value={stage.id}>{stage.label}</option>
                              ))}
                            </select>
                          </div>

                          <div className="grid grid-cols-2 gap-2 text-xs sm:grid-cols-4">
                            <div className="rounded-lg bg-white p-2 dark:bg-gray-800">
                              <p className="text-gray-400">Rate</p>
                              <p className="font-bold text-gray-900 dark:text-white">{record.attendanceRate}%</p>
                            </div>
                            <div className="rounded-lg bg-white p-2 dark:bg-gray-800">
                              <p className="text-gray-400">Last attended</p>
                              <p className="font-bold text-gray-900 dark:text-white">{record.lastAttendedDate || 'None'}</p>
                            </div>
                            <div className="rounded-lg bg-white p-2 dark:bg-gray-800">
                              <p className="text-gray-400">Missed row</p>
                              <p className="font-bold text-gray-900 dark:text-white">{record.consecutiveAbsences}</p>
                            </div>
                            <div className="rounded-lg bg-white p-2 dark:bg-gray-800">
                              <p className="text-gray-400">Checked</p>
                              <p className="font-bold text-gray-900 dark:text-white">{record.totalSessionsChecked}</p>
                            </div>
                          </div>

                          <div className="rounded-lg bg-white p-3 text-xs dark:bg-gray-800">
                            <p className="font-semibold text-gray-700 dark:text-gray-200">{record.followUpReason}</p>
                            <p className="mt-2 text-gray-500 dark:text-gray-400">{message}</p>
                            <p className="mt-2 text-gray-400">
                              Present {record.presentCount} / Absent {record.absentCount} / Excused {record.excusedCount}
                            </p>
                          </div>
                        </div>

                        <div className="grid grid-cols-2 gap-2 sm:flex lg:flex-col lg:min-w-[150px]">
                          <button
                            type="button"
                            onClick={() => openFollowUpComposer(record)}
                            className="col-span-2 inline-flex items-center justify-center gap-2 rounded-lg bg-orange-600 px-3 py-2 text-xs font-bold text-white shadow-sm shadow-orange-900/20 hover:bg-orange-700 lg:col-span-1"
                          >
                            <Send className="h-4 w-4" />
                            Review & send
                          </button>
                          {phoneHref ? (
                            <a
                              href={phoneHref}
                              onClick={() => saveFollowUpStage(record, 'called', 'call')}
                              className="inline-flex items-center justify-center gap-2 rounded-lg border border-emerald-200 bg-white px-3 py-2 text-xs font-semibold text-emerald-700 hover:bg-emerald-50 dark:border-emerald-900/50 dark:bg-gray-800 dark:text-emerald-300 dark:hover:bg-emerald-900/20"
                              title="Call"
                            >
                              <Phone className="h-4 w-4" />
                              Call
                            </a>
                          ) : (
                            <span className="inline-flex items-center justify-center rounded-lg bg-gray-100 px-3 py-2 text-xs font-semibold text-gray-400 dark:bg-gray-800">
                              No phone
                            </span>
                          )}
                          <button
                            type="button"
                            onClick={() => saveFollowUpStage(record, 'message_sent', 'manual')}
                            disabled={isSavingFollowUp}
                            className="inline-flex items-center justify-center gap-2 rounded-lg border border-blue-200 bg-white px-3 py-2 text-xs font-semibold text-blue-700 hover:bg-blue-50 disabled:opacity-60 dark:border-blue-900/50 dark:bg-gray-800 dark:text-blue-300 dark:hover:bg-blue-900/20"
                          >
                            <Check className="h-4 w-4" />
                            Contacted
                          </button>
                          <button
                            type="button"
                            onClick={() => addFollowUpNote(record)}
                            disabled={isSavingFollowUp}
                            className="inline-flex items-center justify-center gap-2 rounded-lg border border-gray-200 bg-white px-3 py-2 text-xs font-semibold text-gray-700 hover:bg-gray-50 disabled:opacity-60 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-200 dark:hover:bg-gray-700"
                          >
                            <MessageCircle className="h-4 w-4" />
                            Add note
                          </button>
                        </div>
                      </div>
                    </div>
                  )
                })}

                {activeFollowUpRecords.length === 0 && (
                  <div className="rounded-xl border border-green-100 dark:border-green-900/40 bg-green-50/70 dark:bg-green-900/10 p-3 flex items-center gap-2">
                    <UserCheck className="w-4 h-4 text-green-500" />
                    <p className="text-sm font-medium text-green-700 dark:text-green-300">No members in this follow-up tab right now.</p>
                  </div>
                )}
              </div>
            )}
          </div>
        </div>

          {/* Tag Management */}
          <div className="admin-insight-card bg-white dark:bg-gray-800 rounded-2xl border border-gray-200 dark:border-gray-700 overflow-hidden animate-fade-in-up" style={{ animationDelay: '350ms' }}>
            <div className="p-4 border-b border-gray-200 dark:border-gray-700">
              <h3 className="font-semibold text-gray-900 dark:text-white flex items-center gap-2">
                <Tag className="w-5 h-5 text-primary-600" />
                Tag Management
              </h3>
            </div>
            <div className="p-4">
              <TagManager ownerId={dataOwnerId} isDarkMode={isDarkMode} onTagsChange={() => {}} />
            </div>
          </div>

          {/* Top Attendees */}
        <div className="admin-insight-card bg-white dark:bg-gray-800 rounded-2xl border border-gray-200 dark:border-gray-700 overflow-hidden animate-fade-in-up" style={{ animationDelay: '400ms' }}>
          <div className="p-4 border-b border-gray-200 dark:border-gray-700">
            <h3 className="font-semibold text-gray-900 dark:text-white flex items-center gap-2">
              <Star className="w-5 h-5 text-yellow-500" />
              Top Attendees
            </h3>
          </div>
          <div className="p-4">
            {topAttendees.length === 0 ? (
              <p className="text-center text-gray-400 py-4">No attendance data yet</p>
            ) : (
              <div className="space-y-2">
                {topAttendees.map((attendee, index) => (
                  <div key={attendee.id} className="flex items-center justify-between py-2 px-3 rounded-lg hover:bg-gray-50 dark:hover:bg-gray-700/50 transition-colors">
                    <div className="flex items-center gap-3">
                      <div className={`w-8 h-8 rounded-full flex items-center justify-center text-sm font-bold text-white ${index === 0 ? 'bg-yellow-500' :
                        index === 1 ? 'bg-gray-400' :
                          index === 2 ? 'bg-amber-600' :
                            'bg-orange-500'
                        }`}>
                        {index + 1}
                      </div>
                      <div>
                        <p className="font-medium text-gray-900 dark:text-white">{attendee.name}</p>
                        <p className="text-xs text-gray-500 dark:text-gray-400 capitalize">{attendee.badge}</p>
                      </div>
                    </div>
                    <div className={`text-lg font-bold ${attendee.rate >= 90 ? 'text-green-500' :
                      attendee.rate >= 75 ? 'text-orange-500' :
                        'text-yellow-500'
                      }`}>
                      {attendee.rate}%
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>

      {selectedFollowUpRecord && (
        <div className="fixed inset-0 z-[80] flex items-end justify-center bg-black/55 px-3 pb-3 backdrop-blur-sm sm:items-center sm:p-6">
          <div className="w-full max-w-2xl overflow-hidden rounded-3xl border border-gray-200 bg-white shadow-2xl shadow-black/30 dark:border-white/10 dark:bg-[#202121]">
            <div className="flex items-start justify-between gap-4 border-b border-gray-200 p-4 dark:border-white/10">
              <div className="min-w-0">
                <p className="text-xs font-black uppercase tracking-[0.16em] text-orange-600 dark:text-orange-300">Attendance follow-up</p>
                <h3 className="mt-1 truncate text-xl font-black text-gray-950 dark:text-white">
                  {selectedFollowUpRecord.name}
                </h3>
                <p className="mt-1 text-sm text-gray-500 dark:text-gray-400">
                  {selectedFollowUpRecord.followUpReason}
                </p>
              </div>
              <button
                type="button"
                onClick={closeFollowUpComposer}
                className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-gray-100 text-gray-500 transition-colors hover:bg-gray-200 hover:text-gray-900 dark:bg-white/10 dark:text-gray-300 dark:hover:bg-white/15 dark:hover:text-white"
                aria-label="Close follow-up message"
              >
                <X className="h-5 w-5" />
              </button>
            </div>

            <div className="space-y-4 p-4">
              <div className="grid grid-cols-2 gap-2 text-sm sm:grid-cols-4">
                <div className="rounded-2xl bg-gray-50 p-3 dark:bg-white/5">
                  <p className="text-xs font-bold uppercase text-gray-400">Rate</p>
                  <p className="mt-1 font-black text-gray-950 dark:text-white">{selectedFollowUpRecord.attendanceRate}%</p>
                </div>
                <div className="rounded-2xl bg-gray-50 p-3 dark:bg-white/5">
                  <p className="text-xs font-bold uppercase text-gray-400">Missed</p>
                  <p className="mt-1 font-black text-gray-950 dark:text-white">{selectedFollowUpRecord.consecutiveAbsences} row</p>
                </div>
                <div className="rounded-2xl bg-gray-50 p-3 dark:bg-white/5">
                  <p className="text-xs font-bold uppercase text-gray-400">Phone</p>
                  <p className="mt-1 truncate font-black text-gray-950 dark:text-white">{selectedFollowUpRecord.phone || 'None'}</p>
                </div>
                <div className="rounded-2xl bg-gray-50 p-3 dark:bg-white/5">
                  <p className="text-xs font-bold uppercase text-gray-400">Stage</p>
                  <p className="mt-1 truncate font-black text-gray-950 dark:text-white">{selectedFollowUpRecord.followUpStageLabel}</p>
                </div>
              </div>

              <label className="block space-y-2">
                <span className="text-sm font-bold text-gray-800 dark:text-gray-200">Edit message before sending</span>
                <textarea
                  value={followUpDraftMessage}
                  onChange={(event) => setFollowUpDraftMessage(event.target.value)}
                  rows={5}
                  className="w-full rounded-2xl border border-gray-200 bg-gray-50 px-4 py-3 text-sm leading-6 text-gray-900 outline-none transition focus:border-orange-400 focus:ring-2 focus:ring-orange-500/20 dark:border-white/10 dark:bg-[#2f3030] dark:text-white"
                />
              </label>

              <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                <button
                  type="button"
                  onClick={() => sendFollowUpMessage('whatsapp')}
                  className="inline-flex min-h-[46px] items-center justify-center gap-2 rounded-2xl bg-green-600 px-3 py-2 text-sm font-black text-white hover:bg-green-700"
                >
                  <Send className="h-4 w-4" />
                  WhatsApp
                </button>
                <button
                  type="button"
                  onClick={() => sendFollowUpMessage('sms')}
                  className="inline-flex min-h-[46px] items-center justify-center gap-2 rounded-2xl bg-blue-600 px-3 py-2 text-sm font-black text-white hover:bg-blue-700"
                >
                  <MessageCircle className="h-4 w-4" />
                  SMS
                </button>
                <button
                  type="button"
                  onClick={() => sendFollowUpMessage('email')}
                  className="inline-flex min-h-[46px] items-center justify-center gap-2 rounded-2xl bg-gray-900 px-3 py-2 text-sm font-black text-white hover:bg-black dark:bg-white/10 dark:hover:bg-white/15"
                >
                  <Mail className="h-4 w-4" />
                  Email
                </button>
                <button
                  type="button"
                  onClick={() => sendFollowUpMessage('call')}
                  className="inline-flex min-h-[46px] items-center justify-center gap-2 rounded-2xl border border-gray-200 bg-white px-3 py-2 text-sm font-black text-gray-800 hover:bg-gray-50 dark:border-white/10 dark:bg-white/5 dark:text-white dark:hover:bg-white/10"
                >
                  <Phone className="h-4 w-4" />
                  Call
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

export default AdminPanel
