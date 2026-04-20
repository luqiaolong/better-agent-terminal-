import type { BrowserWindow } from 'electron'
import { createRequire } from 'module'
import { execSync } from 'child_process'
import { existsSync, promises as fs } from 'fs'
import os from 'os'
import * as pathModule from 'path'
import type { ClaudeMessage, ClaudeToolCall, ClaudeSessionState } from '../src/types/claude-agent'
import type { CodexEffortLevel } from '../src/types'
import { logger } from './logger'
import { broadcastHub } from './remote/broadcast-hub'

type CodexSandboxMode = 'read-only' | 'workspace-write' | 'danger-full-access'
type CodexApprovalPolicy = 'untrusted' | 'on-request' | 'never'

interface SessionMetadata {
  model?: string
  sdkSessionId?: string
  cwd?: string
  totalCost: number
  inputTokens: number
  outputTokens: number
  durationMs: number
  numTurns: number
  contextWindow: number
  maxOutputTokens: number
  contextTokens: number
  cacheReadTokens: number
  cacheCreationTokens: number
  callCacheRead: number
  callCacheWrite: number
  lastQueryCalls: number
}

interface QueuedMessage {
  prompt: string
  images?: string[]
}

interface CodexSessionInstance {
  abortController: AbortController
  state: ClaudeSessionState
  threadId?: string
  cwd: string
  metadata: SessionMetadata
  codexInstance?: unknown
  thread?: unknown
  sandboxMode: CodexSandboxMode
  approvalPolicy: CodexApprovalPolicy
  model?: string
  effort: CodexEffortLevel
  messageQueue: QueuedMessage[]
  currentPrompt?: string
  isResting?: boolean
  isRunning?: boolean
  startTime?: number
  lastEventAt?: number
}

type HistoryItem = ClaudeMessage | ClaudeToolCall

const CODEX_EFFORT_LEVELS: readonly CodexEffortLevel[] = ['minimal', 'low', 'medium', 'high', 'xhigh']

// Lazy SDK import
let CodexClass: unknown = null

function getCodexInstallHint(): string {
  if (process.platform === 'win32') {
    return 'npm i -g @openai/codex'
  }
  if (process.platform === 'darwin') {
    return 'npm i -g @openai/codex or brew install --cask codex'
  }
  return 'npm i -g @openai/codex'
}

async function getCodexClass(): Promise<unknown> {
  if (!CodexClass) {
    try {
      const sdk = await import('@openai/codex-sdk')
      CodexClass = (sdk as Record<string, unknown>).Codex || (sdk as Record<string, unknown>).default
    } catch (err) {
      logger.error('[codex] Failed to import @openai/codex-sdk:', err)
      const cause = err instanceof Error ? err.message : String(err)
      throw new Error(`Codex SDK not available: ${cause}`)
    }
  }
  return CodexClass
}

// Resolve to the bundled Codex *native* binary. The top-level @openai/codex
// wrapper ships a JS launcher (bin/codex.js) and bin/.bin/codex.cmd on Windows;
// neither can be passed directly to child_process.spawn without a shell
// (Node 20+ refuses to spawn .cmd/.bat implicitly, and .js needs `node`).
// The native exe lives in the per-platform optionalDependency:
//   @openai/codex-<platform>-<arch>/vendor/<triple>/codex/codex[.exe]
function codexTargetTriple(): string | undefined {
  const { platform, arch } = process
  if (platform === 'linux' && arch === 'x64') return 'x86_64-unknown-linux-musl'
  if (platform === 'linux' && arch === 'arm64') return 'aarch64-unknown-linux-musl'
  if (platform === 'darwin' && arch === 'x64') return 'x86_64-apple-darwin'
  if (platform === 'darwin' && arch === 'arm64') return 'aarch64-apple-darwin'
  if (platform === 'win32' && arch === 'x64') return 'x86_64-pc-windows-msvc'
  if (platform === 'win32' && arch === 'arm64') return 'aarch64-pc-windows-msvc'
  return undefined
}

