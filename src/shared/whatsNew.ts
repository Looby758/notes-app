/**
 * The "What's new" pop-up after Orbit updates. The notes ship inside the app, so they show on every
 * computer (and offline) the first time each one opens the new version.
 */

export interface ReleaseNotes {
  version: string
  /** Short, plain lines: what you can do now that you couldn't before. */
  items: string[]
}

/** Newest first. Add an entry with each release. */
export const RELEASE_NOTES: readonly ReleaseNotes[] = [
  {
    version: '1.10.2',
    items: [
      'A “What’s new” pop-up like this one after each update, on every computer. Open it again any time from Settings → About.',
      'If a settings file breaks, or was saved by an older copy of the app (like a calendar sign-in from before the rename), Orbit offers a reset button for just that part. The old file is kept as a backup.',
      'Volume mixer: set the volume of each app from Orbit or the phone.',
      'Countdowns: big cards counting down to a new season, game update, trip or birthday.',
      'Quick picture editor: crop, resize, add arrows, blur and text.',
      'Pop-out window: keep any app live in a small window that floats on top, and pop the video player out too.',
      'Writing autocomplete: the offline AI suggests the next few words, Tab to take them.',
      'The Files tab has several tabs and drag and drop to and from the sidebar and notes.',
      'Ctrl+Z now undoes calendar events, bulk tag edits and money changes.',
      'The offline AI can read full emails and find things by meaning.',
      'Edit subscriptions that were found in your statements.'
    ]
  },
  {
    version: '1.10.1',
    items: ['Fixes for zip, RAR and 7z files on Windows.']
  },
  {
    version: '1.10.0',
    items: [
      'Open, extract and make zip, RAR and 7z files in the Files tab.',
      'Video downloader: paste a YouTube, X, Instagram or TikTok link to save the video.',
      'Screens: the MacBook as a second screen, control the Mac from the PC, and drop files onto the Mac or phone.',
      'Screens settings: monitor brightness, contrast and input from Orbit or a hotkey.',
      '“What’s this song?”: find the song in a video, game or stream and add it to a playlist.',
      'Discord voice controls: see who’s in voice, mute and deafen from Orbit or the phone.',
      'Orbit’s settings, themes, Home, soundboard and calendar links sync between computers.',
      'Video and comic progress carries over between computers.'
    ]
  }
]

/** -1, 0 or 1, comparing dotted version numbers (1.10.0 is newer than 1.9.3). */
export function compareVersions(a: string, b: string): number {
  const pa = a.split(/[.+-]/).map((n) => parseInt(n, 10) || 0)
  const pb = b.split(/[.+-]/).map((n) => parseInt(n, 10) || 0)
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const d = (pa[i] ?? 0) - (pb[i] ?? 0)
    if (d) return d > 0 ? 1 : -1
  }
  return 0
}

/**
 * The notes to show after updating from `seen` to `current`: every release in between, newest
 * first. Nothing when nothing changed (or the app went back a version). A version with no notes of
 * its own still gets an entry, so the pop-up can at least say it updated.
 */
export function notesSince(seen: string, current: string, notes: readonly ReleaseNotes[] = RELEASE_NOTES): ReleaseNotes[] {
  if (compareVersions(current, seen) <= 0) return []
  const between = notes.filter((n) => compareVersions(n.version, seen) > 0 && compareVersions(n.version, current) <= 0)
  return between.length ? between : [{ version: current, items: [] }]
}
