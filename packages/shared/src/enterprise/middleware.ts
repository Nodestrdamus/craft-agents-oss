/**
 * Enterprise RBAC Middleware
 *
 * Intercepts RPC requests to validate user permissions against channel requirements.
 * Integrates with the dual-auth system (static token = admin, JWT = role-based).
 */

import type { EnterpriseUser, EnterpriseRole } from './types'
import { getRequiredRole, hasMinRole } from './types'
import { loadEnterpriseConfig } from './user-store'
import { getUserByEntraOid, provisionFromEntraUser, getEffectiveRole, appendAudit } from './user-store'
import { validateEntraToken, loadEntraConfig, type ValidatedEntraUser, type EntraConfig } from '../auth/entra-jwt'

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface AuthenticatedContext {
  /** Whether this is a static token (server-to-server / CLI) auth */
  isStaticToken: boolean
  /** Resolved enterprise user (null for static token auth) */
  user: EnterpriseUser | null
  /** Effective role for the target workspace */
  effectiveRole: EnterpriseRole
  /** Entra claims (null for static token auth) */
  entraClaims: ValidatedEntraUser | null
}

// ---------------------------------------------------------------------------
// Token → User Resolution
// ---------------------------------------------------------------------------

/**
 * Resolve a bearer token to an authenticated context.
 *
 * Static tokens get admin-level access (backward compatible with CLI/automation).
 * JWT tokens are validated and resolved to an enterprise user.
 */
export async function resolveAuthContext(
  token: string,
  serverToken: string,
  workspaceId?: string,
): Promise<AuthenticatedContext | null> {
  // Static token = admin (CLI, automation, server-to-server)
  if (token === serverToken) {
    return {
      isStaticToken: true,
      user: null,
      effectiveRole: 'admin',
      entraClaims: null,
    }
  }

  // Try Entra JWT
  const entraConfig = loadEntraConfig()
  if (!entraConfig) return null

  const entraClaims = await validateEntraToken(token, entraConfig)
  if (!entraClaims) return null

  // Check if enterprise mode is enabled
  const config = loadEnterpriseConfig()
  if (!config.enabled) {
    // Enterprise mode disabled — all JWT users get admin (backward compatible)
    return {
      isStaticToken: false,
      user: null,
      effectiveRole: 'admin',
      entraClaims,
    }
  }

  // Provision/update user
  const user = provisionFromEntraUser(entraClaims, config)
  if (!user.isActive) return null

  // Resolve effective role for workspace
  const effectiveRole = workspaceId ? getEffectiveRole(user, workspaceId) : user.role

  return {
    isStaticToken: false,
    user,
    effectiveRole,
    entraClaims,
  }
}

// ---------------------------------------------------------------------------
// Permission Check
// ---------------------------------------------------------------------------

/**
 * Check if an authenticated context has permission for an RPC channel.
 *
 * @returns true if permitted, false if denied
 */
export function checkPermission(
  auth: AuthenticatedContext,
  channel: string,
): boolean {
  // Static token always has admin access
  if (auth.isStaticToken) return true

  const required = getRequiredRole(channel)
  const allowed = hasMinRole(auth.effectiveRole, required)

  if (!allowed) {
    appendAudit({
      action: 'permission.denied',
      userId: auth.user?.id ?? null,
      userEmail: auth.user?.email ?? null,
      resourceType: 'system',
      resourceId: channel,
      details: {
        requiredRole: required,
        effectiveRole: auth.effectiveRole,
      },
    })
  }

  return allowed
}

// ---------------------------------------------------------------------------
// Enhanced Token Validator
// ---------------------------------------------------------------------------

/**
 * Create an enterprise-aware token validator for WsRpcServer.
 *
 * This replaces `createDualTokenValidator` when enterprise mode is enabled.
 * It validates the token AND provisions/updates the user in the store.
 *
 * The validated user info is cached per-connection for subsequent RPC calls.
 */
export function createEnterpriseTokenValidator(
  serverToken: string,
): {
  validateToken: (token: string) => Promise<boolean>
  resolveAuth: (token: string, workspaceId?: string) => Promise<AuthenticatedContext | null>
} {
  // Cache resolved contexts by token (short TTL — re-validate on reconnect)
  const authCache = new Map<string, { context: AuthenticatedContext; expiresAt: number }>()
  const CACHE_TTL_MS = 5 * 60 * 1000 // 5 minutes

  const resolveAuth = async (token: string, workspaceId?: string): Promise<AuthenticatedContext | null> => {
    // Check cache
    const cached = authCache.get(token)
    if (cached && cached.expiresAt > Date.now()) {
      return cached.context
    }

    const context = await resolveAuthContext(token, serverToken, workspaceId)
    if (context) {
      authCache.set(token, { context, expiresAt: Date.now() + CACHE_TTL_MS })
    }
    return context
  }

  const validateToken = async (token: string): Promise<boolean> => {
    const context = await resolveAuth(token)
    return context !== null
  }

  return { validateToken, resolveAuth }
}
