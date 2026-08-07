export const SETTINGS_SCOPES = {
  PERSONAL: 'personal',
  WORKSPACE: 'workspace',
  SPECIALIZED: 'specialized',
  DEVICE_ONLY: 'device_only',
  TEMPORARY: 'temporary',
  SYSTEM_OR_READ_ONLY: 'system_or_read_only',
  OBSOLETE_OR_DUPLICATE: 'obsolete_or_duplicate'
}

// These are the only keys accepted by the revisioned preference RPCs. Keep
// this list deliberately boring: a setting must have a real database/RPC
// contract before it can be sent to the server.
export const PERSONAL_PREFERENCE_KEYS = [
  'theme',
  'font_size',
  'font_family',
  'selected_month_table',
  'badge_filter',
  'current_month_table',
  'command_k_enabled',
  'animations_enabled',
  'reduced_motion',
  'high_contrast',
  'focus_visible',
  'performance_mode',
  'theme_mode',
  'calendar_mode',
  'manual_month_table',
  'manual_sunday_date',
  'manual_override_until',
  'settings_search_quick_actions_enabled',
  'command_palette_auto_scan_settings',
  'haptic_feedback_enabled',
  'haptic_feedback_strength',
  'compact_ui_enabled',
  'mobile_dashboard_status_enabled',
  'motion_and_sounds_enabled',
  'smart_compact_prompt_enabled',
  'dashboard_member_columns'
]

export const WORKSPACE_PREFERENCE_KEYS = [
  'member_codes_enabled',
  'member_code_quick_pass_enabled',
  'member_code_show_logo',
  'member_code_show_photo',
  'member_code_show_email',
  'member_code_auto_profile_enabled',
  'member_code_badge_style',
  'member_code_card_style',
  'member_code_accent_color',
  'member_code_church_name',
  'member_filter_button_enabled',
  'member_search_tray_delete_enabled',
  'workspace_member_codes_enabled',
  'member_code_logo_url',
  'member_code_turbo_enabled',
  'member_code_turbo_notification_enabled',
  'member_code_lookup_enabled',
  'member_code_share_message_template',
  'guided_form_settings',
  'historical_search_settings'
]

const PERSONAL_DEFAULTS = {
  theme: null,
  font_size: '16',
  font_family: 'system',
  selected_month_table: null,
  badge_filter: [],
  current_month_table: null,
  command_k_enabled: true,
  animations_enabled: true,
  reduced_motion: false,
  high_contrast: false,
  focus_visible: true,
  performance_mode: false,
  theme_mode: 'system',
  calendar_mode: 'auto',
  manual_month_table: null,
  manual_sunday_date: null,
  manual_override_until: null,
  settings_search_quick_actions_enabled: true,
  command_palette_auto_scan_settings: true,
  haptic_feedback_enabled: true,
  haptic_feedback_strength: 1,
  compact_ui_enabled: false,
  mobile_dashboard_status_enabled: false,
  motion_and_sounds_enabled: true,
  smart_compact_prompt_enabled: true,
  dashboard_member_columns: 3
}

const WORKSPACE_DEFAULTS = {
  member_codes_enabled: true,
  member_code_quick_pass_enabled: true,
  member_code_show_logo: true,
  member_code_show_photo: true,
  member_code_show_email: true,
  member_code_auto_profile_enabled: false,
  member_code_badge_style: 'soft',
  member_code_card_style: 'wave',
  member_code_accent_color: 'orange',
  member_code_church_name: 'DatSer Church',
  member_filter_button_enabled: false,
  member_search_tray_delete_enabled: true,
  workspace_member_codes_enabled: true,
  member_code_logo_url: null,
  member_code_turbo_enabled: false,
  member_code_turbo_notification_enabled: true,
  member_code_lookup_enabled: true,
  member_code_share_message_template: null,
  guided_form_settings: {
    enabled: true,
    highlightNotes: false,
    highlightTags: false,
    autoFocusNextField: false,
    autoScrollToActiveField: true,
    showNextButton: false,
    pulseNextButton: true,
    manualNextAfterTyping: false,
    showInAddMember: true,
    showInEditMember: true,
    showInMissingInfo: true,
    attendanceAutoPresent: true,
    showVisitorField: false,
    showTagsField: false,
    showNotesField: false,
    guidedOrder: [
      'full-name',
      'gender',
      'phone',
      'dob',
      'age',
      'level',
      'tags',
      'attendance',
      'parent',
      'notes'
    ]
  },
  historical_search_settings: {
    mode: 'all_previous',
    recent_months: 6,
    selected_tables: [],
    include_deleted: false
  }
}

