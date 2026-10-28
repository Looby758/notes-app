import './email.css'
import { useEffect, useMemo, useRef, useState, type FormEvent } from 'react'
import {
  Archive,
  CalendarPlus,
  ExternalLink,
  FilePlus,
  Forward,
  Image,
  Loader2,
  Mail,
  Paperclip,
  Pencil,
  RefreshCw,
  Reply,
  ReplyAll,
  Search,
  Send,
  Star,
  Trash2,
  X
} from 'lucide-react'
import type { EmailFolder, EmailMessage, EmailSummary } from '@shared/types'
import {
  closeEmail,
  discardDraft,
  loadEmails,
  openEmail,
  refreshEmailStatus,
  removeEmail,
  sendDraft,
  setFolder,
  setRead,
  setStarred,
  startDraft,
  updateDraft,
  useEmail
} from '../../store/email'
import { useVault } from '../../store/vault'
import { useNoteIndex } from '../../store/noteIndex'
import { useUI } from '../../store/ui'
import { notify } from '../../store/notify'
import { EMAIL_TAB, openSpecialTab, SETTINGS_TAB } from '../../lib/editorController'
import { addHomeCard } from '../../lib/home'
import { HomeBox } from '../Home/HomePage'
import { addEvent } from '../../lib/daily'
import { dayKey, fromDayKey } from '../../lib/dates'
import { htmlToMarkdown } from '../../lib/import/html'
import { errorMessage } from '../../lib/paths'
import {
  EMAIL_FOLDER,
  emailToNote,
  forwardSubject,
  freePath,
  guessEvent,
  noteName,
  quoted,
  replySubject,
  shortName,
  showAddress,
  tidyText
} from '../../lib/email'
import EmptyArt from '../Motion/EmptyArt'

const FOLDERS: { id: EmailFolder; label: string }[] = [
  { id: 'inbox', label: 'Inbox' },
  { id: 'unread', label: 'Unread' },
  { id: 'starred', label: 'Starred' },
  { id: 'sent', label: 'Sent' },
  { id: 'all', label: 'All mail' }
]

const GMAIL_API_PAGE = 'https://console.cloud.google.com/apis/library/gmail.googleapis.com'
/** Where Google keeps the list of accounts allowed to sign in while a project is in "Testing". */
const AUDIENCE_PAGE = 'https://console.cloud.google.com/auth/audience'

/** "09:14" today, "Tue" this week, "28 Oct" this year, otherwise "28/10/2025". */
function shortDate(iso: string): string {
  const d = new Date(iso)
  const now = new Date()
  if (d.toDateString() === now.toDateString()) return d.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' })
  if (now.getTime() - d.getTime() < 6 * 86400000 && d < now) return d.toLocaleDateString(undefined, { weekday: 'short' })
  if (d.getFullYear() === now.getFullYear()) return d.toLocaleDateString(undefined, { day: 'numeric', month: 'short' })
  return d.toLocaleDateString()
}

/** The email as text: its plain-text version, or its HTML turned into markdown. */
function bodyText(email: EmailMessage): string {
  if (email.html) {
    try {
      return htmlToMarkdown(email.html, { image: () => null })
    } catch {
      // fall back to the text version
    }
  }
  return tidyText(email.text ?? '')
}

/** The Email tab: your Gmail inbox, reading, replying and writing, and saving emails as notes or events. */
export default function EmailPage() {
  const status = useEmail((s) => s.status)

  useEffect(() => {
    refreshEmailStatus()
      .then((s) => {
        if (s.gmail && useEmail.getState().emails.length === 0) void loadEmails()
      })
      .catch((err) => notify(err))
  }, [])

  if (!status) return <div className="email-page" />
  if (!status.gmail) return <EmailSetup />
  return (
    <div className="email-page">
      <Toolbar />
      <div className="email-body">
        <EmailList />
        <div className="email-reader-pane">
          <Composer />
          <Reader />
        </div>
      </div>
    </div>
  )
}

// ---------- setup ----------

