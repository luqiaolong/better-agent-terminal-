import { marked } from 'marked'
import DOMPurify from 'dompurify'
import { absPathToFileUrl, isAbsoluteFilePath, parseFileUrlToPath, resolveRelativePath } from './markdown-paths'

const markdownCache = new Map<string, string>()
const MARKDOWN_CACHE_MAX = 500

export function renderChatMarkdown(text: string, cwd: string): string {
  const cacheKey = cwd + '\0' + text
  const cached = markdownCache.get(cacheKey)
  if (cached !== undefined) return cached
  const processed = text.replace(
    /(`{1,3}[\s\S]*?`{1,3})|(file:\/\/\/[^\s<>)\]`'"]+)/g,
    (match, codeBlock, fileUrl, offset, str) => {
      if (codeBlock) return match
      if (!fileUrl) return match
      const before = str.slice(Math.max(0, offset - 2), offset)
      if (before === '](' || before.endsWith('(')) return match
      return `[${fileUrl}](${fileUrl})`
    }
  )
  const parsedHtml = marked.parse(processed) as string
  const rawHtml = cwd
    ? parsedHtml.replace(
        /<a\s+([^>]*?)href="([^"#][^"]*)"/gi,
        (match, attrs, href) => {
          if (/^(?:https?|mailto|tel|file):/i.test(href)) return match
          const absPath = isAbsoluteFilePath(href) ? href : resolveRelativePath(cwd, href)
          return `<a ${attrs}href="${absPathToFileUrl(absPath)}"`
        }
      )
    : parsedHtml
  const masked: string[] = []
  const placeheld = rawHtml.replace(/<(pre|code)\b[\s\S]*?<\/\1>/gi, m => {
    masked.push(m)
    return `\x00MD${masked.length - 1}\x00`
  })
  const collapsed = placeheld.replace(/>\s+</g, '><')
  const cleanHtml = collapsed.replace(/\x00MD(\d+)\x00/g, (_, i) => masked[Number(i)])
  const result = DOMPurify.sanitize(cleanHtml, {
    ADD_TAGS: ['input'],
    ADD_ATTR: ['checked', 'disabled', 'type', 'data-external-link'],
    ALLOWED_URI_REGEXP: /^(?:https?|mailto|tel|file):/i,
  })
  if (markdownCache.size >= MARKDOWN_CACHE_MAX) {
    const oldestKey = markdownCache.keys().next().value
    if (oldestKey !== undefined) markdownCache.delete(oldestKey)
  }
  markdownCache.set(cacheKey, result)
  return result
}

export function openChatMarkdownLink(href: string): void {
  if (href.startsWith('file://')) {
    try {
      const filePath = parseFileUrlToPath(href)
      const eventName = /\.md(?:[?#]|$)/i.test(href) ? 'preview-markdown' : 'preview-file'
      window.dispatchEvent(new CustomEvent(eventName, { detail: { path: filePath } }))
      return
    } catch {
      // fall through to openExternal
    }
  }
  window.electronAPI.shell.openExternal(href)
}