const buildRegistry = (keys, scope, defaults, section) => Object.fromEntries(
  keys.map((key) => ({
    key,
    value: {
      key,
      scope,
      defaultValue: defaults[key],
      section,
      saveStrategy: scope === SETTINGS_SCOPES.PERSONAL
        ? 'save_personal_preferences'
        : 'save_workspace_preferences'
    }
  })).map(({ key, value }) => [key, value])
)

export const SETTINGS_REGISTRY = {
  ...buildRegistry(PERSONAL_PREFERENCE_KEYS, SETTINGS_SCOPES.PERSONAL, PERSONAL_DEFAULTS, 'appearance'),
  ...buildRegistry(WORKSPACE_PREFERENCE_KEYS, SETTINGS_SCOPES.WORKSPACE, WORKSPACE_DEFAULTS, 'workspace'),

  // These settings use dedicated RPCs or other application services and must
  // never be accidentally sent through the generic preference RPCs.
  member_code_format: {
    key: 'member_code_format',
    scope: SETTINGS_SCOPES.SPECIALIZED,
    section: 'member_codes',
    saveStrategy: 'specialized_rpc',
    specializedRpc: 'configure_workspace_member_codes'
  },
  member_code_length: {
    key: 'member_code_length',
    scope: SETTINGS_SCOPES.SPECIALIZED,
    section: 'member_codes',
    saveStrategy: 'specialized_rpc',
    specializedRpc: 'configure_workspace_member_codes'
  },
  workspace_name: {
    key: 'workspace_name',
    scope: SETTINGS_SCOPES.SPECIALIZED,
    section: 'workspace',
    saveStrategy: 'update_user_workspace_name',
    specializedRpc: 'update_user_workspace_name'
  },
  collaborator_override: {
    key: 'collaborator_override',
    scope: SETTINGS_SCOPES.SPECIALIZED,
    section: 'workspace',
    saveStrategy: 'specialized_rpc',
    specializedRpc: 'set_collaborator_override'
  },
  locked_default_date: {
    key: 'locked_default_date',
    scope: SETTINGS_SCOPES.SPECIALIZED,
    section: 'workspace',
    saveStrategy: 'specialized_rpc',
    specializedRpc: 'save_locked_default_date'
  },
  admin_code_login: {
    key: 'admin_code_login',
    scope: SETTINGS_SCOPES.SPECIALIZED,
    section: 'team',
    saveStrategy: 'specialized_rpc',
    specializedRpc: 'update_admin_code'
  },
  date_of_birth_picker_mode: {
    key: 'date_of_birth_picker_mode',
    scope: SETTINGS_SCOPES.DEVICE_ONLY,
    defaultValue: 'combined',
    section: 'account',
    saveStrategy: 'local_storage'
  },
  member_code_auto_cycle_minutes: {
    key: 'member_code_auto_cycle_minutes',
    scope: SETTINGS_SCOPES.DEVICE_ONLY,
    defaultValue: 30,
    section: 'member_codes',
    saveStrategy: 'local_storage'
  },
  search_suggestion_view: {
    key: 'search_suggestion_view',
    scope: SETTINGS_SCOPES.DEVICE_ONLY,
    defaultValue: 'full',
    section: 'accessibility',
    saveStrategy: 'local_storage'
  },
  notification_duration_ms: {
    key: 'notification_duration_ms',
    scope: SETTINGS_SCOPES.DEVICE_ONLY,
    defaultValue: 4200,
    section: 'accessibility',
    saveStrategy: 'local_storage'
  },
  offline_mode: {
    key: 'offline_mode',
    scope: SETTINGS_SCOPES.DEVICE_ONLY,
    defaultValue: 'auto',
    section: 'data',
    saveStrategy: 'local_storage'
  },
  offline_save_notice_threshold: {
    key: 'offline_save_notice_threshold',
    scope: SETTINGS_SCOPES.DEVICE_ONLY,
    defaultValue: 5,
    section: 'data',
    saveStrategy: 'local_storage'
  },
  command_palette_split_percent: {
    key: 'command_palette_split_percent',
    scope: SETTINGS_SCOPES.DEVICE_ONLY,
    defaultValue: 50,
    section: 'accessibility',
    saveStrategy: 'local_storage'
  },
  skip_apk_version: {
    key: 'skip_apk_version',
    scope: SETTINGS_SCOPES.DEVICE_ONLY,
    defaultValue: false,
    section: 'updates',
    saveStrategy: 'local_storage'
  },
  settings_search_query: {
    key: 'settings_search_query',
    scope: SETTINGS_SCOPES.TEMPORARY
  },
  settings_active_section: {
    key: 'settings_active_section',
    scope: SETTINGS_SCOPES.TEMPORARY
  },
  temporary_search_scope_override: {
    key: 'temporary_search_scope_override',
    scope: SETTINGS_SCOPES.TEMPORARY
  },
  user_email: {
    key: 'user_email',
    scope: SETTINGS_SCOPES.SYSTEM_OR_READ_ONLY,
    section: 'account'
  },
  supabase_storage_usage: {
    key: 'supabase_storage_usage',
    scope: SETTINGS_SCOPES.SYSTEM_OR_READ_ONLY,
    section: 'storage'
  },
  member_codes_enabled_legacy: {
    key: 'member_codes_enabled_legacy',
    scope: SETTINGS_SCOPES.OBSOLETE_OR_DUPLICATE,
    description: 'Use member_codes_enabled in the workspace preference scope.'
  }
}