function EmailSetup() {
  const status = useEmail((s) => s.status)!
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const connect = async (): Promise<void> => {
    setBusy(true)
    setError(null)
    try {
      useEmail.setState({ status: await window.api.emailConnect() })
      void loadEmails()
    } catch (err) {
      setError(errorMessage(err))
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="email-page email-setup-page">
      <div className="email-setup">
        <Mail size={34} strokeWidth={1.3} />
        <h2>Read and send your email here</h2>
        <p>
          See your Gmail inbox, reply and write emails, and turn any email into a note or a calendar event with one click.
          Your emails stay in Gmail: Notes only fetches them while you look.
        </p>
        {!status.configured ? (
          <>
            <p>
              Email uses the same Google sign-in as your calendar. Set that up first in <strong>Settings → Calendar</strong>,
              then come back here.
            </p>
            <button
              className="btn btn-primary"
              onClick={() => {
                openSpecialTab(SETTINGS_TAB)
                useUI.setState({ settingsSection: 'calendar' })
              }}
            >
              Open calendar settings
            </button>
          </>
        ) : (
          <>
            <ol className="email-steps">
              <li>
                <strong>Turn on Gmail for your Google project.</strong> Open{' '}
                <button className="link-btn" onClick={() => window.open(GMAIL_API_PAGE)}>
                  the Gmail API page <ExternalLink size={11} />
                </button>
                , check the project name at the top is the one you made for your calendar, and press <strong>Enable</strong>.
                (If it says “Manage”, it’s already on.)
              </li>
              <li>
                <strong>Add yourself as a test user.</strong> Open{' '}
                <button className="link-btn" onClick={() => window.open(AUDIENCE_PAGE)}>
                  the Audience page <ExternalLink size={11} />
                </button>
                {status.email ? (
                  <>
                    , and under <strong>Test users</strong> check <strong>{status.email}</strong> is listed. If it isn’t, press{' '}
                    <strong>Add users</strong>, type it in and press <strong>Save</strong>.
                  </>
                ) : (
                  <>
                    , press <strong>Add users</strong> under <strong>Test users</strong>, type your Gmail address and press <strong>Save</strong>.
                  </>
                )}{' '}
                Without this, Google says <em>“Access blocked”</em>.
              </li>
              <li>
                <strong>Press Connect Gmail below.</strong> Your browser opens Google’s sign-in page.
              </li>
              <li>
                Google may say <em>“Google hasn’t verified this app”</em>. That’s expected: the “app” is your own private
                project. Press <strong>Continue</strong>.
              </li>
              <li>
                When Google asks what Notes can do, <strong>tick the Gmail box</strong> (read, change and send email) and press
                Continue. Then come back here.
              </li>
            </ol>
            <button className="btn btn-primary" disabled={busy || !status.canEncrypt} onClick={connect}>
              <Mail size={14} /> {busy ? 'Waiting for you in your browser…' : 'Connect Gmail'}
            </button>
            {status.connected && status.email && <p className="email-setup-note">You’re signed in to the calendar as {status.email}; this adds email to that same sign-in.</p>}
          </>
        )}
        {(error ?? status.error) && <p className="setting-warning">{error ?? status.error}</p>}
      </div>
    </div>
  )
}

// ---------- toolbar and list ----------

function Toolbar() {
  const folder = useEmail((s) => s.folder)
  const query = useEmail((s) => s.query)
  const loading = useEmail((s) => s.loading)
  const email = useEmail((s) => s.status?.email)
  const [text, setText] = useState(query)
  useEffect(() => setText(query), [query])

  const search = (e: FormEvent): void => {
    e.preventDefault()
    useEmail.setState({ query: text.trim(), emails: [], next: undefined })
    void loadEmails()
  }

  return (
    <div className="email-toolbar">
      <button className="btn btn-primary" onClick={() => startDraft({ kind: 'new', to: '', subject: '', body: '' })}>
        <Pencil size={13} /> Write
      </button>
      <div className="segmented">
        {FOLDERS.map((f) => (
          <button key={f.id} className={folder === f.id && !query ? 'selected' : ''} onClick={() => setFolder(f.id)}>
            {f.label}
          </button>
        ))}
      </div>
      <form className="email-search" onSubmit={search}>
        <Search size={13} />
        <input
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Escape' && text) {
              e.stopPropagation()
              setText('')
              if (query) setFolder(folder)
            }
          }}
          placeholder="Search all email, e.g. from:sam invoice"
          spellCheck={false}
        />
        {query && (
          <button type="button" className="icon-btn" title="Clear search" onClick={() => setFolder(folder)}>
            <X size={13} />
          </button>
        )}
      </form>
      <button className="icon-btn" title={`Check for new email${email ? ` (${email})` : ''}`} disabled={loading} onClick={() => loadEmails()}>
        <RefreshCw size={15} className={loading ? 'spin' : ''} />
      </button>
    </div>
  )
}

