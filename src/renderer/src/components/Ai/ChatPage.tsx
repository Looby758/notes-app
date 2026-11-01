import './ai.css'
import { useEffect, useMemo, useRef, useState, type MouseEvent } from 'react'
import { ArrowUp, Check, Copy, FilePlus2, Loader2, MessageSquare, Pencil, Plus, RotateCcw, Trash2 } from 'lucide-react'
import type { AiChat } from '@shared/types'
import { refreshAiStatus, useAi } from '../../store/ai'
import { askChatOnline, deleteChat, loadChats, openChat, renameChat, retryChat, sendChat, useChat } from '../../store/chat'
import { useNoteIndex } from '../../store/noteIndex'
import { useVault } from '../../store/vault'
import { notify } from '../../store/notify'
import { openSpecialTab, SETTINGS_TAB } from '../../lib/editorController'
import { chatAsNote, chatHtml, freeNoteName } from '../../lib/chat'
import { openAiSettings } from './AiSettings'
import EmptyArt from '../Motion/EmptyArt'
import OnlineOffer from './OnlineOffer'

const EXAMPLES = ['Explain how compound interest works', 'Help me plan a week of healthy dinners', 'Write a polite email asking for a deadline extension']

/** Claude's answer, with headings, lists, tables and code shown properly. */
function Reply({ text }: { text: string }) {
  const html = useMemo(() => chatHtml(text), [text])
  const [copied, setCopied] = useState(false)
  // Web links open in your browser.
  const click = (e: MouseEvent): void => {
    const a = (e.target as HTMLElement).closest('a')
    if (!a) return
    e.preventDefault()
    window.open(a.getAttribute('href') ?? '')
  }
  return (
    <div className="chat-reply">
      <div className="chat-markdown" onClick={click} dangerouslySetInnerHTML={{ __html: html }} data-chat-reply />
      <div className="chat-reply-actions">
        <button
          className="icon-btn"
          title="Copy"
          onClick={() =>
            navigator.clipboard.writeText(text).then(() => {
              setCopied(true)
              setTimeout(() => setCopied(false), 1500)
            }, notify)
          }
        >
          {copied ? <Check size={13} /> : <Copy size={13} />}
        </button>
      </div>
    </div>
  )
}

async function saveAsNote(chat: AiChat): Promise<void> {
  const { lookup } = useNoteIndex.getState()
  const name = freeNoteName(chat.title, (n) => lookup.has(`${n}.md`))
  await useVault.getState().createNoteAt(`${name}.md`, chatAsNote(chat))
}

function ChatList() {
  const chats = useChat((s) => s.chats)
  const current = useChat((s) => s.current)
  const [renaming, setRenaming] = useState<string | null>(null)

  const remove = async (chat: AiChat): Promise<void> => {
    const ok = await window.api.confirm({ message: `Delete the chat “${chat.title}”?`, detail: 'This can’t be undone.', ok: 'Delete', type: 'warning' })
    if (ok) deleteChat(chat.id)
  }

  return (
    <div className="chat-list" data-chat-list>
      <button className="btn chat-new" onClick={() => openChat(null)} data-chat-new>
        <Plus size={14} /> New chat
      </button>
      <div className="chat-list-items">
        {chats.map((c) =>
          renaming === c.id ? (
            <input
              key={c.id}
              className="chat-rename"
              autoFocus
              defaultValue={c.title}
              onFocus={(e) => e.target.select()}
              onBlur={(e) => {
                renameChat(c.id, e.target.value)
                setRenaming(null)
              }}
              onKeyDown={(e) => {
                if (e.key === 'Enter') e.currentTarget.blur()
                if (e.key === 'Escape') setRenaming(null)
              }}
            />
          ) : (
            <div key={c.id} className={`chat-list-item ${c.id === current ? 'active' : ''}`} onClick={() => openChat(c.id)} title={c.title}>
              <MessageSquare size={13} />
              <span className="chat-list-title">{c.title}</span>
              <button
                className="icon-btn"
                title="Rename"
                onClick={(e) => {
                  e.stopPropagation()
                  setRenaming(c.id)
                }}
              >
                <Pencil size={12} />
              </button>
              <button
                className="icon-btn"
                title="Delete"
                onClick={(e) => {
                  e.stopPropagation()
                  remove(c)
                }}
              >
                <Trash2 size={12} />
              </button>
            </div>
          )
        )}
      </div>
    </div>
  )
}

