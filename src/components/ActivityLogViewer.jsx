import React, { useEffect, useMemo, useState } from 'react'
import { supabase } from '../lib/supabase'
import { Activity, CalendarClock, Clock, RefreshCw, Search, Shield, User } from 'lucide-react'

const ActivityLogViewer = () => {
    const [logs, setLogs] = useState([])
    const [loading, setLoading] = useState(true)
    const [query, setQuery] = useState('')
    const [typeFilter, setTypeFilter] = useState('all')

    const fetchLogs = async () => {
        setLoading(true)
        try {
            const { data, error } = await supabase
                .from('activity_logs')
                .select('id,actor_id,actor_email,action,details,target_owner_id,created_at')
                .order('created_at', { ascending: false })
                .limit(80)

            if (error) throw error
            setLogs(data || [])
        } catch (error) {
            console.error('Error fetching activity logs:', error)
        } finally {
            setLoading(false)
        }
    }

    useEffect(() => {
        fetchLogs()
    }, [])

    const getActionType = (action) => {
        const value = String(action || '').toUpperCase()
        if (value.includes('MARK') || value.includes('ATTENDANCE')) return 'attendance'
        if (value.includes('ADD') || value.includes('MEMBER')) return 'members'
        if (value.includes('DELETE') || value.includes('REMOVE')) return 'security'
        if (value.includes('UPDATE') || value.includes('WORKSPACE')) return 'updates'
        return 'other'
    }

    const getActionIcon = (action) => {
        const type = getActionType(action)
        if (type === 'security') return <Shield className="h-4 w-4 text-red-500" />
        if (type === 'members') return <User className="h-4 w-4 text-green-500" />
        if (type === 'updates' || type === 'attendance') return <RefreshCw className="h-4 w-4 text-orange-500" />
        return <Clock className="h-4 w-4 text-gray-400" />
    }

    const filteredLogs = useMemo(() => {
        const needle = query.trim().toLowerCase()
        return logs.filter((log) => {
            const type = getActionType(log.action)
            const matchesType = typeFilter === 'all' || typeFilter === type
            const haystack = `${log.action || ''} ${log.details || ''} ${log.actor_email || ''}`.toLowerCase()
            return matchesType && (!needle || haystack.includes(needle))
        })
    }, [logs, query, typeFilter])

    const stats = useMemo(() => ({
        total: logs.length,
        attendance: logs.filter((log) => getActionType(log.action) === 'attendance').length,
        members: logs.filter((log) => getActionType(log.action) === 'members').length,
        updates: logs.filter((log) => getActionType(log.action) === 'updates').length
    }), [logs])

    const filterOptions = [
        { id: 'all', label: 'All' },
        { id: 'attendance', label: 'Attendance' },
        { id: 'members', label: 'Members' },
        { id: 'updates', label: 'Updates' },
        { id: 'security', label: 'Security' }
    ]

    return (
        <div className="space-y-4">
            <div className="flex items-center justify-between gap-3">
                <div>
                    <h3 className="text-lg font-semibold text-gray-900 dark:text-white">Activity Log</h3>
                    <p className="text-sm text-gray-500 dark:text-gray-400">Search, filter, and review recent workspace changes</p>
                </div>
                <button
                    onClick={fetchLogs}
                    className="grid h-10 w-10 shrink-0 place-items-center rounded-xl border border-gray-200 bg-white text-gray-500 transition-colors hover:border-orange-300 hover:text-orange-600 dark:border-white/10 dark:bg-[#202121] dark:text-gray-300"
                    title="Refresh logs"
                >
                    <RefreshCw className={`h-4 w-4 ${loading ? 'animate-spin' : ''}`} />
                </button>
            </div>

            <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                {[
                    { label: 'Total', value: stats.total, icon: Activity },
                    { label: 'Attendance', value: stats.attendance, icon: CalendarClock },
                    { label: 'Members', value: stats.members, icon: User },
                    { label: 'Updates', value: stats.updates, icon: RefreshCw }
                ].map(({ label, value, icon: Icon }) => (
                    <div key={label} className="rounded-2xl border border-gray-200 bg-white p-3 dark:border-white/10 dark:bg-[#202121]">
                        <Icon className="mb-2 h-4 w-4 text-orange-500" />
                        <p className="text-xl font-black text-gray-900 dark:text-white">{value}</p>
                        <p className="text-xs font-semibold text-gray-500 dark:text-gray-400">{label}</p>
                    </div>
                ))}
            </div>

            <div className="rounded-2xl border border-gray-200 bg-white p-3 dark:border-white/10 dark:bg-[#202121]">
                <div className="relative">
                    <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400" />
                    <input
                        value={query}
                        onChange={(event) => setQuery(event.target.value)}
                        placeholder="Search activity..."
                        className="h-11 w-full rounded-xl border border-gray-200 bg-gray-50 pl-10 pr-3 text-sm font-semibold text-gray-900 outline-none transition focus:border-orange-500 focus:ring-2 focus:ring-orange-500/20 dark:border-white/10 dark:bg-black/20 dark:text-white"
                    />
                </div>
                <div className="mt-3 flex gap-2 overflow-x-auto pb-1 no-scrollbar">
                    {filterOptions.map((option) => (
                        <button
                            key={option.id}
                            type="button"
                            onClick={() => setTypeFilter(option.id)}
                            className={`min-h-[36px] shrink-0 rounded-full border px-3 text-xs font-bold transition-colors ${
                                typeFilter === option.id
                                    ? 'border-orange-500 bg-orange-50 text-orange-700 dark:bg-orange-500/15 dark:text-orange-200'
                                    : 'border-gray-200 bg-white text-gray-600 dark:border-white/10 dark:bg-white/5 dark:text-gray-300'
                            }`}
                        >
                            {option.label}
                        </button>
                    ))}
                </div>
            </div>

            <div className="max-h-[min(58vh,520px)] overflow-y-auto overscroll-contain rounded-2xl border border-gray-200 bg-white shadow-sm dark:border-white/10 dark:bg-[#202121]">
                {loading && logs.length === 0 ? (
                    <div className="p-8 text-center text-gray-500">Loading activity...</div>
                ) : filteredLogs.length === 0 ? (
                    <div className="p-8 text-center text-gray-500">No matching activity found.</div>
                ) : (
                    <div className="divide-y divide-gray-100 dark:divide-white/10">
                        {filteredLogs.map((log) => (
                            <div key={log.id} className="p-4 transition-colors hover:bg-gray-50 dark:hover:bg-white/5">
                                <div className="flex items-start gap-3">
                                    <div className="mt-1 grid h-9 w-9 shrink-0 place-items-center rounded-xl bg-gray-100 dark:bg-white/5">
                                        {getActionIcon(log.action)}
                                    </div>
                                    <div className="min-w-0 flex-1">
                                        <div className="flex flex-wrap items-center gap-2">
                                            <p className="text-sm font-black uppercase tracking-wide text-gray-900 dark:text-gray-100">
                                                {String(log.action || 'Activity').replace(/_/g, ' ')}
                                            </p>
                                            <span className="rounded-full bg-orange-50 px-2 py-0.5 text-[11px] font-bold capitalize text-orange-700 dark:bg-orange-500/15 dark:text-orange-200">
                                                {getActionType(log.action)}
                                            </span>
                                        </div>
                                        <p className="mt-1 break-words text-sm text-gray-500 dark:text-gray-400">
                                            {log.details || 'No details recorded'}
                                        </p>
                                        <div className="mt-2 flex flex-wrap items-center gap-2 text-xs text-gray-400">
                                            <span className="truncate">{log.actor_email || 'Unknown user'}</span>
                                            <span>•</span>
                                            <span>{log.created_at ? new Date(log.created_at).toLocaleString() : 'Unknown time'}</span>
                                        </div>
                                    </div>
                                </div>
                            </div>
                        ))}
                    </div>
                )}
            </div>
        </div>
    )
}

export default ActivityLogViewer
