import React, { useState, useEffect, useMemo } from 'react'
import { useApp } from '../context/AppContext'
import { useTheme } from '../context/ThemeContext'
import { useAuth } from '../context/AuthContext'
import { supabase } from '../lib/supabase'
import { toast } from 'react-toastify'
import {
  Users,
  Calendar,
  Award,
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
  Tags,
  Plus,
  Trash2,
  Edit3,
  Printer,
  Download,
  LogOut,
  Shield,
  Lock,
  LogIn,
  ArrowLeft
} from 'lucide-react'

const AdminPanel = ({ setCurrentView, onBack }) => {
  const {
    members,
    currentTable,
    attendanceData,
    availableSundayDates,
    isMonthAttendanceComplete,
    updateMember,
    calculateAttendanceRate
  } = useApp()
  const { isDarkMode } = useTheme()
  const { user, signInWithGoogle } = useAuth()

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
  const [passwordInput, setPasswordInput] = useState('')
  const [passwordError, setPasswordError] = useState(false)
  const [isVerifying, setIsVerifying] = useState(false)
  const [stayLoggedIn, setStayLoggedIn] = useState(false)
  const [lastActivity, setLastActivity] = useState(Date.now())
  const AUTO_LOCK_MINUTES = 15 // Auto-lock after 15 minutes of inactivity
  const [isGoogleAuthing, setIsGoogleAuthing] = useState(false)

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

  const handlePasswordSubmit = async (e) => {
    e.preventDefault()
    if (!user?.email || !passwordInput) return

    setIsVerifying(true)
    setPasswordError(false)

    try {
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

  // Ministry management state
  const defaultMinistries = ['Choir', 'Ushers', 'Youth', 'Children', 'Media', 'Welfare', 'Protocol', 'Evangelism']
  const [ministries, setMinistries] = useState(() => {
    const saved = localStorage.getItem('customMinistries')
    return saved ? JSON.parse(saved) : defaultMinistries
  })
  const [newMinistry, setNewMinistry] = useState('')
  const [editingMinistry, setEditingMinistry] = useState(null)
  const [editMinistryValue, setEditMinistryValue] = useState('')

  // Save ministries to localStorage whenever they change
  useEffect(() => {
    localStorage.setItem('customMinistries', JSON.stringify(ministries))
    // Dispatch event so other components can listen for changes
    window.dispatchEvent(new CustomEvent('ministriesUpdated', { detail: ministries }))
  }, [ministries])

  const addMinistry = () => {
    const trimmed = newMinistry.trim()
    if (trimmed && !ministries.includes(trimmed)) {
      setMinistries([...ministries, trimmed])
      setNewMinistry('')
      toast.success(`Added "${trimmed}" ministry`)
    }
  }

  const deleteMinistry = (ministry) => {
    setMinistries(ministries.filter(m => m !== ministry))
    toast.success(`Removed "${ministry}" ministry`)
  }

  const startEditMinistry = (ministry) => {
    setEditingMinistry(ministry)
    setEditMinistryValue(ministry)
  }

  const saveEditMinistry = () => {
    const trimmed = editMinistryValue.trim()
    if (trimmed && trimmed !== editingMinistry) {
      setMinistries(ministries.map(m => m === editingMinistry ? trimmed : m))
      toast.success(`Updated ministry to "${trimmed}"`)
    }
    setEditingMinistry(null)
    setEditMinistryValue('')
  }

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

  // Calculate quick stats
  const stats = useMemo(() => {
    // Get all sunday dates for this month
    const sundayDates = availableSundayDates?.map(d => {
      if (d instanceof Date) {
        const y = d.getFullYear()
        const m = String(d.getMonth() + 1).padStart(2, '0')
        const day = String(d.getDate()).padStart(2, '0')
        return `${y}-${m}-${day}`
      }
      return d
    }) || []

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

  // Password protection screen
  if (!isAuthenticated) {
    return (
      <div className="min-h-screen bg-gray-50 dark:bg-gray-900 flex items-center justify-center p-3 sm:p-4">
        <div className="w-full max-w-2xl">
          <div className="bg-white dark:bg-gray-800 rounded-2xl shadow-2xl border border-gray-100 dark:border-gray-700 overflow-hidden">
            {/* Header */}
            <div className="bg-gradient-to-br from-slate-700 to-slate-900 dark:from-slate-800 dark:to-slate-900 px-4 sm:px-6 py-6 sm:py-8 text-center">
              <div className="w-12 h-12 sm:w-16 sm:h-16 bg-white/10 backdrop-blur rounded-2xl flex items-center justify-center mx-auto mb-3 sm:mb-4 border border-white/20">
                <Shield className="w-6 h-6 sm:w-8 sm:h-8 text-white" />
              </div>
              <h1 className="text-xl sm:text-2xl font-bold text-white">Admin Panel</h1>
              <p className="text-slate-300 text-xs sm:text-sm mt-1">Secure Access Required</p>
            </div>

            {/* Form */}
            <form onSubmit={handlePasswordSubmit} className="p-4 sm:p-6 space-y-4 sm:space-y-5">
              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                  Account Password
                </label>
                <input
                  type="password"
                  value={passwordInput}
                  onChange={(e) => setPasswordInput(e.target.value)}
                  placeholder="Enter your account password"
                  className={`w-full px-4 py-3 rounded-xl border ${passwordError
                    ? 'border-red-400 focus:ring-red-400 bg-red-50 dark:bg-red-900/20'
                    : 'border-gray-200 dark:border-gray-600 focus:ring-slate-500 bg-gray-50 dark:bg-gray-700'
                    } text-gray-900 dark:text-white placeholder-gray-400 focus:outline-none focus:ring-2 transition-all`}
                  autoFocus
                  disabled={isVerifying}
                />
                {passwordError && (
                  <p className="mt-2 text-sm text-red-500 flex items-center gap-1">
                    <X className="w-4 h-4" />
                    Incorrect password. Please try again.
                  </p>
                )}
              </div>

              {/* Stay logged in checkbox */}
              <label className="flex items-center gap-3 cursor-pointer group">
                <div className="relative">
                  <input
                    type="checkbox"
                    checked={stayLoggedIn}
                    onChange={(e) => setStayLoggedIn(e.target.checked)}
                    className="sr-only peer"
                  />
                  <div className="w-5 h-5 border-2 border-gray-300 dark:border-gray-600 rounded peer-checked:border-slate-600 peer-checked:bg-slate-600 transition-all flex items-center justify-center">
                    {stayLoggedIn && <Check className="w-3 h-3 text-white" />}
                  </div>
                </div>
                <div>
                  <span className="text-sm font-medium text-gray-700 dark:text-gray-300">Stay logged in</span>
                  <p className="text-xs text-gray-500 dark:text-gray-400">Keep admin access for 7 days</p>
                </div>
              </label>

              <button
                type="submit"
                disabled={isVerifying || !passwordInput}
                className="w-full py-3 bg-gradient-to-r from-slate-700 to-slate-900 hover:from-slate-800 hover:to-slate-950 disabled:from-slate-400 disabled:to-slate-500 text-white font-semibold rounded-xl transition-all shadow-lg disabled:cursor-not-allowed flex items-center justify-center gap-2"
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

              <div className="bg-slate-50 dark:bg-slate-800/60 border border-slate-200 dark:border-slate-700 rounded-xl p-4 space-y-3">
                <p className="text-sm text-slate-600 dark:text-slate-300 flex items-start gap-2">
                  <LogIn className="w-4 h-4 mt-0.5 flex-shrink-0" />
                  <span>One-tap Google SSO. We’ll verify your Google profile and unlock admin after the redirect.</span>
                </p>
                <button
                  type="button"
                  onClick={handleGoogleAdminAccess}
                  disabled={isGoogleAuthing}
                  className="w-full py-3 border border-slate-200 dark:border-slate-600 bg-white dark:bg-slate-800 text-slate-700 dark:text-slate-200 font-semibold rounded-xl transition-all shadow-sm hover:bg-slate-50 dark:hover:bg-slate-700 disabled:opacity-70 flex items-center justify-center gap-2"
                >
                  {isGoogleAuthing ? (
                    <>
                      <div className="w-5 h-5 border-2 border-slate-400 border-t-transparent rounded-full animate-spin" />
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
                className="w-full py-3 text-gray-500 dark:text-gray-400 font-medium hover:text-gray-700 dark:hover:text-gray-200 transition-colors"
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
    <div className="min-h-screen bg-gray-50 dark:bg-gray-900 pb-24">
      {/* Header */}
      <div className="sticky top-0 z-20 w-full bg-gray-50 dark:bg-gray-900 py-3">
        <div className="max-w-4xl mx-auto px-4">
          <div className="bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-xl px-4 py-3 sm:px-5 sm:py-4 flex items-center justify-between shadow-sm">
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
            </div>
          </div>
        </div>
      </div>

      <div className="max-w-4xl mx-auto px-3 sm:px-4 py-4 sm:py-6 space-y-4 sm:space-y-6">
        {/* Print Attendance Sheet Button */}
        <div className="flex justify-end animate-fade-in-up">
          <button
            onClick={printAttendanceSheet}
            className="flex items-center gap-2 px-4 py-2 bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-xl text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-700 transition-colors shadow-sm"
          >
            <Printer className="w-4 h-4" />
            <span className="text-sm font-medium">Print Attendance Sheet</span>
          </button>
        </div>

        {/* Quick Stats */}
        <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-2.5 sm:gap-4 animate-fade-in-up transition-all duration-500 ease-[cubic-bezier(0.4,0,0.2,1)] grid-animate">
          <div className="bg-white dark:bg-gray-800 rounded-xl sm:rounded-2xl p-3 sm:p-4 border border-gray-200 dark:border-gray-700 shadow-sm">
            <div className="flex items-center gap-2 sm:gap-3">
              <div className="p-1.5 sm:p-2 bg-orange-100 dark:bg-orange-900/30 rounded-lg sm:rounded-xl">
                <Users className="w-4 h-4 sm:w-5 sm:h-5 text-orange-600 dark:text-orange-400" />
              </div>
              <div>
                <p className="text-xl sm:text-2xl font-bold text-gray-900 dark:text-white">{stats.totalMembers}</p>
                <p className="text-[10px] sm:text-xs text-gray-500 dark:text-gray-400">Total Members</p>
              </div>
            </div>
          </div>

          <div className="bg-white dark:bg-gray-800 rounded-xl sm:rounded-2xl p-3 sm:p-4 border border-gray-200 dark:border-gray-700 shadow-sm">
            <div className="flex items-center gap-2 sm:gap-3">
              <div className="p-1.5 sm:p-2 bg-green-100 dark:bg-green-900/30 rounded-lg sm:rounded-xl">
                <CheckCircle2 className="w-4 h-4 sm:w-5 sm:h-5 text-green-600 dark:text-green-400" />
              </div>
              <div>
                <p className="text-xl sm:text-2xl font-bold text-green-600 dark:text-green-400">{stats.totalPresent}</p>
                <p className="text-[10px] sm:text-xs text-gray-500 dark:text-gray-400">Total Present</p>
              </div>
            </div>
          </div>

          <div className="bg-white dark:bg-gray-800 rounded-xl sm:rounded-2xl p-3 sm:p-4 border border-gray-200 dark:border-gray-700 shadow-sm">
            <div className="flex items-center gap-2 sm:gap-3">
              <div className="p-1.5 sm:p-2 bg-red-100 dark:bg-red-900/30 rounded-lg sm:rounded-xl">
                <XCircle className="w-4 h-4 sm:w-5 sm:h-5 text-red-600 dark:text-red-400" />
              </div>
              <div>
                <p className="text-xl sm:text-2xl font-bold text-red-600 dark:text-red-400">{stats.totalAbsent}</p>
                <p className="text-[10px] sm:text-xs text-gray-500 dark:text-gray-400">Total Absent</p>
              </div>
            </div>
          </div>

          <div className="bg-white dark:bg-gray-800 rounded-xl sm:rounded-2xl p-3 sm:p-4 border border-gray-200 dark:border-gray-700 shadow-sm">
            <div className="flex items-center gap-2 sm:gap-3">
              <div className="p-1.5 sm:p-2 bg-purple-100 dark:bg-purple-900/30 rounded-lg sm:rounded-xl">
                <TrendingUp className="w-4 h-4 sm:w-5 sm:h-5 text-purple-600 dark:text-purple-400" />
              </div>
              <div>
                <p className="text-xl sm:text-2xl font-bold text-purple-600 dark:text-purple-400">{stats.attendanceRate}%</p>
                <p className="text-[10px] sm:text-xs text-gray-500 dark:text-gray-400">Attendance Rate</p>
              </div>
            </div>
          </div>
        </div>

        {/* Advanced Features - Collapsible */}
        <div className="bg-white dark:bg-gray-800 rounded-2xl border border-gray-200 dark:border-gray-700 overflow-hidden animate-fade-in-up" style={{ animationDelay: '100ms' }}>
          <button
            onClick={() => setShowAdvancedFeatures(!showAdvancedFeatures)}
            className="w-full p-4 flex items-center justify-between hover:bg-gray-50 dark:hover:bg-gray-700/50 transition-colors"
          >
            <div className="flex items-center gap-3">
              <div className="p-2 bg-gray-100 dark:bg-gray-700 rounded-xl">
                <Award className="w-5 h-5 text-gray-600 dark:text-gray-400" />
              </div>
              <div className="text-left">
                <h3 className="font-semibold text-gray-900 dark:text-white">Advanced Features</h3>
                <p className="text-xs text-gray-500 dark:text-gray-400">Badge processing & automation</p>
              </div>
            </div>
            <ChevronDown className={`w-5 h-5 text-gray-400 transition-transform ${showAdvancedFeatures ? 'rotate-180' : ''}`} />
          </button>

          {showAdvancedFeatures && (
            <div className="p-4 pt-0 border-t border-gray-200 dark:border-gray-700">
              {/* Badge Processing Content */}
              <div className="bg-gradient-to-br from-orange-500 to-purple-600 rounded-xl p-5 text-white mt-4">
                <div className="flex items-start justify-between">
                  <div>
                    <div className="flex items-center gap-2 mb-2">
                      <Sparkles className="w-5 h-5" />
                      <h4 className="font-bold">Badge Processing</h4>
                    </div>
                    <p className="text-white/80 text-sm mb-3">
                      Auto-assign badges based on attendance
                    </p>
                    <div className="space-y-1 text-xs text-white/70">
                      <p>• <span className="text-orange-200 font-medium">Member</span> = 2+ Sundays</p>
                      <p>• <span className="text-green-200 font-medium">Regular</span> = 3+ consecutive</p>
                    </div>
                  </div>
                  <div className="text-right">
                    <div className="text-2xl font-bold">{stats.sundaysCompleted}/{stats.totalSundays}</div>
                    <p className="text-xs text-white/70">Sundays</p>
                  </div>
                </div>

                <button
                  onClick={processBadges}
                  disabled={isProcessingBadges || stats.sundaysCompleted < stats.totalSundays}
                  className={`w-full mt-4 py-2.5 rounded-lg font-semibold flex items-center justify-center gap-2 transition-all text-sm ${stats.sundaysCompleted < stats.totalSundays
                    ? 'bg-white/20 text-white/50 cursor-not-allowed'
                    : 'bg-white text-orange-600 hover:bg-orange-50 shadow-lg btn-press'
                    }`}
                >
                  {isProcessingBadges ? (
                    <>
                      <RefreshCw className="w-4 h-4 animate-spin" />
                      Processing...
                    </>
                  ) : stats.sundaysCompleted < stats.totalSundays ? (
                    <>
                      <AlertTriangle className="w-4 h-4" />
                      Complete All Sundays First
                    </>
                  ) : (
                    <>
                      <Sparkles className="w-4 h-4" />
                      Process Badges
                    </>
                  )}
                </button>
              </div>
            </div>
          )}
        </div>

        {/* Badge Results */}
        {badgeResults && showBadgeResults && (
          <div className="bg-white dark:bg-gray-800 rounded-2xl border border-gray-200 dark:border-gray-700 overflow-hidden animate-fade-in-up">
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

        {/* Ministry Management */}
        <div className="bg-white dark:bg-gray-800 rounded-2xl border border-gray-200 dark:border-gray-700 overflow-hidden animate-fade-in-up" style={{ animationDelay: '300ms' }}>
          <div className="p-4 border-b border-gray-200 dark:border-gray-700">
            <h3 className="font-semibold text-gray-900 dark:text-white flex items-center gap-2">
              <Tags className="w-5 h-5 text-primary-500" />
              Ministry/Groups
            </h3>
            <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">Manage ministry tags for members</p>
          </div>
          <div className="p-4">
            {/* Add new ministry */}
            <div className="flex gap-2 mb-4">
              <input
                type="text"
                value={newMinistry}
                onChange={(e) => setNewMinistry(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && addMinistry()}
                placeholder="Add new ministry..."
                className="flex-1 px-3 py-2 text-sm border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-gray-900 dark:text-white placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-primary-500"
              />
              <button
                onClick={addMinistry}
                disabled={!newMinistry.trim()}
                className="px-3 py-2 bg-primary-600 hover:bg-primary-700 disabled:bg-gray-300 dark:disabled:bg-gray-600 text-white rounded-lg transition-colors"
              >
                <Plus className="w-4 h-4" />
              </button>
            </div>
            {/* Ministry list */}
            <div className="space-y-2 max-h-48 overflow-y-auto">
              {ministries.map((ministry) => (
                <div key={ministry} className="flex items-center justify-between py-2 px-3 bg-gray-50 dark:bg-gray-700/50 rounded-lg group">
                  {editingMinistry === ministry ? (
                    <input
                      type="text"
                      value={editMinistryValue}
                      onChange={(e) => setEditMinistryValue(e.target.value)}
                      onKeyDown={(e) => e.key === 'Enter' && saveEditMinistry()}
                      onBlur={saveEditMinistry}
                      autoFocus
                      className="flex-1 px-2 py-1 text-sm border border-primary-500 rounded bg-white dark:bg-gray-700 text-gray-900 dark:text-white focus:outline-none"
                    />
                  ) : (
                    <span className="text-sm text-gray-700 dark:text-gray-300">{ministry}</span>
                  )}
                  <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                    <button
                      onClick={() => startEditMinistry(ministry)}
                      className="p-1 text-gray-400 hover:text-primary-500 transition-colors"
                      title="Edit"
                    >
                      <Edit3 className="w-3.5 h-3.5" />
                    </button>
                    <button
                      onClick={() => deleteMinistry(ministry)}
                      className="p-1 text-gray-400 hover:text-red-500 transition-colors"
                      title="Delete"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  </div>
                </div>
              ))}
            </div>
            {ministries.length === 0 && (
              <p className="text-center text-gray-400 py-4 text-sm">No ministries added yet</p>
            )}
          </div>
        </div>

        {/* Top Attendees */}
        <div className="bg-white dark:bg-gray-800 rounded-2xl border border-gray-200 dark:border-gray-700 overflow-hidden animate-fade-in-up" style={{ animationDelay: '400ms' }}>
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
    </div>
  )
}

export default AdminPanel