function findCodexBinary(): string | undefined {
  const exe = process.platform === 'win32' ? 'codex.exe' : 'codex'
  const triple = codexTargetTriple()

  if (triple) {
    const platformPkg = `@openai/codex-${process.platform}-${process.arch}`
    try {
      const req = createRequire(import.meta.url ?? __filename)
      let pkgJson = req.resolve(`${platformPkg}/package.json`)
      if (pkgJson.includes('app.asar') && !pkgJson.includes('app.asar.unpacked')) {
        pkgJson = pkgJson.replace('app.asar', 'app.asar.unpacked')
      }
      const candidate = pathModule.join(pathModule.dirname(pkgJson), 'vendor', triple, 'codex', exe)
      if (existsSync(candidate)) {
        return candidate
      }
    } catch {
      // Platform package not installed — fall through.
    }
  }

  try {
    const command = process.platform === 'win32'
      ? 'where.exe codex'
      : 'command -v codex || which codex'
    const result = execSync(command, { encoding: 'utf-8', timeout: 3000 }).trim()
    if (!result) return undefined
    const first = result.split(/\r?\n/).find(Boolean)?.trim()
    // Skip the .cmd/.bat shim that npm installs — can't be spawn'd directly.
    if (first && /\.(cmd|bat)$/i.test(first)) return undefined
    return first || undefined
  } catch {
    return undefined
  }
}

const CODEX_MODELS: Array<{ value: string; displayName: string; description: string }> = [
  { value: 'o3', displayName: 'o3', description: 'OpenAI o3 · reasoning model' },
  { value: 'o4-mini', displayName: 'o4-mini', description: 'OpenAI o4-mini · fast & efficient' },
  { value: 'gpt-4.1', displayName: 'GPT-4.1', description: 'OpenAI GPT-4.1 · latest GPT' },
  { value: 'codex-mini-latest', displayName: 'Codex Mini', description: 'codex-mini · optimized for code' },
]

const sdkThreadIds = new Map<string, string>()

function getCodexSessionsRoot(): string {
  return pathModule.join(os.homedir(), '.codex', 'sessions')
}

async function findSessionLogForThread(threadId: string): Promise<string | null> {
  const root = getCodexSessionsRoot()
  const yearDirs = await fs.readdir(root, { withFileTypes: true }).catch(() => [])
  for (const yearDir of yearDirs.filter(entry => entry.isDirectory()).sort((a, b) => b.name.localeCompare(a.name))) {
    const yearPath = pathModule.join(root, yearDir.name)
    const monthDirs = await fs.readdir(yearPath, { withFileTypes: true }).catch(() => [])
    for (const monthDir of monthDirs.filter(entry => entry.isDirectory()).sort((a, b) => b.name.localeCompare(a.name))) {
      const monthPath = pathModule.join(yearPath, monthDir.name)
      const dayDirs = await fs.readdir(monthPath, { withFileTypes: true }).catch(() => [])
      for (const dayDir of dayDirs.filter(entry => entry.isDirectory()).sort((a, b) => b.name.localeCompare(a.name))) {
        const dayPath = pathModule.join(monthPath, dayDir.name)
        const files = await fs.readdir(dayPath, { withFileTypes: true }).catch(() => [])
        const match = files.find(entry => entry.isFile() && entry.name.includes(threadId) && entry.name.endsWith('.jsonl'))
        if (match) return pathModule.join(dayPath, match.name)
      }
    }
  }
  return null
}

async function readModelFromSessionLog(threadId: string): Promise<string | undefined> {
  const sessionLogPath = await findSessionLogForThread(threadId)
  if (!sessionLogPath) return undefined

  const content = await fs.readFile(sessionLogPath, 'utf8').catch(() => '')
  if (!content) return undefined

  for (const line of content.split('\n')) {
    if (!line.trim()) continue
    try {
      const entry = JSON.parse(line) as {
        type?: string
        payload?: {
          model?: string
          collaboration_mode?: { settings?: { model?: string } }
        }
      }
      if (entry.type === 'turn_context') {
        const model = entry.payload?.model || entry.payload?.collaboration_mode?.settings?.model
        if (model) return model
      }
    } catch {
      // Ignore malformed log lines and keep scanning.
    }
  }

  return undefined
}

function stringifyCodexError(error: unknown, fallback = 'Unknown error'): string {
  if (!error) return fallback
  if (typeof error === 'string') return error
  if (error instanceof Error) return error.message || fallback
  if (typeof error === 'object') {
    const record = error as Record<string, unknown>
    const nested = record.message ?? record.error ?? record.cause
    if (typeof nested === 'string' && nested.trim()) return nested
    try {
      return JSON.stringify(error)
    } catch {
      return String(error)
    }
  }
  return String(error)
}

function parseTimestamp(value: unknown): number {
  if (typeof value !== 'string') return Date.now()
  const ts = Date.parse(value)
  return Number.isNaN(ts) ? Date.now() : ts
}

