import { useState, useEffect, useCallback } from 'react'
import { supabase } from '../lib/supabase'
import { executeSupabaseWrite } from '../utils/supabaseWrite'

export const useTags = (ownerId, currentTable) => {
  const [tags, setTags] = useState([])
  const [memberTags, setMemberTags] = useState({}) // memberId -> array of tags
  const [loading, setLoading] = useState(true)
  const [filterTags, setFilterTags] = useState([]) // Tags selected for filtering

  // Fetch all workspace tags
  const fetchTags = useCallback(async () => {
    if (!ownerId) return
    
    try {
      const { data, error } = await supabase.rpc('get_workspace_tags', {
        p_owner_id: ownerId
      })

      if (error) throw error
      setTags(data || [])
    } catch (error) {
      console.error('Error fetching tags:', error)
    }
  }, [ownerId])

  // Fetch tags for all members in current table
  const fetchMemberTags = useCallback(async () => {
    if (!ownerId || !currentTable) return
    
    try {
      // Get all member_tags for the current table
      const { data: memberTagsData, error } = await supabase
        .from('member_tags')
        .select('member_id,tag_id,table_name')
        .eq('table_name', currentTable)

      if (error) throw error

      // Group by member_id
      const grouped = {}
      for (const mt of memberTagsData || []) {
        if (!grouped[mt.member_id]) {
          grouped[mt.member_id] = []
        }
        grouped[mt.member_id].push(mt.tag_id)
      }
      setMemberTags(grouped)
    } catch (error) {
      console.error('Error fetching member tags:', error)
    }
  }, [ownerId, currentTable])

  // Load tags on mount and when ownerId changes
  useEffect(() => {
    setLoading(true)
    fetchTags().then(() => {
      fetchMemberTags().then(() => setLoading(false))
    })
  }, [fetchTags, fetchMemberTags])

  // Assign a tag to a member
  const assignTag = useCallback(async (tagId, memberId) => {
    try {
      await executeSupabaseWrite(
        () => supabase.rpc('assign_tag_to_member', {
          p_tag_id: tagId,
          p_member_id: memberId,
          p_table_name: currentTable,
          p_owner_id: ownerId
        }),
        { action: `Assign tag ${tagId} to member ${memberId}` }
      )

      // Update local state
      setMemberTags(prev => ({
        ...prev,
        [memberId]: [...(prev[memberId] || []), tagId]
      }))

      return true
    } catch (error) {
      console.error('Error assigning tag:', error)
      return false
    }
  }, [currentTable, ownerId])

  // Remove a tag from a member
  const removeTag = useCallback(async (tagId, memberId) => {
    try {
      await executeSupabaseWrite(
        () => supabase.rpc('remove_tag_from_member', {
          p_tag_id: tagId,
          p_member_id: memberId,
          p_table_name: currentTable,
          p_owner_id: ownerId
        }),
        { action: `Remove tag ${tagId} from member ${memberId}` }
      )

      // Update local state
      setMemberTags(prev => ({
        ...prev,
        [memberId]: (prev[memberId] || []).filter(id => id !== tagId)
      }))

      return true
    } catch (error) {
      console.error('Error removing tag:', error)
      return false
    }
  }, [currentTable, ownerId])

  // Get tags for a specific member
  const getMemberTags = useCallback((memberId) => {
    const tagIds = memberTags[memberId] || []
    return tags.filter(tag => tagIds.includes(tag.id))
  }, [memberTags, tags])

  // Toggle tag filter
  const toggleTagFilter = useCallback((tagId) => {
    setFilterTags(prev => 
      prev.includes(tagId)
        ? prev.filter(id => id !== tagId)
        : [...prev, tagId]
    )
  }, [])

  // Clear all filters
  const clearFilters = useCallback(() => {
    setFilterTags([])
  }, [])

  return {
    tags,
    memberTags,
    loading,
    filterTags,
    fetchTags,
    fetchMemberTags,
    assignTag,
    removeTag,
    getMemberTags,
    toggleTagFilter,
    clearFilters
  }
}

export default useTags
