/**
 * Jotai atoms for web client state management.
 */

import { atom } from 'jotai'
import type { WebRpcClient, ConnectionState } from './rpc-client'
import type { CraftApi } from './api-bridge'

// ---------------------------------------------------------------------------
// Connection
// ---------------------------------------------------------------------------

export const rpcClientAtom = atom<WebRpcClient | null>(null)
export const apiAtom = atom<CraftApi | null>(null)
export const connectionStateAtom = atom<ConnectionState>('disconnected')

// ---------------------------------------------------------------------------
// Workspace
// ---------------------------------------------------------------------------

export const activeWorkspaceIdAtom = atom<string | null>(null)
export const workspacesAtom = atom<unknown[]>([])

// ---------------------------------------------------------------------------
// Sessions
// ---------------------------------------------------------------------------

export const sessionsAtom = atom<unknown[]>([])
export const activeSessionIdAtom = atom<string | null>(null)

// ---------------------------------------------------------------------------
// Auth
// ---------------------------------------------------------------------------

export const isAuthenticatedAtom = atom<boolean>(false)
export const currentUserAtom = atom<{ email: string; name: string } | null>(null)