function normalizeCodexEffort(value: unknown): CodexEffortLevel {
  return typeof value === 'string' && CODEX_EFFORT_LEVELS.includes(value as CodexEffortLevel)
    ? value as CodexEffortLevel
    : 'high'
}

export class CodexAgentManager {
  private sessions: Map<string, CodexSessionInstance> = new Map()
  private getWindows: () => BrowserWindow[]

  constructor(getWindows: () => BrowserWindow[]) {
    this.getWindows = getWindows
  }

  private send(channel: string, ...args: unknown[]) {
    for (const win of this.getWindows()) {
      if (!win.isDestroyed()) {
        win.webContents.send(channel, ...args)
      }
    }
    broadcastHub.broadcast(channel, ...args)
  }

  private static readonly MSG_BUFFER_CAP = 300

  private async syncModelFromSessionLog(sessionId: string) {
    const session = this.sessions.get(sessionId)
    const threadId = session?.threadId
    if (!session || !threadId) return

    const model = await readModelFromSessionLog(threadId).catch(() => undefined)
    if (!model || session.metadata.model === model) return

    logger.log(`[codex:${sessionId.slice(0, 8)}] Resolved session model from log: ${model}`)
    session.model = model
    session.metadata.model = model
    this.send('claude:status', sessionId, { ...session.metadata })
  }

  private addMessage(sessionId: string, msg: ClaudeMessage) {
    const session = this.sessions.get(sessionId)
    if (session) {
      session.state.messages.push(msg)
      if (session.state.messages.length > CodexAgentManager.MSG_BUFFER_CAP) {
        session.state.messages = session.state.messages.slice(-CodexAgentManager.MSG_BUFFER_CAP)
      }
    }
    this.send('claude:message', sessionId, msg)
  }

  private addToolCall(sessionId: string, tool: ClaudeToolCall) {
    const session = this.sessions.get(sessionId)
    if (session) {
      session.state.messages.push(tool)
      if (session.state.messages.length > CodexAgentManager.MSG_BUFFER_CAP) {
        session.state.messages = session.state.messages.slice(-CodexAgentManager.MSG_BUFFER_CAP)
      }
    }
    this.send('claude:tool-use', sessionId, tool)
  }

  private updateToolCall(sessionId: string, toolId: string, updates: Partial<ClaudeToolCall>) {
    const session = this.sessions.get(sessionId)
    if (session) {
      const idx = session.state.messages.findIndex(
        m => 'toolName' in m && m.id === toolId
      )
      if (idx !== -1) {
        Object.assign(session.state.messages[idx], updates)
      }
    }
    this.send('claude:tool-result', sessionId, { id: toolId, ...updates })
  }

  private replaceHistory(sessionId: string, items: HistoryItem[]) {
    const session = this.sessions.get(sessionId)
    if (session) {
      session.state.messages = items.slice(-CodexAgentManager.MSG_BUFFER_CAP)
    }
    this.send('claude:history', sessionId, items)
  }

