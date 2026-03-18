/**
 * Sidebar — workspace selector, session list, navigation.
 */

import { useState, useMemo } from 'react'
import { useSessions, useWorkspaces, type SessionSummary } from '../hooks'

interface SidebarProps {
  collapsed: boolean
  onToggle: () => void
}

type SidebarView = 'sessions' | 'batches' | 'settings'

export function Sidebar({ collapsed, onToggle }: SidebarProps) {
  const { workspaces, activeWorkspaceId, switchWorkspace } = useWorkspaces()
  const { sessions, activeSessionId, setActiveSessionId, createSession } = useSessions()
  const [view, setView] = useState<SidebarView>('sessions')
  const [search, setSearch] = useState('')

  // Filter sessions: exclude batch sessions from main list
  const { regularSessions, batchSessions } = useMemo(() => {
    const regular: SessionSummary[] = []
    const batch: SessionSummary[] = []
    for (const s of sessions) {
      if (s.isBatch) batch.push(s)
      else regular.push(s)
    }
    return { regularSessions: regular, batchSessions: batch }
  }, [sessions])

  const filteredSessions = useMemo(() => {
    const list = view === 'batches' ? batchSessions : regularSessions
    if (!search) return list
    const q = search.toLowerCase()
    return list.filter(s =>
      (s.name ?? '').toLowerCase().includes(q)
    )
  }, [view, regularSessions, batchSessions, search])

  if (collapsed) {
    return (
      <aside className="w-12 flex-shrink-0 border-r border-border bg-surface flex flex-col items-center py-3 gap-3">
        <button
          onClick={onToggle}
          className="w-8 h-8 rounded-md hover:bg-hover flex items-center justify-center text-muted"
          title="Expand sidebar"
        >
          <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M9 18l6-6-6-6" />
          </svg>
        </button>
        <button
          onClick={() => createSession()}
          className="w-8 h-8 rounded-md hover:bg-hover flex items-center justify-center text-muted"
          title="New session"
        >
          <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M12 5v14M5 12h14" />
          </svg>
        </button>
      </aside>
    )
  }

  return (
    <aside className="w-72 flex-shrink-0 border-r border-border bg-surface flex flex-col">
      {/* Header */}
      <div className="flex items-center justify-between px-3 py-2 border-b border-border">
        <div className="flex items-center gap-2 min-w-0">
          <button
            onClick={onToggle}
            className="w-7 h-7 rounded-md hover:bg-hover flex items-center justify-center text-muted flex-shrink-0"
          >
            <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M15 18l-6-6 6-6" />
            </svg>
          </button>

          {/* Workspace selector */}
          {workspaces.length > 1 ? (
            <select
              value={activeWorkspaceId ?? ''}
              onChange={(e) => switchWorkspace(e.target.value)}
              className="text-sm font-medium bg-transparent border-none outline-none truncate cursor-pointer min-w-0"
            >
              {workspaces.map((ws: any) => (
                <option key={ws.slug ?? ws.id} value={ws.slug ?? ws.id}>
                  {ws.name}
                </option>
              ))}
            </select>
          ) : (
            <span className="text-sm font-medium truncate">
              {(workspaces[0] as any)?.name ?? 'Craft Agents'}
            </span>
          )}
        </div>

        <button
          onClick={() => createSession()}
          className="w-7 h-7 rounded-md bg-accent text-white flex items-center justify-center hover:opacity-90 flex-shrink-0"
          title="New session"
        >
          <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M12 5v14M5 12h14" />
          </svg>
        </button>
      </div>

      {/* Navigation tabs */}
      <div className="flex border-b border-border text-xs">
        {(['sessions', 'batches', 'settings'] as const).map(tab => (
          <button
            key={tab}
            onClick={() => setView(tab)}
            className={`flex-1 py-2 capitalize transition-colors ${
              view === tab
                ? 'text-accent border-b-2 border-accent font-medium'
                : 'text-muted hover:text-foreground'
            }`}
          >
            {tab}
            {tab === 'batches' && batchSessions.length > 0 && (
              <span className="ml-1 text-[10px] bg-accent/20 text-accent px-1 rounded">
                {batchSessions.length}
              </span>
            )}
          </button>
        ))}
      </div>

      {/* Search */}
      {view !== 'settings' && (
        <div className="px-3 py-2">
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search sessions..."
            className="w-full rounded-md border border-border bg-background px-2.5 py-1.5 text-xs focus:outline-none focus:ring-1 focus:ring-accent"
          />
        </div>
      )}

      {/* Content */}
      <div className="flex-1 overflow-y-auto">
        {view === 'settings' ? (
          <SettingsNav />
        ) : (
          <SessionList
            sessions={filteredSessions}
            activeSessionId={activeSessionId}
            onSelect={setActiveSessionId}
          />
        )}
      </div>
    </aside>
  )
}

// ---------------------------------------------------------------------------
// Sub-components
// ---------------------------------------------------------------------------

function SessionList({
  sessions,
  activeSessionId,
  onSelect,
}: {
  sessions: SessionSummary[]
  activeSessionId: string | null
  onSelect: (id: string) => void
}) {
  if (sessions.length === 0) {
    return (
      <div className="px-4 py-8 text-center text-xs text-muted">
        No sessions yet. Create one to get started.
      </div>
    )
  }

  return (
    <ul className="divide-y divide-border">
      {sessions.map(session => (
        <li key={session.id}>
          <button
            onClick={() => onSelect(session.id)}
            className={`w-full px-3 py-2.5 text-left hover:bg-hover transition-colors ${
              activeSessionId === session.id ? 'bg-hover' : ''
            }`}
          >
            <div className="flex items-center gap-2">
              {session.isFlagged && <span className="text-yellow-500 text-xs">★</span>}
              <p className="text-sm font-medium truncate flex-1">
                {session.name ?? 'Untitled'}
              </p>
              {session.status === 'processing' && (
                <div className="w-1.5 h-1.5 rounded-full bg-accent animate-pulse flex-shrink-0" />
              )}
            </div>
            <p className="text-[11px] text-muted mt-0.5 truncate">
              {formatRelativeTime(session.updatedAt ?? session.createdAt)}
              {session.messageCount ? ` · ${session.messageCount} messages` : ''}
            </p>
          </button>
        </li>
      ))}
    </ul>
  )
}

function SettingsNav() {
  return (
    <ul className="py-2">
      {[
        { label: 'LLM Connections', icon: '🤖' },
        { label: 'Sources', icon: '🔌' },
        { label: 'Skills', icon: '⚡' },
        { label: 'Notes', icon: '📝' },
        { label: 'Enterprise', icon: '🏢' },
        { label: 'Marketplace', icon: '🛍️' },
      ].map(item => (
        <li key={item.label}>
          <button className="w-full px-3 py-2 text-left text-sm hover:bg-hover transition-colors flex items-center gap-2">
            <span>{item.icon}</span>
            {item.label}
          </button>
        </li>
      ))}
    </ul>
  )
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function formatRelativeTime(timestamp: number): string {
  const now = Date.now()
  const diff = now - timestamp
  const seconds = Math.floor(diff / 1000)
  const minutes = Math.floor(seconds / 60)
  const hours = Math.floor(minutes / 60)
  const days = Math.floor(hours / 24)

  if (days > 7) return new Date(timestamp).toLocaleDateString()
  if (days > 0) return `${days}d ago`
  if (hours > 0) return `${hours}h ago`
  if (minutes > 0) return `${minutes}m ago`
  return 'just now'
}
