import { describe, expect, it } from 'vitest'
import {
    getVisibleSettingsSearchItems,
    searchSettingsIndex,
    SETTINGS_SECTIONS
} from './navigation'

describe('settings search index', () => {
    it.each([
        ['command menu', 'command_menu'],
        ['profile picture', 'profile_photo'],
        ['dark mode', 'theme_dark'],
        ['storage', 'storage_limits'],
        ['offline', 'offline_mode'],
        ['sync', 'offline_mode'],
        ['download offline data', 'offline_mode'],
        ['attendance', 'auto_all_dates'],
        ['notifications', 'notifications'],
        ['keyboard shortcuts', 'command_menu'],
        ['Ctrl K', 'command_menu'],
        ['workspace member codes', 'workspace_member_codes_enabled'],
        ['workspase member cods', 'workspace_member_codes_enabled'],
        ['android phone qr camera blurry', 'member_code_qr_scanner'],
        ['where do I turn on code lookup', 'member_code_lookup'],
        ['share member pass message', 'member_code_share_message'],
        ['settings', 'help_center'],
        ['tags', 'show_tags'],
        ['show tags', 'show_tags'],
        ['member tags', 'show_tags'],
        ['tag visibility', 'show_tags'],
        ['show notes', 'show_notes'],
        ['visitor option', 'show_visitor']
    ])('finds %s', (query, expectedId) => {
        const results = searchSettingsIndex(query, getVisibleSettingsSearchItems(true), SETTINGS_SECTIONS)
        expect(results.map(item => item.id)).toContain(expectedId)
    })
})
