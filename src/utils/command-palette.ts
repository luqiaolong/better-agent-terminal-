export type CommandPaletteSection = 'workspaces' | 'views' | 'panels' | 'app'

export interface CommandPaletteItem {
  id: string
  title: string
  subtitle?: string
  section: CommandPaletteSection
  keywords?: string[]
  badges?: string[]
  active?: boolean
  rank?: number
  onSelect: () => void
}

export interface CommandPaletteSectionGroup {
  id: CommandPaletteSection
  label: string
  items: CommandPaletteItem[]
}

const SECTION_ORDER: CommandPaletteSection[] = ['workspaces', 'views', 'panels', 'app']

const SECTION_LABELS: Record<CommandPaletteSection, string> = {
  workspaces: 'Workspaces',
  views: 'Views',
  panels: 'Panels',
  app: 'Actions',
}

function normalize(value: string): string {
  return value.trim().toLowerCase()
}

function buildSearchText(item: CommandPaletteItem): string {
  return normalize([
    item.title,
    item.subtitle,
    ...(item.badges ?? []),
    ...(item.keywords ?? []),
  ].filter(Boolean).join(' '))
}

function getQueryScore(item: CommandPaletteItem, query: string): number {
  if (!query) {
    return item.rank ?? 0
  }

  const haystack = buildSearchText(item)
  const tokens = query.split(/\s+/).map(normalize).filter(Boolean)
  if (tokens.length === 0) {
    return item.rank ?? 0
  }

  let score = item.rank ?? 0
  for (const token of tokens) {
    const index = haystack.indexOf(token)
    if (index === -1) {
      return Number.NEGATIVE_INFINITY
    }

    score += 40
    if (index === 0) score += 80
    if (haystack.startsWith(token)) score += 40
    score += Math.max(0, 30 - index)
  }

  if (normalize(item.title) === query) score += 120
  if (normalize(item.title).startsWith(query)) score += 60
  if (item.active) score += 8
  return score
}

export function groupCommandPaletteItems(
  items: CommandPaletteItem[],
  query: string
): CommandPaletteSectionGroup[] {
  const normalizedQuery = normalize(query)

  const ranked = items
    .map(item => ({ item, score: getQueryScore(item, normalizedQuery) }))
    .filter(entry => entry.score > Number.NEGATIVE_INFINITY)
    .sort((a, b) => {
      if (b.score !== a.score) return b.score - a.score
      if ((b.item.active ? 1 : 0) !== (a.item.active ? 1 : 0)) {
        return (b.item.active ? 1 : 0) - (a.item.active ? 1 : 0)
      }
      return a.item.title.localeCompare(b.item.title)
    })

  const grouped = new Map<CommandPaletteSection, CommandPaletteItem[]>()
  for (const section of SECTION_ORDER) {
    grouped.set(section, [])
  }

  for (const entry of ranked) {
    grouped.get(entry.item.section)?.push(entry.item)
  }

  return SECTION_ORDER
    .map(section => ({
      id: section,
      label: SECTION_LABELS[section],
      items: grouped.get(section) ?? [],
    }))
    .filter(group => group.items.length > 0)
}
