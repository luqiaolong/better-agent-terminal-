import { useEffect, useMemo, useRef, useState } from 'react'
import type { KeyboardEvent as ReactKeyboardEvent } from 'react'
import { useTranslation } from 'react-i18next'
import type { CommandPaletteItem } from '../utils/command-palette'
import { groupCommandPaletteItems } from '../utils/command-palette'
import '../styles/command-palette.css'

interface CommandPaletteProps {
  isOpen: boolean
  items: CommandPaletteItem[]
  onClose: (restoreFocus?: boolean) => void
}

export function CommandPalette({ isOpen, items, onClose }: Readonly<CommandPaletteProps>) {
  const { t } = useTranslation()
  const [query, setQuery] = useState('')
  const [selectedIndex, setSelectedIndex] = useState(0)
  const inputRef = useRef<HTMLInputElement>(null)
  const itemRefs = useRef<Array<HTMLButtonElement | null>>([])

  const groups = useMemo(() => groupCommandPaletteItems(items, query), [items, query])
  const flatItems = useMemo(() => groups.flatMap(group => group.items), [groups])

  useEffect(() => {
    if (!isOpen) return
    setQuery('')
    setSelectedIndex(0)
    requestAnimationFrame(() => inputRef.current?.focus())
  }, [isOpen])

  useEffect(() => {
    itemRefs.current = itemRefs.current.slice(0, flatItems.length)
    if (selectedIndex >= flatItems.length) {
      setSelectedIndex(flatItems.length > 0 ? flatItems.length - 1 : 0)
    }
  }, [flatItems, selectedIndex])

  useEffect(() => {
    if (!isOpen) return
    const node = itemRefs.current[selectedIndex]
    node?.scrollIntoView({ block: 'nearest' })
  }, [isOpen, selectedIndex])

  if (!isOpen) return null

  const handleSelect = (item: CommandPaletteItem) => {
    item.onSelect()
    onClose(false)
  }

  const handleKeyDown = (e: ReactKeyboardEvent<HTMLDivElement>) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault()
      e.stopPropagation()
      if (flatItems.length === 0) return
      setSelectedIndex(prev => (prev + 1) % flatItems.length)
      return
    }

    if (e.key === 'ArrowUp') {
      e.preventDefault()
      e.stopPropagation()
      if (flatItems.length === 0) return
      setSelectedIndex(prev => (prev - 1 + flatItems.length) % flatItems.length)
      return
    }

    if (e.key === 'Enter') {
      e.preventDefault()
      e.stopPropagation()
      const item = flatItems[selectedIndex]
      if (item) handleSelect(item)
      return
    }

    if (e.key === 'Escape') {
      e.preventDefault()
      e.stopPropagation()
      onClose()
    }
  }

  let itemIndex = -1

  return (
    <div className="command-palette-overlay" onClick={() => onClose()}>
      <div className="command-palette" onClick={e => e.stopPropagation()} onKeyDown={handleKeyDown}>
        <div className="command-palette-header">
          <input
            ref={inputRef}
            value={query}
            onChange={e => setQuery(e.target.value)}
            className="command-palette-input"
            placeholder={t('commandPalette.searchPlaceholder')}
            spellCheck={false}
          />
          <div className="command-palette-hint">{t('commandPalette.hint')}</div>
        </div>
        <div className="command-palette-results">
          {flatItems.length === 0 ? (
            <div className="command-palette-empty">{t('commandPalette.empty')}</div>
          ) : (
            groups.map(group => (
              <div key={group.id} className="command-palette-section">
                <div className="command-palette-section-title">{t(`commandPalette.sections.${group.id}`)}</div>
                {group.items.map(item => {
                  itemIndex += 1
                  const currentIndex = itemIndex
                  const isSelected = currentIndex === selectedIndex
                  return (
                    <button
                      key={item.id}
                      ref={node => {
                        itemRefs.current[currentIndex] = node
                      }}
                      type="button"
                      className={`command-palette-item${item.active ? ' active' : ''}${isSelected ? ' selected' : ''}`}
                      onClick={() => handleSelect(item)}
                      onMouseEnter={() => setSelectedIndex(currentIndex)}
                    >
                      <div className="command-palette-item-main">
                        <div className="command-palette-item-title-row">
                          <span className="command-palette-item-title">{item.title}</span>
                          {!!item.badges?.length && (
                            <div className="command-palette-badges">
                              {item.badges.map(badge => (
                                <span
                                  key={badge}
                                  className={`command-palette-badge${badge === 'Current' ? ' active' : ''}`}
                                >
                                  {badge}
                                </span>
                              ))}
                            </div>
                          )}
                        </div>
                        {item.subtitle && (
                          <div className="command-palette-item-subtitle">{item.subtitle}</div>
                        )}
                      </div>
                    </button>
                  )
                })}
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  )
}
