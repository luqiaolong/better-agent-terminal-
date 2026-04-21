import { absPathToFileUrl, getParentDir, parseFileUrlToPath, resolveRelativePath } from '../src/utils/markdown-paths'

function test(name: string, fn: () => void) {
  try {
    fn()
    console.log(`PASS ${name}`)
  } catch (error) {
    console.error(`FAIL ${name}`)
    throw error
  }
}

function assertEqual(actual: unknown, expected: unknown, label: string) {
  if (actual !== expected) {
    throw new Error(`${label}: expected ${String(expected)}, got ${String(actual)}`)
  }
}

test('absPathToFileUrl preserves windows drive paths', () => {
  assertEqual(
    absPathToFileUrl('D:\\repo\\docs\\guide.md'),
    'file:///D:/repo/docs/guide.md',
    'windows path to file URL'
  )
})

test('resolveRelativePath handles sibling traversal', () => {
  assertEqual(
    resolveRelativePath('D:/repo/docs/reference', '../guide.md'),
    'D:/repo/docs/guide.md',
    'relative path resolution'
  )
})

test('parseFileUrlToPath round-trips windows file URLs', () => {
  assertEqual(
    parseFileUrlToPath('file:///D:/repo/docs/guide.md'),
    'D:/repo/docs/guide.md',
    'file URL to path'
  )
})

test('getParentDir strips filename from normalized paths', () => {
  assertEqual(
    getParentDir('D:\\repo\\docs\\guide.md'),
    'D:/repo/docs',
    'parent dir'
  )
})
