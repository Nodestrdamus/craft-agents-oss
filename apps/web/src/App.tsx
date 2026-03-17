import { useEffect, useCallback } from 'react'
import { useAtom, useSetAtom } from 'jotai'
import { WebRpcClient } from './lib/rpc-client'
import { CraftApi } from './lib/api-bridge'
import { getToken, isAuthenticated, getAuthConfig } from './lib/auth'
import {
  rpcClientAtom,
  apiAtom,
  connectionStateAtom,
  isAuthenticatedAtom,
  activeWorkspaceIdAtom,
} from './lib/atoms'
import { ConnectionStatus } from './components/ConnectionStatus'
import { LoginPage } from './pages/LoginPage'
import { DashboardPage } from './pages/DashboardPage'

export function App() {
  const [rpcClient, setRpcClient] = useAtom(rpcClientAtom)
  const [connectionState, setConnectionState] = useAtom(connectionStateAtom)
  const [authenticated, setAuthenticated] = useAtom(isAuthenticatedAtom)
  const setApi = useSetAtom(apiAtom)
  const setActiveWorkspaceId = useSetAtom(activeWorkspaceIdAtom)

  // Check auth state on mount
  useEffect(() => {
    setAuthenticated(isAuthenticated())
  }, [setAuthenticated])

  // Handle auth callback (token in URL fragment)
  useEffect(() => {
    const hash = window.location.hash
    if (hash.includes('access_token=')) {
      const params = new URLSearchParams(hash.substring(1))
      const token = params.get('access_token')
      const expiresIn = parseInt(params.get('expires_in') ?? '3600', 10)
      if (token) {
        const { storeToken } = require('./lib/auth')
        storeToken(token, expiresIn)
        setAuthenticated(true)
        window.history.replaceState(null, '', window.location.pathname)
      }
    }
  }, [setAuthenticated])

  // Connect to server when authenticated
  const connectToServer = useCallback(async () => {
    if (rpcClient) {
      rpcClient.destroy()
    }

    try {
      const token = await getToken()
      const config = getAuthConfig()
      const serverUrl = config.serverUrl

      const client = new WebRpcClient({
        url: serverUrl,
        token,
      })

      // Listen for connection state changes
      client.onStateChange((state) => {
        setConnectionState(state)
      })

      await client.connect()

      const api = new CraftApi(client)
      setRpcClient(client)
      setApi(api)

      // Load workspaces
      const workspaces = await api.getWorkspaces() as any[]
      if (workspaces.length > 0) {
        setActiveWorkspaceId(workspaces[0].id ?? workspaces[0].slug)
      }
    } catch (err) {
      console.error('[app] Failed to connect:', err)
      setConnectionState('disconnected')
    }
  }, [rpcClient, setRpcClient, setApi, setConnectionState, setActiveWorkspaceId])

  useEffect(() => {
    if (authenticated) {
      connectToServer()
    }
    return () => {
      rpcClient?.destroy()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [authenticated])

  return (
    <div className="min-h-screen bg-background text-foreground">
      <ConnectionStatus state={connectionState} />
      {!authenticated ? (
        <LoginPage />
      ) : (
        <DashboardPage />
      )}
    </div>
  )
}
