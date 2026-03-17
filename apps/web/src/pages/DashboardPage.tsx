import { useEffect, useState } from 'react'
import { useAtomValue } from 'jotai'
import { apiAtom, activeWorkspaceIdAtom, connectionStateAtom } from '../lib/atoms'

export function DashboardPage() {
  const api = useAtomValue(apiAtom)
  const workspaceId = useAtomValue(activeWorkspaceIdAtom)
  const connectionState = useAtomValue(connectionStateAtom)
  const [sessions, setSessions] = useState<any[]>([])
  const [activeSession, setActiveSession] = useState<string | null>(null)

  useEffect(() => {
    if (!api || !workspaceId || connectionState !== 'connected') return

    api.getSessions(workspaceId).then((result) => {
      setSessions(result as any[])
    }).catch(console.error)

    const unsub = api.onSessionEvent((...args: unknown[]) => {
      // Refresh sessions on events
      api.getSessions(workspaceId).then((result) => {
        setSessions(result as any[])
      }).catch(console.error)
    })

    return unsub
  }, [api, workspaceId, connectionState])

  const handleNewSession = async () => {
    if (!api || !workspaceId) return
    try {
      const session = await api.createSession(workspaceId) as any
      setActiveSession(session.id)
      // Refresh list
      const result = await api.getSessions(workspaceId)
      setSessions(result as any[])
    } catch (err) {
      console.error('Failed to create session:', err)
    }
  }

  return (
    <div className="flex h-screen">
      {/* Sidebar */}
      <aside className="w-72 flex-shrink-0 border-r border-border bg-surface overflow-y-auto">
        <div className="flex items-center justify-between p-4 border-b border-border">
          <h2 className="text-sm font-semibold">Sessions</h2>
          <button
            onClick={handleNewSession}
            className="rounded-md bg-accent px-3 py-1 text-xs font-medium text-white hover:opacity-90"
          >
            + New
          </button>
        </div>
        <ul className="divide-y divide-border">
          {sessions.map((session: any) => (
            <li key={session.id}>
              <button
                onClick={() => setActiveSession(session.id)}
                className={`w-full px-4 py-3 text-left hover:bg-hover transition-colors ${
                  activeSession === session.id ? 'bg-hover' : ''
                }`}
              >
                <p className="text-sm font-medium truncate">{session.name ?? 'Untitled'}</p>
                <p className="text-xs text-muted truncate mt-0.5">
                  {new Date(session.createdAt).toLocaleDateString()}
                </p>
              </button>
            </li>
          ))}
          {sessions.length === 0 && (
            <li className="px-4 py-8 text-center text-sm text-muted">
              No sessions yet. Create one to get started.
            </li>
          )}
        </ul>
      </aside>

      {/* Main content */}
      <main className="flex-1 flex flex-col">
        {activeSession ? (
          <ChatView sessionId={activeSession} />
        ) : (
          <div className="flex-1 flex items-center justify-center text-muted">
            <div className="text-center space-y-2">
              <p className="text-lg">Select or create a session</p>
              <p className="text-sm">Start a conversation with Craft Agent</p>
            </div>
          </div>
        )}
      </main>
    </div>
  )
}

function ChatView({ sessionId }: { sessionId: string }) {
  const api = useAtomValue(apiAtom)
  const [messages, setMessages] = useState<any[]>([])
  const [input, setInput] = useState('')
  const [sending, setSending] = useState(false)

  useEffect(() => {
    if (!api) return
    api.getMessages(sessionId).then((result) => {
      setMessages(result as any[])
    }).catch(console.error)

    const unsub = api.onSessionEvent((...args: unknown[]) => {
      // Refresh messages on session events
      api.getMessages(sessionId).then((result) => {
        setMessages(result as any[])
      }).catch(console.error)
    })

    return unsub
  }, [api, sessionId])

  const handleSend = async () => {
    if (!api || !input.trim() || sending) return
    setSending(true)
    try {
      await api.sendMessage(sessionId, input.trim())
      setInput('')
      // Messages will update via event listener
    } catch (err) {
      console.error('Failed to send message:', err)
    } finally {
      setSending(false)
    }
  }

  return (
    <div className="flex flex-col h-full">
      {/* Messages */}
      <div className="flex-1 overflow-y-auto p-4 space-y-4">
        {messages.map((msg: any, i: number) => (
          <div
            key={msg.id ?? i}
            className={`max-w-3xl ${msg.role === 'user' ? 'ml-auto' : ''}`}
          >
            <div className={`rounded-lg px-4 py-2 ${
              msg.role === 'user'
                ? 'bg-accent text-white'
                : 'bg-surface border border-border'
            }`}>
              <p className="text-sm whitespace-pre-wrap">{
                typeof msg.content === 'string'
                  ? msg.content
                  : JSON.stringify(msg.content)
              }</p>
            </div>
          </div>
        ))}
      </div>

      {/* Input */}
      <div className="border-t border-border p-4">
        <div className="flex gap-2 max-w-3xl mx-auto">
          <input
            type="text"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && !e.shiftKey && handleSend()}
            placeholder="Type a message..."
            className="flex-1 rounded-lg border border-border bg-background px-4 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-accent"
            disabled={sending}
          />
          <button
            onClick={handleSend}
            disabled={sending || !input.trim()}
            className="rounded-lg bg-accent px-4 py-2 text-sm font-medium text-white hover:opacity-90 disabled:opacity-50"
          >
            Send
          </button>
        </div>
      </div>
    </div>
  )
}
