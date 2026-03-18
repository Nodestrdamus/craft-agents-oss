/**
 * Workspace management hooks.
 */

import { useState, useEffect, useCallback } from 'react'
import { useAtom, useAtomValue } from 'jotai'
import { apiAtom, activeWorkspaceIdAtom, workspacesAtom } from '../lib/atoms'
import { useConnectionState } from './useApi'

export interface WorkspaceSummary {
  id?: string
  slug: string
  name: string
  sourceCount: number
  sessionCount: number
  createdAt: number
}

export function useWorkspaces() {
  const api = useAtomValue(apiAtom)
  const connectionState = useConnectionState()
  const [workspaces, setWorkspaces] = useAtom(workspacesAtom)
  const [activeWorkspaceId, setActiveWorkspaceId] = useAtom(activeWorkspaceIdAtom)
  const [loading, setLoading] = useState(false)

  const refresh = useCallback(async () => {
    if (!api || connectionState !== 'connected') return
    setLoading(true)
    try {
      const result = await api.getWorkspaces() as WorkspaceSummary[]
      setWorkspaces(result)
    } catch (err) {
      console.error('[useWorkspaces] Failed to load:', err)
    } finally {
      setLoading(false)
    }
  }, [api, connectionState, setWorkspaces])

  useEffect(() => {
    refresh()
  }, [refresh])

  const createWorkspace = useCallback(async (name: string) => {
    if (!api) return null
    try {
      const ws = await api.createWorkspace(name) as WorkspaceSummary
      await refresh()
      setActiveWorkspaceId(ws.slug ?? ws.id ?? null)
      return ws
    } catch (err) {
      console.error('[useWorkspaces] Failed to create:', err)
      return null
    }
  }, [api, refresh, setActiveWorkspaceId])

  const switchWorkspace = useCallback((workspaceId: string) => {
    setActiveWorkspaceId(workspaceId)
  }, [setActiveWorkspaceId])

  return {
    workspaces: workspaces as WorkspaceSummary[],
    activeWorkspaceId,
    loading,
    createWorkspace,
    switchWorkspace,
    refresh,
  }
}
