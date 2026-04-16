import { useEffect, useRef, useState, memo, useCallback } from 'react'
import { Terminal } from '@xterm/xterm'
import { FitAddon } from '@xterm/addon-fit'
import { WebLinksAddon } from '@xterm/addon-web-links'
import { Unicode11Addon } from '@xterm/addon-unicode11'
import { settingsStore } from '../stores/settings-store'
import { parseProcfile } from '../utils/procfile-parser'
import '@xterm/xterm/css/xterm.css'

const dlog = (...args: unknown[]) => window.electronAPI?.debug?.log(...args)

const WORKER_COLORS = [
  '#61afef', '#98c379', '#e5c07b', '#c678dd',
  '#e06c75', '#56b6c2', '#d19a66', '#be5046',
]

type ProcessStatus = 'starting' | 'running' | 'stopped' | 'crashed'

interface WorkerProcess {
  name: string
  command: string
  ptyId: string
  color: string
  status: ProcessStatus
  exitCode?: number
}

function hexToRgb(hex: string): [number, number, number] {
  const m = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex)
  return m ? [parseInt(m[1], 16), parseInt(m[2], 16), parseInt(m[3], 16)] : [255, 255, 255]
}

function ansiColor(hex: string, text: string): string {
  const [r, g, b] = hexToRgb(hex)
  return `\x1b[38;2;${r};${g};${b}m${text}\x1b[0m`
}

interface WorkerPanelProps {
  terminalId: string
  procfilePath: string
  cwd: string
  isActive: boolean
}

