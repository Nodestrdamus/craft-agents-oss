import { useAtomValue } from 'jotai'
import { activeSessionIdAtom } from '../lib/atoms'
import { ChatView } from '../components/ChatView'

export function DashboardPage() {
  const activeSessionId = useAtomValue(activeSessionIdAtom)

  if (!activeSessionId) {
    return (
      <div className="flex-1 flex items-center justify-center text-muted">
        <div className="text-center space-y-3">
          <div className="text-4xl">💬</div>
          <p className="text-lg font-medium">Select or create a session</p>
          <p className="text-sm">
            Start a conversation with Craft Agent from the sidebar
          </p>
          <p className="text-xs text-muted/60 mt-4">
            Tip: Use keyboard shortcut{' '}
            <kbd className="px-1.5 py-0.5 rounded bg-surface border border-border text-[11px]">
              ⌘ N
            </kbd>{' '}
            to create a new session
          </p>
        </div>
      </div>
    )
  }

  return <ChatView sessionId={activeSessionId} />
}
