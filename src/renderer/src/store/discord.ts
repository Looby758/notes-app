import { create } from 'zustand'
import { EMPTY_DISCORD, type DiscordStatus } from '@shared/discord'
import { notify } from './notify'

/** Discord voice: the status main/discord.ts sends whenever anything changes. */
export const useDiscord = create<DiscordStatus>(() => ({ ...EMPTY_DISCORD }))

let started = false
/** Starts listening (once). Called when the Discord page, Home box, or a control is first used. */
export function watchDiscord(): void {
  if (started || typeof window === 'undefined' || !window.api?.discordGet) return
  started = true
  window.api.onDiscordChanged((s) => useDiscord.setState(s, true))
  void window.api.discordGet().then((s) => useDiscord.setState(s, true))
}

/** Mute / deafen toggle, from a command or the phone deck: says what happened. */
export async function toggleDiscord(which: 'mute' | 'deaf'): Promise<void> {
  watchDiscord()
  try {
    const s = await window.api.discordSet(which)
    useDiscord.setState(s, true)
    if (which === 'deaf') notify(s.deaf ? 'Deafened in Discord' : 'Undeafened in Discord', 'info')
    else notify(s.mute ? 'Muted in Discord' : 'Unmuted in Discord', 'info')
  } catch (err) {
    notify(cleanError(err), 'error')
  }
}

/** Electron wraps errors from the main process; this keeps just the message. */
export function cleanError(err: unknown): string {
  const text = err instanceof Error ? err.message : String(err)
  return text.replace(/^Error invoking remote method '[^']+': (Error: )?/, '')
}
