import { create } from 'zustand'
import type { AddonFileState } from '@shared/addonPackages'

/** Where each downloadable add-on's download is up to (main/addonFiles.ts keeps it). */
export const useAddonFiles = create<{ states: Record<string, AddonFileState> }>(() => ({ states: {} }))

let started = false
export function watchAddonFiles(): void {
  if (started || !window.api?.addonFileStates) return
  started = true
  void window.api.addonFileStates().then((states) => useAddonFiles.setState({ states }))
  window.api.onAddonFilesChanged((states) => useAddonFiles.setState({ states }))
}

export const useAddonFile = (id: string): AddonFileState | undefined => {
  watchAddonFiles()
  return useAddonFiles((s) => s.states[id])
}
