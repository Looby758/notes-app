import { create } from 'zustand'
import { errorMessage } from '../lib/paths'

interface NotifyState {
  message: string | null
  /** 'error' for things that went wrong; 'info' for gentle explanations (like "that tab is pinned"). */
  kind: 'error' | 'info'
}

export const useNotify = create<NotifyState>(() => ({ message: null, kind: 'error' }))

/** Shows a short message at the bottom of the sidebar. */
export function notify(err: unknown, kind: NotifyState['kind'] = 'error'): void {
  const message = errorMessage(err)
  useNotify.setState({ message, kind })
  setTimeout(() => useNotify.getState().message === message && useNotify.setState({ message: null }), 4000)
}
