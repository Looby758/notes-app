/**
 * Letting go of a video or sound when it's closed. Taking a <video> or <audio> off the page doesn't
 * make the window stop reading its file (it holds on until it's tidied away, which can be much
 * later), and while it reads, Windows says the file is in use by Orbit. Emptying it does.
 */
export function unloadMedia(el: HTMLMediaElement | null | undefined): void {
  if (!el) return
  try {
    el.pause()
    el.removeAttribute('src')
    el.load()
  } catch {
    // Already gone.
  }
}

/**
 * For a <video>/<audio> element's ref: lets go of its file when it leaves the page. One function
 * for every element (so React only calls it as the element comes and goes, not on every change).
 */
export const releaseOnUnmount = (el: HTMLMediaElement | null): (() => void) | undefined => (el ? () => unloadMedia(el) : undefined)
