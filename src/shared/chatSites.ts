/**
 * Chat bots inside Orbit (Grok, Claude): the real site in a walled-off web page, as a tab or a
 * panel floating over your notes. Each site's address and the hosts that count as "on the site"
 * (pages worth coming back to, not a sign-in page or a link out).
 */

export type ChatSiteId = 'grok' | 'claude'

export interface ChatSite {
  name: string
  /** Where a new chat starts. */
  home: string
  hosts: string[]
}

export const CHAT_SITES: Record<ChatSiteId, ChatSite> = {
  grok: { name: 'Grok', home: 'https://grok.com/', hosts: ['grok.com'] },
  claude: { name: 'Claude', home: 'https://claude.ai/new', hosts: ['claude.ai'] }
}

/** Whether `url` is a page on the site itself (https, on one of its hosts). */
export function isSiteUrl(site: ChatSiteId, url: string): boolean {
  try {
    const { protocol, hostname } = new URL(url)
    return protocol === 'https:' && CHAT_SITES[site].hosts.some((h) => hostname === h || hostname.endsWith(`.${h}`))
  } catch {
    return false
  }
}

/** A Claude link worth opening for an app: a project, a chat, or claude.ai itself. */
export function isClaudeLink(url: string): boolean {
  return isSiteUrl('claude', url.trim())
}