  private async loadSessionHistory(sessionId: string, threadId: string): Promise<void> {
    const sessionLogPath = await findSessionLogForThread(threadId)
    if (!sessionLogPath) {
      logger.log(`[codex:${sessionId.slice(0, 8)}] No session log found for thread ${threadId.slice(0, 8)}`)
      this.replaceHistory(sessionId, [])
      return
    }

    const content = await fs.readFile(sessionLogPath, 'utf8').catch(() => '')
    if (!content) {
      this.replaceHistory(sessionId, [])
      return
    }

    const items: HistoryItem[] = []

    for (const line of content.split('\n')) {
      if (!line.trim()) continue

      try {
        const entry = JSON.parse(line) as {
          timestamp?: string
          type?: string
          payload?: Record<string, unknown>
        }
        if (entry.type !== 'event_msg' || !entry.payload) continue

        const ts = parseTimestamp(entry.timestamp)
        const eventType = entry.payload.type
        if (typeof eventType !== 'string') continue

        if (eventType === 'user_message') {
          const message = entry.payload.message
          if (typeof message === 'string' && message.trim()) {
            items.push({
              id: `hist-user-${items.length}`,
              sessionId,
              role: 'user',
              content: message,
              timestamp: ts,
            })
          }
          continue
        }

        if (eventType === 'agent_message') {
          const message = entry.payload.message
          if (typeof message === 'string' && message.trim()) {
            items.push({
              id: `hist-assistant-${items.length}`,
              sessionId,
              role: 'assistant',
              content: message,
              timestamp: ts,
            })
          }
          continue
        }

        if (eventType === 'exec_command_end') {
          const cmd = Array.isArray(entry.payload.command)
            ? entry.payload.command.map(part => String(part)).join(' ')
            : ''
          const aggregatedOutput = typeof entry.payload.aggregated_output === 'string'
            ? entry.payload.aggregated_output
            : ''
          const stderr = typeof entry.payload.stderr === 'string' ? entry.payload.stderr : ''
          const stdout = typeof entry.payload.stdout === 'string' ? entry.payload.stdout : ''
          const result = aggregatedOutput || stdout || stderr
          items.push({
            id: String(entry.payload.call_id || `hist-bash-${items.length}`),
            sessionId,
            toolName: 'Bash',
            input: { command: cmd },
            status: entry.payload.exit_code === 0 ? 'completed' : 'error',
            ...(result ? { result: result.slice(0, 4000) } : {}),
            timestamp: ts,
          })
          continue
        }

        if (eventType === 'patch_apply_end') {
          const changes = entry.payload.changes
          const changedFiles = changes && typeof changes === 'object'
            ? Object.keys(changes as Record<string, unknown>)
            : []
          const stdout = typeof entry.payload.stdout === 'string' ? entry.payload.stdout : ''
          const stderr = typeof entry.payload.stderr === 'string' ? entry.payload.stderr : ''
          const summary = stdout || stderr || (changedFiles.length > 0 ? changedFiles.join('\n') : 'Patch applied')
          items.push({
            id: String(entry.payload.call_id || `hist-edit-${items.length}`),
            sessionId,
            toolName: 'Edit',
            input: { files: changedFiles },
            status: entry.payload.success === false ? 'error' : 'completed',
            result: summary.slice(0, 4000),
            timestamp: ts,
          })
        }
      } catch {
        // Ignore malformed log lines and keep scanning.
      }
    }

    logger.log(`[codex:${sessionId.slice(0, 8)}] Loaded ${items.length} history items from ${pathModule.basename(sessionLogPath)}`)
    this.replaceHistory(sessionId, items)
  }

  private makeMetadata(): SessionMetadata {
    return {
      totalCost: 0,
      inputTokens: 0,
      outputTokens: 0,
      durationMs: 0,
      numTurns: 0,
      contextWindow: 0,
      maxOutputTokens: 0,
      contextTokens: 0,
      cacheReadTokens: 0,
      cacheCreationTokens: 0,
      callCacheRead: 0,
      callCacheWrite: 0,
      lastQueryCalls: 0,
    }
  }

  async startSession(sessionId: string, options: {
    cwd: string
    prompt?: string
    permissionMode?: string
    model?: string
    effort?: string
    apiVersion?: string
    codexSandboxMode?: CodexSandboxMode
    codexApprovalPolicy?: CodexApprovalPolicy
    agentPreset?: string
    [key: string]: unknown
  }): Promise<boolean> {
    if (this.sessions.has(sessionId)) return true

    const codexPath = findCodexBinary()
    if (!codexPath) {
      this.send('claude:error', sessionId, `Codex CLI not found. Install with: ${getCodexInstallHint()}`)
      return false
    }

    const stag = `[codex:${sessionId.slice(0, 8)}]`
    logger.log(`${stag} Starting session cwd=${options.cwd} model=${options.model || 'default'}`)

    const sandboxMode = options.codexSandboxMode || 'workspace-write'
    const approvalPolicy = options.codexApprovalPolicy || 'on-request'

    const session: CodexSessionInstance = {
      abortController: new AbortController(),
      state: { sessionId, messages: [], isStreaming: false },
      cwd: options.cwd,
      metadata: {
        ...this.makeMetadata(),
        model: options.model,
        cwd: options.cwd,
      },
      sandboxMode,
      approvalPolicy,
      model: options.model,
      effort: normalizeCodexEffort(options.effort),
      messageQueue: [],
      startTime: Date.now(),
    }

    this.sessions.set(sessionId, session)

    // Send init message
    this.addMessage(sessionId, {
      id: `sys-init-${sessionId}`,
      sessionId,
      role: 'system',
      content: `Codex session started (sandbox: ${sandboxMode}, approval: ${approvalPolicy})`,
      timestamp: Date.now(),
    })

    // Create Codex instance and thread
    try {
      const Codex = await getCodexClass() as new (opts: Record<string, unknown>) => unknown
      const codex = new Codex({
        codexPathOverride: codexPath,
      })
      session.codexInstance = codex

      const threadOpts: Record<string, unknown> = {
        workingDirectory: options.cwd,
        sandboxMode,
        approvalPolicy,
        modelReasoningEffort: session.effort,
      }
      if (options.model) threadOpts.model = options.model

      const savedThreadId = sdkThreadIds.get(sessionId)
      let thread: unknown
      if (savedThreadId) {
        logger.log(`${stag} Resuming thread ${savedThreadId.slice(0, 8)}`)
        thread = (codex as Record<string, (id: string, opts?: Record<string, unknown>) => unknown>).resumeThread(savedThreadId, threadOpts)
      } else {
        thread = (codex as Record<string, (opts: Record<string, unknown>) => unknown>).startThread(threadOpts)
      }
      session.thread = thread

      // Extract thread ID if available
      const threadId = (thread as Record<string, unknown>)?.id as string | undefined
      if (threadId) {
        session.threadId = threadId
        session.metadata.sdkSessionId = threadId
        sdkThreadIds.set(sessionId, threadId)
      }

      this.send('claude:status', sessionId, { ...session.metadata })

      // If a prompt was provided, send it immediately
      if (options.prompt) {
        await this.sendMessage(sessionId, options.prompt)
      }

      return true
    } catch (err) {
      logger.error(`${stag} Failed to create Codex session:`, err)
      this.send('claude:error', sessionId, `Failed to start Codex: ${err instanceof Error ? err.message : String(err)}`)
      this.sessions.delete(sessionId)
      return false
    }
  }

