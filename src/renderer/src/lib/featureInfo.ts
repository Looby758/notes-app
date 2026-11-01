/**
 * The names and groups of Orbit's features, with no app code attached, so the summon bar (its
 * own small window) and Ctrl+K's sentence reader can use them too. lib/features.tsx adds the icons
 * and what each one does.
 */

export type FeatureGroup = 'Notes' | 'Plan' | 'Money' | 'Connect' | 'Media' | 'Play' | 'Tools'

export const FEATURE_GROUPS: FeatureGroup[] = ['Notes', 'Plan', 'Money', 'Connect', 'Media', 'Play', 'Tools']

export interface FeatureInfo {
  /** Stable id, saved in settings (lowercase letters, numbers and dashes). */
  id: string
  name: string
  /** One short line, shown in the launcher. */
  blurb: string
  group: FeatureGroup
  /** Extra words the launcher's search should match. */
  keywords?: string
  /** The command (lib/commands.ts) whose shortcut opens this, to show the keys. */
  command?: string
}

export const FEATURE_INFO: FeatureInfo[] = [
  { id: 'home', name: 'Home', blurb: 'Today, weather, recent notes', group: 'Notes', command: 'home.open' },
  { id: 'today', name: "Today's note", blurb: 'Opens today’s daily note, or makes it', group: 'Notes', command: 'daily.today', keywords: 'daily journal diary' },
  { id: 'new-note', name: 'New note', blurb: 'A blank note', group: 'Notes', command: 'note.new', keywords: 'create write' },
  { id: 'capture', name: 'Summon bar', blurb: 'Jot, ask, calculate or run anything, over any app', group: 'Notes', keywords: 'quick capture inbox thought' },
  { id: 'search', name: 'Search notes', blurb: 'Find words in every note', group: 'Notes', command: 'search', keywords: 'find' },
  { id: 'graph', name: 'Graph', blurb: 'How your notes link together', group: 'Notes', command: 'graph.open', keywords: 'links map' },
  { id: 'random', name: 'Random note', blurb: 'Rediscover something you wrote', group: 'Notes', command: 'note.random' },
  { id: 'reading', name: 'Reading mode', blurb: 'Notes become read-only', group: 'Notes', command: 'view.reading' },

  { id: 'calendar', name: 'Calendar', blurb: 'Events, reminders and bills', group: 'Plan', command: 'calendar.open', keywords: 'events schedule' },
  { id: 'countdowns', name: 'Countdowns', blurb: 'Days until a new season, game update, trip or birthday', group: 'Plan', command: 'countdowns.open', keywords: 'countdown days until timer event release birthday holiday trip season' },
  { id: 'clocks', name: 'World clocks', blurb: 'The time in other places, daylight saving included', group: 'Plan', command: 'clocks.open', keywords: 'time zone timezone dst daylight saving world clock' },
  { id: 'flashcards', name: 'Flashcards', blurb: 'Review what’s due', group: 'Plan', command: 'flashcards.open', keywords: 'revise study cards' },
  { id: 'zen', name: 'Zen & focus timer', blurb: 'Full screen, just you and the note', group: 'Plan', command: 'view.zen', keywords: 'pomodoro focus timer' },

  { id: 'money', name: 'Money', blurb: 'Spending, budgets, goals and subscriptions', group: 'Money', command: 'money.open', keywords: 'bank budget spend savings' },
  { id: 'passwords', name: 'Passwords', blurb: 'Your saved logins', group: 'Money', command: 'passwords.open', keywords: 'vault logins security' },

  { id: 'email', name: 'Email', blurb: 'Gmail inside Orbit', group: 'Connect', command: 'email.open', keywords: 'gmail inbox mail' },
  { id: 'discord-voice', name: 'Discord voice', blurb: 'Who’s in voice, mute and deafen', group: 'Connect', command: 'discord.open', keywords: 'discord voice call mute deafen deafened mic headphones channel who talking' },
  { id: 'messages', name: 'Messages', blurb: 'WhatsApp and Discord', group: 'Connect', command: 'messages.open', keywords: 'whatsapp discord chat' },
  { id: 'phone', name: 'Phone', blurb: 'Send files, Stream Deck, second screen', group: 'Connect', keywords: 'qr mobile touchpad remote deck' },
  { id: 'second-screen', name: 'Second screen', blurb: 'Use your MacBook as a second screen for the PC', group: 'Connect', keywords: 'mac macbook monitor extend display sidecar' },
  { id: 'control-mac', name: 'Control the Mac', blurb: 'See and use your MacBook from the PC in a window', group: 'Connect', keywords: 'remote desktop mac macbook screen vnc' },
  { id: 'webcam', name: 'Phone webcam', blurb: 'Your phone’s camera as the PC’s webcam', group: 'Connect', keywords: 'camera video call discord zoom teams iphone obs' },
  { id: 'web', name: 'Web browser', blurb: 'A web page beside your notes', group: 'Connect', command: 'web.open', keywords: 'internet browse google' },
  { id: 'chat', name: 'AI chat', blurb: 'Chat with Claude about anything', group: 'Connect', command: 'ai.chat', keywords: 'claude ai assistant' },
  { id: 'ask', name: 'Ask everything', blurb: 'AI that knows your notes, email, calendar and money', group: 'Connect', command: 'ai.ask', keywords: 'ai question claude' },

  { id: 'music', name: 'Music', blurb: 'Spotify and your own songs', group: 'Media', command: 'music.player', keywords: 'spotify songs player' },
  { id: 'songid', name: 'What’s this song?', blurb: 'Find the song in a video, game or stream', group: 'Media', command: 'music.whatsThisSong', keywords: 'identify recognise recognize shazam music playlist' },
  { id: 'video', name: 'Video player', blurb: 'Plays any video, with subtitles and speed', group: 'Media', command: 'video.open', keywords: 'mkv avi wmv mp4 movie film watch subtitles player vlc' },
  { id: 'comics', name: 'Comics', blurb: 'Read .cbz and .cbr comic books', group: 'Media', command: 'comics.open', keywords: 'comic book cbr cbz manga graphic novel read zen' },
  { id: 'soundboard', name: 'Soundboard', blurb: 'Sounds with hotkeys and a voice changer, into Discord', group: 'Media', command: 'soundboard.open', keywords: 'sound effects meme mic discord voice changer robot deep chipmunk hotkey' },
  { id: 'youtube', name: 'YouTube', blurb: 'A mini window that floats on top', group: 'Media', command: 'youtube.open', keywords: 'video' },

  { id: 'games', name: 'Games', blurb: 'Your Steam and other games', group: 'Play', command: 'games.open', keywords: 'steam epic play' },
  { id: 'sudoku', name: 'Sudoku', blurb: 'A quick break', group: 'Play', command: 'sudoku.open' },
  { id: 'minesweeper', name: 'Minesweeper', blurb: 'A quick break', group: 'Play', command: 'minesweeper.open' },

  { id: 'snip', name: 'Screen snip', blurb: 'Grab text from anywhere on screen', group: 'Tools', command: 'snip.start', keywords: 'ocr screenshot copy text translate' },
  { id: 'screens', name: 'Screens', blurb: 'Monitor brightness, contrast and input, with hotkeys', group: 'Tools', command: 'screens.open', keywords: 'monitor display brightness contrast input hdmi displayport usb-c ddc dim switch' },
  { id: 'explorer', name: 'Files', blurb: 'Files on this computer', group: 'Tools', command: 'explorer.open', keywords: 'explorer finder folders drive' },
  { id: 'convert', name: 'Convert files', blurb: 'Photos, documents, audio and more', group: 'Tools', command: 'convert.open', keywords: 'pdf mp3 mp4 gif video png jpg word' },
  { id: 'downloader', name: 'Download a video', blurb: 'Paste a YouTube, X, Instagram or TikTok link', group: 'Tools', command: 'downloader.open', keywords: 'youtube twitter x instagram tiktok reddit twitch save video link mp4 mp3 yt-dlp' },
  { id: 'clips', name: 'Clips', blurb: 'Instant replay: save the last 30 seconds, trim it, send it', group: 'Tools', command: 'clips.open', keywords: 'instant replay shadowplay clip highlight discord trim caption game' },
  { id: 'replay', name: 'Save replay', blurb: 'Save the last 30 seconds of your screen', group: 'Tools', command: 'replay.save', keywords: 'instant replay clip that save highlight' },
  { id: 'offline-ai', name: 'Offline AI', blurb: 'AI on your own graphics card: get it or manage it', group: 'Tools', keywords: 'ai local gpu llm private download model qwen llama' },
  { id: 'studio', name: 'Studio', blurb: 'Record your screen and webcam, or go live', group: 'Tools', command: 'studio.open', keywords: 'record obs stream twitch youtube webcam live' },
  { id: 'terminal', name: 'Terminal', blurb: 'Command line in your notes folder', group: 'Tools', command: 'terminal.open', keywords: 'shell cmd powershell' },
  { id: 'streamer', name: 'Streamer mode', blurb: 'Blur private things while sharing', group: 'Tools', command: 'view.streamer', keywords: 'privacy blur stream obs' },
  { id: 'settings', name: 'Settings', blurb: 'Make Orbit yours', group: 'Tools', command: 'settings', keywords: 'preferences options' }
]
