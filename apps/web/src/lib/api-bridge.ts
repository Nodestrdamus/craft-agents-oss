/**
 * API Bridge — replaces window.electronAPI for the web client.
 *
 * The Electron renderer calls window.electronAPI.* for all server communication.
 * This module provides the same interface, routing calls through WebRpcClient
 * instead of Electron IPC.
 *
 * Usage:
 *   import { createApiBridge } from '@/lib/api-bridge'
 *   const api = createApiBridge(rpcClient)
 *   // api.sessions.get(workspaceId) → rpcClient.invoke('sessions:get', workspaceId)
 */

import { RPC_CHANNELS } from '@craft-agent/shared/protocol'
import type { WebRpcClient } from './rpc-client'

/**
 * Create a proxy-based API bridge that maps method calls to RPC invocations.
 *
 * Returns an object where:
 *   api.sessions.get(workspaceId) → rpcClient.invoke('sessions:get', workspaceId)
 *   api.skills.getGlobal()        → rpcClient.invoke('skills:getGlobal')
 *
 * This mirrors the RPC_CHANNELS structure exactly.
 */
export function createApiBridge(client: WebRpcClient) {
  const bridge: Record<string, Record<string, (...args: unknown[]) => Promise<unknown>>> = {}

  for (const [namespace, channels] of Object.entries(RPC_CHANNELS)) {
    const methods: Record<string, (...args: unknown[]) => Promise<unknown>> = {}

    for (const [key, channel] of Object.entries(channels as Record<string, string>)) {
      // Convert KEY_NAME to camelCase method name
      const methodName = key.toLowerCase().replace(/_([a-z])/g, (_, c) => c.toUpperCase())
      methods[methodName] = (...args: unknown[]) => client.invoke(channel, ...args)
    }

    bridge[namespace] = methods
  }

  return bridge
}

/**
 * Type-safe invoke helper for common operations.
 */
export class CraftApi {
  constructor(private client: WebRpcClient) {}

  // Sessions
  getSessions(workspaceId: string) {
    return this.client.invoke(RPC_CHANNELS.sessions.GET, workspaceId)
  }
  createSession(workspaceId: string, options?: unknown) {
    return this.client.invoke(RPC_CHANNELS.sessions.CREATE, workspaceId, options)
  }
  deleteSession(sessionId: string) {
    return this.client.invoke(RPC_CHANNELS.sessions.DELETE, sessionId)
  }
  sendMessage(sessionId: string, message: string, attachments?: unknown[], storedAttachments?: unknown[], options?: unknown) {
    return this.client.invoke(RPC_CHANNELS.sessions.SEND_MESSAGE, sessionId, message, attachments, storedAttachments, options)
  }
  cancelProcessing(sessionId: string) {
    return this.client.invoke(RPC_CHANNELS.sessions.CANCEL, sessionId)
  }
  getMessages(sessionId: string) {
    return this.client.invoke(RPC_CHANNELS.sessions.GET_MESSAGES, sessionId)
  }
  sendCommand(sessionId: string, command: unknown) {
    return this.client.invoke(RPC_CHANNELS.sessions.COMMAND, sessionId, command)
  }

  // Skills
  getSkills(workspaceId: string, workingDirectory?: string) {
    return this.client.invoke(RPC_CHANNELS.skills.GET, workspaceId, workingDirectory)
  }
  createSkill(workspaceId: string, slug: string, input: unknown) {
    return this.client.invoke(RPC_CHANNELS.skills.CREATE, workspaceId, slug, input)
  }
  saveSkill(workspaceId: string, slug: string, input: unknown) {
    return this.client.invoke(RPC_CHANNELS.skills.SAVE, workspaceId, slug, input)
  }
  deleteSkill(workspaceId: string, slug: string) {
    return this.client.invoke(RPC_CHANNELS.skills.DELETE, workspaceId, slug)
  }
  getGlobalSkills() {
    return this.client.invoke(RPC_CHANNELS.skills.GET_GLOBAL)
  }
  createGlobalSkill(slug: string, input: unknown) {
    return this.client.invoke(RPC_CHANNELS.skills.CREATE_GLOBAL, slug, input)
  }
  saveGlobalSkill(slug: string, input: unknown) {
    return this.client.invoke(RPC_CHANNELS.skills.SAVE_GLOBAL, slug, input)
  }
  deleteGlobalSkill(slug: string) {
    return this.client.invoke(RPC_CHANNELS.skills.DELETE_GLOBAL, slug)
  }

  // Sources
  getSources(workspaceId: string) {
    return this.client.invoke(RPC_CHANNELS.sources.GET, workspaceId)
  }

  // Workspaces
  getWorkspaces() {
    return this.client.invoke(RPC_CHANNELS.workspaces.GET)
  }
  createWorkspace(name: string, defaults?: unknown) {
    return this.client.invoke(RPC_CHANNELS.workspaces.CREATE, name, defaults)
  }

  // Events
  onSessionEvent(callback: (...args: unknown[]) => void) {
    return this.client.on(RPC_CHANNELS.sessions.EVENT, callback)
  }
  onSkillsChanged(callback: (...args: unknown[]) => void) {
    return this.client.on(RPC_CHANNELS.skills.CHANGED, callback)
  }
  onSourcesChanged(callback: (...args: unknown[]) => void) {
    return this.client.on(RPC_CHANNELS.sources.CHANGED, callback)
  }

  // File downloads (via HTTP, not WebSocket)
  getFileDownloadUrl(path: string, token: string): string {
    const baseUrl = import.meta.env.VITE_API_URL ?? window.location.origin
    return `${baseUrl}/api/files/download?path=${encodeURIComponent(path)}&token=${encodeURIComponent(token)}`
  }

  getSessionExportUrl(sessionId: string, token: string): string {
    const baseUrl = import.meta.env.VITE_API_URL ?? window.location.origin
    return `${baseUrl}/api/sessions/${sessionId}/export?token=${encodeURIComponent(token)}`
  }
}