function EmailList() {
  const emails = useEmail((s) => s.emails)
  const openId = useEmail((s) => s.openId)
  const loading = useEmail((s) => s.loading)
  const next = useEmail((s) => s.next)
  const error = useEmail((s) => s.error)
  const query = useEmail((s) => s.query)

  return (
    <div className="email-list" role="list">
      {error && (
        <div className="email-error">
          <span>{error}</span>
          {error.includes('Gmail API is turned off') && (
            <button className="link-btn" onClick={() => window.open(GMAIL_API_PAGE)}>
              Turn it on <ExternalLink size={11} />
            </button>
          )}
          {/Connect Gmail/.test(error) && (
            <button
              className="link-btn"
              onClick={() =>
                window.api
                  .emailConnect()
                  .then((status) => {
                    useEmail.setState({ status, error: null })
                    void loadEmails()
                  })
                  .catch((err) => useEmail.setState({ error: errorMessage(err) }))
              }
            >
              Connect again
            </button>
          )}
          <button className="icon-btn" title="Dismiss" onClick={() => useEmail.setState({ error: null })}>
            <X size={12} />
          </button>
        </div>
      )}
      {emails.map((e) => (
        <button
          key={e.id}
          role="listitem"
          className={`email-row ${e.unread ? 'unread' : ''} ${openId === e.id ? 'selected' : ''}`}
          onClick={() => openEmail(e.id)}
          data-email={e.id}
        >
          <div className="email-row-top">
            <span className="email-row-from">{shortName(e.from)}</span>
            {e.hasAttachments && <Paperclip size={11} className="email-row-icon" />}
            {e.starred && <Star size={11} className="email-row-icon email-star-on" />}
            <span className="email-row-date">{shortDate(e.date)}</span>
          </div>
          <div className="email-row-subject">{e.subject}</div>
          <div className="email-row-snippet">{e.snippet}</div>
        </button>
      ))}
      {loading && (
        <div className="email-list-note">
          <Loader2 size={14} className="spin" /> Loading…
        </div>
      )}
      {!loading && emails.length === 0 && !error && <div className="email-list-note">{query ? 'No emails match that search.' : 'Nothing here.'}</div>}
      {!loading && next && (
        <button className="btn email-more" onClick={() => loadEmails(true)}>
          Show more
        </button>
      )}
    </div>
  )
}

// ---------- reading ----------

