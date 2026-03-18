/**
 * i18n / Localization RPC Handlers
 *
 * Locale management and string retrieval for the UI.
 */

import { RPC_CHANNELS } from '@craft-agent/shared/protocol'
import {
  SUPPORTED_LOCALES,
  DEFAULT_LOCALE,
  resolveLocale,
  getLocaleStrings,
  type SupportedLocale,
} from '@craft-agent/shared/i18n'
import type { RpcServer } from '@craft-agent/server-core/transport'
import type { HandlerDeps } from '../handler-deps'

export const HANDLED_CHANNELS = [
  RPC_CHANNELS.i18n.GET_LOCALES,
  RPC_CHANNELS.i18n.GET_STRINGS,
  RPC_CHANNELS.i18n.GET_CURRENT,
  RPC_CHANNELS.i18n.SET_LOCALE,
] as const

export function registerI18nHandlers(server: RpcServer, deps: HandlerDeps): void {
  // Get list of supported locales
  server.handle(RPC_CHANNELS.i18n.GET_LOCALES, async () => {
    return {
      locales: Object.values(SUPPORTED_LOCALES),
      default: DEFAULT_LOCALE,
    }
  })

  // Get locale strings for a given locale code
  server.handle(RPC_CHANNELS.i18n.GET_STRINGS, async (_ctx, locale: string) => {
    const resolved = resolveLocale(locale)
    const strings = await getLocaleStrings(resolved)
    return { locale: resolved, strings }
  })

  // Get the current resolved locale for a user/workspace
  server.handle(RPC_CHANNELS.i18n.GET_CURRENT, async (_ctx, userPreference?: string, workspaceDefault?: string, browserLanguage?: string) => {
    const resolved = resolveLocale(userPreference, workspaceDefault, browserLanguage)
    return {
      locale: resolved,
      info: SUPPORTED_LOCALES[resolved],
    }
  })

  // Set locale preference (stores via preferences system)
  server.handle(RPC_CHANNELS.i18n.SET_LOCALE, async (_ctx, locale: SupportedLocale) => {
    if (!(locale in SUPPORTED_LOCALES)) {
      throw new Error(`Unsupported locale: ${locale}. Supported: ${Object.keys(SUPPORTED_LOCALES).join(', ')}`)
    }
    // Locale preference is stored via the preferences RPC — this handler
    // just validates and returns the resolved locale info
    deps.platform.logger?.info(`[i18n] Locale set to: ${locale}`)
    return {
      locale,
      info: SUPPORTED_LOCALES[locale],
    }
  })
}
