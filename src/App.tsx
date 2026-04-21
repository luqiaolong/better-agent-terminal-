import { useEffect, useState, useCallback, useMemo, useRef } from 'react'
import { useTranslation } from 'react-i18next'
import i18next from 'i18next'
import { workspaceStore } from './stores/workspace-store'
import { settingsStore } from './stores/settings-store'
import { Sidebar } from './components/Sidebar'
import { WorkspaceView, clearInitializedWorkspaces } from './components/WorkspaceView'
import { SettingsPanel } from './components/SettingsPanel'
import { SnippetSidebar } from './components/SnippetPanel'
import { SkillsPanel } from './components/SkillsPanel'
import { AgentsPanel } from './components/AgentsPanel'
import { MarkdownPreviewPanel } from './components/MarkdownPreviewPanel'
import { WorkspaceEnvDialog } from './components/WorkspaceEnvDialog'
import { ResizeHandle } from './components/ResizeHandle'
import { ProfilePanel } from './components/ProfilePanel'
import { FolderPicker } from './components/FolderPicker'
import { CommandPalette } from './components/CommandPalette'
import type { AppState, EnvVariable, TerminalInstance } from './types'
import type { CommandPaletteItem } from './utils/command-palette'

// Panel settings interface
interface PanelSettings {
  sidebar: {
    width: number
    collapsed: boolean
  }
  snippetSidebar: {
    width: number
    collapsed: boolean
  }
}

const PANEL_SETTINGS_KEY = 'better-terminal-panel-settings'
const DEFAULT_SIDEBAR_WIDTH = 220
const MIN_SIDEBAR_WIDTH = 160
const MAX_SIDEBAR_WIDTH = 400
const DEFAULT_SNIPPET_WIDTH = 280
const MIN_SNIPPET_WIDTH = 180
const MAX_SNIPPET_WIDTH = 500

// Compute parent of a path, supporting both POSIX and Windows separators.
// Returns the input unchanged if at filesystem root.
function parentPath(p: string): string {
  if (!p) return p
  const trimmed = p.replace(/[/\\]+$/, '')
  const idx = Math.max(trimmed.lastIndexOf('/'), trimmed.lastIndexOf('\\'))
  if (idx < 0) return trimmed
  // Windows drive root e.g. "C:\foo" → "C:\"
  if (idx === 2 && trimmed[1] === ':') return trimmed.slice(0, 3)
  // POSIX root e.g. "/foo" → "/"
  if (idx === 0) return '/'
  return trimmed.slice(0, idx)
}

function loadPanelSettings(): PanelSettings {
  try {
    const saved = localStorage.getItem(PANEL_SETTINGS_KEY)
    if (saved) {
      const parsed = JSON.parse(saved)
      // Ensure sidebar settings exist (migration from old format)
      return {
        sidebar: {
          width: parsed.sidebar?.width ?? DEFAULT_SIDEBAR_WIDTH,
          collapsed: parsed.sidebar?.collapsed ?? true
        },
        snippetSidebar: parsed.snippetSidebar || { width: DEFAULT_SNIPPET_WIDTH, collapsed: true }
      }
    }
  } catch (e) {
    console.error('Failed to load panel settings:', e)
  }
  return {
    sidebar: { width: DEFAULT_SIDEBAR_WIDTH, collapsed: true },
    snippetSidebar: { width: DEFAULT_SNIPPET_WIDTH, collapsed: true }
  }
}

function savePanelSettings(settings: PanelSettings): void {
  try {
    localStorage.setItem(PANEL_SETTINGS_KEY, JSON.stringify(settings))
  } catch (e) {
    console.error('Failed to save panel settings:', e)
  }
}

