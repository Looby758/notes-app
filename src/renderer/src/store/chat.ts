import { create } from 'zustand'
import type { AiChat } from '@shared/types'
import { chatTitle, recentMessages } from '../lib/chat'
import { errorMessage } from '../lib/paths'
import { notify } from './notify'

/**
 * The AI chat page: conversations with Claude about anything. Saved in the settings folder on
 * this computer, newest first, so you can go back to one later.
 */

interface ChatState {
  chats: AiChat[]
  loaded: boolean
  /** The chat on screen, or null for a new one. */
  current: string | null
  /** Chats waiting for Claude's reply. */
  waiting: string[]
  /** Chats whose last message failed, with why. */
  errors: Record<string, string>
}

export const useChat = create<ChatState>(() => ({ chats: [], loaded: false, current: null, waiting: [], errors: {} }))

export async function loadChats(): Promise<void> {
  if (useChat.getState().loaded) return
  try {
    const chats = await window.api.aiLoadChats()
    useChat.setState({ chats: [...chats].sort((a, b) => b.updated.localeCompare(a.updated)), loaded: true })
  } catch (err) {
    notify(err)
    useChat.setState({ loaded: true })
  }
}

let writing = false
let again = false

/** Writes the chats, one write at a time. */
function persist(): void {
  if (writing) {
    again = true
    return
  }
  writing = true
  window.api
    .aiSaveChats(useChat.getState().chats)
    .catch(notify)
    .finally(() => {
      writing = false
      if (again) {
        again = false
        persist()
      }
    })
}

function setChats(update: (chats: AiChat[]) => AiChat[]): void {
  useChat.setState((s) => ({ chats: update(s.chats) }))
  persist()
}

const setError = (id: string, error: string | null): void =>
  useChat.setState((s) => {
    const errors = { ...s.errors }
    if (error) errors[id] = error
    else delete errors[id]
    return { errors }
  })

export const openChat = (id: string | null): void => useChat.setState({ current: id })

/** Sends a message in the chat on screen (starting a new one if needed) and waits for Claude's reply. */
export async function sendChat(text: string): Promise<void> {
  const message = text.trim()
  if (!message) return
  let id = useChat.getState().current
  if (id && useChat.getState().waiting.includes(id)) return
  const now = new Date().toISOString()
  if (!id || !useChat.getState().chats.some((c) => c.id === id)) {
    id = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`
    const chat: AiChat = { id, title: chatTitle(message), updated: now, messages: [] }
    setChats((chats) => [chat, ...chats])
    useChat.setState({ current: id })
  }
  const chatId = id
  setChats((chats) => {
    const chat = chats.find((c) => c.id === chatId)!
    return [{ ...chat, updated: now, messages: [...chat.messages, { role: 'user', text: message }] }, ...chats.filter((c) => c !== chat)]
  })
  await reply(chatId)
}

async function reply(id: string): Promise<void> {
  const chat = useChat.getState().chats.find((c) => c.id === id)
  if (!chat) return
  setError(id, null)
  useChat.setState((s) => ({ waiting: [...s.waiting, id] }))
  try {
    const answer = await window.api.aiChat(recentMessages(chat.messages))
    setChats((chats) =>
      chats.map((c) => (c.id === id ? { ...c, updated: new Date().toISOString(), messages: [...c.messages, { role: 'assistant', text: answer }] } : c))
    )
  } catch (err) {
    setError(id, errorMessage(err))
  } finally {
    useChat.setState((s) => ({ waiting: s.waiting.filter((w) => w !== id) }))
  }
}

/** Tries again after a message that failed. */
export function retryChat(id: string): void {
  const chat = useChat.getState().chats.find((c) => c.id === id)
  if (chat?.messages.at(-1)?.role === 'user' && !useChat.getState().waiting.includes(id)) reply(id)
}

export function renameChat(id: string, title: string): void {
  const clean = title.trim()
  if (clean) setChats((chats) => chats.map((c) => (c.id === id ? { ...c, title: clean } : c)))
}

export function deleteChat(id: string): void {
  setChats((chats) => chats.filter((c) => c.id !== id))
  setError(id, null)
  if (useChat.getState().current === id) useChat.setState({ current: null })
}