export const getSettingConfig = (key) => SETTINGS_REGISTRY[key] || null

export const getPreferenceScope = (key) => {
  const config = getSettingConfig(key)
  if (config?.scope === SETTINGS_SCOPES.PERSONAL) return SETTINGS_SCOPES.PERSONAL
  if (config?.scope === SETTINGS_SCOPES.WORKSPACE) return SETTINGS_SCOPES.WORKSPACE
  return null
}

const cloneDefault = (value) => {
  if (Array.isArray(value)) return [...value]
  if (value && typeof value === 'object') return { ...value }
  return value
}

const getDefaultsForScope = (scope, defaults) => Object.fromEntries(
  Object.entries(defaults).map(([key, value]) => [key, cloneDefault(value)])
    .filter(([key]) => getSettingConfig(key)?.scope === scope)
)

export const getPersonalSettingsDefaults = () => getDefaultsForScope(SETTINGS_SCOPES.PERSONAL, PERSONAL_DEFAULTS)

export const getWorkspaceSettingsDefaults = () => getDefaultsForScope(SETTINGS_SCOPES.WORKSPACE, WORKSPACE_DEFAULTS)

export const getPersonalPreferenceKeys = () => [...PERSONAL_PREFERENCE_KEYS]

export const getWorkspacePreferenceKeys = () => [...WORKSPACE_PREFERENCE_KEYS]

export const pickPersonalPreferencePatch = (patch = {}) => Object.fromEntries(
  PERSONAL_PREFERENCE_KEYS
    .filter((key) => Object.prototype.hasOwnProperty.call(patch, key))
    .map((key) => [key, patch[key]])
)

export const pickWorkspacePreferencePatch = (patch = {}) => Object.fromEntries(
  WORKSPACE_PREFERENCE_KEYS
    .filter((key) => Object.prototype.hasOwnProperty.call(patch, key))
    .map((key) => [key, patch[key]])
)
