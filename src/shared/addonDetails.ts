/** The store's categories, in order, and the add-ons in each (every add-on the store shows is in exactly one). */
export const ADDON_CATEGORIES: { name: string; addons: string[] }[] = [
  { name: 'Notes and writing', addons: ['summon-bar', 'canvas-board', 'mind-map', 'sketch', 'graph', 'random-note', 'flashcards', 'zen'] },
  { name: 'Plan your time', addons: ['calendar', 'weather', 'countdowns', 'clocks'] },
  { name: 'Money and passwords', addons: ['money', 'passwords'] },
  { name: 'Friends and messages', addons: ['email', 'messages', 'discord-voice'] },
  { name: 'AI and the web', addons: ['ask', 'ai-chat', 'claude', 'grok', 'offline-ai', 'web'] },
  { name: 'Music and sound', addons: ['music', 'songid', 'soundboard', 'mixer'] },
  { name: 'Watch and read', addons: ['video-player', 'comics', 'wiki'] },
  { name: 'Gaming', addons: ['games', 'skyblock', 'mini-games', 'clips'] },
  { name: 'Make videos', addons: ['video-projects', 'studio', 'screenshots', 'timeline', 'streamer'] },
  { name: 'Files and downloads', addons: ['files', 'downloads', 'convert', 'pdf-editor', 'filesender'] },
  { name: 'Phone and screens', addons: ['phone', 'second-screen', 'screens'] },
  { name: 'Your computer', addons: ['snip', 'task-manager', 'uninstaller', 'macros', 'keyremap', 'terminal', 'appstudio'] }
]

/**
 * What each add-on is, in a few sentences, for its page on the Add-ons page (the store later).
 * Every add-on the store shows has one (addons.test.ts checks). Pictures are in
 * renderer/public/addons/<id>.webp, made by scripts/addon-pictures.mjs (a new add-on needs an entry there).
 */