  async sendMessage(sessionId: string, prompt: string, _images?: string[]): Promise<boolean> {
    const session = this.sessions.get(sessionId)
    if (!session || !session.thread) return false

    const stag = `[codex:${sessionId.slice(0, 8)}]`

    if (session.isRunning) {
      const sinceLast = session.lastEventAt ? Date.now() - session.lastEventAt : 0
      const stuck = session.lastEventAt && sinceLast > 30_000
      if (stuck) {
        logger.warn(`${stag} No events for ${Math.round(sinceLast / 1000)}s; forcing recovery to accept new message`)
        session.abortController.abort()
        session.abortController = new AbortController()
        session.isRunning = false
        session.state.isStreaming = false
        session.currentPrompt = undefined
        session.messageQueue = []
        this.send('claude:error', sessionId, 'Previous turn stalled; recovered.')
      } else {
        session.messageQueue.push({ prompt })
        return true
      }
    }

    session.isRunning = true
    session.currentPrompt = prompt
    session.state.isStreaming = true
    session.lastEventAt = Date.now()
    const ctrl = session.abortController

    // Add user message to UI
    this.addMessage(sessionId, {
      id: `user-${Date.now()}`,
      sessionId,
      role: 'user',
      content: prompt,
      timestamp: Date.now(),
    })

    const turnStart = Date.now()
    let currentAssistantText = ''
    let currentThinkingText = ''
    let currentItemId = ''
    let sawTurnCompleted = false
    let idleTimedOut = false
    let idleTimer: ReturnType<typeof setTimeout> | undefined
    const IDLE_TIMEOUT_MS = 300_000

    const resetIdleTimer = () => {
      if (idleTimer) clearTimeout(idleTimer)
      idleTimer = setTimeout(() => {
        idleTimedOut = true
        logger.warn(`${stag} No events for ${IDLE_TIMEOUT_MS / 1000}s; aborting stalled turn`)
        ctrl.abort()
      }, IDLE_TIMEOUT_MS)
    }

    try {
      const thread = session.thread as { runStreamed: (prompt: string, opts?: { signal?: AbortSignal }) => Promise<{ events: AsyncIterable<Record<string, unknown>> }> }
      const { events } = await thread.runStreamed(prompt, { signal: ctrl.signal })

      resetIdleTimer()

      for await (const event of events) {
        if (ctrl.signal.aborted || session.abortController !== ctrl) break
        session.lastEventAt = Date.now()
        resetIdleTimer()

        const type = event.type as string
        logger.log(`${stag} event: ${type}`)

        switch (type) {
          case 'thread.started': {
            const threadId = (event.thread_id as string | undefined) || (event.threadId as string | undefined)
            if (threadId && !session.threadId) {
              session.threadId = threadId
              session.metadata.sdkSessionId = threadId
              sdkThreadIds.set(sessionId, threadId)
              this.send('claude:status', sessionId, { ...session.metadata })
            }
            break
          }

          case 'turn.started':
            session.metadata.numTurns++
            await this.syncModelFromSessionLog(sessionId)
            break

          case 'item.started': {
            const item = event.item as Record<string, unknown>
            const itemType = item?.type as string
            currentItemId = (item?.id as string) || `item-${Date.now()}`

            if (itemType === 'agent_message') {
              currentAssistantText = ''
              currentThinkingText = ''
            } else if (itemType === 'reasoning') {
              // Reasoning/thinking block
            } else if (itemType === 'command_execution') {
              const command = (item?.command as string) || (item?.input as string) || ''
              this.addToolCall(sessionId, {
                id: currentItemId,
                sessionId,
                toolName: 'Bash',
                input: { command },
                status: 'running',
                timestamp: Date.now(),
              })
            } else if (itemType === 'file_change') {
              const changes = item?.changes as Array<Record<string, unknown>> | undefined
              const filePath = changes?.[0]?.path as string || ''
              this.addToolCall(sessionId, {
                id: currentItemId,
                sessionId,
                toolName: 'Edit',
                input: { file_path: filePath },
                status: 'running',
                timestamp: Date.now(),
              })
            } else if (itemType === 'mcp_tool_call') {
              const toolName = (item?.tool as string) || 'MCP'
              this.addToolCall(sessionId, {
                id: currentItemId,
                sessionId,
                toolName,
                input: (item?.arguments as Record<string, unknown>) || {},
                status: 'running',
                timestamp: Date.now(),
              })
            } else if (itemType === 'web_search') {
              this.addToolCall(sessionId, {
                id: currentItemId,
                sessionId,
                toolName: 'WebSearch',
                input: { query: (item?.query as string) || '' },
                status: 'running',
                timestamp: Date.now(),
              })
            }
            break
          }

          case 'item.updated': {
            const item = event.item as Record<string, unknown>
            const itemType = item?.type as string

            if (itemType === 'agent_message') {
              const text = (item?.text as string) || (item?.content as string) || ''
              if (text && text.length > currentAssistantText.length) {
                const delta = text.slice(currentAssistantText.length)
                currentAssistantText = text
                this.send('claude:stream', sessionId, { text: delta })
              }
            } else if (itemType === 'reasoning') {
              const text = (item?.text as string) || (item?.content as string) || ''
              if (text && text.length > currentThinkingText.length) {
                const delta = text.slice(currentThinkingText.length)
                currentThinkingText = text
                this.send('claude:stream', sessionId, { thinking: delta })
              }
            }
            break
          }

          case 'item.completed': {
            const item = event.item as Record<string, unknown>
            const itemType = item?.type as string
            const itemId = (item?.id as string) || currentItemId

            if (itemType === 'agent_message') {
              const text = (item?.text as string) || (item?.content as string) || currentAssistantText
              this.addMessage(sessionId, {
                id: `msg-${Date.now()}`,
                sessionId,
                role: 'assistant',
                content: text,
                thinking: currentThinkingText || undefined,
                timestamp: Date.now(),
              })
              currentAssistantText = ''
              currentThinkingText = ''
            } else if (itemType === 'command_execution') {
              const output = (item?.output as string) || (item?.result as string) || ''
              const status = (item?.status as string) === 'failed' ? 'error' : 'completed'
              this.updateToolCall(sessionId, itemId, {
                status: status as 'completed' | 'error',
                result: output,
              })
            } else if (itemType === 'file_change') {
              const changes = item?.changes as Array<Record<string, unknown>> | undefined
              const diff = changes?.map(c => c.diff || `${c.kind}: ${c.path}`).join('\n') || 'File changed'
              this.updateToolCall(sessionId, itemId, {
                status: 'completed',
                result: diff as string,
              })
            } else if (itemType === 'mcp_tool_call') {
              const result = item?.result !== undefined ? JSON.stringify(item.result) : ''
              const status = (item?.status as string) === 'failed' ? 'error' : 'completed'
              this.updateToolCall(sessionId, itemId, {
                status: status as 'completed' | 'error',
                result,
              })
            } else if (itemType === 'web_search') {
              this.updateToolCall(sessionId, itemId, {
                status: 'completed',
                result: 'Search completed',
              })
            } else if (itemType === 'error') {
              const errMsg = stringifyCodexError(item?.message ?? item?.error)
              this.send('claude:error', sessionId, errMsg)
            }
            break
          }

          case 'turn.completed': {
            sawTurnCompleted = true
            const usage = event.usage as { input_tokens?: number; cached_input_tokens?: number; output_tokens?: number } | undefined
            if (usage) {
              session.metadata.inputTokens += usage.input_tokens || 0
              session.metadata.outputTokens += usage.output_tokens || 0
              session.metadata.cacheReadTokens += usage.cached_input_tokens || 0
              session.metadata.lastQueryCalls = 1
            }
            await this.syncModelFromSessionLog(sessionId)
            session.metadata.durationMs = Date.now() - (session.startTime || turnStart)
            this.send('claude:status', sessionId, { ...session.metadata })

            this.send('claude:result', sessionId, {
              subtype: 'result',
              totalCost: session.metadata.totalCost,
              totalTokens: session.metadata.inputTokens + session.metadata.outputTokens,
              result: currentAssistantText || undefined,
            })
            break
          }

          case 'turn.failed': {
            const errMsg = stringifyCodexError(event.error, 'Turn failed')
            logger.error(`${stag} Turn failed: ${errMsg}`)
            this.send('claude:error', sessionId, errMsg)
            break
          }

          case 'error': {
            const errMsg = stringifyCodexError(event.error)
            logger.error(`${stag} Error: ${errMsg}`)
            this.send('claude:error', sessionId, errMsg)
            break
          }
        }
      }
    } catch (err) {
      if (!ctrl.signal.aborted) {
        logger.error(`${stag} Query error:`, err)
        this.send('claude:error', sessionId, `Codex error: ${stringifyCodexError(err)}`)
      }
    } finally {
      if (idleTimer) clearTimeout(idleTimer)

      // If a newer sendMessage has superseded this one, don't touch session state.
      if (session.abortController === ctrl) {
        if (!sawTurnCompleted) {
          if (idleTimedOut) {
            this.send('claude:error', sessionId, `Codex: no response from model after ${IDLE_TIMEOUT_MS / 1000}s. Please try again.`)
          } else if (!ctrl.signal.aborted) {
            logger.warn(`${stag} Turn ended without turn.completed; clearing UI state`)
            this.send('claude:error', sessionId, 'Codex turn ended unexpectedly.')
          }
          // else: user hit stop — no error needed
        }
        session.isRunning = false
        session.state.isStreaming = false
        session.currentPrompt = undefined

        // Process queued messages
        const next = session.messageQueue.shift()
        if (next) {
          await this.sendMessage(sessionId, next.prompt, next.images)
        }
      }
    }

    return true
  }

