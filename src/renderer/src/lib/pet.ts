/**
 * The app pet (components/Motion/Pet.tsx) listens for these. Anything that finishes something
 * worth a little celebration calls `petCheer()`; it does nothing when the pet is turned off.
 */
export const PET_CHEER = 'pet:cheer'

export function petCheer(): void {
  window.dispatchEvent(new Event(PET_CHEER))
}
