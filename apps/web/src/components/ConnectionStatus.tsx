import type { ConnectionState } from '../lib/rpc-client'

const stateColors: Record<ConnectionState, string> = {
  connected: 'bg-green-500',
  connecting: 'bg-yellow-500 animate-pulse',
  reconnecting: 'bg-yellow-500 animate-pulse',
  disconnected: 'bg-red-500',
}

const stateLabels: Record<ConnectionState, string> = {
  connected: 'Connected',
  connecting: 'Connecting...',
  reconnecting: 'Reconnecting...',
  disconnected: 'Disconnected',
}

export function ConnectionStatus({ state }: { state: ConnectionState }) {
  if (state === 'connected') return null

  return (
    <div className="fixed top-0 left-0 right-0 z-50 flex items-center justify-center gap-2 py-1 text-xs text-white bg-opacity-90"
      style={{ backgroundColor: state === 'disconnected' ? '#ef4444' : '#eab308' }}
    >
      <div className={`w-2 h-2 rounded-full ${stateColors[state]}`} />
      {stateLabels[state]}
    </div>
  )
}
