import { app } from 'electron'
import path from 'path'
import * as fs from 'fs/promises'
import * as fsSync from 'fs'
import { logger } from './logger'

export interface WindowEntry {
  id: string
  profileId?: string
  workspaces: unknown[]
  activeWorkspaceId: string | null
  activeGroup: string | null
  terminals: unknown[]
  activeTerminalId: string | null
  bounds?: { x: number; y: number; width: number; height: number }
  lastActiveAt: number
}

function getRegistryPath(): string {
  return path.join(app.getPath('userData'), 'windows.json')
}

function getWorkspacesPath(): string {
  return path.join(app.getPath('userData'), 'workspaces.json')
}

function generateId(): string {
  return `win-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
}

export class WindowRegistry {
  private cachedEntries: WindowEntry[] | null = null

  async readAll(): Promise<WindowEntry[]> {
    try {
      const data = await fs.readFile(getRegistryPath(), 'utf-8')
      const entries = JSON.parse(data) as WindowEntry[]
      this.cachedEntries = entries
      return entries
    } catch {
      return []
    }
  }

  async getEntry(windowId: string): Promise<WindowEntry | null> {
    const entries = await this.readAll()
    return entries.find(e => e.id === windowId) || null
  }

  async saveEntry(entry: WindowEntry): Promise<void> {
    const entries = await this.readAll()
    const idx = entries.findIndex(e => e.id === entry.id)
    if (idx >= 0) {
      entries[idx] = entry
    } else {
      entries.push(entry)
    }
    await this.writeAll(entries)
  }

  async removeEntry(windowId: string): Promise<void> {
    const entries = await this.readAll()
    const filtered = entries.filter(e => e.id !== windowId)
    await this.writeAll(filtered)
  }

  async createEntry(opts?: { profileId?: string }): Promise<WindowEntry> {
    const entry: WindowEntry = {
      id: generateId(),
      profileId: opts?.profileId,
      workspaces: [],
      activeWorkspaceId: null,
      activeGroup: null,
      terminals: [],
      activeTerminalId: null,
      lastActiveAt: Date.now(),
    }
    await this.saveEntry(entry)
    return entry
  }

  /** On first launch: migrate from workspaces.json if windows.json doesn't exist */
  async ensureInitialized(): Promise<WindowEntry[]> {
    if (fsSync.existsSync(getRegistryPath())) {
      return this.readAll()
    }

    logger.log('[window-registry] First launch — migrating from workspaces.json')

    // Try to read existing workspaces.json
    let workspacesData: { workspaces: unknown[]; activeWorkspaceId: string | null; activeGroup: string | null; terminals?: unknown[]; activeTerminalId?: string | null } = {
      workspaces: [],
      activeWorkspaceId: null,
      activeGroup: null,
      terminals: [],
      activeTerminalId: null,
    }

    try {
      const raw = await fs.readFile(getWorkspacesPath(), 'utf-8')
      const parsed = JSON.parse(raw)
      workspacesData = {
        workspaces: parsed.workspaces || [],
        activeWorkspaceId: parsed.activeWorkspaceId || null,
        activeGroup: parsed.activeGroup || null,
        terminals: parsed.terminals || [],
        activeTerminalId: parsed.activeTerminalId || null,
      }
      logger.log(`[window-registry] Read workspaces.json: ${workspacesData.workspaces.length} workspaces, ${(workspacesData.terminals || []).length} terminals`)
    } catch (e) {
      logger.log(`[window-registry] No workspaces.json to migrate: ${e}`)
    }

    // Read active profile ID to link the migrated window entry
    let activeProfileId: string | undefined
    try {
      const profileIndexPath = path.join(app.getPath('userData'), 'profiles', 'index.json')
      const profileIndex = JSON.parse(await fs.readFile(profileIndexPath, 'utf-8'))
      // Support both old (activeProfileId) and new (activeProfileIds) formats
      activeProfileId = profileIndex.activeProfileIds?.[0] || profileIndex.activeProfileId || 'default'
    } catch {
      activeProfileId = 'default'
    }

    // Create a single window entry from existing data
    const entry: WindowEntry = {
      id: generateId(),
      profileId: activeProfileId,
      workspaces: workspacesData.workspaces,
      activeWorkspaceId: workspacesData.activeWorkspaceId,
      activeGroup: workspacesData.activeGroup,
      terminals: workspacesData.terminals || [],
      activeTerminalId: workspacesData.activeTerminalId || null,
      lastActiveAt: Date.now(),
    }

    const entries = [entry]
    await this.writeAll(entries)
    logger.log(`[window-registry] Migrated ${workspacesData.workspaces.length} workspaces to window ${entry.id}`)
    return entries
  }

  /** Re-migrate from workspaces.json when windows.json has only empty entries */
  async remigrateFromWorkspacesJson(): Promise<WindowEntry | null> {
    logger.log('[window-registry] Attempting re-migration from workspaces.json')
    try {
      const raw = await fs.readFile(getWorkspacesPath(), 'utf-8')
      const parsed = JSON.parse(raw)
      const workspaces = parsed.workspaces || []
      if (workspaces.length === 0) {
        logger.log('[window-registry] workspaces.json exists but has no workspaces')
        return null
      }

      let activeProfileId: string | undefined
      try {
        const profileIndexPath = path.join(app.getPath('userData'), 'profiles', 'index.json')
        const profileIndex = JSON.parse(await fs.readFile(profileIndexPath, 'utf-8'))
        activeProfileId = profileIndex.activeProfileIds?.[0] || profileIndex.activeProfileId || 'default'
      } catch {
        activeProfileId = 'default'
      }

      const entry: WindowEntry = {
        id: generateId(),
        profileId: activeProfileId,
        workspaces,
        activeWorkspaceId: parsed.activeWorkspaceId || null,
        activeGroup: parsed.activeGroup || null,
        terminals: parsed.terminals || [],
        activeTerminalId: parsed.activeTerminalId || null,
        lastActiveAt: Date.now(),
      }
      await this.writeAll([entry])
      logger.log(`[window-registry] Re-migrated ${workspaces.length} workspaces to window ${entry.id}`)
      return entry
    } catch (e) {
      logger.log(`[window-registry] Re-migration failed: ${e}`)
      return null
    }
  }

  private writeQueue: Promise<void> = Promise.resolve()

  private async writeAll(entries: WindowEntry[]): Promise<void> {
    // Serialize writes to prevent race conditions
    this.writeQueue = this.writeQueue.then(async () => {
      await fs.writeFile(getRegistryPath(), JSON.stringify(entries, null, 2), 'utf-8')
    }).catch(e => {
      logger.error('[window-registry] writeAll failed:', e)
    })
    await this.writeQueue
    this.cachedEntries = entries
  }
}