/** The AI chat: ask Claude anything, with your past chats kept on the side. */
export default function ChatPage({ autoFocus }: { autoFocus: boolean }) {
  const status = useAi((s) => s.status)
  const current = useChat((s) => s.current)
  const chat = useChat((s) => s.chats.find((c) => c.id === s.current))
  const waiting = useChat((s) => !!s.current && s.waiting.includes(s.current))
  const error = useChat((s) => (s.current ? s.errors[s.current] : undefined))
  const [draft, setDraft] = useState('')
  const input = useRef<HTMLTextAreaElement>(null)
  const end = useRef<HTMLDivElement>(null)

  useEffect(() => {
    refreshAiStatus()
    loadChats()
  }, [])
  useEffect(() => {
    if (autoFocus) input.current?.focus()
  }, [autoFocus, status?.ready, current])
  useEffect(() => end.current?.scrollIntoView({ block: 'end' }), [chat?.messages.length, waiting, current])

  const send = (text = draft): void => {
    if (!text.trim() || waiting) return
    setDraft('')
    sendChat(text)
  }

  const offline = status?.use === 'offline' && status.offline.state === 'ready'
  const who = offline ? 'the offline AI' : 'Claude'
  if (status && !status.ready) {
    return (
      <div className="ai-page" data-chat-page>
        <div className="ai-empty">
          <EmptyArt kind="chat" size={64} />
          <h2>Chat with Claude</h2>
          <p>Ask Claude anything: questions, explanations, writing help, ideas. Your chats are kept so you can come back to them.</p>
          <p>To start, add your Anthropic API key in Settings, or download the offline AI there.</p>
          <button
            className="btn btn-primary"
            onClick={() => {
              openSpecialTab(SETTINGS_TAB)
              openAiSettings()
            }}
          >
            Set up the AI helper
          </button>
        </div>
      </div>
    )
  }

  const messages = chat?.messages ?? []
  return (
    <div className="chat-page" data-chat-page>
      <ChatList />
      <div className="ai-page">
        {chat && (
          <div className="chat-header">
            <span className="chat-header-title">{chat.title}</span>
            <button className="btn" onClick={() => saveAsNote(chat)} title="Save this chat as a note" data-chat-save>
              <FilePlus2 size={14} /> Save as note
            </button>
          </div>
        )}
        <div className="ai-turns">
          {messages.length === 0 && (
            <div className="ai-empty">
              <EmptyArt kind="chat" size={64} />
              <h2>{offline ? 'Chat with the offline AI' : 'Chat with Claude'}</h2>
              <p>{offline ? 'It runs on this computer, so nothing you type leaves it. ' : ''}Ask anything at all. For questions about what you’ve written, use “Ask everything” instead.</p>
              <div className="ai-examples">
                {EXAMPLES.map((e) => (
                  <button key={e} className="btn" onClick={() => send(e)}>
                    {e}
                  </button>
                ))}
              </div>
            </div>
          )}
          {messages.map((m, i) =>
            m.role === 'user' ? (
              <div key={i} className="ai-question">
                {m.text}
              </div>
            ) : (
              <div key={i}>
                <Reply text={m.text} />
                {m.offline && (
                  <OnlineOffer hard={m.hard} busy={waiting} onAsk={i === messages.length - 1 ? () => askChatOnline(chat!.id) : undefined} />
                )}
              </div>
            )
          )}
          {waiting && (
            <p className="ai-working">
              <Loader2 size={14} className="spin" /> {offline ? 'The offline AI is thinking…' : 'Claude is thinking…'}
            </p>
          )}
          {error && !waiting && (
            <div className="chat-error">
              <p className="setting-warning">{error}</p>
              <button className="btn" onClick={() => retryChat(chat!.id)}>
                <RotateCcw size={13} /> Try again
              </button>
            </div>
          )}
          <div ref={end} />
        </div>
        <div className="ai-input">
          <textarea
            ref={input}
            rows={1}
            value={draft}
            placeholder={chat ? `Reply to ${who}…` : `Ask ${who} anything…`}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault()
                send()
              }
            }}
            data-chat-input
          />
          <button className="btn btn-primary" onClick={() => send()} disabled={!draft.trim() || waiting} title="Send">
            <ArrowUp size={14} />
          </button>
        </div>
      </div>
    </div>
  )
}
