/**
 * Entra ID Authentication for the web client.
 *
 * Uses MSAL.js for browser-based authentication against Microsoft Entra ID.
 * Acquires JWT tokens that the headless server validates via dual-mode auth.
 *
 * Configuration is loaded from environment variables at build time:
 *   VITE_ENTRA_TENANT_ID   — Azure AD tenant ID
 *   VITE_ENTRA_CLIENT_ID   — App registration client ID
 *   VITE_SERVER_URL         — WebSocket server URL (fallback: ws://127.0.0.1:9100)
 */

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------

export interface AuthConfig {
  tenantId: string
  clientId: string
  serverUrl: string
  scopes: string[]
}

export function getAuthConfig(): AuthConfig {
  const tenantId = import.meta.env.VITE_ENTRA_TENANT_ID ?? ''
  const clientId = import.meta.env.VITE_ENTRA_CLIENT_ID ?? ''
  const serverUrl = import.meta.env.VITE_SERVER_URL ?? 'ws://127.0.0.1:9100'

  return {
    tenantId,
    clientId,
    serverUrl,
    scopes: clientId ? [`api://${clientId}/access`] : [],
  }
}

// ---------------------------------------------------------------------------
// Token Management
// ---------------------------------------------------------------------------

/**
 * Get the current auth token.
 *
 * In production with Entra ID configured, this acquires a JWT silently
 * (or redirects to login). For dev without Entra, falls back to
 * VITE_SERVER_TOKEN from environment.
 */
export async function getToken(): Promise<string> {
  const config = getAuthConfig()

  // Dev mode: use static token
  const staticToken = import.meta.env.VITE_SERVER_TOKEN
  if (staticToken) {
    return staticToken
  }

  // Production: Entra ID JWT
  if (!config.tenantId || !config.clientId) {
    throw new Error(
      'Authentication not configured. Set VITE_ENTRA_TENANT_ID and VITE_ENTRA_CLIENT_ID, ' +
      'or VITE_SERVER_TOKEN for development.'
    )
  }

  // MSAL.js integration point — to be implemented with @azure/msal-browser
  // For now, check if there's a token in session storage (set by MSAL redirect)
  const cached = sessionStorage.getItem('craft_access_token')
  if (cached) {
    const parsed = JSON.parse(cached) as { token: string; expiresAt: number }
    if (parsed.expiresAt > Date.now()) {
      return parsed.token
    }
    sessionStorage.removeItem('craft_access_token')
  }

  throw new Error('No valid token available. Login required.')
}

/**
 * Store a token (used after MSAL redirect callback).
 */
export function storeToken(token: string, expiresInSeconds: number): void {
  sessionStorage.setItem('craft_access_token', JSON.stringify({
    token,
    expiresAt: Date.now() + expiresInSeconds * 1000,
  }))
}

/**
 * Clear stored tokens (logout).
 */
export function clearToken(): void {
  sessionStorage.removeItem('craft_access_token')
}

/**
 * Check if user is authenticated (has a valid token).
 */
export function isAuthenticated(): boolean {
  const staticToken = import.meta.env.VITE_SERVER_TOKEN
  if (staticToken) return true

  const cached = sessionStorage.getItem('craft_access_token')
  if (!cached) return false

  try {
    const parsed = JSON.parse(cached) as { expiresAt: number }
    return parsed.expiresAt > Date.now()
  } catch {
    return false
  }
}

/**
 * Get the Entra ID login URL for redirect-based auth.
 */
export function getLoginUrl(): string {
  const config = getAuthConfig()
  const redirectUri = encodeURIComponent(window.location.origin + '/auth/callback')
  const scope = encodeURIComponent(config.scopes.join(' '))

  return (
    `https://login.microsoftonline.com/${config.tenantId}/oauth2/v2.0/authorize` +
    `?client_id=${config.clientId}` +
    `&response_type=token` +
    `&redirect_uri=${redirectUri}` +
    `&scope=${scope}` +
    `&response_mode=fragment`
  )
}
