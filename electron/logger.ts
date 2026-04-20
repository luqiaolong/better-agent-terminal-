import * as fs from 'fs'
import * as path from 'path'

const DEBUG_ENABLED = process.argv.includes('--debug') || process.env.BAT_DEBUG === '1'

let logFilePath: string | null = null
let initialized = false

// Buffered async writes — avoid blocking main process event loop
let writeBuffer: string[] = []
let flushScheduled = false

function formatArgs(args: unknown[]): string {
  return args.map(a => {
    if (a instanceof Error) return `${a.message}\n${a.stack || ''}`
    if (typeof a === 'string') return a
    try { return JSON.stringify(a) } catch { return String(a) }
  }).join(' ')
}

function scheduleFlush() {
  if (flushScheduled || writeBuffer.length === 0) return
  flushScheduled = true
  setImmediate(() => {
    flushScheduled = false
    if (!logFilePath || writeBuffer.length === 0) return
    const batch = writeBuffer.join('')
    writeBuffer = []
    fs.appendFile(logFilePath, batch, () => { /* ignore errors */ })
  })
}

function writeToFile(level: string, args: unknown[]) {
  if (!logFilePath) return
  const ts = new Date().toISOString()
  const line = `[${ts}] [${level}] ${formatArgs(args)}\n`
  writeBuffer.push(line)
  scheduleFlush()
}

/** Initialize logger with proper userData path. Call inside app.whenReady(). */
function init(userDataPath: string) {
  if (initialized) return
  initialized = true
  if (!DEBUG_ENABLED) return

  const runtimeId = process.env.BAT_RUNTIME || process.argv.find(a => a.startsWith('--runtime='))?.split('=')[1]
  const logBaseName = runtimeId ? `debug.${runtimeId}.log` : 'debug.log'
  const prevBaseName = runtimeId ? `debug.${runtimeId}.prev.log` : 'debug.prev.log'

  logFilePath = path.join(userDataPath, logBaseName)
  const prevPath = path.join(userDataPath, prevBaseName)

  // Rotate: current → prev (sync is fine here, only runs once at startup)
  try {
    if (fs.existsSync(logFilePath)) {
      try { fs.unlinkSync(prevPath) } catch { /* ok */ }
      fs.renameSync(logFilePath, prevPath)
    }
  } catch { /* ignore rotation errors */ }

  // Write header
  writeToFile('INFO', [`Debug logging started. PID=${process.pid} argv=${process.argv.join(' ')}`])
}

function log(...args: unknown[]) {
  console.log(...args)
  if (DEBUG_ENABLED) writeToFile('LOG', args)
}

function warn(...args: unknown[]) {
  console.warn(...args)
  if (DEBUG_ENABLED) writeToFile('WARN', args)
}

function error(...args: unknown[]) {
  console.error(...args)
  if (DEBUG_ENABLED) writeToFile('ERROR', args)
}

export const logger = { init, log, warn, error, get enabled() { return DEBUG_ENABLED } }