  async stopSession(sessionId: string): Promise<boolean> {
    const session = this.sessions.get(sessionId)
    if (!session) return false
    session.abortController.abort()
    session.state.isStreaming = false
    session.isRunning = false
    return true
  }

  abortSession(sessionId: string): boolean {
    const session = this.sessions.get(sessionId)
    if (!session) return false
    session.abortController.abort()
    session.state.isStreaming = false
    session.isRunning = false
    this.sessions.delete(sessionId)
    return true
  }

  async resetSession(sessionId: string): Promise<boolean> {
    const session = this.sessions.get(sessionId)
    if (!session) return false

    session.abortController.abort()
    session.state = { sessionId, messages: [], isStreaming: false }
    session.metadata = { ...this.makeMetadata(), model: session.model, cwd: session.cwd }
    session.thread = undefined
    session.threadId = undefined
    session.isRunning = false
    sdkThreadIds.delete(sessionId)
    this.send('claude:session-reset', sessionId)

    // Create a new thread
    session.abortController = new AbortController()
    try {
      const codex = session.codexInstance as Record<string, (opts: Record<string, unknown>) => unknown>
      const threadOpts: Record<string, unknown> = {
        workingDirectory: session.cwd,
        sandboxMode: session.sandboxMode,
        approvalPolicy: session.approvalPolicy,
        modelReasoningEffort: session.effort,
      }
      if (session.model) threadOpts.model = session.model
      session.thread = codex.startThread(threadOpts)
      const threadId = (session.thread as Record<string, unknown>)?.id as string | undefined
      if (threadId) {
        session.threadId = threadId
        session.metadata.sdkSessionId = threadId
        sdkThreadIds.set(sessionId, threadId)
        await this.syncModelFromSessionLog(sessionId)
      }
    } catch (err) {
      logger.error(`[codex:${sessionId.slice(0, 8)}] Reset failed:`, err)
    }
    return true
  }

