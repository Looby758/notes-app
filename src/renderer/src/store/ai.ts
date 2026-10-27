import { create } from 'zustand'
import type { AiStatus } from '@shared/types'
import { useEditor } from './editor'
import { getNoteText, notesForQuestion } from './noteIndex'
import { useUI } from './ui'
import { applyText, getOpenText, isNoteTab, noteLockOf, openSpecialTab, AI_TAB } from '../lib/editorController'
import { pickContext, splitFrontmatter, withSummary, withTidiedBody } from '../lib/ai'
import { errorMessage, noteTitle } from '../lib/paths'
import { isLockedText } from '../lib/lock/crypto'

/** The AI helper: the summary / tidy-up dialog for a note, and the "Ask my notes" conversation. */

export interface NoteJob {
  kind: 'summary' | 'tidy'
  path: string
  state: 'working' | 'done' | 'error' | 'nokey'
  result?: string
  error?: string
}

export interface AskTurn {
  question: string
  answer?: string
  error?: string
}

interface AiState {
  status: AiStatus | null
  job: NoteJob | null
  turns: AskTurn[]
}

export const useAi = create<AiState>(() => ({ status: null, job: null, turns: [] }))

export async function refreshAiStatus(): Promise<AiStatus> {
  const status = await window.api.aiStatus()
  useAi.setState({ status })
  return status
}

const activeNote = (): string | null => {
  const { active } = useEditor.getState()
  return isNoteTab(active) ? active : null
}

const textOf = (path: string): string => getOpenText(path) ?? getNoteText(path) ?? ''

/** Summarises or tidies the open note, showing the result in a dialog before anything changes. */
export async function runNoteJob(kind: NoteJob['kind'], path = activeNote()): Promise<void> {
  if (!path) return
  useUI.setState({ modal: 'ai' })
  const text = textOf(path)
  if (noteLockOf(path) || isLockedText(text)) {
    useAi.setState({ job: { kind, path, state: 'error', error: 'This note is locked, so it isn’t sent to the AI helper.' } })
    return
  }
  const { body } = splitFrontmatter(text)
  if (!body.trim()) {
    useAi.setState({ job: { kind, path, state: 'error', error: 'This note is empty.' } })
    return
  }
  const status = await refreshAiStatus()
  if (!status.hasKey) {
    useAi.setState({ job: { kind, path, state: 'nokey' } })
    return
  }
  const job: NoteJob = { kind, path, state: 'working' }
  useAi.setState({ job })
  try {
    const result = kind === 'summary' ? await window.api.aiSummarise(noteTitle(path), body) : await window.api.aiTidy(body, 'note')
    if (useAi.getState().job === job) useAi.setState({ job: { ...job, state: 'done', result } })
  } catch (err) {
    if (useAi.getState().job === job) useAi.setState({ job: { ...job, state: 'error', error: errorMessage(err) } })
  }
}

/** Applies a finished summary (added at the top) or tidy-up (replaces the text). Undo with Ctrl+Z. */
export function applyNoteJob(): boolean {
  const job = useAi.getState().job
  if (!job?.result) return false
  const text = textOf(job.path)
  const next = job.kind === 'summary' ? withSummary(text, job.result) : withTidiedBody(text, job.result)
  const ok = applyText(job.path, next)
  if (ok) useAi.setState({ job: null })
  return ok
}

export function openAsk(): void {
  openSpecialTab(AI_TAB)
}

export async function askNotes(question: string): Promise<void> {
  const q = question.trim()
  if (!q) return
  const earlier = useAi.getState().turns.filter((t) => t.answer).slice(-4)
  const turn: AskTurn = { question: q }
  useAi.setState((s) => ({ turns: [...s.turns, turn] }))
  const update = (patch: Partial<AskTurn>): void =>
    useAi.setState((s) => ({ turns: s.turns.map((t) => (t === turn ? { ...t, ...patch } : t)) }))
  try {
    // Follow-ups like "and when is it?" find little on their own, so earlier questions help pick notes.
    const searchText = [...earlier.map((t) => t.question), q].join(' ')
    const notes = pickContext(notesForQuestion(searchText)).map(({ title, text }) => ({ title, text }))
    const answer = await window.api.aiAsk(
      q,
      notes,
      earlier.map((t) => ({ question: t.question, answer: t.answer! }))
    )
    update({ answer })
  } catch (err) {
    update({ error: errorMessage(err) })
  }
}

export function clearAsk(): void {
  useAi.setState({ turns: [] })
}
