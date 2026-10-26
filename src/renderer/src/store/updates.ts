import { create } from 'zustand'
import type { UpdateStatus } from '@shared/types'

interface UpdatesState {
  status: UpdateStatus | null
  /** The version whose "update ready" message you closed (it comes back for a newer one). */
  dismissed: string | null
}

export const useUpdates = create<UpdatesState>(() => ({ status: null, dismissed: null }))

let started = false

/** Starts following the main process's update status (once). */
export function watchUpdates(): void {
  if (started) return
  started = true
  window.api.updateStatus().then((status) => useUpdates.setState({ status }))
  window.api.onUpdateStatus((status) => useUpdates.setState({ status }))
}

export async function checkForUpdates(): Promise<void> {
  useUpdates.setState({ status: await window.api.checkForUpdates() })
}
