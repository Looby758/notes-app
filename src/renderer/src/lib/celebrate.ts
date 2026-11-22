/**
 * A win in a mini game: the pet cheers and confetti bursts over the game (components/MiniGames/
 * Confetti.tsx listens). `big` is for the best moments (2048, a solved puzzle), `small` for a
 * little one (a hand of Blackjack, a Breakout level).
 */
import { petCheer } from './pet'

export const CELEBRATE = 'minigames:celebrate'

export type CelebrationSize = 'small' | 'win' | 'big'

export function celebrate(size: CelebrationSize = 'win'): void {
  petCheer()
  window.dispatchEvent(new CustomEvent<CelebrationSize>(CELEBRATE, { detail: size }))
}
