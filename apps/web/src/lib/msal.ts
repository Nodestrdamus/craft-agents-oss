/**
 * MSAL.js Integration for Entra ID Authentication
 *
 * Provides browser-based authentication against Microsoft Entra ID.
 * Uses @azure/msal-browser for token acquisition, caching, and renewal.
 *
 * Configuration via Vite env vars:
 *   VITE_ENTRA_TENANT_ID   — Azure AD tenant ID
 *   VITE_ENTRA_CLIENT_ID   — App registration client ID
 *   VITE_SERVER_URL         — WebSocket server URL
 *   VITE_SERVER_TOKEN       — Static token for dev (bypasses MSAL)
 */

import { getAuthConfig, storeToken, type AuthConfig } from './auth'

// ---------------------------------------------------------------------------
// Types (avoid hard dependency on @azure/msal-browser at import time)
// ---------------------------------------------------------------------------

interface MsalInstance {
  initialize(): Promise<void>
  handleRedirectPromise(): Promise<{ accessToken: string; expiresOn: Date | null } | null>
  acquireTokenSilent(request: { scopes: string[]; account: any }): Promise<{ accessToken: string; expiresOn: Date | null }>
  acquireTokenRedirect(request: { scopes: string[] }): Promise<void>
  getAllAccounts(): any[]
  setActiveAccount(account: any): void
  getActiveAccount(): any | null
  logoutRedirect(request?: { postLogoutRedirectUri?: string }): Promise<void>
}

// ---------------------------------------------------------------------------
// Singleton
// ---------------------------------------------------------------------------

let msalInstance: MsalInstance | null = null
let initPromise: Promise<void> | null = null

/**
 * Get or create the MSAL instance.
 * Lazy-loads @azure/msal-browser to avoid bundling it when using static tokens.
 */
async function getMsalInstance(config: AuthConfig): Promise<MsalInstance> {
  if (msalInstance) return msalInstance

  if (initPromise) {
    await initPromise
    return msalInstance!
  }

  initPromise = (async () => {
    // Dynamic import — tree-shaken when MSAL is not needed
    const { PublicClientApplication } = await import('@azure/msal-browser')

    const pca = new PublicClientApplication({
      auth: {
        clientId: config.clientId,
        authority: `https://login.microsoftonline.com/${config.tenantId}`,
        redirectUri: `${window.location.origin}/auth/callback`,
        postLogoutRedirectUri: window.location.origin,
        navigateToLoginRequestUrl: true,
      },
      cache: {
        cacheLocation: 'sessionStorage',
        storeAuthStateInCookie: false,
      },
    })

    await pca.initialize()
    msalInstance = pca as unknown as MsalInstance
  })()

  await initPromise
  return msalInstance!
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Handle the MSAL redirect callback.
 * Call this once on app mount to process auth responses.
 */
export async function handleMsalRedirect(): Promise<boolean> {
  const config = getAuthConfig()
  if (!config.tenantId || !config.clientId) return false

  try {
    const msal = await getMsalInstance(config)
    const response = await msal.handleRedirectPromise()

    if (response?.accessToken) {
      // Store token for RPC client
      const expiresIn = response.expiresOn
        ? Math.floor((response.expiresOn.getTime() - Date.now()) / 1000)
        : 3600
      storeToken(response.accessToken, expiresIn)

      // Set active account
      const accounts = msal.getAllAccounts()
      if (accounts.length > 0) {
        msal.setActiveAccount(accounts[0])
      }

      return true
    }

    // No redirect response — check if user already has an account
    const accounts = msal.getAllAccounts()
    if (accounts.length > 0) {
      msal.setActiveAccount(accounts[0])
      // Try silent token acquisition
      try {
        const silentResult = await msal.acquireTokenSilent({
          scopes: config.scopes,
          account: accounts[0],
        })
        if (silentResult.accessToken) {
          const expiresIn = silentResult.expiresOn
            ? Math.floor((silentResult.expiresOn.getTime() - Date.now()) / 1000)
            : 3600
          storeToken(silentResult.accessToken, expiresIn)
          return true
        }
      } catch {
        // Silent failed — user needs to re-authenticate
      }
    }

    return false
  } catch (err) {
    console.error('[msal] Redirect handling failed:', err)
    return false
  }
}

/**
 * Initiate MSAL login redirect.
 */
export async function loginWithMsal(): Promise<void> {
  const config = getAuthConfig()
  if (!config.tenantId || !config.clientId) {
    throw new Error('Entra ID not configured')
  }

  const msal = await getMsalInstance(config)
  await msal.acquireTokenRedirect({ scopes: config.scopes })
}

/**
 * Acquire a fresh token silently (for token refresh).
 * Falls back to redirect if silent acquisition fails.
 */
export async function acquireTokenSilent(): Promise<string> {
  const config = getAuthConfig()
  const msal = await getMsalInstance(config)
  const account = msal.getActiveAccount()

  if (!account) {
    throw new Error('No active account — login required')
  }

  try {
    const result = await msal.acquireTokenSilent({
      scopes: config.scopes,
      account,
    })
    storeToken(
      result.accessToken,
      result.expiresOn
        ? Math.floor((result.expiresOn.getTime() - Date.now()) / 1000)
        : 3600
    )
    return result.accessToken
  } catch {
    // Silent failed — trigger redirect
    await msal.acquireTokenRedirect({ scopes: config.scopes })
    throw new Error('Redirecting for auth...')
  }
}

/**
 * Logout via MSAL redirect.
 */
export async function logoutWithMsal(): Promise<void> {
  const config = getAuthConfig()
  if (!config.tenantId || !config.clientId) return

  try {
    const msal = await getMsalInstance(config)
    await msal.logoutRedirect({
      postLogoutRedirectUri: window.location.origin,
    })
  } catch {
    // Fallback: clear local state
    sessionStorage.clear()
    window.location.href = '/'
  }
}

/**
 * Get current user info from MSAL account.
 */
export async function getMsalUser(): Promise<{ email: string; name: string; oid?: string } | null> {
  const config = getAuthConfig()
  if (!config.tenantId || !config.clientId) return null

  try {
    const msal = await getMsalInstance(config)
    const account = msal.getActiveAccount()
    if (!account) return null

    return {
      email: account.username ?? '',
      name: account.name ?? account.username ?? '',
      oid: account.localAccountId,
    }
  } catch {
    return null
  }
}
