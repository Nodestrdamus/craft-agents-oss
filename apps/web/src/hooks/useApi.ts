/**
 * Core hooks for accessing the RPC client and API bridge.
 */

import { useAtomValue } from 'jotai'
import { apiAtom, rpcClientAtom, connectionStateAtom } from '../lib/atoms'
import type { CraftApi } from '../lib/api-bridge'
import type { WebRpcClient, ConnectionState } from '../lib/rpc-client'

/** Get the type-safe CraftApi instance. Throws if not connected. */
export function useApi(): CraftApi {
  const api = useAtomValue(apiAtom)
  if (!api) throw new Error('API not available — not connected')
  return api
}

/** Get the CraftApi instance, or null if not connected. */
export function useApiOptional(): CraftApi | null {
  return useAtomValue(apiAtom)
}

/** Get the raw RPC client. */
export function useRpcClient(): WebRpcClient | null {
  return useAtomValue(rpcClientAtom)
}

/** Get current connection state. */
export function useConnectionState(): ConnectionState {
  return useAtomValue(connectionStateAtom)
}

/** Check if the client is connected. */
export function useIsConnected(): boolean {
  return useConnectionState() === 'connected'
}
