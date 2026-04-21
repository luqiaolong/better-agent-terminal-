import { useState, useRef, useEffect, useCallback, useLayoutEffect } from 'react'
import { createPortal } from 'react-dom'
import { useTranslation } from 'react-i18next'
import type { TerminalInstance } from '../types'
import { TerminalThumbnail } from './TerminalThumbnail'
import type { AgentPreset } from '../types/agent-presets'

interface ThumbnailBarProps {
  terminals: TerminalInstance[]
  focusedTerminalId: string | null
  activeWorkspaceTab: 'terminal' | 'files' | 'git' | 'github'
  hasGithubRemote?: boolean
  utilityPanelVisible?: boolean
  onFocus: (id: string) => void
  onWorkspaceTabChange: (tab: 'terminal' | 'files' | 'git' | 'github') => void
  onToggleUtilityPanel?: () => void
  onAddTerminal?: () => void
  onAddWorktreeTerminal?: () => void
  onAddAgent?: (presetId: string) => void
  onAddWorker?: (procfilePath?: string) => void
  detectedProcfiles?: string[]
  agentPresets?: AgentPreset[]
  onReorder?: (orderedIds: string[]) => void
  onCloseTerminal?: (id: string) => void
}

export function ThumbnailBar({
  terminals,
  focusedTerminalId,
  activeWorkspaceTab,
  hasGithubRemote = false,
  utilityPanelVisible = false,
  onFocus,
  onWorkspaceTabChange,
  onToggleUtilityPanel,
  onAddTerminal,
  onAddWorktreeTerminal,
  onAddAgent,
  onAddWorker,
  detectedProcfiles = [],
  agentPresets = [],
  onReorder,
  onCloseTerminal
}: ThumbnailBarProps) {
  const { t } = useTranslation()
  const [draggedId, setDraggedId] = useState<string | null>(null)
  const [dropTargetId, setDropTargetId] = useState<string | null>(null)
  const [dropPosition, setDropPosition] = useState<'before' | 'after'>('before')
  const [showAddMenu, setShowAddMenu] = useState(false)
  const [menuStyle, setMenuStyle] = useState<React.CSSProperties>({})
  const [contextMenu, setContextMenu] = useState<{ x: number; y: number; terminalId: string } | null>(null)
  const [contextMenuPos, setContextMenuPos] = useState<{ x: number; y: number } | null>(null)
  const addMenuRef = useRef<HTMLDivElement>(null)
  const addMenuPopupRef = useRef<HTMLDivElement>(null)
  const addBtnRef = useRef<HTMLButtonElement>(null)
  const thumbnailListRef = useRef<HTMLDivElement>(null)
  const middlePanRef = useRef<{ startX: number; startScrollLeft: number } | null>(null)
  const contextMenuRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!showAddMenu) return
    const handleClick = (e: MouseEvent) => {
      const target = e.target as Node
      if (
        addMenuRef.current && !addMenuRef.current.contains(target) &&
        addMenuPopupRef.current && !addMenuPopupRef.current.contains(target)
      ) {
        setShowAddMenu(false)
      }
    }
    document.addEventListener('mousedown', handleClick)
    return () => document.removeEventListener('mousedown', handleClick)
  }, [showAddMenu])

  useEffect(() => {
    if (!contextMenu) return
    const handleClickOutside = (e: MouseEvent) => {
      if (contextMenuRef.current && !contextMenuRef.current.contains(e.target as Node)) {
        setContextMenu(null)
      }
    }
    document.addEventListener('mousedown', handleClickOutside)
    return () => document.removeEventListener('mousedown', handleClickOutside)
  }, [contextMenu])

  useLayoutEffect(() => {
    if (!contextMenu || !contextMenuRef.current) {
      setContextMenuPos(null)
      return
    }
    const rect = contextMenuRef.current.getBoundingClientRect()
    const vw = window.innerWidth
    const vh = window.innerHeight
    let { x, y } = contextMenu
    if (x + rect.width > vw) x = Math.max(4, vw - rect.width - 4)
    if (y + rect.height > vh) y = Math.max(4, vh - rect.height - 4)
    setContextMenuPos({ x, y })
  }, [contextMenu])

  useEffect(() => {
    const handleMouseMove = (e: MouseEvent) => {
      if (!middlePanRef.current) return
      const el = thumbnailListRef.current
      if (!el) return
      el.scrollLeft = middlePanRef.current.startScrollLeft - (e.clientX - middlePanRef.current.startX)
    }

    const handleMouseUp = (e: MouseEvent) => {
      if (e.button === 1) middlePanRef.current = null
    }

    document.addEventListener('mousemove', handleMouseMove)
    document.addEventListener('mouseup', handleMouseUp)
    return () => {
      document.removeEventListener('mousemove', handleMouseMove)
      document.removeEventListener('mouseup', handleMouseUp)
    }
  }, [])

  const handleDragStart = useCallback((e: React.DragEvent, id: string) => {
    setDraggedId(id)
    e.dataTransfer.effectAllowed = 'move'
    e.dataTransfer.setData('text/plain', id)
    if (e.currentTarget instanceof HTMLElement) {
      e.currentTarget.style.opacity = '0.4'
    }
  }, [])

  const handleDragEnd = useCallback((e: React.DragEvent) => {
    if (e.currentTarget instanceof HTMLElement) {
      e.currentTarget.style.opacity = '1'
    }
    setDraggedId(null)
    setDropTargetId(null)
  }, [])

  const handleDragOver = useCallback((e: React.DragEvent, id: string) => {
    if (!draggedId || id === draggedId) return
    e.preventDefault()
    e.dataTransfer.dropEffect = 'move'

    const rect = (e.currentTarget as HTMLElement).getBoundingClientRect()
    const midX = rect.left + rect.width / 2
    const pos = e.clientX < midX ? 'before' : 'after'

    setDropTargetId(id)
    setDropPosition(pos)
  }, [draggedId])

  const handleDragLeave = useCallback((e: React.DragEvent) => {
    const related = e.relatedTarget as HTMLElement | null
    if (!related || !(e.currentTarget as HTMLElement).contains(related)) {
      setDropTargetId(null)
    }
  }, [])

  const handleDrop = useCallback((e: React.DragEvent, targetId: string) => {
    e.preventDefault()
    if (!draggedId || draggedId === targetId || !onReorder) return

    const currentOrder = terminals.map(t => t.id)
    const draggedIndex = currentOrder.indexOf(draggedId)
    if (draggedIndex === -1) return

    currentOrder.splice(draggedIndex, 1)

    let newIndex = currentOrder.indexOf(targetId)
    if (dropPosition === 'after') {
      newIndex += 1
    }

    currentOrder.splice(newIndex, 0, draggedId)
    onReorder(currentOrder)

    setDraggedId(null)
    setDropTargetId(null)
  }, [draggedId, dropPosition, terminals, onReorder])

  const handleThumbnailContextMenu = useCallback((e: React.MouseEvent, terminalId: string) => {
    e.preventDefault()
    e.stopPropagation()
    setContextMenu({ x: e.clientX, y: e.clientY, terminalId })
  }, [])

  return (
    <div className="thumbnail-bar thumbnail-tab-bar" aria-label={t('terminal.workspaceSessions')}>
      <div
        className="thumbnail-list"
        ref={thumbnailListRef}
        onWheel={(e) => {
          const el = thumbnailListRef.current
          if (!el || el.scrollWidth <= el.clientWidth) return
          const delta = Math.abs(e.deltaX) > Math.abs(e.deltaY) ? e.deltaX : e.deltaY
          if (delta === 0) return
          e.preventDefault()
          el.scrollLeft += delta
        }}
        onMouseDown={(e) => {
          if (e.button === 1) {
            e.preventDefault()
            const el = thumbnailListRef.current
            if (el) middlePanRef.current = { startX: e.clientX, startScrollLeft: el.scrollLeft }
          }
        }}
        onMouseMove={(e) => {
          if (!middlePanRef.current) return
          e.preventDefault()
        }}
        onMouseUp={(e) => {
          if (e.button === 1) middlePanRef.current = null
        }}
      >
        {terminals.map(terminal => (
          <div
            key={terminal.id}
            draggable={!!onReorder}
            onDragStart={(e) => handleDragStart(e, terminal.id)}
            onDragEnd={handleDragEnd}
            onDragOver={(e) => handleDragOver(e, terminal.id)}
            onDragLeave={handleDragLeave}
            onDrop={(e) => handleDrop(e, terminal.id)}
            className={`thumbnail-drag-wrapper${
              dropTargetId === terminal.id && draggedId !== terminal.id
                ? ` drop-${dropPosition}`
                : ''
            }${draggedId === terminal.id ? ' dragging' : ''}`}
            onContextMenu={(e) => handleThumbnailContextMenu(e, terminal.id)}
          >
            <TerminalThumbnail
              terminal={terminal}
              isActive={terminal.id === focusedTerminalId}
              onClick={() => onFocus(terminal.id)}
              onClose={onCloseTerminal ? () => onCloseTerminal(terminal.id) : undefined}
            />
          </div>
        ))}
        {onAddTerminal && (
          <div className="thumbnail-list-add" ref={addMenuRef}>
            <button
              ref={addBtnRef}
              className="thumbnail-toolbar-btn thumbnail-tab-inline-add"
              onClick={() => {
                setShowAddMenu(prev => {
                  if (!prev && addBtnRef.current) {
                    const rect = addBtnRef.current.getBoundingClientRect()
                    const menuHeight = 240
                    const spaceBelow = window.innerHeight - rect.bottom
                    const openUpward = spaceBelow < menuHeight && rect.top > menuHeight
                    setMenuStyle(openUpward
                      ? { bottom: window.innerHeight - rect.top + 4, right: window.innerWidth - rect.right }
                      : { top: rect.bottom + 4, right: window.innerWidth - rect.right }
                    )
                  }
                  return !prev
                })
              }}
              title={t('terminal.addTerminalOrAgent')}
              aria-label={t('terminal.addTerminalOrAgent')}
            >
              +
            </button>
          </div>
        )}
      </div>

      <div className="thumbnail-tab-trailing">
        <div className="thumbnail-workspace-tabs">
          <button className={`thumbnail-workspace-tab${activeWorkspaceTab === 'terminal' ? ' active' : ''}`} onClick={() => onWorkspaceTabChange('terminal')}>
            {t('workspace.terminal')}
          </button>
          <button className={`thumbnail-workspace-tab${activeWorkspaceTab === 'files' ? ' active' : ''}`} onClick={() => onWorkspaceTabChange('files')}>
            {t('workspace.files')}
          </button>
          <button className={`thumbnail-workspace-tab${activeWorkspaceTab === 'git' ? ' active' : ''}`} onClick={() => onWorkspaceTabChange('git')}>
            {t('workspace.git')}
          </button>
          {hasGithubRemote && (
            <button className={`thumbnail-workspace-tab${activeWorkspaceTab === 'github' ? ' active' : ''}`} onClick={() => onWorkspaceTabChange('github')}>
              {t('workspace.github')}
            </button>
          )}
        </div>

        <div className="thumbnail-tab-actions">
          {onToggleUtilityPanel && (
            <button
              className={`thumbnail-toolbar-btn${utilityPanelVisible ? ' active' : ''}`}
              onClick={onToggleUtilityPanel}
              title={utilityPanelVisible ? t('commandPalette.actions.hideUtilityPanel') : t('commandPalette.actions.showUtilityPanel')}
              aria-label={utilityPanelVisible ? t('commandPalette.actions.hideUtilityPanel') : t('commandPalette.actions.showUtilityPanel')}
            >
              ≡
            </button>
          )}

          {showAddMenu && createPortal(
            <div className="thumbnail-add-menu" ref={addMenuPopupRef} style={menuStyle}>
              <div
                className="thumbnail-add-menu-item"
                onClick={() => { onAddTerminal(); setShowAddMenu(false) }}
              >
                <span className="thumbnail-add-menu-icon">⌘</span>
                {t('terminal.terminalLabel')}
              </div>
              {onAddWorktreeTerminal && (
                <div
                  className="thumbnail-add-menu-item"
                  onClick={() => { onAddWorktreeTerminal(); setShowAddMenu(false) }}
                >
                  <span className="thumbnail-add-menu-icon" style={{ color: '#22c55e' }}>🌳</span>
                  {t('terminal.worktreeTerminalLabel')}
                </div>
              )}
              {agentPresets.map(preset => (
                <div
                  key={preset.id}
                  className="thumbnail-add-menu-item"
                  onClick={() => { onAddAgent?.(preset.id); setShowAddMenu(false) }}
                >
                  <span className="thumbnail-add-menu-icon" style={{ color: preset.color }}>{preset.icon}</span>
                  {preset.name}
                  {preset.suggested && <span className="thumbnail-add-menu-suggested">suggested</span>}
                </div>
              ))}
              {onAddWorker && (
                <>
                  <div className="thumbnail-add-menu-separator" />
                  {detectedProcfiles.map(fp => (
                    <div
                      key={fp}
                      className="thumbnail-add-menu-item"
                      onClick={() => { onAddWorker(fp); setShowAddMenu(false) }}
                    >
                      <span className="thumbnail-add-menu-icon" style={{ color: '#56b6c2' }}>⚙</span>
                      Worker: {fp.split('/').pop()}
                    </div>
                  ))}
                  <div
                    className="thumbnail-add-menu-item"
                    onClick={() => { onAddWorker(); setShowAddMenu(false) }}
                  >
                    <span className="thumbnail-add-menu-icon" style={{ color: '#888' }}>📂</span>
                    Worker: Open File...
                  </div>
                  <div
                    className="thumbnail-add-menu-hint"
                    onClick={() => window.electronAPI.shell.openExternal('https://github.com/DarthSim/overmind')}
                  >
                    What is a Procfile?
                  </div>
                </>
              )}
            </div>,
            document.body
          )}
        </div>
      </div>

      {contextMenu && onCloseTerminal && createPortal(
        <div
          ref={contextMenuRef}
          className="workspace-context-menu"
          style={contextMenuPos
            ? { left: contextMenuPos.x, top: contextMenuPos.y }
            : { left: contextMenu.x, top: contextMenu.y, visibility: 'hidden' as const }
          }
        >
          <div
            className="context-menu-item danger"
            onClick={() => {
              onCloseTerminal(contextMenu.terminalId)
              setContextMenu(null)
            }}
          >
            {t('terminal.closeTerminal')}
          </div>
        </div>,
        document.body
      )}
    </div>
  )
}
