export const areOptionalTagsVisible = (guidedFormSettings) => (
  guidedFormSettings?.showTagsField === true
)

export const normalizeVisibleTags = (tags = []) => (
  (Array.isArray(tags) ? tags : [])
    .map(tag => ({
      id: tag?.id ?? tag?.tag_id ?? tag?.name,
      name: tag?.name ?? tag?.tag_name ?? tag?.label,
      color: tag?.color ?? tag?.tag_color ?? '#f2550a'
    }))
    .filter(tag => tag.id != null && typeof tag.name === 'string' && tag.name.trim())
)
