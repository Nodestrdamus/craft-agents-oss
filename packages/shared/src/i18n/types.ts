/**
 * i18n / Localization Types
 *
 * Multi-language support for the Craft Agent UI.
 * Framework: react-i18next with JSON locale files.
 *
 * Supported languages (Phase 4):
 *   - en (English) — default
 *   - zh (Chinese Simplified) — most requested
 *
 * Locale detection order:
 *   1. User preference (stored in preferences)
 *   2. Workspace default (workspace config)
 *   3. Browser language (navigator.language)
 *   4. Fallback: 'en'
 */

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** Supported locale codes */
export type SupportedLocale = 'en' | 'zh'

/** All supported locales with metadata */
export const SUPPORTED_LOCALES: Record<SupportedLocale, LocaleInfo> = {
  en: {
    code: 'en',
    name: 'English',
    nativeName: 'English',
    direction: 'ltr',
  },
  zh: {
    code: 'zh',
    name: 'Chinese (Simplified)',
    nativeName: '简体中文',
    direction: 'ltr',
  },
}

export interface LocaleInfo {
  code: SupportedLocale
  /** English name */
  name: string
  /** Name in the locale's own language */
  nativeName: string
  /** Text direction */
  direction: 'ltr' | 'rtl'
}

/** Default locale when no preference is set */
export const DEFAULT_LOCALE: SupportedLocale = 'en'

/**
 * i18n namespace keys. Each namespace maps to a section of the UI.
 * Keeps locale files organized and enables lazy loading per view.
 */
export type I18nNamespace =
  | 'common'       // Shared strings: OK, Cancel, Save, Delete, etc.
  | 'nav'          // Sidebar, navigation, menu items
  | 'settings'     // Settings page strings
  | 'sessions'     // Chat/session UI strings
  | 'sources'      // Source management
  | 'skills'       // Skill management
  | 'permissions'  // Permission modes, dialogs
  | 'errors'       // Error messages
  | 'notes'        // Notes/knowledge base (Phase 4)
  | 'batches'      // Batch processing UI

/**
 * Resolve the best locale from available signals.
 * Used server-side and client-side.
 */
export function resolveLocale(
  userPreference?: string,
  workspaceDefault?: string,
  browserLanguage?: string
): SupportedLocale {
  // Check each source in priority order
  for (const candidate of [userPreference, workspaceDefault, browserLanguage]) {
    if (!candidate) continue
    // Exact match
    if (candidate in SUPPORTED_LOCALES) return candidate as SupportedLocale
    // Language prefix match (e.g., 'zh-CN' → 'zh')
    const prefix = candidate.split('-')[0]
    if (prefix && prefix in SUPPORTED_LOCALES) return prefix as SupportedLocale
  }
  return DEFAULT_LOCALE
}
