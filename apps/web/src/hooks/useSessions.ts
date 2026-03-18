/**
 * Session management hooks.
 */

import { useState, useEffect, useCallback } from 'react'
import { useAtom, useAtomValue } from 'jotai'
import { apiAtom, activeWorkspaceIdAtom, activeSessionIdAtom, sessionsAtom } from '../lib/atoms'
import { useConnectionState } from './useApi'

export interface SessionSummary {
  id: string
  name?: string
  createdAt: number
  updatedAt?: number
  status?: string
  isBatch?: boolean
  isArchived?: boolean
  isFlagged?: boolean
  messageCount?: number
  permissionMode?: string
}

export function useSessions() {
  const api = useAtomValue(apiAtom)
  const workspaceId = useAtomValue(activeWorkspaceIdAtom)
  const connectionState = useConnectionState()
  const [sessions, setSessions] = useAtom(sessionsAtom)
  const [activeSessionId, setActiveSessionId] = useAtom(activeSessionIdAtom)
  const [loading, setLoading] = useState(false)

  const refresh = useCallback(async () => {
    if (!api || !workspaceId || connectionState !== 'connected') return
    setLoading(true)
    try {
      const result = await api.getSessions(workspaceId) as SessionSummary[]
      setSessions(result)
    } catch (err) {
      console.error('[useSessions] Failed to load sessions:', err)
    } finally {
      setLoading(false)
    }
  }, [api, workspaceId, connectionState, setSessions])

  // Load sessions on mount and workspace change
  useEffect(() => {
    refresh()
  }, [refresh])

  // Listen for session events to auto-refresh
  useEffect(() => {
    if (!api) return
    return api.onSessionEvent(() => {
      refresh()
    })
  }, [api, refresh])

  const createSession = useCallback(async (options?: Record<string, unknown>) => {
    if (!api || !workspaceId) return null
    try {
      const session = await api.createSession(workspaceId, options) as SessionSummary
      setActiveSessionId(session.id)
      await refresh()
      return session
    } catch (err) {
      console.error('[useSessions] Failed to create session:', err)
      return null
    }
  }, [api, workspaceId, setActiveSessionId, refresh])

  const deleteSession = useCallback(async (sessionId: string) => {
    if (!api) return false
    try {
      await api.deleteSession(sessionId)
      if (activeSessionId === sessionId) {
        setActiveSessionId(null)
      }
      await refresh()
      return true
    } catch (err) {
      console.error('[useSessions] Failed to delete session:', err)
      return false
    }
  }, [api, activeSessionId, setActiveSessionId, refresh])

  return {
    sessions: sessions as SessionSummary[],
    activeSessionId,
    setActiveSessionId,
    loading,
    createSession,
    deleteSession,
    refresh,
  }
}
