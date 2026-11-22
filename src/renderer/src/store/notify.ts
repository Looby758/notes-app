import { create } from 'zustand'
import { errorMessage } from '../lib/paths'
import { isQuiet } from './quiet'

interface NotifyState {
  message: string | null
  /** 'error' for things that went wrong; 'info' for gentle explanations (like "that tab is pinned"). */
  kind: 'error' | 'info'
  /** A button on the message, like "Undo" after a delete. */
  action: NotifyAction | null
}

export interface NotifyAction {
  label: string
  run: () => void
}

export const useNotify = create<NotifyState>(() => ({ message: null, kind: 'error', action: null }))

/** Shows a short message at the bottom of the sidebar (with a button, if `action` is given). */
export function notify(err: unknown, kind: NotifyState['kind'] = 'error', action?: NotifyAction): void {
  // Gentle messages wait during quiet time (zen reading); things that went wrong still show.
  if (kind === 'info' && isQuiet()) return
  const message = errorMessage(err)
  useNotify.setState({ message, kind, action: action ?? null })
  // A message with a button stays a little longer, so there's time to press it.
  setTimeout(() => useNotify.getState().message === message && useNotify.setState({ message: null, action: null }), action ? 6000 : 4000)
}

/** Hides the message now (its button was pressed). */
export const dismissNotify = (): void => useNotify.setState({ message: null, action: null })
