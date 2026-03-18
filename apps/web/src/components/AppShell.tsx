/**
 * AppShell — main layout wrapper with sidebar + content area.
 * Replaces the Electron window chrome with a web-native layout.
 */

import { useState, type ReactNode } from 'react'
import { Sidebar } from './Sidebar'
import { ConnectionStatus } from './ConnectionStatus'
import { useConnectionState } from '../hooks/useApi'

interface AppShellProps {
  children: ReactNode
}

export function AppShell({ children }: AppShellProps) {
  const connectionState = useConnectionState()
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false)

  return (
    <div className="flex h-screen bg-background text-foreground overflow-hidden">
      <ConnectionStatus state={connectionState} />

      {/* Sidebar */}
      <Sidebar
        collapsed={sidebarCollapsed}
        onToggle={() => setSidebarCollapsed(!sidebarCollapsed)}
      />

      {/* Main content */}
      <main className="flex-1 flex flex-col min-w-0">
        {children}
      </main>
    </div>
  )
}
