import WebSocket from 'ws'
import { randomBytes } from 'crypto'
import { BrowserWindow } from 'electron'
import { PROXIED_EVENTS, type RemoteFrame } from './protocol'
import { logger } from '../logger'
import { normalizeFingerprint } from './certificate'

interface PendingInvoke {
  resolve: (result: unknown) => void
  reject: (error: Error) => void
  timer: ReturnType<typeof setTimeout>
}

export interface ConnectOptions {
  host: string
  port: number
  token: string
  label?: string
  /**
   * Expected SHA-256 fingerprint of the server's TLS certificate. Required: if
   * undefined, the client aborts (TOFU happens at the caller layer by prompting
   * the user for the fingerprint on first connect). Accepts colon-separated or
   * bare hex, case-insensitive.
   */
  fingerprint: string
}

const BACKOFF_BASE_MS = 3_000
const BACKOFF_MAX_MS = 30_000
const AUTH_TIMEOUT_MS = 10_000
const DEFAULT_INVOKE_TIMEOUT_MS = 30_000

export class RemoteClient {
  private ws: WebSocket | null = null
  private pending: Map<string, PendingInvoke> = new Map()
  private getWindows: () => BrowserWindow[]
  private _connected = false
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null
  private reconnectAttempt = 0

  private host = ''
  private port = 0
  private token = ''
  private label = ''
  private pinnedFingerprint = ''
  private shouldReconnect = false

  /**
   * Signed by doConnect() on each close so that a stale in-flight reconnect can detect
   * it was superseded by a newer connect() call and abandon itself.
   */
  private generation = 0

  constructor(getWindows: () => BrowserWindow[]) {
    this.getWindows = getWindows
  }

  get isConnected(): boolean {
    return this._connected && this.ws?.readyState === WebSocket.OPEN
  }

  get connectionInfo(): { host: string; port: number } | null {
    if (!this._connected) return null
    return { host: this.host, port: this.port }
  }

  connect(options: ConnectOptions): Promise<boolean> {
    if (this.ws) this.disconnect()

    this.host = options.host
    this.port = options.port
    this.token = options.token
    this.label = options.label || `Client-${randomBytes(3).toString('hex')}`
    this.pinnedFingerprint = normalizeFingerprint(options.fingerprint)
    if (!this.pinnedFingerprint) {
      return Promise.reject(new Error('fingerprint is required for TLS pinning'))
    }
    this.shouldReconnect = true
    this.generation++

    return this.doConnect(this.generation)
  }

