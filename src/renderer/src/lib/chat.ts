import { Marked } from 'marked'
import type { AiChat, AiChatMessage } from '@shared/types'

/** The AI chat's text handling that doesn't need the app: titles, how much history is sent, showing answers. */

/** A chat's name, from its first message: the first line, cut to a few words. */
export function chatTitle(firstMessage: string, max = 48): string {
  const line = firstMessage.trim().split('\n')[0].replace(/\s+/g, ' ').trim()
  if (!line) return 'New chat'
  if (line.length <= max) return line
  const cut = line.slice(0, max)
  const space = cut.lastIndexOf(' ')
  return (space > max / 2 ? cut.slice(0, space) : cut).replace(/[\s,.;:!?-]+$/, '') + '…'
}

/**
 * The end of a conversation, up to about `budget` characters, so a long chat doesn't cost more
 * with every message. Always starts with one of your messages, as Claude expects.
 */
export function recentMessages(messages: AiChatMessage[], budget = 80000): AiChatMessage[] {
  let used = 0
  let start = messages.length
  while (start > 0 && (start === messages.length || used + messages[start - 1].text.length <= budget)) {
    used += messages[start - 1].text.length
    start--
  }
  while (start < messages.length && messages[start].role !== 'user') start++
  return messages.slice(start)
}

const esc = (s: string): string => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!)

const marked = new Marked({
  gfm: true,
  breaks: true,
  renderer: {
    // Any HTML in an answer is shown as text, never run.
    html: ({ text }) => esc(text),
    link({ href, title, tokens }) {
      const label = this.parser.parseInline(tokens)
      if (!/^(https?|mailto):/i.test(href)) return label
      return `<a href="${esc(href)}"${title ? ` title="${esc(title)}"` : ''}>${label}</a>`
    },
    image: ({ text }) => esc(text)
  }
})

/** An answer's markdown as HTML for the chat page. */
export function chatHtml(text: string): string {
  return marked.parse(text, { async: false }) as string
}

/** A chat written out as a note. */
export function chatAsNote(chat: AiChat): string {
  const parts = chat.messages.map((m) => (m.role === 'user' ? `**You:** ${m.text.trim()}` : m.text.trim()))
  return `# ${chat.title}\n\n${parts.join('\n\n---\n\n')}\n`
}

/** A name for a new note that isn't taken yet. */
export function freeNoteName(base: string, taken: (name: string) => boolean): string {
  const clean = base.replace(/[\\/:*?"<>|#^[\]]/g, '').replace(/…$/, '').trim() || 'Chat'
  if (!taken(clean)) return clean
  for (let i = 2; ; i++) if (!taken(`${clean} ${i}`)) return `${clean} ${i}`
}
