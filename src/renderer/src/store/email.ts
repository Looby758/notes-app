import { create } from 'zustand'
import type { EmailFolder, EmailMessage, EmailSummary, GoogleAuthStatus, OutgoingEmail } from '@shared/types'
import { errorMessage } from '../lib/paths'

/**
 * The Email page's state, kept here so it survives switching tabs: the folder and search you're
 * looking at, the emails in it, the one that's open, and a draft you're writing.
 */

export interface Draft extends OutgoingEmail {
  /** What the compose box is for, shown as its heading. */
  kind: 'new' | 'reply' | 'forward'
}

interface EmailState {
  status: GoogleAuthStatus | null
  folder: EmailFolder
  query: string
  emails: EmailSummary[]
  next?: string
  loading: boolean
  error: string | null
  openId: string | null
  open: EmailMessage | null
  opening: boolean
  draft: Draft | null
}

export const useEmail = create<EmailState>(() => ({
  status: null,
  folder: 'inbox',
  query: '',
  emails: [],
  loading: false,
  error: null,
  openId: null,
  open: null,
  opening: false,
  draft: null
}))

export async function refreshEmailStatus(): Promise<GoogleAuthStatus> {
  const status = await window.api.emailStatus()
  useEmail.setState({ status })
  return status
}

let listRun = 0

/** Loads the first page of the current folder or search (or, with `more`, the next page). */
export async function loadEmails(more = false): Promise<void> {
  const { folder, query, next, status } = useEmail.getState()
  if (!status?.gmail) return
  const run = ++listRun
  useEmail.setState({ loading: true, error: null })
  try {
    const page = await window.api.emailList(folder, query, more ? next : undefined)
    if (run !== listRun) return
    useEmail.setState((s) => ({ emails: more ? [...s.emails, ...page.emails] : page.emails, next: page.next, loading: false }))
  } catch (err) {
    if (run !== listRun) return
    useEmail.setState({ loading: false, error: errorMessage(err) })
  }
}

export function setFolder(folder: EmailFolder): void {
  useEmail.setState({ folder, query: '', emails: [], next: undefined })
  void loadEmails()
}

/** Updates an email in the list (and the open one), e.g. after marking it read. */
function patch(id: string, change: Partial<EmailSummary>): void {
  useEmail.setState((s) => ({
    emails: s.emails.map((e) => (e.id === id ? { ...e, ...change } : e)),
    open: s.open?.id === id ? { ...s.open, ...change } : s.open
  }))
}

export async function openEmail(id: string): Promise<void> {
  useEmail.setState({ openId: id, opening: true, draft: null })
  try {
    const email = await window.api.emailGet(id)
    if (useEmail.getState().openId !== id) return
    useEmail.setState({ open: email, opening: false })
    if (email.unread) {
      patch(id, { unread: false })
      window.api.emailMarkRead(id, true).catch(() => patch(id, { unread: true }))
    }
  } catch (err) {
    if (useEmail.getState().openId !== id) return
    useEmail.setState({ open: null, opening: false, error: errorMessage(err) })
  }
}

export const closeEmail = (): void => useEmail.setState({ openId: null, open: null })

/** Runs a change in Gmail, updating the list straight away and undoing that if Gmail says no. */
async function change(id: string, local: Partial<EmailSummary>, undo: Partial<EmailSummary>, job: () => Promise<void>): Promise<void> {
  patch(id, local)
  try {
    await job()
  } catch (err) {
    patch(id, undo)
    useEmail.setState({ error: errorMessage(err) })
  }
}

export const setRead = (id: string, read: boolean): Promise<void> =>
  change(id, { unread: !read }, { unread: read }, () => window.api.emailMarkRead(id, read))

export const setStarred = (id: string, starred: boolean): Promise<void> =>
  change(id, { starred }, { starred: !starred }, () => window.api.emailStar(id, starred))

/** Archive or Bin: the email leaves the list (it comes back if Gmail says no). */
export async function removeEmail(id: string, how: 'archive' | 'trash'): Promise<void> {
  const { emails, folder } = useEmail.getState()
  const index = emails.findIndex((e) => e.id === id)
  const item = emails[index]
  // Archiving keeps it in "All mail" and "Starred", so only take it out where it disappears.
  const leaves = how === 'trash' || folder === 'inbox' || folder === 'unread'
  if (leaves) {
    const nextOpen = emails[index + 1] ?? emails[index - 1]
    useEmail.setState((s) => ({ emails: s.emails.filter((e) => e.id !== id) }))
    if (useEmail.getState().openId === id) {
      if (nextOpen) void openEmail(nextOpen.id)
      else closeEmail()
    }
  }
  try {
    await (how === 'archive' ? window.api.emailArchive(id) : window.api.emailTrash(id))
  } catch (err) {
    if (leaves && item) useEmail.setState((s) => ({ emails: [...s.emails.slice(0, index), item, ...s.emails.slice(index)] }))
    useEmail.setState({ error: errorMessage(err) })
  }
}

export const startDraft = (draft: Draft): void => useEmail.setState({ draft })
export const updateDraft = (change: Partial<Draft>): void => useEmail.setState((s) => (s.draft ? { draft: { ...s.draft, ...change } } : {}))
export const discardDraft = (): void => useEmail.setState({ draft: null })

export async function sendDraft(): Promise<void> {
  const draft = useEmail.getState().draft
  if (!draft) return
  const { kind: _kind, ...email } = draft
  await window.api.emailSend(email)
  useEmail.setState({ draft: null })
  if (useEmail.getState().folder === 'sent') void loadEmails()
}
