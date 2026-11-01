import { create } from 'zustand'
import type { BrokenSettingsFile } from '@shared/settingsHealth'
import type { ReleaseNotes } from '@shared/whatsNew'

/** The pop-ups Orbit shows when it opens: broken settings files first, then what's new. */
interface NoticesState {
  broken: BrokenSettingsFile[] | null
  whatsNew: ReleaseNotes[] | null
}

export const useNotices = create<NoticesState>(() => ({ broken: null, whatsNew: null }))

let started = false

/** Once per window: anything to fix, then anything new since this computer last opened Orbit. */
export async function checkOnStart(): Promise<void> {
  if (started) return
  started = true
  const broken = await window.api.checkSettingsFiles().catch(() => [])
  const whatsNew = await window.api.whatsNewPending().catch(() => [])
  useNotices.setState({ broken: broken.length ? broken : null, whatsNew: whatsNew.length ? whatsNew : null })
}

/** From Settings: look again, and say so when everything's fine. */
export async function checkSettingsNow(): Promise<number> {
  const broken = await window.api.checkSettingsFiles()
  useNotices.setState({ broken: broken.length ? broken : null })
  return broken.length
}

export async function showWhatsNew(): Promise<void> {
  const notes = await window.api.whatsNewAll()
  useNotices.setState({ whatsNew: notes.length ? notes : null })
}

export function closeWhatsNew(): void {
  useNotices.setState({ whatsNew: null })
  void window.api.whatsNewSeen()
}
