/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_ENTRA_TENANT_ID: string
  readonly VITE_ENTRA_CLIENT_ID: string
  readonly VITE_SERVER_URL: string
  readonly VITE_SERVER_TOKEN: string
  readonly VITE_API_URL: string
  readonly VITE_APP_VERSION: string
}

interface ImportMeta {
  readonly env: ImportMetaEnv
}
