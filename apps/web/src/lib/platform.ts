/**
 * Platform Shims — web replacements for Electron APIs.
 *
 * The Electron renderer uses window.electronAPI.* for OS integration.
 * This module provides browser-native equivalents.
 *
 * | Electron Feature       | Web Replacement                       |
 * |------------------------|---------------------------------------|
 * | electron-log           | console.* + server relay              |
 * | shell.openExternal     | window.open()                         |
 * | File dialogs           | <input type="file"> + drag-and-drop   |
 * | OS notifications       | Web Notifications API + toasts        |
 * | Menu bar               | Web navbar + keyboard shortcuts       |
 * | Window management      | Browser tabs                          |
 * | Auto-update            | Server deployment (no client update)  |
 */

// ---------------------------------------------------------------------------
// Shell
// ---------------------------------------------------------------------------

export function openExternal(url: string): void {
  window.open(url, '_blank', 'noopener,noreferrer')
}

export function openFile(path: string): void {
  // In web context, download the file via API
  const link = document.createElement('a')
  link.href = path
  link.download = path.split('/').pop() ?? 'file'
  link.click()
}

export function showInFolder(path: string): void {
  // Not available in web — log a message
  console.info(`[platform] showInFolder not available in web: ${path}`)
}

// ---------------------------------------------------------------------------
// File Dialogs
// ---------------------------------------------------------------------------

export function openFileDialog(
  accept?: string,
  multiple?: boolean
): Promise<File[]> {
  return new Promise((resolve) => {
    const input = document.createElement('input')
    input.type = 'file'
    if (accept) input.accept = accept
    if (multiple) input.multiple = true

    input.onchange = () => {
      const files = input.files ? Array.from(input.files) : []
      resolve(files)
    }

    // Handle cancel
    input.addEventListener('cancel', () => resolve([]))

    input.click()
  })
}

export function openFolderDialog(): Promise<File[]> {
  return new Promise((resolve) => {
    const input = document.createElement('input')
    input.type = 'file'
    ;(input as any).webkitdirectory = true

    input.onchange = () => {
      const files = input.files ? Array.from(input.files) : []
      resolve(files)
    }

    input.addEventListener('cancel', () => resolve([]))
    input.click()
  })
}

// ---------------------------------------------------------------------------
// Notifications
// ---------------------------------------------------------------------------

let notificationsPermission: NotificationPermission | null = null

export async function requestNotificationPermission(): Promise<boolean> {
  if (!('Notification' in window)) return false

  if (Notification.permission === 'granted') {
    notificationsPermission = 'granted'
    return true
  }

  if (Notification.permission === 'denied') {
    notificationsPermission = 'denied'
    return false
  }

  const result = await Notification.requestPermission()
  notificationsPermission = result
  return result === 'granted'
}

export function showNotification(
  title: string,
  options?: { body?: string; icon?: string; onClick?: () => void }
): void {
  if (notificationsPermission !== 'granted') {
    // Fallback: in-app toast (consumers should handle this)
    console.info(`[notification] ${title}: ${options?.body ?? ''}`)
    return
  }

  const notification = new Notification(title, {
    body: options?.body,
    icon: options?.icon ?? '/vite.svg',
  })

  if (options?.onClick) {
    notification.onclick = () => {
      options.onClick!()
      window.focus()
    }
  }
}

// ---------------------------------------------------------------------------
// Clipboard
// ---------------------------------------------------------------------------

export async function writeClipboard(text: string): Promise<void> {
  await navigator.clipboard.writeText(text)
}

export async function readClipboard(): Promise<string> {
  return navigator.clipboard.readText()
}

// ---------------------------------------------------------------------------
// Keyboard Shortcuts
// ---------------------------------------------------------------------------

type ShortcutHandler = (e: KeyboardEvent) => void
const shortcuts = new Map<string, ShortcutHandler>()

export function registerShortcut(
  key: string,
  modifiers: { meta?: boolean; ctrl?: boolean; shift?: boolean; alt?: boolean },
  handler: ShortcutHandler
): () => void {
  const id = formatShortcutId(key, modifiers)
  shortcuts.set(id, handler)
  return () => shortcuts.delete(id)
}

function formatShortcutId(
  key: string,
  mods: { meta?: boolean; ctrl?: boolean; shift?: boolean; alt?: boolean }
): string {
  const parts: string[] = []
  if (mods.meta || mods.ctrl) parts.push('CmdOrCtrl')
  if (mods.shift) parts.push('Shift')
  if (mods.alt) parts.push('Alt')
  parts.push(key.toLowerCase())
  return parts.join('+')
}

// Global keyboard listener
if (typeof window !== 'undefined') {
  window.addEventListener('keydown', (e) => {
    const id = formatShortcutId(e.key, {
      meta: e.metaKey,
      ctrl: e.ctrlKey,
      shift: e.shiftKey,
      alt: e.altKey,
    })
    const handler = shortcuts.get(id)
    if (handler) {
      e.preventDefault()
      handler(e)
    }
  })
}

// ---------------------------------------------------------------------------
// Logger (console-based, replaces electron-log)
// ---------------------------------------------------------------------------

export const logger = {
  info: (...args: unknown[]) => console.info('[craft]', ...args),
  warn: (...args: unknown[]) => console.warn('[craft]', ...args),
  error: (...args: unknown[]) => console.error('[craft]', ...args),
  debug: (...args: unknown[]) => console.debug('[craft]', ...args),
}

// ---------------------------------------------------------------------------
// System Info
// ---------------------------------------------------------------------------

export function getSystemInfo() {
  return {
    platform: 'web' as const,
    userAgent: navigator.userAgent,
    language: navigator.language,
    online: navigator.onLine,
  }
}

/**
 * Subscribe to online/offline events.
 */
export function onConnectivityChange(callback: (online: boolean) => void): () => void {
  const onOnline = () => callback(true)
  const onOffline = () => callback(false)
  window.addEventListener('online', onOnline)
  window.addEventListener('offline', onOffline)
  return () => {
    window.removeEventListener('online', onOnline)
    window.removeEventListener('offline', onOffline)
  }
}
