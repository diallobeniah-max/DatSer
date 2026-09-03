import React, { useState, useEffect } from 'react'
import { supabase } from '../lib/supabase'
import { executeSupabaseWrite } from '../utils/supabaseWrite'
import { Tag, Check, X, Loader2 } from 'lucide-react'
import { toast } from 'react-toastify'

const TagSelector = ({ 
  ownerId, 
  memberId, 
  tableName, 
  currentTags = [], 
  onTagsChange,
  isDarkMode,
  selectedTagIds = null,
  onSelectionChange = null,
  deferSave = false,
  offline = false
}) => {
  const [availableTags, setAvailableTags] = useState([])
  const [internalSelectedTagIds, setInternalSelectedTagIds] = useState(new Set())
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const effectiveSelectedTagIds = selectedTagIds ?? internalSelectedTagIds

  // Load available tags
  useEffect(() => {
    if (ownerId && !offline) {
      fetchTags()
    } else if (offline) {
      setLoading(false)
    }
  }, [ownerId, offline])

  // Initialize selected tags: prefer `currentTags` prop if provided,
  // otherwise fetch assigned tags for the member from the DB
  useEffect(() => {
    let cancelled = false

    const fetchMemberAssigned = async () => {
      if (offline || !memberId || !tableName) return
      try {
        const { data, error } = await supabase.rpc('get_member_tags', {
          p_member_id: memberId,
          p_table_name: tableName
        })
        if (error) throw error
        if (!cancelled) setInternalSelectedTagIds(new Set((data || []).map(t => t.id)))
      } catch (err) {
        console.error('Error fetching member tags in selector:', err)
      }
    }

    if (selectedTagIds !== null) {
      return () => { cancelled = true }
    }

    if (currentTags && currentTags.length > 0) {
      setInternalSelectedTagIds(new Set(currentTags.map(t => t.id)))
    } else {
      fetchMemberAssigned()
    }

    return () => { cancelled = true }
  }, [memberId, tableName, currentTags, selectedTagIds, offline])

  const fetchTags = async () => {
    try {
      const { data, error } = await supabase.rpc('get_workspace_tags', {
        p_owner_id: ownerId
      })

      if (error) throw error
      setAvailableTags(data || [])
    } catch (error) {
      console.error('Error fetching tags:', error)
    } finally {
      setLoading(false)
    }
  }

  const toggleTag = async (tagId) => {
    if (saving) return

    const isSelected = effectiveSelectedTagIds.has(tagId)

    if (deferSave) {
      const next = new Set(effectiveSelectedTagIds)
      if (isSelected) {
        next.delete(tagId)
      } else {
        next.add(tagId)
      }

      if (onSelectionChange) {
        onSelectionChange(next)
      } else {
        setInternalSelectedTagIds(next)
      }
      return
    }

    setSaving(true)

    try {
      if (isSelected) {
        // Remove tag
        await executeSupabaseWrite(
          () => supabase.rpc('remove_tag_from_member', {
            p_tag_id: tagId,
            p_member_id: memberId,
            p_table_name: tableName,
            p_owner_id: ownerId
          }),
          { action: `Remove tag ${tagId} from member ${memberId}` }
        )

        setInternalSelectedTagIds(prev => {
          const next = new Set(prev)
          next.delete(tagId)
          return next
        })
      } else {
        // Add tag
        await executeSupabaseWrite(
          () => supabase.rpc('assign_tag_to_member', {
            p_tag_id: tagId,
            p_member_id: memberId,
            p_table_name: tableName,
            p_owner_id: ownerId
          }),
          { action: `Assign tag ${tagId} to member ${memberId}` }
        )

        setInternalSelectedTagIds(prev => new Set(prev).add(tagId))
      }

      // Notify parent
      if (onTagsChange) {
        onTagsChange()
      }
    } catch (error) {
      console.error('Error toggling tag:', error)
      toast.error('Failed to update tag')
    } finally {
      setSaving(false)
    }
  }

  const deleteSelectedTags = async () => {
    // bulk delete removed — function retained but noop for safety
    return
  }

  if (loading) {
    return (
      <div className="flex items-center gap-2 text-sm text-gray-500 dark:text-gray-400">
        <Loader2 className="w-4 h-4 animate-spin" />
        Loading tags...
      </div>
    )
  }

  if (availableTags.length === 0) {
    return (
      <p className="text-sm text-gray-500 dark:text-gray-400">
        No tags available. Create tags in the Admin Controls.
      </p>
    )
  }

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <label className="block text-sm font-medium text-gray-700 dark:text-gray-300">
          <Tag className="w-4 h-4 inline mr-1" />
          Tags
        </label>
        {effectiveSelectedTagIds.size > 0 && (
          <span className="text-xs px-2 py-1 bg-primary-100 dark:bg-primary-900/30 text-primary-700 dark:text-primary-300 rounded-full font-medium">
            {effectiveSelectedTagIds.size} selected
          </span>
        )}
      </div>
      <div className="flex flex-wrap gap-2">
        {availableTags.map((tag) => {
          const isSelected = effectiveSelectedTagIds.has(tag.id)
          return (
            <button
              key={tag.id}
              type="button"
              data-testid={`tag-selector-tag-${tag.id}`}
              onClick={() => toggleTag(tag.id)}
              disabled={saving}
              title={tag.name}
              className={`inline-flex items-center gap-1 px-2 py-1 rounded-full text-xs font-medium transition-all duration-200 w-32 justify-center ${
                isSelected 
                  ? 'shadow-md' 
                  : 'opacity-60 hover:opacity-80'
              }`}
              style={{ 
                backgroundColor: isSelected ? tag.color : tag.color + '15',
                color: isSelected ? '#ffffff' : tag.color,
                border: `2px solid ${tag.color}`,
                boxShadow: isSelected ? `0 0 8px ${tag.color}60` : 'none',
                fontWeight: isSelected ? '600' : '500'
              }}
            >
              {isSelected && <Check className="w-3 h-3" />}
              <span className="truncate max-w-[90px]">{tag.name}</span>
            </button>
          )
        })}
      </div>
      {/* Bulk delete button removed per request */}
    </div>
  )
}

export default TagSelector
