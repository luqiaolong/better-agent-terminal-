import { useEffect, useRef } from 'react'
import hljs from 'highlight.js/lib/core'
import { marked } from 'marked'
import DOMPurify from 'dompurify'
import { openChatMarkdownLink } from '../utils/chat-markdown'
import { absPathToFileUrl, getParentDir, isAbsoluteFilePath, resolveRelativePath } from '../utils/markdown-paths'

interface MarkdownPreviewProps {
  content: string
  filePath?: string
}

marked.setOptions({
  gfm: true,
  breaks: false,
})

const renderer = new marked.Renderer()

function toPreviewHref(href: string, filePath?: string): string {
  if (!href || /^(?:https?|mailto|tel|file):/i.test(href) || href.startsWith('#')) return href
  if (!filePath) return href

  const baseDir = getParentDir(filePath)
  const absPath = isAbsoluteFilePath(href) ? href : resolveRelativePath(baseDir, href)
  return absPathToFileUrl(absPath)
}

renderer.code = function ({ text, lang }: { text: string; lang?: string }) {
  if (lang === 'mermaid') {
    return `<div class="mermaid">${text}</div>`
  }

  let highlighted: string
  try {
    highlighted = lang
      ? hljs.highlight(text, { language: lang }).value
      : hljs.highlightAuto(text).value
  } catch {
    highlighted = text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
  }

  return `<pre><code class="hljs${lang ? ` language-${lang}` : ''}">${highlighted}</code></pre>`
}

renderer.link = function ({ href, text }: { href: string; text: string }) {
  return `<a href="${href}" data-preview-link="true">${text}</a>`
}

renderer.image = function ({ href, text }: { href: string; text: string }) {
  const src = href.startsWith('/') ? `file://${href}` : href
  return `<img alt="${text || ''}" src="${src}" style="max-width:100%"/>`
}

marked.use({ renderer })

function renderMarkdown(text: string, filePath?: string): string {
  const rawHtml = marked.parse(text) as string
  const resolvedHtml = filePath
    ? rawHtml
      .replace(/<a\s+([^>]*?)href="([^"]*)"/gi, (_match, attrs, href) => `<a ${attrs}href="${toPreviewHref(href, filePath)}"`)
      .replace(/<img\s+([^>]*?)src="([^"]*)"/gi, (_match, attrs, src) => `<img ${attrs}src="${toPreviewHref(src, filePath)}"`)
    : rawHtml

  return DOMPurify.sanitize(resolvedHtml, {
    ADD_TAGS: ['input'],
    ADD_ATTR: ['checked', 'disabled', 'type', 'data-preview-link'],
  })
}

let mermaidInstance: typeof import('mermaid')['default'] | null = null

async function getMermaid() {
  if (!mermaidInstance) {
    mermaidInstance = (await import('mermaid')).default
    mermaidInstance.initialize({
      startOnLoad: false,
      theme: 'dark',
      themeVariables: {
        darkMode: true,
        background: '#1e1e1e',
        primaryColor: '#3498db',
        primaryTextColor: '#e0e0e0',
        lineColor: '#666',
      },
    })
  }
  return mermaidInstance
}

async function renderMermaidBlocks(container: HTMLElement) {
  const mermaidDivs = container.querySelectorAll('.mermaid')
  if (mermaidDivs.length === 0) return

  const mermaid = await getMermaid()
  mermaidDivs.forEach((div, index) => {
    div.id = `mermaid-${Date.now()}-${index}`
  })

  try {
    await mermaid.run({ nodes: mermaidDivs as unknown as ArrayLike<HTMLElement> })
  } catch {
    mermaidDivs.forEach(div => {
      if (!div.querySelector('svg')) div.classList.add('mermaid-error')
    })
  }
}

export function MarkdownPreview({ content, filePath }: Readonly<MarkdownPreviewProps>) {
  const containerRef = useRef<HTMLDivElement>(null)
  const html = renderMarkdown(content, filePath)

  useEffect(() => {
    if (containerRef.current) {
      renderMermaidBlocks(containerRef.current)
    }
  }, [html])

  return (
    <div
      ref={containerRef}
      className="file-preview-markdown"
      dangerouslySetInnerHTML={{ __html: html }}
      onClick={(event) => {
        const target = event.target as HTMLElement
        const link = target.closest('a[data-preview-link="true"]') as HTMLAnchorElement | null
        if (!link) return
        event.preventDefault()
        openChatMarkdownLink(link.href)
      }}
    />
  )
}
