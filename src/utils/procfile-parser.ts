/**
 * Procfile parser — supports standard Procfile format (name: command)
 * Compatible with Foreman, Overmind, Hivemind, etc.
 */

export interface ProcfileEntry {
  name: string
  command: string
}

/**
 * Parse Procfile content into a list of process entries.
 * Format: `process_name: command to run`
 * Lines starting with # are comments, empty lines are skipped.
 */
export function parseProcfile(content: string): ProcfileEntry[] {
  const entries: ProcfileEntry[] = []
  for (const raw of content.split('\n')) {
    const line = raw.trim()
    if (!line || line.startsWith('#')) continue
    const colonIdx = line.indexOf(':')
    if (colonIdx <= 0) continue
    const name = line.slice(0, colonIdx).trim()
    const command = line.slice(colonIdx + 1).trim()
    if (name && command) {
      entries.push({ name, command })
    }
  }
  return entries
}

/** Common Procfile names to search for in a project directory */
export const PROCFILE_NAMES = ['Procfile.dev', 'Procfile', 'Procfile.local'] as const
