import React, { useState, useEffect } from 'react'
import { useApp } from '../context/AppContext'
import { useTheme } from '../context/ThemeContext'
import { toast } from 'react-toastify'
import { 
  Users, 
  TrendingUp, 
  Calendar, 
  Award, 
  UserCheck, 
  Clock, 
  BarChart3,
  Filter,
  Star,
  Activity,
  Bell,
  Phone,
  AlertTriangle,
  X,
  ChevronDown,
  ChevronUp
} from 'lucide-react'

const AttendanceAnalytics = () => {
  const { 
    supabase, 
    isSupabaseConfigured,
    members, 
    currentTable, 
    attendanceData, 
    calculateAttendanceRate, 
    calculateMemberBadge,
    updateMemberBadges,
    toggleMemberBadge,
    availableSundayDates,
    isMonthAttendanceComplete,
    updateMember
  } = useApp()
  const { isDarkMode } = useTheme()

  // Helper function to get latest attendance status for a member
  const getLatestAttendanceStatus = (member) => {
    const attendanceDates = Object.keys(attendanceData).sort().reverse()
    
    for (const date of attendanceDates) {
      const memberAttendance = attendanceData[date]?.[member.id]
      if (memberAttendance !== undefined) {
        return memberAttendance
      }
    }
    return null
  }

  // Helper function to convert badge types to display names
  const getBadgeDisplayName = (badgeType) => {
    const badgeNames = {
      'member': 'Member',
      'regular': 'Regular Attendee',
      'newcomer': 'Newcomer'
    }
    return badgeNames[badgeType] || badgeType
  }
  
  const [analytics, setAnalytics] = useState({
    regularAttendees: [],
    attendanceStats: [],
    monthlyTrends: [],
    newcomers: [],
    membersByBadge: {},
    attendanceByLevel: {},
    newMemberTrends: []
  })
  
  const [filters, setFilters] = useState({
    monthsBack: 6,
    minAttendanceRate: 75,
    newcomerMonths: 3
  })
  
  // Add badge filter state
  const [badgeFilter, setBadgeFilter] = useState([])
  
  const [loading, setLoading] = useState(false)
  const [activeTab, setActiveTab] = useState('badges') // badges, regulars, trends, newcomers, stats
  const [selectedMember, setSelectedMember] = useState(null)
  const [showBadgeModal, setShowBadgeModal] = useState(false)
  const [showNotifications, setShowNotifications] = useState(true)
  const [outreachData, setOutreachData] = useState({
    lowAttendance: [],
    longAbsent: [],
    newcomersNeedingFollowup: []
  })

  // Badge processing state
  const [badgeResults, setBadgeResults] = useState(null)
  const [isProcessingBadges, setIsProcessingBadges] = useState(false)
  const [isBadgeResultsOpen, setIsBadgeResultsOpen] = useState(false)

  // Calculate analytics from local member data
  const calculateAnalytics = () => {
    setLoading(true)
    
    try {
      // Update member badges first
      updateMemberBadges()
      
      // Calculate members by badge type
      const membersByBadge = {}
      const attendanceByLevel = {}
      const regularAttendees = []
      const newcomers = []
      
      members.forEach(member => {
        const badgeType = calculateMemberBadge(member)
        const attendanceRate = calculateAttendanceRate(member)
        const level = member['Current Level'] || 'Unknown'
        const joinDate = new Date(member['Join Date'] || member.inserted_at)
        const daysSinceJoin = Math.floor((Date.now() - joinDate) / (1000 * 60 * 60 * 24))
        
        // Group by badge type
        if (!membersByBadge[badgeType]) {
          membersByBadge[badgeType] = []
        }
        membersByBadge[badgeType].push({
          ...member,
          attendanceRate,
          badgeType,
          daysSinceJoin
        })
        
        // Group by education level
        if (!attendanceByLevel[level]) {
          attendanceByLevel[level] = { total: 0, totalAttendance: 0, members: [] }
        }
        attendanceByLevel[level].total++
        attendanceByLevel[level].totalAttendance += attendanceRate
        attendanceByLevel[level].members.push(member)
        
        // Regular attendees (75%+ attendance)
        if (attendanceRate >= filters.minAttendanceRate) {
          regularAttendees.push({
            member_id: member.id,
            member_name: member['full_name'] || member['Full Name'],
            attendance_rate: attendanceRate,
            total_attended: Math.round((attendanceRate / 100) * 4), // Assuming 4 Sundays per month
            total_possible: 4,
            last_attendance: new Date().toISOString(),
            badge_type: badgeType
          })
        }
        
        // Newcomers (joined within specified months)
        if (daysSinceJoin <= filters.newcomerMonths * 30) {
          newcomers.push({
            member_id: member.id,
            member_name: member['full_name'] || member['Full Name'],
            join_date: joinDate.toISOString(),
            attendance_rate: attendanceRate,
            days_since_join: daysSinceJoin,
            badge_type: badgeType
          })
        }
      })
      
      // Calculate average attendance by level
      Object.keys(attendanceByLevel).forEach(level => {
        attendanceByLevel[level].averageAttendance = 
          attendanceByLevel[level].total > 0 
            ? Math.round(attendanceByLevel[level].totalAttendance / attendanceByLevel[level].total)
            : 0
      })
      
      // Sort regular attendees by attendance rate
      regularAttendees.sort((a, b) => b.attendance_rate - a.attendance_rate)
      
      // Sort newcomers by join date (newest first)
      newcomers.sort((a, b) => new Date(b.join_date) - new Date(a.join_date))
      
      // Calculate outreach data
      const lowAttendance = []
      const longAbsent = []
      const newcomersNeedingFollowup = []
      
      members.forEach(member => {
        const attendanceRate = calculateAttendanceRate(member)
        const joinDate = new Date(member['Join Date'] || member.inserted_at)
        const daysSinceJoin = Math.floor((Date.now() - joinDate) / (1000 * 60 * 60 * 24))
        const phone = member['Phone Number'] || member.phone || 'No phone number'
        
        // Low attendance (below 50%)
        if (attendanceRate < 50 && attendanceRate > 0) {
          lowAttendance.push({
            id: member.id,
            name: member['full_name'] || member['Full Name'],
            phone: phone,
            attendanceRate: attendanceRate,
            lastAttendance: 'Recent', // This would need actual last attendance data
            reason: 'Low attendance rate'
          })
        }
        
        // Long absent (0% attendance and been member for more than 30 days)
        if (attendanceRate === 0 && daysSinceJoin > 30) {
          longAbsent.push({
            id: member.id,
            name: member['full_name'] || member['Full Name'],
            phone: phone,
            daysSinceJoin: daysSinceJoin,
            reason: 'No recent attendance'
          })
        }
        
        // Newcomers needing follow-up (joined within 60 days, low attendance)
        if (daysSinceJoin <= 60 && attendanceRate < 75) {
          newcomersNeedingFollowup.push({
            id: member.id,
            name: member['full_name'] || member['Full Name'],
            phone: phone,
            attendanceRate: attendanceRate,
            daysSinceJoin: daysSinceJoin,
            reason: 'New member with low attendance'
          })
        }
      })
      
      setOutreachData({
        lowAttendance,
        longAbsent,
        newcomersNeedingFollowup
      })
      
      setAnalytics({
        regularAttendees,
        attendanceStats: Object.entries(attendanceByLevel).map(([level, data]) => ({
          level,
          total_members: data.total,
          average_attendance: data.averageAttendance
        })),
        monthlyTrends: [], // Will be calculated from historical data if available
        newcomers,
        membersByBadge,
        attendanceByLevel,
        newMemberTrends: [] // Will be calculated from historical data if available
      })
      
    } catch (error) {
      console.error('Error calculating analytics:', error)
    } finally {
      setLoading(false)
    }
  }

  // Process badges manually and show results
  const processBadgesManually = async () => {
    setIsProcessingBadges(true)
    setBadgeResults(null)
    
    try {
      console.log('Starting badge processing...')
      console.log('Available Sunday dates:', availableSundayDates)
      console.log('Attendance data:', attendanceData)
      console.log('Members count:', members.length)
      
      // Check if month is complete
      const monthComplete = isMonthAttendanceComplete()
      console.log('Is month complete?', monthComplete)
      
      if (!monthComplete) {
        toast.error('Month is not complete yet. All Sundays must have attendance data.')
        setIsProcessingBadges(false)
        return
      }

      const results = {
        qualified: [],
        notQualified: [],
        totalProcessed: 0
      }

      // Check each member for 3 consecutive Sundays
      for (const member of members) {
        results.totalProcessed++
        
        // Check for 3 consecutive Present attendances
        const sortedSundays = [...availableSundayDates].sort((a, b) => a - b)
        let consecutiveCount = 0
        let hasThreeConsecutive = false
        
        for (const sunday of sortedSundays) {
          const dateKey = sunday.toISOString().split('T')[0]
          const memberStatus = attendanceData[dateKey]?.[member.id]
          
          if (memberStatus === true) {
            consecutiveCount++
            if (consecutiveCount >= 3) {
              hasThreeConsecutive = true
              break
            }
          } else if (memberStatus === false) {
            consecutiveCount = 0
          } else {
            consecutiveCount = 0
          }
        }

        // Build Sunday attendance breakdown
        const sundayAttendance = sortedSundays.map(sunday => {
          const dateKey = sunday.toISOString().split('T')[0]
          const status = attendanceData[dateKey]?.[member.id]
          return {
            date: sunday.toLocaleDateString('en-US', { month: 'short', day: 'numeric' }),
            status: status === true ? 'Present' : status === false ? 'Absent' : 'Not Marked'
          }
        })

        const memberInfo = {
          id: member.id,
          name: member['full_name'] || member['Full Name'],
          phone: member['Phone Number'] || member['phone_number'] || 'No phone',
          currentBadge: member['Badge Type'] || 'newcomer',
          sundayAttendance: sundayAttendance
        }

        if (hasThreeConsecutive) {
          // Only update if not already regular or vip
          if (member['Badge Type'] !== 'regular' && member['Badge Type'] !== 'vip') {
            await updateMember(member.id, {
              'Badge Type': 'regular'
            })
            memberInfo.badgeAssigned = true
          } else {
            memberInfo.badgeAssigned = false
            memberInfo.reason = 'Already has regular or vip badge'
          }
          results.qualified.push(memberInfo)
        } else {
          memberInfo.reason = 'Did not attend 3 consecutive Sundays'
          results.notQualified.push(memberInfo)
        }
      }

      setBadgeResults(results)
      setIsBadgeResultsOpen(true) // Auto-open results after processing
      toast.success(`Badge processing complete! ${results.qualified.filter(m => m.badgeAssigned).length} badges assigned.`)
    } catch (error) {
      console.error('Error processing badges:', error)
      console.error('Error details:', error.message, error.stack)
      // Show the actual error message to the user
      toast.error(`Failed to process badges: ${error.message || error.toString()}`)
    } finally {
      setIsProcessingBadges(false)
    }
  }

  useEffect(() => {
    if (members.length > 0) {
      calculateAnalytics()
    }
  }, [members, filters])

  // Member Badges Tab
  const MemberBadgesTab = () => (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h3 className={`text-xl font-semibold transition-colors ${isDarkMode ? 'text-white' : 'text-gray-900'}`}>
          Member Badges & Categories
        </h3>
        <div className="text-sm text-gray-500 dark:text-gray-400">
          {members.length} total members
        </div>
      </div>

      {/* Badge Statistics */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        {Object.entries(analytics.membersByBadge).map(([badgeType, badgeMembers]) => (
          <div 
            key={badgeType}
            className={`rounded-lg border p-4 transition-colors ${isDarkMode ? 'bg-gray-800 border-gray-700' : 'bg-white border-gray-200'}`}
          >
            <div className="text-center">
              <div className={`text-2xl font-bold ${
                badgeType === 'regular' ? 'text-green-500' :
                badgeType === 'member' ? 'text-orange-500' :
                badgeType === 'newcomer' ? 'text-yellow-500' :
                'text-gray-500'
              }`}>
                {badgeMembers.length}
              </div>
              <div className={`text-sm font-medium transition-colors ${isDarkMode ? 'text-gray-300' : 'text-gray-700'}`}>
                {getBadgeDisplayName(badgeType)}
              </div>
            </div>
          </div>
        ))}
      </div>

      {/* Members by Badge Type */}
      <div className="space-y-6">
        {Object.entries(analytics.membersByBadge).map(([badgeType, badgeMembers]) => (
          <div key={badgeType} className="space-y-3">
            <div className="flex items-center gap-2">
              <div className={`w-3 h-3 rounded-full ${
                badgeType === 'regular' ? 'bg-green-500' :
                badgeType === 'member' ? 'bg-orange-500' :
                badgeType === 'newcomer' ? 'bg-yellow-500' :
                'bg-gray-500'
              }`}></div>
              <h4 className={`font-semibold transition-colors ${isDarkMode ? 'text-white' : 'text-gray-900'}`}>
                {getBadgeDisplayName(badgeType)} ({badgeMembers.length})
              </h4>
            </div>
            
            <div className="grid gap-3">
              {badgeMembers.map((member) => (
                <div 
                  key={member.id}
                  className={`rounded-lg border p-3 transition-colors ${isDarkMode ? 'bg-gray-800 border-gray-700' : 'bg-white border-gray-200'}`}
                >
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-3">
                      <div className={`w-8 h-8 rounded-full flex items-center justify-center text-white text-sm font-semibold ${
                        badgeType === 'regular' ? 'bg-green-500' :
                        badgeType === 'member' ? 'bg-orange-500' :
                        badgeType === 'newcomer' ? 'bg-yellow-500' :
                        'bg-gray-500'
                      }`}>
                        {(member['full_name'] || member['Full Name'])?.charAt(0) || '?'}
                      </div>
                      <div>
                        <div className="flex items-center gap-2">
                          <h5 className={`font-medium transition-colors ${isDarkMode ? 'text-white' : 'text-gray-900'}`}>
                            {member['full_name'] || member['Full Name']}
                          </h5>
                          {(() => {
                            const attendanceStatus = getLatestAttendanceStatus(member)
                            if (attendanceStatus === true) {
                              return (
                                <span className="inline-flex items-center px-2 py-1 rounded-full text-xs font-bold bg-green-800 dark:bg-green-700 text-white ring-2 ring-green-300 dark:ring-green-400">
                                  P
                                </span>
                              )
                            } else if (attendanceStatus === false) {
                              return (
                                <span className="inline-flex items-center px-2 py-1 rounded-full text-xs font-bold bg-red-800 dark:bg-red-700 text-white ring-2 ring-red-300 dark:ring-red-400">
                                  A
                                </span>
                              )
                            }
                            return null
                          })()}
                        </div>
                        <p className={`text-sm transition-colors ${isDarkMode ? 'text-gray-400' : 'text-gray-600'}`}>
                          {member['Current Level']} • {member.attendanceRate}% attendance
                        </p>
                      </div>
                    </div>
                    <div className="flex items-center gap-2">
                      <div className="text-right">
                        <div className={`text-sm font-medium ${
                          member.attendanceRate >= 90 ? 'text-green-500' :
                          member.attendanceRate >= 75 ? 'text-orange-500' :
                          member.attendanceRate >= 50 ? 'text-yellow-500' :
                          'text-red-500'
                        }`}>
                          {member.attendanceRate}%
                        </div>
                        <div className={`text-xs transition-colors ${isDarkMode ? 'text-gray-400' : 'text-gray-600'}`}>
                          {member.daysSinceJoin} days
                        </div>
                      </div>
                      <button
                        onClick={() => {
                          setSelectedMember(member)
                          setShowBadgeModal(true)
                        }}
                        className={`px-2 py-1 text-xs rounded transition-colors ${
                          isDarkMode 
                            ? 'bg-gray-700 text-gray-300 hover:bg-gray-600' 
                            : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
                        }`}
                      >
                        Edit Badge
                      </button>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        ))}
      </div>
    </div>
  )

  // Regular Attendees Tab
  const RegularAttendeesTab = () => (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h3 className={`text-xl font-semibold transition-colors ${isDarkMode ? 'text-white' : 'text-gray-900'}`}>
          Regular Attendees ({analytics.regularAttendees.length})
        </h3>
        <div className="flex items-center gap-2">
          <Star className="w-5 h-5 text-yellow-500" />
          <span className={`text-sm transition-colors ${isDarkMode ? 'text-gray-400' : 'text-gray-600'}`}>
            75%+ attendance rate
          </span>
        </div>
      </div>

      <div className="grid gap-4">
        {analytics.regularAttendees.map((member, index) => (
          <div 
            key={member.member_id} 
            className={`rounded-lg border p-4 transition-colors ${isDarkMode ? 'bg-gray-800 border-gray-700' : 'bg-white border-gray-200'}`}
          >
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-3">
                <div className={`w-10 h-10 rounded-full flex items-center justify-center font-semibold text-white ${
                  index === 0 ? 'bg-yellow-500' : 
                  index === 1 ? 'bg-gray-400' : 
                  index === 2 ? 'bg-amber-600' : 'bg-orange-500'
                }`}>
                  {index < 3 ? (index + 1) : <UserCheck className="w-5 h-5" />}
                </div>
                <div>
                  <h4 className={`font-semibold transition-colors ${isDarkMode ? 'text-white' : 'text-gray-900'}`}>
                    {member.member_name}
                  </h4>
                  <p className={`text-sm transition-colors ${isDarkMode ? 'text-gray-400' : 'text-gray-600'}`}>
                    {member.total_attended} of {member.total_possible} Sundays
                  </p>
                </div>
              </div>
              <div className="text-right">
                <div className={`text-2xl font-bold ${
                  member.attendance_rate >= 95 ? 'text-green-500' :
                  member.attendance_rate >= 85 ? 'text-orange-500' :
                  'text-yellow-500'
                }`}>
                  {member.attendance_rate}%
                </div>
                <p className={`text-xs transition-colors ${isDarkMode ? 'text-gray-400' : 'text-gray-600'}`}>
                  Last: {member.last_attendance ? new Date(member.last_attendance).toLocaleDateString() : 'N/A'}
                </p>
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  )

  // Monthly Trends Tab
  const MonthlyTrendsTab = () => (
    <div className="space-y-6">
      <h3 className={`text-xl font-semibold transition-colors ${isDarkMode ? 'text-white' : 'text-gray-900'}`}>
        Monthly Attendance Trends
      </h3>

      <div className="grid gap-4">
        {analytics.monthlyTrends.map((trend) => (
          <div 
            key={trend.month_year}
            className={`rounded-lg border p-4 transition-colors ${isDarkMode ? 'bg-gray-800 border-gray-700' : 'bg-white border-gray-200'}`}
          >
            <div className="flex items-center justify-between mb-3">
              <h4 className={`font-semibold transition-colors ${isDarkMode ? 'text-white' : 'text-gray-900'}`}>
                {new Date(trend.month_year + '-01').toLocaleDateString('en-US', { 
                  year: 'numeric', 
                  month: 'long' 
                })}
              </h4>
              <div className={`text-sm transition-colors ${isDarkMode ? 'text-gray-400' : 'text-gray-600'}`}>
                {trend.total_members} members
              </div>
            </div>
            
            <div className="grid grid-cols-3 gap-4 text-center">
              <div>
                <div className="text-lg font-semibold text-orange-500">
                  {trend.average_attendance}
                </div>
                <div className={`text-xs transition-colors ${isDarkMode ? 'text-gray-400' : 'text-gray-600'}`}>
                  Avg Attendance
                </div>
              </div>
              <div>
                <div className="text-lg font-semibold text-green-500">
                  {trend.highest_attendance}
                </div>
                <div className={`text-xs transition-colors ${isDarkMode ? 'text-gray-400' : 'text-gray-600'}`}>
                  Highest
                </div>
              </div>
              <div>
                <div className="text-lg font-semibold text-orange-500">
                  {trend.lowest_attendance}
                </div>
                <div className={`text-xs transition-colors ${isDarkMode ? 'text-gray-400' : 'text-gray-600'}`}>
                  Lowest
                </div>
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  )

  // Newcomers Tab
  const NewcomersTab = () => (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h3 className={`text-xl font-semibold transition-colors ${isDarkMode ? 'text-white' : 'text-gray-900'}`}>
          Recent Newcomers ({analytics.newcomers.length})
        </h3>
        <div className="flex items-center gap-2">
          <Activity className="w-5 h-5 text-green-500" />
          <span className={`text-sm transition-colors ${isDarkMode ? 'text-gray-400' : 'text-gray-600'}`}>
            Last {filters.newcomerMonths} months
          </span>
        </div>
      </div>

      <div className="grid gap-4">
        {analytics.newcomers.map((newcomer) => (
          <div 
            key={newcomer.member_id}
            className={`rounded-lg border p-4 transition-colors ${isDarkMode ? 'bg-gray-800 border-gray-700' : 'bg-white border-gray-200'}`}
          >
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-full bg-green-500 flex items-center justify-center">
                  <Users className="w-5 h-5 text-white" />
                </div>
                <div>
                  <h4 className={`font-semibold transition-colors ${isDarkMode ? 'text-white' : 'text-gray-900'}`}>
                    {newcomer.member_name}
                  </h4>
                  <p className={`text-sm transition-colors ${isDarkMode ? 'text-gray-400' : 'text-gray-600'}`}>
                    First visit: {new Date(newcomer.first_attendance_date).toLocaleDateString()}
                  </p>
                </div>
              </div>
              <div className="text-right">
                <div className="text-lg font-semibold text-green-500">
                  {newcomer.total_attendances} visits
                </div>
                <p className={`text-xs transition-colors ${isDarkMode ? 'text-gray-400' : 'text-gray-600'}`}>
                  {newcomer.weeks_since_first_visit} weeks ago
                </p>
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  )

  // Badge Management Modal
  const BadgeManagementModal = () => {
    const [selectedBadge, setSelectedBadge] = useState('')
    const [isAssigning, setIsAssigning] = useState(false)
    
    const badgeOptions = [
      { value: '', label: 'Remove Manual Badge' },
      { value: 'VIP Member', label: '👑 VIP Member' },
      { value: 'Youth Leader', label: '🌟 Youth Leader' },
      { value: 'Volunteer', label: '🤝 Volunteer' },
      { value: 'Mentor', label: '👨‍🏫 Mentor' },
      { value: 'Special Recognition', label: '🏆 Special Recognition' }
    ]
    
    const handleAssignBadge = async () => {
      if (!selectedMember) return
      
      setIsAssigning(true)
      try {
        // For special badges in analytics, we'll use the old single-badge approach
        // by clearing existing manual badges and setting the new one
        if (selectedBadge) {
          // Clear existing manual badges first, then add the new one
          const member = members.find(m => m.id === selectedMember.id)
          if (member && member['Manual Badges']) {
            // Remove all existing manual badges
            const existingBadges = Array.isArray(member['Manual Badges']) 
              ? member['Manual Badges'] 
              : JSON.parse(member['Manual Badges'] || '[]')
            
            for (const badge of existingBadges) {
              await toggleMemberBadge(selectedMember.id, badge)
            }
          }
          // Add the new badge
          await toggleMemberBadge(selectedMember.id, selectedBadge)
        } else {
          // Remove all manual badges if selectedBadge is empty
          const member = members.find(m => m.id === selectedMember.id)
          if (member && member['Manual Badges']) {
            const existingBadges = Array.isArray(member['Manual Badges']) 
              ? member['Manual Badges'] 
              : JSON.parse(member['Manual Badges'] || '[]')
            
            for (const badge of existingBadges) {
              await toggleMemberBadge(selectedMember.id, badge)
            }
          }
        }
        
        setShowBadgeModal(false)
        setSelectedMember(null)
        setSelectedBadge('')
        // Recalculate analytics
        calculateAnalytics()
      } catch (error) {
        console.error('Error assigning badge:', error)
      } finally {
        setIsAssigning(false)
      }
    }
    
    if (!showBadgeModal || !selectedMember) return null
    
    return (
      <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
        <div className={`rounded-lg p-6 w-full max-w-md mx-4 ${isDarkMode ? 'bg-gray-800' : 'bg-white'}`}>
          <h3 className={`text-lg font-semibold mb-4 transition-colors ${isDarkMode ? 'text-white' : 'text-gray-900'}`}>
            Manage Badge for {selectedMember['full_name'] || selectedMember['Full Name']}
          </h3>
          
          <div className="space-y-4">
            <div>
              <label className={`block text-sm font-medium mb-2 transition-colors ${isDarkMode ? 'text-gray-300' : 'text-gray-700'}`}>
                Current Badge: {selectedMember.badgeType || 'None'}
              </label>
              <select
                value={selectedBadge}
                onChange={(e) => setSelectedBadge(e.target.value)}
                className={`w-full p-2 border rounded-md transition-colors ${
                  isDarkMode 
                    ? 'bg-gray-700 border-gray-600 text-white' 
                    : 'bg-white border-gray-300 text-gray-900'
                }`}
              >
                {badgeOptions.map(option => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
            </div>
            
            <div className="flex gap-3">
              <button
                onClick={() => {
                  setShowBadgeModal(false)
                  setSelectedMember(null)
                  setSelectedBadge('')
                }}
                className={`flex-1 px-4 py-2 rounded-md transition-colors ${
                  isDarkMode 
                    ? 'bg-gray-700 text-gray-300 hover:bg-gray-600' 
                    : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
                }`}
              >
                Cancel
              </button>
              <button
                onClick={handleAssignBadge}
                disabled={isAssigning}
                className={`flex-1 px-4 py-2 rounded-md text-white transition-colors ${
                  isAssigning 
                    ? 'bg-gray-400 cursor-not-allowed' 
                    : 'bg-orange-600 hover:bg-orange-700'
                }`}
              >
                {isAssigning ? 'Assigning...' : 'Assign Badge'}
              </button>
            </div>
          </div>
        </div>
      </div>
    )
  }

  // All Stats Tab
  const AllStatsTab = () => (
    <div className="space-y-6">
      <h3 className={`text-xl font-semibold transition-colors ${isDarkMode ? 'text-white' : 'text-gray-900'}`}>
        All Member Statistics
      </h3>

      <div className="grid gap-4">
        {analytics.attendanceStats.map((stat) => (
          <div 
            key={stat.member_id}
            className={`rounded-lg border p-4 transition-colors ${isDarkMode ? 'bg-gray-800 border-gray-700' : 'bg-white border-gray-200'}`}
          >
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-3">
                <div className={`w-10 h-10 rounded-full flex items-center justify-center text-white ${
                  stat.is_regular ? 'bg-green-500' : 'bg-gray-500'
                }`}>
                  {stat.is_regular ? <Award className="w-5 h-5" /> : <Users className="w-5 h-5" />}
                </div>
                <div>
                  <h4 className={`font-semibold transition-colors ${isDarkMode ? 'text-white' : 'text-gray-900'}`}>
                    {stat.member_name}
                  </h4>
                  <p className={`text-sm transition-colors ${isDarkMode ? 'text-gray-400' : 'text-gray-600'}`}>
                    {stat.attended_sundays} of {stat.total_sundays} Sundays
                    {stat.is_regular && <span className="ml-2 text-green-500 font-medium">• Regular</span>}
                  </p>
                </div>
              </div>
              <div className="text-right">
                <div className={`text-xl font-bold ${
                  stat.attendance_rate >= 75 ? 'text-green-500' :
                  stat.attendance_rate >= 50 ? 'text-yellow-500' :
                  'text-red-500'
                }`}>
                  {stat.attendance_rate}%
                </div>
                <p className={`text-xs transition-colors ${isDarkMode ? 'text-gray-400' : 'text-gray-600'}`}>
                  Last: {stat.last_attendance_date ? new Date(stat.last_attendance_date).toLocaleDateString() : 'N/A'}
                </p>
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  )

  return (
    <div className={`min-h-screen transition-colors ${isDarkMode ? 'bg-gray-900' : 'bg-gray-50'}`}>
      <div className="max-w-6xl mx-auto p-6">
        {/* Header */}
        <div className="mb-8">
          <h1 className={`text-3xl font-bold mb-2 transition-colors ${isDarkMode ? 'text-white' : 'text-gray-900'}`}>
            Attendance Analytics
          </h1>
          <p className={`transition-colors ${isDarkMode ? 'text-gray-400' : 'text-gray-600'}`}>
            Track attendance patterns, identify regular attendees, and discover trends
          </p>
        </div>

        {/* Badge Processing Section - Compact */}
        <div className="bg-white dark:bg-gray-800 rounded-lg shadow-sm mb-6 transition-colors">
          <div className="px-4 py-3 border-b border-gray-200 dark:border-gray-700 flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Award className="w-4 h-4 text-green-600 dark:text-green-400" />
              <span className="text-sm font-medium text-gray-900 dark:text-white">Badge Processing</span>
              <span className="text-xs text-gray-500 dark:text-gray-400">3 consecutive Sundays</span>
            </div>
            <button
              onClick={processBadgesManually}
              disabled={isProcessingBadges}
              className="flex items-center px-3 py-1.5 text-sm bg-green-600 text-white rounded-lg hover:bg-green-700 transition-colors disabled:bg-gray-400 disabled:cursor-not-allowed"
            >
              <Award className="w-3 h-3 mr-1.5" />
              {isProcessingBadges ? 'Processing...' : 'Process Badges'}
            </button>
          </div>
          {badgeResults && (
            <div className="p-4">
              {/* Summary Bar - Always Visible */}
              <button
                onClick={() => setIsBadgeResultsOpen(!isBadgeResultsOpen)}
                className="w-full px-4 py-3 bg-gradient-to-r from-orange-50 to-green-50 dark:from-orange-900/20 dark:to-green-900/20 rounded-lg border border-orange-200 dark:border-orange-800 hover:border-orange-300 dark:hover:border-orange-700 transition-colors flex items-center justify-between"
              >
                <div className="flex items-center gap-4">
                  <div className="flex items-center gap-2">
                    <Users className="w-4 h-4 text-orange-600 dark:text-orange-400" />
                    <span className="text-sm font-medium text-gray-900 dark:text-white">
                      {badgeResults.totalProcessed} Processed
                    </span>
                  </div>
                  <div className="flex items-center gap-2">
                    <Award className="w-4 h-4 text-green-600 dark:text-green-400" />
                    <span className="text-sm font-medium text-green-700 dark:text-green-300">
                      {badgeResults.qualified.filter(m => m.badgeAssigned).length} Got Badges
                    </span>
                  </div>
                  <div className="flex items-center gap-2">
                    <X className="w-4 h-4 text-red-600 dark:text-red-400" />
                    <span className="text-sm font-medium text-red-700 dark:text-red-300">
                      {badgeResults.notQualified.length} Didn't Get
                    </span>
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  <span className="text-xs text-gray-500 dark:text-gray-400">
                    {isBadgeResultsOpen ? 'Hide Details' : 'View Details'}
                  </span>
                  {isBadgeResultsOpen ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
                </div>
              </button>

              {/* Detailed Results - Collapsible */}
              {isBadgeResultsOpen && (
                <div className="space-y-4 mt-4">
                  {/* Sunday Attendance Counts */}
                  <div className="bg-purple-50 dark:bg-purple-900/20 rounded-lg p-4 border border-purple-200 dark:border-purple-800">
                    <h3 className="text-lg font-bold text-purple-900 dark:text-purple-100 mb-3 flex items-center">
                      <Calendar className="w-5 h-5 mr-2" />
                      Sunday Attendance Breakdown
                    </h3>
                    <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-5 gap-3">
                      {availableSundayDates.sort((a, b) => a - b).map((sunday, idx) => {
                        const dateKey = sunday.toISOString().split('T')[0]
                        const attendanceForDate = attendanceData[dateKey] || {}
                        const presentCount = Object.values(attendanceForDate).filter(status => status === true).length
                        const absentCount = Object.values(attendanceForDate).filter(status => status === false).length
                        const totalMarked = presentCount + absentCount
                        
                        return (
                          <div
                            key={idx}
                            className="bg-white dark:bg-gray-800 rounded-lg p-3 border border-purple-300 dark:border-purple-700"
                          >
                            <p className="text-sm font-semibold text-purple-900 dark:text-purple-100">
                              {sunday.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}
                            </p>
                            <div className="mt-2 space-y-1">
                              <div className="flex items-center justify-between">
                                <span className="text-xs text-green-600 dark:text-green-400">Present:</span>
                                <span className="text-sm font-bold text-green-700 dark:text-green-300">{presentCount}</span>
                              </div>
                              <div className="flex items-center justify-between">
                                <span className="text-xs text-red-600 dark:text-red-400">Absent:</span>
                                <span className="text-sm font-bold text-red-700 dark:text-red-300">{absentCount}</span>
                              </div>
                              <div className="flex items-center justify-between pt-1 border-t border-purple-200 dark:border-purple-700">
                                <span className="text-xs text-purple-600 dark:text-purple-400">Total:</span>
                                <span className="text-sm font-bold text-purple-700 dark:text-purple-300">{totalMarked}</span>
                              </div>
                            </div>
                          </div>
                        )
                      })}
                    </div>
                  </div>

                  {/* Members Who Didn't Get Badges - With Contact Numbers */}
                  {badgeResults.notQualified.length > 0 && (
                    <div className="bg-red-50 dark:bg-red-900/20 rounded-lg p-4 border border-red-200 dark:border-red-800">
                      <h3 className="text-lg font-bold text-red-900 dark:text-red-100 mb-3 flex items-center">
                        <Phone className="w-5 h-5 mr-2" />
                        Members to Contact ({badgeResults.notQualified.length})
                      </h3>
                      <p className="text-sm text-red-700 dark:text-red-300 mb-4">
                        These members didn't attend 3 consecutive Sundays. Call them to encourage attendance!
                      </p>
                      <div className="max-h-96 overflow-y-auto">
                        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
                          {badgeResults.notQualified.map((member) => (
                            <div
                              key={member.id}
                              className="bg-white dark:bg-gray-800 rounded-lg p-3 border border-red-300 dark:border-red-700"
                            >
                              <p className="font-semibold text-gray-900 dark:text-white">{member.name}</p>
                              <a
                                href={`tel:${member.phone}`}
                                className="flex items-center text-sm text-orange-600 dark:text-orange-400 hover:underline mt-1"
                              >
                                <Phone className="w-3 h-3 mr-1" />
                                {member.phone}
                              </a>
                              <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">{member.reason}</p>
                              {/* Sunday Attendance Breakdown */}
                              <div className="mt-2 pt-2 border-t border-red-200 dark:border-red-800">
                                <p className="text-xs font-medium text-gray-700 dark:text-gray-300 mb-1">Sundays:</p>
                                <div className="flex flex-wrap gap-1">
                                  {member.sundayAttendance?.map((sunday, idx) => (
                                    <div
                                      key={idx}
                                      className={`text-xs px-2 py-1 rounded ${
                                        sunday.status === 'Present'
                                          ? 'bg-green-100 dark:bg-green-900 text-green-700 dark:text-green-300'
                                          : sunday.status === 'Absent'
                                          ? 'bg-red-100 dark:bg-red-900 text-red-700 dark:text-red-300'
                                          : 'bg-gray-100 dark:bg-gray-700 text-gray-600 dark:text-gray-400'
                                      }`}
                                      title={sunday.status}
                                    >
                                      {sunday.date}: {sunday.status === 'Present' ? '✓' : sunday.status === 'Absent' ? '✗' : '?'}
                                    </div>
                                  ))}
                                </div>
                              </div>
                            </div>
                          ))}
                        </div>
                      </div>
                    </div>
                  )}

                  {/* Members Who Got Badges */}
                  {badgeResults.qualified.length > 0 && (
                    <div className="bg-green-50 dark:bg-green-900/20 rounded-lg p-4 border border-green-200 dark:border-green-800">
                      <h3 className="text-lg font-bold text-green-900 dark:text-green-100 mb-3 flex items-center">
                        <Award className="w-5 h-5 mr-2" />
                        Members Who Qualified ({badgeResults.qualified.length})
                      </h3>
                      <div className="max-h-64 overflow-y-auto">
                        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-2">
                          {badgeResults.qualified.map((member) => (
                            <div
                              key={member.id}
                              className="bg-white dark:bg-gray-800 rounded-lg p-3 border border-green-300 dark:border-green-700"
                            >
                              <p className="font-medium text-sm text-gray-900 dark:text-white">{member.name}</p>
                              {member.badgeAssigned ? (
                                <p className="text-xs text-green-600 dark:text-green-400">✓ Badge assigned</p>
                              ) : (
                                <p className="text-xs text-gray-500 dark:text-gray-400">{member.reason}</p>
                              )}
                              {/* Sunday Attendance Breakdown */}
                              <div className="mt-2 pt-2 border-t border-green-200 dark:border-green-800">
                                <div className="flex flex-wrap gap-1">
                                  {member.sundayAttendance?.map((sunday, idx) => (
                                    <div
                                      key={idx}
                                      className={`text-xs px-1.5 py-0.5 rounded ${
                                        sunday.status === 'Present'
                                          ? 'bg-green-100 dark:bg-green-900 text-green-700 dark:text-green-300'
                                          : sunday.status === 'Absent'
                                          ? 'bg-red-100 dark:bg-red-900 text-red-700 dark:text-red-300'
                                          : 'bg-gray-100 dark:bg-gray-700 text-gray-600 dark:text-gray-400'
                                      }`}
                                      title={`${sunday.date}: ${sunday.status}`}
                                    >
                                      {sunday.status === 'Present' ? '✓' : sunday.status === 'Absent' ? '✗' : '?'}
                                    </div>
                                  ))}
                                </div>
                              </div>
                            </div>
                          ))}
                        </div>
                      </div>
                    </div>
                  )}
                </div>
              )}
            </div>
          )}
        </div>

        {/* Notification Panel */}
        {showNotifications && (outreachData.lowAttendance.length > 0 || outreachData.longAbsent.length > 0 || outreachData.newcomersNeedingFollowup.length > 0) && (
          <div className={`rounded-lg border p-4 mb-6 transition-colors ${isDarkMode ? 'bg-orange-900/20 border-orange-500/30' : 'bg-orange-50 border-orange-200'}`}>
            <div className="flex items-start justify-between mb-4">
              <div className="flex items-center gap-2">
                <Bell className={`w-5 h-5 ${isDarkMode ? 'text-orange-400' : 'text-orange-600'}`} />
                <h3 className={`font-semibold transition-colors ${isDarkMode ? 'text-orange-400' : 'text-orange-800'}`}>
                  Member Outreach Needed
                </h3>
              </div>
              <button
                onClick={() => setShowNotifications(false)}
                className={`p-1 rounded hover:bg-opacity-20 transition-colors ${isDarkMode ? 'text-orange-400 hover:bg-orange-400' : 'text-orange-600 hover:bg-orange-600'}`}
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="grid gap-4 md:grid-cols-3">
              {/* Low Attendance */}
              {outreachData.lowAttendance.length > 0 && (
                <div className={`rounded-lg p-3 transition-colors ${isDarkMode ? 'bg-red-900/20 border border-red-500/30' : 'bg-red-50 border border-red-200'}`}>
                  <div className="flex items-center gap-2 mb-2">
                    <AlertTriangle className={`w-4 h-4 ${isDarkMode ? 'text-red-400' : 'text-red-600'}`} />
                    <h4 className={`font-medium text-sm ${isDarkMode ? 'text-red-400' : 'text-red-800'}`}>
                      Low Attendance ({outreachData.lowAttendance.length})
                    </h4>
                  </div>
                  <div className="space-y-2 max-h-32 overflow-y-auto">
                    {outreachData.lowAttendance.slice(0, 3).map((member) => (
                      <div key={member.id} className={`text-xs p-2 rounded transition-colors ${isDarkMode ? 'bg-gray-800' : 'bg-white'}`}>
                        <div className={`font-medium ${isDarkMode ? 'text-white' : 'text-gray-900'}`}>
                          {member.name}
                        </div>
                        <div className="flex items-center gap-1 mt-1">
                          <Phone className="w-3 h-3" />
                          <span className={`${isDarkMode ? 'text-gray-400' : 'text-gray-600'}`}>
                            {member.phone}
                          </span>
                        </div>
                        <div className={`text-xs mt-1 ${isDarkMode ? 'text-red-400' : 'text-red-600'}`}>
                          {member.attendanceRate}% attendance
                        </div>
                      </div>
                    ))}
                    {outreachData.lowAttendance.length > 3 && (
                      <div className={`text-xs text-center ${isDarkMode ? 'text-gray-400' : 'text-gray-600'}`}>
                        +{outreachData.lowAttendance.length - 3} more
                      </div>
                    )}
                  </div>
                </div>
              )}

              {/* Long Absent */}
              {outreachData.longAbsent.length > 0 && (
                <div className={`rounded-lg p-3 transition-colors ${isDarkMode ? 'bg-yellow-900/20 border border-yellow-500/30' : 'bg-yellow-50 border border-yellow-200'}`}>
                  <div className="flex items-center gap-2 mb-2">
                    <Clock className={`w-4 h-4 ${isDarkMode ? 'text-yellow-400' : 'text-yellow-600'}`} />
                    <h4 className={`font-medium text-sm ${isDarkMode ? 'text-yellow-400' : 'text-yellow-800'}`}>
                      Long Absent ({outreachData.longAbsent.length})
                    </h4>
                  </div>
                  <div className="space-y-2 max-h-32 overflow-y-auto">
                    {outreachData.longAbsent.slice(0, 3).map((member) => (
                      <div key={member.id} className={`text-xs p-2 rounded transition-colors ${isDarkMode ? 'bg-gray-800' : 'bg-white'}`}>
                        <div className={`font-medium ${isDarkMode ? 'text-white' : 'text-gray-900'}`}>
                          {member.name}
                        </div>
                        <div className="flex items-center gap-1 mt-1">
                          <Phone className="w-3 h-3" />
                          <span className={`${isDarkMode ? 'text-gray-400' : 'text-gray-600'}`}>
                            {member.phone}
                          </span>
                        </div>
                        <div className={`text-xs mt-1 ${isDarkMode ? 'text-yellow-400' : 'text-yellow-600'}`}>
                          {Math.floor(member.daysSinceJoin)} days since join
                        </div>
                      </div>
                    ))}
                    {outreachData.longAbsent.length > 3 && (
                      <div className={`text-xs text-center ${isDarkMode ? 'text-gray-400' : 'text-gray-600'}`}>
                        +{outreachData.longAbsent.length - 3} more
                      </div>
                    )}
                  </div>
                </div>
              )}

              {/* Newcomers Needing Follow-up */}
              {outreachData.newcomersNeedingFollowup.length > 0 && (
                <div className={`rounded-lg p-3 transition-colors ${isDarkMode ? 'bg-orange-900/20 border border-orange-500/30' : 'bg-orange-50 border border-orange-200'}`}>
                  <div className="flex items-center gap-2 mb-2">
                    <UserCheck className={`w-4 h-4 ${isDarkMode ? 'text-orange-400' : 'text-orange-600'}`} />
                    <h4 className={`font-medium text-sm ${isDarkMode ? 'text-orange-400' : 'text-orange-800'}`}>
                      New Members ({outreachData.newcomersNeedingFollowup.length})
                    </h4>
                  </div>
                  <div className="space-y-2 max-h-32 overflow-y-auto">
                    {outreachData.newcomersNeedingFollowup.slice(0, 3).map((member) => (
                      <div key={member.id} className={`text-xs p-2 rounded transition-colors ${isDarkMode ? 'bg-gray-800' : 'bg-white'}`}>
                        <div className={`font-medium ${isDarkMode ? 'text-white' : 'text-gray-900'}`}>
                          {member.name}
                        </div>
                        <div className="flex items-center gap-1 mt-1">
                          <Phone className="w-3 h-3" />
                          <span className={`${isDarkMode ? 'text-gray-400' : 'text-gray-600'}`}>
                            {member.phone}
                          </span>
                        </div>
                        <div className={`text-xs mt-1 ${isDarkMode ? 'text-orange-400' : 'text-orange-600'}`}>
                          {member.daysSinceJoin} days, {member.attendanceRate}% attendance
                        </div>
                      </div>
                    ))}
                    {outreachData.newcomersNeedingFollowup.length > 3 && (
                      <div className={`text-xs text-center ${isDarkMode ? 'text-gray-400' : 'text-gray-600'}`}>
                        +{outreachData.newcomersNeedingFollowup.length - 3} more
                      </div>
                    )}
                  </div>
                </div>
              )}
            </div>

            <div className={`mt-3 text-xs ${isDarkMode ? 'text-orange-400' : 'text-orange-700'}`}>
              💡 Tip: Click on phone numbers to call members directly for follow-up and encouragement.
            </div>
          </div>
        )}

        {/* Filters */}
        <div className={`rounded-lg border p-4 mb-6 transition-colors ${isDarkMode ? 'bg-gray-800 border-gray-700' : 'bg-white border-gray-200'}`}>
          <div className="space-y-4">
            <div className="flex items-center gap-4 flex-wrap">
              <div className="flex items-center gap-2">
                <Filter className="w-4 h-4" />
                <span className={`text-sm font-medium transition-colors ${isDarkMode ? 'text-white' : 'text-gray-900'}`}>
                  Filters:
                </span>
              </div>
              <div className="flex items-center gap-2">
                <label className={`text-sm transition-colors ${isDarkMode ? 'text-gray-400' : 'text-gray-600'}`}>
                  Months back:
                </label>
                <select 
                  value={filters.monthsBack}
                  onChange={(e) => setFilters(prev => ({ ...prev, monthsBack: parseInt(e.target.value) }))}
                  className={`px-2 py-1 rounded border text-sm transition-colors ${
                    isDarkMode ? 'bg-gray-700 border-gray-600 text-white' : 'bg-white border-gray-300 text-gray-900'
                  }`}
                >
                  <option value={3}>3 months</option>
                  <option value={6}>6 months</option>
                  <option value={12}>12 months</option>
                </select>
              </div>
              <div className="flex items-center gap-2">
                <label className={`text-sm transition-colors ${isDarkMode ? 'text-gray-400' : 'text-gray-600'}`}>
                  Min attendance:
                </label>
                <select 
                  value={filters.minAttendanceRate}
                  onChange={(e) => setFilters(prev => ({ ...prev, minAttendanceRate: parseInt(e.target.value) }))}
                  className={`px-2 py-1 rounded border text-sm transition-colors ${
                    isDarkMode ? 'bg-gray-700 border-gray-600 text-white' : 'bg-white border-gray-300 text-gray-900'
                  }`}
                >
                  <option value={0}>0%</option>
                  <option value={25}>25%</option>
                  <option value={50}>50%</option>
                  <option value={75}>75%</option>
                </select>
              </div>
            </div>
            
            {/* Badge Filters */}
            <div className="flex items-center gap-4 flex-wrap">
              <span className={`text-sm font-medium transition-colors ${isDarkMode ? 'text-gray-300' : 'text-gray-700'}`}>
                Badge Filters:
              </span>
              {['member', 'regular', 'newcomer'].map((badge) => (
                <button
                  key={badge}
                  onClick={() => {
                    setBadgeFilter(prev => 
                      prev.includes(badge) 
                        ? prev.filter(b => b !== badge)
                        : [...prev, badge]
                    )
                  }}
                  className={`px-3 py-1 rounded-full text-sm font-medium transition-colors border ${
                    badgeFilter.includes(badge)
                      ? badge === 'member' 
                        ? 'bg-orange-500 text-white border-orange-500'
                        : badge === 'regular'
                        ? 'bg-green-500 text-white border-green-500'
                        : 'bg-yellow-500 text-white border-yellow-500'
                      : isDarkMode
                        ? 'bg-gray-700 text-gray-300 border-gray-600 hover:bg-gray-600'
                        : 'bg-gray-100 text-gray-700 border-gray-300 hover:bg-gray-200'
                  }`}
                >
                  {getBadgeDisplayName(badge)}
                </button>
              ))}
              {badgeFilter.length > 0 && (
                <button
                  onClick={() => setBadgeFilter([])}
                  className={`px-2 py-1 text-xs rounded transition-colors ${
                    isDarkMode 
                      ? 'text-gray-400 hover:text-white' 
                      : 'text-gray-600 hover:text-gray-900'
                  }`}
                >
                  Clear All
                </button>
              )}
            </div>
          </div>
        </div>

        {/* Tabs */}
        <div className="mb-6">
          <div className="flex space-x-1 rounded-lg bg-gray-100 dark:bg-gray-800 p-1 overflow-x-auto">
            {[
              { id: 'badges', label: 'Member Badges', icon: Award },
              { id: 'regulars', label: 'Regular Attendees', icon: Star },
              { id: 'trends', label: 'Monthly Trends', icon: TrendingUp },
              { id: 'newcomers', label: 'Newcomers', icon: Users },
              { id: 'stats', label: 'All Stats', icon: BarChart3 }
            ].map((tab) => {
              const Icon = tab.icon
              return (
                <button
                  key={tab.id}
                  onClick={() => setActiveTab(tab.id)}
                  className={`flex items-center gap-2 px-4 py-2 rounded-md text-sm font-medium transition-colors whitespace-nowrap ${
                    activeTab === tab.id
                      ? isDarkMode ? 'bg-gray-700 text-white' : 'bg-white text-gray-900 shadow-sm'
                      : isDarkMode ? 'text-gray-400 hover:text-white' : 'text-gray-600 hover:text-gray-900'
                  }`}
                >
                  <Icon className="w-4 h-4" />
                  {tab.label}
                </button>
              )
            })}
          </div>
        </div>

        {/* Content */}
        {loading ? (
          <div className="flex items-center justify-center py-12">
            <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-orange-500"></div>
          </div>
        ) : (
          <div>
            {activeTab === 'badges' && <MemberBadgesTab />}
            {activeTab === 'regulars' && <RegularAttendeesTab />}
            {activeTab === 'trends' && <MonthlyTrendsTab />}
            {activeTab === 'newcomers' && <NewcomersTab />}
            {activeTab === 'stats' && <AllStatsTab />}
          </div>
        )}
      </div>
      
      {/* Badge Management Modal */}
      <BadgeManagementModal />
    </div>
  )
}

export default AttendanceAnalytics