  restSession(sessionId: string): boolean {
    const session = this.sessions.get(sessionId)
    if (!session) return false
    session.abortController.abort()
    session.isResting = true
    session.state.isStreaming = false
    session.isRunning = false
    session.codexInstance = undefined
    session.thread = undefined
    return true
  }

  wakeSession(sessionId: string): boolean {
    const session = this.sessions.get(sessionId)
    if (!session) return false
    session.isResting = false
    session.abortController = new AbortController()
    return true
  }

  isResting(sessionId: string): boolean {
    return this.sessions.get(sessionId)?.isResting ?? false
  }

  async resumeSession(sessionId: string, threadId: string, cwd: string, model?: string): Promise<boolean> {
    sdkThreadIds.set(sessionId, threadId)
    const result = await this.startSession(sessionId, { cwd, model })
    if (result) {
      await this.loadSessionHistory(sessionId, threadId).catch(err => {
        logger.error(`[codex:${sessionId.slice(0, 8)}] Failed to load session history:`, err)
        this.replaceHistory(sessionId, [])
      })
    }
    return result
  }

  getSessionState(sessionId: string): ClaudeSessionState | null {
    return this.sessions.get(sessionId)?.state ?? null
  }

  getSessionMeta(sessionId: string): Record<string, unknown> | null {
    const session = this.sessions.get(sessionId)
    return session ? { ...session.metadata } : null
  }

