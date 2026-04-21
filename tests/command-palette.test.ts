import { groupCommandPaletteItems, type CommandPaletteItem } from '../src/utils/command-palette'

function test(name: string, fn: () => void) {
  try {
    fn()
    console.log(`PASS ${name}`)
  } catch (error) {
    console.error(`FAIL ${name}`)
    throw error
  }
}

function assert(condition: boolean, label: string) {
  if (!condition) {
    throw new Error(label)
  }
}

const items: CommandPaletteItem[] = [
  {
    id: 'workspace:current',
    title: 'alpha',
    subtitle: 'D:/repo/alpha',
    section: 'workspaces',
    badges: ['Current'],
    active: true,
    rank: 500,
    onSelect: () => {}
  },
  {
    id: 'workspace:other',
    title: 'beta',
    subtitle: 'D:/repo/beta',
    section: 'workspaces',
    rank: 100,
    onSelect: () => {}
  },
  {
    id: 'action:settings',
    title: 'Open Settings',
    subtitle: 'Adjust preferences',
    section: 'app',
    keywords: ['settings preferences'],
    rank: 200,
    onSelect: () => {}
  }
]

test('groupCommandPaletteItems keeps sections with ranked items in order', () => {
  const groups = groupCommandPaletteItems(items, '')
  assert(groups.length === 2, 'expected two populated sections')
  assert(groups[0].id === 'workspaces', 'expected workspaces section first')
  assert(groups[1].id === 'app', 'expected app section second')
  assert(groups[0].items[0].id === 'workspace:current', 'expected current workspace to rank first')
})

test('groupCommandPaletteItems filters by title and keywords', () => {
  const groups = groupCommandPaletteItems(items, 'settings')
  assert(groups.length === 1, 'expected only matching section')
  assert(groups[0].items[0].id === 'action:settings', 'expected settings action match')
})

test('groupCommandPaletteItems requires all query tokens to match', () => {
  const groups = groupCommandPaletteItems(items, 'alpha missing')
  assert(groups.length === 0, 'expected no results when any token is missing')
})
