/**
 * WebRpcClient — WebSocket RPC client for the enterprise web client.
 *
 * Based on CliRpcClient but adds:
 * - Auto-reconnect with exponential backoff
 * - Connection state listeners (for UI status indicator)
 * - Entra ID token support (pass JWT instead of static token)
 * - Push event routing for real-time session updates
 */

import {
  PROTOCOL_VERSION,
  type MessageEnvelope,
} from '@craft-agent/shared/protocol'
import {
  serializeEnvelope,
  deserializeEnvelope,
} from '@craft-agent/server-core/transport'

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type ConnectionState = 'disconnected' | 'connecting' | 'connected' | 'reconnecting'

interface PendingRequest {
  resolve: (value: unknown) => void
  reject: (error: Error) => void
  timeout: ReturnType<typeof setTimeout>
}

export interface WebClientOptions {
  /** Server URL (ws:// or wss://) */
  url: string
  /** Static server token or Entra ID JWT */
  token: string
  /** Active workspace ID */
  workspaceId?: string
  /** Request timeout in ms (default: 30s) */
  requestTimeout?: number
  /** Connection timeout in ms (default: 10s) */
  connectTimeout?: number
  /** Auto-reconnect on disconnect (default: true) */
  autoReconnect?: boolean
  /** Max reconnect attempts (default: 10) */
  maxReconnectAttempts?: number
}

// ---------------------------------------------------------------------------
// Client
// ---------------------------------------------------------------------------

export class WebRpcClient {
  private ws: WebSocket | null = null
  private pending = new Map<string, PendingRequest>()
  private listeners = new Map<string, Set<(...args: unknown[]) => void>>()
  private stateListeners = new Set<(state: ConnectionState) => void>()
  private _clientId: string | null = null
  private _state: ConnectionState = 'disconnected'
  private _destroyed = false
  private reconnectAttempts = 0
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null

  private readonly url: string
  private token: string
  private workspaceId: string | undefined
  private readonly requestTimeout: number
  private readonly connectTimeout: number
  private readonly autoReconnect: boolean
  private readonly maxReconnectAttempts: number

  constructor(opts: WebClientOptions) {
    this.url = opts.url
    this.token = opts.token
    this.workspaceId = opts.workspaceId
    this.requestTimeout = opts.requestTimeout ?? 30_000
    this.connectTimeout = opts.connectTimeout ?? 10_000
    this.autoReconnect = opts.autoReconnect ?? true
    this.maxReconnectAttempts = opts.maxReconnectAttempts ?? 10
  }

  // -------------------------------------------------------------------------
  // Connection
  // -------------------------------------------------------------------------

  async connect(): Promise<string> {
    if (this._destroyed) throw new Error('Client destroyed')
    this.setState('connecting')

    return new Promise<string>((resolve, reject) => {
      const timer = setTimeout(() => {
        reject(new Error(`Connection timeout (${this.connectTimeout}ms)`))
        this.ws?.close()
      }, this.connectTimeout)

      this.ws = new WebSocket(this.url)

      this.ws.onopen = () => {
        const handshake: MessageEnvelope = {
          id: crypto.randomUUID(),
          type: 'handshake',
          protocolVersion: PROTOCOL_VERSION,
          workspaceId: this.workspaceId,
          token: this.token,
        }
        this.ws!.send(serializeEnvelope(handshake))
      }

      this.ws.onmessage = (event) => {
        const raw = typeof event.data === 'string' ? event.data : String(event.data)
        let envelope: MessageEnvelope
        try {
          envelope = deserializeEnvelope(raw)
        } catch {
          return
        }

        if (envelope.type === 'handshake_ack') {
          clearTimeout(timer)
          this._clientId = envelope.clientId ?? null
          this.reconnectAttempts = 0
          this.setState('connected')
          this.ws!.onmessage = (e) => {
            this.onMessage(typeof e.data === 'string' ? e.data : String(e.data))
          }
          resolve(this._clientId!)
        } else if (envelope.type === 'error') {
          clearTimeout(timer)
          const err = new Error(envelope.error?.message ?? 'Connection rejected')
          ;(err as any).code = envelope.error?.code
          this.setState('disconnected')
          reject(err)
        }
      }

      this.ws.onerror = () => {
        if (this._state !== 'connected') {
          clearTimeout(timer)
          reject(new Error('WebSocket connection error'))
        }
      }

      this.ws.onclose = () => {
        const wasConnected = this._state === 'connected'
        this.setState('disconnected')
        this.rejectAllPending('Disconnected')

        if (!wasConnected) {
          clearTimeout(timer)
          reject(new Error('WebSocket closed before handshake'))
        } else if (this.autoReconnect && !this._destroyed) {
          this.scheduleReconnect()
        }
      }
    })
  }

