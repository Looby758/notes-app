import { create } from 'zustand'
import type { MessagesService, Unread } from '@shared/messages'

interface MessagesState {
  /** The site showing in the hub. */
  showing: MessagesService
  /** Sites you've opened, so they load (and count unread messages) as soon as the hub opens. */
  used: MessagesService[]
  /** What's waiting on each site, while the hub is open. */
  unread: Partial<Record<MessagesService, Unread>>
}

const KEY = 'messagesHub'

function load(): Pick<MessagesState, 'showing' | 'used'> {
  try {
    const saved = JSON.parse(localStorage.getItem(KEY) ?? '{}') as Partial<MessagesState>
    const valid = (s: unknown): s is MessagesService => s === 'whatsapp' || s === 'discord'
    const showing = valid(saved.showing) ? saved.showing : 'whatsapp'
    const used = Array.isArray(saved.used) ? saved.used.filter(valid) : []
    return { showing, used: used.includes(showing) ? used : [...used, showing] }
  } catch {
    return { showing: 'whatsapp', used: ['whatsapp'] }
  }
}

export const useMessages = create<MessagesState>(() => ({ ...load(), unread: {} }))

useMessages.subscribe((s) => {
  try {
    localStorage.setItem(KEY, JSON.stringify({ showing: s.showing, used: s.used }))
  } catch {
    // not fatal: the hub just opens on WhatsApp next time
  }
})

export function showMessages(service: MessagesService): void {
  useMessages.setState((s) => ({ showing: service, used: s.used.includes(service) ? s.used : [...s.used, service] }))
}

export function setUnread(service: MessagesService, unread: Unread | null): void {
  useMessages.setState((s) => {
    const old = s.unread[service]
    if (unread ? old?.count === unread.count && old?.dot === unread.dot : !old) return s
    const next = { ...s.unread }
    if (unread) next[service] = unread
    else delete next[service]
    return { unread: next }
  })
}

/** Everything waiting across the hub: the total count, and whether anything at all is unread. */
export function useTotalUnread(): Unread {
  const count = useMessages((s) => (s.unread.whatsapp?.count ?? 0) + (s.unread.discord?.count ?? 0))
  const dot = useMessages((s) => !!(s.unread.whatsapp?.dot || s.unread.discord?.dot))
  return { count, dot }
}