  private doConnect(generation: number): Promise<boolean> {
    return new Promise((resolve) => {
      if (generation !== this.generation) {
        resolve(false)
        return
      }
      const url = `wss://${this.host}:${this.port}`
      // rejectUnauthorized:false because we use fingerprint pinning instead of CA trust.
      // Verification of the cert happens manually on 'open' via the underlying socket.
      const ws = new WebSocket(url, {
        rejectUnauthorized: false,
        handshakeTimeout: AUTH_TIMEOUT_MS
      })
      this.ws = ws

      let authResolved = false
      const finish = (ok: boolean) => {
        if (authResolved) return
        authResolved = true
        if (!ok) {
          this._connected = false
          try { ws.close() } catch { /* ignore */ }
        }
        resolve(ok)
      }

      const authTimeout = setTimeout(() => finish(false), AUTH_TIMEOUT_MS)

      ws.on('open', () => {
        // Pin check: read the peer cert via the underlying TLS socket.
        const rawSocket = (ws as unknown as { _socket?: { getPeerCertificate?: (detailed?: boolean) => { fingerprint256?: string } } })._socket
        const peerCert = rawSocket?.getPeerCertificate?.(false)
        const peerFingerprint = peerCert ? normalizeFingerprint(peerCert.fingerprint256 ?? '') : ''
        if (!peerFingerprint || peerFingerprint !== this.pinnedFingerprint) {
          logger.error(`[RemoteClient] fingerprint mismatch: expected ${this.pinnedFingerprint.slice(0, 16)}..., got ${peerFingerprint.slice(0, 16) || '(none)'}`)
          clearTimeout(authTimeout)
          finish(false)
          return
        }

        const authFrame: RemoteFrame = {
          type: 'auth',
          id: this.nextId(),
          token: this.token,
          args: [this.label]
        }
        ws.send(JSON.stringify(authFrame))
      })

      ws.on('message', (raw) => {
        let frame: RemoteFrame
        try {
          frame = JSON.parse(raw.toString())
        } catch {
          return
        }

        if (frame.type === 'auth-result') {
          clearTimeout(authTimeout)
          if (frame.error) {
            logger.error(`[RemoteClient] Auth failed: ${frame.error}`)
            finish(false)
          } else {
            this._connected = true
            this.reconnectAttempt = 0
            logger.log(`[RemoteClient] Connected to ${this.host}:${this.port}`)
            finish(true)
          }
          return
        }

        if (frame.type === 'invoke-result' || frame.type === 'invoke-error') {
          const pending = this.pending.get(frame.id)
          if (pending) {
            clearTimeout(pending.timer)
            this.pending.delete(frame.id)
            if (frame.type === 'invoke-error') {
              pending.reject(new Error(frame.error || 'Remote invoke failed'))
            } else {
              pending.resolve(frame.result)
            }
          }
          return
        }

        if (frame.type === 'pong') return

        if (frame.type === 'event' && frame.channel && PROXIED_EVENTS.has(frame.channel)) {
          for (const win of this.getWindows()) {
            if (!win.isDestroyed()) {
              win.webContents.send(frame.channel, ...(frame.args || []))
            }
          }
          return
        }
      })

      ws.on('close', () => {
        clearTimeout(authTimeout)
        const wasConnected = this._connected
        this._connected = false

        for (const [id, pending] of this.pending) {
          clearTimeout(pending.timer)
          pending.reject(new Error('Connection closed'))
          this.pending.delete(id)
        }

        if (wasConnected) logger.log('[RemoteClient] Disconnected')

        // Only ever reconnect if this close corresponds to the current
        // generation AND the previous attempt had authenticated at least once.
        if (this.shouldReconnect && generation === this.generation && wasConnected) {
          this.scheduleReconnect(generation)
        }
        if (!authResolved) finish(false)
      })

      ws.on('error', (err) => {
        logger.error('[RemoteClient] WebSocket error:', err.message)
        if (!authResolved) {
          clearTimeout(authTimeout)
          finish(false)
        }
      })
    })
  }

  private scheduleReconnect(generation: number) {
    if (this.reconnectTimer) return
    if (generation !== this.generation) return

    this.reconnectAttempt++
    // Exponential backoff with jitter: base * 2^(n-1), capped, ±25% jitter.
    const exp = Math.min(BACKOFF_BASE_MS * Math.pow(2, this.reconnectAttempt - 1), BACKOFF_MAX_MS)
    const jitter = exp * (0.75 + Math.random() * 0.5)
    const delay = Math.round(jitter)

    logger.log(`[RemoteClient] Reconnect attempt ${this.reconnectAttempt} in ${delay}ms`)
    this.reconnectTimer = setTimeout(async () => {
      this.reconnectTimer = null
      if (!this.shouldReconnect || generation !== this.generation) return
      try {
        const ok = await this.doConnect(generation)
        if (!ok && this.shouldReconnect && generation === this.generation) {
          this.scheduleReconnect(generation)
        }
      } catch {
        if (this.shouldReconnect && generation === this.generation) {
          this.scheduleReconnect(generation)
        }
      }
    }, delay)
  }

  disconnect(): void {
    this.shouldReconnect = false
    this._connected = false
    this.reconnectAttempt = 0
    this.generation++

    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer)
      this.reconnectTimer = null
    }

    for (const [id, pending] of this.pending) {
      clearTimeout(pending.timer)
      pending.reject(new Error('Disconnected'))
      this.pending.delete(id)
    }

    if (this.ws) {
      try { this.ws.close() } catch { /* ignore */ }
      this.ws = null
    }

    logger.log('[RemoteClient] Disconnected')
  }

  invoke(channel: string, args: unknown[], timeout = DEFAULT_INVOKE_TIMEOUT_MS): Promise<unknown> {
    if (!this.isConnected) {
      return Promise.reject(new Error('Not connected to remote server'))
    }

    const id = this.nextId()
    const frame: RemoteFrame = { type: 'invoke', id, channel, args }

    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id)
        reject(new Error(`Remote invoke timeout: ${channel}`))
      }, timeout)

      this.pending.set(id, { resolve, reject, timer })
      this.ws!.send(JSON.stringify(frame))
    })
  }

  private _counter = 0
  private nextId(): string {
    return `${Date.now()}-${++this._counter}`
  }
}
