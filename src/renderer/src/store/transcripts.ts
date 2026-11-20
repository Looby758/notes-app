import { create } from 'zustand'
import type { TranscribeProgress, TranscriberState } from '@shared/transcribe'
import { readTranscript, transcriptFile, transcriptJson, type Transcript } from '../lib/transcript'
import { recordUndo, undoChanged } from '../lib/undo'
import { notify } from './notify'

/**
 * Auto transcripts of video project recordings: one file per recording in the notes folder
 * (.notesapp/transcript-<item id>.json), read when they're first shown. Making one again or
 * deleting one can be undone with Ctrl+Z.
 */
interface TranscriptsState {
  /** By recording item id: the transcript, null for none, missing while it hasn't been read yet. */
  byItem: Record<string, Transcript | null>
  /** The recording being transcribed, and how far it's got. */
  job: { itemId: string; progress: TranscribeProgress | null } | null
  engine: TranscriberState | null
}

export const useTranscripts = create<TranscriptsState>(() => ({
  byItem: {},
  job: null,
  engine: null
}))

/** What a deleted transcript's file says (app data files can be written but not removed). */
const NONE = '{"version":1,"deleted":true}'

let listening = false
/** Starts following the transcriber's state (download progress, a transcript's progress). */
export function watchTranscriber(): void {
  if (listening) return
  listening = true
  void window.api.transcriberState().then((engine) => useTranscripts.setState({ engine }))
  window.api.onTranscriberState((engine) => useTranscripts.setState({ engine }))
  window.api.onTranscribeProgress((progress) => {
    const job = useTranscripts.getState().job
    if (job) useTranscripts.setState({ job: { ...job, progress } })
  })
}

export async function loadTranscript(itemId: string): Promise<Transcript | null> {
  const have = useTranscripts.getState().byItem
  if (itemId in have) return have[itemId]
  const file = transcriptFile(itemId)
  let t: Transcript | null = null
  try {
    t = file ? readTranscript(await window.api.readAppData(file)) : null
  } catch {
    t = null
  }
  useTranscripts.setState((s) => ({ byItem: { ...s.byItem, [itemId]: t } }))
  return t
}

/** Forgets what's been read (another notes folder was opened). */
export function forgetTranscripts(): void {
  useTranscripts.setState({ byItem: {} })
}

async function put(itemId: string, t: Transcript | null): Promise<void> {
  const file = transcriptFile(itemId)
  if (!file) throw new Error('That recording can’t have a transcript.')
  await window.api.writeAppData(file, t ? transcriptJson(t) : NONE)
  useTranscripts.setState((s) => ({ byItem: { ...s.byItem, [itemId]: t } }))
  undoChanged('transcripts')
}

function saveUndoably(itemId: string, before: Transcript | null, after: Transcript | null, label: string): Promise<void> {
  recordUndo({
    label,
    undo: () => put(itemId, before),
    redo: () => put(itemId, after)
  })
  return put(itemId, after)
}

export async function setUpTranscripts(model?: string): Promise<void> {
  const state = await window.api.transcriberSetup(model)
  useTranscripts.setState({ engine: state })
  if (state.error) notify(state.error)
  else if (state.state === 'ready') notify('Transcripts are set up. They’re made on this computer; your recordings never leave it.', 'info')
}

/** Makes (or makes again) the transcript of a recording in a video project. */
export async function makeTranscript(itemId: string, path: string, name: string): Promise<void> {
  if (useTranscripts.getState().job) return notify('Orbit is already making a transcript. Wait for it to finish, or stop it.', 'info')
  useTranscripts.setState({ job: { itemId, progress: null } })
  try {
    const before = await loadTranscript(itemId)
    const r = await window.api.transcribe(path)
    const t: Transcript = {
      recording: path,
      made: Date.now(),
      model: r.model,
      length: r.length,
      fileTime: r.fileTime,
      fileSize: r.fileSize,
      words: r.words
    }
    await saveUndoably(itemId, before, t, `${before ? 'Made the transcript again' : 'Made a transcript'} of ${name}`)
    if (!r.words.length) notify('No speech was heard in that recording.', 'info')
  } catch (err) {
    const msg = err instanceof Error ? err.message.replace(/^Error invoking remote method '[^']+': (Error: )?/, '') : String(err)
    if (msg !== 'Stopped.') notify(msg)
  } finally {
    useTranscripts.setState({ job: null })
  }
}

export function stopTranscript(): void {
  void window.api.transcribeCancel()
}

export async function deleteTranscript(itemId: string, name: string): Promise<void> {
  const before = await loadTranscript(itemId)
  if (!before) return
  await saveUndoably(itemId, before, null, `Deleted the transcript of ${name}`)
}

/**
 * Ctrl+K "Transcripts": opens the video page at the open video's transcripts (or, with none open,
 * the video with recordings changed most recently).
 */
export async function showTranscripts(): Promise<void> {
  const [{ ensureVideos, selectProject, useVideos }, { openSpecialTab, VIDEOS_TAB }] = await Promise.all([import('./videos'), import('../lib/editorController')])
  await ensureVideos()
  const { projects, selected } = useVideos.getState()
  if (!selected || !projects.some((p) => p.id === selected)) {
    const withRecordings = projects.filter((p) => p.items.some((i) => i.kind === 'recording')).sort((a, b) => b.updated - a.updated)[0]
    if (withRecordings) selectProject(withRecordings.id)
    else notify('Add a recording to a video first; its transcript goes with it.', 'info')
  }
  openSpecialTab(VIDEOS_TAB)
  // Once the page is showing, scroll to the transcripts.
  setTimeout(() => window.dispatchEvent(new Event('videos:post-production')), 150)
}