  async getSupportedModels(_sessionId: string): Promise<Array<{ value: string; displayName: string; description: string; source: string }>> {
    return CODEX_MODELS.map(m => ({ ...m, source: 'builtin' }))
  }

  setModel(sessionId: string, model: string): boolean {
    const session = this.sessions.get(sessionId)
    if (!session) return false
    if (session.model === model) return true
    session.model = model
    session.metadata.model = model
    this.send('claude:status', sessionId, { ...session.metadata })
    return true
  }

  setSandboxMode(sessionId: string, sandboxMode: CodexSandboxMode): boolean {
    const session = this.sessions.get(sessionId)
    if (!session) return false
    if (session.sandboxMode === sandboxMode) return true
    session.sandboxMode = sandboxMode
    this.addMessage(sessionId, {
      id: `sys-sandbox-${Date.now()}`,
      sessionId,
      role: 'system',
      content: `Codex sandbox updated to ${sandboxMode}. This applies to the next /new or session restart.`,
      timestamp: Date.now(),
    })
    return true
  }

  setApprovalPolicy(sessionId: string, approvalPolicy: CodexApprovalPolicy): boolean {
    const session = this.sessions.get(sessionId)
    if (!session) return false
    if (session.approvalPolicy === approvalPolicy) return true
    session.approvalPolicy = approvalPolicy
    this.addMessage(sessionId, {
      id: `sys-approval-${Date.now()}`,
      sessionId,
      role: 'system',
      content: `Codex approval updated to ${approvalPolicy}. This applies to the next /new or session restart.`,
      timestamp: Date.now(),
    })
    return true
  }

  setPermissionMode(_sessionId: string, _mode: string): boolean {
    return false
  }

  setEffort(sessionId: string, effort: string): boolean {
    const session = this.sessions.get(sessionId)
    if (!session) return false
    const next = normalizeCodexEffort(effort)
    if (session.effort === next) return true
    session.effort = next
    this.addMessage(sessionId, {
      id: `sys-effort-${Date.now()}`,
      sessionId,
      role: 'system',
      content: `Codex reasoning effort updated to ${next}. This applies to the next /new or session restart.`,
      timestamp: Date.now(),
    })
    return true
  }

  async stopTask(_sessionId: string, _taskId: string): Promise<boolean> {
    return false
  }

  async getAccountInfo(_sessionId: string): Promise<null> { return null }
  async getSupportedCommands(_sessionId: string): Promise<[]> { return [] }
  async getSupportedAgents(_sessionId: string): Promise<[]> { return [] }
  async getContextUsage(_sessionId: string): Promise<null> { return null }
  async forkSession(_sessionId: string): Promise<null> { return null }
  async fetchSubagentMessages(_sessionId: string, _agentToolUseId: string): Promise<[]> { return [] }
  async getWorktreeStatus(_sessionId: string): Promise<null> { return null }
  async cleanupWorktree(_sessionId: string, _deleteBranch?: boolean): Promise<boolean> { return false }

  resolvePermission(_sessionId: string, _toolUseId: string, _result: unknown): boolean { return false }
  resolveAskUser(_sessionId: string, _toolUseId: string, _answers: unknown): boolean { return false }

  async listSessions(_cwd: string): Promise<[]> {
    // TODO: Read from ~/.codex/sessions if available
    return []
  }

  killAll(): void {
    for (const [, session] of this.sessions) {
      session.abortController.abort()
    }
    this.sessions.clear()
  }

  dispose(): void {
    this.killAll()
  }
}
