/**
 * The messages hub: WhatsApp and Discord in their own tabs, each the real website in a walled-off
 * web page (like the web browser tab), with how many messages are waiting.
 */

/**
 * The hub's sites keep their sign-ins in their own storage, apart from the web browser tab's, so
 * clearing browsing data there doesn't sign you out of WhatsApp or Discord.
 */
export const MESSAGES_PARTITION = 'persist:messages'

export type MessagesService = 'whatsapp' | 'discord'

export interface MessagesSite {
  id: MessagesService
  name: string
  url: string
  /** The sites' own addresses (and the ones they sign in through), which stay in the hub. */
  hosts: string[]
}

export const MESSAGES_SITES: MessagesSite[] = [
  { id: 'whatsapp', name: 'WhatsApp', url: 'https://web.whatsapp.com/', hosts: ['whatsapp.com', 'whatsapp.net'] },
  { id: 'discord', name: 'Discord', url: 'https://discord.com/app', hosts: ['discord.com', 'discord.gg', 'discordapp.com', 'hcaptcha.com'] }
]

/** Whether `url` belongs to one of the hub's sites (anything else they link to opens in a web tab). */
export function isMessagesUrl(url: string): boolean {
  try {
    const { protocol, hostname } = new URL(url)
    if (protocol !== 'https:') return false
    return MESSAGES_SITES.some((s) => s.hosts.some((h) => hostname === h || hostname.endsWith(`.${h}`)))
  } catch {
    return false
  }
}

/** What's waiting: a number of messages, and (Discord) whether there's anything unread at all. */
export interface Unread {
  count: number
  /** Unread messages without a number: Discord shows a "•" for channels you haven't caught up on. */
  dot: boolean
}

/**
 * How many messages are waiting, read from the page's title, which is how both sites show it in
 * a browser tab: WhatsApp "(3) WhatsApp", Discord "(2) Discord | #general" for mentions and
 * direct messages, or "• Discord | …" for other unread messages.
 */
export function unreadFromTitle(title: string): Unread {
  const text = title.trim()
  const counted = /^\((\d+)\+?\)/.exec(text)
  if (counted) return { count: Number(counted[1]), dot: false }
  return { count: 0, dot: /^[•●]/.test(text) }
}

/** The badge for a count: "99+" past 99, '' for none. */
export function badgeText(count: number): string {
  return count <= 0 ? '' : count > 99 ? '99+' : String(count)
}
