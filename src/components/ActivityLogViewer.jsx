import React, { useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'
import { Clock, User, Shield, RefreshCw } from 'lucide-react'

const ActivityLogViewer = () => {
    const [logs, setLogs] = useState([])
    const [loading, setLoading] = useState(true)

    const fetchLogs = async () => {
        setLoading(true)
        try {
            const { data, error } = await supabase
                .from('activity_logs')
                .select('*')
                .order('created_at', { ascending: false })
                .limit(50)

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

    const getActionIcon = (action) => {
        if (action.includes('DELETE')) return <Shield className="w-4 h-4 text-red-500" />
        if (action.includes('ADD')) return <User className="w-4 h-4 text-green-500" />
        if (action.includes('UPDATE')) return <RefreshCw className="w-4 h-4 text-orange-500" />
        if (action.includes('ASSIGN') || action.includes('REMOVE')) return <Shield className="w-4 h-4 text-purple-500" />
        return <Clock className="w-4 h-4 text-gray-400" />
    }

    return (
        <div className="space-y-4">
            <div className="flex items-center justify-between mb-4">
                <h3 className="text-lg font-medium text-gray-900 dark:text-gray-100">Recent Activity</h3>
                <button
                    onClick={fetchLogs}
                    className="p-2 text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-200"
                    title="Refresh logs"
                >
                    <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
                </button>
            </div>

            <div className="bg-white dark:bg-gray-800 rounded-lg shadow border border-gray-200 dark:border-gray-700 overflow-hidden max-h-[500px] overflow-y-auto">
                {loading && logs.length === 0 ? (
                    <div className="p-8 text-center text-gray-500">Loading activity...</div>
                ) : logs.length === 0 ? (
                    <div className="p-8 text-center text-gray-500">No recent activity found.</div>
                ) : (
                    <div className="divide-y divide-gray-100 dark:divide-gray-700">
                        {logs.map((log) => (
                            <div key={log.id} className="p-4 hover:bg-gray-50 dark:hover:bg-gray-750 transition-colors">
                                <div className="flex items-start gap-3">
                                    <div className="mt-1 flex-shrink-0">
                                        {getActionIcon(log.action)}
                                    </div>
                                    <div className="flex-1 min-w-0">
                                        <p className="text-sm font-medium text-gray-900 dark:text-gray-100">
                                            {log.action.replace(/_/g, ' ')}
                                        </p>
                                        <p className="text-sm text-gray-500 dark:text-gray-400 mt-0.5 break-words">
                                            {log.details}
                                        </p>
                                        <div className="flex items-center gap-2 mt-2 text-xs text-gray-400">
                                            <span>{log.actor_email}</span>
                                            <span>•</span>
                                            <span>{new Date(log.created_at).toLocaleString()}</span>
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