function Reader() {
  const open = useEmail((s) => s.open)
  const opening = useEmail((s) => s.opening)
  const openId = useEmail((s) => s.openId)
  const draft = useEmail((s) => s.draft)
  const [pictures, setPictures] = useState(false)
  const [adding, setAdding] = useState(false)
  useEffect(() => {
    setPictures(false)
    setAdding(false)
  }, [openId])

  if (draft) return null
  if (!openId) {
    return (
      <div className="email-empty">
        <EmptyArt kind="mail" size={64} />
        <span>Pick an email to read it</span>
      </div>
    )
  }
  if (opening || !open) {
    return <div className="email-empty">{opening ? <Loader2 size={20} className="spin" /> : 'This email couldn’t be opened.'}</div>
  }

  const email = open
  const reply = (all: boolean): void => {
    const me = useEmail.getState().status?.email?.toLowerCase()
    const to = showAddress(email.replyTo ?? email.from)
    const others = all
      ? [...email.to, ...email.cc].filter((a) => a.email.toLowerCase() !== me && a.email !== (email.replyTo ?? email.from).email).map(showAddress)
      : []
    startDraft({
      kind: 'reply',
      to,
      cc: others.join(', '),
      subject: replySubject(email.subject),
      body: quoted(email, email.text ?? bodyText(email)),
      replyTo: { threadId: email.threadId, messageId: email.messageId, references: email.references }
    })
  }
  const forward = (): void =>
    startDraft({
      kind: 'forward',
      to: '',
      subject: forwardSubject(email.subject),
      body: `\n\n---------- Forwarded message ----------\nFrom: ${showAddress(email.from)}\nDate: ${new Date(email.date).toLocaleString()}\nSubject: ${email.subject}\nTo: ${email.to.map(showAddress).join(', ')}\n\n${email.text ? tidyText(email.text) : bodyText(email)}`
    })

  return (
    <div className="email-reader">
      <div className="email-actions">
        <button className="btn" onClick={() => reply(false)} title="Reply">
          <Reply size={13} /> Reply
        </button>
        {email.to.length + email.cc.length > 1 && (
          <button className="btn" onClick={() => reply(true)} title="Reply to everyone">
            <ReplyAll size={13} /> Reply all
          </button>
        )}
        <button className="btn" onClick={forward}>
          <Forward size={13} /> Forward
        </button>
        <span className="email-actions-gap" />
        <button className="btn email-to-note" onClick={() => saveAsNote(email)} title="Make a note from this email">
          <FilePlus size={13} /> Save as note
        </button>
        <button className={`btn email-to-event ${adding ? 'active' : ''}`} onClick={() => setAdding(!adding)} title="Put this email on your calendar">
          <CalendarPlus size={13} /> Add to calendar
        </button>
        <span className="email-actions-gap" />
        <button className="icon-btn" title={email.starred ? 'Unstar' : 'Star'} onClick={() => setStarred(email.id, !email.starred)}>
          <Star size={15} className={email.starred ? 'email-star-on' : ''} />
        </button>
        <button className="icon-btn" title="Mark as unread" onClick={() => setRead(email.id, false)}>
          <Mail size={15} />
        </button>
        <button className="icon-btn" title="Archive (take it out of the inbox)" onClick={() => removeEmail(email.id, 'archive')}>
          <Archive size={15} />
        </button>
        <button className="icon-btn" title="Move to Gmail’s Bin" onClick={() => removeEmail(email.id, 'trash')}>
          <Trash2 size={15} />
        </button>
        <button className="icon-btn" title="Open in Gmail" onClick={() => window.open(email.webUrl)}>
          <ExternalLink size={15} />
        </button>
        <button className="icon-btn" title="Close" onClick={closeEmail}>
          <X size={15} />
        </button>
      </div>

      {adding && <AddToCalendar email={email} onDone={() => setAdding(false)} />}

      <div className="email-head">
        <h2>{email.subject}</h2>
        <div className="email-head-row">
          <span className="email-head-from">{showAddress(email.from)}</span>
          <span className="email-head-date">{new Date(email.date).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' })}</span>
        </div>
        {email.to.length > 0 && <div className="email-head-to">To: {email.to.map(showAddress).join(', ')}</div>}
        {email.cc.length > 0 && <div className="email-head-to">Cc: {email.cc.map(showAddress).join(', ')}</div>}
        {email.attachments.length > 0 && (
          <div className="email-attachments">
            <Paperclip size={12} />
            {email.attachments.map((a, i) => (
              <span key={i} className="email-attachment">
                {a.name}
              </span>
            ))}
            <button className="link-btn" onClick={() => window.open(email.webUrl)}>
              Open in Gmail to download
            </button>
          </div>
        )}
        {email.html && !pictures && /<img\b/i.test(email.html) && (
          <button className="email-pictures" onClick={() => setPictures(true)}>
            <Image size={12} /> Pictures are hidden so senders can’t tell you’ve opened this. Show pictures
          </button>
        )}
      </div>
      <EmailBody email={email} pictures={pictures} />
    </div>
  )
}

/**
 * The email itself. HTML emails go in a locked-down frame: no scripts, nothing from the internet
 * unless you show pictures, and links open in your browser.
 */
function EmailBody({ email, pictures }: { email: EmailMessage; pictures: boolean }) {
  const doc = useMemo(() => {
    if (!email.html) return null
    const csp = `default-src 'none'; style-src 'unsafe-inline'${pictures ? '; img-src https: http: data:; font-src https: data:' : '; img-src data:'}`
    return `<!doctype html><html><head><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="${csp}"><base target="_blank"><style>html{background:#fff;color:#202124;font:14px/1.5 -apple-system,'Segoe UI',sans-serif}body{margin:16px;overflow-wrap:anywhere}img{max-width:100%;height:auto}</style></head><body>${email.html}</body></html>`
  }, [email.html, pictures])
  if (doc) {
    return <iframe className="email-frame" title="Email" sandbox="allow-popups allow-popups-to-escape-sandbox" srcDoc={doc} />
  }
  return <div className="email-text">{tidyText(email.text ?? '') || '(This email has no text.)'}</div>
}

async function saveAsNote(email: EmailMessage): Promise<void> {
  const notes = useNoteIndex.getState().notes
  const taken = new Set([...notes.keys()].map((p) => p.toLowerCase()))
  const path = freePath(EMAIL_FOLDER, noteName(email.subject), (p) => taken.has(p.toLowerCase()))
  const created = await useVault.getState().createNoteAt(path, emailToNote(email, bodyText(email)))
  if (created) notify(`Saved as a note in ${EMAIL_FOLDER}`, 'info')
}

function AddToCalendar({ email, onDone }: { email: EmailMessage; onDone: () => void }) {
  const guess = useMemo(() => guessEvent(email, email.text ?? bodyText(email)), [email])
  const [title, setTitle] = useState(guess.title)
  const [date, setDate] = useState(dayKey(guess.date))
  const [start, setStart] = useState(guess.start ?? '')
  const [end, setEnd] = useState('')
  const input = useRef<HTMLInputElement>(null)
  useEffect(() => input.current?.select(), [])

  const save = async (e: FormEvent): Promise<void> => {
    e.preventDefault()
    const day = fromDayKey(date)
    if (!title.trim() || !day) return
    onDone()
    await addEvent(day, title.trim(), start || undefined, start && end && end > start ? end : undefined)
    notify(`Added to your calendar on ${day.toLocaleDateString(undefined, { weekday: 'short', day: 'numeric', month: 'short' })}`, 'info')
  }

  return (
    <form
      className="quick-add email-event"
      onSubmit={save}
      onKeyDown={(e) => {
        if (e.key === 'Escape') {
          e.stopPropagation()
          onDone()
        }
      }}
    >
      <input ref={input} className="quick-add-title" value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Event" />
      <div className="quick-add-row">
        <input type="date" value={date} onChange={(e) => setDate(e.target.value)} aria-label="Day" />
        <input type="time" value={start} onChange={(e) => setStart(e.target.value)} aria-label="Start time" />
        <span>to</span>
        <input type="time" value={end} onChange={(e) => setEnd(e.target.value)} aria-label="End time" />
        <span className="quick-add-hint">{start ? '' : 'All day'}</span>
        <button type="button" className="btn" onClick={onDone}>
          Cancel
        </button>
        <button type="submit" className="btn btn-primary" disabled={!title.trim() || !fromDayKey(date)}>
          Add
        </button>
      </div>
    </form>
  )
}

// ---------- writing ----------

function Composer() {
  const draft = useEmail((s) => s.draft)
  const [sending, setSending] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const body = useRef<HTMLTextAreaElement>(null)
  const to = useRef<HTMLInputElement>(null)
  const kind = draft?.kind
  useEffect(() => {
    setError(null)
    if (kind === 'reply') {
      body.current?.focus()
      body.current?.setSelectionRange(0, 0)
    } else if (kind) to.current?.focus()
  }, [kind])

  if (!draft) return null

  const send = async (): Promise<void> => {
    setSending(true)
    setError(null)
    try {
      await sendDraft()
      notify('Email sent', 'info')
    } catch (err) {
      setError(errorMessage(err))
    } finally {
      setSending(false)
    }
  }

  return (
    <form
      className="email-compose"
      onSubmit={(e) => {
        e.preventDefault()
        void send()
      }}
      onKeyDown={(e) => {
        if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
          e.preventDefault()
          void send()
        }
      }}
    >
      <div className="email-compose-head">
        <h3>{draft.kind === 'reply' ? 'Reply' : draft.kind === 'forward' ? 'Forward' : 'New email'}</h3>
        <button type="button" className="icon-btn" title="Discard" onClick={discardDraft}>
          <X size={15} />
        </button>
      </div>
      <label>
        <span>To</span>
        <input ref={to} value={draft.to} onChange={(e) => updateDraft({ to: e.target.value })} placeholder="name@example.com" spellCheck={false} />
      </label>
      <label>
        <span>Cc</span>
        <input value={draft.cc ?? ''} onChange={(e) => updateDraft({ cc: e.target.value })} spellCheck={false} />
      </label>
      <label>
        <span>Subject</span>
        <input value={draft.subject} onChange={(e) => updateDraft({ subject: e.target.value })} />
      </label>
      <textarea ref={body} value={draft.body} onChange={(e) => updateDraft({ body: e.target.value })} placeholder="Write your email…" />
      {error && <p className="setting-warning">{error}</p>}
      <div className="email-compose-actions">
        <button type="button" className="btn" onClick={discardDraft}>
          Discard
        </button>
        <button type="submit" className="btn btn-primary" disabled={sending || !draft.to.trim()}>
          {sending ? <Loader2 size={13} className="spin" /> : <Send size={13} />} Send
        </button>
      </div>
    </form>
  )
}

