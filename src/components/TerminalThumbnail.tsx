import { memo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import type { TerminalInstance } from '../types'
import { ActivityIndicator } from './ActivityIndicator'
import { getAgentPreset } from '../types/agent-presets'
import { workspaceStore } from '../stores/workspace-store'

export function clearPreviewCache(_terminalId: string) {
  // Preview thumbnails were replaced by compact top tabs.
}

interface TerminalThumbnailProps {
  terminal: TerminalInstance
  isActive: boolean
  onClick: () => void
  onClose?: () => void
}

export const TerminalThumbnail = memo(function TerminalThumbnail({
  terminal,
  isActive,
  onClick,
  onClose
}: TerminalThumbnailProps) {
  const { t } = useTranslation()
  const [isEditing, setIsEditing] = useState(false)
  const [editValue, setEditValue] = useState(terminal.alias || terminal.title)
  const isAgent = terminal.agentPreset && terminal.agentPreset !== 'none'
  const agentConfig = isAgent ? getAgentPreset(terminal.agentPreset!) : null
  const isWorktreeTerminal = !isAgent && !!terminal.worktreePath
  const displayTitle = terminal.alias || terminal.title

  const handleSave = () => {
    const nextTitle = editValue.trim()
    if (nextTitle) {
      workspaceStore.renameTerminal(terminal.id, nextTitle)
    }
    setIsEditing(false)
  }

  return (
    <div
      className={`thumbnail ${isActive ? 'active' : ''} ${isAgent ? 'agent-terminal' : ''}`}
      onClick={onClick}
      onDoubleClick={() => {
        setEditValue(displayTitle)
        setIsEditing(true)
      }}
      title={terminal.title}
      style={agentConfig ? { '--agent-color': agentConfig.color } as React.CSSProperties : undefined}
    >
      <div className="thumbnail-header">
        <div className={`thumbnail-title ${isAgent ? 'agent-terminal' : ''}`}>
          {isAgent && <span className="thumbnail-leading-icon">{agentConfig?.icon}</span>}
          {isWorktreeTerminal && <span className="thumbnail-leading-icon">🌳</span>}
          {isEditing ? (
            <input
              type="text"
              className="thumbnail-name-input"
              value={editValue}
              onChange={(e) => setEditValue(e.target.value)}
              onBlur={handleSave}
              onClick={(e) => e.stopPropagation()}
              onDoubleClick={(e) => e.stopPropagation()}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  handleSave()
                } else if (e.key === 'Escape') {
                  setIsEditing(false)
                }
              }}
              autoFocus
            />
          ) : (
            <span className="thumbnail-title-text" title={terminal.alias ? terminal.title : t('terminal.doubleClickToRename')}>
              {displayTitle}
            </span>
          )}
        </div>
        <div className="thumbnail-meta">
          <ActivityIndicator terminalId={terminal.id} size="small" />
          {onClose && (
            <button
              className="thumbnail-close-btn"
              onClick={(e) => {
                e.stopPropagation()
                onClose()
              }}
              title={t('terminal.closeTerminal')}
              aria-label={t('terminal.closeTerminal')}
            >
              ×
            </button>
          )}
        </div>
      </div>
    </div>
  )
})
