/**
 * Azure Key Vault Credential Backend
 *
 * Stores credentials in Azure Key Vault for enterprise deployments.
 * Uses managed identity (Azure Container Apps) or client certificate for auth.
 *
 * Enabled via environment variable: CREDENTIAL_STORE=keyvault
 *
 * Required env vars:
 *   AZURE_KEYVAULT_URL    — Key Vault URL (e.g., https://craft-vault.vault.azure.net)
 *   CREDENTIAL_STORE      — Must be "keyvault" to activate this backend
 *
 * Auth (one of):
 *   - Managed Identity (default on Azure Container Apps — no config needed)
 *   - AZURE_CLIENT_ID + AZURE_CLIENT_SECRET + AZURE_TENANT_ID (service principal)
 *   - AZURE_CLIENT_ID + AZURE_CLIENT_CERTIFICATE_PATH (certificate auth)
 */

import type { CredentialBackend } from './types'
import type { CredentialId, StoredCredential } from '../types'
import { credentialIdToAccount, accountToCredentialId } from '../types'

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface KeyVaultConfig {
  vaultUrl: string
}

interface KeyVaultSecret {
  value: string
  name: string
  properties: {
    enabled: boolean
    tags?: Record<string, string>
  }
}

// ---------------------------------------------------------------------------
// Azure Key Vault REST Client (lightweight — no SDK dependency)
// ---------------------------------------------------------------------------

/**
 * Minimal Azure Key Vault REST client.
 * Uses the 7.4 API version. Auth via managed identity or service principal.
 */
class KeyVaultClient {
  private vaultUrl: string
  private accessToken: string | null = null
  private tokenExpiresAt = 0

  constructor(vaultUrl: string) {
    // Normalize URL (remove trailing slash)
    this.vaultUrl = vaultUrl.replace(/\/$/, '')
  }

  /**
   * Get an access token for Key Vault.
   * Tries managed identity first, then service principal.
   */
  private async getToken(): Promise<string> {
    const now = Date.now()
    if (this.accessToken && this.tokenExpiresAt > now + 60_000) {
      return this.accessToken
    }

    // Try Managed Identity (Azure IMDS endpoint)
    const token = await this.tryManagedIdentity()
      ?? await this.tryServicePrincipal()

    if (!token) {
      throw new Error(
        'Azure Key Vault auth failed. Ensure managed identity is configured ' +
        'or set AZURE_CLIENT_ID + AZURE_CLIENT_SECRET + AZURE_TENANT_ID.'
      )
    }

    this.accessToken = token.accessToken
    this.tokenExpiresAt = now + (token.expiresIn * 1000)
    return this.accessToken
  }

  private async tryManagedIdentity(): Promise<{ accessToken: string; expiresIn: number } | null> {
    try {
      // Azure IMDS endpoint for managed identity
      const identityEndpoint = process.env.IDENTITY_ENDPOINT || 'http://169.254.169.254/metadata/identity/oauth2/token'
      const identityHeader = process.env.IDENTITY_HEADER

      const url = new URL(identityEndpoint)
      url.searchParams.set('api-version', '2019-08-01')
      url.searchParams.set('resource', 'https://vault.azure.net')
      if (process.env.AZURE_CLIENT_ID) {
        url.searchParams.set('client_id', process.env.AZURE_CLIENT_ID)
      }

      const headers: Record<string, string> = { 'Metadata': 'true' }
      if (identityHeader) {
        headers['X-IDENTITY-HEADER'] = identityHeader
      }

      const response = await fetch(url.toString(), {
        headers,
        signal: AbortSignal.timeout(5_000),
      })

      if (!response.ok) return null

      const data = await response.json() as { access_token: string; expires_in: string }
      return {
        accessToken: data.access_token,
        expiresIn: parseInt(data.expires_in, 10) || 3600,
      }
    } catch {
      return null
    }
  }

  private async tryServicePrincipal(): Promise<{ accessToken: string; expiresIn: number } | null> {
    const clientId = process.env.AZURE_CLIENT_ID
    const clientSecret = process.env.AZURE_CLIENT_SECRET
    const tenantId = process.env.AZURE_TENANT_ID

    if (!clientId || !clientSecret || !tenantId) return null

    try {
      const url = `https://login.microsoftonline.com/${tenantId}/oauth2/v2.0/token`
      const body = new URLSearchParams({
        client_id: clientId,
        client_secret: clientSecret,
        scope: 'https://vault.azure.net/.default',
        grant_type: 'client_credentials',
      })

      const response = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: body.toString(),
        signal: AbortSignal.timeout(10_000),
      })

      if (!response.ok) return null

