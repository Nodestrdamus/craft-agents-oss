import { getLoginUrl, getAuthConfig } from '../lib/auth'

export function LoginPage() {
  const config = getAuthConfig()
  const hasEntraConfig = config.tenantId && config.clientId

  return (
    <div className="flex min-h-screen items-center justify-center">
      <div className="w-full max-w-md space-y-8 rounded-xl border border-border bg-surface p-8 shadow-lg">
        <div className="text-center">
          <h1 className="text-2xl font-bold">Craft Agents</h1>
          <p className="mt-2 text-sm text-muted">Enterprise Web Client</p>
        </div>

        <div className="space-y-4">
          {hasEntraConfig ? (
            <a
              href={getLoginUrl()}
              className="flex w-full items-center justify-center gap-2 rounded-lg bg-accent px-4 py-3 font-medium text-white hover:opacity-90 transition-opacity"
            >
              <svg className="h-5 w-5" viewBox="0 0 21 21" fill="none">
                <rect x="1" y="1" width="9" height="9" fill="#f25022"/>
                <rect x="11" y="1" width="9" height="9" fill="#7fba00"/>
                <rect x="1" y="11" width="9" height="9" fill="#00a4ef"/>
                <rect x="11" y="11" width="9" height="9" fill="#ffb900"/>
              </svg>
              Sign in with Microsoft
            </a>
          ) : (
            <div className="rounded-lg border border-yellow-500/30 bg-yellow-500/10 p-4 text-sm">
              <p className="font-medium">Development Mode</p>
              <p className="mt-1 text-muted">
                Entra ID not configured. Set <code className="text-xs">VITE_SERVER_TOKEN</code> in{' '}
                <code className="text-xs">.env.local</code> to connect with a static token.
              </p>
            </div>
          )}
        </div>

        <p className="text-center text-xs text-muted">
          Powered by Craft Agents v{import.meta.env.VITE_APP_VERSION ?? '0.7.5'}
        </p>
      </div>
    </div>
  )
}