export const ADDON_ABOUT: Record<string, string> = {
  // Notes
  'summon-bar':
    'A bar that pops up over any app with a shortcut. Jot a thought into a note, ask the AI something, work out a sum or convert units, or run any Orbit command, then carry on with what you were doing.',
  graph: 'A map of your notes and the links between them. See which notes are connected, spot ones that are on their own, and click any dot to open that note.',
  'random-note': 'Opens a note at random, so old ideas come back round. You can choose whether daily notes are included.',
  'canvas-board':
    'Free-form boards where notes, pictures, sketches and sticky notes sit anywhere you like, joined with arrows. Good for planning, mood boards and working things out visually.',
  'mind-map': 'Shows a note as a mind map, with its headings and lists branching out from the middle. Switch back and forth any time; the note itself doesn’t change.',
  sketch:
    'Draw or write by hand straight into a note, with a pen, highlighter and eraser. Handwriting can be turned into typed text, by the AI helper or on this computer.',

  // Plan
  calendar:
    'Your week and month in one place. Events come from your daily notes, Google calendars or calendar links, and reminders from your notes. With Money added your bills and paydays show too, and with Weather the forecast for each day.',
  weather: 'Today’s weather and the week ahead on Home, plus a forecast beside outdoor events in the calendar. Pick your town once; there’s nothing to sign up for.',
  'video-projects':
    'Everything for each video in one place: the script, research, pictures, recordings and where it’s up to. Publishing then helps with the title, description, tags and chapters when it’s time to upload.',
  countdowns: 'Count the days until a new season, a game update, a trip or a birthday. They can show on Home so you always know how long is left.',
  clocks: 'The time where your friends are, with daylight saving taken care of. See at a glance whether someone’s likely to be awake before you message them.',
  screenshots: 'Keep screenshots tagged by character, season and episode, so the right picture is easy to find when you’re writing a script.',
  timeline: 'Put a story in order by era and episode, including what was shown in flashbacks, so you can see what really happened when.',
  flashcards: 'Turn notes into flashcards and review the ones that are due each day. Cards you find hard come back sooner, and easy ones wait longer.',
  zen: 'Full screen with nothing but you and your note. Comes with a focus timer that counts work and breaks for you.',

  // Money
  money:
    'Read in your bank statements and see where your money goes, set budgets and savings goals, and keep track of subscriptions. Spots the bills and paydays that repeat, so nothing catches you out.',
  passwords: 'Your logins, kept locked on this computer behind your own password. Fill them into web pages in Orbit, and see which ones are weak or used twice.',

  // Connect
  email: 'Read and answer your Gmail in a tab, beside your notes. Ask everything can look through it for you too, if you let it.',
  'discord-voice':
    'See who’s in your Discord voice call and who’s talking, mute and deafen yourself, and pop the call out over a game on your second monitor. Can turn your music down while people speak.',
  messages: 'WhatsApp and Discord in tabs, so your chats are beside your notes without another app open.',
  phone:
    'Connect your phone with a QR code. Send files and links both ways, use it as a remote, touchpad or Stream Deck, or use its camera as your computer’s webcam.',
  'second-screen': 'Use your MacBook as a second screen for the PC, or see and use the Mac from the PC in a window.',
  web: 'Web pages in tabs beside your notes, with bookmarks, downloads, saved logins and translating. Links in notes can open here instead of your usual browser.',
  claude: 'Claude (claude.ai) in a tab or floating over your notes, signed in as you. App Studio can send your ideas and bugs straight to a Claude project.',
  grok: 'Grok in a tab or floating over your notes, signed in as you.',
  'ai-chat': 'Chat with Claude about anything, in a tab. Chats are kept, so you can come back to them.',
  ask: 'Ask questions and get answers from your own notes. If you allow it, it can also look at your email, calendar and money to answer things like “what’s on this week?”',

  // Media
  music:
    'Your own songs as a full music library of albums, artists, playlists and likes, with Spotify in the Home page’s Now playing box. Download a song from a video link straight into it, and see lyrics and a visualiser while it plays.',
  songid: 'Listen to whatever’s playing in a video, game or stream and find out what the song is. Add it to your music or a playlist in one click.',
  'video-player': 'Plays almost any video, with subtitles, playback speed and an Up next list. Pop it out over other windows to watch while you work.',
  comics: 'A shelf for your .cbz and .cbr comic books, and a reader that shows a page or one panel at a time. Remembers where you were in each one.',
  wiki: 'Download a Fandom wiki to read offline without the ads, and ask an AI questions that it answers from that wiki.',
  soundboard:
    'Sounds on buttons and hotkeys, played into Discord calls as well as to you. Includes a voice changer, and you can cut a sound straight from a video link.',

  // Play
  games: 'All your Steam and other games in one place, with their covers. For Hypixel SkyBlock, it can sum up each session: coins per hour, drops and XP.',
  skyblock: 'See a SkyBlock profile like SkyCrypt does, plan ironman goals step by step, and keep an eye on event timers.',
  'mini-games': 'Quick games for a break: Sudoku, Minesweeper, Nonograms, Jigsaw, Wordle, Word search, Hangman, Solitaire, Blackjack, 2048, Breakout and Chess.',

  // Tools
  snip: 'Drag a box anywhere on screen to copy it as a picture, or grab the text in it to copy, search, translate or ask the AI about. Works from a shortcut, the tray or the taskbar.',
  'task-manager': 'See what’s running and what it’s using: CPU, memory, disk and network. End an app that’s stuck or slowing everything down.',
  uninstaller: 'Remove an app properly, along with the files, settings and leftovers it would normally leave behind, and see how much space you get back.',
  mixer: 'A volume slider for each app, so games, Discord and Spotify can each be as loud as you want.',
  screens: 'Change your monitors’ brightness, contrast and input from Orbit, with hotkeys for each, without touching the buttons on the screen.',
  files: 'Browse the files on your computer in a tab, with previews, tags, zips and a search of the whole PC. Open two folders side by side to drag files between them.',
  'pdf-editor': 'Sign PDFs, fill in forms, and merge, split, rotate or reorder pages, all on this computer.',
  convert: 'Turn files into other kinds: photos, documents, audio and video. Make a GIF from a video, a PDF from pictures, an MP3 from a video and more.',
  filesender: 'Send huge files or whole folders straight to a friend with a short code. Nothing’s uploaded to a website in between.',
  downloads:
    'Download files and videos from links (YouTube, X, TikTok, Reddit and more). Pause, queue, or leave them to run overnight, with a speed limit if you need one.',
  clips: 'Instant replay: press a key to save the last 30 seconds of your game, then trim it, caption it and send it to a Discord channel.',
  'offline-ai': 'Run an AI on your own graphics card, so it works with no internet and nothing leaves your computer. Get a model and manage it here.',
  terminal: 'Command lines in tabs, with run buttons for the apps you’re working on.',
  appstudio: 'Your apps made with Claude Code in one place: keep a board of ideas and bugs, try and merge what Claude made, and run your apps.',
  studio:
    'Record your screen, webcam or a voiceover with a teleprompter, or go live. Your mic gets cleaned up as it records, and presets keep your setups ready.',
  macros: 'Record keys and mouse clicks and play them back exactly, on a hotkey. Includes an auto-clicker.',
  keyremap: 'Make any key act as another key or a shortcut, everywhere or just while one game is open.',
  streamer: 'Blurs private things, like note names and messages, while you share your screen or stream.'
}
