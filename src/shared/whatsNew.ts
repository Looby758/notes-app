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
    version: '1.15.1',
    items: [
      'Ask Claude Desktop to find, start, hide or show your games by name (like "GTA 5")'
    ]
  },
  {
    version: '1.15.0',
    items: [
      'Let Claude Desktop look at Orbit (App Studio errors, notes, calendar and more)',
      'Video post-production: auto transcripts, shot list and export for editing',
      'Soundboard: level the mic so it isn\'t too quiet in Discord',
      'Try Orbit as a new user, clean up test copy data, explain how add-ons work',
      'Remove the old corner music player, keep the Music page'
    ]
  },
  {
    version: '1.14.0',
    items: [
      'App Studio: say why a pull request can\'t merge, like "has conflicts with main"',
      'Add-ons: the add-on list, an Add-ons page, and add-ons that aren\'t added stay hidden and never run',
      'Add recommended songs to the music player, including new songs from Deezer'
    ]
  },
  {
    version: '1.13.8',
    items: [
      'Settings opens as a Nocturne-style panel over the current page',
      'App Studio: filter pull requests by app'
    ]
  },
  {
    version: '1.13.7',
    items: [
      'Add a "Get latest main" button to App Studio\'s Releases',
      'Add a clean uninstaller',
      'Money: a Budget tab where you type each income and outgoing'
    ]
  },
  {
    version: '1.13.6',
    items: [
      'Fix Google sign-in saying "This browser or app may not be secure" on the Mac (tested against Google this time), and "Sign in with Google" going back to "Choose an account"'
    ]
  },
  {
    version: '1.13.5',
    items: [
      'Fix Google sign-in still saying "This browser or app may not be secure" on the Mac'
    ]
  },
  {
    version: '1.13.4',
    items: [
      'Fix Google sign-in saying "This browser or app may not be secure" again'
    ]
  },
  {
    version: '1.13.3',
    items: [
      'Orbit Sync: test copies only read, and never call this PC "another computer"'
    ]
  },
  {
    version: '1.13.2',
    items: [
      'Big file sender: send huge files to a friend with a code, or a Google Drive link',
      'App Studio: download counts, health check, roll back, start a new app, bug reports',
      'Mac: update in place, and stop asking "Open Anyway" every launch',
      'Add four mini games, polish every game, and add sound effects',
      'Remove the built-in YouTube mini window',
      'Music: test that dipping covers crossfade, the equaliser and songs started mid-dip',
      'Music: crossfade, equaliser, visualisers, listening stats, phone remote and full-screen player',
      'Add a built-in task manager',
      'Files: show free space on each drive',
      'Downloads: show Epic Games Launcher downloads next to Steam\'s',
      'Keep the Discord sign-in in Messages after Orbit restarts',
      'SkyBlock: suggest each skill\'s Personal Compactor again'
    ]
  },
  {
    version: '1.13.0',
    items: [
      'Music page: songs, albums and playlists in one place, with search (or search YouTube), a music folder setting, and tools to fix details, find covers and tidy duplicates.',
      'Calendar: repeating events, drag to move or resize, a Day view, and edit Google events from Orbit.',
      'Files: search the whole PC, colour tags, favourites, folder sizes and the Recycle Bin.',
      'Money: accounts and your net worth over time, and IOUs with reminders when you split a bill.',
      'Mini games: Solitaire, 2048 and Chess, with win streaks and best times.',
      'Discord: write call notes on the pop-out, and see call stats.',
      'Clips sorted by game, soundboard sounds from a link, and music dips while friends talk.',
      'SkyBlock: profiles (yours or anyone’s) with networth, progress and compare, an ironman goal planner, and a summary card when Minecraft closes.',
      'Key remapper: remap any key, everywhere or just in one game.',
      'World clocks: add friends and see if it’s a good time to message them.',
      'Screen snip: translate offline, snip after a countdown, snip from the Windows taskbar, and snip a bug on any monitor.',
      'Picture editor: boxes, circles, highlighter, numbered steps and a pen.',
      'Video player: A-B loop, step frame by frame, and save a frame into a note.',
      'Delete notes and folders straight away, with an Undo button instead of an “Are you sure?” box.',
      'App Studio: bug pictures are sent to Claude too.',
      'Fix: Google sign-in no longer says “This browser or app may not be secure”.'
    ]
  },
  {
    version: '1.12.1',
    items: [
      'App Studio: a home for the apps you make with Claude. See each app’s branch, last change and open pull requests, and get the latest and run it in one click.',
      'Pull request inbox: try what Claude made in a separate test copy (your app’s own folder isn’t touched), then merge or close it.',
      'Ideas & bugs board for each app, with Send to Claude. Report a bug straight from the screen snip, or sketch a screen.',
      'Releases: bump the version and release in one click, and write the “What’s new” notes from the merged pull requests.',
      'Screenshots: a gallery of each app’s features.',
      'Claude as a tab or a panel floating inside Orbit, like Grok.',
      'Terminal: several terminals, project run buttons, saved commands, and errors that stand out.'
    ]
  },
  {
    version: '1.11.1',
    items: [
      'The web browser is now a full browser.',
      'Mini games: Wordle, with 2 to 8 letters and a Walking Dead mode.',
      'Wikis: fewer spoilers from names (you see the names you know, not later ones), a readable main page, and a progress bar while Orbit checks a wiki for spoilers.',
      'Fix: the Comics tab no longer freezes the app when it opens, and big .cbr files show unpacking progress.',
      'Fix: the wiki spoiler check no longer repeats forever on Windows.'
    ]
  },
  {
    version: '1.11.0',
    items: [
      'Mini games tab: Nonograms and Jigsaw, with Sudoku and Minesweeper in the same place.',
      'Wikis: download Fandom wikis to read offline, switch between Show and Comics, and ask the wiki brain.',
      'Grok as a tab or a panel floating inside Orbit.',
      'Pop a web tab out into its own window that can go full screen.',
      'Discord voice pop-out: a call window for a second screen.',
      'Mouse back and forward buttons work in web tabs and around the app.',
      'Edit .txt, .json and other text files in Orbit.',
      'Fixes for the Windows volume mixer and for Google sign-in looping back to “Choose an account”.'
    ]
  },
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
