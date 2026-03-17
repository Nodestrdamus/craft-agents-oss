/**
 * Entra ID JWT Validation
 *
 * Validates Microsoft Entra ID (Azure AD) JWT tokens for WebSocket authentication.
 * Supports both v1.0 and v2.0 token endpoints with JWKS caching.
 *
 * Environment variables:
 *   ENTRA_TENANT_ID    — Azure AD tenant ID (required for Entra auth)
 *   ENTRA_CLIENT_ID    — App registration client ID (used as audience)
 *   ENTRA_ISSUER       — Override issuer validation (optional)
 */

import { createVerify } from 'node:crypto'

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface EntraConfig {
  tenantId: string
  clientId: string
  issuer?: string
}

export interface EntraTokenClaims {
  /** Subject (user object ID) */
  sub: string
  /** Object ID (Entra user OID — more stable than sub for v2.0 tokens) */
  oid?: string
  /** User principal name (email-like) */
  upn?: string
  /** Preferred username */
  preferred_username?: string
  /** Email */
  email?: string
  /** Display name */
  name?: string
  /** Tenant ID */
  tid?: string
  /** Audience */
  aud?: string
  /** Issuer */
  iss?: string
  /** Expiration (unix seconds) */
  exp?: number
  /** Issued at (unix seconds) */
  iat?: number
  /** Not before (unix seconds) */
  nbf?: number
  /** Group memberships */
  groups?: string[]
  /** App roles */
  roles?: string[]
  /** Scope (space-separated) */
  scp?: string
}

export interface ValidatedEntraUser {
  objectId: string
  email: string
  displayName: string
  tenantId: string
  groups: string[]
  roles: string[]
}

// ---------------------------------------------------------------------------
// JWKS Cache
// ---------------------------------------------------------------------------

interface JwksKey {
  kty: string
  use: string
  kid: string
  n: string
  e: string
  x5c?: string[]
}

interface JwksCache {
  keys: Map<string, JwksKey>
  fetchedAt: number
}

const JWKS_CACHE_TTL_MS = 24 * 60 * 60 * 1000 // 24 hours
let jwksCache: JwksCache | null = null

async function fetchJwks(tenantId: string): Promise<Map<string, JwksKey>> {
  // Try v2.0 first, fall back to v1.0
  const urls = [
    `https://login.microsoftonline.com/${tenantId}/discovery/v2.0/keys`,
    `https://login.microsoftonline.com/${tenantId}/discovery/keys`,
  ]

  for (const url of urls) {
    try {
      const response = await fetch(url, {
        signal: AbortSignal.timeout(10_000),
      })
      if (!response.ok) continue

      const data = await response.json() as { keys: JwksKey[] }
      const keys = new Map<string, JwksKey>()
      for (const key of data.keys) {
        if (key.kid && key.use === 'sig') {
          keys.set(key.kid, key)
        }
      }
      if (keys.size > 0) return keys
    } catch {
      continue
    }
  }

  throw new Error('Failed to fetch JWKS from Entra ID')
}

async function getSigningKey(tenantId: string, kid: string): Promise<string> {
  // Refresh cache if expired or missing
  if (!jwksCache || (Date.now() - jwksCache.fetchedAt) > JWKS_CACHE_TTL_MS) {
    const keys = await fetchJwks(tenantId)
    jwksCache = { keys, fetchedAt: Date.now() }
  }

  const key = jwksCache.keys.get(kid)
  if (!key) {
    // Key not found — force refresh in case keys were rotated
    const keys = await fetchJwks(tenantId)
    jwksCache = { keys, fetchedAt: Date.now() }
    const refreshedKey = jwksCache.keys.get(kid)
    if (!refreshedKey) {
      throw new Error(`Signing key not found: ${kid}`)
    }
    return x5cToPem(refreshedKey)
  }

  return x5cToPem(key)
}

function x5cToPem(key: JwksKey): string {
  if (key.x5c && key.x5c.length > 0) {
    return `-----BEGIN CERTIFICATE-----\n${key.x5c[0]}\n-----END CERTIFICATE-----`
  }
  // Fall back to RSA public key from n + e
  return rsaPublicKeyToPem(key.n, key.e)
}