export default function App() {
  const { t } = useTranslation()
  const [state, setState] = useState<AppState>(workspaceStore.getState())
  const [showSettings, setShowSettings] = useState(false)
  const [showProfiles, setShowProfiles] = useState(false)
  const [folderPickerInitialPath, setFolderPickerInitialPath] = useState<string | undefined>(undefined)
  const [folderPickerOpen, setFolderPickerOpen] = useState(false)
  const [activeProfileName, setActiveProfileName] = useState<string>('Default')
  const [isRemoteConnected, setIsRemoteConnected] = useState(false)
  const [appNotification, setAppNotification] = useState<string | null>(null)
  const [envDialogWorkspaceId, setEnvDialogWorkspaceId] = useState<string | null>(null)
  // Right sidebar tabs
  const [showSnippetSidebar] = useState(true)
  const [rightPanelTab, setRightPanelTab] = useState<'snippets' | 'skills' | 'agents'>(() => {
    return (localStorage.getItem('bat-right-panel-tab') as 'snippets' | 'skills' | 'agents') || 'snippets'
  })
  // Markdown preview in right panel
  const [previewMarkdownPath, setPreviewMarkdownPath] = useState<string | null>(null)
  // Track collapsed state before markdown preview opened, to restore on close
  const previewPrevCollapsed = useRef<boolean | null>(null)
  const commandPaletteRestoreRef = useRef<HTMLElement | null>(null)
  // Panel settings for resizable panels
  const [panelSettings, setPanelSettings] = useState<PanelSettings>(loadPanelSettings)
  const [showCommandPalette, setShowCommandPalette] = useState(false)
  // Detached workspace support
  const [detachedWorkspaceId] = useState(() => window.electronAPI.workspace.getDetachedId())
  const [detachedIds, setDetachedIds] = useState<Set<string>>(new Set())
  // Track workspaces that have been visited (for lazy mounting)
  const [mountedWorkspaces, setMountedWorkspaces] = useState<Set<string>>(new Set())

  // Sync window title with active profile, window index, and account info
  const [windowIndex, setWindowIndex] = useState<number>(1)
  const [authInfo, setAuthInfo] = useState<{ email?: string; subscriptionType?: string } | null>(null)
  useEffect(() => {
    window.electronAPI.app.getWindowIndex().then(setWindowIndex)
  }, [])
  useEffect(() => {
    const fetchAuth = () => {
      window.electronAPI.claude.authStatus().then(info => {
        if (info) setAuthInfo({ email: info.email, subscriptionType: info.subscriptionType })
      }).catch(() => {})
    }
    fetchAuth()
    const interval = setInterval(fetchAuth, 120_000)
    const onAccountSwitch = () => fetchAuth()
    window.addEventListener('claude-account-switched', onAccountSwitch)
    return () => { clearInterval(interval); window.removeEventListener('claude-account-switched', onAccountSwitch) }
  }, [])
  useEffect(() => {
    const authSuffix = authInfo?.email ? ` ( ${authInfo.email} / ${authInfo.subscriptionType || 'unknown'} )` : ''
    document.title = `Better Agent Terminal - ${activeProfileName}:${windowIndex}${authSuffix}`
  }, [activeProfileName, windowIndex, authInfo])

  // Lazy mount: only render a workspace's terminals once it has been activated
  useEffect(() => {
    if (state.activeWorkspaceId && !mountedWorkspaces.has(state.activeWorkspaceId)) {
      setMountedWorkspaces(prev => new Set(prev).add(state.activeWorkspaceId!))
    }
  }, [state.activeWorkspaceId, mountedWorkspaces])

  // Handle sidebar resize
  const handleSidebarResize = useCallback((delta: number) => {
    setPanelSettings(prev => {
      // Note: delta is positive when dragging right (making sidebar wider)
      const newWidth = Math.min(MAX_SIDEBAR_WIDTH, Math.max(MIN_SIDEBAR_WIDTH, prev.sidebar.width + delta))
      const updated = { ...prev, sidebar: { ...prev.sidebar, width: newWidth } }
      savePanelSettings(updated)
      return updated
    })
  }, [])

  // Reset sidebar to default width
  const handleSidebarResetWidth = useCallback(() => {
    setPanelSettings(prev => {
      const updated = { ...prev, sidebar: { ...prev.sidebar, width: DEFAULT_SIDEBAR_WIDTH } }
      savePanelSettings(updated)
      return updated
    })
  }, [])

  const handleSidebarCollapse = useCallback(() => {
    setPanelSettings(prev => {
      const updated = { ...prev, sidebar: { ...prev.sidebar, collapsed: !prev.sidebar.collapsed } }
      savePanelSettings(updated)
      return updated
    })
  }, [])

  // Handle snippet sidebar resize
  const handleSnippetResize = useCallback((delta: number) => {
    setPanelSettings(prev => {
      // Note: delta is negative when dragging left (making sidebar wider)
      const newWidth = Math.min(MAX_SNIPPET_WIDTH, Math.max(MIN_SNIPPET_WIDTH, prev.snippetSidebar.width - delta))
      const updated = { ...prev, snippetSidebar: { ...prev.snippetSidebar, width: newWidth } }
      savePanelSettings(updated)
      return updated
    })
  }, [])

  const handleRightPanelTabChange = useCallback((tab: 'snippets' | 'skills' | 'agents') => {
    setRightPanelTab(tab)
    localStorage.setItem('bat-right-panel-tab', tab)
    // If collapsed, expand when switching tabs
    setPanelSettings(prev => {
      if (prev.snippetSidebar.collapsed) {
        const updated = { ...prev, snippetSidebar: { ...prev.snippetSidebar, collapsed: false } }
        savePanelSettings(updated)
        return updated
      }
      return prev
    })
  }, [])

  // Toggle snippet sidebar collapse
  const handleSnippetCollapse = useCallback(() => {
    setPanelSettings(prev => {
      const updated = { ...prev, snippetSidebar: { ...prev.snippetSidebar, collapsed: !prev.snippetSidebar.collapsed } }
      savePanelSettings(updated)
      return updated
    })
  }, [])

  const handleSnippetPanelToggle = useCallback(() => {
    setPanelSettings(prev => {
      const updated = { ...prev, snippetSidebar: { ...prev.snippetSidebar, collapsed: !prev.snippetSidebar.collapsed } }
      savePanelSettings(updated)
      return updated
    })
  }, [])

  const openCommandPalette = useCallback(() => {
    commandPaletteRestoreRef.current = document.activeElement instanceof HTMLElement
      ? document.activeElement
      : null
    setShowCommandPalette(true)
  }, [])

  const closeCommandPalette = useCallback((restoreFocus = true) => {
    setShowCommandPalette(false)
    if (!restoreFocus) return
    requestAnimationFrame(() => {
      commandPaletteRestoreRef.current?.focus?.()
    })
  }, [])

  // Reset snippet sidebar to default width
  const handleSnippetResetWidth = useCallback(() => {
    setPanelSettings(prev => {
      const updated = { ...prev, snippetSidebar: { ...prev.snippetSidebar, width: DEFAULT_SNIPPET_WIDTH } }
      savePanelSettings(updated)
      return updated
    })
  }, [])

  // Listen for markdown preview requests from PathLinker
  useEffect(() => {
    const handler = (e: Event) => {
      const { path } = (e as CustomEvent).detail as { path: string }
      setPreviewMarkdownPath(path)
      // Save current collapsed state so we can restore it on close, then expand panel
      setPanelSettings(prev => {
        previewPrevCollapsed.current = prev.snippetSidebar.collapsed
        if (prev.snippetSidebar.collapsed) {
          const updated = { ...prev, snippetSidebar: { ...prev.snippetSidebar, collapsed: false } }
          savePanelSettings(updated)
          return updated
        }
        return prev
      })
    }
    window.addEventListener('preview-markdown', handler)
    return () => window.removeEventListener('preview-markdown', handler)
  }, [])

  useEffect(() => {
    if (!showCommandPalette) return
    if (showSettings || showProfiles || folderPickerOpen || envDialogWorkspaceId !== null) {
      closeCommandPalette(false)
    }
  }, [showCommandPalette, showSettings, showProfiles, folderPickerOpen, envDialogWorkspaceId, closeCommandPalette])

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (!(e.metaKey || e.ctrlKey) || e.altKey || e.shiftKey || e.key.toLowerCase() !== 'k') return
      if (showSettings || showProfiles || folderPickerOpen || envDialogWorkspaceId !== null) return
      e.preventDefault()
      if (showCommandPalette) {
        closeCommandPalette()
        return
      }
      openCommandPalette()
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [
    showCommandPalette,
    showSettings,
    showProfiles,
    folderPickerOpen,
    envDialogWorkspaceId,
    openCommandPalette,
    closeCommandPalette,
  ])

  // Cmd+N / Ctrl+N: open new empty window
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (showCommandPalette) return
      if ((e.metaKey || e.ctrlKey) && e.key === 'n' && !e.shiftKey && !e.altKey) {
        e.preventDefault()
        window.electronAPI.app.newWindow()
      }
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [showCommandPalette])

  // Track previous terminal for Cmd+` toggle
  const prevTerminalIdRef = useRef<string | null>(null)

  // Keyboard shortcuts: Cmd+` (toggle terminal), Cmd+Left/Right (cycle tabs), Cmd+Up/Down (switch workspace)
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (showCommandPalette) return
      if (!(e.metaKey || e.ctrlKey) || e.altKey) return

      // Cmd+` / Ctrl+`: Toggle between first regular terminal and Claude Code terminal
      if (e.key === '`' && !e.shiftKey) {
        e.preventDefault()
        const currentState = workspaceStore.getState()
        if (!currentState.activeWorkspaceId) return
        const terminals = workspaceStore.getWorkspaceTerminals(currentState.activeWorkspaceId)
        if (terminals.length === 0) return

        const firstRegular = terminals.find(t => !t.agentPreset || t.agentPreset === 'none')
        const agentTerminal = terminals.find(t => t.agentPreset && t.agentPreset !== 'none')
        const focusedId = currentState.focusedTerminalId

        // If focused on agent terminal → switch to first regular terminal
        // If focused on regular terminal → switch back to agent terminal (or previous)
        const focusedTerminal = terminals.find(t => t.id === focusedId)
        const isOnAgent = focusedTerminal?.agentPreset && focusedTerminal.agentPreset !== 'none'

        if (isOnAgent && firstRegular) {
          prevTerminalIdRef.current = focusedId
          workspaceStore.setFocusedTerminal(firstRegular.id)
        } else if (!isOnAgent && agentTerminal) {
          prevTerminalIdRef.current = focusedId
          workspaceStore.setFocusedTerminal(agentTerminal.id)
        } else if (!isOnAgent && prevTerminalIdRef.current) {
          const prev = prevTerminalIdRef.current
          prevTerminalIdRef.current = focusedId
          workspaceStore.setFocusedTerminal(prev)
        }
        // Also ensure we're on the terminal tab
        window.dispatchEvent(new CustomEvent('workspace-switch-tab', { detail: { tab: 'terminal' } }))
        return
      }

      // Cmd+Up / Cmd+Down: Switch workspaces
      if ((e.key === 'ArrowUp' || e.key === 'ArrowDown') && !e.shiftKey) {
        e.preventDefault()
        const currentState = workspaceStore.getState()
        const workspaces = currentState.workspaces
        if (workspaces.length <= 1) return
        const currentIndex = workspaces.findIndex(w => w.id === currentState.activeWorkspaceId)
        const direction = e.key === 'ArrowDown' ? 1 : -1
        const nextIndex = (currentIndex + direction + workspaces.length) % workspaces.length
        workspaceStore.setActiveWorkspace(workspaces[nextIndex].id)
        return
      }
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [showCommandPalette])

  useEffect(() => {
    const unsubscribe = workspaceStore.subscribe(() => {
      setState(workspaceStore.getState())
    })

    // Global listener for all terminal output - updates activity for ALL terminals
    // This is needed because WorkspaceView only renders terminals for the active workspace
    const unsubscribeOutput = window.electronAPI.pty.onOutput((id) => {
      workspaceStore.updateTerminalActivity(id)
    })

    // Load saved workspaces and settings on startup
    // If launched with --profile, use that profile instead of the stored active one
    const dlog = (...args: unknown[]) => window.electronAPI?.debug?.log(...args)
    const htmlT0 = (window as unknown as { __t0?: number }).__t0 || Date.now()
    dlog(`[startup] App useEffect fired: +${Date.now() - htmlT0}ms from HTML`)
    const initProfile = async () => {
      const t0 = performance.now()
      try {
        const launchProfileId = await window.electronAPI.app.getLaunchProfile()
        dlog(`[init] getLaunchProfile: ${(performance.now() - t0).toFixed(0)}ms`)

        const t1 = performance.now()
        const result = await window.electronAPI.profile.list()
        dlog(`[init] profile.list: ${(performance.now() - t1).toFixed(0)}ms`)

        // Determine which profile this window should use:
        // 1. Launch profile (--profile= argument) takes priority
        // 2. Window registry's profileId (per-window binding)
        // 3. First active profile as fallback
        const windowProfileId = await window.electronAPI.app.getWindowProfile()
        const profileId = launchProfileId || windowProfileId || result.activeProfileIds[0]
        let active = result.profiles.find(p => p.id === profileId)

        // If the id doesn't match anything in `result` (which is the REMOTE
        // host's profile list when a remote connection is already active),
        // fall back to the local profile list. This happens when the window
        // is bound to a LOCAL profile that acts as an alias for a remote
        // connection (e.g. launched with --profile=<local-remote-alias>).
        if (!active && profileId) {
          try {
            const localResult = await window.electronAPI.profile.listLocal()
            active = localResult.profiles.find(p => p.id === profileId)
          } catch {
            // listLocal may not exist on older builds — fall through
          }
        }

        if (active?.type === 'remote' && active.remoteHost && active.remoteToken && active.remoteFingerprint) {
          // Try connecting to remote
          const tRemote = performance.now()
          const connectResult = await window.electronAPI.remote.connect(
            active.remoteHost,
            active.remotePort || 9876,
            active.remoteToken,
            active.remoteFingerprint
          )
          dlog(`[init] remote.connect: ${(performance.now() - tRemote).toFixed(0)}ms`)
          if ('error' in connectResult) {
            if (launchProfileId) {
              // New window launch failed — show error and close instead of corrupting shared state
              setAppNotification(t('app.remoteConnectionFailed', { error: connectResult.error }))
              setTimeout(() => window.close(), 3000)
              return
            }
            // Main window: fall back to first local profile
            const localProfile = result.profiles.find(p => p.type !== 'remote')
            if (localProfile) {
              await window.electronAPI.profile.load(localProfile.id)
              const winIdx = await window.electronAPI.app.getWindowIndex()
              setActiveProfileName(`${localProfile.name}:${winIdx}`)
            }
          } else {
            const winIdx = await window.electronAPI.app.getWindowIndex()
            setActiveProfileName(`${active.name}:${winIdx}`)
            setIsRemoteConnected(true)
          }
        } else if (active?.type === 'remote') {
          // Remote profile missing connection info — fall back
          if (launchProfileId) {
            setAppNotification(t('app.remoteMissingInfo'))
            setTimeout(() => window.close(), 3000)
            return
          }
          const localProfile = result.profiles.find(p => p.type !== 'remote')
          if (localProfile) {
            await window.electronAPI.profile.load(localProfile.id)
            const winIdx = await window.electronAPI.app.getWindowIndex()
            setActiveProfileName(`${localProfile.name}:${winIdx}`)
          }
        } else if (active) {
          // For local profiles opened in a new window, load the profile snapshot
          // so workspaces.json reflects this profile's data (not the previous profile's)
          if (launchProfileId) {
            await window.electronAPI.profile.load(active.id)
          }
          const winIdx = await window.electronAPI.app.getWindowIndex()
          setActiveProfileName(`${active.name}:${winIdx}`)
        } else if (result.profiles.length > 0) {
          // Fallback: activeProfileId didn't match any profile — use first local profile
          const fallback = result.profiles.find(p => p.type !== 'remote') || result.profiles[0]
          const winIdx = await window.electronAPI.app.getWindowIndex()
          setActiveProfileName(`${fallback.name}:${winIdx}`)
        }

        // Store windowId for cross-window workspace drag
        const winId = await window.electronAPI.app.getWindowId()
        if (winId) workspaceStore.setWindowId(winId)

        const tLoad = performance.now()
        // Load settings first (lightweight, no re-render), then workspaces (triggers heavy re-render)
        await settingsStore.load()
        dlog(`[init] settingsStore.load: ${(performance.now() - tLoad).toFixed(0)}ms`)

        // Sync i18n language with saved setting
        const savedLang = settingsStore.getSettings().language || 'en'
        if (i18next.language !== savedLang) i18next.changeLanguage(savedLang)

        const tWs = performance.now()
        await workspaceStore.load()
        dlog(`[init] workspaceStore.load: ${(performance.now() - tWs).toFixed(0)}ms`)
      } catch (e) {
        console.error('Failed to initialize profile:', e)
        // Ensure workspaces still load even if profile init fails
        await settingsStore.load()
        const savedLang = settingsStore.getSettings().language || 'en'
        if (i18next.language !== savedLang) i18next.changeLanguage(savedLang)
        await workspaceStore.load()
      }
      dlog(`[init] total initProfile: ${(performance.now() - t0).toFixed(0)}ms`)
      dlog(`[startup] app ready (initProfile done): +${Date.now() - htmlT0}ms from HTML`)
    }
    initProfile()

    // Listen for system resume from sleep/hibernate — refresh remote connection status
    const unsubSystemResume = window.electronAPI.system.onResume(() => {
      window.electronAPI.remote.clientStatus().then(s => setIsRemoteConnected(s.connected))
    })

    // Listen for cross-window workspace reload
    const unsubReload = workspaceStore.listenForReload()

    // Listen for workspace detach/reattach events (main window only)
    const unsubDetach = window.electronAPI.workspace.onDetached((wsId) => {
      setDetachedIds(prev => new Set(prev).add(wsId))
    })
    const unsubReattach = window.electronAPI.workspace.onReattached((wsId) => {
      setDetachedIds(prev => {
        const next = new Set(prev)
        next.delete(wsId)
        return next
      })
    })

    return () => {
      unsubscribe()
      unsubscribeOutput()
      unsubSystemResume()
      unsubReload()
      unsubDetach()
      unsubReattach()
    }
  }, [])

  // Poll remote client connection status
  useEffect(() => {
    const check = () => {
      window.electronAPI.remote.clientStatus().then(s => setIsRemoteConnected(s.connected))
    }
    check()
    const interval = setInterval(check, 3000)
    return () => clearInterval(interval)
  }, [])

  const handleAddWorkspace = useCallback(() => {
    const { workspaces, activeWorkspaceId } = workspaceStore.getState()
    const active = workspaces.find(w => w.id === activeWorkspaceId)
    setFolderPickerInitialPath(active ? parentPath(active.folderPath) : undefined)
    setFolderPickerOpen(true)
  }, [])

  const handleFolderPickerSelect = useCallback((paths: string[]) => {
    for (const folderPath of paths) {
      const name = folderPath.split(/[/\\]/).filter(Boolean).pop() || 'Workspace'
      workspaceStore.addWorkspace(name, folderPath)
    }
    workspaceStore.save()
    setFolderPickerOpen(false)
  }, [])


  const handleDetachWorkspace = useCallback(async (workspaceId: string) => {
    await window.electronAPI.workspace.detach(workspaceId)
  }, [])

  // Paste content to focused PTY terminal
  const handlePasteToTerminal = useCallback((content: string) => {
    const currentState = workspaceStore.getState()
    let terminalId = currentState.focusedTerminalId

    if (!terminalId && currentState.activeWorkspaceId) {
      const workspaceTerminals = workspaceStore.getWorkspaceTerminals(currentState.activeWorkspaceId)
      if (workspaceTerminals.length > 0) {
        terminalId = workspaceTerminals[0].id
      }
    }

    if (terminalId) {
      window.electronAPI.pty.write(terminalId, content)
    } else {
      console.warn('No terminal available to paste to')
    }
  }, [])

  // Send content to active Claude agent session
  const handleSendToAgent = useCallback((content: string) => {
    const currentState = workspaceStore.getState()
    // Find focused agent terminal, or first agent in active workspace
    let terminalId = currentState.focusedTerminalId
    let terminal: TerminalInstance | undefined

    if (terminalId) {
      terminal = currentState.terminals.find(t => t.id === terminalId)
      // If focused terminal is not an agent, find the first agent
      if (!terminal?.agentPreset || terminal.agentPreset === 'none') {
        terminal = undefined
        terminalId = null
      }
    }

    if (!terminalId && currentState.activeWorkspaceId) {
      const workspaceTerminals = workspaceStore.getWorkspaceTerminals(currentState.activeWorkspaceId)
      terminal = workspaceTerminals.find(t => t.agentPreset && t.agentPreset !== 'none')
      terminalId = terminal?.id ?? null
    }

    if (terminalId) {
      window.electronAPI.claude.sendMessage(terminalId, content)
    } else {
      console.warn('No Claude agent session available')
    }
  }, [])

  // Open profile in a new app instance (or focus if already open)
  const handleProfileNewWindow = useCallback(async (profileId: string) => {
    const result = await window.electronAPI.app.openNewInstance(profileId)
    if (result?.alreadyOpen) {
      setAppNotification(t('profiles.alreadyOpen'))
    }
    setShowProfiles(false)
  }, [t])

  const focusedTerminal = state.focusedTerminalId
    ? state.terminals.find(terminal => terminal.id === state.focusedTerminalId) ?? null
    : null
  const activeWorkspace = state.activeWorkspaceId
    ? state.workspaces.find(workspace => workspace.id === state.activeWorkspaceId) ?? null
    : null
  const visibleWorkspaces = state.workspaces.filter(w => !detachedIds.has(w.id))
  const paletteWorkspaces = detachedWorkspaceId
    ? state.workspaces.filter(workspace => workspace.id === detachedWorkspaceId)
    : visibleWorkspaces
  const isClaudeFocused = focusedTerminal?.agentPreset === 'claude-code' || focusedTerminal?.agentPreset === 'claude-code-v2'

  const commandPaletteItems = useMemo<CommandPaletteItem[]>(() => {
    const items: CommandPaletteItem[] = []
    const activeGroup = workspaceStore.getActiveGroup()
    const workspaceItems = paletteWorkspaces
      .map(workspace => {
        const terminals = workspaceStore.getWorkspaceTerminals(workspace.id)
        const hasPendingAction = terminals.some(terminal => terminal.hasPendingAction)
        const lastActivity = workspaceStore.getWorkspaceLastActivity(workspace.id) ?? workspace.createdAt
        const inActiveGroup = activeGroup ? workspace.group === activeGroup : true
        const displayName = workspace.alias || workspace.name
        const badges: string[] = []
        if (workspace.id === state.activeWorkspaceId) badges.push(t('commandPalette.badges.current'))
        if (hasPendingAction) badges.push(t('commandPalette.badges.pending'))
        if (workspace.group) badges.push(workspace.group)
        return {
          id: `workspace:${workspace.id}`,
          title: displayName,
          subtitle: workspace.folderPath,
          section: 'workspaces',
          keywords: [workspace.name, workspace.alias ?? '', workspace.folderPath, workspace.group ?? '', workspace.color ?? ''],
          badges,
          active: workspace.id === state.activeWorkspaceId,
          rank: (workspace.id === state.activeWorkspaceId ? 4000 : 0)
            + (hasPendingAction ? 2500 : 0)
            + (inActiveGroup ? 400 : 0)
            + Math.floor(lastActivity / 1000),
          onSelect: () => workspaceStore.setActiveWorkspace(workspace.id),
        } satisfies CommandPaletteItem
      })
      .sort((a, b) => (b.rank ?? 0) - (a.rank ?? 0))

    items.push(...workspaceItems)

    const dispatchWorkspaceTab = (tab: 'terminal' | 'files' | 'git' | 'github') => {
      window.dispatchEvent(new CustomEvent('workspace-switch-tab', { detail: { tab } }))
    }

    if (activeWorkspace) {
      items.push(
        {
          id: 'view:terminal',
          title: t('commandPalette.actions.showTerminal'),
          subtitle: activeWorkspace.alias || activeWorkspace.name,
          section: 'views',
          keywords: ['terminal session shell tab'],
          rank: 900,
          onSelect: () => dispatchWorkspaceTab('terminal'),
        },
        {
          id: 'view:files',
          title: t('commandPalette.actions.showFiles'),
          subtitle: activeWorkspace.alias || activeWorkspace.name,
          section: 'views',
          keywords: ['files explorer tree tab'],
          rank: 890,
          onSelect: () => dispatchWorkspaceTab('files'),
        },
        {
          id: 'view:git',
          title: t('commandPalette.actions.showGit'),
          subtitle: activeWorkspace.alias || activeWorkspace.name,
          section: 'views',
          keywords: ['git changes history tab'],
          rank: 880,
          onSelect: () => dispatchWorkspaceTab('git'),
        },
        {
          id: 'view:github',
          title: t('commandPalette.actions.showGitHub'),
          subtitle: activeWorkspace.alias || activeWorkspace.name,
          section: 'views',
          keywords: ['github pull requests issues tab'],
          rank: 870,
          onSelect: () => dispatchWorkspaceTab('github'),
        }
      )
    }

    items.push(
      {
        id: 'panel:sidebar',
        title: panelSettings.sidebar.collapsed ? t('commandPalette.actions.expandSidebar') : t('commandPalette.actions.collapseSidebar'),
        subtitle: t('commandPalette.actions.toggleSidebarHint'),
        section: 'panels',
        keywords: ['sidebar workspace rail left toggle collapse expand'],
        badges: panelSettings.sidebar.collapsed ? [t('commandPalette.badges.hidden')] : [t('commandPalette.badges.visible')],
        active: !panelSettings.sidebar.collapsed,
        rank: 820,
        onSelect: handleSidebarCollapse,
      },
      {
        id: 'panel:utility',
        title: panelSettings.snippetSidebar.collapsed ? t('commandPalette.actions.showUtilityPanel') : t('commandPalette.actions.hideUtilityPanel'),
        subtitle: t('commandPalette.actions.toggleUtilityPanelHint'),
        section: 'panels',
        keywords: ['right panel snippets skills agents toggle'],
        badges: panelSettings.snippetSidebar.collapsed ? [t('commandPalette.badges.hidden')] : [t('commandPalette.badges.visible')],
        active: !panelSettings.snippetSidebar.collapsed,
        rank: 810,
        onSelect: handleSnippetPanelToggle,
      },
      {
        id: 'panel:snippets',
        title: t('commandPalette.actions.openSnippetsPanel'),
        subtitle: t('commandPalette.actions.openSnippetsPanelHint'),
        section: 'panels',
        keywords: ['snippets clipboard templates right panel'],
        rank: 800,
        onSelect: () => handleRightPanelTabChange('snippets'),
      }
    )

    if (isClaudeFocused) {
      items.push(
        {
          id: 'panel:skills',
          title: t('commandPalette.actions.openSkillsPanel'),
          subtitle: t('commandPalette.actions.openSkillsPanelHint'),
          section: 'panels',
          keywords: ['skills claude tools right panel'],
          rank: 790,
          onSelect: () => handleRightPanelTabChange('skills'),
        },
        {
          id: 'panel:agents',
          title: t('commandPalette.actions.openAgentsPanel'),
          subtitle: t('commandPalette.actions.openAgentsPanelHint'),
          section: 'panels',
          keywords: ['agents claude tasks right panel'],
          rank: 780,
          onSelect: () => handleRightPanelTabChange('agents'),
        }
      )
    }

    items.push(
      {
        id: 'app:add-workspace',
        title: t('commandPalette.actions.openWorkspace'),
        subtitle: t('commandPalette.actions.openWorkspaceHint'),
        section: 'app',
        keywords: ['add workspace open folder project directory'],
        rank: 760,
        onSelect: handleAddWorkspace,
      },
      {
        id: 'app:profiles',
        title: t('commandPalette.actions.openProfiles'),
        subtitle: t('commandPalette.actions.openProfilesHint'),
        section: 'app',
        keywords: ['profiles switch account window'],
        rank: 750,
        onSelect: () => setShowProfiles(true),
      },
      {
        id: 'app:settings',
        title: t('commandPalette.actions.openSettings'),
        subtitle: t('commandPalette.actions.openSettingsHint'),
        section: 'app',
        keywords: ['settings preferences config options'],
        rank: 740,
        onSelect: () => setShowSettings(true),
      }
    )

    return items
  }, [
    activeWorkspace,
    detachedWorkspaceId,
    handleAddWorkspace,
    handleRightPanelTabChange,
    handleSidebarCollapse,
    handleSnippetPanelToggle,
    isClaudeFocused,
    paletteWorkspaces,
    panelSettings.sidebar.collapsed,
    panelSettings.snippetSidebar.collapsed,
    state.activeWorkspaceId,
    state.terminals,
    t,
  ])

  // Get the workspace for env dialog
  const envDialogWorkspace = envDialogWorkspaceId
    ? state.workspaces.find(w => w.id === envDialogWorkspaceId)
    : null

  // Detached window mode — render only that workspace, no sidebar
  if (detachedWorkspaceId) {
    const ws = state.workspaces.find(w => w.id === detachedWorkspaceId)
    if (!ws) {
      return (
        <div className="app">
          <main className="main-content">
            <div className="empty-state">
              <h2>{t('app.workspaceNotFound')}</h2>
              <p>{t('app.workspaceNotFoundDesc')}</p>
            </div>
          </main>
        </div>
      )
    }
    return (
      <div className="app">
        <main className="main-content" style={{ width: '100%' }}>
          <div className="workspace-container active">
            <WorkspaceView
              workspace={ws}
              terminals={workspaceStore.getWorkspaceTerminals(ws.id)}
              focusedTerminalId={state.focusedTerminalId}
              isActive={true}
              utilityPanelVisible={!panelSettings.snippetSidebar.collapsed}
              onToggleUtilityPanel={handleSnippetPanelToggle}
            />
          </div>
        </main>
        <CommandPalette
          isOpen={showCommandPalette}
          items={commandPaletteItems}
          onClose={closeCommandPalette}
        />
      </div>
    )
  }

  return (
    <div className="app">
      <div className="app-left-rail">
        <Sidebar
          width={panelSettings.sidebar.width}
          collapsed={panelSettings.sidebar.collapsed}
          workspaces={visibleWorkspaces}
          activeWorkspaceId={state.activeWorkspaceId}
          windowId={workspaceStore.getWindowId()}
          groups={workspaceStore.getGroups()}
          activeGroup={workspaceStore.getActiveGroup()}
          onSetActiveGroup={(group) => workspaceStore.setActiveGroup(group)}
          onSetWorkspaceGroup={(id, group) => workspaceStore.setWorkspaceGroup(id, group)}
          onSelectWorkspace={(id) => workspaceStore.setActiveWorkspace(id)}
          onAddWorkspace={handleAddWorkspace}
          onRemoveWorkspace={(id) => {
            workspaceStore.removeWorkspace(id)
            workspaceStore.save()
          }}
          onRenameWorkspace={(id, alias) => {
            workspaceStore.renameWorkspace(id, alias)
            workspaceStore.save()
          }}
          onReorderWorkspaces={(workspaceIds) => {
            workspaceStore.reorderWorkspaces(workspaceIds)
          }}
          onOpenEnvVars={(workspaceId) => setEnvDialogWorkspaceId(workspaceId)}
          onDetachWorkspace={handleDetachWorkspace}
          activeProfileName={activeProfileName}
          isRemoteConnected={isRemoteConnected}
          onOpenProfiles={() => setShowProfiles(true)}
          onOpenSettings={() => setShowSettings(true)}
        />
        {!panelSettings.sidebar.collapsed && (
          <ResizeHandle
            direction="horizontal"
            onResize={handleSidebarResize}
            onDoubleClick={handleSidebarResetWidth}
          />
        )}
        <button
          className={`sidebar-edge-toggle${panelSettings.sidebar.collapsed ? ' collapsed' : ''}`}
          onClick={handleSidebarCollapse}
          title={panelSettings.sidebar.collapsed ? t('sidebar.expandSidebar') : t('sidebar.collapseSidebar')}
          aria-label={panelSettings.sidebar.collapsed ? t('sidebar.expandSidebar') : t('sidebar.collapseSidebar')}
        >
          {panelSettings.sidebar.collapsed ? '»' : '«'}
        </button>
      </div>
      <main className="main-content">
        {visibleWorkspaces.length > 0 ? (
          // Only mount workspaces that have been visited (lazy mount)
          visibleWorkspaces.filter(w => mountedWorkspaces.has(w.id)).map(workspace => (
            <div
              key={workspace.id}
              className={`workspace-container ${workspace.id === state.activeWorkspaceId ? 'active' : 'hidden'}`}
            >
              <WorkspaceView
                workspace={workspace}
                terminals={workspaceStore.getWorkspaceTerminals(workspace.id)}
                focusedTerminalId={workspace.id === state.activeWorkspaceId ? state.focusedTerminalId : null}
                isActive={workspace.id === state.activeWorkspaceId}
                utilityPanelVisible={!panelSettings.snippetSidebar.collapsed}
                onToggleUtilityPanel={handleSnippetPanelToggle}
              />
            </div>
          ))
        ) : (
          <div className="empty-state">
            <h2>{t('app.welcome')}</h2>
            <p>{t('app.welcomeHint')}</p>
          </div>
        )}
      </main>
      {/* Resize handle for snippet sidebar */}
      {showSnippetSidebar && !panelSettings.snippetSidebar.collapsed && (
        <ResizeHandle
          direction="horizontal"
          onResize={handleSnippetResize}
          onDoubleClick={handleSnippetResetWidth}
        />
      )}
      {/* Right sidebar: tabbed Snippets / Skills (Skills only for Claude Code terminals) */}
      {(() => {
        const focusedTerminal = state.focusedTerminalId ? state.terminals.find(t2 => t2.id === state.focusedTerminalId) : null
        const isClaudeCode = focusedTerminal?.agentPreset === 'claude-code' || focusedTerminal?.agentPreset === 'claude-code-v2'
        const effectiveTab = isClaudeCode ? rightPanelTab : 'snippets'

        if (!showSnippetSidebar) return null

        if (panelSettings.snippetSidebar.collapsed) return null

        // Markdown preview mode: takes over the entire right panel
        if (previewMarkdownPath) {
          return (
            <div className="right-sidebar-wrapper" style={{ width: `${panelSettings.snippetSidebar.width}px`, minWidth: `${panelSettings.snippetSidebar.width}px`, display: 'flex', flexDirection: 'column' }}>
              <MarkdownPreviewPanel
                filePath={previewMarkdownPath}
                onClose={() => {
                  setPreviewMarkdownPath(null)
                  // Restore panel collapsed state from before the preview opened
                  if (previewPrevCollapsed.current !== null) {
                    const wasCollapsed = previewPrevCollapsed.current
                    previewPrevCollapsed.current = null
                    if (wasCollapsed) {
                      setPanelSettings(prev => {
                        const updated = { ...prev, snippetSidebar: { ...prev.snippetSidebar, collapsed: true } }
                        savePanelSettings(updated)
                        return updated
                      })
                    }
                  }
                }}
              />
            </div>
          )
        }

        return (
          <div className="right-sidebar-wrapper" style={{ width: `${panelSettings.snippetSidebar.width}px`, minWidth: `${panelSettings.snippetSidebar.width}px`, display: 'flex', flexDirection: 'column' }}>
            <div className="right-sidebar-tabs">
              <button className={`right-sidebar-tab${effectiveTab === 'snippets' ? ' active' : ''}`} onClick={() => handleRightPanelTabChange('snippets')}>
                {t('snippets.title')}
              </button>
              {isClaudeCode && (
                <>
                  <button className={`right-sidebar-tab${effectiveTab === 'skills' ? ' active' : ''}`} onClick={() => handleRightPanelTabChange('skills')}>
                    {t('skills.title')}
                  </button>
                  <button className={`right-sidebar-tab${effectiveTab === 'agents' ? ' active' : ''}`} onClick={() => handleRightPanelTabChange('agents')}>
                    {t('agents.title')}
                  </button>
                </>
              )}
              <button className="right-sidebar-collapse" onClick={handleSnippetCollapse} title={t('snippets.collapsePanel')}>&raquo;</button>
            </div>
            <div style={{ flex: 1, overflow: 'hidden' }}>
              {effectiveTab === 'skills' ? (
                <SkillsPanel
                  isVisible={true}
                  width={panelSettings.snippetSidebar.width}
                  collapsed={false}
                  onCollapse={handleSnippetCollapse}
                  activeCwd={state.activeWorkspaceId ? state.workspaces.find(w => w.id === state.activeWorkspaceId)?.folderPath ?? null : null}
                  activeSessionId={state.focusedTerminalId ?? null}
                />
              ) : effectiveTab === 'agents' ? (
                <AgentsPanel
                  isVisible={true}
                  activeSessionId={state.focusedTerminalId ?? null}
                />
              ) : (
                <SnippetSidebar
                  isVisible={true}
                  width={panelSettings.snippetSidebar.width}
                  collapsed={false}
                  workspaceId={state.activeWorkspaceId ?? undefined}
                  onCollapse={handleSnippetCollapse}
                  onPasteToTerminal={handlePasteToTerminal}
                  onSendToAgent={handleSendToAgent}
                />
              )}
            </div>
          </div>
        )
      })()}
      {showSettings && (
        <SettingsPanel onClose={() => setShowSettings(false)} />
      )}
      {folderPickerOpen && (
        <FolderPicker
          initialPath={folderPickerInitialPath}
          multiSelect
          onSelect={handleFolderPickerSelect}
          onClose={() => setFolderPickerOpen(false)}
        />
      )}
      {showProfiles && (
        <ProfilePanel
          onClose={() => setShowProfiles(false)}
          onSwitchNewWindow={handleProfileNewWindow}
          onProfileRenamed={async (profileId, newName) => {
            const wpId = await window.electronAPI.app.getWindowProfile()
            if (wpId === profileId) {
              const winIdx = await window.electronAPI.app.getWindowIndex()
              setActiveProfileName(`${newName}:${winIdx}`)
            }
          }}
        />
      )}
      {envDialogWorkspace && (
        <WorkspaceEnvDialog
          workspace={envDialogWorkspace}
          onAdd={(envVar: EnvVariable) => workspaceStore.addWorkspaceEnvVar(envDialogWorkspaceId!, envVar)}
          onRemove={(key: string) => workspaceStore.removeWorkspaceEnvVar(envDialogWorkspaceId!, key)}
          onUpdate={(key: string, updates: Partial<EnvVariable>) => workspaceStore.updateWorkspaceEnvVar(envDialogWorkspaceId!, key, updates)}
          onClose={() => setEnvDialogWorkspaceId(null)}
        />
      )}
      {appNotification && (
        <div className="app-notification-overlay" onClick={() => setAppNotification(null)}>
          <div className="app-notification" onClick={e => e.stopPropagation()}>
            <div className="app-notification-message">{appNotification}</div>
            <button className="app-notification-close" onClick={() => setAppNotification(null)}>{t('common.ok')}</button>
          </div>
        </div>
      )}
      <CommandPalette
        isOpen={showCommandPalette}
        items={commandPaletteItems}
        onClose={closeCommandPalette}
      />
    </div>
  )
}
