/**
 * HTTP Download Endpoints
 *
 * Provides HTTP routes for file downloads from the headless server.
 * Sits alongside the WebSocket RPC layer on the same HTTPS server.
 *
 * Routes:
 *   GET /api/files/download?path=<abs-path>     — Download a file by absolute path
 *   GET /api/sessions/:id/export                — Export a session as JSON
 *   GET /api/health                             — Health check (no auth)
 *
 * Authentication:
 *   All /api/ routes (except /api/health) require either:
 *   - Authorization: Bearer <CRAFT_SERVER_TOKEN>
 *   - Authorization: Bearer <Entra_JWT>
 */

import { createReadStream, existsSync, statSync } from 'node:fs'
import { basename, resolve, normalize } from 'node:path'
import type { IncomingMessage, ServerResponse } from 'node:http'
import { validateEntraToken, loadEntraConfig, type EntraConfig } from '@craft-agent/shared/auth/entra-jwt'

// ---------------------------------------------------------------------------
// Auth
// ---------------------------------------------------------------------------

interface HttpAuthContext {
  serverToken: string
  entraConfig: EntraConfig | null
}

async function authenticateRequest(
  req: IncomingMessage,
  authCtx: HttpAuthContext,
): Promise<boolean> {
  const authHeader = req.headers.authorization
  if (!authHeader?.startsWith('Bearer ')) return false

  const token = authHeader.slice(7)

  // Static server token
  if (token === authCtx.serverToken) return true

  // Entra JWT
  if (authCtx.entraConfig) {
    const user = await validateEntraToken(token, authCtx.entraConfig)
    if (user) return true
  }

  return false
}

// ---------------------------------------------------------------------------
// Path Security
// ---------------------------------------------------------------------------

const BLOCKED_PATTERNS = [
  /\.\./, // Directory traversal
  /credentials\.enc$/,
  /\.env$/,
  /\.ssh/,
  /id_rsa/,
  /\.git\/config$/,
]

function isPathSafe(filePath: string): boolean {
  const normalized = normalize(filePath)
  return !BLOCKED_PATTERNS.some(p => p.test(normalized))
}

// ---------------------------------------------------------------------------
// Route Handlers
// ---------------------------------------------------------------------------

function sendJson(res: ServerResponse, status: number, data: unknown): void {
  const body = JSON.stringify(data)
  res.writeHead(status, {
    'Content-Type': 'application/json',
    'Content-Length': Buffer.byteLength(body),
  })
  res.end(body)
}

function handleHealth(_req: IncomingMessage, res: ServerResponse): void {
  sendJson(res, 200, { status: 'ok', timestamp: Date.now() })
}

function handleFileDownload(req: IncomingMessage, res: ServerResponse): void {
  const url = new URL(req.url ?? '', `https://${req.headers.host}`)
  const filePath = url.searchParams.get('path')

  if (!filePath) {
    sendJson(res, 400, { error: 'Missing path parameter' })
    return
  }

  const absolutePath = resolve(filePath)

  if (!isPathSafe(absolutePath)) {
    sendJson(res, 403, { error: 'Access denied' })
    return
  }

  if (!existsSync(absolutePath)) {
    sendJson(res, 404, { error: 'File not found' })
    return
  }

  const stat = statSync(absolutePath)
  if (!stat.isFile()) {
    sendJson(res, 400, { error: 'Not a file' })
    return
  }

  const filename = basename(absolutePath)
  res.writeHead(200, {
    'Content-Type': 'application/octet-stream',
    'Content-Disposition': `attachment; filename="${encodeURIComponent(filename)}"`,
    'Content-Length': stat.size,
  })

  const stream = createReadStream(absolutePath)
  stream.pipe(res)
  stream.on('error', () => {
    if (!res.headersSent) {
      sendJson(res, 500, { error: 'Read error' })
    }
    res.end()
  })
}

function handleSessionExport(
  req: IncomingMessage,
  res: ServerResponse,
  sessionId: string,
  getSessionPath: (id: string) => string | null,
): void {
  const sessionPath = getSessionPath(sessionId)
  if (!sessionPath) {
    sendJson(res, 404, { error: 'Session not found' })
    return
  }

  const jsonlPath = `${sessionPath}/session.jsonl`
  if (!existsSync(jsonlPath)) {
    sendJson(res, 404, { error: 'Session data not found' })
    return
  }

  const stat = statSync(jsonlPath)
  const filename = `session-${sessionId}.jsonl`

  res.writeHead(200, {
    'Content-Type': 'application/x-ndjson',
    'Content-Disposition': `attachment; filename="${filename}"`,
    'Content-Length': stat.size,
  })

  const stream = createReadStream(jsonlPath)
  stream.pipe(res)
  stream.on('error', () => res.end())
}

// ---------------------------------------------------------------------------
// Router
// ---------------------------------------------------------------------------

export interface HttpDownloadRouterOptions {
  serverToken: string
  getSessionPath: (sessionId: string) => string | null
}

/**
 * Create an HTTP request handler for download routes.
 * Attach this to the HTTPS server's 'request' event.
 */
export function createHttpDownloadHandler(
  options: HttpDownloadRouterOptions,
): (req: IncomingMessage, res: ServerResponse) => void {
  const authCtx: HttpAuthContext = {
    serverToken: options.serverToken,
    entraConfig: loadEntraConfig(),
  }

  return async (req: IncomingMessage, res: ServerResponse) => {
    const url = new URL(req.url ?? '', `https://${req.headers.host ?? 'localhost'}`)
    const pathname = url.pathname

    // CORS headers for web client
    res.setHeader('Access-Control-Allow-Origin', '*')
    res.setHeader('Access-Control-Allow-Headers', 'Authorization, Content-Type')
    res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS')

    if (req.method === 'OPTIONS') {
      res.writeHead(204)
      res.end()
      return
    }

    // Health check (no auth)
    if (pathname === '/api/health') {
      handleHealth(req, res)
      return
    }

    // All other routes require authentication
    if (req.method !== 'GET') {
      sendJson(res, 405, { error: 'Method not allowed' })
      return
    }

    const authenticated = await authenticateRequest(req, authCtx)
    if (!authenticated) {
      sendJson(res, 401, { error: 'Unauthorized' })
      return
    }

    // Route: /api/files/download?path=...
    if (pathname === '/api/files/download') {
      handleFileDownload(req, res)
      return
    }

    // Route: /api/sessions/:id/export
    const sessionMatch = pathname.match(/^\/api\/sessions\/([^/]+)\/export$/)
    if (sessionMatch) {
      handleSessionExport(req, res, sessionMatch[1], options.getSessionPath)
      return
    }

    // 404 for unknown routes
    sendJson(res, 404, { error: 'Not found' })
  }
}