function rsaPublicKeyToPem(n: string, e: string): string {
  // Base64url decode
  const nBuf = Buffer.from(n, 'base64url')
  const eBuf = Buffer.from(e, 'base64url')

  // Build DER-encoded RSA public key
  const nLen = encodeDerLength(nBuf.length + 1) // +1 for leading 0x00
  const eLen = encodeDerLength(eBuf.length)

  const sequenceContent = Buffer.concat([
    Buffer.from([0x02]), nLen, Buffer.from([0x00]), nBuf, // INTEGER n (with leading 0)
    Buffer.from([0x02]), eLen, eBuf, // INTEGER e
  ])

  const bitString = Buffer.concat([
    Buffer.from([0x03]),
    encodeDerLength(sequenceContent.length + 3),
    Buffer.from([0x00, 0x30]),
    encodeDerLength(sequenceContent.length),
    sequenceContent,
  ])

  // RSA OID: 1.2.840.113549.1.1.1
  const rsaOid = Buffer.from([0x30, 0x0d, 0x06, 0x09, 0x2a, 0x86, 0x48, 0x86, 0xf7, 0x0d, 0x01, 0x01, 0x01, 0x05, 0x00])

  const outerSequence = Buffer.concat([
    Buffer.from([0x30]),
    encodeDerLength(rsaOid.length + bitString.length),
    rsaOid,
    bitString,
  ])

  const b64 = outerSequence.toString('base64')
  return `-----BEGIN PUBLIC KEY-----\n${b64.match(/.{1,64}/g)?.join('\n')}\n-----END PUBLIC KEY-----`
}

function encodeDerLength(len: number): Buffer {
  if (len < 0x80) return Buffer.from([len])
  if (len < 0x100) return Buffer.from([0x81, len])
  return Buffer.from([0x82, (len >> 8) & 0xff, len & 0xff])
}

// ---------------------------------------------------------------------------
// JWT Decoding & Validation
// ---------------------------------------------------------------------------

function decodeJwtPart(part: string): Record<string, unknown> {
  const json = Buffer.from(part, 'base64url').toString('utf8')
  return JSON.parse(json)
}

/**
 * Validate an Entra ID JWT token.
 *
 * Performs:
 * 1. Structure validation (3 parts)
 * 2. Header parsing + kid extraction
 * 3. Signature verification against JWKS
 * 4. Issuer validation (Entra tenant)
 * 5. Audience validation (client ID)
 * 6. Expiration check
 *
 * @returns Validated user info, or null if invalid
 */
export async function validateEntraToken(
  token: string,
  config: EntraConfig,
): Promise<ValidatedEntraUser | null> {
  try {
    const parts = token.split('.')
    if (parts.length !== 3) return null

    const headerB64 = parts[0]!
    const payloadB64 = parts[1]!
    const signatureB64 = parts[2]!

    // Decode header
    const header = decodeJwtPart(headerB64) as { alg?: string; kid?: string; typ?: string }
    if (!header.kid || header.alg !== 'RS256') return null

    // Get signing key
    const pem = await getSigningKey(config.tenantId, header.kid)

    // Verify signature
    const signatureInput = `${headerB64}.${payloadB64}`
    const signature = Buffer.from(signatureB64, 'base64url')

    const verifier = createVerify('RSA-SHA256')
    verifier.update(signatureInput)
    const isValid = verifier.verify(pem, signature)
    if (!isValid) return null

    // Decode payload
    const claims = decodeJwtPart(payloadB64) as unknown as EntraTokenClaims

    // Validate expiration
    const now = Math.floor(Date.now() / 1000)
    if (claims.exp && claims.exp < now) return null
    if (claims.nbf && claims.nbf > now + 300) return null // 5 min clock skew

    // Validate issuer
    const expectedIssuers = config.issuer
      ? [config.issuer]
      : [
          `https://login.microsoftonline.com/${config.tenantId}/v2.0`,
          `https://sts.windows.net/${config.tenantId}/`,
        ]
    if (claims.iss && !expectedIssuers.includes(claims.iss)) return null

    // Validate audience
    if (claims.aud && claims.aud !== config.clientId) return null

    // Extract user info
    return {
      objectId: claims.oid ?? claims.sub ?? '',
      email: claims.preferred_username ?? claims.upn ?? claims.email ?? '',
      displayName: claims.name ?? '',
      tenantId: claims.tid ?? config.tenantId,
      groups: claims.groups ?? [],
      roles: claims.roles ?? [],
    }
  } catch {
    return null
  }
}

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------

/**
 * Load Entra ID config from environment variables.
 * Returns null if Entra auth is not configured.
 */
export function loadEntraConfig(): EntraConfig | null {
  const tenantId = process.env.ENTRA_TENANT_ID
  const clientId = process.env.ENTRA_CLIENT_ID

  if (!tenantId || !clientId) return null

  return {
    tenantId,
    clientId,
    issuer: process.env.ENTRA_ISSUER,
  }
}

/**
 * Create a dual-mode token validator.
 *
 * Accepts either:
 * 1. Static server token (CRAFT_SERVER_TOKEN) — for CLI, automations, server-to-server
 * 2. Entra ID JWT — for web client, user-facing access
 *
 * If Entra is not configured (no ENTRA_TENANT_ID), falls back to static token only.
 */
export function createDualTokenValidator(
  serverToken: string,
): (token: string) => Promise<boolean> {
  const entraConfig = loadEntraConfig()

  return async (token: string): Promise<boolean> => {
    // Fast path: static server token
    if (token === serverToken) return true

    // If Entra is configured, try JWT validation
    if (entraConfig) {
      const user = await validateEntraToken(token, entraConfig)
      if (user) return true
    }

    return false
  }
}