export const WorkerPanel = memo(function WorkerPanel({ terminalId, procfilePath, cwd, isActive }: WorkerPanelProps) {
  const containerRef = useRef<HTMLDivElement>(null)
  const terminalRef = useRef<Terminal | null>(null)
  const fitAddonRef = useRef<FitAddon | null>(null)
  const doResizeRef = useRef<(() => void) | null>(null)
  const isActiveRef = useRef(isActive)
  const midLineRef = useRef<Map<string, boolean>>(new Map())
  const processesRef = useRef<WorkerProcess[]>([])
  const shellRef = useRef<string | undefined>()

  const [processes, setProcesses] = useState<WorkerProcess[]>([])
  const [error, setError] = useState<string | null>(null)

  useEffect(() => { isActiveRef.current = isActive }, [isActive])
  useEffect(() => { processesRef.current = processes }, [processes])

  // Write prefixed output to combined terminal
  const writeOutput = useCallback((name: string, color: string, data: string) => {
    const terminal = terminalRef.current
    if (!terminal) return

    const maxLen = Math.max(...processesRef.current.map(p => p.name.length))
    const paddedName = name.padEnd(maxLen)
    const prefix = ansiColor(color, paddedName) + '\x1b[90m | \x1b[0m'

    const atLineStart = !midLineRef.current.get(name)
    let output = data.replace(/\n/g, '\n' + prefix)
    if (atLineStart) output = prefix + output

    if (data.endsWith('\n')) {
      output = output.slice(0, -prefix.length)
      midLineRef.current.set(name, false)
    } else {
      midLineRef.current.set(name, true)
    }

    terminal.write(output)
  }, [])

  // Start a single process PTY
  const startProcess = useCallback(async (proc: WorkerProcess) => {
    dlog(`[worker] starting process: ${proc.name} (${proc.ptyId})`)

    setProcesses(prev => prev.map(p =>
      p.ptyId === proc.ptyId ? { ...p, status: 'starting' as const, exitCode: undefined } : p
    ))

    await window.electronAPI.pty.create({
      id: proc.ptyId,
      cwd,
      type: 'terminal',
      shell: shellRef.current,
    })

    // Use exec to replace the shell — pty exits when command exits
    const escaped = proc.command.replace(/'/g, "'\\''")
    setTimeout(() => {
      window.electronAPI.pty.write(proc.ptyId, `exec bash -c '${escaped}'\r`)
      setProcesses(prev => prev.map(p =>
        p.ptyId === proc.ptyId && p.status === 'starting' ? { ...p, status: 'running' as const } : p
      ))
    }, 300)
  }, [cwd])

  // Stop a single process
  const stopProcess = useCallback((proc: WorkerProcess) => {
    dlog(`[worker] stopping process: ${proc.name}`)
    window.electronAPI.pty.kill(proc.ptyId)
  }, [])

  // Restart a single process
  const restartProcess = useCallback(async (proc: WorkerProcess) => {
    dlog(`[worker] restarting process: ${proc.name}`)
    await window.electronAPI.pty.kill(proc.ptyId)

    const terminal = terminalRef.current
    if (terminal) {
      const maxLen = Math.max(...processesRef.current.map(p => p.name.length))
      const paddedName = proc.name.padEnd(maxLen)
      terminal.write(`\r\n${ansiColor(proc.color, paddedName)}\x1b[90m | \x1b[33mRestarting...\x1b[0m\r\n`)
    }
    midLineRef.current.set(proc.name, false)
    await startProcess(proc)
  }, [startProcess])

  // Batch operations
  const startAll = useCallback(() => {
    for (const p of processesRef.current) {
      if (p.status === 'stopped' || p.status === 'crashed') startProcess(p)
    }
  }, [startProcess])

  const stopAll = useCallback(() => {
    for (const p of processesRef.current) {
      if (p.status === 'running' || p.status === 'starting') stopProcess(p)
    }
  }, [stopProcess])

  const restartAll = useCallback(() => {
    for (const p of processesRef.current) restartProcess(p)
  }, [restartProcess])

  // Main init effect: create xterm, parse Procfile, start processes
  useEffect(() => {
    if (!containerRef.current) return

    let disposed = false
    const ptyIds: string[] = []

    // --- Create combined xterm.js (synchronous) ---
    const settings = settingsStore.getSettings()
    const colors = settingsStore.getTerminalColors()

    const terminal = new Terminal({
      theme: {
        background: colors.background,
        foreground: colors.foreground,
        cursor: colors.cursor,
        cursorAccent: colors.background,
        selectionBackground: '#5c5142',
        black: '#3b3228', red: '#cb6077', green: '#beb55b', yellow: '#f4bc87',
        blue: '#8ab3b5', magenta: '#a89bb9', cyan: '#7bbda4', white: '#d0c8c6',
        brightBlack: '#554d46', brightRed: '#cb6077', brightGreen: '#beb55b', brightYellow: '#f4bc87',
        brightBlue: '#8ab3b5', brightMagenta: '#a89bb9', brightCyan: '#7bbda4', brightWhite: '#f5f1e6',
      },
      fontSize: settings.fontSize,
      fontFamily: settingsStore.getFontFamilyString(),
      cursorBlink: false,
      scrollback: 10000,
      convertEol: true,
      allowProposedApi: true,
      allowTransparency: true,
      scrollOnOutput: true,
      disableStdin: true,
    })

    const fitAddon = new FitAddon()
    const unicode11Addon = new Unicode11Addon()
    const webLinksAddon = new WebLinksAddon((_, uri) => {
      window.electronAPI.shell.openExternal(uri)
    })
    terminal.loadAddon(fitAddon)
    terminal.loadAddon(webLinksAddon)
    terminal.loadAddon(unicode11Addon)
    terminal.unicode.activeVersion = '11'
    terminal.open(containerRef.current)

    terminalRef.current = terminal
    fitAddonRef.current = fitAddon

    // Resize helper
    let lastCols = 0, lastRows = 0
    const doResize = () => {
      fitAddon.fit()
      const { cols, rows } = terminal
      if (cols !== lastCols || rows !== lastRows) {
        lastCols = cols
        lastRows = rows
        for (const id of ptyIds) {
          window.electronAPI.pty.resize(id, cols, rows)
        }
      }
    }
    doResizeRef.current = doResize

    // ResizeObserver
    let resizeTimer: ReturnType<typeof setTimeout> | null = null
    const resizeObserver = new ResizeObserver(() => {
      if (resizeTimer) clearTimeout(resizeTimer)
      resizeTimer = setTimeout(() => {
        resizeTimer = null
        if (isActiveRef.current) doResize()
      }, 200)
    })
    resizeObserver.observe(containerRef.current)
    setTimeout(() => doResize(), 100)

    // Event listeners
    const unsubOutput = window.electronAPI.pty.onOutput((id, data) => {
      const proc = processesRef.current.find(p => p.ptyId === id)
      if (proc) writeOutput(proc.name, proc.color, data)
    })

    const unsubExit = window.electronAPI.pty.onExit((id, exitCode) => {
      const proc = processesRef.current.find(p => p.ptyId === id)
      if (!proc) return
      const maxLen = Math.max(...processesRef.current.map(p => p.name.length))
      const paddedName = proc.name.padEnd(maxLen)
      midLineRef.current.set(proc.name, false)
      const colorCode = exitCode === 0 ? '32' : '31'
      terminal.write(`\r\n${ansiColor(proc.color, paddedName)}\x1b[90m | \x1b[${colorCode}mProcess exited with code ${exitCode}\x1b[0m\r\n`)
      setProcesses(prev => prev.map(p =>
        p.ptyId === id ? { ...p, status: (exitCode === 0 ? 'stopped' : 'crashed') as ProcessStatus, exitCode } : p
      ))
    })

    const unsubSettings = settingsStore.subscribe(() => {
      const s = settingsStore.getSettings()
      const c = settingsStore.getTerminalColors()
      terminal.options.fontSize = s.fontSize
      terminal.options.fontFamily = settingsStore.getFontFamilyString()
      terminal.options.theme = {
        ...terminal.options.theme,
        background: c.background,
        foreground: c.foreground,
        cursor: c.cursor,
      }
      if (isActiveRef.current) doResize()
    })

    // --- Async: read Procfile and start processes ---
    ;(async () => {
      // Resolve shell path
      if (settings.shell === 'custom' && settings.customShellPath) {
        shellRef.current = settings.customShellPath
      } else {
        shellRef.current = await window.electronAPI.settings.getShellPath(settings.shell)
      }

      // Read Procfile
      const result = await window.electronAPI.fs.readFile(procfilePath)
      if (disposed) return
      if (result.error || !result.content) {
        setError(result.error || 'Empty Procfile')
        return
      }

      const entries = parseProcfile(result.content)
      if (entries.length === 0) {
        setError('No valid entries found in Procfile')
        return
      }

      // Build process list
      const procs: WorkerProcess[] = entries.map((entry, i) => ({
        name: entry.name,
        command: entry.command,
        ptyId: `${terminalId}__w__${entry.name}`,
        color: WORKER_COLORS[i % WORKER_COLORS.length],
        status: 'starting' as ProcessStatus,
      }))
      ptyIds.push(...procs.map(p => p.ptyId))
      processesRef.current = procs
      setProcesses(procs)

      // Write header
      const filename = procfilePath.split('/').pop() || 'Procfile'
      terminal.write(ansiColor('#888', `Worker: ${filename} (${procs.length} processes)\r\n`))
      terminal.write(ansiColor('#555', '\u2500'.repeat(60) + '\r\n'))

      // Start all processes
      for (const proc of procs) {
        if (disposed) break
        await window.electronAPI.pty.create({
          id: proc.ptyId,
          cwd,
          type: 'terminal',
          shell: shellRef.current,
        })
        const escaped = proc.command.replace(/'/g, "'\\''")
        window.electronAPI.pty.write(proc.ptyId, `exec bash -c '${escaped}'\r`)
      }

      // Mark all as running
      if (!disposed) {
        setProcesses(prev => prev.map(p =>
          p.status === 'starting' ? { ...p, status: 'running' as const } : p
        ))
      }
    })()

    return () => {
      disposed = true
      unsubOutput()
      unsubExit()
      unsubSettings()
      if (resizeTimer) clearTimeout(resizeTimer)
      resizeObserver.disconnect()
      doResizeRef.current = null
      terminal.dispose()
      terminalRef.current = null
      fitAddonRef.current = null
      for (const id of ptyIds) {
        window.electronAPI.pty.kill(id)
      }
    }
  }, [terminalId, procfilePath, cwd, writeOutput])

  // Handle resize/refresh when becoming active
  useEffect(() => {
    if (isActive && terminalRef.current) {
      requestAnimationFrame(() => {
        doResizeRef.current?.()
        requestAnimationFrame(() => {
          terminalRef.current?.clearTextureAtlas()
          terminalRef.current?.refresh(0, (terminalRef.current?.rows ?? 1) - 1)
        })
      })
    }
  }, [isActive])

  if (error) {
    return (
      <div className="worker-panel">
        <div className="worker-error">
          <div className="worker-error-title">Failed to load Procfile</div>
          <div className="worker-error-detail">{error}</div>
          <div className="worker-error-path">{procfilePath}</div>
        </div>
      </div>
    )
  }

  return (
    <div className="worker-panel">
      {processes.length > 0 && (
        <div className="worker-process-bar">
          {processes.map(proc => (
            <div key={proc.ptyId} className="worker-process-card">
              <span className={`worker-status-dot worker-status-${proc.status}`} />
              <span className="worker-process-name" style={{ color: proc.color }}>
                {proc.name}
              </span>
              <div className="worker-process-actions">
                {(proc.status === 'stopped' || proc.status === 'crashed') && (
                  <button className="worker-btn" onClick={() => startProcess(proc)} title="Start">
                    ▶
                  </button>
                )}
                {(proc.status === 'running' || proc.status === 'starting') && (
                  <button className="worker-btn" onClick={() => stopProcess(proc)} title="Stop">
                    ■
                  </button>
                )}
                <button className="worker-btn" onClick={() => restartProcess(proc)} title="Restart">
                  ⟳
                </button>
              </div>
            </div>
          ))}
          <div className="worker-global-actions">
            <button className="worker-btn" onClick={startAll} title="Start All">▶ All</button>
            <button className="worker-btn" onClick={stopAll} title="Stop All">■ All</button>
            <button className="worker-btn" onClick={restartAll} title="Restart All">⟳ All</button>
          </div>
        </div>
      )}
      <div ref={containerRef} className="worker-terminal" />
    </div>
  )
})
