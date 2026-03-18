/**
 * i18n / Localization Module
 *
 * Re-exports types, locale data, and utilities.
 */

// Types and utilities
export {
  SUPPORTED_LOCALES,
  DEFAULT_LOCALE,
  resolveLocale,
  type SupportedLocale,
  type LocaleInfo,
  type I18nNamespace,
} from './types.ts'

// Locale data
export { en, type LocaleStrings } from './locales/en.ts'
export { zh } from './locales/zh.ts'

/**
 * Get locale strings for a given locale code.
 * Falls back to English for unknown locales.
 */
export async function getLocaleStrings(locale: string): Promise<Record<string, unknown>> {
  switch (locale) {
    case 'zh':
      return (await import('./locales/zh.ts')).zh
    case 'en':
    default:
      return (await import('./locales/en.ts')).en
  }
}