  private scheduleReconnect(): void {
    if (this.reconnectAttempts >= this.maxReconnectAttempts) {
      console.error(`[rpc] Max reconnect attempts (${this.maxReconnectAttempts}) reached`)
      return
    }
    const delay = Math.min(1000 * 2 ** this.reconnectAttempts, 30_000)
    this.reconnectAttempts++
    this.setState('reconnecting')

    this.reconnectTimer = setTimeout(async () => {
      try {
        await this.connect()
      } catch {
        // connect() failure will trigger onclose → scheduleReconnect again
      }
    }, delay)
  }

  // -------------------------------------------------------------------------
  // RPC
  // -------------------------------------------------------------------------

  async invoke<T = unknown>(channel: string, ...args: unknown[]): Promise<T> {
    if (this._state !== 'connected' || !this.ws) {
      throw new Error(`Not connected (channel: ${channel})`)
    }

    return new Promise((resolve, reject) => {
      const id = crypto.randomUUID()
      const timeout = setTimeout(() => {
        this.pending.delete(id)
        reject(new Error(`Request timeout: ${channel} (${this.requestTimeout}ms)`))
      }, this.requestTimeout)

      this.pending.set(id, { resolve: resolve as (v: unknown) => void, reject, timeout })

      const envelope: MessageEnvelope = {
        id,
        type: 'request',
        channel,
        args,
      }
      this.ws!.send(serializeEnvelope(envelope))
    })
  }

  // -------------------------------------------------------------------------
  // Events
  // -------------------------------------------------------------------------

  on(channel: string, callback: (...args: unknown[]) => void): () => void {
    let set = this.listeners.get(channel)
    if (!set) {
      set = new Set()
      this.listeners.set(channel, set)
    }
    set.add(callback)
    return () => {
      set!.delete(callback)
      if (set!.size === 0) this.listeners.delete(channel)
    }
  }

  onStateChange(callback: (state: ConnectionState) => void): () => void {
    this.stateListeners.add(callback)
    return () => this.stateListeners.delete(callback)
  }

  // -------------------------------------------------------------------------
  // Token / workspace updates
  // -------------------------------------------------------------------------

  updateToken(token: string): void {
    this.token = token
  }

  updateWorkspace(workspaceId: string): void {
    this.workspaceId = workspaceId
  }

  // -------------------------------------------------------------------------
  // Cleanup
  // -------------------------------------------------------------------------

  destroy(): void {
    this._destroyed = true
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer)
    this.rejectAllPending('Client destroyed')
    this.ws?.close()
    this.ws = null
    this.setState('disconnected')
  }

  get state(): ConnectionState { return this._state }
  get isConnected(): boolean { return this._state === 'connected' }
  get clientId(): string | null { return this._clientId }

  // -------------------------------------------------------------------------
  // Internal
  // -------------------------------------------------------------------------

  private setState(state: ConnectionState): void {
    if (this._state === state) return
    this._state = state
    for (const cb of this.stateListeners) {
      try { cb(state) } catch { /* ignore */ }
    }
  }

  private rejectAllPending(message: string): void {
    for (const [, req] of this.pending) {
      clearTimeout(req.timeout)
      req.reject(new Error(message))
    }
    this.pending.clear()
  }

  private onMessage(raw: string): void {
    let envelope: MessageEnvelope
    try {
      envelope = deserializeEnvelope(raw)
    } catch {
      return
    }

    switch (envelope.type) {
      case 'response': {
        const req = this.pending.get(envelope.id)
        if (req) {
          this.pending.delete(envelope.id)
          clearTimeout(req.timeout)
          if (envelope.error) {
            const err = new Error(envelope.error.message)
            ;(err as any).code = envelope.error.code
            ;(err as any).data = envelope.error.data
            req.reject(err)
          } else {
            req.resolve(envelope.result)
          }
        }
        break
      }
      case 'event': {
        if (envelope.channel) {
          const set = this.listeners.get(envelope.channel)
          if (set) {
            for (const cb of set) {
              try { cb(...(envelope.args ?? [])) } catch { /* ignore */ }
            }
          }
        }
        break
      }
    }
  }
}