      const data = await response.json() as { access_token: string; expires_in: number }
      return {
        accessToken: data.access_token,
        expiresIn: data.expires_in || 3600,
      }
    } catch {
      return null
    }
  }

  // ---------------------------------------------------------------------------
  // Key Vault Operations
  // ---------------------------------------------------------------------------

  private sanitizeSecretName(name: string): string {
    // Key Vault secret names: alphanumeric + hyphens only, 1-127 chars
    return name
      .replace(/::/g, '-')
      .replace(/[^a-zA-Z0-9-]/g, '-')
      .replace(/-+/g, '-')
      .replace(/^-|-$/g, '')
      .slice(0, 127) || 'unnamed'
  }

  async getSecret(name: string): Promise<KeyVaultSecret | null> {
    const token = await this.getToken()
    const safeName = this.sanitizeSecretName(name)

    try {
      const response = await fetch(
        `${this.vaultUrl}/secrets/${safeName}?api-version=7.4`,
        {
          headers: { Authorization: `Bearer ${token}` },
          signal: AbortSignal.timeout(10_000),
        }
      )

      if (response.status === 404) return null
      if (!response.ok) {
        throw new Error(`Key Vault GET failed: ${response.status} ${response.statusText}`)
      }

      const data = await response.json() as any
      return {
        value: data.value,
        name: safeName,
        properties: {
          enabled: data.attributes?.enabled ?? true,
          tags: data.tags,
        },
      }
    } catch (err) {
      if ((err as any)?.message?.includes('404')) return null
      throw err
    }
  }

  async setSecret(name: string, value: string, tags?: Record<string, string>): Promise<void> {
    const token = await this.getToken()
    const safeName = this.sanitizeSecretName(name)

    const body: Record<string, unknown> = { value }
    if (tags) body.tags = tags

    const response = await fetch(
      `${this.vaultUrl}/secrets/${safeName}?api-version=7.4`,
      {
        method: 'PUT',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(10_000),
      }
    )

    if (!response.ok) {
      throw new Error(`Key Vault SET failed: ${response.status} ${response.statusText}`)
    }
  }

  async deleteSecret(name: string): Promise<boolean> {
    const token = await this.getToken()
    const safeName = this.sanitizeSecretName(name)

    const response = await fetch(
      `${this.vaultUrl}/secrets/${safeName}?api-version=7.4`,
      {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${token}` },
        signal: AbortSignal.timeout(10_000),
      }
    )

    return response.ok || response.status === 404
  }

  async listSecrets(prefix?: string): Promise<string[]> {
    const token = await this.getToken()
    const names: string[] = []
    let nextLink: string | null = `${this.vaultUrl}/secrets?api-version=7.4&maxresults=25`

    while (nextLink) {
      const response = await fetch(nextLink, {
        headers: { Authorization: `Bearer ${token}` },
        signal: AbortSignal.timeout(10_000),
      })

      if (!response.ok) break

      const data = await response.json() as { value: { id: string }[]; nextLink?: string }
      for (const item of data.value) {
        // Extract name from ID URL: https://vault.vault.azure.net/secrets/{name}/{version}
        const parts = item.id.split('/')
        const name = parts[parts.length - 1] || ''
        if (!prefix || name.startsWith(prefix)) {
          names.push(name)
        }
      }

      nextLink = data.nextLink ?? null
    }

    return names
  }
}

// ---------------------------------------------------------------------------
// Key Vault Credential Backend
// ---------------------------------------------------------------------------

const SECRET_PREFIX = 'craft-'

export class KeyVaultBackend implements CredentialBackend {
  readonly name = 'azure-keyvault'
  readonly priority = 200 // Higher than SecureStorageBackend (100)

  private client: KeyVaultClient | null = null

  private getClient(): KeyVaultClient {
    if (!this.client) {
      const vaultUrl = process.env.AZURE_KEYVAULT_URL
      if (!vaultUrl) throw new Error('AZURE_KEYVAULT_URL is required for Key Vault backend')
      this.client = new KeyVaultClient(vaultUrl)
    }
    return this.client
  }

  private credentialToSecretName(id: CredentialId): string {
    return SECRET_PREFIX + credentialIdToAccount(id)
  }

  async isAvailable(): Promise<boolean> {
    return (
      process.env.CREDENTIAL_STORE === 'keyvault' &&
      !!process.env.AZURE_KEYVAULT_URL
    )
  }

  async get(id: CredentialId): Promise<StoredCredential | null> {
    const client = this.getClient()
    const secretName = this.credentialToSecretName(id)
    const secret = await client.getSecret(secretName)

    if (!secret || !secret.properties.enabled) return null

    try {
      return JSON.parse(secret.value) as StoredCredential
    } catch {
      // Value is a plain string (API key), wrap it
      return { value: secret.value }
    }
  }

  async set(id: CredentialId, credential: StoredCredential): Promise<void> {
    const client = this.getClient()
    const secretName = this.credentialToSecretName(id)
    const value = JSON.stringify(credential)

    await client.setSecret(secretName, value, {
      type: id.type,
      workspaceId: id.workspaceId || '',
      sourceId: id.sourceId || '',
      connectionSlug: id.connectionSlug || '',
    })
  }

  async delete(id: CredentialId): Promise<boolean> {
    const client = this.getClient()
    const secretName = this.credentialToSecretName(id)
    return client.deleteSecret(secretName)
  }

  async list(filter?: Partial<CredentialId>): Promise<CredentialId[]> {
    const client = this.getClient()
    const names = await client.listSecrets(SECRET_PREFIX)

    const ids: CredentialId[] = []
    for (const name of names) {
      // Remove prefix and convert back to credential ID
      const account = name.slice(SECRET_PREFIX.length).replace(/-/g, '::')
      const id = accountToCredentialId(account)
      if (!id) continue

      // Apply filter
      if (filter) {
        if (filter.type && id.type !== filter.type) continue
        if (filter.workspaceId && id.workspaceId !== filter.workspaceId) continue
        if (filter.sourceId && id.sourceId !== filter.sourceId) continue
        if (filter.connectionSlug && id.connectionSlug !== filter.connectionSlug) continue
      }

      ids.push(id)
    }

    return ids
  }
}

// ---------------------------------------------------------------------------
// Factory
// ---------------------------------------------------------------------------

export function isKeyVaultConfigured(): boolean {
  return (
    process.env.CREDENTIAL_STORE === 'keyvault' &&
    !!process.env.AZURE_KEYVAULT_URL
  )
}