// ---------- the box on the Home page ----------

const HOME_SHOWN = 4

/** Your unread inbox emails on the Home page (nothing until Gmail is connected). */
function EmailHomeCard() {
  const status = useEmail((s) => s.status)
  const [unread, setUnread] = useState<EmailSummary[] | null>(null)
  const [more, setMore] = useState(false)

  useEffect(() => {
    refreshEmailStatus().catch(() => undefined)
  }, [])
  useEffect(() => {
    if (!status?.gmail) return
    let live = true
    window.api
      .emailList('unread', '')
      .then((page) => {
        if (!live) return
        setUnread(page.emails)
        setMore(!!page.next)
      })
      .catch(() => live && setUnread(null))
    return () => {
      live = false
    }
  }, [status?.gmail])

  if (!status?.gmail || !unread) return null
  const open = (id?: string): void => {
    openSpecialTab(EMAIL_TAB)
    if (id) void openEmail(id)
  }
  const count = `${unread.length}${more ? '+' : ''}`
  return (
    <HomeBox
      icon={<Mail size={15} />}
      title="Email"
      action={
        <button className="link-button home-box-action" onClick={() => open()}>
          Inbox
        </button>
      }
    >
      {unread.length === 0 ? (
        <p className="home-empty">No unread email.</p>
      ) : (
        <>
          <p className="home-empty">
            {count} unread in your inbox
          </p>
          <ul className="home-list">
            {unread.slice(0, HOME_SHOWN).map((e) => (
              <li key={e.id}>
                <button className="home-row" onClick={() => open(e.id)} title={e.subject}>
                  <span className="home-row-icon">
                    <Mail size={13} />
                  </span>
                  <span className="home-row-title">{e.subject}</span>
                  <span className="home-row-folder">{shortName(e.from)}</span>
                </button>
              </li>
            ))}
          </ul>
        </>
      )}
    </HomeBox>
  )
}

addHomeCard({ id: 'email', order: 20, Card: EmailHomeCard })
