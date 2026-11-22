import { create } from 'zustand'
import type { MusicLinkProgress } from '@shared/types'
import { errorMessage } from '../lib/paths'

/** "Save MP3 to my music" downloads in this window, newest first. */
export interface MusicLinkJob extends Omit<MusicLinkProgress, 'id'> {
  id: string
  link: string
}

export const useMusicLinks = create<{ jobs: MusicLinkJob[] }>(() => ({ jobs: [] }))

let listening = false
const listeners = new Set<(p: MusicLinkProgress) => void>()

/** Hears about every save (for a note when one finishes, say). */
export function onMusicLinkDone(listener: (p: MusicLinkProgress) => void): () => void {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

function listen(): void {
  if (listening) return
  listening = true
  window.api.onMusicLinkProgress((p) => {
    useMusicLinks.setState((s) => ({ jobs: s.jobs.map((j) => (j.id === p.id ? { ...j, ...p } : j)) }))
    if (p.stage === 'done' || p.stage === 'error') for (const l of listeners) l(p)
  })
}

export async function saveMp3(link: string): Promise<string | null> {
  listen()
  const clean = link.trim()
  if (!clean) return null
  try {
    const id = await window.api.musicLinkSave(clean)
    useMusicLinks.setState((s) => ({ jobs: [{ id, link: clean, stage: 'downloading' as const, done: null }, ...s.jobs.filter((j) => j.id !== id)].slice(0, 8) }))
    return id
  } catch (err) {
    useMusicLinks.setState((s) => ({ jobs: [{ id: `x${Date.now()}`, link: clean, stage: 'error' as const, error: errorMessage(err) }, ...s.jobs].slice(0, 8) }))
    return null
  }
}

export const cancelMp3 = (id: string): Promise<void> => window.api.musicLinkCancel(id)
export const forgetMp3 = (id: string): void => useMusicLinks.setState((s) => ({ jobs: s.jobs.filter((j) => j.id !== id) }))
