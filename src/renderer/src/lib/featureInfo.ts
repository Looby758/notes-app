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
  { id: 'publishing', name: 'Publishing', blurb: 'Title options, description, tags and chapters for a video', group: 'Plan', command: 'publishing.open', keywords: 'youtube upload title description tags chapters timestamps video publish seo' },
  { id: 'countdowns', name: 'Countdowns', blurb: 'Days until a new season, game update, trip or birthday', group: 'Plan', command: 'countdowns.open', keywords: 'countdown days until timer event release birthday holiday trip season' },
  { id: 'clocks', name: 'World clocks', blurb: 'The time in other places, daylight saving included', group: 'Plan', command: 'clocks.open', keywords: 'time zone timezone dst daylight saving world clock friend friends message awake asleep' },
  { id: 'timeline', name: 'Timeline', blurb: 'What happened in the story, by era and episode', group: 'Plan', command: 'timeline.open', keywords: 'timeline story era episode flashback told shown character life comics show chronology youtube script' },
  { id: 'screenshots', name: 'Screenshots', blurb: 'Tag pictures by character and episode', group: 'Plan', command: 'screenshots.open', keywords: 'screenshot organiser organizer pictures images tag character season episode youtube script image cue' },
  { id: 'flashcards', name: 'Flashcards', blurb: 'Review what’s due', group: 'Plan', command: 'flashcards.open', keywords: 'revise study cards' },
  { id: 'zen', name: 'Zen & focus timer', blurb: 'Full screen, just you and the note', group: 'Plan', command: 'view.zen', keywords: 'pomodoro focus timer' },

  { id: 'money', name: 'Money', blurb: 'Spending, budgets, goals and subscriptions', group: 'Money', command: 'money.open', keywords: 'bank budget spend savings' },
  { id: 'passwords', name: 'Passwords', blurb: 'Your saved logins', group: 'Money', command: 'passwords.open', keywords: 'vault logins security' },

  { id: 'email', name: 'Email', blurb: 'Gmail inside Orbit', group: 'Connect', command: 'email.open', keywords: 'gmail inbox mail' },
  { id: 'discord-voice', name: 'Discord voice', blurb: 'Who’s in voice, mute and deafen', group: 'Connect', command: 'discord.open', keywords: 'discord voice call mute deafen deafened mic headphones channel who talking pop out popout second monitor volume push to talk vc history' },
  { id: 'messages', name: 'Messages', blurb: 'WhatsApp and Discord', group: 'Connect', command: 'messages.open', keywords: 'whatsapp discord chat' },
  { id: 'phone', name: 'Phone', blurb: 'Send files, Stream Deck, second screen', group: 'Connect', keywords: 'qr mobile touchpad remote deck' },
  { id: 'second-screen', name: 'Second screen', blurb: 'Use your MacBook as a second screen for the PC', group: 'Connect', keywords: 'mac macbook monitor extend display sidecar' },
  { id: 'control-mac', name: 'Control the Mac', blurb: 'See and use your MacBook from the PC in a window', group: 'Connect', keywords: 'remote desktop mac macbook screen vnc' },
  { id: 'webcam', name: 'Phone webcam', blurb: 'Your phone’s camera as the PC’s webcam', group: 'Connect', keywords: 'camera video call discord zoom teams iphone obs' },
  { id: 'web', name: 'Web browser', blurb: 'A web page beside your notes', group: 'Connect', command: 'web.open', keywords: 'internet browse google' },
  { id: 'claude', name: 'Claude', blurb: 'Claude (claude.ai) as a tab, or floating over your notes', group: 'Connect', command: 'claude.open', keywords: 'claude anthropic ai chatbot assistant projects code pop out popout float' },
  { id: 'grok', name: 'Grok', blurb: 'Grok as a tab, or floating over your notes', group: 'Connect', command: 'grok.open', keywords: 'grok bot xai x ai chatbot assistant elon pop out popout float' },
  { id: 'chat', name: 'AI chat', blurb: 'Chat with Claude about anything', group: 'Connect', command: 'ai.chat', keywords: 'claude ai assistant' },
  { id: 'ask', name: 'Ask everything', blurb: 'AI that knows your notes, email, calendar and money', group: 'Connect', command: 'ai.ask', keywords: 'ai question claude' },

  { id: 'musiclibrary', name: 'Music', blurb: 'Your own songs: albums, artists, playlists and likes', group: 'Media', command: 'music.page', keywords: 'songs mp3 library playlists albums artists liked orbit music player' },
  { id: 'music', name: 'Music player', blurb: 'The small player in the corner', group: 'Media', command: 'music.player', keywords: 'spotify songs player mini corner' },
  { id: 'songid', name: 'What’s this song?', blurb: 'Find the song in a video, game or stream', group: 'Media', command: 'music.whatsThisSong', keywords: 'identify recognise recognize shazam music playlist' },
  { id: 'video', name: 'Video player', blurb: 'Plays any video, with subtitles and speed', group: 'Media', command: 'video.open', keywords: 'mkv avi wmv mp4 movie film watch subtitles player vlc' },
  { id: 'comics', name: 'Comics', blurb: 'Read .cbz and .cbr comic books', group: 'Media', command: 'comics.open', keywords: 'comic book cbr cbz manga graphic novel read zen' },
  { id: 'wiki', name: 'Wikis', blurb: 'Fandom wikis offline, with an AI that answers from them', group: 'Media', command: 'wiki.open', keywords: 'wiki fandom offline lore characters walking dead skyblock game show read ask' },
  { id: 'soundboard', name: 'Soundboard', blurb: 'Sounds with hotkeys and a voice changer, into Discord', group: 'Media', command: 'soundboard.open', keywords: 'sound effects meme mic discord voice changer robot deep chipmunk hotkey' },

  { id: 'games', name: 'Games', blurb: 'Your Steam and other games', group: 'Play', command: 'games.open', keywords: 'steam epic play minecraft hypixel skyblock session summary coins per hour drops xp' },
  { id: 'skyblock-goals', name: 'SkyBlock', blurb: 'Your profile like SkyCrypt, plus an ironman goal planner', group: 'Play', command: 'skyblockGoals.open', keywords: 'skycrypt profile stats skills slayer dungeons catacombs accessories pets wardrobe bestiary garden museum hypixel minecraft skyblock ironman goal planner craft crafting tree recipe collection slayer forge raw materials terminator' },
  { id: 'mini-games', name: 'Mini games', blurb: 'Sudoku, Minesweeper, Nonograms, Jigsaw, Wordle, Word search, Hangman, Solitaire, Blackjack, 2048, Breakout and Chess', group: 'Play', command: 'minigames.open', keywords: 'sudoku minesweeper nonogram picross griddler jigsaw puzzle photo wordle word guess walking dead word search wordsearch find words hangman guess letters solitaire klondike patience cards blackjack 21 twenty-one dealer 2048 breakout bricks paddle ball arcade chess quick break' },

  { id: 'snip', name: 'Screen snip', blurb: 'Grab text from anywhere on screen', group: 'Tools', command: 'snip.start', keywords: 'ocr screenshot copy text translate' },
  { id: 'snip-picture', name: 'Snip a picture', blurb: 'Drag a box and it’s copied, ready to paste anywhere', group: 'Tools', command: 'snip.picture', keywords: 'snipping tool screenshot screen grab clipboard image paste taskbar crop' },
  { id: 'tasks', name: 'Task manager', blurb: 'What’s running, CPU, memory, disk and network, and end a stuck app', group: 'Tools', command: 'tasks.open', keywords: 'task manager activity monitor processes process cpu memory ram disk network performance end task kill frozen stuck not responding slow' },
  { id: 'uninstall', name: 'Uninstaller', blurb: 'Remove an app and the files and settings it leaves behind', group: 'Tools', command: 'uninstall.open', keywords: 'uninstall uninstaller remove delete app program leftovers clean cleaner revo appcleaner junk files registry settings caches free space' },
  { id: 'mixer', name: 'Volume mixer', blurb: 'A volume for each app: games, Discord, Spotify', group: 'Tools', command: 'mixer.open', keywords: 'sound audio volume loud quiet mute discord spotify game per app levels' },
  { id: 'screens', name: 'Screens', blurb: 'Monitor brightness, contrast and input, with hotkeys', group: 'Tools', command: 'screens.open', keywords: 'monitor display brightness contrast input hdmi displayport usb-c ddc dim switch' },
  { id: 'explorer', name: 'Files', blurb: 'Files on this computer', group: 'Tools', command: 'explorer.open', keywords: 'explorer finder folders drive' },
  { id: 'pdf-editor', name: 'PDF editor', blurb: 'Sign, fill in, merge, split and reorder PDFs', group: 'Tools', command: 'pdf.open', keywords: 'pdf sign signature form fill merge combine join split extract pages reorder rotate acrobat document' },
  { id: 'convert', name: 'Convert files', blurb: 'Photos, documents, audio and more', group: 'Tools', command: 'convert.open', keywords: 'pdf mp3 mp4 gif video png jpg word' },
  { id: 'filesender', name: 'Big file sender', blurb: 'Send huge files to a friend with a code', group: 'Tools', command: 'filesender.open', keywords: 'send share transfer wetransfer friend big large file folder game drive link code p2p' },
  { id: 'downloads', name: 'Downloads', blurb: 'Files and videos from links (YouTube, X, TikTok…), paused, queued or overnight', group: 'Tools', command: 'downloads.open', keywords: 'download manager queue pause resume overnight night schedule speed limit file link zip installer big video youtube twitter x instagram tiktok reddit twitch save mp4 mp3 yt-dlp steam game' },
  { id: 'clips', name: 'Clips', blurb: 'Instant replay: save the last 30 seconds, trim it, send it', group: 'Tools', command: 'clips.open', keywords: 'instant replay shadowplay clip highlight discord trim caption game' },
  { id: 'replay', name: 'Save replay', blurb: 'Save the last 30 seconds of your screen', group: 'Tools', command: 'replay.save', keywords: 'instant replay clip that save highlight' },
  { id: 'offline-ai', name: 'Offline AI', blurb: 'AI on your own graphics card: get it or manage it', group: 'Tools', keywords: 'ai local gpu llm private download model qwen llama' },
  { id: 'appstudio', name: 'App Studio', blurb: 'Your apps made with Claude Code: try, merge and run what Claude made', group: 'Tools', command: 'appstudio.open', keywords: 'apps claude code github pull request pr merge branch eclipse orbit developer dev build code' },
  { id: 'studio', name: 'Studio', blurb: 'Record your screen, webcam or a voiceover (with a teleprompter), or go live', group: 'Tools', command: 'studio.open', keywords: 'record obs stream twitch youtube webcam live voiceover audio mic microphone preset podcast teleprompter autocue script noise gate de-esser compressor eq mouth clicks loudness sections takes retake' },
  { id: 'videos', name: 'Video projects', blurb: 'Script, research, pictures and recordings for each video', group: 'Tools', command: 'videos.open', keywords: 'youtube video project script research voiceover thumbnail recording channel episode' },
  { id: 'macros', name: 'Macros', blurb: 'Record keys and mouse, play them back exactly; auto-clicker', group: 'Tools', command: 'macros.open', keywords: 'macro recorder record replay automate keyboard mouse auto clicker autoclicker cps spam click hold key repeat game skyblock' },
  { id: 'keyremap', name: 'Key remapper', blurb: 'Make any key another key or a shortcut, everywhere or just in one game', group: 'Tools', command: 'keyremap.open', keywords: 'remap rebind bind keys keyboard swap caps lock shortcut hotkey game per game layout disable key' },
  { id: 'terminal', name: 'Terminal', blurb: 'Command lines, with run buttons for your apps', group: 'Tools', command: 'terminal.open', keywords: 'shell cmd powershell npm git dev run projects eclipse' },
  { id: 'streamer', name: 'Streamer mode', blurb: 'Blur private things while sharing', group: 'Tools', command: 'view.streamer', keywords: 'privacy blur stream obs' },
  { id: 'settings', name: 'Settings', blurb: 'Make Orbit yours', group: 'Tools', command: 'settings', keywords: 'preferences options' }
]
