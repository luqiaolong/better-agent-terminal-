export function isAbsoluteFilePath(filePath: string): boolean {
  return filePath.startsWith('/') || /^[A-Za-z]:[\\/]/.test(filePath)
}

export function absPathToFileUrl(absPath: string): string {
  const normalized = absPath.replace(/\\/g, '/')
  const withLeading = /^[A-Za-z]:\//.test(normalized) ? `/${normalized}` : normalized
  return `file://${encodeURI(withLeading)}`
}

export function resolveRelativePath(baseDir: string, relativePath: string): string {
  const baseParts = baseDir.replace(/\\/g, '/').replace(/\/+$/, '').split('/')
  const relativeParts = relativePath.replace(/\\/g, '/').split('/')

  for (const part of relativeParts) {
    if (part === '' || part === '.') continue
    if (part === '..') {
      if (baseParts.length > 1) baseParts.pop()
      continue
    }
    baseParts.push(part)
  }

  return baseParts.join('/')
}

export function parseFileUrlToPath(fileUrl: string): string {
  let filePath = decodeURIComponent(new URL(fileUrl).pathname)
  if (/^\/[A-Za-z]:\//.test(filePath)) filePath = filePath.slice(1)
  return filePath
}

export function getParentDir(filePath: string): string {
  const normalized = filePath.replace(/\\/g, '/')
  const lastSlash = normalized.lastIndexOf('/')
  return lastSlash > 0 ? normalized.slice(0, lastSlash) : normalized
}
